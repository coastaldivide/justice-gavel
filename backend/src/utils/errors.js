/**
 * utils/errors.js — Consistent error response format across all routes
 *
 * All API errors follow: { error: string, code: string, statusCode: number }
 * Never: { message: ... } or { err: ... } or { msg: ... }
 *
 * This makes the frontend predictable — always check error.error
 */

export function sendError(res, statusCode, message, code = null, extras = {}) {
  return res.status(statusCode).json({
    error:  message,
    code:   code || httpCodeToCode(statusCode),
    ...extras,
  });
}

export const err400 = (res, msg, code = 'bad_request')          => sendError(res, 400, msg, code);
export const err401 = (res, msg = 'Authentication required.')   => sendError(res, 401, msg, 'unauthorized');
export const err403 = (res, msg = 'Access denied.')             => sendError(res, 403, msg, 'forbidden');
export const err404 = (res, msg = 'Not found.')                 => sendError(res, 404, msg, 'not_found');
export const err409 = (res, msg, code = 'conflict')             => sendError(res, 409, msg, code);
export const err422 = (res, msg, errors = [])                   => sendError(res, 422, msg, 'validation_error', { errors });
export const err429 = (res, msg = 'Too many requests.')         => sendError(res, 429, msg, 'rate_limited');
export const err500 = (res, msg = 'Internal server error.')     => sendError(res, 500, msg, 'server_error');
export const err503 = (res, msg = 'Service temporarily unavailable.') => sendError(res, 503, msg, 'service_unavailable');

function httpCodeToCode(status) {
  const map = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden',
                404: 'not_found', 409: 'conflict', 422: 'validation_error',
                429: 'rate_limited', 500: 'server_error', 503: 'service_unavailable' };
  return map[status] || 'error';
}
