# Justice Gavel — Backend API Reference

**Base URL (production):** `https://your-backend.railway.app/api`
**Base URL (development):** `http://localhost:4000/api`

All authenticated endpoints require: `Authorization: Bearer <jwt_token>`

---

## Authentication

### `POST /api/auth/register` 🌐
> ── POST /register ────────────────────────────────────────────────────────────

🌐 Public endpoint

### `POST /api/auth/login` 🌐
> ── POST /login ───────────────────────────────────────────────────────────────

🌐 Public endpoint

### `GET /api/auth/me` 🔐
> ── GET /me ───────────────────────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/auth/update-profile` 🔐
> ── POST /update-profile ──────────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/auth/forgot-password` 🌐
> ── POST /api/auth/forgot-password ───────────────────────────────────────────

🌐 Public endpoint

### `POST /api/auth/refresh` 🔐
> ── POST /api/auth/refresh — exchange valid token for a fresh one ─────────────

🔐 Requires authentication

### `DELETE /api/auth/account` 🔐
> Requires password confirmation for security.

🔐 Requires authentication

### `GET /api/auth/export` 🔐
> Returns all user data as JSON — required for GDPR/CCPA compliance

🔐 Requires authentication

---

## Providers (GPS Search)

### `GET /api/providers/nearest-city` 🌐
> ── GET /api/providers/nearest-city ──────────────────────────────────────────

🌐 Public endpoint

### `GET /api/providers/lawyers` 🌐
> ── GET /api/providers/lawyers ────────────────────────────────────────────────

🌐 Public endpoint

### `GET /api/providers/bail` 🌐
> ── GET /api/providers/bail ───────────────────────────────────────────────────

🌐 Public endpoint

### `GET /api/providers/coverage` 🌐
> GET /api/providers/coverage — returns state coverage for UI display

🌐 Public endpoint

---

## Legal Data

### `GET /api/legaldata/:type` 🔐

🔐 Requires authentication

### `GET /api/expungement/attorneys` 🌐
> Ordered by: bar_verified > gavel_level > rating

🌐 Public endpoint

### `GET /api/expungement/check` 🌐

🌐 Public endpoint

### `POST /api/expungement/referral` 🔐
> ── POST /api/expungement/referral — log a referral click ─────────────────────

🔐 Requires authentication

### `GET /api/expungement/referrals` 🔐
> ── GET /api/expungement/referrals — user's referral history ──────────────────

🔐 Requires authentication

### `POST /api/expungement/petition` 🔐
> Returns: { draft: string, disclaimer: string }

🔐 Requires authentication

### `GET /api/bail/nearby` 🌐

🌐 Public endpoint

---

## Cases

### `GET /api/cases/` 🔐

🔐 Requires authentication

### `POST /api/cases/` 🔐

🔐 Requires authentication

### `PUT /api/cases/:id` 🔐

🔐 Requires authentication

### `DELETE /api/cases/:id` 🔐

🔐 Requires authentication

### `GET /api/cases/:id/status-history` 🔐
> GET /api/cases/:id/status-history

🔐 Requires authentication

### `GET /api/cases/:id/events` 🔐
> GET /api/cases/:id/events — all events for a case, newest first

🔐 Requires authentication

### `POST /api/cases/:id/events` 🔐
> POST /api/cases/:id/events — add an event to a case

🔐 Requires authentication

### `DELETE /api/cases/:id/events/:eventId` 🔐
> DELETE /api/cases/:id/events/:eventId — remove an event

🔐 Requires authentication

### `POST /api/cases/:id/share` 🔐
> POST /api/cases/:id/share — generate a share token (7-day expiry)

🔐 Requires authentication

### `GET /api/cases/shared/:token` 🌐
> GET /api/cases/shared/:token — read-only view for family member (no auth required)

🌐 Public endpoint

### `DELETE /api/cases/:id/share` 🔐
> DELETE /api/cases/:id/share — revoke share token

🔐 Requires authentication

### `POST /api/cases/:id/invite` 🔐
> POST /api/cases/:id/invite — invite a family member by email

