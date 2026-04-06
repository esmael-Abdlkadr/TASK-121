/**
 * Regression tests for F-01 and F-02 audit findings.
 *
 * F-01: SystemAdministrator with undefined siteId can perform site-scoped
 *       operations when an explicit targetSiteId is provided.
 * F-02: saveSiteConfig rejects calls without a mandatory actor.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { importService } from '../services/importService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupSaWithoutSiteId() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({ siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });

  await siteConfigService.bootstrapSiteConfig({
    siteId,
    tempLeaveMaxCount: 1,
    tempLeaveMaxMinutes: 15,
    anomalyHeartbeatTimeoutMin: 30,
    noShowGraceMinutes: 10,
    ratePerMinute: 0.5
  });

  const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const userId = await db.users.add({
    username: 'sysadmin',
    passwordHash: hash.hash,
    salt: hash.salt,
    role: 'SystemAdministrator',
    // siteId intentionally undefined — this is the real SA seed shape
    failedAttempts: 0
  });
  const admin = (await db.users.get(userId))!;
  const key = await cryptoService.deriveEncryptionKey('ChargeBay#Admin1', admin.salt);
  return { siteId, admin, key };
}

describe('F-01 — SystemAdministrator site-scoped flows with explicit siteId', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('SA with undefined actor.siteId can import reservations when targetSiteId is passed', async () => {
    const { siteId, admin, key } = await setupSaWithoutSiteId();
    expect(admin.siteId).toBeUndefined();

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,SA Import,PLATE01,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'sa-import.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const batch = await importService.startImport(file, 'reservations', map, admin, siteId, key);
    expect(batch.status).toBe('Complete');
    expect(batch.siteId).toBe(siteId);

    const reservations = await db.reservations.where('siteId').equals(siteId).toArray();
    expect(reservations.length).toBe(1);
  });

  it('SA with undefined actor.siteId can validate file when targetSiteId is passed', async () => {
    const { siteId, admin } = await setupSaWithoutSiteId();
    expect(admin.siteId).toBeUndefined();

    const csv = [
      'stationId,connectorId,customerName,customerPlate,scheduledStart,scheduledEnd',
      'ST-01,C1,SA Validate,PLATE02,04/01/2026 09:30,04/01/2026 11:00'
    ].join('\n');
    const file = new File([csv], 'sa-validate.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'],
      'reservations'
    );

    const result = await importService.validateFile(file, 'reservations', map, admin, siteId);
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(0);
  });

  it('SA with undefined actor.siteId can import orders when targetSiteId is passed', async () => {
    const { siteId, admin, key } = await setupSaWithoutSiteId();
    expect(admin.siteId).toBeUndefined();

    const csv = [
      'orderNumber,sessionId,durationMinutes,ratePerMinute,adjustmentAmount,adjustmentReason,invoiceNotes',
      'CB-SA-001,100,90,0.50,0,none,SA order note'
    ].join('\n');
    const file = new File([csv], 'sa-orders.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(
      ['orderNumber', 'sessionId', 'durationMinutes', 'ratePerMinute', 'adjustmentAmount', 'adjustmentReason', 'invoiceNotes'],
      'orders'
    );

    const batch = await importService.startImport(file, 'orders', map, admin, siteId, key);
    expect(batch.status).toBe('Complete');
    expect(batch.siteId).toBe(siteId);
  });
});

describe('F-02 — saveSiteConfig mandatory actor enforcement', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('saveSiteConfig rejects when actor is omitted at runtime', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test' });
    await expect(
      (siteConfigService.saveSiteConfig as Function)({
        siteId,
        tempLeaveMaxCount: 1,
        tempLeaveMaxMinutes: 15,
        anomalyHeartbeatTimeoutMin: 30,
        noShowGraceMinutes: 10,
        ratePerMinute: 0.5
      })
    ).rejects.toThrow();
  });

  it('saveSiteConfig rejects when actor is null', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test' });
    await expect(
      (siteConfigService.saveSiteConfig as Function)(
        { siteId, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15, anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5 },
        null
      )
    ).rejects.toThrow();
  });

  it('saveSiteConfig succeeds with valid actor', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test' });
    const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
    const userId = await db.users.add({
      username: 'admin',
      passwordHash: hash.hash,
      salt: hash.salt,
      role: 'SystemAdministrator',
      failedAttempts: 0
    });
    const admin = (await db.users.get(userId))!;

    await expect(
      siteConfigService.saveSiteConfig(
        { siteId, tempLeaveMaxCount: 2, tempLeaveMaxMinutes: 20, anomalyHeartbeatTimeoutMin: 45, noShowGraceMinutes: 15, ratePerMinute: 0.75 },
        admin
      )
    ).resolves.toBeUndefined();
  });

  it('bootstrapSiteConfig works without actor for initial setup', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test' });
    await siteConfigService.bootstrapSiteConfig({
      siteId,
      tempLeaveMaxCount: 1,
      tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const loaded = await siteConfigService.loadSiteConfig(siteId);
    expect(loaded.ratePerMinute).toBe(0.5);
  });
});

describe('F-NEW-01 — import site-scope enforcement', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  async function setupCrossSite() {
    const site1 = await db.sites.add({ siteCode: 'SITE-001', name: 'Site 1' });
    const site2 = await db.sites.add({ siteCode: 'SITE-002', name: 'Site 2' });
    await db.bays.add({ siteId: site1, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });
    await db.bays.add({ siteId: site2, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });

    await siteConfigService.bootstrapSiteConfig({
      siteId: site1, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5
    });
    await siteConfigService.bootstrapSiteConfig({
      siteId: site2, tempLeaveMaxCount: 1, tempLeaveMaxMinutes: 15,
      anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 10, ratePerMinute: 0.5
    });

    const mgrHash = await cryptoService.hashPassword('ChargeBay#Mgr01');
    const mgrId = await db.users.add({
      username: 'manager1', passwordHash: mgrHash.hash, salt: mgrHash.salt,
      role: 'SiteManager', siteId: site1, failedAttempts: 0
    });
    const manager = (await db.users.get(mgrId))!;
    const mgrKey = await cryptoService.deriveEncryptionKey('ChargeBay#Mgr01', manager.salt);

    const adminHash = await cryptoService.hashPassword('ChargeBay#Admin1');
    const adminId = await db.users.add({
      username: 'sysadmin', passwordHash: adminHash.hash, salt: adminHash.salt,
      role: 'SystemAdministrator', failedAttempts: 0
    });
    const admin = (await db.users.get(adminId))!;
    const adminKey = await cryptoService.deriveEncryptionKey('ChargeBay#Admin1', admin.salt);

    return { site1, site2, manager, mgrKey, admin, adminKey };
  }

  const RES_HEADERS = ['stationId', 'connectorId', 'customerName', 'customerPlate', 'scheduledStart', 'scheduledEnd'];
  const resCsv = [
    RES_HEADERS.join(','),
    'ST-01,C1,Cross Site,PLATE01,04/01/2026 09:30,04/01/2026 11:00'
  ].join('\n');

  it('SiteManager cannot startImport to a different site', async () => {
    const { site2, manager, mgrKey } = await setupCrossSite();
    const file = new File([resCsv], 'cross.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(RES_HEADERS, 'reservations');

    await expect(
      importService.startImport(file, 'reservations', map, manager, site2, mgrKey)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('SiteManager cannot validateFile for a different site', async () => {
    const { site2, manager } = await setupCrossSite();
    const file = new File([resCsv], 'cross-val.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(RES_HEADERS, 'reservations');

    await expect(
      importService.validateFile(file, 'reservations', map, manager, site2)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('SiteManager can import to own site', async () => {
    const { site1, manager, mgrKey } = await setupCrossSite();
    const file = new File([resCsv], 'own-site.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(RES_HEADERS, 'reservations');

    const batch = await importService.startImport(file, 'reservations', map, manager, site1, mgrKey);
    expect(batch.status).toBe('Complete');
    expect(batch.siteId).toBe(site1);
  });

  it('SystemAdministrator can import to any site', async () => {
    const { site2, admin, adminKey } = await setupCrossSite();
    expect(admin.siteId).toBeUndefined();

    const file = new File([resCsv], 'sa-any.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(RES_HEADERS, 'reservations');

    const batch = await importService.startImport(file, 'reservations', map, admin, site2, adminKey);
    expect(batch.status).toBe('Complete');
    expect(batch.siteId).toBe(site2);
  });

  it('SystemAdministrator can validateFile for any site', async () => {
    const { site2, admin } = await setupCrossSite();
    expect(admin.siteId).toBeUndefined();

    const file = new File([resCsv], 'sa-val-any.csv', { type: 'text/csv' });
    const map = importService.autoMapFields(RES_HEADERS, 'reservations');

    const result = await importService.validateFile(file, 'reservations', map, admin, site2);
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
  });
});
