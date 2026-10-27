/**
 * middleware/errorShape.js — one error format for every /api answer.
 *
 * Every error (status >= 400) leaves as JSON
 *   { error: <string>, code: <snake_case code>, message: <text in the request language>, ...route fields }
 * whatever the route wrote:
 *   - `message` is kept when the route already wrote one in the request
 *     language. An English sentence (in `error` or `message`) that is a
 *     server-catalog text is replaced by that text in the request language;
 *     anything else gets the catalog text for its code / HTTP status.
 *   - `code` is the route's code, else `error` when that is a code, else one
 *     derived from the status (not_found, rate_limited, …).
 *   - In production a 500 never carries internals: `error` becomes a code,
 *     the message is the generic one, and debug fields are dropped.
 *   - A 500 whose cause was bad input that reached the database (invalid or
 *     out-of-range value, unknown reference, duplicate — see db/index.js
 *     noteQueryError) is answered as the 400 / 409 it is.
 *   - A plain-text error (e.g. a library's default) is turned into the same JSON.
 */
import { CATALOGS, msg, resolveLang } from '../i18n/index.js';
import logger, { currentRequestContext } from '../utils/logger.js';

const IS_CODE = /^[a-z][a-z0-9_.:-]{1,63}$/;
const STATUS_CODES = {
  400: 'bad_request', 401: 'unauthorized', 402: 'payment_required', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 408: 'timeout', 409: 'conflict', 410: 'gone', 413: 'payload_too_large',
  415: 'unsupported_media_type', 422: 'invalid_input', 429: 'rate_limited', 451: 'disclaimer_required',
  500: 'server_error', 502: 'bad_gateway', 503: 'service_unavailable', 504: 'timeout',
};
const STATUS_KEYS = {
  400: 'http.400', 401: 'http.401', 402: 'http.402', 403: 'http.403', 404: 'http.404', 405: 'http.400',
  408: 'http.503', 409: 'http.409', 410: 'http.410', 413: 'http.413', 415: 'http.415', 422: 'http.400',
  429: 'http.429', 451: 'http.451', 500: 'http.500', 502: 'http.503', 503: 'http.503', 504: 'http.503',
};
/** Codes whose text is more specific than the status text. */
const CODE_KEYS = {
  missing_token: 'http.401', token_expired: 'auth.err.session_expired', invalid_token: 'auth.err.invalid_token',
  auth_error: 'auth.err.invalid_token', user_not_found: 'auth.err.account_not_found', account_disabled: 'auth.err.account_disabled',
  auth_unavailable: 'auth.err.unavailable', invalid_input: 'http.400', invalid_reference: 'http.400',
  validation_error: 'validation.failed', cors_origin_not_allowed: 'http.403', invalid_json: 'http.invalid_json',
  payload_too_large: 'http.413', staff_only: 'http.403', admin_required: 'http.403',
};
/** SQLSTATEs that mean "the caller sent a value the database cannot use". */
function inputErrorStatus(sqlstate) {
  if (!sqlstate) return null;
  if (sqlstate.startsWith('22')) return { status: 400, code: 'invalid_input' };          // data exception
  if (sqlstate === '23503') return { status: 400, code: 'invalid_reference' };           // foreign key
  if (sqlstate === '23502' || sqlstate === '23514') return { status: 400, code: 'invalid_input' };
  if (sqlstate === '23505') return { status: 409, code: 'conflict' };                     // unique
  return null;
}

// Catalog sentence (any language) → key: a route that answers with the text in
// `error`, or in English, is re-rendered in the request language.
let TEXT_TO_KEY = null;
function catalogKey(text) {
  if (!TEXT_TO_KEY) {
    TEXT_TO_KEY = new Map();
    for (const cat of [CATALOGS.tl, CATALOGS.ar, CATALOGS.zh, CATALOGS.ht, CATALOGS.vi, CATALOGS.pt, CATALOGS.es, CATALOGS.en]) {   // English last: it wins on a tie
      for (const [k, v] of Object.entries(cat)) if (typeof v === 'string' && !/\{\w+\}/.test(v)) TEXT_TO_KEY.set(v.trim(), k);
    }
  }
  return TEXT_TO_KEY.get(String(text).trim()) || null;
}
const isSentence = (s) => typeof s === 'string' && s.trim() !== '' && !IS_CODE.test(s.trim());
const DEBUG_FIELDS = ['stack', 'sql', 'detail', 'hint', 'trace', 'exception', 'err', 'cause'];

export function shapeErrorBody(body, status, lang, { prod = process.env.NODE_ENV === 'production' } = {}) {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : { error: typeof body === 'string' ? body : undefined };
  const routeCode = [src.code, src.error].find(v => typeof v === 'string' && IS_CODE.test(v));
  let code = routeCode || STATUS_CODES[status] || (status >= 500 ? 'server_error' : 'bad_request');
  let message = typeof src.message === 'string' && src.message.trim() ? src.message : null;
  const englishFromError = isSentence(src.error) ? src.error : null;

  if (status === 500 && prod) {
    for (const f of DEBUG_FIELDS) delete src[f];
    if (!routeCode || /error|exception/i.test(String(src.error))) code = 'server_error';
    return { ...src, error: code, code, message: msg(lang, 'http.500'), status };
  }
  // A catalog sentence (in whatever language the route wrote it) → the request language.
  const known = (message && catalogKey(message)) || (!message && englishFromError && catalogKey(englishFromError));
  if (known) message = msg(lang, known);
  else if (!message && englishFromError && lang === 'en') message = englishFromError;
  if (!message) message = msg(lang, CODE_KEYS[code] || STATUS_KEYS[status] || (status >= 500 ? 'http.500' : 'http.400'));
  for (const f of prod ? DEBUG_FIELDS : []) delete src[f];
  return { ...src, error: typeof src.error === 'string' && src.error ? src.error : code, code, message };
}

export function errorShape() {
  return function errorShapeMiddleware(req, res, next) {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/webhooks')) return next();
    const json = res.json.bind(res);
    const send = res.send.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) return json(body);
      if (res.statusCode === 500) {
        const db = currentRequestContext()?.lastDbError;
        const mapped = inputErrorStatus(db?.code);
        if (mapped) {
          logger.warn({ path: req.originalUrl?.split('?')[0], sqlstate: db.code }, '[errorShape] bad input reached the database → 4xx');
          res.status(mapped.status);
          const lang = resolveLang(req);
          return json({ error: mapped.code, code: mapped.code, message: msg(lang, CODE_KEYS[mapped.code] || STATUS_KEYS[mapped.status]) });
        }
      }
      return json(shapeErrorBody(body, res.statusCode, resolveLang(req)));
    };
    res.send = (body) => {
      if (res.statusCode >= 400 && typeof body === 'string' && !/json/i.test(String(res.get('Content-Type') || ''))) {
        return res.json(isSentence(body) ? { error: body } : {});
      }
      return send(body);
    };
    next();
  };
}