🔐 Requires authentication

### `GET /api/cases/:id/family-access` 🔐
> GET /api/cases/:id/family-access — list family members with access

🔐 Requires authentication

### `DELETE /api/cases/:id/family-access/:memberId` 🔐
> DELETE /api/cases/:id/family-access/:memberId — revoke access

🔐 Requires authentication

### `GET /api/cases/family` 🔐
> GET /api/cases/family — cases shared with me by family

🔐 Requires authentication

---

## AI Features

### `POST /api/chat/ask` 🔐
> ── routes ────────────────────────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/chat/stream` 🔐
> Falls back gracefully if client doesn't support SSE.

🔐 Requires authentication

### `GET /api/chat/history/:sessionId` 🔐

🔐 Requires authentication

### `DELETE /api/chat/history/:sessionId` 🔐

🔐 Requires authentication

### `POST /api/motions/generate` 🔐

🔐 Requires authentication

### `PATCH /api/motions/:id/status` 🔐
> ── PATCH /api/motions/:id/status — update filing status ─────────────────────

🔐 Requires authentication

### `GET /api/motions/history` 🔐
> ── GET /api/motions/history ──────────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/motions/history/:id` 🔐
> ── GET /api/motions/history/:id ──────────────────────────────────────────────

🔐 Requires authentication

### `DELETE /api/motions/history/:id` 🔐
> ── DELETE /api/motions/history/:id ──────────────────────────────────────────

🔐 Requires authentication

### `POST /api/motions/review` 🔐
> Returns: { issues, suggestions, score }

🔐 Requires authentication

### `POST /api/research/ask` 🔐

🔐 Requires authentication

### `GET /api/research/history` 🔐
> ── GET /api/research/history ─────────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/research/session/:id` 🔐
> ── GET /api/research/session/:id ────────────────────────────────────────────

🔐 Requires authentication

### `DELETE /api/research/session/:id` 🔐
> ── DELETE /api/research/session/:id ─────────────────────────────────────────

🔐 Requires authentication

### `GET /api/research/status` 🔐
> ── GET /api/research/status — check subscription ────────────────────────────

🔐 Requires authentication

### `POST /api/discovery/analyze` 🔐

🔐 Requires authentication

### `GET /api/discovery/history` 🔐
> ── GET /api/discovery/history ────────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/discovery/analysis/:id` 🔐
> ── GET /api/discovery/analysis/:id ──────────────────────────────────────────

🔐 Requires authentication

### `DELETE /api/discovery/analysis/:id` 🔐
> ── DELETE /api/discovery/analysis/:id ───────────────────────────────────────

🔐 Requires authentication

### `GET /api/discovery/status` 🔐
> ── GET /api/discovery/status ─────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/translate/message` 🔐

🔐 Requires authentication

### `POST /api/translate/session` 🔐
> ── POST /api/translate/session — create session ──────────────────────────────

🔐 Requires authentication

### `GET /api/translate/session/:code` 🌐
> ── GET /api/translate/session/:code — join existing session ──────────────────

🌐 Public endpoint

### `POST /api/translate/session/:code/message` 🌐
> ── POST /api/translate/session/:code/message ─────────────────────────────────

🌐 Public endpoint

### `GET /api/translate/session/:code/messages` 🌐
> Short-poll endpoint — called every 2 seconds by both sides

🌐 Public endpoint

### `POST /api/transcribe/note` 🔐

🔐 Requires authentication

### `POST /api/transcribe/text` 🔐
> Used when user types instead of speaks

🔐 Requires authentication

### `POST /api/interrogation/transcribe` 🔐
> ── POST /api/interrogation/transcribe ────────────────────────────────────────

🔐 Requires authentication

### `GET /api/interrogation/recording-law` 🌐
> Returns recording law for a given state (call before showing the recorder)

🌐 Public endpoint

### `GET /api/match/lawyers` 🔐
> ── route ─────────────────────────────────────────────────────────────────────

🔐 Requires authentication

---

## Billing

### `POST /api/billing/subscribe` 🔐

🔐 Requires authentication

### `GET /api/billing/subscription` 🔐
> ── Get subscription status ───────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/cancel` 🔐
> ── Cancel subscription ────────────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/refund` 🔐
> All refund requests logged for FTC compliance and dispute resolution.

🔐 Requires authentication

### `POST /api/billing/bondsman/profile` 🔐
> ── Bondsman: save profile ────────────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/billing/bondsman/profile` 🔐

