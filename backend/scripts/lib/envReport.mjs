/**
 * scripts/lib/envReport.mjs — what a deployment's environment turns on, and what is wrong.
 * Pure (takes an env object); used by scripts/check-env.js and its tests.
 *
 * Each feature lists the keys it needs ALL of. A half-configured feature (some keys set,
 * some missing) is an error — it is the usual cause of "texts silently not sent".
 * `launch: true` also fails when a feature the public launch depends on is off.
 */
export const REQUIRED = ['NODE_ENV', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL'];

export const FEATURES = [
  { key: 'payments', label: 'Payments (Stripe)', needs: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], launch: true },
  { key: 'texts', label: 'Text messages (Telnyx: court reminders, Bond Desk)', needs: ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_PUBLIC_KEY'], launch: true },
  { key: 'email', label: 'E-mail (Resend)', needs: ['RESEND_API_KEY'], launch: true },
  { key: 'storage', label: 'File storage (Bond Desk forms, signed copies, attachments)', needs: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'], alt: ['ATTACHMENTS_DIR'], launch: true },
  { key: 'push', label: 'App push notifications (Expo)', needs: ['EXPO_ACCESS_TOKEN'], launch: true },
  { key: 'web_push', label: 'Browser push (VAPID)', needs: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL'], launch: false },
  { key: 'ai', label: 'AI answers (Anthropic)', needs: ['ANTHROPIC_API_KEY'], launch: true },
  { key: 'errors', label: 'Error tracking (Sentry)', needs: ['SENTRY_DSN'], launch: true },
  { key: 'alerts', label: 'On-call alerts', needs: ['ALERT_WEBHOOK_URL'], alt: ['ONCALL_EMAIL'], launch: true },
];

const SECURITY = {
  JWT_SECRET: (v) => (v === 'dev_secret_change_me' ? 'JWT_SECRET is still the development default' : v.length >= 32 ? null : 'JWT_SECRET must be ≥32 characters'),
  JWT_REFRESH_SECRET: (v) => (v.length >= 32 ? null : 'JWT_REFRESH_SECRET must be ≥32 characters'),
  // services/encryption.js uses a 64-hex key as is and hashes any other string to 32 bytes
  // (Render's generateValue on staging): only a short key is weak.
  ENCRYPTION_KEY: (v) => (/^[0-9a-fA-F]{64}$/.test(v) || v.length >= 32 ? null : 'ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32) or at least 32 random characters'),
  NODE_ENV: (v) => (v === 'production' ? null : `NODE_ENV is '${v}' — set to 'production' for a deploy`),
};

const has = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';

/** → { appEnv, errors: [string], warnings: [string], features: [{ key, label, on, missing }] } */
export function envReport(env, { launch = false } = {}) {
  const errors = []; const warnings = [];
  const appEnv = String(env.APP_ENV || (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV || 'development')).toLowerCase();
  for (const k of REQUIRED) {
    if (!has(env, k)) { errors.push(`missing ${k}`); continue; }
    const e = SECURITY[k]?.(env[k]);
    if (e) errors.push(e);
  }
  if (env.STRIPE_SECRET && !env.STRIPE_SECRET_KEY) env = { ...env, STRIPE_SECRET_KEY: env.STRIPE_SECRET };
  const features = FEATURES.map((f) => {
    const missing = f.needs.filter((k) => !has(env, k));
    const altOn = (f.alt || []).some((k) => has(env, k));
    const on = missing.length === 0 || (altOn && f.key !== 'storage') || (f.key === 'storage' && (missing.length === 0 || (has(env, 'ATTACHMENTS_DIR') && env.ATTACHMENTS_STORAGE === 'local')));
    if (!on && missing.length < f.needs.length && !altOn) errors.push(`${f.label}: half set up — missing ${missing.join(', ')}`);
    if (!on && launch && f.launch) errors.push(`${f.label} is off — needed for launch (set ${f.needs.join(', ')})`);
    return { key: f.key, label: f.label, on, missing: on ? [] : missing };
  });
  const stripe = String(env.STRIPE_SECRET_KEY || '');
  if (appEnv === 'staging' && /^(sk|rk)_live_/.test(stripe)) errors.push('STRIPE_SECRET_KEY is a LIVE key — staging must use test keys (sk_test_…)');
  if (appEnv === 'production' && /^(sk|rk)_test_/.test(stripe)) (launch ? errors : warnings).push('STRIPE_SECRET_KEY is a TEST key in production — nobody is really charged');
  if (has(env, 'TELNYX_FROM_NUMBER') && !/^\+1\d{10}$/.test(env.TELNYX_FROM_NUMBER.trim())) errors.push('TELNYX_FROM_NUMBER must be a US number in E.164 form (+1XXXXXXXXXX)');
  if (has(env, 'TELNYX_PUBLIC_KEY')) {
    try { if (Buffer.from(env.TELNYX_PUBLIC_KEY, 'base64').length !== 32) throw new Error(); } catch { errors.push('TELNYX_PUBLIC_KEY must be the base64 Ed25519 public key from Telnyx (32 bytes)'); }
  }
  if (has(env, 'STRIPE_WEBHOOK_SECRET') && !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET)) errors.push('STRIPE_WEBHOOK_SECRET must start with whsec_');
  if (has(env, 'STRIPE_CONNECT_WEBHOOK_SECRET') && !/^whsec_/.test(env.STRIPE_CONNECT_WEBHOOK_SECRET)) errors.push('STRIPE_CONNECT_WEBHOOK_SECRET must start with whsec_');
  if (has(env, 'STRIPE_SECRET_KEY') && !has(env, 'STRIPE_CONNECT_WEBHOOK_SECRET') && appEnv === 'production') {
    warnings.push('STRIPE_CONNECT_WEBHOOK_SECRET not set — Bond Desk card payments cannot learn when an agency finishes Stripe onboarding or when a payer pays (EXTERNAL_SERVICES_SETUP.md, Stripe Connect)');
  }
  if (has(env, 'APP_URL') && !/^https:\/\//.test(env.APP_URL) && appEnv !== 'development') errors.push('APP_URL must be https:// (signing links and payment returns use it)');
  if (!has(env, 'APP_URL') && appEnv !== 'development') warnings.push('APP_URL not set — signing links default to https://justicegavel.app');
  // ⚖ settings that wait for counsel: on in production only by an explicit choice
  if (appEnv === 'production' && /^(true|1)$/i.test(String(env.CHECKIN_LOCATION_ALERTS_ENABLED || '').trim())) {
    warnings.push('CHECKIN_LOCATION_ALERTS_ENABLED is on — check-in location alerts need counsel question 2.4 answered first');
  }
  for (const [k, why] of [
    ['BOND_REARREST_ALERTS_ENABLED', 're-arrest alerts need counsel question 1.2 answered first'],
    ['CUSTODY_ALERTS_ENABLED', 'release / transfer alerts need counsel question 6.3 answered first'],
    ['BOND_AUTOPAY_ENABLED', 'automatic payment-plan charges need counsel question 3.2 answered first'],
    ['BOND_RECOVERY_SHARING_ENABLED', 'recovery-agent sharing needs counsel review of the state recovery-agent rules first'],
  ]) {
    if (appEnv === 'production' && /^(true|1)$/i.test(String(env[k] || '').trim())) warnings.push(`${k} is on — ${why}`);
  }
  return { appEnv, errors, warnings, features };
}
