import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from './cryptoService';
import { notificationService } from './notificationService';
import { orderService } from './orderService';
import { reservationService } from './reservationService';
import { sessionService } from './sessionService';
import { siteConfigService } from './siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupUsersAndSite() {
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
  const audId = await db.users.add({
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
    ratePerMinute: 0.5
  });

  return {
    siteId,
    bayId,
    admin: (await db.users.get(adminId))!,
    manager: (await db.users.get(mgrId))!,
    attendant: (await db.users.get(attId))!,
    auditor: (await db.users.get(audId))!
  };
}

describe('Iteration 5 acceptance checks', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    localStorage.clear();
    notificationService.clearSchedulerState();
    await resetDb();
  });

  it('DUE_REMINDER fires 15 minutes before reservation start', async () => {
    const { siteId, bayId, attendant, manager } = await setupUsersAndSite();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);

    await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Driver',
        customerPlate: 'AA123',
        scheduledStart: Date.now() + 15 * 60_000,
        scheduledEnd: Date.now() + 45 * 60_000
      },
      attendant,
      key
    );

    await notificationService.runDueAndOverdueSchedulers(manager);
    const due = await db.notifications.where('templateKey').equals('DUE_REMINDER').toArray();
    expect(due.length).toBeGreaterThan(0);
  });

  it('OVERDUE_ALERT fires at +5 minutes if still scheduled', async () => {
    const { siteId, bayId, attendant, manager } = await setupUsersAndSite();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);

    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Late Driver',
        customerPlate: 'BB123',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 30 * 60_000
      },
      attendant,
      key
    );

    await db.reservations.update(reservation.id as number, {
      scheduledStart: Date.now() - 6 * 60_000
    });

    await notificationService.runDueAndOverdueSchedulers(manager);
    const overdue = await db.notifications.where('templateKey').equals('OVERDUE_ALERT').toArray();
    expect(overdue.length).toBeGreaterThan(0);
  });

  it('failed notification retries up to 3 then stays failed', async () => {
    const { attendant } = await setupUsersAndSite();

    const id = await db.notifications.add({
      recipientId: attendant.id as number,
      templateKey: 'DUE_REMINDER',
      templateData: {},
      renderedSubject: '',
      renderedBody: '',
      status: 'Pending',
      isRead: false,
      retries: 0,
      createdAt: Date.now()
    });

    const original = notificationService.TEMPLATES.DUE_REMINDER;
    (notificationService.TEMPLATES as Record<string, unknown>).DUE_REMINDER = undefined;
    const timeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

    try {
      await notificationService.deliver(id);
      await notificationService.deliver(id);
      await notificationService.deliver(id);

      const row = await db.notifications.get(id);
      expect(row?.status).toBe('Failed');
      expect(row?.retries).toBe(3);
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    } finally {
      timeoutSpy.mockRestore();
      (notificationService.TEMPLATES as Record<string, unknown>).DUE_REMINDER = original;
    }
  });

  it('Retry Now manually re-attempts a failed notification', async () => {
    const { attendant } = await setupUsersAndSite();
    const id = await db.notifications.add({
      recipientId: attendant.id as number,
      templateKey: 'IMPORT_COMPLETE',
      templateData: { rowCount: '12' },
      renderedSubject: '',
      renderedBody: '',
      status: 'Failed',
      isRead: false,
      retries: 2,
      createdAt: Date.now()
    });

    await notificationService.manualRetry(id);
    const row = await db.notifications.get(id);
    expect(row?.status).toBe('Delivered');
  });

  it('disabled DUE_REMINDER preference skips sending', async () => {
    const { attendant } = await setupUsersAndSite();
    const prefs = notificationService.getPrefs(attendant.id as number);
    prefs.enabled.DUE_REMINDER = false;
    notificationService.savePrefs(prefs);

    const sent = await notificationService.send(attendant.id as number, 'DUE_REMINDER', {
      bayLabel: 'Bay 1',
      startTime: '10:00'
    });
    expect(sent).toBeNull();
  });

  it('read/unread/archive persist after refresh-like reload', async () => {
    const { attendant } = await setupUsersAndSite();
    const row = await notificationService.send(attendant.id as number, 'IMPORT_COMPLETE', { rowCount: '5' });
    await notificationService.markRead(row?.id as number, attendant);
    await notificationService.archive(row?.id as number, attendant);

    const inboxAgain = await notificationService.getInbox(attendant.id as number);
    const updated = inboxAgain.find((n) => n.id === row?.id);
    expect(updated?.isRead).toBe(true);
    expect(updated?.status).toBe('Archived');
  });

  it('auditor sees send log and attendant does not', async () => {
    const { attendant, auditor } = await setupUsersAndSite();
    await notificationService.send(attendant.id as number, 'IMPORT_COMPLETE', { rowCount: '5' });
    const auditorLog = await notificationService.getSendLog(auditor);
    expect(auditorLog.length).toBeGreaterThan(0);
    await expect(notificationService.getSendLog(attendant)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('APPROVAL_OUTCOME sent when compensation approved/rejected', async () => {
    const { siteId, bayId, attendant, manager } = await setupUsersAndSite();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);

    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Comp User',
        customerPlate: 'CC123',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 30 * 60_000
      },
      attendant,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await sessionService.completeSession(session.id as number, attendant);

    const order = await db.orders.where('sessionId').equals(session.id as number).first();
    await db.orders.update(order?.id as number, {
      billingType: 'Compensation',
      adjustmentAmount: -2,
      adjustmentReason: 'Goodwill'
    });
    await orderService.submitOrder(order?.id as number, manager);
    await orderService.approveCompensation(order?.id as number, manager);
    await db.orders.update(order?.id as number, { status: 'Pending' });
    await orderService.rejectCompensation(order?.id as number, 'Need more details', manager);

    const outcomes = await db.notifications.where('templateKey').equals('APPROVAL_OUTCOME').toArray();
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
  });
});
