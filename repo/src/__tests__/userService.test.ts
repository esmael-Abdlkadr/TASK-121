import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { userService } from '../services/userService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function seedUsers() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Main Site' });

  const adminHash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const adminId = await db.users.add({
    username: 'sysadmin',
    passwordHash: adminHash.hash,
    salt: adminHash.salt,
    role: 'SystemAdministrator',
    failedAttempts: 0
  });

  const attendantHash = await cryptoService.hashPassword('ChargeBay#Att01');
  const attendantId = await db.users.add({
    username: 'attendant',
    passwordHash: attendantHash.hash,
    salt: attendantHash.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });

  return {
    siteId,
    admin: (await db.users.get(adminId))!,
    attendant: (await db.users.get(attendantId))!
  };
}

describe('userService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('listUsers rejects non-admin actor', async () => {
    const { attendant } = await seedUsers();
    await expect(userService.listUsers(attendant)).rejects.toThrow('RBAC_SCOPE_VIOLATION');
  });

  it('listUsers returns users sorted by username for SystemAdministrator', async () => {
    const { admin, siteId } = await seedUsers();
    const managerHash = await cryptoService.hashPassword('ChargeBay#Mgr01');
    await db.users.add({
      username: 'manager',
      passwordHash: managerHash.hash,
      salt: managerHash.salt,
      role: 'SiteManager',
      siteId,
      failedAttempts: 0
    });

    const users = await userService.listUsers(admin);
    expect(users.map((user) => user.username)).toEqual(['attendant', 'manager', 'sysadmin']);
  });

  it('createUser stores hashed password and writes audit log', async () => {
    const { admin, siteId } = await seedUsers();
    const userId = await userService.createUser(admin, {
      username: 'manager2',
      password: 'ChargeBay#Mgr02',
      role: 'SiteManager',
      siteId
    });

    const created = await db.users.get(userId);
    expect(created).toBeTruthy();
    expect(created?.passwordHash).not.toBe('ChargeBay#Mgr02');
    expect(created?.role).toBe('SiteManager');
    expect(created?.siteId).toBe(siteId);

    const log = await db.auditLogs.orderBy('id').last();
    expect(log?.action).toBe('USER_CREATED');
    expect(log?.entityType).toBe('User');
    expect(log?.entityId).toBe(String(userId));
  });

  it('createUser rejects duplicate usernames', async () => {
    const { admin } = await seedUsers();
    await expect(
      userService.createUser(admin, {
        username: 'attendant',
        password: 'ChargeBay#Any123',
        role: 'Attendant',
        siteId: 1
      })
    ).rejects.toThrow('USER_ALREADY_EXISTS');
  });

  it('resetPassword updates credentials, unlocks account, and writes audit log', async () => {
    const { admin, siteId } = await seedUsers();
    const targetHash = await cryptoService.hashPassword('ChargeBay#User01');
    const targetId = await db.users.add({
      username: 'operator1',
      passwordHash: targetHash.hash,
      salt: targetHash.salt,
      role: 'SiteManager',
      siteId,
      failedAttempts: 3,
      lockedUntil: Date.now() + 60_000
    });

    await userService.resetPassword(admin, targetId, 'ChargeBay#Reset2');

    const updated = await db.users.get(targetId);
    expect(updated?.failedAttempts).toBe(0);
    expect(updated?.lockedUntil).toBeUndefined();
    expect(
      await cryptoService.verifyPassword('ChargeBay#Reset2', updated?.passwordHash ?? '', updated?.salt ?? '')
    ).toBe(true);
    expect(
      await cryptoService.verifyPassword('ChargeBay#User01', updated?.passwordHash ?? '', updated?.salt ?? '')
    ).toBe(false);

    const log = await db.auditLogs.orderBy('id').last();
    expect(log?.action).toBe('USER_PASSWORD_RESET');
    expect(log?.entityId).toBe(String(targetId));
  });

  it('resetPassword rejects unknown user ids', async () => {
    const { admin } = await seedUsers();
    await expect(userService.resetPassword(admin, 99999, 'ChargeBay#Reset2')).rejects.toThrow('USER_NOT_FOUND');
  });

  it('unlockAccount clears lock state and writes audit log', async () => {
    const { admin, siteId } = await seedUsers();
    const targetHash = await cryptoService.hashPassword('ChargeBay#User01');
    const targetId = await db.users.add({
      username: 'operator2',
      passwordHash: targetHash.hash,
      salt: targetHash.salt,
      role: 'SiteManager',
      siteId,
      failedAttempts: 4,
      lockedUntil: Date.now() + 120_000
    });

    await userService.unlockAccount(admin, targetId);

    const updated = await db.users.get(targetId);
    expect(updated?.failedAttempts).toBe(0);
    expect(updated?.lockedUntil).toBeUndefined();

    const log = await db.auditLogs.orderBy('id').last();
    expect(log?.action).toBe('USER_UNLOCKED');
    expect(log?.entityId).toBe(String(targetId));
  });

  it('unlockAccount rejects unknown user ids', async () => {
    const { admin } = await seedUsers();
    await expect(userService.unlockAccount(admin, 99999)).rejects.toThrow('USER_NOT_FOUND');
  });
});
