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
  it('is a flat $75 regardless of the bail amount', () => {
    expect(BONDSMAN_LEAD_FEE_CENTS).toBe(7500);
    for (const bail of BAILS) {
      expect(bondsmanLeadFeeCents(bail)).toBe(7500);
      expect(bondsmanLeadFeeCents({ bail_amount: bail })).toBe(7500);
    }
    expect(formatLeadFee()).toBe('$75');
    expect(bondsmanLeadFeeInfo()).toMatchObject({ cents: 7500, display: '$75', model: 'flat' });
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
});

describe('every fee quote uses it', () => {
  it('outbound bot SMS quotes the same fee for every bail amount', async () => {
    const { buildBondsmanSms } = await import('../services/outbound_bot.js');
    for (const bail of [500, 30000, 750000]) {
      const sms = buildBondsmanSms({ bail_amount: bail, county: 'Davidson', state: 'TN', charges: 'DUI' });
      expect(sms).toContain('for $75.');
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
    for (const doc of ['README.md', 'BONDSMAN_OUTREACH.md']) {
      const text = read(doc);
      expect(text).not.toMatch(/\$15\s*[–-]\s*\$(1,000|400|250)/);
      expect(text).not.toMatch(/per[- ]lead[^\n]*by bail amount/i);
      expect(text).toMatch(/flat \$75/);
    }
  });
});
