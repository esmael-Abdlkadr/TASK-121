import { db } from '../db/db';
import type { User } from '../types';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { assertCanMutate, assertSiteScope } from './rbacService';

interface DateRange {
  from: number;
  to: number;
}

/**
 * Package format for offline device-to-device transfer.
 * `signature` is a password-bound integrity check: SHA-256(plaintext_payload + password).
 * This provides tamper-detection tied to the export password; it is NOT an
 * asymmetric cryptographic signature and does not establish signer identity.
 * The `ciphertext` is the AES-GCM encrypted payload derived from the same password.
 */
interface ExportPackage {
  version: 1;
  siteId: number;
  exportedAt: number;
  exportedBy: string;
  dateRange: DateRange;
  /** Password-bound integrity hash: SHA-256(payload + password). */
  signature: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function exportPackage(
  siteId: number,
  dateRange: DateRange,
  password: string,
  actor: User
): Promise<Blob> {
  assertCanMutate(actor);
  assertSiteScope(actor, siteId);
  const [reservations, sessions, orders, reservationsCold, sessionsCold, ordersCold] = await Promise.all([
    db.reservations
      .where('siteId')
      .equals(siteId)
      .filter((r) => r.scheduledStart >= dateRange.from && r.scheduledStart <= dateRange.to)
      .toArray(),
    db.sessions_charging
      .where('siteId')
      .equals(siteId)
      .filter((s) => s.startedAt >= dateRange.from && s.startedAt <= dateRange.to)
      .toArray(),
    db.orders
      .where('siteId')
      .equals(siteId)
      .filter((o) => (o.createdAt ?? 0) >= dateRange.from && (o.createdAt ?? 0) <= dateRange.to)
      .toArray(),
    db.reservations_cold.where('siteId').equals(siteId).toArray(),
    db.sessions_cold.where('siteId').equals(siteId).toArray(),
    db.orders_cold.where('siteId').equals(siteId).toArray()
  ]);

  const payload = JSON.stringify({
    reservations,
    sessions,
    orders,
    reservationsCold,
    sessionsCold,
    ordersCold
  });
  const signature = await sha256Hex(payload + password);
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await cryptoService.deriveEncryptionKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(payload)
  );

  const pkg: ExportPackage = {
    version: 1,
    siteId,
    exportedAt: Date.now(),
    exportedBy: actor.username,
    dateRange,
    signature,
    salt,
    iv: bytesToHex(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipher))
  };

  const json = JSON.stringify(pkg, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const site = await db.sites.get(siteId);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cb-export-${site?.siteCode ?? siteId}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  await auditService.log(actor, 'EXPORT_PACKAGE_CREATED', 'Site', siteId);
  return blob;
}

async function importPackage(file: File, password: string, actor: User): Promise<{ inserted: number; skipped: number }> {
  assertCanMutate(actor);
  // (package already carries siteId - no scope assertion on import)
  const text =
    'text' in file
      ? await (file as unknown as { text: () => Promise<string> }).text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });

  const pkg = JSON.parse(text) as ExportPackage;
  if (pkg.version !== 1) {
    throw new Error('EXPORT_SIGNATURE_MISMATCH');
  }

  assertSiteScope(actor, pkg.siteId);

  try {
    const key = await cryptoService.deriveEncryptionKey(password, pkg.salt);
    const iv = hexToBytes(pkg.iv);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      base64ToBytes(pkg.ciphertext) as unknown as BufferSource
    );
    const payloadText = new TextDecoder().decode(plain);
    const signature = await sha256Hex(payloadText + password);
    if (signature !== pkg.signature) {
      throw new Error('EXPORT_SIGNATURE_MISMATCH');
    }

    const payload = JSON.parse(payloadText) as {
      reservations: Array<{ id?: number }>;
      sessions: Array<{ id?: number }>;
      orders: Array<{ id?: number }>;
      reservationsCold: Array<{ id?: number }>;
      sessionsCold: Array<{ id?: number }>;
      ordersCold: Array<{ id?: number }>;
    };

    let inserted = 0;
    let skipped = 0;
    for (const row of payload.reservations) {
      if (row.id && (await db.reservations.get(row.id))) {
        skipped += 1;
      } else {
        await db.reservations.add(row as never);
        inserted += 1;
      }
    }
    for (const row of payload.sessions) {
      if (row.id && (await db.sessions_charging.get(row.id))) {
        skipped += 1;
      } else {
        await db.sessions_charging.add(row as never);
        inserted += 1;
      }
    }
    for (const row of payload.orders) {
      if (row.id && (await db.orders.get(row.id))) {
        skipped += 1;
      } else {
        await db.orders.add(row as never);
        inserted += 1;
      }
    }
    for (const row of payload.reservationsCold) {
      if (row.id && (await db.reservations_cold.get(row.id))) {
        skipped += 1;
      } else {
        await db.reservations_cold.add(row as never);
        inserted += 1;
      }
    }
    for (const row of payload.sessionsCold) {
      if (row.id && (await db.sessions_cold.get(row.id))) {
        skipped += 1;
      } else {
        await db.sessions_cold.add(row as never);
        inserted += 1;
      }
    }
    for (const row of payload.ordersCold) {
      if (row.id && (await db.orders_cold.get(row.id))) {
        skipped += 1;
      } else {
        await db.orders_cold.add(row as never);
        inserted += 1;
      }
    }

    await auditService.log(actor, 'IMPORT_PACKAGE_APPLIED', 'Site', pkg.siteId, { inserted, skipped });
    return { inserted, skipped };
  } catch {
    throw new Error('EXPORT_SIGNATURE_MISMATCH');
  }
}

export const exportService = {
  exportPackage,
  importPackage
};
