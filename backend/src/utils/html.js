/**
 * utils/html.js — escaping for values interpolated into HTML (email templates,
 * generated documents). User-controlled text is stored RAW and escaped only at
 * the HTML sink (M4) — never "pre-escaped" on the way into the database.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

/** Escape a value for an HTML text node or a quoted attribute. null/undefined → ''. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`=]/g, (c) => HTML_ESCAPES[c]);
}

/**
 * A URL that is safe to put in href/src: only http(s) (and mailto) URLs are
 * kept, anything else (javascript:, data:, vbscript:, relative junk) becomes
 * the fallback. The result is HTML-escaped for use inside a quoted attribute.
 */
export function safeUrl(value, fallback = 'https://justicegavel.app') {
  try {
    const u = new URL(String(value ?? ''));
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') return escapeHtml(u.toString());
  } catch { /* fall through */ }
  return escapeHtml(fallback);
}

/** Header-safe single line (subjects): strips CR/LF and control characters. */
export function headerSafe(value, max = 200) {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Tagged template that escapes every interpolated value:
 *   html`<p>Hi ${name}</p>`
 * Wrap trusted, already-built markup in raw() to opt out.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (v && typeof v === 'object' && v.__rawHtml === true) ? v.value : escapeHtml(v);
    out += strings[i + 1];
  }
  return out;
}
export const raw = (value) => ({ __rawHtml: true, value: String(value ?? '') });
