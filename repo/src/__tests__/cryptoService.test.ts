import { describe, expect, it } from 'vitest';
import { cryptoService } from '../services/cryptoService';

describe('cryptoService', () => {
  it('hashing same password+salt is deterministic', async () => {
    const one = await cryptoService.hashPassword('ChargeBay#Admin1', '00112233445566778899aabbccddeeff');
    const two = await cryptoService.hashPassword('ChargeBay#Admin1', '00112233445566778899aabbccddeeff');
    expect(one.hash).toBe(two.hash);
  });

  it('different salts yield different hashes', async () => {
    const one = await cryptoService.hashPassword('ChargeBay#Admin1', '00112233445566778899aabbccddeeff');
    const two = await cryptoService.hashPassword('ChargeBay#Admin1', 'ffeeddccbbaa99887766554433221100');
    expect(one.hash).not.toBe(two.hash);
  });

  it('verifyPassword handles correct and wrong passwords', async () => {
    const { hash, salt } = await cryptoService.hashPassword('ChargeBay#Admin1');
    expect(await cryptoService.verifyPassword('ChargeBay#Admin1', hash, salt)).toBe(true);
    expect(await cryptoService.verifyPassword('wrong', hash, salt)).toBe(false);
  });

  it('encrypt/decrypt roundtrip and random IV differs', async () => {
    const key = await cryptoService.deriveEncryptionKey('ChargeBay#Admin1', '00112233445566778899aabbccddeeff');
    const c1 = await cryptoService.encryptField('hello', key);
    const c2 = await cryptoService.encryptField('hello', key);
    expect(c1).not.toBe(c2);
    expect(await cryptoService.decryptField(c1, key)).toBe('hello');
  });
});
