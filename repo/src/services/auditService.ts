import { db } from '../db/db';
import type { AuditLog, User } from '../types';

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getPreviousHash(siteId?: number): Promise<string> {
  let previous: AuditLog | undefined;

  if (typeof siteId === 'number') {
    previous = await db.auditLogs.where('siteId').equals(siteId).last();
  } else {
    previous = await db.auditLogs.orderBy('id').last();
  }

  return previous?.chainHash ?? (await sha256Hex('GENESIS'));
}

function toPayload(record: {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: number;
}) {
  return JSON.stringify(record);
}

async function log(
  actor: User,
  action: string,
  entityType: string,
  entityId: number | string,
  detail?: object
): Promise<void> {
  const timestamp = Date.now();
  const normalizedEntityId = String(entityId);
  const siteId = actor.siteId;
  const previousHash = await getPreviousHash(siteId);

  const payload = toPayload({
    actor: actor.username,
    action,
    entityType,
    entityId: normalizedEntityId,
    timestamp
  });

  const chainHash = await sha256Hex(previousHash + payload);

  await db.auditLogs.add({
    actor: actor.username,
    action,
    entityType,
    entityId: normalizedEntityId,
    siteId,
    timestamp,
    chainHash,
    detail: detail ? JSON.stringify(detail) : undefined
  });
}

async function verifyChain(siteId?: number): Promise<boolean> {
  const result = await verifyChainDetails(siteId);
  return result.valid;
}

async function verifyChainDetails(
  siteId?: number
): Promise<{ valid: boolean; total: number; from?: number; to?: number }> {
  const records =
    typeof siteId === 'number'
      ? await db.auditLogs.where('siteId').equals(siteId).sortBy('timestamp')
      : await db.auditLogs.orderBy('id').toArray();

  let previousHash = await sha256Hex('GENESIS');

  for (const record of records) {
    const payload = toPayload({
      actor: record.actor,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      timestamp: record.timestamp
    });
    const expectedHash = await sha256Hex(previousHash + payload);

    if (record.chainHash !== expectedHash) {
      return {
        valid: false,
        total: records.length,
        from: records[0]?.timestamp,
        to: records[records.length - 1]?.timestamp
      };
    }

    previousHash = record.chainHash;
  }

  return {
    valid: true,
    total: records.length,
    from: records[0]?.timestamp,
    to: records[records.length - 1]?.timestamp
  };
}

function exportCsv(logs: AuditLog[]): void {
  const header = 'timestamp,actor,action,entityType,entityId,siteId,detail';
  const rows = logs.map(
    (row) =>
      `${new Date(row.timestamp).toISOString()},${row.actor},${row.action},${row.entityType},${row.entityId},${row.siteId ?? ''},${(row.detail ?? '').replaceAll(',', ';')}`
  );
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export const auditService = {
  log,
  verifyChain,
  verifyChainDetails,
  exportCsv
};
