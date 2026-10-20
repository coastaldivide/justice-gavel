/**
 * lead_fee_consistency.test.js — the bail-bondsman lead fee is FLAT and has one
 * source of truth (routes/billing/leadFee.js). Bail-scaled lead fees implicate
 * runner-capper / barratry statutes, so every place that charges, logs or
 * quotes the fee (billing routes, outbound bot SMS + payment links, lead
 * delivery revenue, pricing endpoint, app copy, docs) must agree.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import {
  BONDSMAN_LEAD_FEE_CENTS, bondsmanLeadFeeCents, formatLeadFee, bondsmanLeadFeeInfo,
} from '../routes/billing/leadFee.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND_SRC, '../..');
const read = (p) => fs.readFileSync(path.resolve(REPO, p), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const BAILS = [undefined, null, 0, -5, 1, 999, 4999, 5000, 24999, 25000, 99999, 100000, 250000, 1e7, NaN, Infinity];

describe('lead fee source of truth', () => {
  it('is a flat $100 regardless of the bail amount', () => {
    expect(BONDSMAN_LEAD_FEE_CENTS).toBe(10000);
    for (const bail of BAILS) {
      expect(bondsmanLeadFeeCents(bail)).toBe(10000);
      expect(bondsmanLeadFeeCents({ bail_amount: bail })).toBe(10000);
    }
    expect(formatLeadFee()).toBe('$100');
    expect(bondsmanLeadFeeInfo()).toMatchObject({ cents: 10000, display: '$100', model: 'flat' });
  });

  it('billing/_shared re-exports the same values', async () => {
    const shared = await import('../routes/billing/_shared.js');
    expect(shared.BONDSMAN_LEAD_FEE_CENTS).toBe(BONDSMAN_LEAD_FEE_CENTS);
    expect(shared.formatLeadFee).toBe(formatLeadFee);
  });

  it('the app display fallback matches the backend value', () => {
    const ts = read('frontend/src/constants/leadFee.ts');
    const m = ts.match(/export const BONDSMAN_LEAD_FEE_CENTS\s*=\s*(\d+)/);
    expect(m && Number(m[1])).toBe(BONDSMAN_LEAD_FEE_CENTS);
  });

  it('attorney lead fees: $200 PI / medical / civil rights, $100 employment, $75 ICE — app table = backend', async () => {
    const { attorneyLeadFeeCents } = await import('../routes/billing/attorneyLeadFee.js');
    const expected = { personal_injury: 20000, medical: 20000, civil_rights: 20000, employment: 10000, ice_detention: 7500 };
    for (const [type, cents] of Object.entries(expected)) {
      expect(attorneyLeadFeeCents(type)).toBe(cents);
      expect(attorneyLeadFeeCents(type, 'catastrophic')).toBe(cents);   // never severity-scaled
    }
    const ts = read('frontend/src/constants/leadFee.ts');
    const block = ts.slice(ts.indexOf('ATTORNEY_LEAD_FEE_CENTS'));
    for (const [type, cents] of Object.entries(expected)) {
      expect(block).toMatch(new RegExp(`${type}:\\s*${String(cents).replace(/(\d)(?=(\d{3})+$)/g, '$1_?')}`));
    }
  });
});

describe('every fee quote uses it', () => {
  it('outbound bot SMS quotes the same fee for every bail amount', async () => {
    const { buildBondsmanSms } = await import('../services/outbound_bot.js');
    for (const bail of [500, 30000, 750000]) {
      const sms = buildBondsmanSms({ bail_amount: bail, county: 'Davidson', state: 'TN', charges: 'DUI' });
      expect(sms).toContain('for $100.');
    }
  });

  it('GET /api/billing/bondsman/tiers publishes the flat lead fee', async () => {
    const { default: billing } = await import('../routes/billing/index.js');
    const app = express(); app.use('/api/billing', billing);
    const r = await request(app).get('/api/billing/bondsman/tiers');
    expect(r.status).toBe(200);
    expect(r.body.lead_fee).toEqual(bondsmanLeadFeeInfo());
  });

  it('no backend source computes its own bondsman lead fee', () => {
    const offenders = [];
    for (const f of walk(BACKEND_SRC)) {
      const rel = path.relative(BACKEND_SRC, f);
      const src = fs.readFileSync(f, 'utf8');
      if (/function\s+calcLeadFee\b|calcLeadFee\s*\(/.test(src)) offenders.push(`${rel}: calcLeadFee`);
      if (/FLAT_LEAD_FEE_CENTS\s*=/.test(src)) offenders.push(`${rel}: local FLAT_LEAD_FEE_CENTS`);
    }
    for (const rel of ['routes/billing/bondsman.js', 'services/outbound_bot.js']) {
      const src = fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8');
      if (/\b(2500|7500|15000|30000)\b\s*;/.test(src)) offenders.push(`${rel}: hard-coded fee literal`);
    }
    expect(offenders).toEqual([]);
  });

  it('app screens use the shared fee, not a bail-scaled table', () => {
    const dash = read('frontend/src/screens/BondsmanDashboardScreen.tsx');
    expect(dash).not.toMatch(/leadFeeLabel\(\s*lead\.bail_amount/);
    expect(dash).not.toMatch(/function leadFeeLabel/);
    expect(dash).toMatch(/from '\.\.\/constants\/leadFee'/);
    const sub = read('frontend/src/screens/SubscriptionScreen.tsx');
    expect(sub).not.toMatch(/\$25-\$300/);
    expect(sub).toMatch(/BONDSMAN_LEAD_FEE_DISPLAY/);
  });

  it('docs quote the flat fee, not a bail-scaled range', () => {
    for (const doc of ['README.md', 'docs/archive/BONDSMAN_OUTREACH.md' /* archived in step 10 */]) {
      const text = read(doc);
      expect(text).not.toMatch(/\$15\s*[–-]\s*\$(1,000|400|250)/);
      expect(text).not.toMatch(/per[- ]lead[^\n]*by bail amount/i);
      expect(text).toMatch(/flat \$100/);
    }
  });
});

// ── Attorney personal-injury lead fee: flat $200, one source of truth ────────
import { PI_LEAD_FEE_CENTS, attorneyLeadFeeCents } from '../routes/billing/attorneyLeadFee.js';

describe('personal-injury attorney lead fee', () => {
  it('is a flat $200 for every severity', () => {
    expect(PI_LEAD_FEE_CENTS).toBe(20000);
    for (const sv of ['minor', 'moderate', 'serious', 'catastrophic', undefined]) {
      expect(attorneyLeadFeeCents('Personal Injury', sv)).toBe(20000);
      expect(attorneyLeadFeeCents('personal_injury', sv)).toBe(20000);
    }
  });

  it('the app display constant matches the backend', () => {
    const ts = read('frontend/src/constants/leadFee.ts');
    const m = /PI_LEAD_FEE_CENTS\s*=\s*(\d+)/.exec(ts);
    expect(m && Number(m[1])).toBe(PI_LEAD_FEE_CENTS);
  });

  it('the lead route uses the shared fee function and no severity tiers remain (the legacy routes/pi_leads.js is gone)', () => {
    expect(fs.existsSync(path.resolve(REPO, 'backend/src/routes/pi_leads.js'))).toBe(false);
    for (const f of ['backend/src/routes/billing/pi_leads.js']) {
      const src = read(f);
      expect(src).toContain('attorneyLeadFeeCents');
      expect(src).not.toMatch(/\b(4999|14999|29999|49999)\b/);
    }
    expect(read('frontend/src/screens/PILeadScreen.tsx')).not.toMatch(/\$(49|149|299|499)\.99/);
  });
});
