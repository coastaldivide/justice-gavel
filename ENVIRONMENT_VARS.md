# Justice Gavel — Complete Environment Variables Reference
*Auto-generated from codebase scan v155 — all env vars documented*

## Required for Production Launch
```
ANTHROPIC_API_KEY=         # All AI features (chat, motions, research)
JWT_SECRET=                # Auth tokens — generate: openssl rand -hex 32
ENCRYPTION_KEY=            # AES-256-GCM data encryption — 32-byte hex
NODE_ENV=production
PORT=3000
```

## Payments (activate incrementally)
```
STRIPE_SECRET=             # Core Stripe integration
STRIPE_WEBHOOK_SECRET=     # Stripe event verification (HMAC)
STRIPE_LEGAL_PRO_PRICE_ID=       # Pro subscription monthly
STRIPE_LEGAL_PRO_ANNUAL_ID=      # Pro subscription annual
STRIPE_ADVISOR_PRICE_ID=   # Starter subscription monthly
STRIPE_ADVISOR_ANNUAL_ID=  # Starter subscription annual
STRIPE_ESQUIRE_PRICE_ID=  # Attorney subscription monthly
STRIPE_ESQUIRE_ANNUAL_ID= # Attorney subscription annual
STRIPE_LEGAL_RADAR_ID=  # Consumer intelligence add-on
STRIPE_SUCCESS_URL=https://justicegavel.app/payment/success
STRIPE_CANCEL_URL=https://justicegavel.app/payment/cancel
LIVE_PAYMENTS=true         # Enable live Stripe charges
```

## SMS / Email
```
SENDGRID_API_KEY=          # Transactional email
ALERT_EMAIL_FROM=alerts@justicegavel.app
LIVE_EMAIL=true            # Enable live SendGrid email
```

## Scrapers / Data (one-time)
```
GOOGLE_PLACES_KEY=         # Attorney + bondsman scraping (~$14 one-time)
YELP_API_KEY=              # Business data fallback
```

## Infrastructure
```
REDIS_URL=redis://localhost:6379  # Optional — AI queue durability
UPLOAD_DIR=/var/uploads    # Document storage path
PROVIDERS_DB=              # External providers database path
REPORT_DIR=/var/reports    # Health scan report output
EXPO_ACCESS_TOKEN=         # Expo push notifications
VAPID_PUBLIC_KEY=          # Web push (PWA) notifications
BOT_WEBHOOK_BASE_URL=      # Outbound bot webhook base
```

## Scheduler
```
REFRESH_CRON=0 3 * * *     # Nightly data refresh (3am)
REFRESH_TZ=America/Chicago
HEALTH_SCAN_CRON=0 2 * * * # Nightly health scan (2am)
LIVE_REFRESH=true          # Enable live refresh scheduler
```

## Admin
```
ADMIN_KEY=                 # Bot admin webhook auth (generate: openssl rand -hex 16)
ADMIN_EMAIL=admin@yourfirm.com
ADMIN_ALERT_EMAIL=ops@yourfirm.com
ADMIN_ALERT_SMS=+1XXXXXXXXXX
ADMIN_PANEL_URL=https://admin.justicegavel.app
```

## Logging
```
LOG_LEVEL=info             # debug | info | warn | error
LOG_FORMAT=combined        # combined | dev | tiny
SCAN_QUIET=false           # Suppress health scan verbose output
```

## Alternative Payment Providers (all optional)
```
PAYPAL_CLIENT_ID=          # PayPal checkout
PAYPAL_SECRET=
BRAINTREE_MERCHANT_ID=     # Braintree (PayPal-owned)
SQUARE_ACCESS_TOKEN=       # Square POS + online
AUTHORIZE_NET_API_LOGIN_ID=# Authorize.Net
AMAZON_PAY_PUBLIC_KEY_ID=  # Amazon Pay
STRIPE_ACH_ENABLED=true    # Stripe ACH bank transfer
COINBASE_COMMERCE_API_KEY= # BTC/ETH/USDC
BITPAY_TOKEN=              # BTC/BCH
NOWPAYMENTS_KEY=           # 200+ cryptocurrencies
```


---

## Additional Environment Variables (Auto-Discovered)

The following variables are referenced in backend source code and should be
configured in Railway (or your deployment environment) as needed.

