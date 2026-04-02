import { describe, expect, it } from 'vitest';
import { rateLimiter } from '../services/rateLimiter';

describe('rateLimiter', () => {
  it('enforces cap and resets after window', () => {
    localStorage.clear();
    const userId = 1;
    for (let i = 0; i < 199; i += 1) {
      rateLimiter.check(userId, 'bulk', 200, 60_000);
      rateLimiter.record(userId, 'bulk', 1);
    }
    rateLimiter.check(userId, 'bulk', 200, 60_000);
    rateLimiter.record(userId, 'bulk', 1);
    expect(() => rateLimiter.check(userId, 'bulk', 200, 60_000, 1)).toThrow('RATE_LIMIT_EXCEEDED');
  });
});
