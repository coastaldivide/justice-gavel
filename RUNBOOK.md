# Justice Gavel — Incident Runbook

**Version:** 6.3.0 | **Last updated:** 2026-01-01 | **On-call contact:** engineering@justicegavel.app

---

## QUICK REFERENCE

| Service | URL | Dashboard |
|---------|-----|-----------|
| Production API | https://api.justicegavel.app | Railway |
| Health check | https://api.justicegavel.app/health | Auto |
| Sentry errors | https://sentry.io | Sentry dashboard |
| Database | Supabase | https://app.supabase.com |
| Uptime | BetterUptime | BetterUptime dashboard |

---

## INCIDENT SEVERITY LEVELS

| Level | Response time | Examples |
|-------|--------------|---------|
| SEV-1 CRITICAL | 15 min | DB down, auth broken, all users locked out |
| SEV-2 HIGH | 1 hour | AI chat down, payments failing, 50%+ error rate |
| SEV-3 MEDIUM | 4 hours | Single feature broken, elevated error rate |
| SEV-4 LOW | 24 hours | UI glitch, non-critical slow query |

---

## RUNBOOK: SEV-1 — Database Down

**Symptoms:** `/health` returns `{"db": "error"}`, all API calls fail

1. Check Supabase status: https://status.supabase.com
2. Check Railway logs: `railway logs --service justice-gavel-api`
3. Verify `DATABASE_URL` env var is set: `railway variables --service justice-gavel-api`
4. If Supabase issue: wait for resolution, tweet status update
5. If Railway issue: redeploy from last stable commit
6. Run post-recovery check: `node scripts/check-env.js`

**Recovery test:** `curl https://api.justicegavel.app/health | jq .db`

---

## RUNBOOK: SEV-2 — Anthropic AI Down

**Symptoms:** All /chat, /motions, /research endpoints return 503

1. Check circuit breaker: `/health` will show `circuit_breakers.anthropic: "OPEN"`
2. Check Anthropic status: https://status.anthropic.com
3. Circuit breaker auto-recovers after 30 seconds once Anthropic is back
4. Manual reset if needed: restart Railway service (triggers SIGTERM graceful shutdown)

**User communication:** Post status update noting AI features are temporarily unavailable.
Non-AI features (bail calculator, rights cards, attorney matching) remain fully operational.

---

## RUNBOOK: SEV-2 — Stripe Payment Failures

**Symptoms:** Subscription attempts failing, `invoice.payment_failed` webhook firing

1. Check Stripe status: https://status.stripe.com
2. Check webhook signature: `STRIPE_WEBHOOK_SECRET` env var matches Stripe dashboard
3. Check webhook endpoint is receiving: Stripe Dashboard → Developers → Webhooks
4. Run test webhook: `stripe trigger invoice.payment_failed` (Stripe CLI)
5. Check `past_due` users in DB: `SELECT count(*) FROM users WHERE subscription_status='past_due'`

**Note:** Users in `past_due` status retain full access during grace period (subscription state machine handles this automatically).

---

## RUNBOOK: SEV-1 — JWT Secret Compromised

**Symptoms:** Unauthorized access, unusual login patterns, security report

1. **IMMEDIATELY** rotate `JWT_SECRET` in Railway env vars
2. **IMMEDIATELY** rotate `JWT_REFRESH_SECRET`  
3. Run: `DELETE FROM refresh_tokens;` (invalidates all sessions)
4. All users will need to re-login (expected behavior — communicate to users)
5. Check audit_log for unusual access: `SELECT * FROM audit_log WHERE action='user.login' ORDER BY created_at DESC LIMIT 100`
6. Check `/health` — `jwt_secure` should return `true` after rotation

---

## DEPLOY PROCESS

```bash
# Normal deploy
git push origin main      # Railway auto-deploys

# Rollback
railway rollback          # Railway dashboard → Deployments → Roll back

# Force restart (clears in-memory circuit breakers)
railway restart           # Railway dashboard → Settings → Restart service
```

**Pre-deploy checklist:**
- [ ] `node scripts/check-env.js` passes
- [ ] All tests pass: `npm test`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] No high+ vulnerabilities: `npm audit`

---

