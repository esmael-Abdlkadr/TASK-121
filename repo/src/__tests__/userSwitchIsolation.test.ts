/**
 * User-switch cache/state isolation tests.
 * Verifies that logging out and in as a different user does not leak
 * the previous user's notification preferences or stale session data.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { AUTH_SESSION_KEY, authService } from '../services/authService';
import { cryptoService } from '../services/cryptoService';
import { notificationService } from '../services/notificationService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function seedTwoUsers() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  const hash1 = await cryptoService.hashPassword('ChargeBay#Mgr01');
  const userId1 = await db.users.add({
    username: 'user1',
    passwordHash: hash1.hash,
    salt: hash1.salt,
    role: 'SiteManager',
    siteId,
    failedAttempts: 0
  });
  const hash2 = await cryptoService.hashPassword('ChargeBay#Att01');
  const userId2 = await db.users.add({
    username: 'user2',
    passwordHash: hash2.hash,
    salt: hash2.salt,
    role: 'Attendant',
    siteId,
    failedAttempts: 0
  });
  return { siteId, userId1, userId2 };
}

describe('User-switch isolation', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('notification prefs are per-user and do not leak between users', async () => {
    const { userId1, userId2 } = await seedTwoUsers();

    // User 1 sets custom prefs
    const prefs1 = notificationService.getPrefs(userId1);
    prefs1.showDesktopBanner = false;
    prefs1.enabled['HOLD_AVAILABLE'] = false;
    notificationService.savePrefs(prefs1);

    // User 2 gets default prefs (not user 1's prefs)
    const prefs2 = notificationService.getPrefs(userId2);
    expect(prefs2.showDesktopBanner).toBe(true); // default
    expect(prefs2.enabled['HOLD_AVAILABLE']).toBe(true); // default

    // User 1's prefs are still intact
    const prefs1Again = notificationService.getPrefs(userId1);
    expect(prefs1Again.showDesktopBanner).toBe(false);
    expect(prefs1Again.enabled['HOLD_AVAILABLE']).toBe(false);
  });

  it('logout clears the session from LocalStorage', async () => {
    await seedTwoUsers();
    await authService.login('user1', 'ChargeBay#Mgr01');
    expect(JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) ?? 'null')).not.toBeNull();

    authService.logout();
    expect(JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) ?? 'null')).toBeNull();
  });

  it('login as second user after logout loads second user session (not stale first user)', async () => {
    await seedTwoUsers();
    await authService.login('user1', 'ChargeBay#Mgr01');
    const first = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) ?? 'null');
    expect(first?.role).toBe('SiteManager');

    authService.logout();

    await authService.login('user2', 'ChargeBay#Att01');
    const second = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) ?? 'null');
    expect(second?.role).toBe('Attendant');
    expect(second?.userId).not.toBe(first?.userId);
  });

  it('notifications for user1 are not visible to user2', async () => {
    const { userId1, userId2 } = await seedTwoUsers();

    await notificationService.send(userId1, 'HOLD_AVAILABLE', { bayLabel: 'Bay 1' });
    await notificationService.send(userId1, 'DUE_REMINDER', { bayLabel: 'Bay 1', startTime: '09:00' });

    const inbox2 = await notificationService.getInbox(userId2);
    expect(inbox2.length).toBe(0);

    const inbox1 = await notificationService.getInbox(userId1);
    expect(inbox1.length).toBe(2);
  });
});
