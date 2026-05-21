# Justice Gavel — Detox E2E Test Suite

## Setup

### Prerequisites
- macOS with Xcode 15+ (iOS) **or** macOS/Linux with Android SDK 34+ (Android)
- Node 18+
- Expo development build (not Expo Go)

### Install
```bash
npm install --save-dev detox detox-expo-plugin @types/detox
# iOS only:
brew tap wix/brew && brew install applesimutils
```

### Add to package.json
```json
{
  "detox": {
    "configurations": { ... }   // already in e2e/.detoxrc.js
  },
  "scripts": {
    "e2e:build:ios":    "detox build --configuration ios.sim.release",
    "e2e:build:android":"detox build --configuration android.emu.release",
    "e2e:test:ios":     "detox test --configuration ios.sim.release",
    "e2e:test:android": "detox test --configuration android.emu.release",
    "e2e:test:ios:debug": "detox test --configuration ios.sim.debug --loglevel verbose"
  }
}
```

### Environment variables
Set in `.env.e2e` (not committed):
```
EXPO_PUBLIC_API_BASE=https://staging-api.justicegavel.app/api
E2E_CONSUMER_EMAIL=e2e.consumer@justicegavel.test
E2E_CONSUMER_PASSWORD=...
E2E_ATTORNEY_EMAIL=e2e.attorney@justicegavel.test
E2E_BONDSMAN_EMAIL=e2e.bondsman@justicegavel.test
```

### Test accounts
Create three permanent test accounts in your staging environment:
- `e2e.consumer@justicegavel.test` — active consumer subscription, enrolled in check-in
- `e2e.attorney@justicegavel.test` — verified attorney
- `e2e.bondsman@justicegavel.test` — active bondsman subscription with seeded leads

Reset these accounts in CI before each run with a seed script.

### Run
```bash
# Build once
npm run e2e:build:ios

# Run all tests
npm run e2e:test:ios

# Run a single suite
detox test --configuration ios.sim.release e2e/tests/02_check_in.e2e.ts
```

## Test Suites

| File | Description | Priority |
|---|---|---|
| `01_auth.e2e.ts` | Login, logout, token persistence | CRITICAL |
| `02_check_in.e2e.ts` | Check-in submission, dedup, streak | CRITICAL |
| `03_bail_search.e2e.ts` | Search, bail amount display, network error | CRITICAL |
| `04_lawyer_search.e2e.ts` | Search, booking flow, save | HIGH |
| `05_cases.e2e.ts` | Case list, create, court date/bail display | HIGH |
| `06_expungement.e2e.ts` | Eligibility form, result, attorney referral | HIGH |
| `07_bondsman_dashboard.e2e.ts` | Lead list, bail amounts, accept flow | CRITICAL |
| `08_offline.e2e.ts` | Offline banner, cache, recovery | HIGH |

## accessibilityLabel requirements

For these tests to run, every interactive element must have a `testID` prop.
The IDs referenced in these tests are:

**Navigation:** `home-tab`, `more-tab`, `settings-tab`
**Home tiles:** `tile-CheckIn`, `tile-Cases`, `tile-Lawyers`, `tile-Expungement`
**Auth:** `login-email-input`, `login-password-input`, `login-submit-button`, 
          `login-error-message`, `login-register-link`
**Check-in:** `checkin-screen`, `checkin-submit-button`, `checkin-notes-input`,
              `checkin-success-screen`, `checkin-streak-count`, `checkin-already-done`,
              `checkin-error-message`, `checkin-enroll-button`
**Lawyers:** `lawyers-screen`, `lawyer-list`, `lawyer-card`, `lawyer-name`,
             `lawyer-rating`, `lawyer-save-button`, `lawyer-book-button`,
             `lawyer-profile-screen`, `lawyer-profile-contact-button`
**Cases:** `case-screen`, `case-list`, `case-card`, `case-add-button`,
           `case-title-input`, `case-save-button`, `case-court-date`,
           `case-bail-amount`, `case-detail-screen`, `case-share-button`
**Bail:** `bail-search-screen`, `bail-search-city-input`, `bail-search-submit-button`,
          `bail-agent-list`, `bail-agent-card`, `bail-agent-bail-amount`,
          `bail-search-empty`, `bail-search-error`
**Expungement:** `expungement-screen`, `expungement-state-picker`,
                 `expungement-charges-input`, `expungement-check-button`,
                 `expungement-result-screen`, `expungement-eligible-banner`,
                 `expungement-not-eligible-banner`, `expungement-wait-years`,
                 `expungement-attorneys-section`, `expungement-state-error`
**Bondsman:** `bondsman-dashboard-screen`, `lead-list`, `lead-card`,
              `lead-bail-amount`, `lead-accept-button`, `lead-accepted-confirmation`,
              `lead-detail-screen`, `lead-defendant-name`, `lead-charge`,
              `lead-bail-amount-detail`, `stat-avg-bail`
**Offline:** `offline-banner`, `lawyers-offline-message`, `case-offline-message`

## Next step: add testID props

Run this to find all elements that need testID props:
```bash
grep -rn "by\.id(" e2e/tests/ | grep -oP "(?<=by\.id\(')[^']+" | sort -u
```
