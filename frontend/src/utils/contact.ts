/**
 * contact.ts — well-formed contact links for directory listings (lawyers,
 * bail agents): tel:, sms:, maps and website URLs, plus display formatting.
 *
 * Directory phones are stored as E.164 ("+16152074174"). People read them as
 * "(615) 207-4174"; the dialer gets "+16152074174".
 */
import { Platform } from 'react-native';

/** Digits with a leading + kept ("+1 (615) 207-4174" → "+16152074174"); null when not a phone number. */
export function dialable(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (!plus && digits.length === 10) return `+1${digits}`;
  if (!plus && digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return plus ? `+${digits}` : digits;
}

/** "+16152074174" → "(615) 207-4174"; other countries / shapes are shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  const d = dialable(phone);
  if (!d) return String(phone ?? '');
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(d);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(phone);
}

export function telUrl(phone: string | null | undefined): string | null {
  const d = dialable(phone);
  return d ? `tel:${d}` : null;
}

/** sms: link; iOS separates the body with "&", Android / web with "?". */
export function smsUrl(phone: string | null | undefined, body?: string): string | null {
  const d = dialable(phone);
  if (!d) return null;
  if (!body) return `sms:${d}`;
  return `sms:${d}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

/** Directions to a listing: Apple Maps on iOS, Google Maps elsewhere (app or browser). */
export function directionsUrl(p: { lat?: number | null; lng?: number | null; address?: string | null; name?: string | null }): string | null {
  const hasPoint = Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
  const dest = hasPoint ? `${p.lat},${p.lng}` : (p.address || '').trim();
  if (!dest) return null;
  if (Platform.OS === 'ios') {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}${p.name ? `&q=${encodeURIComponent(p.name)}` : ''}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/** http(s) website only (anything else — javascript:, data:, … — is refused). */
export function websiteUrl(url: string | null | undefined): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

/** "www.example.com" for showing a website link. */
export function websiteLabel(url: string | null | undefined): string {
  const u = websiteUrl(url);
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}
