import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { importService } from '../services/importService';
import type { User } from '../types';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Main Site' });
  await db.bays.bulkAdd([
    { siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' },
    { siteId, stationId: 'ST-02', connectorId: 'C1', label: 'Bay 2', status: 'Available' }
  ]);
  const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const userId = await db.users.add({
    username: 'sysadmin',
    passwordHash: hash.hash,
    salt: hash.salt,
    role: 'SystemAdministrator',
    siteId,
    failedAttempts: 0
  });
  const actor = (await db.users.get(userId))!;
  const encryptionKey = await cryptoService.deriveEncryptionKey('ChargeBay#Admin1', actor.salt);
  return { siteId, actor, encryptionKey };
}

describe('importService — dedupe, validation, and rollback', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  // D — Import rollback proof: mixed-validity payload inserts zero rows
  it('rejects entire batch when any row is invalid (rollback semantics)', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Good Row,ABC123,04/01/2026 09:30,04/01/2026 11:00',
      'ST-02,C1,Bad Date,XYZ999,BAD_DATE,04/01/2026 12:00'
    ].join('\n');
    const file = new File([csv], 'mixed.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    expect(batch.invalidRows).toBeGreaterThan(0);

    // Zero partial inserts — rollback semantics
    const reservationCount = await db.reservations.count();
    expect(reservationCount).toBe(0);
  });

  it('batch status is Failed and error rows are recorded', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,,ABC123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'missing-field.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    const rows = await db.importRows.where('batchId').equals(batch.id as number).toArray();
    expect(rows.some(r => r.errorCode === 'IMPORT_REQUIRED_FIELD_MISSING')).toBe(true);
  });

  // Dedupe: duplicate file hash is rejected
  it('duplicate file hash throws IMPORT_DUPLICATE_FILE', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'dedup.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    await expect(
      importService.startImport(file, 'reservations', map, actor, encryptionKey)
    ).rejects.toThrow('IMPORT_DUPLICATE_FILE');
  });

  // Row-level dedup: existing records are skipped
  it('skips duplicate rows matching existing records and counts them', async () => {
    const { actor, siteId, encryptionKey } = await setup();
    const bay = await db.bays.where('siteId').equals(siteId).first();
    await db.reservations.add({
      operationId: crypto.randomUUID(),
      bayId: bay?.id as number,
      siteId,
      userId: actor.id as number,
      customerName: 'existing',
      customerPlate: 'old',
      scheduledStart: new Date(2026, 3, 1, 9, 30).getTime(),
      scheduledEnd: new Date(2026, 3, 1, 11, 0).getTime(),
      status: 'Scheduled',
      noShowDeadline: new Date(2026, 3, 1, 9, 40).getTime(),
      version: 1
    });

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'dedup-row.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(batch.duplicateRows).toBe(1);
  });

  // Validation: order rate bounds
  it('rejects order with rate below minimum bound', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0001,1,60,0.001,0,test,note'
    ].join('\n');
    const file = new File([csv], 'low-rate.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    const rows = await db.importRows.where('batchId').equals(batch.id as number).toArray();
    expect(rows.some(r => r.errorCode === 'IMPORT_RATE_OUT_OF_BOUNDS')).toBe(true);
  });

  // Valid import succeeds
  it('valid CSV imports all rows successfully', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00',
      'ST-02,C1,Sam Lee,BCD234,04/01/2026 12:30,04/01/2026 13:30'
    ].join('\n');
    const file = new File([csv], 'valid.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(await db.reservations.count()).toBe(2);
  });
});
