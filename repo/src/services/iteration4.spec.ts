import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from './cryptoService';
import { orderService } from './orderService';
import { reservationService } from './reservationService';
import { sessionService } from './sessionService';
import { siteConfigService } from './siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupBase() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Main Site' });
  const bayId = await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });

  const adminHash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const mgrHash = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const attHash = await cryptoService.hashPassword('ChargeBay#Att01');
  const auditorHash = await cryptoService.hashPassword('ChargeBay#Aud01');

  const adminId = await db.users.add({
    username: 'sysadmin',
    passwordHash: adminHash.hash,
    salt: adminHash.salt,
    role: 'SystemAdministrator',
    failedAttempts: 0
  });
  const mgrId = await db.users.add({
    username: 'manager',
    passwordHash: mgrHash.hash,
    salt: mgrHash.salt,
    role: 'SiteManager',
    siteId,
    failedAttempts: 0
  });
  const attId = await db.users.add({
    username: 'attendant',
    passwordHash: attHash.hash,
    salt: attHash.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });
  const auditorId = await db.users.add({
    username: 'auditor',
    passwordHash: auditorHash.hash,
    salt: auditorHash.salt,
    role: 'Auditor',
    siteId,
    failedAttempts: 0
  });

  await siteConfigService.bootstrapSiteConfig({
    siteId,
    tempLeaveMaxCount: 1,
    tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30,
    noShowGraceMinutes: 10,
    ratePerMinute: 0.8
  });

  return {
    siteId,
    bayId,
    admin: (await db.users.get(adminId))!,
    manager: (await db.users.get(mgrId))!,
    attendant: (await db.users.get(attId))!,
    auditor: (await db.users.get(auditorId))!
  };
}

async function createActiveSession(
  actor: Awaited<ReturnType<typeof setupBase>>['attendant'],
  bayId: number,
  siteId: number
) {
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', actor.salt);
  const reservation = await reservationService.createReservation(
    {
      operationId: crypto.randomUUID(),
      bayId,
      siteId,
      userId: actor.id as number,
      customerName: 'Driver One',
      customerPlate: 'EV12345',
      scheduledStart: Date.now() + 60_000,
      scheduledEnd: Date.now() + 120 * 60_000
    },
    actor,
    key
  );
  const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
  return { reservation, session };
}