🔐 Requires authentication

### `GET /api/billing/leads` 🔐
> ── Bondsman: get available leads ─────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/leads/:id/accept` 🔐
> ── Bondsman: accept lead (charge card) ───────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/family/connect` 🔐
> ── Family: $29 emergency connection ─────────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/quickconnect` 🔐
> Charged as a single $20 transaction. No subscription. One-time.

🔐 Requires authentication

### `POST /api/billing/consumer/subscribe` 🔐
> POST /api/billing/consumer/subscribe

🔐 Requires authentication

### `GET /api/billing/consumer/subscription` 🔐
> GET /api/billing/consumer/subscription

🔐 Requires authentication

### `GET /api/billing/admin/stats` 🔐
> ── Admin stats ────────────────────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/billing/bondsman/verified-badge/subscribe` 🔐
> POST /api/billing/bondsman/verified-badge/subscribe

🔐 Requires authentication

### `GET /api/billing/bondsman/verified-badge/status` 🔐
> GET /api/billing/bondsman/verified-badge/status

🔐 Requires authentication

### `POST /api/billing/bondsman/verified-badge/cancel` 🔐
> POST /api/billing/bondsman/verified-badge/cancel

🔐 Requires authentication

### `POST /api/billing/pi-lead/submit` 🔐
> ── Submit a PI/Civil Rights lead (from user who tapped "I Was Injured" or civil rights) ──

🔐 Requires authentication

### `GET /api/billing/pi-leads` 🔐
> ── PI/Civil attorney views available leads in their area ──────────────────

🔐 Requires authentication

### `POST /api/billing/pi-lead/accept/:id` 🔐
> ── PI attorney accepts a lead — charges their saved payment method ─────────

🔐 Requires authentication

### `POST /api/billing/webhook` 🌐

🌐 Public endpoint

### `POST /api/pay/create` 🔐

🔐 Requires authentication

### `POST /api/pay/checkout` 🔐

🔐 Requires authentication

---

## Attorney Platform

### `GET /api/attorney/cases` 🔐
> GET /api/attorney/cases — all cases assigned to this defender

🔐 Requires authentication

### `POST /api/attorney/cases/:caseId/assign` 🔐
> POST /api/attorney/cases/:caseId/assign — assign case to self or another defender

🔐 Requires authentication

### `GET /api/attorney/office` 🔐
> GET /api/attorney/office — office member list

🔐 Requires authentication

### `POST /api/attorney/office/join` 🔐
> POST /api/attorney/office/join — join an office

🔐 Requires authentication

### `GET /api/attorney/templates` 🔐
> GET /api/attorney/templates — all templates for this user's office

🔐 Requires authentication

### `POST /api/attorney/templates` 🔐
> POST /api/attorney/templates — create a new template

🔐 Requires authentication

### `PATCH /api/attorney/templates/:id/approve` 🔐
> PATCH /api/attorney/templates/:id/approve — supervisor approves a template

🔐 Requires authentication

### `GET /api/attorney/cle` 🔐
> GET /api/attorney/cle — course list with completion status

🔐 Requires authentication

### `GET /api/attorney/cle/transcript` 🔐
> GET /api/attorney/cle/transcript — CLE transcript for this attorney

🔐 Requires authentication

### `GET /api/attorney/cle/:id` 🔐
> GET /api/attorney/cle/:id — course detail with full content

🔐 Requires authentication

### `POST /api/attorney/cle/:id/complete` 🔐
> POST /api/attorney/cle/:id/complete — mark course complete, award credit

🔐 Requires authentication

