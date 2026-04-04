import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { siteConfigService } from '../services/siteConfigService';

async function resetDb() {
  await db.delete();
  await db.open();
}

describe('siteConfigService — IndexedDB-first persistence', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('saveSiteConfig writes to IndexedDB and loadSiteConfig reads it back', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
    const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
    const userId = await db.users.add({
      username: 'admin',
      passwordHash: hash.hash,
      salt: hash.salt,
      role: 'SystemAdministrator',
      failedAttempts: 0
    });
    const admin = (await db.users.get(userId))!;

    const config = {
      siteId,
      tempLeaveMaxCount: 3,
      tempLeaveMaxMinutes: 20,
      anomalyHeartbeatTimeoutMin: 45,
      noShowGraceMinutes: 15,
      ratePerMinute: 0.75
    };

    await siteConfigService.saveSiteConfig(config, admin);

    // Verify it's in IndexedDB
    const idbRecord = await db.siteConfigs.get(siteId);
    expect(idbRecord).toBeTruthy();
    expect(idbRecord!.ratePerMinute).toBe(0.75);
    expect(idbRecord!.tempLeaveMaxCount).toBe(3);

    // loadSiteConfig reads from IndexedDB
    const loaded = await siteConfigService.loadSiteConfig(siteId);
    expect(loaded.ratePerMinute).toBe(0.75);
    expect(loaded.tempLeaveMaxCount).toBe(3);
    expect(loaded.anomalyHeartbeatTimeoutMin).toBe(45);
  });

  it('loadSiteConfig returns defaults when no IndexedDB record exists', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-002', name: 'Empty Site' });
    const loaded = await siteConfigService.loadSiteConfig(siteId);
    expect(loaded.siteId).toBe(siteId);
    expect(loaded.ratePerMinute).toBe(0.5);
    expect(loaded.noShowGraceMinutes).toBe(10);
  });

  it('getSiteConfig returns cached value after loadSiteConfig hydrates', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-003', name: 'Cache Site' });
    await db.siteConfigs.put({
      id: siteId,
      siteId,
      tempLeaveMaxCount: 5,
      tempLeaveMaxMinutes: 25,
      anomalyHeartbeatTimeoutMin: 60,
      noShowGraceMinutes: 20,
      ratePerMinute: 1.25
    });

    // Before hydration, getSiteConfig returns defaults
    // (cache is cold for this siteId in a fresh test)
    const preHydration = siteConfigService.getSiteConfig(siteId);
    expect(preHydration.ratePerMinute).toBe(0.5);

    // Hydrate from IndexedDB
    await siteConfigService.loadSiteConfig(siteId);

    // Now sync read should return the IndexedDB value
    const postHydration = siteConfigService.getSiteConfig(siteId);
    expect(postHydration.ratePerMinute).toBe(1.25);
    expect(postHydration.tempLeaveMaxCount).toBe(5);
  });

  it('saveSiteConfig without actor does not require RBAC but still writes to IDB', async () => {
    const siteId = await db.sites.add({ siteCode: 'SITE-004', name: 'No-Actor Site' });
    await siteConfigService.saveSiteConfig({
      siteId,
      tempLeaveMaxCount: 2,
      tempLeaveMaxMinutes: 10,
      anomalyHeartbeatTimeoutMin: 30,
      noShowGraceMinutes: 10,
      ratePerMinute: 0.5
    });

    const idbRecord = await db.siteConfigs.get(siteId);
    expect(idbRecord).toBeTruthy();
    expect(idbRecord!.tempLeaveMaxCount).toBe(2);
  });
});
