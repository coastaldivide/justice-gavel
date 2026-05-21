import logger from '../utils/logger.js';
/**
 * encryption.js — AES-256-GCM message encryption
 *
 * Used for: case messages, case notes (future), voice note transcripts
 *
 * Key derivation: ENCRYPTION_KEY env var (32 bytes hex = 64 chars)
 * If not set: falls back to a deterministic key derived from JWT_SECRET
 * — still encrypted, just not independently rotatable.
 *
 * Each encrypted value is stored as: iv:authTag:ciphertext (all hex)
 * iv = 12 bytes random, authTag = 16 bytes, ciphertext = variable
 */

import crypto from 'crypto';

// Require explicit key — never silently fall back to a predictable value
if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('[encryption] ENCRYPTION_KEY env var required in production. Generate: node -e "logger.info(require(\"crypto\").randomBytes(32).toString(\"hex\"))"');
}
const RAW_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'jtb-fallback-key-change-in-production';

// Derive a 32-byte key from whatever string we have
function deriveKey(source) {
  return crypto.createHash('sha256').update(source).digest();
}

const KEY = RAW_KEY.length === 64 && /^[0-9a-f]+$/i.test(RAW_KEY)
  ? Buffer.from(RAW_KEY, 'hex')  // Explicit 32-byte hex key
  : deriveKey(RAW_KEY);           // Derive from secret string

/**
 * Encrypt a plaintext string.
 * Returns: "iv:authTag:ciphertext" (all hex, colon-delimited)
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt an encrypted string.
 * Returns original plaintext, or the input unchanged if not encrypted format.
 */
export function decrypt(stored) {
  if (!stored || !stored.includes(':')) return stored; // not encrypted — pass through
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  try {
    const [ivHex, tagHex, ctHex] = parts;
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const ct      = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final('utf8');
  } catch (e) {
    logger.warn('[encryption/decrypt] failed — returning raw stored value:', e?.message);
    return stored; // decryption failed — return as-is (migration safety)
  }
}

/**
 * Returns true if a string looks like our encrypted format.
 */
export function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts[0].length === 24; // 12-byte iv = 24 hex chars
}
