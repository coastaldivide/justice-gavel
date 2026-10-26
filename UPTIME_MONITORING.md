# Uptime Monitoring Setup

## BetterUptime (free tier sufficient)
1. Go to https://betteruptime.com → Add Monitor
2. URL: https://api.justicegavel.app/health
3. Check interval: 1 minute
4. Alert after: 2 failures (avoid flapping)
5. Alert to: your phone + engineering@justicegavel.app

`/health` is exempt from rate limiting and caches its DB probe for
`HEALTH_CACHE_MS` (default 5 s), so a 1-minute poller costs at most one
`SELECT 1` per window.

## What /health checks
- Database connectivity: a real `SELECT 1` — **200 only when it succeeds, 503 otherwise**
- Feature configuration (informational): `features.ai` (Anthropic key),
  `features.payments` (Stripe key), `features.email` (Resend key)

## Expected response (200)
```json
{
  "ok": true, "status": "ok", "db": "ok",
  "version": "8.7.61", "uptime_s": 12345,
  "features": { "ai": true, "payments": false, "email": false }
}
```
(plus `ts`, `latency_ms`, `db_checked_at`, `db_cached`, `queue`. `version`
comes from backend/package.json.)

## Incident response
1. 503 → `{"db":"error"}` → follow RUNBOOK.md "SEV-1 — Database Down"
2. `features.payments: false` → `STRIPE_SECRET_KEY` not set — **expected**
   until payments launch, not an incident
3. `features.ai: false` → `ANTHROPIC_API_KEY` not set in the Render env
4. Deeper metrics (memory, AI queue, pg pool): https://api.justicegavel.app/metrics — send `Authorization: Bearer <METRICS_TOKEN>` (falls back to the ADMIN_KEY when METRICS_TOKEN is not set)
