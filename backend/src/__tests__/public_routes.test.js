/**
 * public_routes.test.js — checklist item 2: deny by default.
 *
 * Walks the routes the app actually mounts (scripts/lib/route-walker.mjs) and
 * requires that every route WITHOUT a JWT guard is on this reviewed list with
 * the reason it is public (or the other credential it checks). A new route
 * that forgets authRequired fails here instead of shipping open.
 */
import { collectRoutes } from '../../scripts/lib/route-walker.mjs';

// Other credentials a non-JWT route may require instead.
const OTHER_GUARD = new Set(['requireAdmin', 'requireStaffOrAdminKey']);

const PUBLIC = {
  // health / ops
  'GET /health': 'uptime probe (booleans only)',
  'GET /api/health': 'uptime probe (booleans only)',
  'GET /metrics': 'process gauges for the uptime monitor (no user data)',
  // account entry points
  'POST /api/auth/register': 'sign-up (rate limited)',
  'POST /api/auth/login': 'sign-in (rate limited, lockout)',
  'POST /api/auth/refresh': 'takes a refresh token / still-valid access token',
  'POST /api/auth/forgot-password': 'non-enumerating, rate limited',
  'POST /api/auth/reset-password': 'takes a single-use hashed reset token',
  // signed webhooks
  'POST /webhooks/stripe': 'Stripe signature verified',
  'POST /api/webhooks/stripe': 'Stripe signature verified',
  'POST /api/webhooks/telnyx': 'Telnyx Ed25519 signature verified (STOP replies); 503 without TELNYX_PUBLIC_KEY',
  'POST /api/webhooks/telnyx-voice': 'Telnyx Ed25519 signature verified (court-date phone line, A10); 503 without TELNYX_PUBLIC_KEY or when TELNYX_VOICE_ENABLED is off',
  'POST /api/billing/webhook': 'Stripe signature verified',
  // SSO / OAuth flows (signed assertions / state)
  'POST /api/sso/acs': 'SAML assertion signature verified (H8)',
  'GET /api/sso/login': 'starts SAML login',
  'GET /api/sso/metadata': 'public SP metadata',
  'GET /api/integrations/oauth/callback': 'OAuth state parameter verified',
  // capability URLs
  'GET /api/cases/shared/:token': 'unguessable share token chosen by the case owner',
  'GET /api/integrations/caldav/ical/:firmId': 'HMAC token in the feed URL',
  'GET /api/translate/session/:code': 'per-session 256-bit token (H7)',
  'POST /api/translate/session/:code/message': 'per-session 256-bit token (H7)',
  'GET /api/translate/session/:code/messages': 'per-session 256-bit token (H7)',
  // guest-usable core path (people in crisis must not need an account)
  'GET /api/providers/lawyers': 'directory search (guest core path)',
  'GET /api/providers/lawyers/:id': 'directory profile',
  'GET /api/providers/bail': 'bail-agent search (guest core path)',
  'GET /api/providers/coverage': 'directory coverage counts',
  'GET /api/providers/nearest-city': 'city lookup for coordinates',
  'GET /api/providers/bail/:id': 'bail-agent listing (guest core path)',
  'GET /api/bail': 'bail-agent directory',
  'GET /api/bail/nearby': 'bail-agent directory',
  'GET /api/bail/estimate-total': 'pure calculator',
  'GET /api/consultations/pricing': 'static platform-fee table (the prices the booking screen shows)',
  'GET /api/billing/pi-lead/fees': 'static attorney lead-fee table (shown on the case-submission screen)',
  'GET /api/billing/family/quote': 'family-connect price and whether payments are live (no user data)',
  'GET /api/bail/immigration': 'static guidance',
  'GET /api/lessons/rights-card': 'know-your-rights card (offline-first core path)',
  'GET /api/rights/states': 'state list for the rights card (guest core path)',
  'GET /api/rights/:state': 'sourced know-your-rights card (guest core path, cached offline)',
  'GET /api/help/nearby': 'combined lawyer + bail-agent search (guest core path)',
  'POST /api/help/reports': 'report a wrong listing (guest core path, rate limited, never edits the listing)',
  'GET /api/help/report-reasons': 'static list of report reasons',
  'GET /api/results': 'the latest results snapshot an admin published (B11; aggregate counts only)',
  'GET /api/help/bail-schedule': 'typical bail ranges with sources (guest core path)',
  'GET /api/court-dates/guidance': 'static court-day checklist and missed-date guidance',
  'GET /api/courthouses': 'courthouse lookup by state / city / name (guest core path, no user data)',
  'GET /api/legaldata/:type': 'read-only legal reference tables (DUI laws, drug penalties, courts, clinics) for guests; IP rate limit',
  'GET /api/lessons': 'the free "Know your rights" lessons (read-only; completing one needs an account)',
  'GET /api/resources': 'crisis lines, legal aid and public-defender directory (guests need it most); IP rate limit',
  'GET /api/resources/:id': 'one resource of the public directory',
  'GET /api/resources/categories': 'category counts of the public directory',
  'GET /api/advocacy/stats': 'aggregate network counts only (no person identifiable); IP rate limit',
  'GET /api/courthouses/:id': 'one courthouse listing (guest core path)',
  'GET /api/immigration/rights': 'static guidance',
  'GET /api/immigration/relief-options': 'static guidance',
  'GET /api/interrogation/recording-law': 'static guidance',
  'GET /api/expungement/check': 'eligibility rules (rate limited)',
  'GET /api/expungement/juvenile': 'juvenile sealing rules, verified rows only (rate limited)',
  'GET /api/expungement/attorneys': 'directory',
  'GET /api/hague-contacts/member-states': 'stored public contact data with sources (rate limited)',
  'GET /api/hague-contacts/central-authority/:countryCode': 'stored public contact data with sources (rate limited)',
  'GET /api/hague-contacts/us-resources': 'stored public contact data with sources (rate limited)',
  'GET /api/consultations/slots/:lawyerId': 'free/busy slots, no client data',
  'GET /api/match/profile/:lawyerId': 'public lawyer profile',
  'GET /api/reviews': 'public reviews',
  'GET /api/reviews/summary': 'public ratings',
  'GET /api/push/tip': 'tip of the day',
  'GET /api/research/topics': 'topic list',
  'GET /api/golden-gavel/hall': 'public recognition list',
  'GET /api/forum': 'public forum (optional auth)',
  'GET /api/forum/:id': 'public forum (optional auth)',
  'GET /api/forum/categories': 'public forum categories',
  'GET /api/advocacy': 'static advocacy info',
  'GET /api/webpush/key': 'VAPID public key',
  // feedback works signed out (user_id NULL)
  'POST /api/feedback': 'anonymous feedback allowed (M5)',
  'GET /api/billing/pi-lead/rules': 'state-by-state lead rules and the no-recommendation disclosure (public, read-only)',
  'GET /api/billing/record-clearing': 'the record-clearing price and whether it is on sale (public, read-only)',
  'GET /api/feedback/summary': 'aggregate rating',
  'POST /api/feedback/ui': 'anonymous UI report',
  // marketing / pricing pages
  'GET /api/billing/tiers': 'price list',
  'GET /api/billing/bondsman/tiers': 'price list',
  'GET /api/firm-acquisition/plans': 'price list',
  'POST /api/firm-acquisition/lead': 'sales contact form',
  'GET /api/firm-verticals/presets': 'deadline-rule catalogue',
  'GET /api/firm-verticals/pricing': 'price list',
  'GET /api/firms/directory': 'public firm directory',
  'GET /api/firms/:id/public-profile': 'public firm page',
  'GET /api/firms/referral/:code': 'referral code lookup',
  // Case Pass price list (signed in: also the caller's pass)
  'GET /api/billing/case-pass': 'price list; optionalAuth adds only the caller\'s own pass end date',
  // Bond Desk signing links: the 32-byte random token in the path (stored as SHA-256) is the credential;
  // expires 30 days after sending, stops on void / rotation; rate limited; token redacted from logs
  'GET /api/checkins/link/:token': 'check-in text link (token credential, stored hashed; IP rate limit); first name + agency only',
  'POST /api/checkins/link/:token': 'check-in text link (token credential, stored hashed; IP + per-link rate limit)',
  'GET /api/sign/:token': 'signing link (token credential)',
  'POST /api/sign/:token/answers': 'signing link (token credential)',
  'POST /api/sign/:token/uploads': 'signing link (token credential), 10 MB cap, type sniffed',
  'POST /api/sign/:token/prepare': 'signing link (token credential)',
  'GET /api/sign/:token/documents/:docId.pdf': 'signing link (token credential); only this signer\'s copies',
  'POST /api/sign/:token/sign': 'signing link (token credential)',
  'POST /api/sign/:token/decline': 'signing link (token credential)',
  'GET /api/sign/:token/signed.pdf': 'signing link (token credential); only this signer\'s signed copies',
  // Bond Desk card payments (docs/BOND_DESK.md): money goes to the agency's own Stripe account (Connect)
  'GET /api/bd-pay/autopay/:token': 'automatic-payment link (32-byte token credential, stored hashed; IP rate limit; ⚖ flag); agency, schedule, consent, card last 4',
  'POST /api/bd-pay/autopay/:token/start': 'automatic-payment link: consent snapshot + Stripe Checkout (setup) on the agency account; IP rate limit',
  'POST /api/bd-pay/autopay/:token/stop': 'automatic-payment link: the payer stops automatic payments; IP rate limit',
  'POST /api/bd-pay/autopay/:token/confirm': 'automatic-payment link: Checkout to confirm a payment the bank asked about; IP rate limit',
  'GET /api/bd-pay/agency/:slug': 'an agency\'s public pay page (stable random slug): agency name, phone, limits',
  'POST /api/bd-pay/agency/:slug/checkout': 'pay page: Stripe Checkout on the agency account, $1–$50,000, 10 per IP per 15 minutes',
};

describe('item 2 — every route requires auth unless deliberately public', () => {
  let routes;
  beforeAll(async () => { routes = await collectRoutes(); }, 60_000);

  test('no unreviewed public route', () => {
    const open = routes
      .filter(r => !r.auth && !(r.middleware || []).some(m => OTHER_GUARD.has(m)))
      .map(r => `${r.method} ${r.path}`);
    expect(open.filter(k => !(k in PUBLIC))).toEqual([]);
  });

  test('the reviewed list has no stale entries', () => {
    const live = new Set(routes.map(r => `${r.method} ${r.path}`));
    expect(Object.keys(PUBLIC).filter(k => !live.has(k))).toEqual([]);
  });

  test('sanity: the walker sees guarded routes too', () => {
    expect(routes.filter(r => r.auth).length).toBeGreaterThan(400);
  });
});
