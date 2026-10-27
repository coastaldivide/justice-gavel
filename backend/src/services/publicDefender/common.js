/**
 * services/publicDefender/common.js — shared pieces of the public defender channel (A11,
 * ⚖ counsel questions 3.2 and 6.1, PUBLIC_DEFENDER_CHANNEL_ENABLED; docs/PUBLIC_DEFENDER.md).
 */
import crypto from 'node:crypto';
import { DEFAULT_TIME_ZONE, countyTimeZone, stateTimeZone } from '../../utils/timezone.js';
import { SUPPORTED_LANGS } from '../../i18n/index.js';

export class PdError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

export const LANGS = SUPPORTED_LANGS;
export const ROLES = Object.freeze(['admin', 'staff']);
export const COURT_STATUSES = Object.freeze(['scheduled', 'attended', 'missed', 'rescheduled', 'cancelled']);
export const INVITE_DAYS = 14;
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const appUrl = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const inviteLink = (token) => `${appUrl()}/pd/join/${token}`;

/**
 * The consent-basis statement an office admin ticks before the office's clients are texted.
 * Word for word the English text the app shows (frontend i18n pd_consent_statement; a test keeps
 * them equal). The snapshot is stored with who ticked it and when.
 */
export const CONSENT_BASIS_TEXT = 'These clients gave this office their number and agreed to receive texts about their case.';

/** The office's zone: its county → its state → DEFAULT_TIME_ZONE. */
export function officeTimeZone({ state, county } = {}) {
  return countyTimeZone(state, county) || stateTimeZone(state) || DEFAULT_TIME_ZONE;
}

const centsEnv = (value, fallback) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_00 ? n : fallback;
};

/**
 * Prices of the annual invoice (owner decision; change with the settings):
 *   PD_SETUP_FEE_CENTS    one-time setup fee, on the office's first invoice (default $20,000)
 *   PD_CLIENT_YEAR_CENTS  per active client per year (default $2.00)
 * Texts are a platform cost included in these fees (never billed per text).
 */
export function pdPrices() {
  return {
    setup_cents: centsEnv(process.env.PD_SETUP_FEE_CENTS, 2_000_000),
    per_client_cents: centsEnv(process.env.PD_CLIENT_YEAR_CENTS, 200),
  };
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')) && String(s).length <= 254;
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
export const maskPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : '•••'; };
