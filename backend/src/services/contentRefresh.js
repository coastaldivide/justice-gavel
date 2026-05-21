import logger from '../utils/logger.js';
/**
 * contentRefresh.js — Legal content staleness tracking and refresh service.
 *
 * STALENESS THRESHOLDS:
 *   expungement_rules: 30 days | rights_cards: 60 days
 *   crisis_resources:  30 days | court_forms:  90 days (manual)
 *
 * Every content record carries content_verified_at + law_effective_date.
 * Frontend surfaces: "Last verified: 14 days ago" per ABA/LawHelp standard.
 */
import { getDb } from '../db/index.js';

let lastRefreshRun = 0;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const THRESHOLDS = {
  expungement_rules: 30,
  rights_cards:      60,
  crisis_resources:  30,
};

export async function refreshLegalContent() {
  const now = Date.now();
  if (now - lastRefreshRun < REFRESH_INTERVAL_MS) return { skipped: true };
  lastRefreshRun = now;

  const db      = await getDb();
  const runAt   = new Date().toISOString();
  const results = { updated: [], warnings: [], errors: [] };

  // ── 1. Expungement rules ──────────────────────────────────────────────────
  try {
    const stale = await db.all(
      `SELECT id, state, content_verified_at FROM expungement_rules
        WHERE content_verified_at < datetime('now', '-30 days') OR content_verified_at IS NULL`
    ).catch(() => []);

    if (stale.length) {
      await db.run(
        `UPDATE expungement_rules SET needs_review=1, stale_since=COALESCE(stale_since,datetime('now'))
          WHERE content_verified_at < datetime('now', '-30 days') OR content_verified_at IS NULL`
      ).catch(() => {});
      const states = stale.map(r => r.state).join(', ');
      results.warnings.push(`expungement_rules: ${stale.length} states stale (${states}) — needs attorney review`);
      if (stale.length > 5) {
        logger.error('[Content Refresh] CRITICAL:', stale.length, 'expungement_rules states stale');
      }
    } else {
      results.updated.push('expungement_rules: all states current');
    }

    const oldest = await db.get(
      `SELECT state, content_verified_at,
              CAST(julianday('now')-julianday(content_verified_at) AS INTEGER) as days_old
         FROM expungement_rules WHERE content_verified_at IS NOT NULL
        ORDER BY content_verified_at ASC LIMIT 1`
    ).catch(() => null);
    if (oldest) results.updated.push(`expungement_rules: oldest=${oldest.state} (${oldest.days_old}d)`);
  } catch (err) { results.errors.push('expungement_rules: ' + err.message); }

  // ── 2. Rights cards ───────────────────────────────────────────────────────
  try {
    const staleCards = await db.all(
      `SELECT id, title FROM rights_cards
        WHERE content_verified_at < datetime('now', '-60 days') OR content_verified_at IS NULL`
    ).catch(() => []);

    if (staleCards.length) {
      await db.run(
        `UPDATE rights_cards SET needs_review=1, stale_since=COALESCE(stale_since,datetime('now'))
          WHERE content_verified_at < datetime('now', '-60 days') OR content_verified_at IS NULL`
      ).catch(() => {});
      results.warnings.push(`rights_cards: ${staleCards.length} cards stale`);
    } else {
      results.updated.push('rights_cards: all current');
    }
  } catch (err) { results.errors.push('rights_cards: ' + err.message); }

  // ── 3. Crisis resources ───────────────────────────────────────────────────
  try {
    const staleRes = await db.all(
      `SELECT id, name FROM crisis_resources
        WHERE last_verified < datetime('now', '-30 days') OR last_verified IS NULL`
    ).catch(() => []);

    if (staleRes.length) {
      await db.run(
        `UPDATE crisis_resources SET needs_verification=1
          WHERE last_verified < datetime('now', '-30 days') OR last_verified IS NULL`
      ).catch(() => {});
      results.warnings.push(`crisis_resources: ${staleRes.length} need phone verification`);
    } else {
      try {
        await db.run(`UPDATE crisis_resources SET last_verified=datetime('now')`);
        results.updated.push('crisis_resources: all verified');
      } catch (e) {
        // Failure means next run will re-verify all resources (wasted work, not data loss)
        logger.warn('[contentRefresh] crisis_resources timestamp update failed:', e.message);
        results.warnings.push('crisis_resources: last_verified update failed — will re-check next run');
      }
    }
  } catch (err) { results.errors.push('crisis_resources: ' + err.message); }

  // ── 4. Log run ────────────────────────────────────────────────────────────
  try {
    await db.run(
      `INSERT INTO content_refresh_log
         (run_at, category, results, warnings, errors)
       VALUES (datetime('now'), 'full_refresh', ?, ?, ?)`,
      [JSON.stringify(results.updated), JSON.stringify(results.warnings), JSON.stringify(results.errors)]
    ).catch(() => {});
  } catch (e) { logger.warn('[contentRefresh/logRun]', e?.message); }

  if (results.warnings.length) {
    logger.warn('[Content Refresh]', runAt, '—', results.warnings.join(' | '));
  } else {
    logger.info('[Content Refresh]', runAt, '— all content current');
  }
  if (results.errors.length) logger.error('[Content Refresh] Errors:', results.errors.join(' | '));

  return { ...results, run_at: runAt };
}

/**
 * getContentAge — returns staleness metadata for a content record.
 * API routes include this in responses so the frontend can show
 * "Last verified: 14 days ago" per ABA/LawHelpInteractive standard.
 */
export async function getContentAge(table, id) {
  const SAFE = new Set(['expungement_rules','rights_cards','crisis_resources','lessons']);
  if (!SAFE.has(table)) return null;
  try {
    const db  = await getDb();
    const col = table === 'expungement_rules' ? 'state' : 'id';
    const row = await db.get(
      `SELECT content_verified_at, law_effective_date, needs_review,
              CAST(julianday('now')-julianday(content_verified_at) AS INTEGER) as days_old
         FROM ${table} WHERE ${col}=? LIMIT 1`, [id]
    ).catch(() => null);
    if (!row) return null;
    const d = row.days_old ?? null;
    return {
      content_verified_at: row.content_verified_at,
      law_effective_date:  row.law_effective_date || null,
      days_since_verified: d,
      needs_review:        !!row.needs_review,
      staleness_label: d === null ? 'unknown' : d<=7 ? 'fresh' : d<=30 ? 'recent' : d<=60 ? 'aging' : 'stale',
    };
  } catch { return null; }
}

export function startContentRefreshSchedule() {
  setTimeout(() => {
    refreshLegalContent().catch(err =>
      logger.error('[Content Refresh] Startup:', err.message));
  }, 30_000);

  const interval = setInterval(() => {
    refreshLegalContent().catch(err =>
      logger.error('[Content Refresh] Interval:', err.message));
  }, REFRESH_INTERVAL_MS);

  return interval;
}
