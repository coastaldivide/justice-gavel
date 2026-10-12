/**
 * html.ts — escaping for user/AI text placed into generated HTML (printable
 * PDFs via expo-print, the web print window). Text is stored exactly as typed
 * (the backend no longer HTML-encodes input), so every HTML sink must escape.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
};

/** Escape a value for an HTML text node or quoted attribute. null/undefined → ''. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, c => HTML_ESCAPES[c]);
}
