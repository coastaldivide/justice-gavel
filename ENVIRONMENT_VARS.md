# Environment Variables

Moved: **[DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md)** is the single
environment-variable reference for the backend (required vars, feature keys,
tuning knobs, arrest-feed configuration — all verified against
`backend/src/config.js` `ALL_ENV_VARS` and the code that reads them).

- Placeholder values to copy: [`backend/.env.example`](./backend/.env.example)
- Go-live sequence: [`backend/scripts/go-live-checklist.md`](./backend/scripts/go-live-checklist.md)
- Render Blueprint: [`render.yaml`](./render.yaml)

This file used to hold its own, older list, which had drifted from the code.
It was retired in favour of the one maintained reference above;
`backend/src/__tests__/env_docs_consistency.test.js` keeps that reference,
`config.js` `ALL_ENV_VARS` and both `.env.example` files in sync with the code.

Court-date texts for Bond Desk and "Did you make it to court?" (October 2026) add no new
variables: they use the Telnyx settings (`TELNYX_*`), `APP_URL` for the missed-court link and
`REMINDERS_ENABLED` for the 5-minute job — see DEPLOY_ENV_SETUP.md.
Help getting to court, phone verification and published results (migration 40) add the phone-line
settings `TELNYX_VOICE_ENABLED` (default off), `TELNYX_VOICE_NUMBER`, the optional voices
`TELNYX_VOICE_EN` / `TELNYX_VOICE_ES`, `PHONE_LINE_TIME_ZONE`, and the optional `PHONE_CODE_SECRET`
(phone-verification codes are stored only as an HMAC) — see DEPLOY_ENV_SETUP.md and docs/PHONE_LINE.md.

The AI gateway (November 2026, migration 44, docs/AI_PLATFORM.md) adds per-class routing
(`AI_MODEL_QUICK|STANDARD|DEEP`, `AI_EFFORT_*`, `AI_THINKING_*`, `AI_THINKING_HEADROOM_*`), refusal fallback
(`AI_FALLBACK`, `AI_FALLBACK_MODEL`), prompt caching (`AI_CACHE`, `AI_CHAT_CACHE_TTL`), preflight limits
(`AI_COUNT_TOKENS_THRESHOLD`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_REQUEST_USD`), tracing (`AI_TRACE_PROPAGATION`) and the
hourly AI alert (`AI_ALERT_MIN_CALLS`, `AI_ALERT_ERROR_PCT`, `AI_ALERT_REFUSAL_PCT`). Every one has a working default;
see DEPLOY_ENV_SETUP.md. Verified citations (step 2, migration 45, docs/AI_PLATFORM.md §8) add only
`RAG_MIN_SIMILARITY` (default 0.35: research-library passages below it are not sent to the AI).
Source re-checks and batches (step 3, migration 46, docs/AI_PLATFORM.md §9–§10) add `AI_BATCHES` (on), `AI_BATCH_MAX_USD`
(10 — per-batch worst-case cap, also applied to retry batches), `AI_BATCH_MAX_ATTEMPTS` (3), `AI_BATCH_HANDLER_ATTEMPTS` (3 — how many
times a batch's result handler may fail on one item before that item is recorded as failed), `SOURCE_CHECK_ENABLED` (on — the Sunday run),
`SOURCE_CHECK_MAX_ROWS` (100 per run), `SOURCE_CHECK_SKIP_DAYS` (30), `SOURCE_CHECK_MAX_FETCHES` (2),
`SOURCE_CHECK_PROPOSAL_FETCHES` (4) and `SOURCE_CHECK_MAX_CONTENT_TOKENS` (20,000). All have working defaults and do
nothing without `ANTHROPIC_API_KEY`. The official-domain allow-list is code, not env: `backend/src/ai/sourceDomains.js`.
Documents (step 4, migration 47, docs/AI_PLATFORM.md §11) add `AI_FILES_API` (unset: **on in development, off when
`NODE_ENV=production`** — the Anthropic Files API is not ZDR / HIPAA eligible, so turning it on in production is an owner
decision; off means documents are sent inline, which always works), `AI_FILES_TTL_DAYS` (30 — expiry of each uploaded copy,
1 hour … 90 days; the daily `ai-files-cleanup` job deletes copies earlier when their document goes), `COURT_PAPER_READER`
(on — "Read my court paper"; off → 503 and the app offers "add by hand"), `COURT_PAPER_MAX_MB` (8), `COURT_PAPER_MAX_PAGES`
(10), `COURT_PAPER_READS_PER_HOUR` (10) and `COURT_PAPER_READS_PER_DAY` (20) per person.
Long chats (step 5, migration 48, docs/AI_PLATFORM.md §12) add `AI_MEMORY` (on — when a chat, defender chat or research
conversation passes the threshold, its older turns are summarised into a recap made from the person's own messages, which
they can see and delete under "What the assistant remembers"; off = the last 20 rows are sent, as before),
`AI_MEMORY_THRESHOLD_TOKENS` (16,000 input tokens, measured with the token-count preflight; 4,000–140,000) and
`AI_MEMORY_KEEP_TURNS` (3 recent exchanges always sent word for word; 1–10). Word / PDF downloads of drafts (step 5,
§13) need no setting.

## Settings that wait for counsel (⚖)

These are built and tested, but stay **off in production** until the counsel question is answered
(details in DEPLOY_ENV_SETUP.md; `node backend/scripts/check-env.js` warns when one is on in production):

| Variable | Counsel question | Unset means |
|---|---|---|
| `CHECKIN_LOCATION_ALERTS_ENABLED` | 2.4 location privacy (check-in location alerts) | off in production, on elsewhere |
| `BOND_REARREST_ALERTS_ENABLED` | 1.2 re-arrest alerts for an agent's own defendants (Bond Desk) | off in production, on elsewhere |
| `CUSTODY_ALERTS_ENABLED` | 6.3 release / transfer alerts for families who follow a booking | off in production, on elsewhere |
| `BOND_RECOVERY_SHARING_ENABLED` | state recovery-agent rules (sharing a forfeited bond with a recovery agent) | off in production, on elsewhere |
| `PUBLIC_DEFENDER_CHANNEL_ENABLED` | 3.2 (who is the sender, consent) and 6.1 (privacy) — public defender offices texting their clients | off in production, on elsewhere |

Public defender prices (docs/PUBLIC_DEFENDER.md): `PD_SETUP_FEE_CENTS` (default 2000000 = $20,000, first invoice only) and `PD_CLIENT_YEAR_CENTS` (default 200 = $2.00 per active client per year).
| `BOND_AUTOPAY_ENABLED` | 3.2 debt collection (Bond Desk automatic payment-plan charges, job `bd-autopay`) | off in production, on elsewhere |
