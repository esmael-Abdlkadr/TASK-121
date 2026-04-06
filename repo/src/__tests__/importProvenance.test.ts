/**
 * Import provenance tests.
 * Verifies that imported records carry importBatchId AND importRowId so the
 * raw → cleaned → billing lineage is traceable end-to-end through
 * ImportBatch → ImportRow → Reservation → ChargingSession → Order,
 * including after reconciliation updates.
 *
 * Every assertion on row-level provenance must be earned by the real
 * production code path — no manual DB patching to inject lineage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { importService } from '../services/importService';
import { orderService } from '../services/orderService';
import { reservationService } from '../services/reservationService';
import { sessionService } from '../services/sessionService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupForImport() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({ siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });
  await db.bays.add({ siteId, stationId: 'ST-02', connectorId: 'C1', label: 'Bay 2', status: 'Available' });
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

describe('Import provenance (raw → cleaned → billing lineage)', () => {
  beforeEach(resetDb);

  // ─── Reservation import: batch + row provenance ──────────────────────────

  it('imported reservation carries importBatchId AND importRowId', async () => {
    const { user, key } = await setupForImport();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alice Doe,PLATE01,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'reservations.csv', { type: 'text/csv' });
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number, key);
    expect(batch.status).toBe('Complete');

    const reservations = await db.reservations.toArray();
    expect(reservations.length).toBe(1);
    expect(reservations[0].importBatchId).toBe(batch.id);
    expect(reservations[0].importRowId).toBe(1);
  });

  // ─── Order import: batch + row provenance ────────────────────────────────

  it('imported order carries importBatchId AND importRowId', async () => {
    const { user, key } = await setupForImport();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-001,100,60,0.50,0,none,Test note'
    ].join('\n');
    const file = new File([csv], 'orders.csv', { type: 'text/csv' });
    const fieldMap = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', fieldMap, user, user.siteId as number, key);
    expect(batch.status).toBe('Complete');

    const orders = await db.orders.toArray();
    expect(orders.length).toBe(1);
    expect(orders[0].importBatchId).toBe(batch.id);
    expect(orders[0].importRowId).toBe(1);
  });

  // ─── ImportBatch → ImportRow → Reservation row-level linkage ─────────────

  it('ImportBatch → ImportRow → Reservation: importRowId matches ImportRow.rowIndex', async () => {
    const { user, key } = await setupForImport();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Carol Smith,PLATE02,04/01/2026 12:00,04/01/2026 13:00'
    ].join('\n');
    const file = new File([csv], 'reservations.csv', { type: 'text/csv' });
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number, key);
    const batchId = batch.id as number;

    const importRow = (await db.importRows.where('batchId').equals(batchId).first())!;
    expect(importRow.status).toBe('Imported');

    const reservation = (await db.reservations.filter((r) => r.importBatchId === batchId).first())!;
    expect(reservation.importBatchId).toBe(batchId);
    expect(reservation.importRowId).toBe(importRow.rowIndex);
  });

  // ─── Reservation-import full chain: row-level provenance to billing ──────

  it('Reservation import → confirmArrival → completeSession → Order: exact importRowId preserved through billing', async () => {
    const { user, key } = await setupForImport();

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Prov Driver,PROV01,04/01/2026 08:00,04/01/2026 09:00'
    ].join('\n');
    const file = new File([csv], 'prov_res.csv', { type: 'text/csv' });
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );
    const batch = await importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number, key);
    const batchId = batch.id as number;

    // Reservation has both batch and row provenance from the import.
    const reservation = (await db.reservations.filter((r) => r.importBatchId === batchId).first())!;
    expect(reservation.importBatchId).toBe(batchId);
    expect(reservation.importRowId).toBe(1);

    // confirmArrival propagates BOTH importBatchId AND importRowId to the session.
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', user);
    expect(session.importBatchId).toBe(batchId);
    expect(session.importRowId).toBe(1);

    // completeSession → generateOrder propagates both to the order.
    await sessionService.completeSession(session.id as number, user);
    const order = (await db.orders.where('sessionId').equals(session.id as number).first())!;
    expect(order.importBatchId).toBe(batchId);
    expect(order.importRowId).toBe(1);
    expect(order.reconciliationStatus).toBe('Unreconciled');

    // Reconciliation does not sever row-level provenance.
    await orderService.setReconciliationStatus(order.id as number, 'Matched', user);
    const reconciled = (await db.orders.get(order.id as number))!;
    expect(reconciled.reconciliationStatus).toBe('Matched');
    expect(reconciled.importBatchId).toBe(batchId);
    expect(reconciled.importRowId).toBe(1);

    // Resolve the linked ImportRow from the final billing record.
    const linkedRow = (await db.importRows
      .where('batchId')
      .equals(reconciled.importBatchId as number)
      .filter((r) => r.rowIndex === reconciled.importRowId)
      .first())!;
    expect(linkedRow).toBeTruthy();
    expect(linkedRow.status).toBe('Imported');
    expect(linkedRow.rawData).toBeTruthy();
    expect(linkedRow.cleanedData).toBeTruthy();
  });

  // ─── Sessions-import full chain: row-level provenance to billing ─────────

  it('Sessions import → completeSession → Order: exact importRowId preserved through billing', async () => {
    const { user, key } = await setupForImport();

    // Seed a reservation to reference from the session import.
    const now = Date.now();
    const resStart = now + 2 * 60_000;
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId: (await db.bays.toCollection().first())!.id as number,
        siteId: user.siteId as number,
        userId: user.id as number,
        customerName: 'Session Import Driver',
        customerPlate: 'SIMP01',
        scheduledStart: resStart,
        scheduledEnd: resStart + 60 * 60_000
      },
      user,
      key
    );

    // Import a session via the real sessions import flow.
    const sessionCsv = [
      'reservationId,startedAt',
      `${reservation.id as number},04/01/2026 09:00`
    ].join('\n');
    const sessionFile = new File([sessionCsv], 'sessions.csv', { type: 'text/csv' });
    const sessionFieldMap = importService.autoMapFields(['reservationId', 'startedAt'], 'sessions');
    const sessionBatch = await importService.startImport(sessionFile, 'sessions', sessionFieldMap, user, user.siteId as number);
    const sessionBatchId = sessionBatch.id as number;

    // The imported session carries both importBatchId and importRowId.
    const importedSession = (await db.sessions_charging
      .where('reservationId')
      .equals(reservation.id as number)
      .first())!;
    expect(importedSession.importBatchId).toBe(sessionBatchId);
    expect(importedSession.importRowId).toBe(1);

    // completeSession → generateOrder propagates both to the order.
    await sessionService.completeSession(importedSession.id as number, user);
    const order = (await db.orders.where('sessionId').equals(importedSession.id as number).first())!;
    expect(order.importBatchId).toBe(sessionBatchId);
    expect(order.importRowId).toBe(1);
    expect(order.reconciliationStatus).toBe('Unreconciled');

    // Reconciliation does not erase row-level provenance.
    await orderService.setReconciliationStatus(order.id as number, 'Matched', user);
    const reconciled = (await db.orders.get(order.id as number))!;
    expect(reconciled.reconciliationStatus).toBe('Matched');
    expect(reconciled.importBatchId).toBe(sessionBatchId);
    expect(reconciled.importRowId).toBe(1);

    // Resolve the linked ImportRow from the final billing record.
    const linkedRow = (await db.importRows
      .where('batchId')
      .equals(reconciled.importBatchId as number)
      .filter((r) => r.rowIndex === reconciled.importRowId)
      .first())!;
    expect(linkedRow).toBeTruthy();
    expect(linkedRow.status).toBe('Imported');
  });

  // ─── Multi-row batch: per-row disambiguation ────────────────────────────

  it('multi-row batch: each final order traces to its exact source row, not just the batch', async () => {
    const { user, key } = await setupForImport();

    // Import two reservations in one batch — different bays, different times.
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Row One,PLATE-R1,04/01/2026 08:00,04/01/2026 09:00',
      'ST-02,C1,Row Two,PLATE-R2,04/01/2026 10:00,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'multi.csv', { type: 'text/csv' });
    const fieldMap = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );
    const batch = await importService.startImport(file, 'reservations', fieldMap, user, user.siteId as number, key);
    const batchId = batch.id as number;
    expect(batch.status).toBe('Complete');

    // Two reservations, each with a distinct importRowId.
    const reservations = await db.reservations
      .filter((r) => r.importBatchId === batchId)
      .sortBy('importRowId');
    expect(reservations.length).toBe(2);
    expect(reservations[0].importRowId).toBe(1);
    expect(reservations[1].importRowId).toBe(2);

    // Walk both through the full lifecycle independently.
    const session1 = await reservationService.confirmArrival(reservations[0].id as number, 'manual', user);
    const session2 = await reservationService.confirmArrival(reservations[1].id as number, 'manual', user);
    expect(session1.importRowId).toBe(1);
    expect(session2.importRowId).toBe(2);

    await sessionService.completeSession(session1.id as number, user);
    await sessionService.completeSession(session2.id as number, user);

    const order1 = (await db.orders.where('sessionId').equals(session1.id as number).first())!;
    const order2 = (await db.orders.where('sessionId').equals(session2.id as number).first())!;

    // Each order points to the SAME batch but a DIFFERENT row.
    expect(order1.importBatchId).toBe(batchId);
    expect(order1.importRowId).toBe(1);
    expect(order2.importBatchId).toBe(batchId);
    expect(order2.importRowId).toBe(2);

    // After reconciliation, row identity is still intact.
    await orderService.setReconciliationStatus(order1.id as number, 'Matched', user);
    await orderService.setReconciliationStatus(order2.id as number, 'Discrepancy', user);

    const rec1 = (await db.orders.get(order1.id as number))!;
    const rec2 = (await db.orders.get(order2.id as number))!;
    expect(rec1.importRowId).toBe(1);
    expect(rec2.importRowId).toBe(2);

    // Resolve each to its exact ImportRow — proves disambiguation.
    const row1 = (await db.importRows
      .where('batchId')
      .equals(batchId)
      .filter((r) => r.rowIndex === rec1.importRowId)
      .first())!;
    const row2 = (await db.importRows
      .where('batchId')
      .equals(batchId)
      .filter((r) => r.rowIndex === rec2.importRowId)
      .first())!;

    expect(row1.rowIndex).toBe(1);
    expect(row2.rowIndex).toBe(2);
    // Raw data from each row differs — the rows are distinguishable.
    expect(row1.rawData).not.toBe(row2.rawData);
  });
});
