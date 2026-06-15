# Justice Gavel — EAS Production Build Guide

Run these commands on your local machine (not in CI) after cloning the repo.

## Prerequisites
- Node.js 18+
- npm install -g eas-cli
- Apple Developer Program account ($99/year) — enrolled
- Google Play Console account ($25 one-time) — enrolled

---

## Step 1 — Login to Expo

```bash
eas login
# Enter your expo.dev credentials (account: justicegavel)
```

Or with token (non-interactive):
```bash
export EXPO_TOKEN=fmzCkOL9lNXn64DT8FiguRvOWhsEpTot9zGI9oKW
```

---

## Step 2 — Link the EAS project

```bash
cd frontend
eas init
# This links the local project to expo.dev and fills in the EAS project ID
```

---

## Step 3 — Android build (do this first — easier)

```bash
eas build --platform android --profile production
```

EAS will:
- Generate and store the Android keystore automatically (first time)
- Build the .aab (Android App Bundle) on Expo's cloud servers
- Takes 10–20 minutes
- Download link sent to your email when done

---

## Step 4 — iOS build

Requires your Apple credentials. EAS handles certificates and provisioning
profiles automatically — you just need to authenticate once.

```bash
eas build --platform ios --profile production
```

EAS will:
- Ask for your Apple ID and password (or App Store Connect API key)
- Create/manage certificates and provisioning profiles automatically
- Build the .ipa on Expo's cloud servers
- Takes 15–30 minutes

---

## Step 5 — Submit to stores

### Android → Google Play

1. Create a service account in Google Play Console:
   - Setup → API access → Create service account
   - Grant "Release manager" permission
   - Download the JSON key → save as `frontend/google-play-service-account.json`

```bash
eas submit --platform android --profile production
```

### iOS → App Store Connect

```bash
eas submit --platform ios --profile production
# Uses the appleId/ascAppId/appleTeamId in eas.json
```

---

## What to fill in eas.json before submitting:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "YOUR_APPLE_ID@email.com",
      "ascAppId": "YOUR_12_DIGIT_APP_ID",
      "appleTeamId": "YOUR_10_CHAR_TEAM_ID"
    }
  }
}
```

Find your Apple info at:
- Team ID:  developer.apple.com → Account → Membership
- ASC App ID: appstoreconnect.apple.com → Apps → App Information → Apple ID

---

## OTA Updates (after launch — no app store review needed)

For bug fixes and small updates after launch:
```bash
eas update --channel production --message "Fix bail calculator edge case"
```

Users get the update next time they open the app. No store review required.
Takes 2 minutes vs 1-3 days for a full build submission.

---

## Build status
Check at: https://expo.dev/accounts/justicegavel/projects/justice-gavel/builds
