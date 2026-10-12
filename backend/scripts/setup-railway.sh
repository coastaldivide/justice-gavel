#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Justice Gavel — Railway Environment Setup Script
# Run this ONCE to configure all environment variables in Railway.
#
# Prerequisites:
#   1. Install Railway CLI: npm install -g @railway/cli
#   2. Login: railway login
#   3. Link project: railway link
#   4. Fill in YOUR VALUES below before running
#
# Usage: bash scripts/setup-railway.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Justice Gavel — Railway Environment Setup                     ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ── Safety check ──────────────────────────────────────────────────────────────
if ! command -v railway &> /dev/null; then
  echo "❌ Railway CLI not found. Install: npm install -g @railway/cli"
  exit 1
fi

echo "✅ Railway CLI found"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# FILL IN YOUR VALUES BELOW
# ══════════════════════════════════════════════════════════════════════════════

# ── SECRETS — generate fresh ones, never reuse values that were ever committed
# A previous revision of this script shipped with real secret values embedded.
# Those values are burned (they live in git history): generate NEW ones and,
# if the old ones were ever deployed, rotate them in Railway.
JWT_SECRET=""                 # openssl rand -hex 32
JWT_REFRESH_SECRET=""         # openssl rand -hex 32 (different from JWT_SECRET)
ENCRYPTION_KEY=""             # openssl rand -hex 32 — never change once data exists
ADMIN_KEY=""                  # openssl rand -hex 32

# VAPID keys — generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""

# ── FILL THESE IN (get from each service dashboard) ───────────────────────────

# Supabase (supabase.com → your project → Settings → API)
SUPABASE_URL=""               # https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=""          # supabase.com → Settings → API → anon public          # Settings → API → anon public
SUPABASE_SERVICE_KEY=""       # supabase.com → Settings → API → service_role       # Settings → API → service_role secret
DATABASE_URL=""               # supabase.com → Settings → Database → Transaction pooler               # Settings → Database → Connection string (Transaction mode)

# Anthropic (console.anthropic.com → API Keys)
ANTHROPIC_API_KEY=""          # console.anthropic.com → API Keys

# Stripe (dashboard.stripe.com → Developers → API Keys)
STRIPE_SECRET_KEY=""          # sk_live_... (or sk_test_ for testing)
STRIPE_WEBHOOK_SECRET=""      # Webhooks → your endpoint → Signing secret

# Stripe Price IDs (dashboard.stripe.com → Products)
STRIPE_ADVISOR_PRICE_ID=""
STRIPE_LEGAL_PRO_PRICE_ID=""
STRIPE_ESQUIRE_PRICE_ID=""
STRIPE_ADVISOR_ANNUAL_ID=""
STRIPE_LEGAL_PRO_ANNUAL_ID=""
STRIPE_ESQUIRE_ANNUAL_ID=""
STRIPE_LEGAL_RADAR_ID=""          # price_1Tb1vn2... monthly
STRIPE_LEGAL_RADAR_ANNUAL_ID=""   # price_1Tb1wQ2... annual

# Email (resend.com → API Keys) — without it, emails are logged, not sent
RESEND_API_KEY=""             # resend.com → API Keys
EMAIL_FROM="noreply@justicegavel.app"
ALERT_EMAIL_FROM="alerts@justicegavel.app"


# Google Places (console.cloud.google.com → APIs → Credentials)
GOOGLE_PLACES_KEY=""

# Sentry (sentry.io → Settings → Projects → your project → Client Keys)
SENTRY_DSN=""             # sentry.io → Project → DSN

# Monitoring alerts
ALERT_WEBHOOK_URL=""  # Slack incoming webhook URL (https://hooks.slack.com/...)
ONCALL_EMAIL=""               # SEV-1/SEV-2 alert recipient (no SMS provider is wired)

# Expo (expo.dev → Account → Access Tokens)
EXPO_ACCESS_TOKEN=""       # expo.dev → Access Tokens

# ── CORE SETTINGS ─────────────────────────────────────────────────────────────
NODE_ENV="production"
# Keep >= 30d: the mobile app refreshes tokens older than 25 days
JWT_EXPIRES_IN="30d"
JWT_REFRESH_EXPIRES_IN="60d"
FRONTEND_URL="https://justicegavel.app"
CORS_ORIGIN="https://justicegavel.app"
SENTRY_ENVIRONMENT="production"
VAPID_EMAIL="admin@justicegavel.app"
DEMO_MODE="false"
# Features are actually gated on their keys (Stripe/Resend); these flags are legacy
LIVE_EMAIL="true"
LIVE_PAYMENTS="true"
LIVE_REFRESH="true"
HEALTH_SCAN_CRON="0 6,18 * * *"
REFRESH_TZ="America/Chicago"
COURTLISTENER_ENABLED="true"

# ══════════════════════════════════════════════════════════════════════════════
# SET VARIABLES IN RAILWAY
# ══════════════════════════════════════════════════════════════════════════════

