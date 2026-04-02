import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { auditService } from '../services/auditService';
import { cryptoService } from '../services/cryptoService';

describe('auditService', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('detects tampering and exposes no delete API', async () => {
    const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
    const id = await db.users.add({
      username: 'sysadmin',
      passwordHash: hash.hash,
      salt: hash.salt,
      role: 'SystemAdministrator',
      failedAttempts: 0
    });
    const actor = (await db.users.get(id))!;
    await auditService.log(actor, 'A', 'X', '1');
    expect(await auditService.verifyChain()).toBe(true);
    const first = await db.auditLogs.orderBy('id').first();
    await db.auditLogs.update(first?.id as number, { action: 'BAD' });
    expect(await auditService.verifyChain()).toBe(false);
    expect('delete' in auditService).toBe(false);
  });
});
