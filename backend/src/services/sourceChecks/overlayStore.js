/**
 * sourceChecks/overlayStore.js — loads legal_source_checks into the in-memory overlay the app
 * reads (ai/sourceOverlay.js): at start-up, every 5 minutes, and after every change on this
 * instance. Never throws (an unreadable table leaves the overlay as it was).
 */
import { setOverlay, setOverlayRow } from '../../ai/sourceOverlay.js';
import logger from '../../utils/logger.js';

export async function reloadOverlay(db) {
  if (!db || db.engine !== 'postgres') return 0;
  try {
    const rows = await db.all(
      `SELECT dataset, row_key, checked_on, withheld, approved_source_url FROM legal_source_checks
        WHERE checked_on IS NOT NULL OR withheld OR approved_source_url IS NOT NULL
        ORDER BY dataset, row_key LIMIT 20000`);
    setOverlay(rows);
    return rows.length;
  } catch (e) {
    logger.warn({ err: e.message }, '[source-checks] overlay reload failed');
    return 0;
  }
}

/** After a change to one row on this instance. */
export async function refreshOverlayRow(db, dataset, key) {
  try {
    const r = await db.get('SELECT dataset, row_key, checked_on, withheld, approved_source_url FROM legal_source_checks WHERE dataset = ? AND row_key = ?', [dataset, String(key)]);
    if (r) setOverlayRow(r);
  } catch (e) {
    logger.warn({ err: e.message }, '[source-checks] overlay row refresh failed');
  }
}

let timer = null;
export function startOverlayRefresh(getDb, everyMs = 5 * 60_000) {
  if (timer) return timer;
  const tick = async () => { try { await reloadOverlay(await getDb()); } catch { /* next tick */ } };
  tick();
  timer = setInterval(tick, everyMs);
  timer.unref?.();
  return timer;
}
export function stopOverlayRefresh() { if (timer) clearInterval(timer); timer = null; }
