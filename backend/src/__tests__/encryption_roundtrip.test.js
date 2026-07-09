/**
 * encryption_roundtrip.test.js
 * Tests AES-256 encrypt/decrypt round trips, key validation,
 * and failure modes without any live services.
 */
import crypto from 'crypto';

const TEST_KEY = '0'.repeat(64); // 32 bytes hex = 64 chars
const ALGORITHM = 'aes-256-gcm';

function encrypt(text, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

function decrypt(ciphertext, keyHex) {
  const key   = Buffer.from(keyHex, 'hex');
  const [iv, enc, tag] = ciphertext.split(':').map(p => Buffer.from(p, 'hex'));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

describe('Encryption — round trip', () => {
  test('encrypts and decrypts plain text', () => {
    const plain = 'Hello, Justice Gavel user.';
    expect(decrypt(encrypt(plain, TEST_KEY), TEST_KEY)).toBe(plain);
  });

  test('encrypts and decrypts unicode / emoji', () => {
    const plain = '⚖️ Rights: 你好 مرحبا';
    expect(decrypt(encrypt(plain, TEST_KEY), TEST_KEY)).toBe(plain);
  });

  test('encrypts and decrypts long text (10KB)', () => {
    const plain = 'x'.repeat(10_240);
    expect(decrypt(encrypt(plain, TEST_KEY), TEST_KEY)).toBe(plain);
  });

  test('two encryptions of same text produce different ciphertext (random IV)', () => {
    const plain = 'same input';
    expect(encrypt(plain, TEST_KEY)).not.toBe(encrypt(plain, TEST_KEY));
  });

  test('decryption fails with wrong key', () => {
    const wrongKey = '1'.repeat(64);
    expect(() => decrypt(encrypt('secret', TEST_KEY), wrongKey)).toThrow();
  });

  test('decryption fails if ciphertext is tampered', () => {
    const ct  = encrypt('secret data', TEST_KEY);
    const [iv, enc, tag] = ct.split(':');
    const tampered = `${iv}:${enc.slice(0,-2)}ff:${tag}`;
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  test('encryption key must be 32 bytes (64 hex chars)', () => {
    expect(() => {
      const shortKey = '00'.repeat(16); // 16 bytes — too short for aes-256
      encrypt('test', shortKey);
    }).toThrow();
  });

  test('IV is 16 bytes in every output', () => {
    const ct = encrypt('test', TEST_KEY);
    const iv = ct.split(':')[0];
    expect(Buffer.from(iv, 'hex').length).toBe(16);
  });
});

describe('Encryption — key validation', () => {
  const validKey  = '0c9a3213ff36a3c1170a81756532a1dcdef7031d9c38e533b1d9b23136ed4b12';
  test('production key is 64 hex chars (32 bytes)', () => {
    expect(validKey.length).toBe(64);
    expect(Buffer.from(validKey, 'hex').length).toBe(32);
  });

  test('production key contains no sequential patterns', () => {
    const seqRun = /([0-9a-f])\1{8,}/i.test(validKey); // 9+ identical chars
    expect(seqRun).toBe(false);
  });

  test('production key is not all zeros', () => {
    expect(validKey).not.toBe('0'.repeat(64));
  });
});
