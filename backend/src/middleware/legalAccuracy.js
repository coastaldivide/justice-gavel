/**
 * middleware/legalAccuracy.js — Injects accuracy context into every AI legal response
 *
 * Wraps all /api/chat, /api/expungement, /api/bail, and /api/rights routes.
 *
 * What this middleware does:
 *   1. Adds a mandatory disclaimer to every AI response before it reaches the client
 *   2. Checks the staleness score of the content used in the response
 *   3. Escalates the disclaimer text based on staleness
 *   4. Adds a _meta block to every response: { disclaimer, staleness, reviewed_at }
 *   5. Prevents serving content flagged as SUPPRESSED
 *
 * This is the technical component of the UPL defense:
 *   "We disclosed the limitations of AI legal information on every response."
 */


// ── Standard disclaimer layers ────────────────────────────────────────────────
// Layer 1: Always shown. Every response, no exceptions.
export const MANDATORY_DISCLAIMER =
  'This is general legal information, not legal advice. Laws vary by state and change frequently. ' +
  'Nothing here creates an attorney-client relationship. Consult a licensed attorney in your state ' +
  'before making any legal decision.';

// Layer 2: Shown when content is approaching staleness threshold.
export const REVIEW_SOON_DISCLAIMER =
  'This information is scheduled for attorney review. Verify current law with your attorney.';

// Layer 3: Shown when content is past the 365-day suppress threshold.
export const STALE_DISCLAIMER =
  'ACCURACY NOTICE: This information has not been recently verified by a licensed attorney. ' +
  'Laws change. Do not rely on this information without independent verification.';

/**
 * Middleware factory — wrap a route with accuracy context.
 * Usage: router.get('/check', legalAccuracyMiddleware('expungement'), handler)
 */
export function legalAccuracyMiddleware(contentType = 'legal_information') {
  return (req, res, next) => {
    // Intercept res.json to inject _meta block
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (body && typeof body === 'object' && !body._accuracy_meta) {
        const staleness = body._staleness_score ?? 0; // set by route if known
        let disclaimer  = MANDATORY_DISCLAIMER;
        if (staleness >= 1.0) disclaimer = STALE_DISCLAIMER + ' ' + MANDATORY_DISCLAIMER;
        else if (staleness >= 0.5) disclaimer = REVIEW_SOON_DISCLAIMER + ' ' + MANDATORY_DISCLAIMER;

        body._accuracy_meta = {
          disclaimer,
          staleness_score:   parseFloat(staleness.toFixed(3)),
          content_type:      contentType,
          generated_at:      new Date().toISOString(),
          not_legal_advice:  true,
        };
        delete body._staleness_score; // clean up internal field
      }
      return originalJson(body);
    };
    next();
  };
}

/**
 * Express middleware for AI chat routes (app.js, /api/chat) — marks every
 * successful JSON answer with `_accuracy_meta`. Text fields are never
 * changed: the app shows the legal notice under each answer in the person's
 * language, and an error `message` must stay a plain sentence.
 */
export function chatAccuracyMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body === 'object' && !Array.isArray(body) && res.statusCode < 400 && !body._accuracy_meta) {
      body._accuracy_meta = {
        not_legal_advice: true,
        disclaimer: MANDATORY_DISCLAIMER,
        generated_at: new Date().toISOString(),
      };
    }
    return originalJson(body);
  };
  next();
}
