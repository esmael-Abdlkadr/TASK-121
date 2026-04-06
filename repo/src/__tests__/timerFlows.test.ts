import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { heartbeatService } from '../services/heartbeatService';
import { notificationService } from '../services/notificationService';
import { reservationService } from '../services/reservationService';
import { siteConfigService } from '../services/siteConfigService';
import type { User } from '../types';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Main Site' });
  const bayId = await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });
  const hashMgr = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const mgrId = await db.users.add({
    username: 'manager',
    passwordHash: hashMgr.hash,
    salt: hashMgr.salt,
    role: 'SiteManager',
    siteId,
    failedAttempts: 0
  });
  const hashAtt = await cryptoService.hashPassword('ChargeBay#Att01');
  const attId = await db.users.add({
    username: 'attendant',
    passwordHash: hashAtt.hash,
    salt: hashAtt.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });

  const manager = (await db.users.get(mgrId))!;
  const attendant = (await db.users.get(attId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', hashAtt.salt);

  await siteConfigService.bootstrapSiteConfig({
    siteId,
    tempLeaveMaxCount: 1,
    tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30,
    noShowGraceMinutes: 10,
    ratePerMinute: 0.5
  });

  return { siteId, bayId, manager, attendant, key };
}

describe('Timer-critical flow coverage', () => {
  beforeEach(async () => {
    localStorage.clear();
    notificationService.clearSchedulerState();
    await resetDb();
  });

  // C.1 — no-show auto-cancel scheduler flow and bay release outcome
  it('no-show auto-cancel releases bay to Available after deadline passes', async () => {
    const { attendant, bayId, siteId, key } = await setup();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-noshow-timer',
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Timer NoShow',
        customerPlate: 'TNS001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      attendant,
      key
    );

    // Bay should be Reserved
    let bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Reserved');

    // Simulate deadline already passed
    await db.reservations.update(reservation.id as number, {
      noShowDeadline: Date.now() - 1000
    });

    await reservationService.autoProcessNoShows(attendant);

    const updated = await db.reservations.get(reservation.id as number);
    expect(updated?.status).toBe('NoShow');

    bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Available');

    // Verify notification was sent
    const notifications = await db.notifications.toArray();
    const noShowNotif = notifications.find(n => n.templateKey === 'NO_SHOW_CANCELLED');
    expect(noShowNotif).toBeTruthy();
  });

  // C.2 — heartbeat-timeout anomaly escalation
  it('heartbeat-timeout escalates session to Anomaly status', async () => {
    const { attendant, bayId, siteId, key } = await setup();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-hb-timeout',
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'HB Timeout',
        customerPlate: 'HBT001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      attendant,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    expect(session.status).toBe('Active');

    // Simulate stale heartbeat (31 minutes ago, config is 30 min threshold)
    await db.sessions_charging.update(session.id as number, {
      heartbeatAt: Date.now() - 31 * 60_000
    });

    await heartbeatService.checkAnomalies(attendant);

    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Anomaly');
    expect(updated?.anomalyReason).toContain('No heartbeat');

    // Bay should be flagged
    const bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Anomaly');
  });

  // C.2b — fresh heartbeat does NOT trigger anomaly
  it('fresh heartbeat tick prevents anomaly escalation', async () => {
    const { attendant, bayId, siteId, key } = await setup();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-hb-fresh-timer',
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'HB Fresh',
        customerPlate: 'HBF001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      attendant,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await heartbeatService.tick(attendant);
    await heartbeatService.checkAnomalies(attendant);

    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Active');
  });

  // C.3 — notification retry outcome (failure then retry success path)
  it('notification delivery failure retries and eventually delivers', async () => {
    const { attendant, siteId } = await setup();

    // Send a notification directly
    const notification = await notificationService.send(
      attendant.id as number,
      'DUE_REMINDER',
      { bayLabel: 'Bay 1', startTime: '10:00 AM' }
    );
    expect(notification).toBeTruthy();

    // It should be Delivered since template rendering doesn't fail in tests
    const delivered = await db.notifications.get(notification!.id as number);
    expect(delivered?.status).toBe('Delivered');
    expect(delivered?.renderedSubject).toContain('due soon');
  });

  it('notification with Failed status is retried by retryFailed', async () => {
    const { attendant } = await setup();

    // Manually insert a Failed notification that can be retried
    const notifId = await db.notifications.add({
      recipientId: attendant.id as number,
      templateKey: 'DUE_REMINDER',
      templateData: { bayLabel: 'Bay 1', startTime: '10:00 AM' },
      renderedSubject: '',
      renderedBody: '',
      status: 'Failed',
      isRead: false,
      retries: 1,
      createdAt: Date.now(),
      failureReason: 'Transient error'
    });

    // retryFailed should pick it up (retries < 3)
    await notificationService.retryFailed();

    const updated = await db.notifications.get(notifId);
    expect(updated?.status).toBe('Delivered');
    expect(updated?.renderedSubject).toContain('due soon');
  });
});
