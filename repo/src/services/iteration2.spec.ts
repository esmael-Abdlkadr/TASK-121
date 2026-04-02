import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { UserRole } from '../types';
import { authService, AuthLockedError, AuthWrongPasswordError } from './authService';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { assertSiteScope, ScopeViolationError } from './rbacService';
import { userService } from './userService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function createUser(username: string, password: string, siteId = 1, role: UserRole = 'Attendant') {
  const { hash, salt } = await cryptoService.hashPassword(password);
  const id = await db.users.add({
    username,
    passwordHash: hash,
    salt,
    role,
    siteId,
    failedAttempts: 0
  });
  return id;
}

describe('Iteration 2 acceptance checks', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('locks account after 5 wrong attempts and reports lock on 6th', async () => {
    await createUser('attendant', 'ChargeBay#Att01');

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(authService.login('attendant', 'wrong-password')).rejects.toBeInstanceOf(
        AuthWrongPasswordError
      );
    }

    await expect(authService.login('attendant', 'wrong-password')).rejects.toBeInstanceOf(
      AuthLockedError
    );

    const sixthAttempt = authService.login('attendant', 'wrong-password');
    await expect(sixthAttempt).rejects.toBeInstanceOf(AuthLockedError);
    await sixthAttempt.catch((error: unknown) => {
      expect(error).toBeInstanceOf(AuthLockedError);
      expect((error as AuthLockedError).remainingMs).toBeGreaterThan(0);
    });
  });

  it('restores session if active and auto logs out after 8 hours', async () => {
    const userId = await createUser('manager', 'ChargeBay#Mgr01', 1, 'SiteManager');

    await authService.login('manager', 'ChargeBay#Mgr01');
    const restored = await authService.restoreSession();
    expect(restored?.id).toBe(userId);

    const session = await db.sessions_auth.orderBy('id').last();
    expect(session).toBeTruthy();
    await db.sessions_auth.update(session?.id as number, {
      lastActiveAt: Date.now() - 8 * 60 * 60 * 1000 - 1
    });

    const expired = await authService.restoreSession();
    expect(expired).toBeNull();
    expect(localStorage.getItem('cb_session')).toBeNull();
  });

  it('encrypt and decrypt field round trip', async () => {
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Admin1', '00112233445566778899aabbccddeeff');
    const cipher = await cryptoService.encryptField('EV-TEST-123', key);
    const plain = await cryptoService.decryptField(cipher, key);
    expect(plain).toBe('EV-TEST-123');
  });

  it('enforces RBAC site scope and throws violation', async () => {
    const actor = {
      id: 1,
      username: 'attendant',
      passwordHash: 'x',
      salt: 'x',
      role: 'Attendant' as const,
      siteId: 1,
      failedAttempts: 0
    };

    expect(() => assertSiteScope(actor, 2)).toThrow(ScopeViolationError);
  });

  it('verifies audit chain and detects tampering', async () => {
    const actor = {
      id: 1,
      username: 'sysadmin',
      passwordHash: 'x',
      salt: 'x',
      role: 'SystemAdministrator' as const,
      failedAttempts: 0
    };

    await auditService.log(actor, 'USER_CREATED', 'User', 101);
    await auditService.log(actor, 'USER_UNLOCKED', 'User', 101);

    expect(await auditService.verifyChain()).toBe(true);

    const first = await db.auditLogs.orderBy('id').first();
    await db.auditLogs.update(first?.id as number, { action: 'TAMPERED' });
    expect(await auditService.verifyChain()).toBe(false);
  });

  it('allows sysadmin to create, reset, and unlock users', async () => {
    const { hash, salt } = await cryptoService.hashPassword('ChargeBay#Admin1');
    const adminId = await db.users.add({
      username: 'sysadmin',
      passwordHash: hash,
      salt,
      role: 'SystemAdministrator',
      failedAttempts: 0
    });
    const actor = (await db.users.get(adminId))!;

    const userId = await userService.createUser(actor, {
      username: 'newattendant',
      password: 'ChargeBay#Att02',
      role: 'Attendant',
      siteId: 1
    });
    expect(userId).toBeGreaterThan(0);

    await userService.resetPassword(actor, userId, 'ChargeBay#Att03');
    await userService.unlockAccount(actor, userId);

    const updated = await db.users.get(userId);
    expect(updated?.lockedUntil).toBeUndefined();
    expect(await cryptoService.verifyPassword('ChargeBay#Att03', updated?.passwordHash ?? '', updated?.salt ?? '')).toBe(true);
  });
});
