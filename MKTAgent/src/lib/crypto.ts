// AES-256-GCM authenticated encryption for OAuth tokens at rest.
// Replaces the n8n credential vault: tokens live encrypted in Postgres, decrypted
// only in-process when a publish/refresh needs them.
//
// Format (single base64 string): v1.<iv>.<authTag>.<ciphertext>
//   - version prefix lets us rotate the scheme later without ambiguity
//   - iv: 12 random bytes (GCM standard), unique per encryption
//   - authTag: 16 bytes, detects tampering on decrypt
//
// Key comes from env TOKEN_ENC_KEY: 64 hex chars (32 bytes). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

const getKey = (): Buffer => {
  if (cachedKey) return cachedKey;
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex) throw new Error('crypto: TOKEN_ENC_KEY not set');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('crypto: TOKEN_ENC_KEY must be 64 hex chars (32 bytes)');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
};

export const encryptToken = (plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
};

export const decryptToken = (payload: string): string => {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('crypto: malformed or unsupported token payload');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
};

// True when a value is already in our encrypted envelope (v1.<iv>.<tag>.<ct>). Lets a
// backfill tell an already-encrypted column from a legacy plaintext one, idempotently.
export const isEncrypted = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.startsWith(`${VERSION}.`) && v.split('.').length === 4;

// Deterministic keyed HMAC — a BLIND INDEX. Encrypting PII (email) makes an equality query
// impossible (ciphertext differs per-row via the random IV), so we store HMAC(email) alongside
// and dedupe on THAT. Keyed with TOKEN_ENC_KEY so the index is useless without the secret. Not
// reversible (one-way), so it leaks nothing an attacker with the DB can turn back into an email.
export const blindIndex = (value: string): string =>
  createHmac('sha256', getKey()).update(value.trim().toLowerCase()).digest('hex');

// Constant-time string compare for webhook secrets (no crypto.timingSafeEqual
// length leak — pad-free, matches the pure-JS safeEq used in the n8n nodes).
export const safeEqual = (a: string, b: string): boolean => {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
};
