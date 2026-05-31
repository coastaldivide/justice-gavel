# Uptime Monitoring Setup

## BetterUptime (free tier sufficient)
1. Go to https://betteruptime.com → Add Monitor
2. URL: https://api.justicegavel.app/health
3. Check interval: 1 minute
4. Alert after: 2 failures (avoid flapping)
5. Alert to: your phone + legal@justicegavel.app

## What the /health endpoint checks
- Database connectivity (SELECT 1)
- Stripe API key present
- Anthropic API key present

## Expected response
```json
{"status":"ok","version":"6.0.0","uptime":12345,"checks":{"db":"ok","stripe":"configured","ai":"configured"}}
```

## Incident runbook
1. /health returns 503 → Check Railway logs immediately
2. db=error → Supabase status page, check connection string in env vars
3. stripe=missing_key → STRIPE_SECRET not set in Railway env
4. ai=missing_key → ANTHROPIC_API_KEY not set in Railway env
