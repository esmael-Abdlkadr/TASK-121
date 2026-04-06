import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { tieringService } from '../services/tieringService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({
    siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available'
  });
  await siteConfigService.bootstrapSiteConfig({
    siteId, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5
  });
  const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const userId = await db.users.add({
    username: 'admin', passwordHash: hash.hash, salt: hash.salt,
    role: 'SystemAdministrator', failedAttempts: 0
  });
  const actor = (await db.users.get(userId))!;
  return { siteId, actor };
}

describe('tieringService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('runTiering archives reservations older than 90 days', async () => {
    const { siteId, actor } = await setup();
    const bayId = (await db.bays.where('siteId').equals(siteId).first())!.id as number;
    const oldDate = Date.now() - 100 * 24 * 60 * 60 * 1000;

    await db.reservations.add({
      operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
      customerName: 'Old', customerPlate: 'OLD001',
      scheduledStart: oldDate, scheduledEnd: oldDate + 60 * 60_000,
      status: 'Completed', noShowDeadline: oldDate + 10 * 60_000, version: 1
    });

    const result = await tieringService.runTiering(siteId, actor);
    expect(result.reservationsArchived).toBe(1);

    const hotCount = await db.reservations.where('siteId').equals(siteId).count();
    expect(hotCount).toBe(0);

    const coldCount = await db.reservations_cold.where('siteId').equals(siteId).count();
    expect(coldCount).toBe(1);
  });

  it('runTiering does not archive recent reservations', async () => {
    const { siteId, actor } = await setup();
    const bayId = (await db.bays.where('siteId').equals(siteId).first())!.id as number;
    const recentDate = Date.now() - 10 * 24 * 60 * 60 * 1000;

    await db.reservations.add({
      operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
      customerName: 'Recent', customerPlate: 'REC001',
      scheduledStart: recentDate, scheduledEnd: recentDate + 60 * 60_000,
      status: 'Completed', noShowDeadline: recentDate + 10 * 60_000, version: 1
    });

    const result = await tieringService.runTiering(siteId, actor);
    expect(result.reservationsArchived).toBe(0);

    const hotCount = await db.reservations.where('siteId').equals(siteId).count();
    expect(hotCount).toBe(1);
  });

  it('runTiering rejects Attendant role', async () => {
    const { siteId } = await setup();
    const hash = await cryptoService.hashPassword('ChargeBay#Att01');
    const attId = await db.users.add({
      username: 'attendant', passwordHash: hash.hash, salt: hash.salt,
      role: 'Attendant', siteId, failedAttempts: 0
    });
    const attendant = (await db.users.get(attId))!;

    await expect(tieringService.runTiering(siteId, attendant)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('queryColdReservations returns archived records for a site', async () => {
    const { siteId, actor } = await setup();
    const bayId = (await db.bays.where('siteId').equals(siteId).first())!.id as number;
    const oldDate = Date.now() - 100 * 24 * 60 * 60 * 1000;

    await db.reservations.add({
      operationId: crypto.randomUUID(), bayId, siteId, userId: actor.id as number,
      customerName: 'Archive', customerPlate: 'ARC001',
      scheduledStart: oldDate, scheduledEnd: oldDate + 60 * 60_000,
      status: 'Completed', noShowDeadline: oldDate + 10 * 60_000, version: 1
    });

    await tieringService.runTiering(siteId, actor);
    const cold = await tieringService.queryColdReservations(siteId);
    expect(cold.length).toBe(1);
    expect(cold[0].siteId).toBe(siteId);
  });
});
