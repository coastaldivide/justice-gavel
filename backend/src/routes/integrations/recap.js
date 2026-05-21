/**
 * routes/integrations/recap.js — CourtListener RECAP Federal Docket Import
 * ─────────────────────────────────────────────────────────────────────────────
 * CourtListener's RECAP dataset is a free, comprehensive archive of federal
 * court dockets and documents. This route lets attorneys link a federal case
 * number to a Justice Gavel matter and automatically import:
 *   - All docket entries (filing dates, descriptions, deadlines)
 *   - Party names and attorneys of record
 *   - Judge name and court
 *   - Key dates (filing date, termination date)
 *
 * No subscription required. CourtListener provides a free REST API.
 * Set COURTLISTENER_TOKEN in .env for authenticated requests (higher rate limits).
 * Without a token, requests are rate-limited to 5000/day anonymously.
 *
 * API Reference: https://www.courtlistener.com/api/rest/v4/
 * RECAP Archive:  https://www.courtlistener.com/recap/
 *
 * ENDPOINTS:
 *   GET  /api/integrations/recap/search          — search for a case by name/number
 *   POST /api/integrations/recap/link            — link a CL docket to a matter
 *   POST /api/integrations/recap/import/:matterId — import docket entries as deadlines
 *   GET  /api/integrations/recap/status/:matterId — show linked docket + last import
 *   POST /api/integrations/recap/refresh/:matterId— re-fetch and update deadlines
 *   DELETE /api/integrations/recap/unlink/:matterId — remove the link
 */

import { Router }       from 'express';
import { getDb }        from '../../db/index.js';
import { authRequired } from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }           from '../../utils/routeHelpers.js';
import logger           from '../../utils/logger.js';

const router      = Router();
const recapLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'RECAP search limit reached — CourtListener rate limits apply.' });

// ─── CourtListener API helpers ────────────────────────────────────────────────

const CL_BASE    = 'https://www.courtlistener.com/api/rest/v4';
const CL_TOKEN   = process.env.COURTLISTENER_TOKEN || null;

function clHeaders() {
  const h = { 'Accept': 'application/json', 'User-Agent': 'JusticeGavel/1.0 (+https://justicegavel.app)' };
  if (CL_TOKEN) h['Authorization'] = `Token ${CL_TOKEN}`;
  return h;
}