### `GET /api/attorney/profile` 🔐
> GET /api/attorney/profile

🔐 Requires authentication

### `PATCH /api/attorney/profile` 🔐
> PATCH /api/attorney/profile

🔐 Requires authentication

### `GET /api/attorney/profile/availability` 🔐
> GET /api/attorney/profile/availability

🔐 Requires authentication

### `PUT /api/attorney/profile/availability` 🔐
> PUT /api/attorney/profile/availability

🔐 Requires authentication

### `POST /api/attorney/verify-bar` 🔐

🔐 Requires authentication

### `POST /api/attorney/approve-verification` 🔐
> Called by the admin team after manually confirming bar status at state bar website.

🔐 Requires authentication

### `GET /api/consultations/slots/:lawyerId` 🌐
> GET /api/consultations/slots/:lawyerId

🌐 Public endpoint

### `GET /api/consultations/` 🔐
> GET /api/consultations — user's bookings

🔐 Requires authentication

### `POST /api/consultations/book` 🔐
> POST /api/consultations/book

🔐 Requires authentication

### `POST /api/consultations/:id/cancel` 🔐
> POST /api/consultations/:id/cancel

🔐 Requires authentication

### `POST /api/consultations/callback-request` 🔐
> ── Callback request (when no slots available) ────────────────────────────────

🔐 Requires authentication

---

## Recovery & Bondsman

### `GET /api/recovery-agents/` 🔐
> ── GET /api/recovery-agents — search recovery agents ────────────────────────

🔐 Requires authentication

### `GET /api/recovery-agents/laws/:state` 🔐
> ── GET /api/recovery-agents/laws/:state ─────────────────────────────────────

🔐 Requires authentication

### `GET /api/recovery-agents/laws` 🔐
> ── GET /api/recovery-agents/laws — all states summary ───────────────────────

🔐 Requires authentication

---

## Arrests & Alerts

### `GET /api/arrests/search` 🌐
> Search by name or charge (family member looking up loved one)

🌐 Public endpoint

### `GET /api/arrests/recent` 🌐
> Recent bookings by county (for attorney/bail agent dashboards)

🌐 Public endpoint

### `GET /api/arrests/:id` 🌐
> Single arrest detail

🌐 Public endpoint

### `GET /api/arrests/stats/county/:county` 🌐
> County stats — how many arrests, breakdown by charge type

🌐 Public endpoint

### `POST /api/arrests/send-alerts` 🌐
> Manually trigger alert send (admin)

🌐 Public endpoint

### `GET /api/arrests/monitors` 🔐
> DELETE /api/arrests/monitors/:id   — remove a monitor

🔐 Requires authentication

### `POST /api/arrests/monitors` 🔐

🔐 Requires authentication

### `DELETE /api/arrests/monitors/:id` 🔐

🔐 Requires authentication

### `POST /api/alerts/` 🔐

🔐 Requires authentication

---

## Push Notifications

### `POST /api/push/token` 🔐
> POST /token — register Expo push token (also handles refresh on foreground)

🔐 Requires authentication

### `POST /api/push/test` 🔐

🔐 Requires authentication

### `GET /api/push/tip` 🌐

🌐 Public endpoint

### `POST /api/push/retention/post-purchase` 🔐
> Called after Quick Connect purchase — writes to scheduled_pushes for delivery

🔐 Requires authentication

### `GET /api/push/reminders` 🔐
> GET /api/push/reminders — returns pending court date reminders

🔐 Requires authentication

### `GET /api/push/preferences` 🔐
> POST /api/push/preferences  — update prefs

🔐 Requires authentication

### `POST /api/push/preferences` 🔐

🔐 Requires authentication

### `POST /api/push/d7-reengage` 🔐
> Message: routes to expungement screen — highest-value free feature.

🔐 Requires authentication

### `POST /api/push/send` 🔐
> ── Send push to specific user (attorney→client, system alerts) ───────────────

🔐 Requires authentication

---

## User Features

### `GET /api/saved/lawyers` 🔐