## DATABASE BACKUP

Supabase takes daily backups automatically. Point-in-time recovery available on Pro plan.

**Manual backup:** Supabase Dashboard → Project → Backups → Download

**Critical tables to verify after incidents:**
- `users` — registration data
- `audit_log` — compliance trail (append-only, never delete)
- `user_disclaimer_acceptance` — legal consent trail
- `refresh_tokens` — auth tokens
- `subscriptions` — billing state

---

## AUTOMATED MONITORING — HOW IT WORKS

### What gets monitored automatically

| Monitor | Frequency | Action on failure |
|---------|-----------|-------------------|
| Memory watchdog | Every 30s | Warn at 384MB, attempt GC + cache clear at 512MB, restart at 600MB |
| DB health check | Every 60s | Auto-reconnect with exponential backoff (5 attempts), then SEV-1 alert |
| Circuit breakers | Every 15s | SEV-2 Slack alert when Anthropic/Stripe opens |
| Stale job locks | Every 15min | Auto-clear locks older than 30 minutes |
| Uncaught exceptions | Immediate | SEV-1 email + SMS before process restart |
| Payment failures | Per event | SEV-2 email on invoice.payment_failed webhook |

### Alert channels by severity

| Severity | Channel | Response time |
|----------|---------|---------------|
| SEV-1 (fatal) | Email + SMS to ONCALL_PHONE + Slack webhook | 15 minutes |
| SEV-2 (error) | Email to engineering + Slack webhook | 1 hour |
| SEV-3 (warn) | Audit log + Sentry warning | Daily review |

### Alert dedup throttle

