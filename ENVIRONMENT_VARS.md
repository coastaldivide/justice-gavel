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

## Settings that wait for counsel (⚖)

These are built and tested, but stay **off in production** until the counsel question is answered
(details in DEPLOY_ENV_SETUP.md; `node backend/scripts/check-env.js` warns when one is on in production):

| Variable | Counsel question | Unset means |
|---|---|---|
| `CHECKIN_LOCATION_ALERTS_ENABLED` | 2.4 location privacy (check-in location alerts) | off in production, on elsewhere |
| `BOND_REARREST_ALERTS_ENABLED` | 1.2 re-arrest alerts for an agent's own defendants (Bond Desk) | off in production, on elsewhere |
| `CUSTODY_ALERTS_ENABLED` | 6.3 release / transfer alerts for families who follow a booking | off in production, on elsewhere |
| `BOND_RECOVERY_SHARING_ENABLED` | state recovery-agent rules (sharing a forfeited bond with a recovery agent) | off in production, on elsewhere |
| `BOND_AUTOPAY_ENABLED` | 3.2 debt collection (Bond Desk automatic payment-plan charges, job `bd-autopay`) | off in production, on elsewhere |
