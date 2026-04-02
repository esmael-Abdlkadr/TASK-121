import { db } from '../db/db';
import type { User, UserRole } from '../types';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';

interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  siteId?: number;
}

function assertSystemAdministrator(actor: User) {
  if (actor.role !== 'SystemAdministrator') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
}

async function listUsers(actor: User): Promise<User[]> {
  assertSystemAdministrator(actor);
  return db.users.orderBy('username').toArray();
}

async function createUser(actor: User, input: CreateUserInput): Promise<number> {
  assertSystemAdministrator(actor);
  const existing = await db.users.where('username').equals(input.username).first();
  if (existing) {
    throw new Error('USER_ALREADY_EXISTS');
  }

  const { hash, salt } = await cryptoService.hashPassword(input.password);
  const createdUser: User = {
    username: input.username,
    passwordHash: hash,
    salt,
    role: input.role,
    siteId: input.role === 'SystemAdministrator' ? undefined : input.siteId,
    failedAttempts: 0,
    lockedUntil: undefined
  };

  const userId = await db.users.add(createdUser);
  await auditService.log(actor, 'USER_CREATED', 'User', userId, {
    username: input.username,
    role: input.role,
    siteId: createdUser.siteId
  });

  return userId;
}

async function resetPassword(actor: User, userId: number, newPassword: string): Promise<void> {
  assertSystemAdministrator(actor);
  const user = await db.users.get(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const { hash, salt } = await cryptoService.hashPassword(newPassword);
  await db.users.update(userId, {
    passwordHash: hash,
    salt,
    failedAttempts: 0,
    lockedUntil: undefined
  });
  await auditService.log(actor, 'USER_PASSWORD_RESET', 'User', userId, {
    username: user.username
  });
}

async function unlockAccount(actor: User, userId: number): Promise<void> {
  assertSystemAdministrator(actor);
  const user = await db.users.get(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  await db.users.update(userId, {
    failedAttempts: 0,
    lockedUntil: undefined
  });
  await auditService.log(actor, 'USER_UNLOCKED', 'User', userId, {
    username: user.username
  });
}

export const userService = {
  listUsers,
  createUser,
  resetPassword,
  unlockAccount
};
