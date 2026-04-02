/**
 * QR arrival-confirmation validation tests.
 *
 * Verifies that confirmArrival('qr', ...) enforces the full bound identity:
 *   - reservationId must match the persisted reservation's primary key
 *   - operationId must match
 *   - siteCode must match the reservation's site
 *
 * Also verifies that createReservation stores the REAL persisted reservationId
 * in the QR payload (not a placeholder 0), and that a round-trip from
 * reservation.qrCode through confirmArrival succeeds.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { qrService } from '../services/qrService';
import { reservationService } from '../services/reservationService';
import { siteConfigService } from '../services/siteConfigService';
import type { User } from '../types';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'QR-SITE', name: 'QR Test Site' });
  const bayId = await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });
  await siteConfigService.saveSiteConfig({
    siteId,
    tempLeaveMaxCount: 1,
    tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30,
    noShowGraceMinutes: 10,
    ratePerMinute: 0.5
  });
  const hash = await cryptoService.hashPassword('ChargeBay#Att01');
  const userId = await db.users.add({
    username: 'attendant',
    passwordHash: hash.hash,
    salt: hash.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });
  const user = (await db.users.get(userId))! as User;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', user.salt);
  return { siteId, bayId, user, key };
}

describe('QR payload — real reservation identity binding', () => {
  beforeEach(resetDb);

  it('createReservation stores the real persisted reservationId in qrCode (not 0)', async () => {
    const { bayId, siteId, user, key } = await setup();
    const operationId = crypto.randomUUID();
    const reservation = await reservationService.createReservation(
      {
        operationId,
        bayId,
        siteId,
        userId: user.id as number,
        customerName: 'QR Driver',
        customerPlate: 'QR001',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      user,
      key
    );

    expect(reservation.qrCode).toBeTruthy();
    const parsed = qrService.parsePayload(reservation.qrCode!);
    // Real persisted ID — never a placeholder.
    expect(parsed.reservationId).toBe(reservation.id as number);
    expect(parsed.reservationId).toBeGreaterThan(0);
    expect(parsed.operationId).toBe(operationId);
    expect(parsed.siteCode).toBe('QR-SITE');
  });

  it('confirmArrival qr: mismatched reservationId throws RES_QR_MISMATCH', async () => {
    const { bayId, siteId, user, key } = await setup();
    const operationId = crypto.randomUUID();
    const reservation = await reservationService.createReservation(
      {
        operationId,
        bayId,
        siteId,
        userId: user.id as number,
        customerName: 'QR Driver',
        customerPlate: 'QR002',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      user,
      key
    );

    // Tamper: swap reservationId with a different (non-existent) ID.
    const tamperedPayload = qrService.encodePayload({
      reservationId: (reservation.id as number) + 999,
      operationId,
      siteCode: 'QR-SITE'
    });

    await expect(
      reservationService.confirmArrival(reservation.id as number, 'qr', user, tamperedPayload)
    ).rejects.toThrow('RES_QR_MISMATCH');
  });

  it('confirmArrival qr: mismatched siteCode throws RES_QR_MISMATCH', async () => {
    const { bayId, siteId, user, key } = await setup();
    const operationId = crypto.randomUUID();
    const reservation = await reservationService.createReservation(
      {
        operationId,
        bayId,
        siteId,
        userId: user.id as number,
        customerName: 'QR Driver',
        customerPlate: 'QR003',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      user,
      key
    );

    // Tamper: supply a different site code.
    const tamperedPayload = qrService.encodePayload({
      reservationId: reservation.id as number,
      operationId,
      siteCode: 'WRONG-SITE'
    });

    await expect(
      reservationService.confirmArrival(reservation.id as number, 'qr', user, tamperedPayload)
    ).rejects.toThrow('RES_QR_MISMATCH');
  });

  it('confirmArrival qr: mismatched operationId throws RES_QR_MISMATCH', async () => {
    const { bayId, siteId, user, key } = await setup();
    const operationId = crypto.randomUUID();
    const reservation = await reservationService.createReservation(
      {
        operationId,
        bayId,
        siteId,
        userId: user.id as number,
        customerName: 'QR Driver',
        customerPlate: 'QR004',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      user,
      key
    );

    const tamperedPayload = qrService.encodePayload({
      reservationId: reservation.id as number,
      operationId: 'wrong-op-id',
      siteCode: 'QR-SITE'
    });

    await expect(
      reservationService.confirmArrival(reservation.id as number, 'qr', user, tamperedPayload)
    ).rejects.toThrow('RES_QR_MISMATCH');
  });

  it('confirmArrival qr: reservation.qrCode as payload succeeds (real round-trip)', async () => {
    const { bayId, siteId, user, key } = await setup();
    const operationId = crypto.randomUUID();
    const res = await reservationService.createReservation(
      {
        operationId,
        bayId,
        siteId,
        userId: user.id as number,
        customerName: 'QR Driver',
        customerPlate: 'QR005',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 3_600_000
      },
      user,
      key
    );

    // Use the QR code stored in the reservation — exactly what a scanner returns.
    const session = await reservationService.confirmArrival(
      res.id as number,
      'qr',
      user,
      res.qrCode!
    );
    expect(session.status).toBe('Active');
  });
});
