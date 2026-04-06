import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { orderService } from '../services/orderService';
import { reservationService } from '../services/reservationService';
import { sessionService } from '../services/sessionService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupWithCompletedSession() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  const bayId = await db.bays.add({
    siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available'
  });
  await siteConfigService.bootstrapSiteConfig({
    siteId, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5
  });
  const hash = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const userId = await db.users.add({
    username: 'manager', passwordHash: hash.hash, salt: hash.salt,
    role: 'SiteManager', siteId, failedAttempts: 0
  });
  const actor = (await db.users.get(userId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Mgr01', actor.salt);

  const now = Date.now();
  const reservation = await reservationService.createReservation(
    {
      operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
      customerName: 'Order Test', customerPlate: 'ORD001',
      scheduledStart: now + 60_000, scheduledEnd: now + 120 * 60_000
    },
    actor, key
  );
  const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
  await sessionService.completeSession(session.id as number, actor);

  return { siteId, actor, key, sessionId: session.id as number };
}

describe('orderService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('generateOrder creates a Draft order for a completed session', async () => {
    const { sessionId, actor } = await setupWithCompletedSession();
    const order = await orderService.generateOrder(sessionId, actor);
    expect(order.status).toBe('Draft');
    expect(order.sessionId).toBe(sessionId);
    expect(order.durationMinutes).toBeGreaterThanOrEqual(1);
    expect(order.ratePerMinute).toBe(0.5);
  });

  it('generateOrder is idempotent — returns existing order on second call', async () => {
    const { sessionId, actor } = await setupWithCompletedSession();
    const first = await orderService.generateOrder(sessionId, actor);
    const second = await orderService.generateOrder(sessionId, actor);
    expect(second.id).toBe(first.id);
  });

  it('submitOrder transitions standard order to Approved', async () => {
    const { sessionId, actor } = await setupWithCompletedSession();
    const order = await orderService.generateOrder(sessionId, actor);
    await orderService.submitOrder(order.id as number, actor);
    const updated = await db.orders.get(order.id as number);
    expect(updated!.status).toBe('Approved');
  });

  it('setReconciliationStatus updates reconciliation field', async () => {
    const { sessionId, actor } = await setupWithCompletedSession();
    const order = await orderService.generateOrder(sessionId, actor);
    await orderService.setReconciliationStatus(order.id as number, 'Matched', actor);
    const updated = await db.orders.get(order.id as number);
    expect(updated!.reconciliationStatus).toBe('Matched');
  });

  it('refundOrder requires reason of at least 5 characters', async () => {
    const { sessionId, actor } = await setupWithCompletedSession();
    const order = await orderService.generateOrder(sessionId, actor);
    await expect(
      orderService.refundOrder(order.id as number, 'abc', actor)
    ).rejects.toThrow('ORDER_REFUND_REASON_REQUIRED');
  });
});
