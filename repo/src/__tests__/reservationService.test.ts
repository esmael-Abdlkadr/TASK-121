import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { BayConflictError, reservationService } from '../services/reservationService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  const bayId = await db.bays.add({
    siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available'
  });
  await siteConfigService.bootstrapSiteConfig({
    siteId, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5
  });
  const hash = await cryptoService.hashPassword('ChargeBay#Att01');
  const userId = await db.users.add({
    username: 'attendant', passwordHash: hash.hash, salt: hash.salt,
    role: 'Attendant', siteId, failedAttempts: 0
  });
  const actor = (await db.users.get(userId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', actor.salt);
  return { siteId, bayId, actor, key };
}

describe('reservationService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('createReservation inserts a reservation with Scheduled status', async () => {
    const { siteId, bayId, actor, key } = await setup();
    const now = Date.now();
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
        customerName: 'Test', customerPlate: 'ABC123',
        scheduledStart: now + 60_000, scheduledEnd: now + 120 * 60_000
      },
      actor, key
    );
    expect(reservation.status).toBe('Scheduled');
    expect(reservation.siteId).toBe(siteId);
    expect(reservation.bayId).toBe(bayId);
  });

  it('createReservation rejects overlapping time window on same bay', async () => {
    const { siteId, bayId, actor, key } = await setup();
    const now = Date.now();
    const start = now + 60_000;
    const end = now + 120 * 60_000;
    await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
        customerName: 'First', customerPlate: 'AAA111',
        scheduledStart: start, scheduledEnd: end
      },
      actor, key
    );
    await expect(
      reservationService.createReservation(
        {
          operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
          customerName: 'Second', customerPlate: 'BBB222',
          scheduledStart: start + 30_000, scheduledEnd: end
        },
        actor, key
      )
    ).rejects.toThrow(BayConflictError);
  });

  it('createReservation rejects invalid time window (start >= end)', async () => {
    const { siteId, bayId, actor, key } = await setup();
    const now = Date.now();
    await expect(
      reservationService.createReservation(
        {
          operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
          customerName: 'Bad', customerPlate: 'CCC333',
          scheduledStart: now + 120 * 60_000, scheduledEnd: now + 60_000
        },
        actor, key
      )
    ).rejects.toThrow('RES_INVALID_TIME_WINDOW');
  });

  it('confirmArrival transitions reservation to Active and creates a session', async () => {
    const { siteId, bayId, actor, key } = await setup();
    const now = Date.now();
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
        customerName: 'Arrive', customerPlate: 'DDD444',
        scheduledStart: now + 60_000, scheduledEnd: now + 120 * 60_000
      },
      actor, key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', actor);
    expect(session.status).toBe('Active');
    expect(session.reservationId).toBe(reservation.id);

    const updated = await db.reservations.get(reservation.id as number);
    expect(updated!.status).toBe('Active');
  });
});