🔐 Requires authentication

### `POST /api/saved/lawyers` 🔐

🔐 Requires authentication

### `PATCH /api/saved/lawyers/:id` 🔐

🔐 Requires authentication

### `DELETE /api/saved/lawyers/:id` 🔐

🔐 Requires authentication

### `GET /api/reviews/` 🌐

🌐 Public endpoint

### `POST /api/reviews/` 🔐

🔐 Requires authentication

### `GET /api/reviews/summary` 🌐
> Used by attorney cards for quick display.

🌐 Public endpoint

### `GET /api/messages/:caseId` 🔐
> ── GET /api/messages/:caseId ─────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/messages/:caseId` 🔐
> ── POST /api/messages/:caseId ────────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/messages/:caseId/read` 🔐
> ── POST /api/messages/:caseId/read ──────────────────────────────────────────

🔐 Requires authentication

### `GET /api/messages/unread/count` 🔐
> ── GET /api/messages/unread/count ────────────────────────────────────────────

🔐 Requires authentication

### `POST /api/messages/attachment` 🔐

🔐 Requires authentication

### `POST /api/messages/bulk` 🔐
> Returns: { sent: number, results: { lawyer_id, case_id, error? }[] }

🔐 Requires authentication

### `GET /api/messages/:caseId/stream` 🔐
> The client falls back to polling if SSE is not supported.

🔐 Requires authentication

### `POST /api/feedback/` 🌐

🌐 Public endpoint

### `GET /api/feedback/summary` 🌐

🌐 Public endpoint

