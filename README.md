# Justice Gavel

> *Justice, in your hands.*

---

## Phase Status

**Current: Phase 1 — Perfect the Platform** `v5.82.0`

Phase 1 is complete when the platform runs defect-free in production for 90 days.
Phase 2 territory (trust accounting, citator, PACER, client portal, e-discovery)
is documented in [`PHASE_2_ROADMAP.md`](./PHASE_2_ROADMAP.md) and locked until then.

---

Mobile legal services platform for defendants, families, and criminal defense attorneys.
Built with React Native (Expo) + Node.js/Express + SQLite + Claude AI.

---

## Architecture

```
JailToBail/
├── frontend/          # React Native (Expo) app — iOS, Android, Web
│   ├── app.json       # App config — UPDATE apiBase before building
│   ├── src/
│   │   ├── screens/   # 45 screens
│   │   ├── components/
│   │   ├── constants/ # Theme, colors, fonts
│   │   ├── i18n/      # EN, ES, PT, VI
│   │   └── services/  # API client, location, storage
│   └── assets/        # icon.png, splash.png (REQUIRED — export from logo.svg)
│
└── backend/           # Node.js/Express API
    ├── .env           # API keys — see .env.example
    └── src/
        ├── routes/    # 34 route files
        ├── services/  # Scheduler, encryption, alerts
        └── db/        # SQLite schema + migrations
```

## Quick start

```bash
# Backend
cd backend && npm install
cp .env.example .env   # Add API keys
node src/db/index.js   # Init database
npm start              # Starts on :4000

# Frontend
cd frontend && npm install
# Edit app.json: set apiBase to your backend URL
npx expo start
```

## Before building for the App Store

1. Set `ANTHROPIC_API_KEY`, `STRIPE_SECRET`, `OPENAI_API_KEY` in `backend/.env`
2. Deploy backend to Railway/Render — update `apiBase` in `frontend/app.json`
3. Export `logo.svg` → `icon.png` (1024×1024), `splash.png`, `adaptive-icon.png`
4. Create Apple Developer ($99/yr) and Google Play Console ($25) accounts
5. Register Tennessee LLC + Privacy Policy + Terms of Service
6. `npx eas build --platform all`
7. `npx eas submit --platform all`

See `JusticeGavel_DevHandoff_Blockers.docx` for full detail.

## Key files

| File | Purpose |
|------|---------|
| `backend/.env` | **All API keys** — primary config |
| `frontend/app.json` | App name, bundle IDs, `apiBase` URL |
| `backend/src/routes/billing.js` | All payment flows (979L) |
| `backend/src/routes/messages.js` | AES-256-GCM encrypted messaging |
| `backend/src/services/encryption.js` | Encryption service |
| `frontend/src/constants/theme.ts` | Light/dark theme |

## Security

- AES-256-GCM encryption on all message bodies and case notes
- JWT auth on every protected endpoint
- Role set server-side — never trusted from client
- No TEST_MODE, no DEMO_MODE payment bypasses
- Mock subscriptions use `status='demo'` — excluded from all payment gates

## Version

v1.8.4 · 45 screens · 67 backend files · 16 revenue streams · 4 languages
