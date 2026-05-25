#!/usr/bin/env node
/**
 * scripts/setup-stripe-products.js
 * Creates all Justice Gavel subscription products in Stripe
 * 
 * Usage:
 *   node scripts/setup-stripe-products.js
 * 
 * Requires STRIPE_SECRET in environment (already in .env)
 */

import * as dotenv from 'dotenv';
dotenv.config();

const STRIPE_KEY = process.env.STRIPE_SECRET || process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error("❌ STRIPE_SECRET not found in .env");
  process.exit(1);
}

const stripe = async (method, path, body) => {
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const text = await resp.text();
  try { return JSON.parse(text); } 
  catch { console.error("Stripe response:", text.slice(0,200)); throw new Error("Invalid JSON from Stripe"); }
};

const PRODUCTS = [
  {
    name:        "Justice Gavel 24 Hour Advisor",
    desc:        "Find lawyers & bail agents, unlimited AI legal chat, all Know Your Rights lessons, search arrest records",
    monthly:     2999,   // $9.99
    annual:      7999,  // $79.99
    mEnv:        "STRIPE_ADVISOR_PRICE_ID",
    aEnv:        "STRIPE_ADVISOR_ANNUAL_ID",
  },
  {
    name:        "Justice Gavel Legal Pro",
    desc:        "AI motion generation, legal research, expungement petition, document discovery, full case management",
    monthly:     2900,  // $29.00
    annual:      24900, // $249.00
    mEnv:        "STRIPE_LEGAL_PRO_PRICE_ID",
    aEnv:        "STRIPE_LEGAL_PRO_ANNUAL_ID",
  },
  {
    name:        "Justice Gavel Legal Radar",
    desc:        "Arrest monitoring alerts, county arrest analytics, weekly intelligence reports, charge trend & bail data",
    monthly:     1999,  // $19.99
    annual:      19900, // $199.00
    mEnv:        "STRIPE_LEGAL_RADAR_ID",
    aEnv:        "STRIPE_LEGAL_RADAR_ANNUAL_ID",
  },
  {
    name:        "Justice Gavel Esquire",
    desc:        "Full attorney dashboard, client & case management, AI motion library, firm verticals, CLE tracking",
    monthly:     4900,  // $49.00
    annual:      39900, // $399.00
    mEnv:        "STRIPE_ESQUIRE_PRICE_ID",
    aEnv:        "STRIPE_ESQUIRE_ANNUAL_ID",
  },
];

console.log("\n🔑 Connecting to Stripe...\n");

try {
  const acct = await stripe("GET", "/account");
  if (acct.error) { console.error("❌ Stripe error:", acct.error.message); process.exit(1); }
  console.log(`✅ Connected: ${acct.id} (${acct.country})\n`);
} catch(e) {
  console.error("❌ Could not connect to Stripe:", e.message);
  process.exit(1);
}

const envLines = [];

for (const p of PRODUCTS) {
  // Create product
  const prod = await stripe("POST", "/products", {
    name:        p.name,
    description: p.desc,
  });
  if (prod.error) { console.error(`❌ Product error: ${prod.error.message}`); continue; }
  console.log(`✅ ${prod.name}`);
  console.log(`   Product ID: ${prod.id}`);

  // Monthly price
  const pm = await stripe("POST", "/prices", {
    product:              prod.id,
    unit_amount:          p.monthly,
    currency:             "usd",
    "recurring[interval]":"month",
    nickname:             `${p.name} Monthly`,
  });
  console.log(`   Monthly $${(p.monthly/100).toFixed(2)}/mo → ${pm.id}`);
  envLines.push(`${p.mEnv}=${pm.id}`);

  // Annual price
  const pa = await stripe("POST", "/prices", {
    product:              prod.id,
    unit_amount:          p.annual,
    currency:             "usd",
    "recurring[interval]":"year",
    nickname:             `${p.name} Annual`,
  });
  console.log(`   Annual  $${(p.annual/100).toFixed(2)}/yr  → ${pa.id}`);
  envLines.push(`${p.aEnv}=${pa.id}`);
  console.log();
}

console.log("=" .repeat(60));
console.log("ADD THESE TO backend/.env AND RAILWAY ENVIRONMENT VARS:");
console.log("=".repeat(60));
envLines.forEach(l => console.log(l));
console.log("\n✅ Done! Copy the price IDs above into Railway.");
