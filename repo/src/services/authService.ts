import { db } from '../db/db';
import type { StoredSession, User } from '../types';
import { cryptoService } from './cryptoService';
import { auditService } from './auditService';

export const AUTH_SESSION_KEY = 'cb_session';
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export class AuthWrongPasswordError extends Error {
  code = 'AUTH_WRONG_PASSWORD' as const;

  constructor() {
    super('AUTH_WRONG_PASSWORD');
    this.name = 'AuthWrongPasswordError';
  }
}

export class AuthLockedError extends Error {
  code = 'AUTH_LOCKED' as const;
  remainingMs: number;

  constructor(remainingMs: number) {
    super('AUTH_LOCKED');
    this.name = 'AuthLockedError';
    this.remainingMs = remainingMs;
  }
}

function storeSession(session: StoredSession) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function getStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

async function login(
  username: string,
  password: string
): Promise<{ user: User; encryptionKey: CryptoKey }> {
  const user = await db.users.where('username').equals(username).first();
  if (!user) {
    throw new AuthWrongPasswordError();
  }

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AuthLockedError(user.lockedUntil - now);
  }

  const isValid = await cryptoService.verifyPassword(password, user.passwordHash, user.salt);
  if (!isValid) {
    const nextAttempts = user.failedAttempts + 1;
    if (nextAttempts >= LOCKOUT_THRESHOLD) {
      const lockedUntil = now + LOCKOUT_DURATION_MS;
      await db.users.update(user.id as number, { failedAttempts: 0, lockedUntil });
      await auditService.log(user, 'AUTH_ACCOUNT_LOCKED', 'User', user.id as number, {
        lockedUntil
      });
      throw new AuthLockedError(LOCKOUT_DURATION_MS);
    }

    await db.users.update(user.id as number, { failedAttempts: nextAttempts });
    await auditService.log(user, 'AUTH_FAILED_ATTEMPT', 'User', user.id as number, {
      failedAttempts: nextAttempts
    });
    throw new AuthWrongPasswordError();
  }

  await db.users.update(user.id as number, { failedAttempts: 0, lockedUntil: undefined });

  const sessionId = await db.sessions_auth.add({
    userId: user.id as number,
    createdAt: now,
    lastActiveAt: now
  });

  storeSession({
    sessionId,
    userId: user.id as number,
    role: user.role,
    siteId: user.siteId
  });

  const keySalt = user.salt;
  const encryptionKey = await cryptoService.deriveEncryptionKey(password, keySalt);
  await auditService.log(user, 'AUTH_LOGIN', 'User', user.id as number);

  return {
    user: {
      ...user,
      failedAttempts: 0,
      lockedUntil: undefined
    },
    encryptionKey
  };
}

function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

async function restoreSession(): Promise<User | null> {
  const stored = getStoredSession();
  if (!stored) {
    return null;
  }

  const session = await db.sessions_auth.get(stored.sessionId);
  if (!session) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }

  const now = Date.now();
  if (session.lastActiveAt < now - SESSION_DURATION_MS) {
    await db.sessions_auth.delete(session.id as number);
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }

  await db.sessions_auth.update(session.id as number, { lastActiveAt: now });
  const user = await db.users.get(stored.userId);
  if (!user) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }

  await auditService.log(user, 'AUTH_SESSION_RESTORED', 'SessionAuth', session.id as number);

  return user;
}

export const authService = {
  login,
  logout,
  restoreSession
};