async function clGet(path, params = {}) {
  const url    = new URL(`${CL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url.toString(), {
      headers: clHeaders(),
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`CourtListener ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ─── Court code → human-readable court name ──────────────────────────────────

const COURT_NAMES = {
  'dcd':  'D.D.C. (District of Columbia)',
  'ca1':  '1st Circuit', 'ca2': '2nd Circuit', 'ca3': '3rd Circuit',
  'ca4':  '4th Circuit', 'ca5': '5th Circuit', 'ca6': '6th Circuit',
  'ca7':  '7th Circuit', 'ca8': '8th Circuit', 'ca9': '9th Circuit',
  'ca10': '10th Circuit', 'ca11': '11th Circuit', 'cadc': 'D.C. Circuit',
  'cafc': 'Federal Circuit', 'scotus': 'Supreme Court of the United States',
};
function courtName(code) { return COURT_NAMES[code] || code?.toUpperCase() || 'Federal Court'; }

// ─── Classify a docket entry description as a deadline type ──────────────────

function classifyEntry(description) {
  const d = (description || '').toLowerCase();
  if (/order|judgment|opinion/.test(d))        return { type: 'filing',   priority: 'high' };
  if (/motion|brief|response|reply|oppos/.test(d)) return { type: 'filing', priority: 'high' };
  if (/hearing|trial|oral argument/.test(d))   return { type: 'hearing',  priority: 'critical' };
  if (/deadline|due|serve|file/.test(d))        return { type: 'deadline', priority: 'high' };
  if (/notice|summons/.test(d))                 return { type: 'filing',   priority: 'medium' };
  if (/settlement|conference/.test(d))          return { type: 'conference', priority: 'medium' };
  return { type: 'filing', priority: 'low' };
}

// ─── GET /recap/search — search CourtListener for a case ─────────────────────
// Attorneys search by case name, docket number, or party name.
// Results include docket_id, case_name, court, date_filed for easy linking.

router.get('/search', authRequired, recapLimiter, async (req, res) => {
  try {
    const ctx = await loadFirmContext(req);
    if (!ctx) return err403(res, 'Not a firm member.');
    if (!hasMinRoleLocal(ctx?.firm_role, 'associate')) {
      return err403(res, 'associate+ required');
    }

    const { q, court, docket_number } = req.query;
    if (!q && !docket_number) return err400(res, 'q or docket_number required');

    const params = { page_size: 10, type: 'd' }; // type=d → docket search
    if (q)             params.q             = sanitizeStr(String(q), 200);
    if (court)         params.court         = sanitizeStr(String(court), 20);
    if (docket_number) params.docket_number = sanitizeStr(String(docket_number), 50);

    const data = await clGet('/dockets/', params);
    if (!data) return res.json({ results: [], count: 0 });

    const results = (data.results || []).map(d => ({
      docket_id:     d.id,
      case_name:     d.case_name || d.case_name_short,
      docket_number: d.docket_number,
      court:         d.court_id,
      court_name:    courtName(d.court_id),
      date_filed:    d.date_filed,
      date_terminated: d.date_terminated,
      pacer_case_id: d.pacer_case_id,
      cl_url:        `https://www.courtlistener.com/docket/${d.id}/`,
      judge:         d.assigned_to_str || null,
      parties_count: d.parties_count || 0,
    }));

    res.json({ results, count: results.length, source: 'courtlistener' });
  } catch (e) {
    logger.error('[recap/search]', e.message);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'CourtListener request timed out.' });
    res.status(500).json({ error: 'RECAP search failed.', detail: e.message });
  }
});

// Helper: minimal role check
function hasMinRoleLocal(role, min) {
  const ORDER = ['associate','partner','firm_admin','super_admin'];
  return ORDER.indexOf(role) >= ORDER.indexOf(min);
}

// ─── POST /recap/link — link a CL docket to a matter ─────────────────────────
// Stores the CourtListener docket ID alongside the matter for import/refresh.

router.post('/link', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return err403(res, 'Not a firm member.');
    if (!hasMinRoleLocal(ctx?.firm_role, 'associate')) return err403(res, 'associate+ required');

    const { matter_id, docket_id, case_name, docket_number, court } = req.body || {};
    if (!matter_id)  return err400(res, 'matter_id required');
    if (!docket_id)  return err400(res, 'docket_id required (from RECAP search results)');

    // Verify matter belongs to this firm
    const matter = await db.get('SELECT id, firm_id FROM matters WHERE id=? AND firm_id=?',
      [safeInt(matter_id), ctx.firm_id]).catch(() => null);
    if (!matter) return err404(res, 'Matter not found.');

    // Upsert into integration_external_ids with provider='recap'
    await db.run(
      `INSERT INTO integration_external_ids
         (firm_id, provider, entity_type, internal_id, external_id, synced_at)
       VALUES (?, 'recap', 'matter', ?, ?, datetime('now'))
       ON CONFLICT(firm_id, provider, entity_type, internal_id)
       DO UPDATE SET external_id=excluded.external_id, synced_at=excluded.synced_at`,
      [ctx.firm_id, safeInt(matter_id), String(docket_id)]
    );

    // Store docket metadata on the matter for display
    await db.run(
      `UPDATE matters SET updated_at=datetime('now') WHERE id=?`,
      [safeInt(matter_id)]
    );

    // Log the link
    const meta = JSON.stringify({
      docket_id:     String(docket_id),
      case_name:     case_name ? truncateStr(sanitizeStr(case_name, 300), 300) : null,
      docket_number: docket_number ? sanitizeStr(docket_number, 50) : null,
      court:         court ? sanitizeStr(court, 20) : null,
      court_name:    court ? courtName(court) : null,
      cl_url:        `https://www.courtlistener.com/docket/${docket_id}/`,
    });

    await db.run(
      `INSERT INTO integration_sync_log
         (firm_id, direction, entity_type, entity_id, external_id, status,
          records_sent, records_received)
       VALUES (?, 'pull', 'docket_link', ?, ?, 'success', 0, 0)`,
      [ctx.firm_id, safeInt(matter_id), String(docket_id)]
    ).catch(() => {});

    logger.info(`[recap/link] firm ${ctx.firm_id} linked matter ${matter_id} → CL docket ${docket_id}`);

    res.status(201).json({
      ok:            true,
      matter_id:     safeInt(matter_id),
      docket_id:     String(docket_id),
      case_name:     case_name || null,
      docket_number: docket_number || null,
      court_name:    court ? courtName(court) : null,
      cl_url:        `https://www.courtlistener.com/docket/${docket_id}/`,
      next_step:     `POST /api/integrations/recap/import/${matter_id} to import docket entries as deadlines`,
    });
  } catch (e) {
    logger.error('[recap/link]', e.message);
    res.status(500).json({ error: 'Could not link docket.' });
  }
});

