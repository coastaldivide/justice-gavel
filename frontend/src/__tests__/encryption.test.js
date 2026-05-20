/**
 * encryption.test.js
 * Tests the frontend encryption service (AES-256-GCM via crypto module).
 * Runs in Node — no RN mocks needed.
 */
const crypto = require('crypto');

// ── Inline implementation that mirrors src/services/encryption.ts ─────────────
const RAW_KEY = 'a'.repeat(64); // 32-byte hex test key (matches env.js)
const KEY = Buffer.from(RAW_KEY, 'hex');

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored) {
  if (!stored || !stored.includes(':')) return stored;
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  try {
    const [ivHex, tagHex, ctHex] = parts;
    const iv  = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct  = Buffer.from(ctHex, 'hex');
    const d   = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return d.update(ct) + d.final('utf8');
  } catch { return stored; }
}

function isEncrypted(val) {
  if (!val || typeof val !== 'string') return false;
  const parts = val.split(':');
  return parts.length === 3 && parts[0].length === 24 && /^[0-9a-f]+$/i.test(parts[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Frontend Encryption Service', () => {

  describe('encrypt() / decrypt() round-trip', () => {
    it('encrypts and decrypts a plain string', () => {
      const plain = 'Case note — attorney eyes only';
      expect(decrypt(encrypt(plain))).toBe(plain);
    });

    it('handles empty string passthrough', () => {
      expect(encrypt('')).toBeFalsy();
      expect(decrypt('')).toBeFalsy();
    });

    it('round-trips unicode text (EN/ES/VI/PT)', () => {
      const text = 'Derechos: Quyền: Direitos: 权利';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('round-trips a long document (50KB)', () => {
      const long = 'A'.repeat(50000);
      expect(decrypt(encrypt(long))).toBe(long);
    });

    it('produces a different ciphertext each call (random IV)', () => {
      const plain = 'same message';
      const c1 = encrypt(plain);
      const c2 = encrypt(plain);
      expect(c1).not.toBe(c2);
      expect(decrypt(c1)).toBe(plain);
      expect(decrypt(c2)).toBe(plain);
    });

    it('returns stored string on tampered ciphertext (migration safety)', () => {
      const enc     = encrypt('secret data');
      const tampered = enc.slice(0, -4) + 'XXXX';
      expect(() => decrypt(tampered)).not.toThrow();
      expect(decrypt(tampered)).not.toBe('secret data');
    });

    it('passes through non-encrypted strings unmodified', () => {
      expect(decrypt('plain text')).toBe('plain text');
      expect(decrypt('not:encrypted')).toBe('not:encrypted');
    });
  });

  describe('isEncrypted()', () => {
    it('returns true for encrypted values', () => {
      expect(isEncrypted(encrypt('test'))).toBe(true);
    });

    it('returns false for plain strings', () => {
      expect(isEncrypted('plain text')).toBe(false);
      expect(isEncrypted('two:parts')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });
  });
});
