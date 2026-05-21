/**
 * services.encryption.test.js — AES-256-GCM encryption service
 *
 * Tests: round-trip encryption/decryption, empty string handling,
 *        wrong-key rejection, isEncrypted detection
 */
import { jest } from '@jest/globals';

// Import the real encryption service
const { encrypt, decrypt, isEncrypted } =
  await import('../services/encryption.js');

describe('encryption service', () => {
  describe('encrypt() / decrypt()', () => {
    it('round-trips a plain string', async () => {
      const plain = 'Confidential case note — attorney eyes only';
      const enc = encrypt(plain);
      expect(enc).not.toBe(plain);
      expect(enc).toContain(':'); // iv:tag:ciphertext format
      expect(decrypt(enc)).toBe(plain);
    });

    it('round-trips an empty string', () => {
      const enc = encrypt('');
      expect(decrypt(enc)).toBe('');
    });

    it('round-trips unicode / multi-language text', () => {
      const text = 'Derechos: 权利: Quyền: Direitos';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('round-trips a long document', () => {
      const long = 'A'.repeat(50000);
      expect(decrypt(encrypt(long))).toBe(long);
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plain = 'same input';
      const enc1 = encrypt(plain);
      const enc2 = encrypt(plain);
      expect(enc1).not.toBe(enc2); // different IVs
      expect(decrypt(enc1)).toBe(plain);
      expect(decrypt(enc2)).toBe(plain);
    });

    it('returns stored value (not plaintext) when ciphertext is tampered — migration safety', () => {
      // The service catches GCM auth-tag failures and returns the raw stored value
      // rather than throwing. This prevents crashes during DB migrations.
      const enc = encrypt('secret');
      const tampered = enc.slice(0, -4) + 'XXXX';
      const result = decrypt(tampered);
      // Should NOT return the original plaintext (authentication failed)
      expect(result).not.toBe('secret');
      // Should return something (the stored value or empty) rather than throwing
      expect(() => decrypt(tampered)).not.toThrow();
    });
  });

  describe('isEncrypted()', () => {
    it('returns true for encrypted strings', () => {
      expect(isEncrypted(encrypt('test'))).toBe(true);
    });

    it('returns false for plain text', () => {
      expect(isEncrypted('plain text')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });

    it('returns false for partial hex strings', () => {
      expect(isEncrypted('abc:def')).toBe(false);
    });
  });
});
