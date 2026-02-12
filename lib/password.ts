/**
 * Edge-safe password hashing with WebCrypto (PBKDF2).
 * No plaintext passwords stored; constant-time compare for verification.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_LENGTH = 32;
const HASH_ALG = 'SHA-256';

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64Decode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Generate a random salt (16 bytes). */
function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Hash a password with PBKDF2: random salt, 100k iterations, SHA-256, base64.
 * Returns { password_hash, password_salt } for storage.
 */
export async function hashPassword(password: string): Promise<{ password_hash: string; password_salt: string }> {
  const enc = new TextEncoder();
  const salt = randomSalt();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALG,
    },
    key,
    KEY_LENGTH * 8
  );
  const hash = new Uint8Array(bits);
  return {
    password_hash: base64Encode(hash),
    password_salt: base64Encode(salt),
  };
}

/** Constant-time compare two strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Verify password against stored hash and salt.
 * Uses same PBKDF2 params; constant-time compare of hash.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const enc = new TextEncoder();
  const salt = base64Decode(storedSalt);
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALG,
    },
    key,
    KEY_LENGTH * 8
  );
  const computedHash = base64Encode(new Uint8Array(bits));
  return timingSafeEqual(computedHash, storedHash);
}