The same alert code is suppressed for **5 minutes** after first fire.
This prevents alert storms during incident (e.g., 1,000 requests hitting a
broken endpoint won't send 1,000 emails — just one every 5 minutes).

### To set up alert channels

1. **Slack**: Create incoming webhook in Slack App settings → set `ALERT_WEBHOOK_URL`
2. **SMS**: Set `ONCALL_PHONE=+1XXXXXXXXXX` in Railway env vars
3. **Email**: `SENDGRID_API_KEY` already required — alerts sent from alerts@justicegavel.app
4. **Sentry**: Set `SENTRY_DSN` — get from sentry.io project settings

### Self-healing behaviors

**Database goes down:**
```
DB fails → auto-retry (200ms, 400ms, 800ms, 1.6s, 3.2s)
  → recovers → notifyRecovery() logged, alert cleared
  → fails 5x → notifyCritical('Database unreachable') → SEV-1 email + SMS
```

**AI (Anthropic) goes down:**
```
API call fails → circuit breaker opens after 5 failures
  → fast 503 returned to all requests (no 120s hangs)
  → notifyError('Circuit breaker OPEN: anthropic') → SEV-2 alert
  → auto-recovery test after 30s
  → recovers → notifyRecovery() → alert cleared
```

**Memory leak:**
```
heap > 384MB → notifyWarn logged
heap > 512MB → GC forced + caches cleared
  → if heap drops below 384MB: no further action
  → if heap stays above 512MB → notifyError email
heap > 600MB → notifyCritical + graceful restart
  → Railway restarts container (< 30 second downtime)
```

**CI pipeline fails on main branch:**
```
Test fails → GitHub Actions workflow fails
  → notify-failure job runs
  → Email to engineering@justicegavel.app
  → Deploy to production is blocked (main fails = no deploy)
```


## Environment Variables (Complete Reference)

Generated from codebase scan. All variables with no default will cause startup failure if missing.

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_ALERT_EMAIL` | NO | See config.js — admin_alert_email setting |
| `ADMIN_ALERT_SMS` | NO | See config.js — admin_alert_sms setting |
| `ADMIN_EMAIL` | NO | Admin notification email |
| `ADMIN_KEY` | YES | Admin API key for /api/admin routes |
| `ADMIN_PANEL_URL` | NO | URL to admin dashboard |
| `AI_CONCURRENCY` | NO | Max concurrent AI requests (default: 5) |
| `ALERT_EMAIL` | NO | See config.js — alert_email setting |
| `ALERT_EMAIL_FROM` | NO | See config.js — alert_email_from setting |
| `ALERT_WEBHOOK_URL` | NO | Slack webhook URL for SEV-1 alerts |
| `AMAZON_PAY_PUBLIC_KEY_ID` | NO | See config.js — amazon_pay_public_key_id setting |
| `ANTHROPIC_API_KEY` | YES | Claude API key for AI chat |
| `APP_OAUTH_REDIRECT` | NO | See config.js — app_oauth_redirect setting |
| `APP_SSO_REDIRECT` | NO | See config.js — app_sso_redirect setting |
| `APP_URL` | NO | See config.js — app_url setting |
| `AUTHORIZE_NET_API_LOGIN_ID` | NO | See config.js — authorize_net_api_login_id setting |
| `BASE_URL` | NO | See config.js — base_url setting |
| `BITPAY_TOKEN` | NO | See config.js — bitpay_token setting |
| `BOT_WEBHOOK_BASE_URL` | NO | See config.js — bot_webhook_base_url setting |
| `BRAINTREE_MERCHANT_ID` | NO | See config.js — braintree_merchant_id setting |
| `CLIO_CLIENT_ID` | NO | See config.js — clio_client_id setting |
| `CLIO_CLIENT_SECRET` | NO | See config.js — clio_client_secret setting |
| `COINBASE_COMMERCE_API_KEY` | NO | See config.js — coinbase_commerce_api_key setting |
| `CORS_ORIGIN` | NO | See config.js — cors_origin setting |
| `COURTLISTENER_ENABLED` | NO | See config.js — courtlistener_enabled setting |
| `COURTLISTENER_TOKEN` | NO | See config.js — courtlistener_token setting |
| `DAILY_API_KEY` | YES | Daily.co API key for video sessions |
| `DATABASE_URL` | YES | Supabase PostgreSQL connection URL |
| `DEMO_MODE` | NO | See config.js — demo_mode setting |
| `ENCRYPTION_KEY` | YES | 32-byte AES key for sensitive field encryption |
| `EXPO_ACCESS_TOKEN` | YES | Expo push notification token |
| `EXTRA_ORIGINS` | NO | See config.js — extra_origins setting |
| `FRONTEND_URL` | NO | See config.js — frontend_url setting |
| `GOOGLE_CALENDAR_CLIENT_ID` | NO | See config.js — google_calendar_client_id setting |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | NO | See config.js — google_calendar_client_secret setting |
| `GOOGLE_CLIENT_ID` | NO | Google OAuth client ID (calendar sync) |
| `GOOGLE_CLIENT_SECRET` | NO | Google OAuth secret (calendar sync) |
| `GOOGLE_PLACES_KEY` | NO | See config.js — google_places_key setting |
| `HEALTH_SCAN_CRON` | NO | See config.js — health_scan_cron setting |
| `IMANAGE_CLIENT_ID` | NO | See config.js — imanage_client_id setting |
| `IMANAGE_CLIENT_SECRET` | NO | See config.js — imanage_client_secret setting |
| `JWT_EXPIRES_IN` | NO | See config.js — jwt_expires_in setting |
| `JWT_REFRESH_EXPIRES_IN` | NO | See config.js — jwt_refresh_expires_in setting |
| `JWT_REFRESH_SECRET` | YES | Signs refresh tokens — 256-bit random |
| `JWT_SECRET` | YES | Signs access tokens — 256-bit random |
| `LIVE_EMAIL` | NO | See config.js — live_email setting |
| `LIVE_PAYMENTS` | NO | See config.js — live_payments setting |
| `LIVE_REFRESH` | NO | See config.js — live_refresh setting |
| `LIVE_SMS` | NO | See config.js — live_sms setting |
| `LOG_FORMAT` | NO | See config.js — log_format setting |
| `LOG_LEVEL` | NO | See config.js — log_level setting |
| `MYCASE_CLIENT_ID` | NO | See config.js — mycase_client_id setting |
| `MYCASE_CLIENT_SECRET` | NO | See config.js — mycase_client_secret setting |
| `NETDOCUMENTS_CLIENT_ID` | NO | See config.js — netdocuments_client_id setting |
| `NETDOCUMENTS_CLIENT_SECRET` | NO | See config.js — netdocuments_client_secret setting |
| `NODE_ENV` | YES | production | development | test |
| `NOWPAYMENTS_KEY` | NO | See config.js — nowpayments_key setting |
| `ONCALL_EMAIL` | NO | See config.js — oncall_email setting |
| `ONCALL_EMAIL_2` | NO | See config.js — oncall_email_2 setting |
| `OPENAI_API_KEY` | NO | See config.js — openai_api_key setting |
| `OUTLOOK_CLIENT_ID` | NO | See config.js — outlook_client_id setting |
| `OUTLOOK_CLIENT_SECRET` | NO | See config.js — outlook_client_secret setting |
| `PAYPAL_CLIENT_ID` | NO | See config.js — paypal_client_id setting |
| `PAYPAL_SECRET` | NO | See config.js — paypal_secret setting |
| `PORT` | NO | HTTP port (default: 3000) |
| `POSTGRES_URL` | NO | See config.js — postgres_url setting |
| `PRACTICEPANTHER_CLIENT_ID` | NO | See config.js — practicepanther_client_id setting |
| `PRACTICEPANTHER_CLIENT_SECRET` | NO | See config.js — practicepanther_client_secret setting |
| `PROVIDERS_DB` | NO | See config.js — providers_db setting |
| `RAILWAY_ENVIRONMENT` | NO | See config.js — railway_environment setting |
| `REDIS_URL` | NO | See config.js — redis_url setting |
| `REFRESH_CRON` | NO | See config.js — refresh_cron setting |
| `REFRESH_TZ` | NO | See config.js — refresh_tz setting |
| `REPORT_DIR` | NO | See config.js — report_dir setting |
| `RESEND_API_KEY` | YES | Resend email API key |
| `SCAN_QUIET` | NO | See config.js — scan_quiet setting |
| `SECRET` | NO | See config.js — secret setting |
| `SENDGRID_API_KEY` | NO | See config.js — sendgrid_api_key setting |
| `SENDGRID_FROM_EMAIL` | NO | See config.js — sendgrid_from_email setting |
| `SENTRY_DSN` | NO | See config.js — sentry_dsn setting |
| `SQUARE_ACCESS_TOKEN` | NO | See config.js — square_access_token setting |
| `STRIPE_ACH_ENABLED` | NO | See config.js — stripe_ach_enabled setting |
| `STRIPE_ADVISOR_ANNUAL_ID` | NO | See config.js — stripe_advisor_annual_id setting |
| `STRIPE_ADVISOR_PRICE_ID` | NO | See config.js — stripe_advisor_price_id setting |
| `STRIPE_CANCEL_URL` | NO | See config.js — stripe_cancel_url setting |
| `STRIPE_ESQUIRE_ANNUAL_ID` | NO | See config.js — stripe_esquire_annual_id setting |
| `STRIPE_ESQUIRE_PRICE_ID` | NO | See config.js — stripe_esquire_price_id setting |
| `STRIPE_LEGAL_PRO_ANNUAL_ID` | NO | See config.js — stripe_legal_pro_annual_id setting |
| `STRIPE_LEGAL_PRO_PRICE_ID` | NO | See config.js — stripe_legal_pro_price_id setting |
| `STRIPE_LEGAL_RADAR_ID` | NO | See config.js — stripe_legal_radar_id setting |
| `STRIPE_SECRET` | NO | See config.js — stripe_secret setting |
| `STRIPE_SUCCESS_URL` | NO | See config.js — stripe_success_url setting |
| `STRIPE_WEBHOOK_SECRET` | NO | See config.js — stripe_webhook_secret setting |
| `SUPABASE_PUBLISHABLE_KEY` | NO | See config.js — supabase_publishable_key setting |
| `SUPABASE_SERVICE_KEY` | NO | See config.js — supabase_service_key setting |
| `SUPABASE_URL` | YES | Supabase project URL |
| `UPLOAD_DIR` | NO | See config.js — upload_dir setting |
| `VAPID_PRIVATE_KEY` | NO | See config.js — vapid_private_key setting |
| `VAPID_PUBLIC_KEY` | NO | See config.js — vapid_public_key setting |
| `YELP_API_KEY` | NO | See config.js — yelp_api_key setting |
