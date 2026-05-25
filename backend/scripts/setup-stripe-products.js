#!/usr/bin/env node
/**
 * scripts/setup-stripe-products.js
 * Run ONCE to create Justice Gavel subscription products in Stripe
 * Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-products.js
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
if (!STRIPE_KEY) { console.error("Set STRIPE_SECRET_KEY env var"); process.exit(1); }

const stripe = async (method, path, body) => {
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return resp.json();
};

const products = [
  {
    name: "Justice Gavel Pro",
    description: "Full access to legal research, AI chat, motion generation, and expungement tools",
    env_key: "STRIPE_PRO_PRICE_ID",
    monthly: 2900, // $29/month
    annual: 24900, // $249/year
    env_annual: "STRIPE_PRO_ANNUAL_ID",
  },
  {
    name: "Justice Gavel Starter", 
    description: "Basic legal education, bail calculator, and resource finder",
    env_key: "STRIPE_STARTER_PRICE_ID",
    monthly: 999, // $9.99/month
    annual: 7999, // $79.99/year
    env_annual: "STRIPE_STARTER_ANNUAL_ID",
  },
  {
    name: "Justice Gavel Attorney",
    description: "Full attorney dashboard — motion library, client management, AI research",
    env_key: "STRIPE_ATTORNEY_PRICE_ID",
    monthly: 4900, // $49/month
    annual: 39900, // $399/year
    env_annual: "STRIPE_ATTORNEY_ANNUAL_ID",
  },
  {
    name: "Justice Gavel Consumer Intel",
    description: "Arrest monitoring, premium bail search, advanced expungement",
    env_key: "STRIPE_CONSUMER_INTEL_ID",
    monthly: 1499, // $14.99/month
    annual: null,
  },
];

console.log("Creating Stripe products for Justice Gavel...\n");
const envLines = [];

for (const product of products) {
  // Create product
  const prod = await stripe("POST", "/products", {
    name: product.name,
    description: product.description,
  });
  console.log(`✅ Product: ${prod.name} (${prod.id})`);

  // Monthly price
  const monthly = await stripe("POST", "/prices", {
    product: prod.id,
    unit_amount: product.monthly,
    currency: "usd",
    "recurring[interval]": "month",
    nickname: `${product.name} Monthly`,
  });
  console.log(`   Monthly: $${product.monthly/100}/mo → ${monthly.id}`);
  envLines.push(`${product.env_key}=${monthly.id}`);

  // Annual price
  if (product.annual) {
    const annual = await stripe("POST", "/prices", {
      product: prod.id,
      unit_amount: product.annual,
      currency: "usd",
      "recurring[interval]": "year",
      nickname: `${product.name} Annual`,
    });
    console.log(`   Annual:  $${product.annual/100}/yr → ${annual.id}`);
    if (product.env_annual) envLines.push(`${product.env_annual}=${annual.id}`);
  }
  console.log();
}

console.log("\n=== Add these to your .env / Railway env vars ===");
console.log(envLines.join("\n"));
console.log("\n✅ All Stripe products created!");
