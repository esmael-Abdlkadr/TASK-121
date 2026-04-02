/**
 * Service-level RBAC tests for non-Auditor privileged roles.
 * Ensures quality, tiering, export, and siteConfig are protected
 * at the service layer, not only at the route/button layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { exportService } from '../services/exportService';
import { importService } from '../services/importService';
import { qualityService } from '../services/qualityService';
import { siteConfigService } from '../services/siteConfigService';
import { tieringService } from '../services/tieringService';
import type { User } from '../types';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setupUsers() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({ siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });
  const otherSiteId = await db.sites.add({ siteCode: 'SITE-002', name: 'Other Site' });

  const adminHash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const adminId = await db.users.add({
    username: 'admin', passwordHash: adminHash.hash, salt: adminHash.salt,
    role: 'SystemAdministrator', failedAttempts: 0
  });

  const auditorHash = await cryptoService.hashPassword('ChargeBay#Aud01');
  const auditorId = await db.users.add({
    username: 'auditor', passwordHash: auditorHash.hash, salt: auditorHash.salt,
    role: 'Auditor', siteId, failedAttempts: 0
  });

  const attHash = await cryptoService.hashPassword('ChargeBay#Att01');
  const attId = await db.users.add({
    username: 'attendant', passwordHash: attHash.hash, salt: attHash.salt,
    role: 'Attendant', siteId, failedAttempts: 0
  });

  const mgr1Hash = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const mgr1Id = await db.users.add({
    username: 'manager', passwordHash: mgr1Hash.hash, salt: mgr1Hash.salt,
    role: 'SiteManager', siteId, failedAttempts: 0
  });

  const mgr2Hash = await cryptoService.hashPassword('ChargeBay#Mgr02');
  const mgr2Id = await db.users.add({
    username: 'manager2', passwordHash: mgr2Hash.hash, salt: mgr2Hash.salt,
    role: 'SiteManager', siteId: otherSiteId, failedAttempts: 0
  });

  return {
    siteId,
    otherSiteId,
    admin: (await db.users.get(adminId))!,
    auditor: (await db.users.get(auditorId))!,
    attendant: (await db.users.get(attId))!,
    manager: (await db.users.get(mgr1Id))!,
    manager2: (await db.users.get(mgr2Id))!
  };
}

describe('Service-level RBAC — quality, tiering, export, siteConfig', () => {
  beforeEach(async () => {
    localStorage.clear();
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true });
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    }
    await resetDb();
  });

  // ─── qualityService.runReport ───────────────────────────────────────────────
  it('qualityService.runReport: Auditor cannot run report', async () => {
    const { siteId, auditor } = await setupUsers();
    await expect(qualityService.runReport(siteId, auditor)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('qualityService.runReport: Attendant cannot run report (service-level block)', async () => {
    const { siteId, attendant } = await setupUsers();
    // assertManagerOrAdmin restricts to SA/SiteManager only — Attendant must be rejected at service level
    await expect(qualityService.runReport(siteId, attendant)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('qualityService.runReport: Auditor with same siteId still blocked', async () => {
    const { siteId, auditor } = await setupUsers();
    await expect(qualityService.runReport(siteId, auditor)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('qualityService.runReport: SiteManager of different site cannot run for another site', async () => {
    const { siteId, manager2 } = await setupUsers();
    // manager2 belongs to otherSiteId, trying to run report for siteId → scope violation
    await expect(qualityService.runReport(siteId, manager2)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('qualityService.runReport: SystemAdministrator can run for any site', async () => {
    const { siteId, admin } = await setupUsers();
    const report = await qualityService.runReport(siteId, admin);
    expect(report).toBeTruthy();
  });

  it('qualityService.runReport: SiteManager can run for own site', async () => {
    const { siteId, manager } = await setupUsers();
    const report = await qualityService.runReport(siteId, manager);
    expect(report).toBeTruthy();
  });

  // ─── siteConfigService.saveSiteConfig ──────────────────────────────────────
  it('siteConfigService: Auditor cannot save config', async () => {
    const { siteId, auditor } = await setupUsers();
    await expect(
      siteConfigService.saveSiteConfig({ siteId, tempLeaveMaxCount: 2, tempLeaveMaxMinutes: 10, anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 5, ratePerMinute: 0.5 }, auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('siteConfigService: SiteManager of different site cannot save config for another site', async () => {
    const { siteId, manager2 } = await setupUsers();
    await expect(
      siteConfigService.saveSiteConfig({ siteId, tempLeaveMaxCount: 2, tempLeaveMaxMinutes: 10, anomalyHeartbeatTimeoutMin: 30, noShowGraceMinutes: 5, ratePerMinute: 0.5 }, manager2)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('siteConfigService: SiteManager can save config for own site', async () => {
    const { siteId, manager } = await setupUsers();
    await expect(
      siteConfigService.saveSiteConfig({ siteId, tempLeaveMaxCount: 3, tempLeaveMaxMinutes: 20, anomalyHeartbeatTimeoutMin: 45, noShowGraceMinutes: 15, ratePerMinute: 0.75 }, manager)
    ).resolves.toBeUndefined();
  });

  // ─── exportService.exportPackage ───────────────────────────────────────────
  it('exportService: Auditor cannot create export package', async () => {
    const { siteId, auditor } = await setupUsers();
    await expect(
      exportService.exportPackage(siteId, { from: 0, to: Date.now() }, 'pass', auditor)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('exportService: SiteManager of different site cannot export for another site', async () => {
    const { siteId, manager2 } = await setupUsers();
    await expect(
      exportService.exportPackage(siteId, { from: 0, to: Date.now() }, 'pass', manager2)
    ).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('exportService: SiteManager can export for own site', async () => {
    const { siteId, manager } = await setupUsers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(siteId, { from: 0, to: Date.now() }, 'TestPass#Export1', manager);
    expect(blob).toBeInstanceOf(Blob);
    clickSpy.mockRestore();
  });

  // ─── exportService.importPackage ───────────────────────────────────────────
  it('exportService.importPackage: Auditor cannot import package', async () => {
    const { siteId, auditor } = await setupUsers();
    const pkg = { version: 1, siteId, salt: 'aa', iv: 'bb', ciphertext: '' };
    const file = new File([JSON.stringify(pkg)], 'pkg.json');
    await expect(exportService.importPackage(file, 'TestPass#Import1', auditor)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('exportService.importPackage: SiteManager of different site cannot import package for another site', async () => {
    const { siteId, manager2 } = await setupUsers();
    const pkg = { version: 1, siteId, salt: 'aa', iv: 'bb', ciphertext: '' };
    const file = new File([JSON.stringify(pkg)], 'pkg.json');
    await expect(exportService.importPackage(file, 'TestPass#Import1', manager2)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('exportService.importPackage: SiteManager can import package for own site', async () => {
    const { siteId, manager } = await setupUsers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(siteId, { from: 0, to: Date.now() }, 'TestPass#Import2', manager);
    clickSpy.mockRestore();
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const file = new File([text], 'pkg.json');
    const result = await exportService.importPackage(file, 'TestPass#Import2', manager);
    expect(result).toBeTruthy();
  });

  it('exportService.importPackage: SystemAdministrator can import package for any site', async () => {
    const { siteId, manager, admin } = await setupUsers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(siteId, { from: 0, to: Date.now() }, 'TestPass#Import3', manager);
    clickSpy.mockRestore();
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const file = new File([text], 'pkg.json');
    const result = await exportService.importPackage(file, 'TestPass#Import3', admin);
    expect(result).toBeTruthy();
  });

  // ─── importService.startImport ─────────────────────────────────────────────
  it('importService.startImport: Auditor cannot import', async () => {
    const { auditor } = await setupUsers();
    const file = new File(['header\nval'], 'test.csv', { type: 'text/csv' });
    await expect(importService.startImport(file, 'sessions', { header: '' }, auditor)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('importService.startImport: Attendant cannot import', async () => {
    const { attendant } = await setupUsers();
    const file = new File(['header\nval'], 'test.csv', { type: 'text/csv' });
    await expect(importService.startImport(file, 'sessions', { header: '' }, attendant)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });
});
