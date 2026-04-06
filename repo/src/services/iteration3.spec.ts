import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from './cryptoService';
import { heartbeatService } from './heartbeatService';
import { parseDate } from './importService';
import { reservationService, BayConflictError, TempLeaveLimitError } from './reservationService';
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
  const hashAdmin = await cryptoService.hashPassword('ChargeBay#Admin1');
  const hashAtt = await cryptoService.hashPassword('ChargeBay#Att01');
  const adminId = await db.users.add({
    username: 'sysadmin',
    passwordHash: hashAdmin.hash,
    salt: hashAdmin.salt,
    role: 'SystemAdministrator',
    failedAttempts: 0
  });
  const attId = await db.users.add({
    username: 'attendant',
    passwordHash: hashAtt.hash,
    salt: hashAtt.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });

  const actor = (await db.users.get(attId))!;
  const admin = (await db.users.get(adminId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', actor.salt);
  return { siteId, bayId, actor, admin, key };
}

describe('Iteration 3 acceptance checks', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('creates reservation and marks bay reserved', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-1',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Alex Doe',
        customerPlate: 'EV12345',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    expect(reservation.status).toBe('Scheduled');
    const bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Reserved');
  });

  it('manual confirmation occupies bay and creates charging session', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-2',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Sam Doe',
        customerPlate: 'PLATE22',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    expect(session.status).toBe('Active');
    const bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Occupied');
  });

  it('qr confirmation validates operation id end to end', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-qr',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Jordan Ray',
        customerPlate: 'PLATEQR',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    await expect(
      reservationService.confirmArrival(
        reservation.id as number,
        'qr',
        actor,
        JSON.stringify({ reservationId: reservation.id, operationId: 'bad', siteCode: 'SITE-001' })
      )
    ).rejects.toThrow('RES_QR_MISMATCH');

    const session = await reservationService.confirmArrival(
      reservation.id as number,
      'qr',
      actor,
      JSON.stringify({ reservationId: reservation.id, operationId: 'op-qr', siteCode: 'SITE-001' })
    );
    expect(session.status).toBe('Active');
  });

  it('auto no-show marks no-show and frees bay', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-noshow',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'No Show',
        customerPlate: 'NO123',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    await db.reservations.update(reservation.id as number, { noShowDeadline: Date.now() - 1000 });
    await reservationService.autoProcessNoShows(actor);

    const updated = await db.reservations.get(reservation.id as number);
    expect(updated?.status).toBe('NoShow');
    const bay = await db.bays.get(bayId);
    expect(bay?.status).toBe('Available');
  });

  it('rejects second temp leave when max count is one', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-temp',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Temp Leave',
        customerPlate: 'TEMP1',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    await reservationService.startTempLeave(session.id as number, actor);
    await reservationService.endTempLeave(session.id as number, actor);

    await expect(reservationService.startTempLeave(session.id as number, actor)).rejects.toBeInstanceOf(
      TempLeaveLimitError
    );
  });

  it('flags session as Anomaly when temp-leave count limit is exceeded', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-templeave-anomaly',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Anomaly User',
        customerPlate: 'ANOM01',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    // Use the one allowed temp leave
    await reservationService.startTempLeave(session.id as number, actor);
    await reservationService.endTempLeave(session.id as number, actor);

    // Second startTempLeave exceeds the count limit — must flag anomaly before throwing
    await expect(reservationService.startTempLeave(session.id as number, actor)).rejects.toBeInstanceOf(
      TempLeaveLimitError
    );

    // Session must now be in Anomaly state
    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Anomaly');
  });

  it('flags anomaly after heartbeat timeout', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-heartbeat',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Heartbeat',
        customerPlate: 'HB1234',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    await db.sessions_charging.update(session.id as number, {
      heartbeatAt: Date.now() - 31 * 60_000
    });

    await heartbeatService.checkAnomalies(actor);

    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Anomaly');
  });

  it('is idempotent for duplicate operation id and catches bay conflict', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    const payload = {
      operationId: 'op-idem',
      bayId,
      siteId,
      userId: actor.id as number,
      customerName: 'Idem User',
      customerPlate: 'IDM123',
      scheduledStart: Date.now() + 60_000,
      scheduledEnd: Date.now() + 3_600_000
    };

    const first = await reservationService.createReservation(payload, actor, key);
    const second = await reservationService.createReservation(payload, actor, key);
    expect(first.id).toBe(second.id);

    await expect(
      reservationService.createReservation(
        { ...payload, operationId: 'op-conflict', scheduledStart: Date.now() + 120_000 },
        actor,
        key
      )
    ).rejects.toBeInstanceOf(BayConflictError);
  });

  it('writes audit logs for reservation transitions', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-audit',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Audit User',
        customerPlate: 'AUD123',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    await reservationService.startTempLeave(session.id as number, actor);
    await reservationService.endTempLeave(session.id as number, actor);

    const actions = (await db.auditLogs.toArray()).map((log) => log.action);
    expect(actions).toContain('RESERVATION_CREATED');
    expect(actions).toContain('ARRIVAL_CONFIRMED');
    expect(actions).toContain('TEMP_LEAVE_STARTED');
    expect(actions).toContain('TEMP_LEAVE_ENDED');
  });

  // CHB-H-001 regression: active sessions must NOT be escalated when heartbeat is being maintained.
  it('active session stays non-anomalous when heartbeat tick keeps it fresh', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-hb-fresh',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Fresh Heartbeat',
        customerPlate: 'FH0001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);

    // Simulate the periodic tick keeping heartbeatAt current (heartbeat is fresh).
    await heartbeatService.tick(actor);

    // Running anomaly check should NOT escalate a freshly-ticked session.
    await heartbeatService.checkAnomalies(actor);

    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Active');
  });

  // Verify existing stale-heartbeat test still passes (regression guard).
  it('active session is escalated when heartbeat is genuinely stale', async () => {
    const { actor, bayId, siteId, key } = await setupBase();
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const reservation = await reservationService.createReservation(
      {
        operationId: 'op-hb-stale',
        bayId,
        siteId,
        userId: actor.id as number,
        customerName: 'Stale Heartbeat',
        customerPlate: 'SH0001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      actor,
      key
    );

    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);

    // Backdate heartbeatAt to simulate a genuinely stale heartbeat (app was closed).
    await db.sessions_charging.update(session.id as number, {
      heartbeatAt: Date.now() - 31 * 60_000
    });

    await heartbeatService.checkAnomalies(actor);

    const updated = await db.sessions_charging.get(session.id as number);
    expect(updated?.status).toBe('Anomaly');
  });
});

describe('Import date parser', () => {
  it('accepts MM/DD/YYYY HH:mm format (backward-compatible)', () => {
    const ts = parseDate('04/15/2025 09:30');
    expect(ts).not.toBeNull();
    const d = new Date(ts!);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('accepts MM/DD/YYYY date-only format with 00:00 default time', () => {
    const ts = parseDate('04/15/2025');
    expect(ts).not.toBeNull();
    const d = new Date(ts!);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('rejects invalid date string', () => {
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('2025-04-15')).toBeNull();
    expect(parseDate('15/04/2025')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});
