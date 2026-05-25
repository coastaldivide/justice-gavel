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
TWILIO_ACCOUNT_SID=        # Arrest alerts, SMS verification
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=+1XXXXXXXXXX
SENDGRID_API_KEY=          # Transactional email
ALERT_EMAIL_FROM=alerts@justicegavel.app
LIVE_SMS=true              # Enable live Twilio SMS
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