### Core Runtime
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string (Railway auto-sets) |
| `POSTGRES_URL` | Optional | Alias for DATABASE_URL in some modules |
| `CORS_ORIGIN` | ✅ Yes | Allowed CORS origin(s), e.g. `https://yourapp.com` |
| `FRONTEND_URL` | ✅ Yes | Frontend base URL for email links and redirects |
| `APP_URL` | Optional | App deep-link base URL for OAuth callbacks |
| `BASE_URL` | ✅ Yes | Backend API base URL |
| `RAILWAY_ENVIRONMENT` | Auto | Set by Railway; `production` or `staging` |
| `DEMO_MODE` | Optional | Set to `true` to disable live payments/emails |

### Authentication & SSO
| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_REFRESH_SECRET` | ✅ Yes | Secret for refresh token signing (separate from JWT_SECRET) |
| `JWT_EXPIRES_IN` | Optional | Access token TTL, default `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Optional | Refresh token TTL, default `7d` |
| `APP_OAUTH_REDIRECT` | Optional | OAuth redirect URI for mobile app flows |
| `APP_SSO_REDIRECT` | Optional | SSO redirect URI for mobile app flows |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `OUTLOOK_CLIENT_ID` | Optional | Microsoft/Outlook OAuth client ID |
| `OUTLOOK_CLIENT_SECRET` | Optional | Microsoft/Outlook OAuth client secret |
| `SELF_HEAL_SECRET` | Optional | Secret for self-heal webhook endpoint |

### Observability
| Variable | Required | Description |
|----------|----------|-------------|
| `SENTRY_DSN` | ✅ Yes (prod) | Sentry error tracking DSN |
| `SENTRY_AUTH_TOKEN` | Optional | Sentry CLI auth token for source maps |
| `ONCALL_EMAIL` | Optional | Primary on-call email for critical alerts |
| `ONCALL_EMAIL_2` | Optional | Secondary on-call email |
| `ALERT_WEBHOOK_URL` | Optional | Slack/webhook URL for operational alerts |

### Integrations (Legal Tech)
| Variable | Required | Description |
|----------|----------|-------------|
| `CLIO_CLIENT_ID` | Optional | Clio practice management OAuth client ID |
| `CLIO_CLIENT_SECRET` | Optional | Clio practice management OAuth client secret |
| `MYCASE_CLIENT_ID` | Optional | MyCase OAuth client ID |
| `MYCASE_CLIENT_SECRET` | Optional | MyCase OAuth client secret |
| `PRACTICEPANTHER_CLIENT_ID` | Optional | PracticePanther OAuth client ID |
| `PRACTICEPANTHER_CLIENT_SECRET` | Optional | PracticePanther OAuth client secret |
| `IMANAGE_CLIENT_ID` | Optional | iManage document management OAuth client ID |
| `IMANAGE_CLIENT_SECRET` | Optional | iManage document management OAuth client secret |
| `NETDOCUMENTS_CLIENT_ID` | Optional | NetDocuments OAuth client ID |
| `NETDOCUMENTS_CLIENT_SECRET` | Optional | NetDocuments OAuth client secret |
| `COURTLISTENER_TOKEN` | Optional | CourtListener API token for case law search |
| `COURTLISTENER_ENABLED` | Optional | Set to `true` to enable CourtListener integration |

### Calendar & Scheduling
| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CALENDAR_CLIENT_ID` | Optional | Google Calendar OAuth client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Optional | Google Calendar OAuth client secret |
| `CALENDLY_PERSONAL_TOKEN` | Optional | Calendly personal API token |

### AI & Transcription
| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ Yes | OpenAI API key (used by transcription/fallback) |
| `DAILY_API_KEY` | Optional | Daily.co API key for video consultation rooms |
| `AI_CONCURRENCY` | Optional | Max concurrent AI requests, default `5` |

### Push & Messaging
| Variable | Required | Description |
|----------|----------|-------------|
| `VAPID_PRIVATE_KEY` | ✅ Yes | Web push VAPID private key (pair with VAPID_PUBLIC_KEY) |
| `RESEND_API_KEY` | ✅ Yes | Resend transactional email API key |
| `SENDGRID_FROM_EMAIL` | Optional | Verified sender email for SendGrid fallback |
| `LIVE_SMS` | Optional | Set to `true` to enable live SMS via Twilio |

### Stripe (Additional)
| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | ✅ Yes | Stripe secret key alias used in some modules |

### Supabase
| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ Yes | Supabase service role key (server-side only) |
| `SUPABASE_PUBLISHABLE_KEY` | Optional | Supabase anon/public key |

### Misc
| Variable | Required | Description |
|----------|----------|-------------|
| `EXTRA_ORIGINS` | Optional | Comma-separated additional CORS origins |
| `JUDYRECORDS_API_KEY` | Optional | JudyRecords API key for arrest record lookup |
