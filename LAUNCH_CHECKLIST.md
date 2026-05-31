# Justice Gavel — Pre-Launch Security Checklist

## Authentication ✅
- [x] JWT access tokens expire in 15m
- [x] Refresh tokens: single-use, 7-day, DB-stored
- [x] bcrypt rounds = 12
- [x] Ghost session protection (user existence check)
- [x] Admin routes guarded by super_admin role
- [x] Password reset rate-limited (3/hr per IP+email)

## Transport Security ✅
- [x] helmet.js: HSTS, CSP, X-Frame-Options, noSniff, referrer policy
- [x] CORS locked to production domain
- [x] TLS handled by Railway (auto-renewed)

## Data ✅
- [x] Cases soft-deleted (deleted_at)
- [x] Audit log on sensitive operations
- [x] Input validation with Zod on all critical routes
- [x] FK constraints on all user_id columns
- [x] Performance indexes on queried columns

## AI / Legal ✅
- [x] UPL disclaimer on all AI-generating screens
- [x] Prompt injection detection (INJECTION_PATTERNS)
- [x] Disclaimer versioning (CURRENT_DISCLAIMER_VERSION)
- [x] Crisis hotlines verified Jan 2026
- [x] Minor-specific content disclaimers
- [x] Attorney-client privilege notice on attorney platform

## Payments ✅
- [x] Stripe webhook signature verified (constructEvent)
- [x] Idempotency keys on all Stripe create calls
- [x] Subscription state machine (trialing→active→past_due→canceled)
- [x] Dunning emails on payment failure
- [x] calcLeadFee: NaN/negative guards

## Operations ✅
- [x] Sentry error monitoring
- [x] /health endpoint: DB + Stripe + AI checks
- [x] Graceful shutdown on SIGTERM (10s drain)
- [x] Circuit breaker: Anthropic, Stripe, Twilio, SendGrid
- [x] Refresh token cleanup scheduled job
- [x] GDPR/CCPA data export endpoint

## ⚠️ PENDING BEFORE LAUNCH
- [ ] Set all Railway env vars (see RAILWAY_ENV_SETUP.md)
- [ ] Configure Sentry DSN
- [ ] Configure BetterUptime monitor on /health
- [ ] Set STRIPE_WEBHOOK_SECRET from Stripe dashboard
- [ ] Legal consultant sign-off on state rule accuracy
- [ ] Test full payment flow in Stripe test mode
- [ ] EAS build submitted to App Store / Google Play
