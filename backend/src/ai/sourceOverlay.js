/**
 * ai/sourceOverlay.js — what the source re-checks changed, as the app reads it (synchronously).
 *
 * The sourced rows live in many places — generated data files (expungement, recording law,
 * court rules, transit, the court guide), constants (TN report, deadline presets, rights card)
 * and database tables (bail, DUI, drug penalties, limitations, victim compensation, specialty
 * courts, rights_cards). The weekly re-check (services/sourceChecks) never edits a row. What it
 * — or an admin — may change is recorded in legal_source_checks and mirrored here:
 *   checkedOn(dataset, key, fallback)   the newer of the row's own "checked" date and the last
 *                                        verified re-check / admin approval
 *   isWithheld(dataset, key)            an admin withheld the row (or recorded a correction that
 *                                        a developer still has to apply): the app stops showing it
 *   approvedSource(dataset, key)        a source an admin approved for a row that had none
 * Database tables also get last_reviewed_at / source_url written directly (services/sourceChecks
 * reviews.js); this overlay covers the rows that live in code.
 *
 * Pure: no DB import. services/sourceChecks/overlayStore.js loads it at start-up, every 5 minutes
 * and after every change. An empty overlay changes nothing.
 */
const map = new Map();
let loadedAt = 0;

const k = (dataset, key) => `${dataset}\u0000${key}`;
const day = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Replace the whole overlay (rows from legal_source_checks). */
export function setOverlay(rows = []) {
  map.clear();
  for (const r of rows) {
    if (!r?.dataset || r.row_key == null) continue;
    map.set(k(r.dataset, String(r.row_key)), {
      checked_on: day(r.checked_on), withheld: !!r.withheld, approved_source_url: r.approved_source_url || null,
    });
  }
  loadedAt = Date.now();
}
/** Set one row (after an admin decision / a verified re-check, before the next full reload). */
export function setOverlayRow(r) {
  if (!r?.dataset || r.row_key == null) return;
  map.set(k(r.dataset, String(r.row_key)), {
    checked_on: day(r.checked_on), withheld: !!r.withheld, approved_source_url: r.approved_source_url || null,
  });
}
export const overlayLoadedAt = () => loadedAt;
export const overlaySize = () => map.size;

/** The later of the row's own date and the overlay's verified date ('YYYY-MM-DD'). */
export function checkedOn(dataset, key, fallback = null) {
  const o = map.get(k(dataset, String(key)));
  const a = day(fallback); const b = o?.checked_on || null;
  if (!a) return b; if (!b) return a;
  return b > a ? b : a;
}
export function isWithheld(dataset, key) {
  return !!map.get(k(dataset, String(key)))?.withheld;
}
export function approvedSource(dataset, key) {
  return map.get(k(dataset, String(key)))?.approved_source_url || null;
}
/** Every overlay entry of one dataset: { key → { checked_on, withheld } } (public status endpoint). */
export function datasetOverlay(dataset) {
  const out = {};
  const p = `${dataset}\u0000`;
  for (const [key, v] of map) if (key.startsWith(p)) out[key.slice(p.length)] = { checked_on: v.checked_on, withheld: v.withheld };
  return out;
}
