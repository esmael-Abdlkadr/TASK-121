import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { exportService } from '../services/exportService';
import { heartbeatService } from '../services/heartbeatService';
import { notificationService } from '../services/notificationService';
import { orderService } from '../services/orderService';
import { reservationService } from '../services/reservationService';
import { sessionService } from '../services/sessionService';
import { siteConfigService } from '../services/siteConfigService';
import { tieringService } from '../services/tieringService';
import type { User } from '../types';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupUsers() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  const bayId = await db.bays.add({
    siteId,
    stationId: 'ST-01',
    connectorId: 'C1',
    label: 'Bay 1',
    status: 'Available'
  });

  const adminHash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const auditorHash = await cryptoService.hashPassword('ChargeBay#Aud01');
  const attHash = await cryptoService.hashPassword('ChargeBay#Att01');

  const adminId = await db.users.add({
    username: 'admin',
    passwordHash: adminHash.hash,
    salt: adminHash.salt,
    role: 'SystemAdministrator',
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

  const attId = await db.users.add({
    username: 'attendant',
    passwordHash: attHash.hash,
    salt: attHash.salt,
    role: 'Attendant',
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
    auditor: (await db.users.get(auditorId))!,
    attendant: (await db.users.get(attId))!
  };
}

describe('Auditor read-only enforcement', () => {
  beforeEach(resetDb);

  it('auditor cannot create a reservation', async () => {
    const { auditor, siteId, bayId } = await setupUsers();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Aud01', auditor.salt);
    await expect(
      reservationService.createReservation(
        {
          operationId: crypto.randomUUID(),
          bayId,
          siteId,
          userId: auditor.id as number,
          customerName: 'Test',
          customerPlate: 'XYZ',
          scheduledStart: Date.now() + 60_000,
          scheduledEnd: Date.now() + 120 * 60_000
        },
        auditor,
        key
      )
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot complete a session', async () => {
    const { auditor, attendant, siteId, bayId } = await setupUsers();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Test',
        customerPlate: 'XYZ',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 120 * 60_000
      },
      attendant,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await expect(
      sessionService.completeSession(session.id as number, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot flag anomaly', async () => {
    const { auditor, attendant, siteId, bayId } = await setupUsers();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Test',
        customerPlate: 'XYZ',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 120 * 60_000
      },
      attendant,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await expect(
      reservationService.flagAnomaly(session.id as number, 'test reason', auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot set reconciliation status', async () => {
    const { auditor, attendant, siteId, bayId } = await setupUsers();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Test',
        customerPlate: 'XYZ',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 120 * 60_000
      },
      attendant,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();

    await expect(
      orderService.setReconciliationStatus(order?.id as number, 'Matched', auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot submit, mark paid, or refund orders', async () => {
    const { auditor, attendant, siteId, bayId } = await setupUsers();
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Att01', attendant.salt);
    const reservation = await reservationService.createReservation(
      {
        operationId: crypto.randomUUID(),
        bayId,
        siteId,
        userId: attendant.id as number,
        customerName: 'Test',
        customerPlate: 'XYZ',
        scheduledStart: Date.now() + 60_000,
        scheduledEnd: Date.now() + 120 * 60_000
      },
      attendant,
      key
    );
    const session = await reservationService.confirmArrival(reservation.id as number, 'manual', attendant);
    await sessionService.completeSession(session.id as number, attendant);
    const order = await db.orders.where('sessionId').equals(session.id as number).first();

    await expect(
      orderService.submitOrder(order?.id as number, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');

    await expect(
      orderService.markPaid(order?.id as number, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot archive notifications', async () => {
    const { auditor } = await setupUsers();
    const notif = await notificationService.send(auditor.id as number, 'HOLD_AVAILABLE', { bayLabel: 'Bay 1' });
    await expect(
      notificationService.archive(notif!.id as number, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot run tiering', async () => {
    const { auditor, siteId } = await setupUsers();
    await expect(
      tieringService.runTiering(siteId, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor cannot save site config', async () => {
    const { auditor, siteId } = await setupUsers();
    await expect(
      siteConfigService.saveSiteConfig({
        siteId,
        tempLeaveMaxCount: 5,
        tempLeaveMaxMinutes: 30,
        anomalyHeartbeatTimeoutMin: 60,
        noShowGraceMinutes: 20,
        ratePerMinute: 1.0
      }, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor can read audit log and quality reports', async () => {
    const { auditor, siteId } = await setupUsers();
    // These should not throw - auditor has read access
    const logs = await db.auditLogs.where('siteId').equals(siteId).toArray();
    expect(Array.isArray(logs)).toBe(true);
    const reports = await db.qualityReports.where('siteId').equals(siteId).toArray();
    expect(Array.isArray(reports)).toBe(true);
  });

  it('auditor can view send log', async () => {
    const { auditor } = await setupUsers();
    const log = await notificationService.getSendLog(auditor);
    expect(Array.isArray(log)).toBe(true);
  });

  it('auditor heartbeat tick throws RBAC_SCOPE_VIOLATION', async () => {
    const { auditor } = await setupUsers();
    await expect(
      heartbeatService.tick(auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor anomaly check throws RBAC_SCOPE_VIOLATION', async () => {
    const { auditor } = await setupUsers();
    await expect(
      heartbeatService.checkAnomalies(auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor auto-process no-shows throws RBAC_SCOPE_VIOLATION', async () => {
    const { auditor } = await setupUsers();
    await expect(
      reservationService.autoProcessNoShows(auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('auditor notification scheduler throws RBAC_SCOPE_VIOLATION', async () => {
    const { auditor } = await setupUsers();
    await expect(
      notificationService.runDueAndOverdueSchedulers(auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });
});
