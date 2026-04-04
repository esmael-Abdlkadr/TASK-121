import { db } from '../db/db';

interface WindowState {
  count: number;
  windowStart: number;
}

export class RateLimitError extends Error {
  code = 'RATE_LIMIT_EXCEEDED' as const;
  action: string;
  cap: number;
  windowMs: number;
  retryAfterMs: number;

  constructor(action: string, cap: number, windowMs: number, retryAfterMs: number) {
    super('RATE_LIMIT_EXCEEDED');
    this.action = action;
    this.cap = cap;
    this.windowMs = windowMs;
    this.retryAfterMs = retryAfterMs;
  }
}

function compositeKey(userId: number, action: string) {
  return `cb_ratelimit_${userId}_${action}`;
}

/**
 * In-memory cache of rate-limit windows. Populated from IndexedDB via
 * `syncFromIdb()` at boot. Authoritative writes go to IndexedDB first,
 * then update this cache. Sync callers read from the cache.
 */
const stateCache = new Map<string, WindowState>();

function readState(userId: number, action: string): WindowState {
  return stateCache.get(compositeKey(userId, action)) ?? { count: 0, windowStart: Date.now() };
}

function writeState(userId: number, action: string, state: WindowState): void {
  const key = compositeKey(userId, action);
  stateCache.set(key, state);
  void db.rateLimits.put({ key, ...state }).catch(() => {});
}

class RateLimiter {
  check(userId: number, action: string, cap: number, windowMs: number, incomingCount = 1): void {
    const now = Date.now();
    const current = readState(userId, action);
    if (now - current.windowStart > windowMs) {
      writeState(userId, action, { count: 0, windowStart: now });
      return;
    }
    if (current.count + incomingCount > cap) {
      throw new RateLimitError(action, cap, windowMs, windowMs - (now - current.windowStart));
    }
  }

  record(userId: number, action: string, count: number): void {
    const now = Date.now();
    const current = readState(userId, action);
    if (now - current.windowStart > 60_000) {
      writeState(userId, action, { count, windowStart: now });
    } else {
      writeState(userId, action, {
        count: current.count + count,
        windowStart: current.windowStart
      });
    }
  }

  async syncFromIdb(userId: number, action: string): Promise<void> {
    try {
      const record = await db.rateLimits.get(compositeKey(userId, action));
      if (record) {
        stateCache.set(record.key, { count: record.count, windowStart: record.windowStart });
      }
    } catch { /* non-fatal */ }
  }
}

export const rateLimiter = new RateLimiter();
