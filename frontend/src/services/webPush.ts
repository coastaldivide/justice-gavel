/**
 * webPush.ts — browser push for court reminders on the web / PWA app.
 *
 * Before the Oct 2026 reminder review the web app never subscribed to push, so a
 * person using it got court reminders only by e-mail (and none while e-mail was
 * not configured). Flow: GET /webpush/key (off when the server has no VAPID keys)
 * → Notification permission → service worker (/sw.js, which shows the
 * notification) → PushManager.subscribe → POST /webpush/subscribe.
 * Resolves to 'granted' | 'denied' | 'unsupported' | 'off'. Never throws.
 */
import api from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type WebPushAnswer = 'granted' | 'denied' | 'unsupported' | 'off';

export function webPushSupported(): boolean {
  const g = globalThis as any;
  return typeof g.window !== 'undefined' && 'Notification' in g && 'serviceWorker' in (g.navigator || {}) && 'PushManager' in g;
}

/** Ask (when needed) and subscribe this browser. `ask` false = only sync an existing grant. */
export async function subscribeWebPush({ ask = true }: { ask?: boolean } = {}): Promise<WebPushAnswer> {
  try {
    if (!webPushSupported()) return 'unsupported';
    const g = globalThis as any;
    const key = await api.get('/webpush/key').then(r => r.data).catch(() => null);
    if (!key?.enabled || !key.public_key) return 'off';
    let perm: string = g.Notification.permission;
    if (perm === 'default' && ask) perm = await g.Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = (await g.navigator.serviceWorker.getRegistration()) || (await g.navigator.serviceWorker.register('/sw.js'));
    await g.navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.public_key) });
    await api.post('/webpush/subscribe', { subscription: sub.toJSON(), user_agent: String(g.navigator.userAgent || '').slice(0, 300), platform: 'web' });
    return 'granted';
  } catch {
    return 'denied';
  }
}
