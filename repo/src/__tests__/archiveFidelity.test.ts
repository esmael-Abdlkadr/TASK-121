/**
 * Archive fidelity tests.
 * Verifies that tiering preserves full business payload in cold tables,
 * and that export/import packages round-trip the full archived content.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { exportService } from '../services/exportService';
import { tieringService } from '../services/tieringService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  const bayId = await db.bays.add({
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
  return { siteId, bayId, actor };
}

async function blobToText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const OLD = Date.now() - 91 * 24 * 60 * 60 * 1000;

describe('Archive fidelity', () => {
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

  it('tiering copies full reservation payload to cold table', async () => {
    const { siteId, bayId, actor } = await setup();
    await db.reservations.add({
      operationId: 'op-1',
      bayId,
      siteId,
      userId: actor.id as number,
      customerName: 'Alice Doe',
      customerPlate: 'PLATE99',
      scheduledStart: OLD,
      scheduledEnd: OLD + 60_000,
      status: 'Completed',
      noShowDeadline: OLD,
      version: 3
    });

    await tieringService.runTiering(siteId, actor);

    const coldRows = await db.reservations_cold.where('siteId').equals(siteId).toArray();
    expect(coldRows.length).toBe(1);
    const cold = coldRows[0];

    // Payload fields preserved
    expect(cold.customerName).toBe('Alice Doe');
    expect(cold.customerPlate).toBe('PLATE99');
    expect(cold.operationId).toBe('op-1');
    expect(cold.status).toBe('Completed');
    expect(cold.version).toBe(3);
    expect(cold.scheduledStart).toBe(OLD);

    // Archive metadata present
    expect(cold.originalId).toBeTypeOf('number');
    expect(cold.archivedAt).toBeTypeOf('number');

    // Hot table is empty
    expect(await db.reservations.count()).toBe(0);
  });

  it('tiering copies full session payload to cold table', async () => {
    const { siteId, bayId, actor } = await setup();
    const resId = await db.reservations.add({
      operationId: 'op-2',
      bayId,
      siteId,
      userId: actor.id as number,
      customerName: 'Bob',
      customerPlate: 'X',
      scheduledStart: OLD,
      scheduledEnd: OLD + 60_000,
      status: 'Completed',
      noShowDeadline: OLD,
      version: 1
    });
    await db.sessions_charging.add({
      reservationId: resId,
      bayId,
      siteId,
      startedAt: OLD,
      endedAt: OLD + 3600_000,
      status: 'Completed',
      heartbeatAt: OLD,
      tempLeaveCount: 2,
      version: 5
    });

    await tieringService.runTiering(siteId, actor);

    const coldSessions = await db.sessions_cold.where('siteId').equals(siteId).toArray();
    expect(coldSessions.length).toBe(1);
    const cold = coldSessions[0];

    expect(cold.reservationId).toBe(resId);
    expect(cold.tempLeaveCount).toBe(2);
    expect(cold.status).toBe('Completed');
    expect(cold.version).toBe(5);
    expect(cold.startedAt).toBe(OLD);
    expect(cold.originalId).toBeTypeOf('number');
  });

  it('tiering copies full order payload to cold table', async () => {
    const { siteId, actor } = await setup();
    // orders_cold is filtered by createdAt; set it to OLD
    await db.orders.add({
      operationId: 'op-3',
      sessionId: 42,
      siteId,
      createdAt: OLD,
      orderNumber: 'CB-OLD-001',
      status: 'Paid',
      billingType: 'Standard',
      durationMinutes: 90,
      ratePerMinute: 0.5,
      subtotal: 45,
      adjustmentAmount: 0,
      totalAmount: 45,
      invoiceNotes: 'Sensitive invoice note',
      reconciliationStatus: 'Matched',
      version: 2
    });

    await tieringService.runTiering(siteId, actor);

    const coldOrders = await db.orders_cold.where('siteId').equals(siteId).toArray();
    expect(coldOrders.length).toBe(1);
    const cold = coldOrders[0];

    expect(cold.orderNumber).toBe('CB-OLD-001');
    expect(cold.durationMinutes).toBe(90);
    expect(cold.totalAmount).toBe(45);
    expect(cold.reconciliationStatus).toBe('Matched');
    expect(cold.invoiceNotes).toBe('Sensitive invoice note');
    expect(cold.status).toBe('Paid');
    expect(cold.version).toBe(2);
    expect(cold.originalId).toBeTypeOf('number');
  });

  it('export package includes full cold-record payloads after tiering', async () => {
    const { siteId, bayId, actor } = await setup();
    await db.reservations.add({
      operationId: 'op-export',
      bayId,
      siteId,
      userId: actor.id as number,
      customerName: 'Carol',
      customerPlate: 'EXPORT1',
      scheduledStart: OLD,
      scheduledEnd: OLD + 60_000,
      status: 'Completed',
      noShowDeadline: OLD,
      version: 1
    });

    await tieringService.runTiering(siteId, actor);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(
      siteId,
      { from: OLD - 1000, to: Date.now() + 1000 },
      'test-password',
      actor
    );
    clickSpy.mockRestore();

    const json = await blobToText(blob);
    // Decrypt and inspect the package
    await db.reservations_cold.clear();
    const file = new File([json], 'pkg.json', { type: 'application/json' });
    const result = await exportService.importPackage(file, 'test-password', actor);

    expect(result.inserted).toBeGreaterThan(0);

    // Verify full payload was preserved through export/import
    const restoredCold = await db.reservations_cold.where('siteId').equals(siteId).toArray();
    expect(restoredCold.length).toBeGreaterThan(0);
    const restored = restoredCold[0];
    expect(restored.customerName).toBe('Carol');
    expect(restored.customerPlate).toBe('EXPORT1');
    expect(restored.status).toBe('Completed');
  });

  it('auditor cannot run tiering (service-level RBAC)', async () => {
    const { siteId } = await setup();
    const auditorHash = await cryptoService.hashPassword('ChargeBay#Aud01');
    const auditorId = await db.users.add({
      username: 'auditor',
      passwordHash: auditorHash.hash,
      salt: auditorHash.salt,
      role: 'Auditor',
      siteId,
      failedAttempts: 0
    });
    const auditor = (await db.users.get(auditorId))!;
    await expect(tieringService.runTiering(siteId, auditor)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('actor with different siteId cannot run tiering for another site', async () => {
    const { siteId, actor } = await setup();
    const otherSiteId = await db.sites.add({ siteCode: 'SITE-999', name: 'Other Site' });
    const managerHash = await cryptoService.hashPassword('ChargeBay#Mgr01');
    const managerId = await db.users.add({
      username: 'manager',
      passwordHash: managerHash.hash,
      salt: managerHash.salt,
      role: 'SiteManager',
      siteId,
      failedAttempts: 0
    });
    const manager = (await db.users.get(managerId))!;
    // Manager has siteId=siteId, trying to tier otherSiteId → scope violation
    await expect(tieringService.runTiering(otherSiteId, manager)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });
});