### `POST /api/checkins/enroll` 🔐
> ── Bondsman: enroll a defendant ──────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/checkins/enrollments` 🔐
> ── Bondsman: list their enrollments ─────────────────────────────────────────

🔐 Requires authentication

### `PUT /api/checkins/enrollments/:id` 🔐
> ── Bondsman: deactivate enrollment ──────────────────────────────────────────

🔐 Requires authentication

### `GET /api/checkins/history/:enrollmentId` 🔐
> ── Bondsman: view check-in history for one defendant ─────────────────────────

🔐 Requires authentication

### `POST /api/checkins/submit` 🔐
> ── Defendant: submit a check-in ──────────────────────────────────────────────

🔐 Requires authentication

### `GET /api/checkins/status/:enrollmentId` 🌐
> ── Defendant: get today's status ─────────────────────────────────────────────

🌐 Public endpoint

### `GET /api/checkins/my/:enrollmentId` 🌐
> ── Defendant: their check-in history ────────────────────────────────────────

🌐 Public endpoint

### `POST /api/referrals/generate` 🔐
> POST /api/referrals/generate

🔐 Requires authentication

### `POST /api/referrals/redeem` 🔐
> POST /api/referrals/redeem

🔐 Requires authentication

### `GET /api/referrals/my-code` 🔐
> GET /api/referrals/my-code

🔐 Requires authentication

### `GET /api/referrals/credit` 🔐
> GET /api/referrals/credit

🔐 Requires authentication

### `GET /api/golden-gavel/status` 🔐
> GET /api/golden-gavel/status

🔐 Requires authentication

### `GET /api/golden-gavel/eligibility` 🔐
> GET /api/golden-gavel/eligibility

🔐 Requires authentication

### `POST /api/golden-gavel/hall/opt-in` 🔐
> POST /api/golden-gavel/hall/opt-in

🔐 Requires authentication

### `GET /api/golden-gavel/hall` 🌐
> GET /api/golden-gavel/hall

🌐 Public endpoint

### `POST /api/golden-gavel/evaluate/:id` 🔐
> POST /api/golden-gavel/evaluate/:id (admin)

🔐 Requires authentication

---

## Community

### `GET /api/resources/` 🔐
> Query params: category, state, q (search), type, free, limit

🔐 Requires authentication

### `GET /api/resources/categories` 🔐
> GET /api/resources/categories — list all available categories

🔐 Requires authentication

### `GET /api/resources/:id` 🔐
> GET /api/resources/:id

🔐 Requires authentication

### `GET /api/lessons/` 🔐

🔐 Requires authentication

### `POST /api/lessons/:id/complete` 🔐

🔐 Requires authentication

### `GET /api/lessons/progress/:userId` 🔐

🔐 Requires authentication

### `GET /api/lessons/rights-card` 🌐
> Used by the frontend to render + share a wallet-sized card.

🌐 Public endpoint

### `GET /api/lessons/progress/me` 🔐
> GET /api/lessons/progress/me — current user's streak + completed count

🔐 Requires authentication

### `GET /api/advocacy/stats` 🔐

🔐 Requires authentication

### `POST /api/insurance/quote` 🔐

🔐 Requires authentication

### `GET /api/insurance/plans` 🌐

🌐 Public endpoint

---

## Court & Legal

### `GET /api/courthouses/` 🔐

🔐 Requires authentication

### `GET /api/courthouses/:id` 🔐

🔐 Requires authentication

### `POST /api/pi-leads/submit` 🌐
> ── POST /submit — consumer submits a lead ────────────────────────────────────

🌐 Public endpoint

### `GET /api/pi-leads/` 🔐
> ── GET / — attorney views available leads ────────────────────────────────────

🔐 Requires authentication

### `POST /api/pi-leads/:id/accept` 🔐
> ── POST /:id/accept — attorney accepts a lead ────────────────────────────────

🔐 Requires authentication

### `POST /api/pi-leads/profile` 🔐
> ── POST /profile — attorney creates/updates profile ─────────────────────────

🔐 Requires authentication

### `GET /api/pi-leads/profile` 🔐
> ── GET /profile ──────────────────────────────────────────────────────────────

🔐 Requires authentication

---

## Admin

### `GET /api/admin/log` 🌐
> ── Audit log routes ──────────────────────────────────────────────────────────

🌐 Public endpoint

### `GET /api/admin/log/:table/:id` 🌐

🌐 Public endpoint

### `GET /api/admin/stats` 🌐
> ── Stats ─────────────────────────────────────────────────────────────────────

🌐 Public endpoint

### `POST /api/admin/refresh` 🔐
> ── Trigger refresh ───────────────────────────────────────────────────────────

🔐 Requires authentication

---

## Webhooks

### `GET /api/jobs/:id` 🔐
> GET /api/jobs/:id — poll job status

🔐 Requires authentication

### `GET /api/jobs/stats` 🌐
> GET /api/jobs/stats — queue health (no auth — monitoring use)

🌐 Public endpoint

---

## Search

- `GET /api/search/`  🔐

---

## Environment Variables (Backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET` | Production | Stripe secret key — enables live payments |
| `STRIPE_PRICE_ID` | Production | Stripe price ID for consumer subscriptions |
| `STRIPE_WEBHOOK_SECRET` | Production | Stripe webhook signing secret |
| `ANTHROPIC_API_KEY` | AI features | Powers AI chat, motion generation, matching |
| `OPENAI_API_KEY` | AI features | Powers Whisper audio transcription |
| `SENDGRID_API_KEY` | Email | System emails and weekly digests |
| `SENTRY_DSN` | Monitoring | Crash reporting (get from sentry.io) |
| `POSTGRES_URL` | Production | PostgreSQL connection string — auto-switches from SQLite |
| `CORS_ORIGIN` | Production | Set to your production domain to restrict API access |
| `NODE_ENV` | Production | Must be `production` to activate all production guards |

## Authentication

JWT tokens are returned on login/register and expire after 30 days.
Include as: `Authorization: Bearer <token>`

## Rate Limits

| Scope | Limit | Window |
|-------|-------|--------|
| Global (all endpoints) | 200 requests | 1 minute |
| Billing / subscribe | 10 requests | 1 minute |
| AI routes (IP-based) | 50 requests | 15 minutes |
| AI routes (per-user) | 60 requests | 1 hour |

## 🟢 Legend
- 🔐 Requires `Authorization: Bearer <token>` header
- 🌐 Public endpoint — no authentication required
