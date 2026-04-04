import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { rateLimiter } from '../services/rateLimiter';

async function resetDb() {
  await db.delete();
  await db.open();
}

describe('rateLimiter', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  it('enforces cap and resets after window', () => {
    const userId = 1;
    for (let i = 0; i < 199; i += 1) {
      rateLimiter.check(userId, 'bulk', 200, 60_000);
      rateLimiter.record(userId, 'bulk', 1);
    }
    rateLimiter.check(userId, 'bulk', 200, 60_000);
    rateLimiter.record(userId, 'bulk', 1);
    expect(() => rateLimiter.check(userId, 'bulk', 200, 60_000, 1)).toThrow('RATE_LIMIT_EXCEEDED');
  });

  it('persists state to IndexedDB and restores via syncFromIdb', async () => {
    const userId = 42;
    rateLimiter.check(userId, 'test_action', 100, 60_000);
    rateLimiter.record(userId, 'test_action', 5);

    // Wait for the async IDB write to settle
    await new Promise((r) => setTimeout(r, 50));

    const record = await db.rateLimits.get(`cb_ratelimit_${userId}_test_action`);
    expect(record).toBeTruthy();
    expect(record!.count).toBe(5);

    // Simulate cold start by syncing from IDB into a fresh cache
    await rateLimiter.syncFromIdb(userId, 'test_action');
    // After sync, the next check should see the existing count
    expect(() => rateLimiter.check(userId, 'test_action', 5, 60_000, 1)).toThrow('RATE_LIMIT_EXCEEDED');
  });
});
