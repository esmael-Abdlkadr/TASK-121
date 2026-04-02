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

function key(userId: number, action: string) {
  return `cb_ratelimit_${userId}_${action}`;
}

function readState(userId: number, action: string): WindowState {
  const raw = localStorage.getItem(key(userId, action));
  if (!raw) {
    return { count: 0, windowStart: Date.now() };
  }
  try {
    return JSON.parse(raw) as WindowState;
  } catch {
    return { count: 0, windowStart: Date.now() };
  }
}

function writeState(userId: number, action: string, state: WindowState): void {
  localStorage.setItem(key(userId, action), JSON.stringify(state));
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
      return;
    }
    writeState(userId, action, {
      count: current.count + count,
      windowStart: current.windowStart
    });
  }
}

export const rateLimiter = new RateLimiter();
