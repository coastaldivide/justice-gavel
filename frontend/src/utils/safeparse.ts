/**
 * safeparse.ts — safe numeric and JSON parsing utilities
 * Prevents parseInt/parseFloat/JSON.parse from crashing the app.
 */

/** Parse integer safely — returns fallback if NaN or non-numeric */
export function safeInt(val: string | number | undefined | null, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseInt(String(val).replace(/[^\d.-]/g, ''), 10);
  return isNaN(n) ? fallback : n;
}

/** Parse float safely — strips currency symbols first */
export function safeFloat(val: string | number | undefined | null, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

/** Parse JSON safely — returns fallback if malformed */
export function safeJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

/** Ensure a value is a non-empty array */
export function ensureArray<T>(val: T[] | null | undefined): T[] {
  return Array.isArray(val) ? val : [];
}

/** Clamp a number between min and max */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