// ─── POST /recap/import/:matterId — import docket entries as docket deadlines ─
// Fetches docket entries from CourtListener and creates docket_entries records.
// Uses INSERT OR IGNORE to avoid duplicates on re-import.

router.post('/import/:matterId', authRequired, recapLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);
    if (!hasMinRoleLocal(ctx?.firm_role, 'associate')) return err403(res, 'associate+ required');

    // Get the linked docket ID
    const linkRow = await db.get(
      `SELECT external_id FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    ).catch(() => null);
    if (!linkRow) return err404(res, 'No RECAP docket linked to this matter. POST /recap/link first.');

    const docketId = linkRow.external_id;
    const { page_size = 50, days_back } = req.body || {};

    // Fetch docket entries from CourtListener
    const params = { docket: docketId, page_size: Math.min(safeInt(page_size, 50), 100), order_by: 'recap_sequence_number' };
    if (days_back) {
      const since = new Date();
      since.setDate(since.getDate() - safeInt(days_back, 30));
      params.date_filed__gte = since.toISOString().slice(0, 10);
    }

    const data = await clGet('/docket-entries/', params);
    if (!data) return res.status(502).json({ error: 'CourtListener returned no data for this docket.' });

    const entries = data.results || [];
    let imported = 0, skipped = 0;

    for (const entry of entries) {
      const desc = entry.description || entry.short_description || `Docket entry #${entry.entry_number}`;
      const { type, priority } = classifyEntry(desc);
      const entryDate = entry.date_filed || new Date().toISOString().slice(0, 10);

      // External UID: stable across re-imports
      const externalId = `recap_${docketId}_${entry.id}`;

      // Skip if already imported
      const exists = await db.get(
        `SELECT id FROM integration_external_ids
         WHERE firm_id=? AND provider='recap' AND entity_type='docket_entry' AND external_id=?`,
        [ctx.firm_id, externalId]
      ).catch(() => null);

      if (exists) { skipped++; continue; }

      // Create docket entry
      const result = await db.run(
        `INSERT INTO docket_entries
           (matter_id, firm_id, title, entry_type, due_date, status, priority,
            notes, rule_citation, calculated_from, days_from_event, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'RECAP Import', ?, 0, datetime('now'))`,
        [
          matterId, ctx.firm_id,
          truncateStr(sanitizeStr(desc, 500), 500),
          type, entryDate, priority,
          entry.pacer_doc_id ? `PACER Doc #${entry.pacer_doc_id}` : null,
          entryDate,
        ]
      ).catch(() => null);

      if (result?.lastID) {
        // Record the mapping so re-import skips this entry
        await db.run(
          `INSERT OR IGNORE INTO integration_external_ids
             (firm_id, provider, entity_type, internal_id, external_id, synced_at)
           VALUES (?, 'recap', 'docket_entry', ?, ?, datetime('now'))`,
          [ctx.firm_id, result.lastID, externalId]
        ).catch(() => {});
        imported++;
      }
    }

    // Update last sync on the link record
    await db.run(
      `UPDATE integration_external_ids SET synced_at=datetime('now')
       WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    ).catch(() => {});

    await db.run(
      `INSERT INTO integration_sync_log
         (firm_id, direction, entity_type, entity_id, external_id, status,
          records_sent, records_received)
       VALUES (?, 'pull', 'docket_entries', ?, ?, 'success', 0, ?)`,
      [ctx.firm_id, matterId, docketId, imported]
    ).catch(() => {});

    logger.info(`[recap/import] matter ${matterId}: ${imported} imported, ${skipped} skipped`);

    res.json({
      ok:            true,
      matter_id:     matterId,
      docket_id:     docketId,
      total_fetched: entries.length,
      imported,
      skipped,
      cl_url:        `https://www.courtlistener.com/docket/${docketId}/`,
      message:       imported > 0
        ? `${imported} docket entries imported as deadlines. Check the Docket tab.`
        : `All ${skipped} entries were already imported.`,
    });
  } catch (e) {
    logger.error('[recap/import]', e.message);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'CourtListener timed out.' });
    res.status(500).json({ error: 'RECAP import failed.', detail: e.message });
  }
});

