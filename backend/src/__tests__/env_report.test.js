/**
 * env_report.test.js — scripts/lib/envReport.mjs (used by scripts/check-env.js).
 */
import { envReport } from '../../scripts/lib/envReport.mjs';

const base = { NODE_ENV: 'production', APP_ENV: 'production', JWT_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40),
  ENCRYPTION_KEY: 'a'.repeat(64), DATABASE_URL: 'postgres://db', APP_URL: 'https://justicegavel.app' };
const pub = Buffer.alloc(32, 1).toString('base64');
const full = { ...base, STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_WEBHOOK_SECRET: 'whsec_1', TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+16155550100',
  TELNYX_PUBLIC_KEY: pub, RESEND_API_KEY: 're', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's', EXPO_ACCESS_TOKEN: 'e',
  ANTHROPIC_API_KEY: 'a', SENTRY_DSN: 'https://s', ONCALL_EMAIL: 'ops@x.test' };

describe('envReport', () => {
  test('a complete production environment passes the launch check', () => {
    const r = envReport(full, { launch: true });
    expect(r.errors).toEqual([]);
    expect(r.features.filter((f) => !f.on).map((f) => f.key)).toEqual(['web_push']);
  });
  test('required keys and their strength', () => {
    const r = envReport({ ...base, JWT_SECRET: 'short', ENCRYPTION_KEY: 'nothex', DATABASE_URL: '' });
    expect(r.errors).toEqual(expect.arrayContaining(['JWT_SECRET must be ≥32 characters', 'ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32) or at least 32 random characters', 'missing DATABASE_URL']));
  });
  test('a generated (non-hex) encryption key of 32+ characters is accepted', () => {
    expect(envReport({ ...base, ENCRYPTION_KEY: 'Zm9vYmFyYmF6cXV4cXV1eHF1dXoxMjM0NTY3ODkwYWI=' }).errors).toEqual([]);
  });
  test('off features are fine before launch, errors at launch', () => {
    expect(envReport(base).errors).toEqual([]);
    expect(envReport(base, { launch: true }).errors.some((e) => e.startsWith('Text messages'))).toBe(true);
  });
  test('a half-configured feature is an error', () => {
    const r = envReport({ ...base, TELNYX_API_KEY: 'k' });
    expect(r.errors).toContain('Text messages (Telnyx: court reminders, Bond Desk): half set up — missing TELNYX_FROM_NUMBER, TELNYX_PUBLIC_KEY');
  });
  test('Stripe keys match the environment', () => {
    expect(envReport({ ...full, APP_ENV: 'staging' }).errors).toContain('STRIPE_SECRET_KEY is a LIVE key — staging must use test keys (sk_test_…)');
    expect(envReport({ ...full, STRIPE_SECRET_KEY: 'sk_test_1' }).warnings[0]).toMatch(/TEST key in production/);
    expect(envReport({ ...full, STRIPE_SECRET_KEY: 'sk_test_1' }, { launch: true }).errors[0]).toMatch(/TEST key in production/);
    expect(envReport({ ...full, STRIPE_WEBHOOK_SECRET: 'abc' }).errors).toContain('STRIPE_WEBHOOK_SECRET must start with whsec_');
  });
  test('malformed Telnyx values are caught', () => {
    const r = envReport({ ...full, TELNYX_FROM_NUMBER: '615-555-0100', TELNYX_PUBLIC_KEY: 'abc' });
    expect(r.errors).toEqual(expect.arrayContaining(['TELNYX_FROM_NUMBER must be a US number in E.164 form (+1XXXXXXXXXX)',
      'TELNYX_PUBLIC_KEY must be the base64 Ed25519 public key from Telnyx (32 bytes)']));
  });
  test('storage: Supabase, or a mounted local directory', () => {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ...noSupa } = full; void SUPABASE_URL; void SUPABASE_SERVICE_KEY;
    expect(envReport(noSupa).features.find((f) => f.key === 'storage').on).toBe(false);
    expect(envReport({ ...noSupa, ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: '/var/data/attachments' }).features.find((f) => f.key === 'storage').on).toBe(true);
  });
  test('never echoes a secret value', () => {
    const r = envReport({ ...full, APP_ENV: 'staging', JWT_SECRET: 'tiny' });
    expect(JSON.stringify(r)).not.toMatch(/sk_live_1|whsec_1|tiny/);
  });
});
