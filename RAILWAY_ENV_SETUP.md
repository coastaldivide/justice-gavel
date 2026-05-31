# Railway Environment Variable Setup

All variables below must be set in Railway **before launch**.
Go to: Railway → Project → Variables → Add

```
ANTHROPIC_API_KEY=<sk-ant-... (required — AI chat will fail without)>
JWT_SECRET=<min 32 random chars (openssl rand -base64 32)>
JWT_REFRESH_SECRET=<different from JWT_SECRET (openssl rand -base64 32)>
STRIPE_SECRET=<sk_live_... or sk_test_...>
STRIPE_WEBHOOK_SECRET=<whsec_... from Stripe dashboard webhooks>
STRIPE_ADVISOR_PRICE_ID=<price_... from Stripe dashboard>
STRIPE_LEGAL_PRO_PRICE_ID=<price_...>
STRIPE_ESQUIRE_PRICE_ID=<price_...>
STRIPE_LEGAL_RADAR_ID=<price_...>
STRIPE_ADVISOR_ANNUAL_ID=<price_...>
STRIPE_LEGAL_PRO_ANNUAL_ID=<price_...>
STRIPE_ESQUIRE_ANNUAL_ID=<price_...>
SENDGRID_API_KEY=<SG..... from SendGrid dashboard>
TWILIO_ACCOUNT_SID=<AC... from Twilio console>
TWILIO_AUTH_TOKEN=<from Twilio console>
TWILIO_FROM_NUMBER=<+1... (your Twilio number)>
DATABASE_URL=<postgres://... from Supabase (or leave blank for SQLite)>
SENTRY_DSN=<https://...@sentry.io/... from Sentry project>
FRONTEND_URL=<https://api.justicegavel.app>
NODE_ENV=<production>
PORT=<4000>
```
