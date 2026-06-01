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
| Circuit breakers | Every 15s | SEV-2 email + webhook when Anthropic/Stripe/Twilio opens |
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
