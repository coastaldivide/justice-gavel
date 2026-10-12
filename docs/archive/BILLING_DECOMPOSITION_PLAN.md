> **ARCHIVED — historical document, may be inaccurate.** Kept for history only (moved here in the step-10 documentation pass, Oct 2026). The split it proposes has been done (`backend/src/routes/billing/`), and `calcLeadFee` / tiered PI fees it mentions no longer exist — lead fees are flat (see README.md).

# Billing Route Decomposition Plan
# CodeScene hotspot score: 52 (billing.js: 1372L, CC=152)
# Target: split into 4 focused sub-routers

## Proposed structure:
# backend/src/routes/billing/
#   index.js          — mounts all sub-routers, exports default router
#   subscriptions.js  — POST /subscribe, GET /subscription, POST /cancel
#                       POST /consumer/subscribe, GET /consumer/subscription
#   refunds.js        — POST /refund, webhook refund handling
#   bondsman.js       — POST /bondsman/profile, GET /profile
#                       POST /bondsman/verified-badge/*, GET /status, POST /cancel
#   leads.js          — GET /leads, POST /leads/:id/accept
#                       POST /pi-lead/submit, GET /pi-leads, POST /pi-lead/accept/:id
#   quickconnect.js   — POST /quickconnect, POST /family/connect
#   webhooks.js       — POST /webhook (Stripe webhook handler)
#   admin.js          — GET /admin/stats

## Why not done now:
# Splitting requires updating app.js import, all test stubs, and
# re-verifying all 47 test suites. Safe to do in a dedicated PR.
# Current mitigations applied:
#   ✅ handleStripeWebhook() extracted to named function
#   ✅ calcLeadFee(), piLeadFee(), getOrCreateStripeCustomer() already isolated
#   ✅ BUSINESS_CONSTANTS replaces magic numbers
#   ✅ 17 billing tests pass

## Estimated effort: 4 hours for decomposition + 2 hours test verification
## Risk: LOW — pure refactor, no logic change
