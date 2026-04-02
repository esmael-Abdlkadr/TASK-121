const PASSWORD_MIN_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'SHA-256';
const AES_KEY_LENGTH = 256;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function ensurePasswordLength(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
}

async function deriveBits(password: string, salt: string): Promise<ArrayBuffer> {
  const saltBytes = hexToBytes(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    keyMaterial,
    256
  );
}

async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  ensurePasswordLength(password);
  const resolvedSalt = salt ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const bits = await deriveBits(password, resolvedSalt);

  return {
    hash: bytesToHex(new Uint8Array(bits)),
    salt: resolvedSalt
  };
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  if (!salt || !hash) {
    return false;
  }

  try {
    const calculated = await hashPassword(password, salt);
    return calculated.hash === hash;
  } catch {
    return false;
  }
}

async function deriveEncryptionKey(password: string, keySalt: string): Promise<CryptoKey> {
  ensurePasswordLength(password);
  const saltBytes = hexToBytes(keySalt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptField(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value)
  );

  const merged = new Uint8Array(iv.length + encrypted.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64(merged);
}

async function decryptField(cipher: string, key: CryptoKey): Promise<string> {
  const bytes = base64ToBytes(cipher);
  const iv = bytes.slice(0, 12);
  const payload = bytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
  return new TextDecoder().decode(decrypted);
}

export const cryptoService = {
  hashPassword,
  verifyPassword,
  deriveEncryptionKey,
  encryptField,
  decryptField
};