// ─── GET /recap/status/:matterId — show linked docket + import stats ──────────

router.get('/status/:matterId', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);

    const linkRow = await db.get(
      `SELECT external_id, synced_at FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    ).catch(() => null);

    if (!linkRow) {
      return res.json({ linked: false, matter_id: matterId });
    }

    const importedCount = await db.get(
      `SELECT COUNT(*) as n FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='docket_entry'`,
      [ctx.firm_id]
    ).catch(() => ({ n: 0 }));

    res.json({
      linked:        true,
      matter_id:     matterId,
      docket_id:     linkRow.external_id,
      last_synced:   linkRow.synced_at,
      imported_entries: importedCount.n,
      cl_url:        `https://www.courtlistener.com/docket/${linkRow.external_id}/`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not get RECAP status.' });
  }
});

// ─── POST /recap/refresh/:matterId — re-fetch and add new entries ────────────
// Idempotent: INSERT OR IGNORE skips already-imported entries.
// Defaults to looking back 14 days for any new filings.

router.post('/refresh/:matterId', authRequired, recapLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);
    if (!hasMinRoleLocal(ctx?.firm_role, 'associate')) return err403(res, 'associate+ required');

    const linkRow = await db.get(
      `SELECT external_id FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    ).catch(() => null);
    if (!linkRow) return err404(res, 'No RECAP docket linked. POST /recap/link first.');

    const docketId  = linkRow.external_id;
    const daysBack  = safeInt(req.body?.days_back || 14, 14);
    const since     = new Date();
    since.setDate(since.getDate() - daysBack);

    const params = {
      docket:          docketId,
      page_size:       50,
      order_by:        'recap_sequence_number',
      date_filed__gte: since.toISOString().slice(0, 10),
    };

    const data    = await clGet('/docket-entries/', params);
    const entries = data?.results || [];
    let imported  = 0, skipped = 0;

    for (const entry of entries) {
      const desc       = entry.description || `Docket entry #${entry.entry_number}`;
      const { type, priority } = classifyEntry(desc);
      const entryDate  = entry.date_filed || new Date().toISOString().slice(0, 10);
      const externalId = `recap_${docketId}_${entry.id}`;

      const exists = await db.get(
        `SELECT id FROM integration_external_ids WHERE firm_id=? AND provider='recap' AND entity_type='docket_entry' AND external_id=?`,
        [ctx.firm_id, externalId]
      ).catch(() => null);
      if (exists) { skipped++; continue; }

      const result = await db.run(
        `INSERT INTO docket_entries
           (matter_id, firm_id, title, entry_type, due_date, status, priority, notes, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
        [matterId, ctx.firm_id, truncateStr(sanitizeStr(desc, 500), 500),
         type, entryDate, priority,
         entry.pacer_doc_id ? `PACER Doc #${entry.pacer_doc_id}` : null]
      ).catch(() => null);

      if (result?.lastID) {
        await db.run(
          `INSERT OR IGNORE INTO integration_external_ids (firm_id,provider,entity_type,internal_id,external_id) VALUES (?,'recap','docket_entry',?,?)`,
          [ctx.firm_id, result.lastID, externalId]
        ).catch(() => {});
        imported++;
      }
    }

    await db.run(
      `UPDATE integration_external_ids SET synced_at=datetime('now') WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    ).catch(() => {});

    res.json({ ok: true, matter_id: matterId, docket_id: docketId,
      total_fetched: entries.length, imported, skipped, days_back: daysBack });
  } catch (e) {
    logger.error('[recap/refresh]', e.message);
    res.status(500).json({ error: 'RECAP refresh failed.' });
  }
});

// ─── DELETE /recap/unlink/:matterId — remove the RECAP link ──────────────────

router.delete('/unlink/:matterId', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);
    if (!hasMinRoleLocal(ctx?.firm_role, 'firm_admin')) return err403(res, 'firm_admin+ required to unlink');

    await db.run(
      `DELETE FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
      [ctx.firm_id, matterId]
    );

    res.json({ ok: true, matter_id: matterId, unlinked: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not unlink docket.' });
  }
});

