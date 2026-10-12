# Justice Gavel — API Overview

**Base URL (production):** `https://api.justicegavel.app`
**Base URL (development):** `http://localhost:4000`

This is the human-readable overview. The **complete, machine-readable route
list is [`openapi.json`](./openapi.json)** — every route the app actually
mounts (roughly 560 operations), generated at runtime:

```bash
npm run generate:openapi              # from the repo root (or: cd backend && npm run generate:openapi)
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
Further markers: `x-staff-only` (needs an admin/staff account),
`x-requires-ai` (503 `ai_unavailable` without an Anthropic key),
`x-payments-gated` (503 `payments_unavailable` without Stripe), and a `451`
response on the disclaimer-gated AI routes.

| Level | How | Routes |
|---|---|---|
| `public` | No credentials | register/login/refresh, provider & bail search, courthouse and legal reference data, Stripe webhooks, `/health`, `/metrics` |
| `bearer` | `Authorization: Bearer <JWT>` | everything user-specific (the large majority) |
| `admin-key` | `X-Admin-Key: <ADMIN_KEY>` header | `/api/bot/*` (outbound-bot operator console) |

`/api/admin/*` needs **both**: a bearer token for an `admin`/`super_admin`
account **and** the `X-Admin-Key` header (the key check is inline, so the spec
shows these as `bearer` + `x-staff-only`).

- Get a token: `POST /api/auth/register` or `POST /api/auth/login` → `{ token, refreshToken, user }`.
- Access tokens live `JWT_EXPIRES_IN` (default **30 days**; the mobile app
  refreshes tokens older than 25 days, so keep it ≥ 30d).
- Refresh: `POST /api/auth/refresh` with `{ refreshToken }` → a new
  `{ token, refreshToken, user }`. Refresh tokens are single-use, stored
  hashed server-side and rotated on every use; replaying a used one revokes
  all of that user's sessions (`401 token_reuse`). Without a `refreshToken`,
  a still-valid access token in `Authorization: Bearer` is exchanged for a
  fresh pair (the mobile app's path). `POST /api/auth/logout` revokes.
- Staff-only routes are flagged `x-staff-only: true` in the spec. Takedown
  review, dispositions and research indexing re-read the user's role **from
  the database**; other role checks (including `/api/admin/*`) read the role
  claim in the access token, and `/api/admin/*` also requires `X-Admin-Key`.

## Errors

All errors are JSON with an `error` string; most also carry a machine-readable
`code`. Shapes you will see:

| Source | Body |
|---|---|
| Route-level errors | `{ "error": "<message>", "code"?: "<code>" }` |
| Body/query validation (zod) | `400 { "error": "Validation failed", "errors": [{ "field", "message", "code" }], "hint" }` |
| Unknown route | `404 { "error": "Not found", "path", "method", "hint" }` |
| Unhandled exception | `{ "error", "status", "path" }` — 5xx messages are generic in production (details go to logs/Sentry) |

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Missing, invalid or expired token (`code` e.g. `token_expired`, `invalid_refresh`, `token_reuse`) |
| `403` | Authenticated but not allowed (wrong role, not your firm/matter, staff-only) |
| `404` | Not found |
| `429` | Rate limited — honor the `Retry-After` header |
| `451` | Legal disclaimer not yet accepted (see below) |
| `500` | Server error |
| `503` | A feature's backing service is not configured — see below |

**Deliberate 503s** (feature disabled until its key is set — not outages):

| Body | Cause |
|---|---|
| `{ "error": "payments_unavailable", "message": "Payments are not available yet" }` | No `STRIPE_SECRET_KEY` — every charging/subscribing write returns this: non-GET `/api/billing/*` (except `bondsman/profile`, `pi-lead/submit` and the webhook, which never touch Stripe), `POST /api/pay/*`, and consultation booking (`POST /api/consultations/book`). Read-only GETs keep working (everyone is on the free tier). Setting the keys re-enables payments with no code change. Operations that can return it are marked `x-payments-gated: true` in `openapi.json` |
| `{ "error": "ai_unavailable", "message": "AI features are not available right now (AI provider not configured)." }` | No `ANTHROPIC_API_KEY` — AI chat, motions, research, analysis (marked `x-requires-ai: true` in the spec) |
| `{ "error": "storage_unavailable" }` | Attachment storage not configured (`ATTACHMENTS_STORAGE=off`) |

**451 — disclaimer required.** The AI endpoints (`POST /api/chat/ask`,
`POST /api/chat/stream`, `POST /api/research/ask`, `POST /api/motions/generate`)
run `requireDisclaimer` after auth. A user who has not accepted the current
legal disclaimer version gets
`451 { "error": "Legal disclaimer acceptance required.", "code": "disclaimer_required", "version", "text" }`.
The app shows `text`, then calls `POST /api/auth/disclaimer/accept`
(`GET /api/auth/disclaimer/status` reports the state). The disclaimer check
runs before the AI-configured check, so an unaccepted user sees 451 even when
AI is off.

## Rate limits

- Global: `RATE_LIMIT_PER_MIN` (default **200 req/min per IP**); `/health` and
  `/webhooks/*` are exempt.
- Login: `AUTH_RATE_LIMIT` per 15 min (default 10). Registration:
  `REGISTER_RATE_LIMIT` per hour (default 5).
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
| **Admin & ops** | `/api/admin`, `/api/bot`, `/api/audit`, `/health`, `/metrics` | staff console (bearer with admin role + admin key), bot console (admin key), health probe (DB round-trip, cached `HEALTH_CACHE_MS`; reports `version`), JSON/Prometheus metrics |

## Webhooks

- `POST /webhooks/stripe` (also `/api/webhooks/stripe`) — raw-body Stripe
  events, signature-verified with `STRIPE_WEBHOOK_SECRET` (400 without it).
- `/api/webhooks/outbound/*` — firm-managed **outgoing** webhook subscriptions
  (bearer + firm role): register HTTPS endpoints that receive HMAC-signed
  (`X-JG-Signature`) matter/time/invoice/docket/conflict events.

## Versioning

Every response carries `X-API-Version` — read at startup from
`backend/package.json` (also reported by `/health` and `/metrics`).
