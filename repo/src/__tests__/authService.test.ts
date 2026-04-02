import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { authService, AuthLockedError } from '../services/authService';
import { cryptoService } from '../services/cryptoService';

describe('authService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.delete();
    await db.open();
    const { hash, salt } = await cryptoService.hashPassword('ChargeBay#Att01');
    await db.users.add({
      username: 'attendant',
      passwordHash: hash,
      salt,
      role: 'Attendant',
      siteId: 1,
      failedAttempts: 0
    });
  });

  it('correct credentials return user', async () => {
    const result = await authService.login('attendant', 'ChargeBay#Att01');
    expect(result.user.username).toBe('attendant');
  });

  it('wrong password increments attempts and lockout works', async () => {
    await expect(authService.login('attendant', 'wrong')).rejects.toBeTruthy();
    const user = await db.users.where('username').equals('attendant').first();
    expect(user?.failedAttempts).toBe(1);
    for (let i = 0; i < 4; i += 1) {
      await authService.login('attendant', 'wrong').catch(() => undefined);
    }
    const locked = await db.users.where('username').equals('attendant').first();
    expect((locked?.lockedUntil ?? 0) > Date.now()).toBe(true);
    await expect(authService.login('attendant', 'wrong')).rejects.toBeInstanceOf(AuthLockedError);
  });

  it('restoreSession handles missing and expired sessions', async () => {
    expect(await authService.restoreSession()).toBeNull();
    const login = await authService.login('attendant', 'ChargeBay#Att01');
    const stored = JSON.parse(localStorage.getItem('cb_session') as string) as { sessionId: number };
    await db.sessions_auth.update(stored.sessionId, { lastActiveAt: Date.now() - 9 * 60 * 60 * 1000 });
    expect(await authService.restoreSession()).toBeNull();
    expect(login.user.username).toBe('attendant');
  });
});