echo "Setting environment variables in Railway..."
echo "(Each one takes a moment)"
echo ""

set_var() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "  ⏭  $name — SKIPPED (empty, fill in your value)"
    return
  fi
  railway variables --set "$name=$value" 2>&1 | grep -v "^$" || true
  echo "  ✅ $name"
}

# Core
set_var "NODE_ENV"              "$NODE_ENV"
set_var "JWT_SECRET"            "$JWT_SECRET"
set_var "JWT_REFRESH_SECRET"    "$JWT_REFRESH_SECRET"
set_var "JWT_EXPIRES_IN"        "$JWT_EXPIRES_IN"
set_var "JWT_REFRESH_EXPIRES_IN" "$JWT_REFRESH_EXPIRES_IN"
set_var "ENCRYPTION_KEY"        "$ENCRYPTION_KEY"
set_var "ADMIN_KEY"             "$ADMIN_KEY"
set_var "FRONTEND_URL"          "$FRONTEND_URL"
set_var "CORS_ORIGIN"           "$CORS_ORIGIN"
set_var "DEMO_MODE"             "$DEMO_MODE"

# Database
set_var "SUPABASE_URL"          "$SUPABASE_URL"
set_var "SUPABASE_ANON_KEY"     "$SUPABASE_ANON_KEY"
set_var "SUPABASE_SERVICE_KEY"  "$SUPABASE_SERVICE_KEY"
set_var "DATABASE_URL"          "$DATABASE_URL"

# AI
set_var "ANTHROPIC_API_KEY"     "$ANTHROPIC_API_KEY"

# Payments
set_var "STRIPE_SECRET_KEY"            "$STRIPE_SECRET_KEY"
set_var "STRIPE_WEBHOOK_SECRET"        "$STRIPE_WEBHOOK_SECRET"
set_var "STRIPE_ADVISOR_PRICE_ID"      "$STRIPE_ADVISOR_PRICE_ID"
set_var "STRIPE_LEGAL_PRO_PRICE_ID"    "$STRIPE_LEGAL_PRO_PRICE_ID"
set_var "STRIPE_ESQUIRE_PRICE_ID"      "$STRIPE_ESQUIRE_PRICE_ID"
set_var "STRIPE_ADVISOR_ANNUAL_ID"     "$STRIPE_ADVISOR_ANNUAL_ID"
set_var "STRIPE_LEGAL_PRO_ANNUAL_ID"   "$STRIPE_LEGAL_PRO_ANNUAL_ID"
set_var "STRIPE_ESQUIRE_ANNUAL_ID"     "$STRIPE_ESQUIRE_ANNUAL_ID"
set_var "STRIPE_LEGAL_RADAR_ID"        "$STRIPE_LEGAL_RADAR_ID"
set_var "LIVE_PAYMENTS"                "$LIVE_PAYMENTS"

# Email
set_var "RESEND_API_KEY"        "$RESEND_API_KEY"
set_var "EMAIL_FROM"            "$EMAIL_FROM"
set_var "ALERT_EMAIL_FROM"      "$ALERT_EMAIL_FROM"
set_var "LIVE_EMAIL"            "$LIVE_EMAIL"

# Push
set_var "EXPO_ACCESS_TOKEN"     "$EXPO_ACCESS_TOKEN"
set_var "VAPID_PUBLIC_KEY"      "$VAPID_PUBLIC_KEY"
set_var "VAPID_PRIVATE_KEY"     "$VAPID_PRIVATE_KEY"
set_var "VAPID_EMAIL"           "$VAPID_EMAIL"

# Maps
set_var "GOOGLE_PLACES_KEY"     "$GOOGLE_PLACES_KEY"

# Monitoring
set_var "SENTRY_DSN"            "$SENTRY_DSN"
set_var "SENTRY_ENVIRONMENT"    "$SENTRY_ENVIRONMENT"
set_var "ALERT_WEBHOOK_URL"     "$ALERT_WEBHOOK_URL"
set_var "ONCALL_EMAIL"          "$ONCALL_EMAIL"

# Health scan
set_var "HEALTH_SCAN_CRON"      "$HEALTH_SCAN_CRON"
set_var "REFRESH_TZ"            "$REFRESH_TZ"
set_var "LIVE_REFRESH"          "$LIVE_REFRESH"
set_var "COURTLISTENER_ENABLED" "$COURTLISTENER_ENABLED"

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "DONE. Running environment validation..."
echo "══════════════════════════════════════════════════════════════════"
echo ""

# Run the env check via Railway (runs in the deployed environment)
railway run node scripts/check-env.js 2>&1 || true

echo ""
echo "Next steps:"
echo "  1. Fill in any SKIPPED values above and re-run this script"
echo "  2. Set up Stripe Webhook: dashboard.stripe.com → Webhooks"
echo "     URL: https://api.justicegavel.app/webhooks/stripe"
echo "  3. Verify health: curl https://api.justicegavel.app/health"
echo "  4. Check Sentry for first error reports"
echo ""
