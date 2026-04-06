/**
 * F-002 regression tests: import package row-level site-scope enforcement.
 *
 * Proves that crafted packages with mixed siteId values are rejected
 * atomically, and valid same-site packages import successfully.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { cryptoService } from '../services/cryptoService';
import { exportService } from '../services/exportService';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function setup() {
  const siteId = await db.sites.add({ siteCode: 'SITE-001', name: 'Test Site' });
  await db.bays.add({ siteId, stationId: 'ST-01', connectorId: 'C1', label: 'Bay 1', status: 'Available' });
  const hash = await cryptoService.hashPassword('ChargeBay#Admin1');
  const userId = await db.users.add({
    username: 'sysadmin', passwordHash: hash.hash, salt: hash.salt,
    role: 'SystemAdministrator', siteId, failedAttempts: 0
  });
  const actor = (await db.users.get(userId))!;
  return { siteId, actor };
}

async function blobToText(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * Creates a tampered package file where some payload rows have a foreign siteId.
 * We export a real package, decrypt it, mutate payload rows, re-encrypt and re-sign.
 */
async function buildTamperedPackage(
  siteId: number,
  foreignSiteId: number,
  password: string,
  actor: Parameters<typeof exportService.exportPackage>[3]
) {
  // Seed a reservation so the export has content
  await db.reservations.add({
    operationId: crypto.randomUUID(),
    bayId: 1, siteId, userId: actor.id as number,
    customerName: 'x', customerPlate: 'y',
    scheduledStart: Date.now(), scheduledEnd: Date.now() + 60_000,
    status: 'Scheduled', noShowDeadline: Date.now() + 10 * 60_000, version: 1
  });

  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const blob = await exportService.exportPackage(
    siteId,
    { from: Date.now() - 1_000_000, to: Date.now() + 1_000_000 },
    password,
    actor
  );
  clickSpy.mockRestore();

  // Decrypt to get the real payload structure
  const pkgText = await blobToText(blob);
  const pkg = JSON.parse(pkgText);

  // Derive key + decrypt
  const key = await cryptoService.deriveEncryptionKey(password, pkg.salt);
  const iv = hexToBytes(pkg.iv);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    base64ToBytes(pkg.ciphertext) as unknown as BufferSource
  );
  const payload = JSON.parse(new TextDecoder().decode(plain));

  // Tamper: inject a reservation row with a foreign siteId
  payload.reservations.push({
    operationId: crypto.randomUUID(),
    bayId: 999, siteId: foreignSiteId, userId: 1,
    customerName: 'evil', customerPlate: 'evil',
    scheduledStart: Date.now(), scheduledEnd: Date.now() + 60_000,
    status: 'Scheduled', noShowDeadline: Date.now(), version: 1
  });

  // Re-encrypt + re-sign with same password so decryption succeeds
  const newPayloadText = JSON.stringify(payload);
  const newSig = await sha256Hex(newPayloadText + password);
  const newIv = crypto.getRandomValues(new Uint8Array(12));
  const newCipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: newIv },
    key,
    new TextEncoder().encode(newPayloadText)
  );

  const tampered = {
    ...pkg,
    signature: newSig,
    iv: bytesToHex(newIv),
    ciphertext: bytesToBase64(new Uint8Array(newCipher))
  };

  return new File([JSON.stringify(tampered)], 'tampered.json', { type: 'application/json' });
}

// Crypto helpers (mirror exportService internals)
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
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

describe('F-002 — import package row-level site-scope enforcement', () => {
  beforeEach(async () => {
    localStorage.clear();
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true });
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    }
    await resetDb();
  });

  it('rejects package with mixed-site rows (IMPORT_SITE_SCOPE_VIOLATION)', async () => {
    const { siteId, actor } = await setup();
    const foreignSiteId = 9999;
    const password = 'test-password';

    const tampered = await buildTamperedPackage(siteId, foreignSiteId, password, actor);

    await expect(
      exportService.importPackage(tampered, password, actor)
    ).rejects.toThrow('IMPORT_SITE_SCOPE_VIOLATION');
  });

  it('no rows inserted after mixed-site rejection (atomic rollback)', async () => {
    const { siteId, actor } = await setup();
    const foreignSiteId = 9999;
    const password = 'test-password';

    const tampered = await buildTamperedPackage(siteId, foreignSiteId, password, actor);

    // Clear reservations after building the tampered package to isolate the import
    await db.reservations.clear();
    const countBefore = await db.reservations.count();

    await exportService.importPackage(tampered, password, actor).catch(() => {});

    // No new rows should have been inserted — site-scope rejection is pre-transaction
    const countAfter = await db.reservations.count();
    expect(countAfter).toBe(countBefore);
  });

  it('valid same-site package imports successfully', async () => {
    const { siteId, actor } = await setup();
    const password = 'test-password';

    await db.reservations.add({
      operationId: crypto.randomUUID(),
      bayId: 1, siteId, userId: actor.id as number,
      customerName: 'x', customerPlate: 'y',
      scheduledStart: Date.now(), scheduledEnd: Date.now() + 60_000,
      status: 'Scheduled', noShowDeadline: Date.now() + 10 * 60_000, version: 1
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = await exportService.exportPackage(
      siteId,
      { from: Date.now() - 1_000_000, to: Date.now() + 1_000_000 },
      password,
      actor
    );
    clickSpy.mockRestore();

    const json = await blobToText(blob);
    await db.reservations.clear();

    const file = new File([json], 'valid.json', { type: 'application/json' });
    const result = await exportService.importPackage(file, password, actor);
    expect(result.inserted).toBeGreaterThan(0);
  });
});
