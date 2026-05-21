# Justice Gavel — Launch KPI Dashboard
## Tracking period: First 90 days post-launch

### North Star Metric
**Weekly Active Users (WAU)** — users who open the app and perform at least one action.
Target: 1,000 WAU by Day 90.

### Conversion Funnel KPIs (tracked via analytics.ts events)

| Event | Day 7 Target | Day 30 Target | Day 90 Target |
|-------|-------------|---------------|---------------|
| sign_up | 500 | 2,000 | 8,000 |
| first_ai_message | 60% of signups | 65% | 70% |
| lawyer_view | 40% of active | 45% | 50% |
| consultation_booked | 5% of lawyer views | 7% | 10% |
| subscription_started | 3% of active | 5% | 8% |
| referral_shared | 2% of active | 3% | 5% |

### Retention KPIs
- **Day-1 Retention**: ≥40% (industry median for legal apps: 25%)
- **Day-7 Retention**: ≥20%
- **Day-30 Retention**: ≥12%
- **Monthly Churn (paid)**: <8%

### Revenue KPIs
- **ARPU** (Average Revenue Per User): $4.50/month
- **LTV** (Lifetime Value): $54 (12-month churn model)
- **CAC** (Customer Acquisition Cost): <$18 (target LTV:CAC ≥ 3:1)
- **MRR** at Day 90: $5,000+

### Safety & Quality KPIs
- **AI hallucination reports**: <1 per 500 messages (user-flagged)
- **App Store rating**: ≥4.3 stars within 60 days
- **Crash-free sessions**: ≥99.5% (Sentry)
- **P95 API response time**: <400ms (Railway metrics)

### Monitoring Queries (run weekly)
```sql
-- Top conversion events (last 7 days)
SELECT event, COUNT(*) as count, COUNT(DISTINCT distinct_id) as users
FROM analytics_events
WHERE server_ts >= datetime('now', '-7 days')
GROUP BY event ORDER BY count DESC;

-- Subscription conversion rate
SELECT
  (SELECT COUNT(DISTINCT distinct_id) FROM analytics_events WHERE event='subscription_started' AND server_ts >= datetime('now','-30 days')) * 100.0 /
  NULLIF((SELECT COUNT(DISTINCT distinct_id) FROM analytics_events WHERE server_ts >= datetime('now','-30 days')),0)
  AS conversion_pct;
```

### Alerts (set in Railway + Sentry)
- Sentry: crash-free session rate drops below 99%
- Railway: P95 response time exceeds 500ms for 5 consecutive minutes
- Railway: memory usage exceeds 400MB (approaching 512MB restart threshold)
- DB: push token failure rate exceeds 5% in a single batch
