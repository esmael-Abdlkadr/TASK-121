import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { importService } from '../services/importService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupForImport() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });

  const hash = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const userId = await db.users.add({
    username: 'manager',
    passwordHash: hash.hash,
    salt: hash.salt,
    role: 'SiteManager',
    siteId,
    failedAttempts: 0
  });

  await siteConfigService.bootstrapSiteConfig({
    siteId,
    tempLeaveMaxCount: 1,
    tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30,
    noShowGraceMinutes: 10,
    ratePerMinute: 0.5
  });

  const user = (await db.users.get(userId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Mgr01', user.salt);
  return { siteId, user, key };
}

function createCsvFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('Import encryption at rest', () => {
  beforeEach(resetDb);

  it('imported reservation customerName and customerPlate are encrypted in IndexedDB', async () => {
    const { user, key } = await setupForImport();

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alice Doe,PLATE123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');

    const file = createCsvFile(csv, 'reservations.csv');
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    await importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number, key);

    const reservations = await db.reservations.toArray();
    expect(reservations.length).toBe(1);

    // The stored values should NOT be plaintext
    expect(reservations[0].customerName).not.toBe('Alice Doe');
    expect(reservations[0].customerPlate).not.toBe('PLATE123');

    // They should be decryptable
    const decryptedName = await cryptoService.decryptField(reservations[0].customerName, key);
    const decryptedPlate = await cryptoService.decryptField(reservations[0].customerPlate, key);
    expect(decryptedName).toBe('Alice Doe');
    expect(decryptedPlate).toBe('PLATE123');
  });

  it('imported order invoiceNotes are encrypted in IndexedDB', async () => {
    const { user, key } = await setupForImport();

    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0001,100,90,0.50,0,none,Sensitive invoice note'
    ].join('\n');

    const file = createCsvFile(csv, 'orders.csv');
    const fieldMap = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', fieldMap, user, user.siteId as number, key);
    expect(batch.status).toBe('Complete');

    const orders = await db.orders.toArray();
    expect(orders.length).toBe(1);

    // The stored invoiceNotes should NOT be plaintext
    expect(orders[0].invoiceNotes).not.toBe('Sensitive invoice note');

    // It should be decryptable
    const decrypted = await cryptoService.decryptField(orders[0].invoiceNotes, key);
    expect(decrypted).toBe('Sensitive invoice note');
  });

  it('import without encryption key throws IMPORT_ENCRYPTION_KEY_REQUIRED for orders', async () => {
    const { user } = await setupForImport();

    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0002,101,60,0.50,0,none,Plain note'
    ].join('\n');

    const file = createCsvFile(csv, 'orders.csv');
    const fieldMap = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    await expect(
      importService.startImport(file, 'orders', fieldMap, user, user.siteId as number)
    ).rejects.toThrow('IMPORT_ENCRYPTION_KEY_REQUIRED');
  });

  it('import without encryption key throws IMPORT_ENCRYPTION_KEY_REQUIRED for reservations', async () => {
    const { user } = await setupForImport();

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alice Doe,PLATE123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');

    const file = createCsvFile(csv, 'reservations.csv');
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    await expect(
      importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number)
    ).rejects.toThrow('IMPORT_ENCRYPTION_KEY_REQUIRED');
  });
});
