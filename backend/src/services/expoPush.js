/**
 * services/expoPush.js — minimal Expo push HTTP client with an injectable endpoint.
 *
 * expo-server-sdk hard-codes https://exp.host, which makes the delivery path
 * impossible to exercise end-to-end in tests or staging. This client speaks the
 * same documented API (POST <base>/push/send, JSON array of messages, one ticket
 * per message) and reads the base URL from EXPO_PUSH_API_URL
 * (default https://exp.host/--/api/v2). EXPO_ACCESS_TOKEN is sent as a bearer
 * token when set (required only if "enhanced push security" is on in Expo).
 */
import logger from '../utils/logger.js';

const DEFAULT_BASE = 'https://exp.host/--/api/v2';
const CHUNK = 100;               // Expo's per-request message limit
const TIMEOUT_MS = 15_000;

export function expoPushBaseUrl() {
  return String(process.env.EXPO_PUSH_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Same rule as Expo.isExpoPushToken in expo-server-sdk. */
export function isExpoPushToken(token) {
  return typeof token === 'string' && (
    ((token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) && token.endsWith(']'))
    || /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token)
  );
}

/**
 * Send messages; resolves to one ticket per message, in order:
 *   { status: 'ok', id } | { status: 'error', message, details }
 * A transport failure (network, non-2xx, malformed reply) yields an error ticket
 * for every message of the affected chunk instead of throwing.
 */
export async function sendExpoPush(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const tickets = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      const res = await fetch(`${expoPushBaseUrl()}/push/send`, {
        method: 'POST', headers, body: JSON.stringify(chunk), signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      const data = Array.isArray(body?.data) ? body.data : null;
      if (!res.ok || !data || data.length !== chunk.length) {
        const why = !res.ok ? `HTTP ${res.status}` : 'unexpected response';
        logger.warn({ status: res.status }, `[expoPush] send failed: ${why}`);
        chunk.forEach(() => tickets.push({ status: 'error', message: why }));
      } else {
        tickets.push(...data);
      }
    } catch (e) {
      logger.warn(`[expoPush] send failed: ${e.message}`);
      chunk.forEach(() => tickets.push({ status: 'error', message: e.name === 'AbortError' ? 'timeout' : e.message }));
    } finally {
      clearTimeout(timer);
    }
  }
  return tickets;
}
