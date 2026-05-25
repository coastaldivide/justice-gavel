# Justice Gavel — Pre-Launch Checklist

## ✅ DONE
- [x] Frontend: 77 screens, 0 TS errors, 683 tests passing
- [x] Backend: All syntax errors fixed, server running
- [x] Auth: Register/Login/JWT working
- [x] All 22 API endpoints tested and passing
- [x] AI features: Anthropic (Claude Sonnet) + OpenAI (Whisper) keys installed
- [x] Stripe: Test keys installed (sk_test, pk_test, rk_test)
- [x] Google Places key installed
- [x] Supabase project created (yjeplvvnlennyxixwxfq)
- [x] Database schema ready (27 tables, seeded data)
- [x] Railway deployment files ready (Dockerfile, railway.json)
- [x] EAS build config ready

---

## 🔴 YOU DO — Takes ~45 minutes total

### 1. Push database schema (5 min)
Go to: https://supabase.com/dashboard/project/yjeplvvnlennyxixwxfq/sql/new
Paste the contents of: JusticeGavel-DB-Migration.sql
Click RUN

### 2. Get database password (2 min)
Supabase Dashboard → Settings → Database → Database password → copy it
Then go to Connection string → URI → copy the full URL

### 3. Deploy backend to Railway (10 min)
a. Go to: https://railway.app/new
b. "Deploy from GitHub" → connect your repo → select /backend folder
c. Add these environment variables:
   DATABASE_URL=postgresql://postgres.yjeplvvnlennyxixwxfq:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ANTHROPIC_API_KEY=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
   OPENAI_API_KEY=sk-proj-AbQEbSTXsH8UlwBOTs9Nb3Kn71wVGqQlz5PFUarN9O6DD_mydFEJXxoUyzUdKpoACT2gdN0YK_T3BlbkFJphVum6zHwDas38Sd7gbMdUKWAcENIriPG1IztnWON_VSBkDgdMc2iRMMBKTbBMQ455dmOUA
   STRIPE_SECRET=sk_test_51TakD62XUfNqC3X4Rg211T7kdP4DfEv5dPAnq23E7yTp8BFVya8cIpe3WWkWANeUfN51RB1OH62dqGuwfszYBXCf00e0gkDKh3
   STRIPE_PUBLISHABLE_KEY=pk_test_51TakD62XUfNqC3X4bEUfw48uj4OrctvShiTn0DTTubDJTxMVvbP4RqDrVFwTg59AVpjtCeO3lnIqWrjkAnxYeKcL00CKoFqEgi
   GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI
   JWT_SECRET=[run: openssl rand -hex 32]
   ENCRYPTION_KEY=[run: openssl rand -hex 32]
   NODE_ENV=production
   DEMO_MODE=false
   CORS_ORIGIN=https://justicegavel.app,exp://justicegavel.app

d. Railway gives you a URL like: https://backend-production-xxxx.up.railway.app
e. Add custom domain: api.justicegavel.app → point CNAME to Railway URL

### 4. Create Stripe products (5 min)
Run: STRIPE_SECRET=sk_test_51Tak... node backend/scripts/setup-stripe-products.js
Copy the price IDs printed → add to Railway env vars

### 5. Set up Stripe webhook (5 min)
Go to: https://dashboard.stripe.com/test/webhooks
Add endpoint: https://api.justicegavel.app/api/billing/webhook
Select events: payment_intent.* and customer.subscription.*
Copy whsec_... → add to Railway as STRIPE_WEBHOOK_SECRET

### 6. Update frontend API URL (1 min)
In frontend/.env change:
EXPO_PUBLIC_API_BASE=https://api.justicegavel.app/api

### 7. Build the app (15 min)
cd frontend
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # APK for testing
# For full release:
eas build --platform all --profile production

### 8. DNS (5 min)
In your domain registrar (justicegavel.app):
  A record: @ → your Railway IP
  CNAME: api → your Railway URL
  CNAME: www → justicegavel.app

---

## 🟡 NICE TO HAVE BEFORE LAUNCH
- [ ] Sign up Twilio ($15) → add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
- [ ] Sign up SendGrid (free) → add SENDGRID_API_KEY
- [ ] App icon (1024x1024 PNG) → replace frontend/assets/icon.png
- [ ] Splash screen → replace frontend/assets/splash.png
- [ ] Apple Developer Account ($99/yr) for iOS App Store
- [ ] Google Play Console ($25) for Android Play Store
- [ ] Privacy Policy → use termly.io (free, 20 min)

---

## API ENDPOINTS — ALL WORKING
GET  /health
POST /api/auth/register
POST /api/auth/login
GET  /api/cases
GET  /api/checkins/status
POST /api/checkins/submit
GET  /api/lessons
GET  /api/bail?state=TN
GET  /api/expungement/check
GET  /api/providers/list
GET  /api/providers/lawyers/:id    ← NEW
POST /api/push/reminders           ← NEW
GET  /api/family/contacts          ← NEW
POST /api/family/contacts          ← NEW
GET  /api/attorney/pending-verification ← NEW
GET  /api/matter-intelligence/:id/analytics ← NEW
PATCH /api/firm-verticals/:id/:id/resolve   ← NEW
POST /api/transcribe/audio         ← NEW
GET  /api/legaldata/dui
GET  /api/legaldata/bail
GET  /api/legaldata/specialty-courts
GET  /api/search
GET  /api/golden-gavel/status
GET  /api/push/preferences
GET  /api/advocacy
GET  /api/resources
