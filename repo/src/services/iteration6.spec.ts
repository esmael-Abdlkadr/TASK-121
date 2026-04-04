import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from './cryptoService';
import { importService } from './importService';
import { qualityService } from './qualityService';

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

describe('Iteration 6 acceptance checks', () => {
  const blobToText = async (blob: Blob) =>
    await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  beforeEach(async () => {
    localStorage.clear();
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: () => 'blob:test',
        writable: true
      });
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => {},
        writable: true
      });
    }
    await resetDb();
  });

  it('download template creates valid CSV blob with sample row', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    importService.downloadTemplate('reservations');
    expect(createSpy).toHaveBeenCalled();
    const blob = createSpy.mock.calls[0][0] as Blob;
    const text = await blobToText(blob);
    expect(text).toContain('stationId,connectorId,customerName');
    expect(text).toContain('ST-01,C1,Alex Doe');
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('invalid row rejects whole import and writes no data', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00',
      'ST-02,C1,Bad Date,XYZ999,BAD_DATE,04/01/2026 12:00'
    ].join('\n');
    const file = new File([csv], 'reservations.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    expect(await db.reservations.count()).toBe(0);
  });

  it('fully valid CSV imports rows in one transaction path', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00',
      'ST-02,C1,Sam Lee,BCD234,04/01/2026 12:30,04/01/2026 13:30'
    ].join('\n');
    const file = new File([csv], 'ok.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(await db.reservations.count()).toBe(2);
  });

  it('duplicate file hash throws IMPORT_DUPLICATE_FILE', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,Alex Doe,ABC123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'same.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    await expect(importService.startImport(file, 'reservations', map, actor, encryptionKey)).rejects.toThrow(
      'IMPORT_DUPLICATE_FILE'
    );
  });

  it('dedup keys are skipped and counted without failure', async () => {
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
    const file = new File([csv], 'dedup.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );
    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(batch.duplicateRows).toBe(1);
  });

  it('field mapping auto maps matching column names case-insensitive', async () => {
    const map = importService.autoMapFields(
      ['StationId', 'CONNECTORID', 'CustomerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );
    expect(map.StationId).toBe('stationId');
    expect(map.CONNECTORID).toBe('connectorId');
    expect(map.CustomerName).toBe('customerName');
  });

  it('weekly scheduler helper runs when last run older than 7 days', async () => {
    const { actor, siteId } = await setup();
    localStorage.setItem(`cb_quality_lastRun_${siteId}`, String(Date.now() - 8 * 24 * 60 * 60 * 1000));
    const ran = await qualityService.runWeeklyIfDue(siteId, actor);
    expect(ran).toBe(true);
    expect(await db.qualityReports.count()).toBe(1);
  });

  it('quality report stats and CSV export are generated', async () => {
    const { actor, siteId } = await setup();
    await db.orders.bulkAdd([
      {
        operationId: crypto.randomUUID(),
        sessionId: 1,
        siteId,
        orderNumber: 'ORD-1',
        status: 'Draft',
        billingType: 'Standard',
        durationMinutes: 10,
        ratePerMinute: 0.5,
        subtotal: 5,
        adjustmentAmount: 0,
        totalAmount: 5,
        invoiceNotes: 'x',
        reconciliationStatus: 'Unreconciled',
        version: 1
      },
      {
        operationId: crypto.randomUUID(),
        sessionId: 2,
        siteId,
        orderNumber: 'ORD-1',
        status: 'Draft',
        billingType: 'Standard',
        durationMinutes: 12,
        ratePerMinute: 0.5,
        subtotal: 6,
        adjustmentAmount: 0,
        totalAmount: 6,
        invoiceNotes: 'x',
        reconciliationStatus: 'Unreconciled',
        version: 1
      }
    ]);

    const report = await qualityService.runReport(siteId, actor);
    const detail = JSON.parse(report.detail) as {
      stats: Array<{ table: string; duplicateRows: number; completenessPct: number }>;
    };
    expect(detail.stats.find((s) => s.table === 'orders')?.duplicateRows).toBe(1);

    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    qualityService.exportReportCsv(report);
    const blob = createSpy.mock.calls[0][0] as Blob;
    const csv = await blobToText(blob);
    expect(csv).toContain('table,completeness_pct,total_rows,missing_field_rows,duplicate_rows');
    expect(clickSpy).toHaveBeenCalled();
    createSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('CSV import handles quoted fields containing commas', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,"Doe, Jane",ABC123,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'quoted.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(batch.totalRows).toBe(1);
  });

  it('CSV import handles quoted fields containing doubled-quote escapes', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,"O""Brien",XYZ999,04/02/2026 10:00,04/02/2026 12:00'
    ].join('\n');
    const file = new File([csv], 'escaped.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(batch.totalRows).toBe(1);
  });

  it('rejects order row with ratePerMinute below minimum bound (< 0.01)', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0001,1,60,0.001,0,test,note'
    ].join('\n');
    const file = new File([csv], 'orders-low-rate.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    const records = await db.importRows.where('batchId').equals(batch.id as number).toArray();
    expect(records.some((r) => r.errorCode === 'IMPORT_RATE_OUT_OF_BOUNDS')).toBe(true);
  });

  it('rejects order row with ratePerMinute above maximum bound (> 9999.99)', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0002,2,60,10000,0,test,note'
    ].join('\n');
    const file = new File([csv], 'orders-high-rate.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, actor, encryptionKey);
    expect(batch.status).toBe('Failed');
    const records = await db.importRows.where('batchId').equals(batch.id as number).toArray();
    expect(records.some((r) => r.errorCode === 'IMPORT_RATE_OUT_OF_BOUNDS')).toBe(true);
  });

  it('accepts order row with ratePerMinute within valid bounds', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0003,3,60,1.50,0,test,note'
    ].join('\n');
    const file = new File([csv], 'orders-valid-rate.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
  });

  it('CSV import handles multiline quoted cells without splitting the row', async () => {
    const { actor, encryptionKey } = await setup();
    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SITE-001-20260401-0009,100,90,0.5,0,Imported note,"Line one',
      'Line two"'
    ].join('\n');
    const file = new File([csv], 'multiline-orders.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      [
        'orderNumber',
        'sessionId',
        'durationMinutes',
        'ratePerMinute',
        'adjustmentAmount',
        'adjustmentReason',
        'invoiceNotes'
      ],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, actor, encryptionKey);
    expect(batch.status).toBe('Complete');
    expect(batch.totalRows).toBe(1);
  });
});
