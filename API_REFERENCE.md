# Justice Gavel — API Overview

**Base URL (production):** `https://api.justicegavel.app`
**Base URL (development):** `http://localhost:4000`

This is the human-readable overview. The **complete, machine-readable route
list is [`openapi.json`](./openapi.json)** — 475 paths / 559 operations,
generated from the routes the app actually mounts:

```bash
node scripts/generate-openapi.mjs     # from the repo root — regenerates openapi.json
```

`backend/src/__tests__/openapi_drift.test.js` fails CI whenever `openapi.json`
and the mounted routes drift (operation count, method+path set, and auth
marking are all compared), so the spec is always current. Import it into
Postman (File → Import) or generate typed clients with
`node scripts/generate-sdk.mjs [language]`.

---

## Authentication

Three access levels. Every operation in `openapi.json` carries an `x-auth`
field (`bearer`, `admin-key` or `public`) and a matching `security` entry.

| Level | How | Routes |
|---|---|---|
| `public` | No credentials | 74 operations: register/login/refresh, provider & bail search, courthouse and legal reference data, Stripe webhooks, `/health`, `/metrics` |
| `bearer` | `Authorization: Bearer <JWT>` | 485 operations — everything user-specific |
| `admin-key` | `X-Admin-Key: <ADMIN_KEY>` header | `/api/bot/*` (outbound-bot operator console) |

- Get a token: `POST /api/auth/register` or `POST /api/auth/login` → `{ token, refreshToken }`.
- Access tokens live `JWT_EXPIRES_IN` (default **30 days**; the mobile app
  refreshes tokens older than 25 days, so keep it ≥ 30d).
- Refresh: `POST /api/auth/refresh` (bearer token + single-use `refreshToken`;
  refresh tokens are rotated on every use and stored server-side).
- Staff-only routes (e.g. `/api/admin/*`, takedown review) additionally check
  the user's role **in the database** — never the token — and are flagged
  `x-staff-only: true` in the spec.

## Errors

All errors are JSON: `{ "error": "<message>" }` (validation errors add a
`fields` object naming the offending fields).

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Missing or invalid token |
| `403` | Authenticated but not allowed (wrong role, not your firm/matter, staff-only) |
| `404` | Not found |
| `429` | Rate limited — honor the `Retry-After` header |
| `500` | Server error (logged + Sentry; generic message in production) |
| `503` | A feature's backing service is not configured — see below |

**Deliberate 503s** (feature disabled until its key is set — not outages):

| Body | Cause |
|---|---|
| `{ "error": "payments_unavailable" }` | No `STRIPE_SECRET_KEY` — every billing/checkout endpoint returns this until Stripe is configured |
| `{ "error": "ai_unavailable" }` | No `ANTHROPIC_API_KEY` — AI chat/motions/research/analysis |
| `{ "error": "storage_unavailable" }` | Attachment storage not configured (`ATTACHMENTS_STORAGE=off`) |

## Rate limits

- Global: `RATE_LIMIT_PER_MIN` (default **200 req/min per IP**); `/health` and
  Stripe webhooks exempt.
- Login: 10 / 15 min. Registration: 5 / hour.
- Per-user limiters on hot authenticated routes (default 10/min, higher where
  documented) and stricter per-user limits on AI endpoints.
- Responses use standard `RateLimit-*` headers plus `Retry-After` on 429.

## Pagination & caching

- List endpoints take `limit` + `page`. Providers (`/api/providers/lawyers`,
  `/api/providers/bail`) cap `limit` at **50**; arrests search caps at 100,
  recent at 500. Responses are always bounded pages.
- Responses are gzip-compressed with strong ETags; provider GPS responses
  carry `Cache-Control: private, max-age=60`. All other `/api/*` responses are
  `no-store`.

## Resource groups

The spec's `tags` mirror the mount points. The main groups:

| Group | Mount | What it covers |
|---|---|---|
| **Auth & account** | `/api/auth` | register, login, refresh, profile, ToS/disclaimer acceptance, GDPR export + delete |
| **AI features** | `/api/chat`, `/api/motions`, `/api/research`, `/api/discovery`, `/api/translate`, `/api/transcribe`, `/api/interrogation`, `/api/jobs` | Claude-backed chat (sync + stream), motion drafting, legal research, discovery analysis, translation, Whisper transcription, async job polling |
| **Cases & matters** | `/api/cases`, `/api/matters`, `/api/docket`, `/api/time`, `/api/privilege`, `/api/conflicts`, `/api/matter-intelligence` | consumer case files and the attorney-side practice management stack |
| **Messaging** | `/api/messages` | AES-256-GCM encrypted case threads + attachments (polling, no realtime channel) |
| **Providers** | `/api/providers`, `/api/consultations`, `/api/match`, `/api/reviews`, `/api/saved` | lawyer/bail-agent search (GPS + city), booking, matching, reviews |
| **Arrests & alerts** | `/api/arrests`, `/api/alerts`, `/api/family` | arrest search/ingest (operator-configured `ARREST_FEED_URLS` only), monitors, takedown requests (users file, staff review), family connect |
| **Billing** | `/api/billing`, `/api/pay`, `/api/pi-leads` | Stripe subscriptions + flat lead fees — bondsman $100, personal injury $200, civil rights $200, employment $100, ICE detention $75; **503 `payments_unavailable` until Stripe keys are set** |
| **Attorney platform** | `/api/attorney`, `/api/firms`, `/api/firm-verticals`, `/api/firm-acquisition`, `/api/sso`, `/api/integrations` | dashboards, firm management, SAML SSO, Clio/MyCase/iManage/NetDocuments/calendar OAuth |
| **Legal reference** | `/api/legaldata`, `/api/courthouses`, `/api/bail`, `/api/expungement`, `/api/immigration`, `/api/lessons`, `/api/resources`, `/api/hague-contacts` | statutes, bail schedules, courthouses, KYR lessons, expungement rules |
| **Community** | `/api/forum`, `/api/golden-gavel`, `/api/advocacy`, `/api/impact`, `/api/legal-aid` | forum, recognitions, legal-aid directory |
| **Bar prep** | `/api/bar-prep`, `/api/admin/bar-prep` | question bank, sessions, spaced repetition, admin import |
| **Checkins & pretrial** | `/api/checkins`, `/api/pretrial`, `/api/bondsman` | pretrial check-ins, bondsman CRM |
| **Push & notifications** | `/api/push`, `/api/webpush` | Expo push + web push (VAPID) |
| **Admin & ops** | `/api/admin`, `/api/bot`, `/api/audit`, `/health`, `/metrics` | staff console (bearer + DB-checked role), bot console (admin key), health probe (DB round-trip, cached `HEALTH_CACHE_MS`), JSON/Prometheus metrics |

## Webhooks

- `POST /webhooks/stripe` (also `/api/webhooks/stripe`) — raw-body Stripe
  events, signature-verified with `STRIPE_WEBHOOK_SECRET` (400 without it).
- `POST /api/webhooks/outbound` — outbound-bot delivery callbacks.

## Versioning

Every response carries `X-API-Version` — read at startup from
`backend/package.json` (also reported by `/health` and `/metrics`).
