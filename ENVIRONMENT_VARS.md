# Environment Variables

Moved: **[RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md)** is the single
environment-variable reference for the backend (required vars, feature keys,
tuning knobs, arrest-feed configuration — all verified against
`backend/src/config.js` `ALL_ENV_VARS` and the code that reads them).

- Placeholder values to copy: [`backend/.env.example`](./backend/.env.example)
- Go-live sequence: [`backend/scripts/railway-checklist.md`](./backend/scripts/railway-checklist.md)

This file used to hold its own, older list, which had drifted from the code.
It was retired in favour of the one maintained reference above;
`backend/src/__tests__/env_docs_consistency.test.js` keeps that reference,
`config.js` `ALL_ENV_VARS` and both `.env.example` files in sync with the code.