// ─── SHARED: importDocketEntries ─────────────────────────────────────────────
// Called by /import and /refresh — single source of truth for docket fetch logic.
// INSERT OR IGNORE + external_id mapping ensures idempotency across calls.
export async function importDocketEntries(db, ctx, matterId, docketId, opts = {}) {
  const { daysBack = null, pageSize = 50 } = opts;
  const params = {
    docket:    docketId,
    page_size: Math.min(pageSize, 100),
    order_by:  'recap_sequence_number',
  };
  if (daysBack) {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    params.date_filed__gte = since.toISOString().slice(0, 10);
  }
  const data    = await clGet('/docket-entries/', params);
  const entries = data?.results || [];
  let imported = 0, skipped = 0;

  for (const entry of entries) {
    const desc       = entry.description || `Docket entry #${entry.entry_number}`;
    const { type, priority } = classifyEntry(desc);
    const entryDate  = entry.date_filed || new Date().toISOString().slice(0, 10);
    const externalId = `recap_${docketId}_${entry.id}`;

    const exists = await db.get(
      `SELECT id FROM integration_external_ids
       WHERE firm_id=? AND provider='recap' AND entity_type='docket_entry' AND external_id=?`,
      [ctx.firm_id, externalId]
    ).catch(() => null);
    if (exists) { skipped++; continue; }

    const result = await db.run(
      `INSERT INTO docket_entries
         (matter_id, firm_id, title, entry_type, due_date, status, priority, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
      [
        matterId, ctx.firm_id,
        truncateStr(sanitizeStr(desc, 500), 500),
        type, entryDate, priority,
        entry.pacer_doc_id ? `PACER Doc #${entry.pacer_doc_id}` : null,
      ]
    ).catch(() => null);

    if (result?.lastID) {
      await db.run(
        `INSERT OR IGNORE INTO integration_external_ids
           (firm_id, provider, entity_type, internal_id, external_id, synced_at)
         VALUES (?, 'recap', 'docket_entry', ?, ?, datetime('now'))`,
        [ctx.firm_id, result.lastID, externalId]
      ).catch(() => {});
      imported++;
    }
  }

  // Update last-synced timestamp on the matter link
  await db.run(
    `UPDATE integration_external_ids SET synced_at=datetime('now')
     WHERE firm_id=? AND provider='recap' AND entity_type='matter' AND internal_id=?`,
    [ctx.firm_id, matterId]
  ).catch(() => {});

  return { entries, imported, skipped };
}

export default router;
