## Step 0: Initialize EAS Project (MUST DO FIRST)

```bash
cd frontend
eas project:init
```

This writes the real EAS project ID to `eas.json` and `app.json` automatically.
Without this step, OTA updates will not work in production.

---

# EAS Secrets Setup — Justice Gavel
# Run these commands to configure secrets for EAS Build

# ── Required secrets (set before first build) ──────────────────────────────────

# Backend API URL (your Railway URL after deploy)
eas secret:create --scope project --name EXPO_PUBLIC_API_BASE --value "https://YOUR_RAILWAY_URL/api"

# Sentry auth token for sourcemap uploads
# Get from: sentry.io → Settings → API → Auth Tokens
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value "YOUR_SENTRY_TOKEN"

# Apple certificates (EAS manages these automatically on first iOS build)
# Just run: eas build --platform ios --profile production
# EAS will prompt you to generate or use existing certs.

# ── Verify secrets are set ─────────────────────────────────────────────────────
# eas secret:list

# ── Build commands after secrets are set ──────────────────────────────────────
# Development build (installable on device):
#   eas build --platform all --profile development

# Preview build (TestFlight / Internal Testing):
#   eas build --platform all --profile preview

# Production build (App Store / Play Store):
#   eas build --platform all --profile production

# ── OTA Update (post-launch) ──────────────────────────────────────────────────
# After replacing YOUR_EAS_PROJECT_ID in eas.json:
#   eas update --channel production --message "Hotfix: crash on login"

# ── Submit to stores ──────────────────────────────────────────────────────────
# iOS App Store:
#   eas submit --platform ios --latest

# Google Play Store:
#   eas submit --platform android --latest

## Android Release Build Notes

### google-services.json
Replace the placeholder `frontend/google-services.json` with the real file
from Firebase Console → Project Settings → Your Android App.
The package name must match exactly: `app.justicegavel.mobile`

### Hermes + R8/ProGuard
EAS Build handles ProGuard configuration automatically for Expo managed workflow.
If you eject or use bare workflow, add these keep rules to `android/app/proguard-rules.pro`:
```
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.** { *; }
-keep class expo.** { *; }
```

### Release signing (EAS manages this automatically)
EAS generates and stores your Android keystore in their secure vault.
Run `eas credentials` to inspect or rotate credentials.
NEVER commit the keystore file to version control.

### Internal testing track
The eas.json submit config uses `track: 'internal'` — this sends builds to
Google Play Internal Testing (up to 100 testers). Promote to production via
the Google Play Console manually after testing.
