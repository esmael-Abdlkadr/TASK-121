import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { exportService } from './exportService';
import { orderService } from './orderService';
import { tieringService } from './tieringService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function blobToText(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Main Site' });
  await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });
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
  return { siteId, actor };
}

describe('Iteration 7 acceptance checks', () => {
  beforeEach(async () => {
    localStorage.clear();
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true });
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    }
    await resetDb();
  });

  it('tiering moves >90 day records to cold and removes hot', async () => {
    const { siteId, actor } = await setup();
    const bay = await db.bays.where('siteId').equals(siteId).first();
    const old = Date.now() - 91 * 24 * 60 * 60 * 1000;
    await db.reservations.add({
      operationId: crypto.randomUUID(),
      bayId: bay?.id as number,
      siteId,
      userId: actor.id as number,
      customerName: 'x',
      customerPlate: 'x',
      scheduledStart: old,
      scheduledEnd: old + 60_000,
      status: 'Completed',
      noShowDeadline: old,
      version: 1
    });

    const result = await tieringService.runTiering(siteId, actor);
    expect(result.reservationsArchived).toBe(1);
    expect(await db.reservations.count()).toBe(0);
    expect(await db.reservations_cold.count()).toBe(1);
  });

  it('cold reservations are queryable', async () => {
    const { siteId, actor } = await setup();
    await db.reservations_cold.add({ bayId: 1, siteId, originalId: 10, archivedAt: Date.now() });
    const rows = await tieringService.queryColdReservations(siteId);
    expect(rows.length).toBe(1);
    expect(rows[0].originalId).toBe(10);
  });

  it('export and import package with correct password inserts records', async () => {
    const { siteId, actor } = await setup();
    const bay = await db.bays.where('siteId').equals(siteId).first();
    await db.reservations.add({
      operationId: crypto.randomUUID(),
      bayId: bay?.id as number,
      siteId,
      userId: actor.id as number,
      customerName: 'x',
      customerPlate: 'y',
      scheduledStart: Date.now(),
      scheduledEnd: Date.now() + 60_000,
      status: 'Scheduled',
      noShowDeadline: Date.now() + 10 * 60_000,
      version: 1
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(
      siteId,
      { from: Date.now() - 1_000_000, to: Date.now() + 1_000_000 },
      'secret-passphrase',
      actor
    );
    expect(clickSpy).toHaveBeenCalled();

    const json = await blobToText(blob);
    await db.reservations.clear();
    const file = new File([json], 'pkg.json', { type: 'application/json' });
    const result = await exportService.importPackage(file, 'secret-passphrase', actor);
    expect(result.inserted).toBeGreaterThan(0);
    expect(await db.reservations.count()).toBeGreaterThan(0);
    clickSpy.mockRestore();
  });

  it('wrong password throws EXPORT_SIGNATURE_MISMATCH', async () => {
    const { siteId, actor } = await setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(
      siteId,
      { from: Date.now() - 1_000, to: Date.now() + 1_000 },
      'right-password',
      actor
    );
    const json = await blobToText(blob);
    const file = new File([json], 'pkg.json', { type: 'application/json' });
    await expect(exportService.importPackage(file, 'wrong-password', actor)).rejects.toThrow(
      'EXPORT_SIGNATURE_MISMATCH'
    );
    clickSpy.mockRestore();
  });

  it('re-importing same package skips duplicates', async () => {
    const { siteId, actor } = await setup();
    await db.reservations.add({
      operationId: crypto.randomUUID(),
      bayId: 1,
      siteId,
      userId: actor.id as number,
      customerName: 'x',
      customerPlate: 'y',
      scheduledStart: Date.now(),
      scheduledEnd: Date.now() + 60_000,
      status: 'Scheduled',
      noShowDeadline: Date.now() + 10 * 60_000,
      version: 1
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(
      siteId,
      { from: Date.now() - 1_000_000, to: Date.now() + 1_000_000 },
      'secret-passphrase',
      actor
    );
    const json = await blobToText(blob);
    const file = new File([json], 'pkg.json', { type: 'application/json' });

    const first = await exportService.importPackage(file, 'secret-passphrase', actor);
    const second = await exportService.importPackage(file, 'secret-passphrase', actor);
    expect(first.inserted + first.skipped).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    clickSpy.mockRestore();
  });

  it('audit chain verify fails after tampering', async () => {
    const { actor } = await setup();
    await auditService.log(actor, 'A', 'X', '1');
    await auditService.log(actor, 'B', 'X', '2');
    expect(await auditService.verifyChain()).toBe(true);
    const first = await db.auditLogs.orderBy('id').first();
    await db.auditLogs.update(first?.id as number, { action: 'TAMPER' });
    expect(await auditService.verifyChain()).toBe(false);
  });

  it('bulk mark paid over 200 per minute throws RATE_LIMIT_EXCEEDED', async () => {
    const { siteId, actor } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 201; i += 1) {
      const id = await db.orders.add({
        operationId: crypto.randomUUID(),
        sessionId: i + 1,
        siteId,
        orderNumber: `ORD-${i}`,
        status: 'Approved',
        billingType: 'Standard',
        durationMinutes: 1,
        ratePerMinute: 1,
        subtotal: 1,
        adjustmentAmount: 0,
        totalAmount: 1,
        invoiceNotes: 'x',
        reconciliationStatus: 'Unreconciled',
        version: 1
      });
      ids.push(id);
    }

    await expect(orderService.bulkMarkPaid(ids, actor)).rejects.toThrow('RATE_LIMIT_EXCEEDED');
  });
});