describe('Iteration 4 acceptance checks', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('completing session auto-generates draft order with correct amount', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await db.sessions_charging.update(session.id as number, { startedAt: Date.now() - 31 * 60_000 });

    await sessionService.completeSession(session.id as number, attendant);

    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    expect(order?.status).toBe('Draft');
    expect(order?.durationMinutes).toBeGreaterThanOrEqual(31);
    expect(order?.subtotal).toBe(Number(((order?.durationMinutes ?? 0) * 0.8).toFixed(2)));
    expect(order?.totalAmount).toBe(order?.subtotal);
  });

  it('order numbers are unique and sequential', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const first = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(first.session.id as number, attendant);

    const bay2 = await db.bays.add({
      siteId,
      stationId: 'ST-02',
      connectorId: 'C1',
      label: 'Bay 2',
      status: 'Available'
    });
    const second = await createActiveSession(attendant, bay2, siteId);
    await sessionService.completeSession(second.session.id as number, attendant);

    const orders = await db.orders.orderBy('id').toArray();
    expect(orders.length).toBe(2);
    expect(orders[0].orderNumber).not.toBe(orders[1].orderNumber);
    expect(orders[0].orderNumber.endsWith('0001')).toBe(true);
    expect(orders[1].orderNumber.endsWith('0002')).toBe(true);
  });

  it('standard order submit auto-approves from pending flow', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);

    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    await orderService.submitOrder(order?.id as number, attendant);
    const updated = await db.orders.get(order?.id as number);
    expect(updated?.status).toBe('Approved');
  });

  it('compensation order requires manager/admin approval', async () => {
    const { attendant, manager, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    await db.orders.update(order?.id as number, {
      billingType: 'Compensation',
      adjustmentAmount: -5,
      adjustmentReason: 'Operational issue'
    });

    await expect(orderService.submitOrder(order?.id as number, attendant)).rejects.toThrow(
      'ORDER_COMPENSATION_REQUIRES_APPROVAL'
    );

    await orderService.submitOrder(order?.id as number, manager);
    await orderService.approveCompensation(order?.id as number, manager);
    const updated = await db.orders.get(order?.id as number);
    expect(updated?.status).toBe('Approved');
    expect(updated?.compensationApprovedBy).toBe(manager.id);
  });

  it('attendant cannot approve compensation or refund', async () => {
    const { attendant, manager, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    await db.orders.update(order?.id as number, {
      billingType: 'Compensation',
      status: 'Pending',
      adjustmentAmount: -5,
      adjustmentReason: 'Issue'
    });

    await expect(orderService.approveCompensation(order?.id as number, attendant)).rejects.toThrow(
      'RBAC_SCOPE_VIOLATION'
    );

    await orderService.approveCompensation(order?.id as number, manager);
    await orderService.markPaid(order?.id as number, manager);
    await expect(orderService.refundOrder(order?.id as number, 'valid reason', attendant)).rejects.toThrow(
      'RBAC_SCOPE_VIOLATION'
    );
  });

  it('anomaly resolution complete bills; cancel does not bill', async () => {
    const { attendant, manager, bayId, siteId } = await setupBase();
    const first = await createActiveSession(attendant, bayId, siteId);
    await reservationService.flagAnomaly(first.session.id as number, 'No heartbeat for 30+ minutes', manager);
    await sessionService.resolveAnomaly(first.session.id as number, 'complete', 'Recovered and complete billing', manager);
    const completedOrder = await db.orders.where('sessionId').equals(first.session.id as number).first();
    expect(completedOrder).toBeTruthy();

    const bay2 = await db.bays.add({
      siteId,
      stationId: 'ST-03',
      connectorId: 'C1',
      label: 'Bay 3',
      status: 'Available'
    });
    const second = await createActiveSession(attendant, bay2, siteId);
    await reservationService.flagAnomaly(second.session.id as number, 'Temp leave duration exceeded', manager);
    await sessionService.resolveAnomaly(second.session.id as number, 'cancel', 'Unsafe continuation cancelled', manager);
    const canceledOrder = await db.orders.where('sessionId').equals(second.session.id as number).first();
    expect(canceledOrder).toBeUndefined();
  });

  it('writes audit logs for transitions and approvals', async () => {
    const { attendant, manager, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    await db.orders.update(order?.id as number, {
      billingType: 'Compensation',
      adjustmentAmount: -3,
      adjustmentReason: 'Service issue'
    });
    await orderService.submitOrder(order?.id as number, manager);
    await orderService.approveCompensation(order?.id as number, manager);

    const actions = (await db.auditLogs.toArray()).map((a) => a.action);
    expect(actions).toContain('SESSION_COMPLETED');
    expect(actions).toContain('ORDER_GENERATED');
    expect(actions).toContain('ORDER_SUBMITTED');
    expect(actions).toContain('COMPENSATION_APPROVED');
  });

  it('reconciliation can only be changed by system admin or site manager', async () => {
    const { attendant, admin, auditor, manager, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();

    await expect(
      orderService.setReconciliationStatus(order?.id as number, 'Matched', attendant)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
    await expect(
      orderService.setReconciliationStatus(order?.id as number, 'Matched', auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
    await orderService.setReconciliationStatus(order?.id as number, 'Matched', manager);
    await orderService.setReconciliationStatus(order?.id as number, 'Discrepancy', admin);

    const updated = await db.orders.get(order?.id as number);
    expect(updated?.reconciliationStatus).toBe('Discrepancy');
  });

  it('generateOrder is idempotent and returns existing order for duplicate operation id', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await sessionService.completeSession(session.id as number, attendant);

    const first = await orderService.generateOrder(session.id as number, attendant);
    const second = await orderService.generateOrder(session.id as number, attendant);
    expect(first.id).toBe(second.id);
    expect(first.operationId).toBe(second.operationId);
  });

  it('completeSession sends HOLD_AVAILABLE notification for the freed bay', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(attendant, bayId, siteId);
    await db.sessions_charging.update(session.id as number, { startedAt: Date.now() - 31 * 60_000 });

    await sessionService.completeSession(session.id as number, attendant);

    const holdNotifs = await db.notifications
      .where('templateKey')
      .equals('HOLD_AVAILABLE')
      .toArray();
    expect(holdNotifs.length).toBeGreaterThan(0);
    expect(holdNotifs[0].renderedBody).toContain(String(bayId));
  });

  it('autoProcessNoShows sends HOLD_AVAILABLE notification when bay is freed', async () => {
    const { attendant, bayId, siteId } = await setupBase();
    const now = Date.now();
    await db.reservations.add({
      operationId: crypto.randomUUID(),
      siteId,
      bayId,
      userId: attendant.id as number,
      customerName: 'enc:Jane',
      customerPlate: 'enc:ABC123',
      scheduledStart: now - 20 * 60_000,
      scheduledEnd: now + 40 * 60_000,
      noShowDeadline: now - 1,
      status: 'Scheduled',
      version: 1
    });

    await (await import('./reservationService')).reservationService.autoProcessNoShows(attendant);

    const holdNotifs = await db.notifications
      .where('templateKey')
      .equals('HOLD_AVAILABLE')
      .toArray();
    expect(holdNotifs.length).toBeGreaterThan(0);
    expect(holdNotifs[0].renderedBody).toContain(String(bayId));
  });

  it('resolveAnomaly cancel sends HOLD_AVAILABLE notification', async () => {
    const { manager, bayId, siteId } = await setupBase();
    const { session } = await createActiveSession(manager, bayId, siteId);
    await db.sessions_charging.update(session.id as number, {
      status: 'Anomaly',
      anomalyReason: 'Unverified Occupancy'
    });

    await sessionService.resolveAnomaly(
      session.id as number,
      'cancel',
      'Bay was empty after physical check',
      manager
    );

    const holdNotifs = await db.notifications
      .where('templateKey')
      .equals('HOLD_AVAILABLE')
      .toArray();
    expect(holdNotifs.length).toBeGreaterThan(0);
    expect(holdNotifs[0].renderedBody).toContain(String(bayId));
  });
});
