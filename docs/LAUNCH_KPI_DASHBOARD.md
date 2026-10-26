# Justice Gavel — Launch KPI Dashboard
## Tracking period: First 90 days post-launch

### North Star Metric (changed Oct 26, 2026)
**Court dates with reminders set**, and the **appearance rate** of those dates (the "Did you make
it to court?" follow-up). This is the number a public defender office or county buys on, and it
is what the 21–26% reminder evidence is about. Target: 1,000 court dates with reminders by Day 90
in Tennessee. Weekly active users is tracked, but it is no longer the headline.

### Core path funnel (analytics.ts events, Oct 26 2026)

| Event | What it counts |
|-------|----------------|
| core_started | "Just arrested?" opened (from_guest: no account) |
| rights_viewed | A state rights card shown (state) |
| help_call_tapped | A call to a lawyer, bail agent or the public defender (kind) |
| family_shared | "Alert my family" sent |
| court_date_added | A court date saved (guest: on the phone without an account; reminders: how many) |
| record_check_started | The record-clearing check opened |
| court_attended | Reserved for the post-court follow-up text (not sent yet: needs Telnyx) |

### Conversion Funnel KPIs (tracked via analytics.ts events)

| Event | Day 7 Target | Day 30 Target | Day 90 Target |
|-------|-------------|---------------|---------------|
| sign_up | 500 | 2,000 | 8,000 |
| first_ai_message | 60% of signups | 65% | 70% |
| lawyer_view | 40% of active | 45% | 50% |
| consultation_booked | 5% of lawyer views | 7% | 10% |
| subscription_started | 3% of active | 5% | 8% |

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
- **P95 API response time**: <400ms (Render service Metrics tab)

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

### Alerts (Render + Sentry)
- Sentry: crash-free session rate drops below 99%
- Sentry (performance alert): P95 API transaction duration exceeds 500ms for 5 consecutive minutes
- Render (service → Metrics; notifications for failed deploys / instance restarts): memory usage
  above 400MB (approaching the 476MB graceful-restart threshold of the 512MB instance)
- DB: push token failure rate exceeds 5% in a single batch
