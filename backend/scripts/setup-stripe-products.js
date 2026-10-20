#!/usr/bin/env node
/**
 * scripts/setup-stripe-products.js — create the Stripe products and prices for
 * every plan the app sells, FROM the app's own price list
 * (src/routes/billing/plans.js: TIERS + BONDSMAN_TIERS). Nothing is typed in
 * twice, so the price shown in the app is the price Stripe charges.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe-products.js [--dry-run]
 *
 * Prints the env lines (STRIPE_*_ID=price_...) to add to the server's
 * environment. The server also checks each configured price against the plan
 * at run time (services/stripeBilling.js chargeItem): a price id whose amount or
 * interval differs is not used.
 */
import * as dotenv from 'dotenv';
import { TIERS, BONDSMAN_TIERS, chargeFor, bondsmanCharge } from '../src/routes/billing/plans.js';
dotenv.config();

const DRY = process.argv.includes('--dry-run');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
if (!STRIPE_KEY && !DRY) {
  console.error('STRIPE_SECRET_KEY is not set (use --dry-run to only print the plan list).');
  process.exit(1);
}

const stripe = async (method, path, body) => {
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await resp.json().catch(() => ({ error: { message: `HTTP ${resp.status}` } }));
  if (json.error) throw new Error(json.error.message);
  return json;
};

// One entry per Stripe price: { product, env, cents, interval }.
const prices = [];
for (const [key, t] of Object.entries(TIERS)) {
  if (t.legacy || !t.price_env) continue;
  const c = chargeFor(key);
  prices.push({ product: `Justice Gavel ${t.name.replace(/^Justice Gavel\s+/, '').replace(/\s*\(Annual\)$/, '')}`, env: t.price_env, cents: c.cents, interval: c.interval, key });
}
for (const [key, t] of Object.entries(BONDSMAN_TIERS)) {
  for (const billing of ['monthly', 'annual']) {
    const c = bondsmanCharge(key, billing);
    const envName = billing === 'annual' ? t.annual_price_env : t.price_env;
    if (c && envName) prices.push({ product: `Justice Gavel ${t.name}`, env: envName, cents: c.cents, interval: c.interval, key: `${key}${billing === 'annual' ? '_annual' : ''}` });
  }
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
for (const p of prices) console.log(`${p.key.padEnd(16)} ${money(p.cents).padStart(10)}/${p.interval}  → ${p.env}  (${p.product})`);
if (DRY) process.exit(0);

const productIds = new Map();
const envLines = [];
for (const p of prices) {
  if (!productIds.has(p.product)) productIds.set(p.product, (await stripe('POST', '/products', { name: p.product })).id);
  const price = await stripe('POST', '/prices', {
    product: productIds.get(p.product), unit_amount: String(p.cents), currency: 'usd',
    'recurring[interval]': p.interval, nickname: `${p.product} ${p.interval === 'year' ? 'Annual' : 'Monthly'}`,
    'metadata[plan]': p.key,
  });
  envLines.push(`${p.env}=${price.id}`);
}
console.log('\nAdd these to the server environment:\n');
envLines.forEach(l => console.log(l));
