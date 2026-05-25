/**
 * routes/time.js — Time Tracking & Invoice Generation
 *
 * Time Entries:
 *   POST   /api/time/entries              — create time entry (any attorney)
 *   GET    /api/time/entries              — list entries (filtered by matter/date/user)
 *   GET    /api/time/entries/:id          — get single entry
 *   PUT    /api/time/entries/:id          — update entry (own or manager)
 *   DELETE /api/time/entries/:id          — delete entry (own only, if unbilled)
 *   GET    /api/time/matter/:matterId     — all entries for a matter
 *   GET    /api/time/summary              — firm/user time summary
 *   GET    /api/time/aba-codes            — ABA task and activity code reference
 *
 * Invoices:
 *   POST   /api/time/invoices             — generate invoice from unbilled time
 *   GET    /api/time/invoices             — list invoices
 *   GET    /api/time/invoices/:id         — get invoice with line items
 *   PUT    /api/time/invoices/:id         — update status (sent/paid/void)
 *   GET    /api/time/invoices/:id/pdf     — generate PDF invoice (returns base64)
 */

import { Router }          from 'express';
import PDFDocument         from 'pdfkit';
import { getDb }           from '../db/index.js';
import { authRequired }    from '../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../middleware/rbac.js';
import { writeAuditLog }   from '../middleware/audit.js';
import { dispatchWebhookEvent } from './webhooks/outbound.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt, safeFloat,
         sanitizeStr, truncateStr }         from '../utils/routeHelpers.js';
import logger              from '../utils/logger.js';

const router      = Router();
const timeLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Time entry limit reached.' });
const invLimiter  = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: 'Invoice limit reached.' });

// ── ABA Task / Activity code sets ─────────────────────────────────────────────
const VALID_TASK_CODES = new Set([
  'L110','L120','L130','L140','L150','L160','L190',
  'L210','L220','L230','L240','L250','L260',
  'L310','L320','L330','L340','L350','L390',
  'L410','L420','L430','L440','L450','L460',
  'L510','L520','L530','L540','L550',
]);
const VALID_ACTIVITY_CODES = new Set([
  'A101','A102','A103','A104','A105','A106','A107','A108','A109','A110',
]);

// Round hours to nearest 0.1 (6 minutes) — standard legal billing increment
function roundToTenth(h) {
  return Math.round(parseFloat(h) * 10) / 10;
}

// Generate invoice number: INV-YYYYMM-NNNN
async function generateInvoiceNumber(db, firmId) {
  const ym    = new Date().toISOString().slice(0, 7).replace('-', '');
  const count = await db.get(
    "SELECT COUNT(*) as n FROM invoices WHERE firm_id=? AND invoice_number LIKE ?",
    [firmId, `INV-${ym}-%`]
  ).catch(() => ({ n: 0 }));
  const seq = String((count?.n || 0) + 1).padStart(4, '0');
  return `INV-${ym}-${seq}`;
}

// ── GET /api/time/aba-codes ───────────────────────────────────────────────────
router.get('/aba-codes', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const type = req.query.type ? sanitizeStr(req.query.type, 20) : null;
    const rows = await db.all(
      type ? 'SELECT code, type, label, category FROM aba_codes WHERE type=? ORDER BY code' : 'SELECT code, type, label, category FROM aba_codes ORDER BY type, code',
      type ? [type] : []
    ).catch(() => []);
    res.json({ codes: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load ABA codes.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TIME ENTRIES
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/time/entries — create time entry
router.post('/entries', authRequired, timeLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id,
      matter_table = 'matters',
      entry_date,
      hours,
      rate_cents,
      narrative,
      task_code,
      activity_code,
    } = req.body || {};

    if (!entry_date)   return err400(res, 'entry_date (YYYY-MM-DD) is required.');
    if (!hours)        return err400(res, 'hours is required (e.g. 0.5 for 30 minutes).');
    if (!narrative?.trim()) return err400(res, 'narrative (billing description) is required.');

    const safeHours = roundToTenth(parseFloat(hours) || 0);
    if (safeHours <= 0 || safeHours > 24) return err400(res, 'hours must be between 0.1 and 24.');

    // Resolve billing rate: request body > user's firm rate > default $0
    let resolvedRate = safeInt(rate_cents, 0);
    if (!resolvedRate && matter_id) {
      const matter = await db.get(
        'SELECT billing_rate FROM matters WHERE id=? LIMIT 1',
        [safeInt(matter_id)]
      ).catch(() => null);
      resolvedRate = matter?.billing_rate ? safeInt(matter.billing_rate) * 100 : 0;
    }

    const safeTask = task_code && VALID_TASK_CODES.has(task_code) ? task_code : null;
    const safeAct  = activity_code && VALID_ACTIVITY_CODES.has(activity_code) ? activity_code : null;

    const r = await db.run(
      `INSERT INTO time_entries
        (firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents,
         narrative, task_code, activity_code, billing_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ctx?.firm_id || null,
        matter_id ? safeInt(matter_id) : null,
        sanitizeStr(matter_table, 20),
        req.user.id,
        sanitizeStr(entry_date, 20),
        safeHours,
        resolvedRate,
        truncateStr(sanitizeStr(narrative, 2000), 2000),
        safeTask,
        safeAct,
        'unbilled',
      ]
    );

    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries WHERE id=?', [r.lastID]);
    res.json({ ...entry, amount_cents: Math.round((entry.hours || 0) * (entry.rate_cents || 0)) });
  } catch (e) {
    logger.error('[time/entries/create]', e.message);
    res.status(500).json({ error: 'Could not create time entry.' });
  }
});

// GET /api/time/entries — list time entries
router.get('/entries', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id, user_id, billing_status,
      date_from, date_to,
      limit = 50, offset = 0,
    } = req.query;

    let sql    = `SELECT te.*, u.display_name AS attorney_name
                  FROM time_entries te
                  LEFT JOIN users u ON u.id = te.user_id
                  WHERE 1=1`;
    const params = [];

    // Scope: firm members see firm entries; others see own
    if (ctx?.firm_id) {
      sql += ' AND te.firm_id=?'; params.push(ctx.firm_id);
    } else {
      sql += ' AND te.user_id=?'; params.push(req.user.id);
    }

    if (matter_id)      { sql += ' AND te.matter_id=?';       params.push(safeInt(matter_id)); }
    if (user_id)        { sql += ' AND te.user_id=?';         params.push(safeInt(user_id)); }
    if (billing_status) { sql += ' AND te.billing_status=?';  params.push(sanitizeStr(billing_status, 20)); }
    if (date_from)      { sql += ' AND te.entry_date>=?';     params.push(sanitizeStr(date_from, 20)); }
    if (date_to)        { sql += ' AND te.entry_date<=?';     params.push(sanitizeStr(date_to, 20)); }

    sql += ' ORDER BY te.entry_date DESC, te.created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(safeInt(limit, 50), 100), safeInt(offset, 0));

    const rows = await db.all(sql, params);

    // Compute amounts
    const entries = rows.map(e => ({
      ...e,
      amount_cents: Math.round((e.hours || 0) * (e.rate_cents || 0)),
    }));

    const totals = entries.reduce((acc, e) => {
      acc.total_hours  = (acc.total_hours  || 0) + (e.hours || 0);
      acc.total_amount = (acc.total_amount || 0) + (e.amount_cents || 0);
      return acc;
    }, {});

    res.json({
      entries,
      totals: {
        hours:  Math.round(totals.total_hours * 10) / 10,
        amount_cents: totals.total_amount,
      },
    });
  } catch (e) {
    logger.error('[time/entries/list]', e.message);
    res.status(500).json({ error: 'Could not load time entries.' });
  }
});

// GET /api/time/entries/:id
router.get('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Time entry not found.');
    if (entry.user_id !== req.user.id) {
      const ctx = await loadFirmContext(req);
      if (!ctx || ctx.firm_id !== entry.firm_id) return err403(res);
    }
    res.json({ ...entry, amount_cents: Math.round((entry.hours||0) * (entry.rate_cents||0)) });
  } catch (e) {
    res.status(500).json({ error: 'Could not load time entry.' });
  }
});

// PUT /api/time/entries/:id — update entry
router.put('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Time entry not found.');
    if (entry.user_id !== req.user.id) {
      const ctx = await loadFirmContext(req);
      if (!ctx || ctx.firm_id !== entry.firm_id) return err403(res);
    }
    if (entry.billing_status === 'billed') {
      return err400(res, 'Cannot edit a billed time entry. Void the invoice first.');
    }

    const allowed = ['entry_date','hours','rate_cents','narrative','task_code','activity_code','billing_status'];
    const updates = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (key === 'hours')     val = roundToTenth(parseFloat(val) || 0);
        if (key === 'narrative') val = truncateStr(sanitizeStr(String(val), 2000), 2000);
        if (key === 'task_code' && !VALID_TASK_CODES.has(val)) continue;
        if (key === 'activity_code' && !VALID_ACTIVITY_CODES.has(val)) continue;
        updates.push(`${key}=?`); params.push(val);
      }
    }
    if (!updates.length) return err400(res, 'Nothing to update.');
    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id));
    await db.run(`UPDATE time_entries SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries WHERE id=?', [safeInt(req.params.id)]);
    res.json({ ...updated, amount_cents: Math.round((updated.hours||0)*(updated.rate_cents||0)) });
  } catch (e) {
    res.status(500).json({ error: 'Could not update time entry.' });
  }
});

// DELETE /api/time/entries/:id
router.delete('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Time entry not found.');
    if (entry.user_id !== req.user.id) return err403(res, 'Can only delete your own time entries.');
    if (entry.billing_status === 'billed') {
      return err400(res, 'Cannot delete a billed entry. Void the invoice first.');
    }
    await db.run('DELETE FROM time_entries WHERE id=?', [safeInt(req.params.id)]);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete time entry.' });
  }
});

// GET /api/time/matter/:matterId — all entries for a matter with totals
router.get('/matter/:matterId', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);

    const entries = await db.all(
      `SELECT te.*, u.display_name AS attorney_name
       FROM time_entries te
       LEFT JOIN users u ON u.id = te.user_id
       WHERE te.matter_id=?
       ORDER BY te.entry_date DESC, te.created_at DESC`,
      [matterId]
    );

    const withAmounts = entries.map(e => ({
      ...e,
      amount_cents: Math.round((e.hours||0) * (e.rate_cents||0)),
    }));

    const totals = withAmounts.reduce((acc, e) => {
      acc.total_hours  += e.hours || 0;
      acc.total_amount += e.amount_cents || 0;
      acc.unbilled_hours  += e.billing_status === 'unbilled' ? (e.hours||0) : 0;
      acc.unbilled_amount += e.billing_status === 'unbilled' ? (e.amount_cents||0) : 0;
      return acc;
    }, { total_hours:0, total_amount:0, unbilled_hours:0, unbilled_amount:0 });

    // By-attorney breakdown
    const byAttorney = {};
    for (const e of withAmounts) {
      const name = e.attorney_name || `User ${e.user_id}`;
      if (!byAttorney[name]) byAttorney[name] = { hours: 0, amount_cents: 0, entries: 0 };
      byAttorney[name].hours       += e.hours || 0;
      byAttorney[name].amount_cents += e.amount_cents || 0;
      byAttorney[name].entries++;
    }

    res.json({
      matter_id: matterId,
      entries:   withAmounts,
      totals:    {
        ...totals,
        total_hours:  Math.round(totals.total_hours * 10) / 10,
        unbilled_hours: Math.round(totals.unbilled_hours * 10) / 10,
      },
      by_esquire: Object.entries(byAttorney).map(([name, v]) => ({ name, ...v })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load matter time.' });
  }
});

// GET /api/time/summary — firm or user time summary
router.get('/summary', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    const { date_from, date_to } = req.query;

    let whereFirm = ctx?.firm_id ? `AND firm_id=${safeInt(ctx.firm_id)}` : `AND user_id=${req.user.id}`;
    const dateFilter = [
      date_from ? `AND entry_date >= '${sanitizeStr(date_from,20)}'` : '',
      date_to   ? `AND entry_date <= '${sanitizeStr(date_to,20)}'`   : '',
    ].join(' ');

    const [byStatus, byUser, byMonth] = await Promise.all([
      db.all(`SELECT billing_status, SUM(hours) as hours, SUM(hours*rate_cents) as amount FROM time_entries WHERE 1=1 ${whereFirm} ${dateFilter} GROUP BY billing_status`),
      ctx?.firm_id ? db.all(`SELECT u.display_name, SUM(te.hours) as hours, SUM(te.hours*te.rate_cents) as amount FROM time_entries te JOIN users u ON u.id=te.user_id WHERE te.firm_id=? ${dateFilter} GROUP BY te.user_id ORDER BY hours DESC`, [ctx.firm_id]) : Promise.resolve([]),
      db.all(`SELECT substr(entry_date,1,7) as month, SUM(hours) as hours, SUM(hours*rate_cents) as amount FROM time_entries WHERE 1=1 ${whereFirm} ${dateFilter} GROUP BY month ORDER BY month DESC LIMIT 12`),
    ]);

    res.json({ by_status: byStatus, by_user: byUser, by_month: byMonth });
  } catch (e) {
    res.status(500).json({ error: 'Could not load time summary.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/time/invoices — generate invoice from unbilled time entries
router.post('/invoices', authRequired, requireFirmRole('partner'), invLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;
    if (!ctx?.firm_id) return err403(res, 'Firm membership required to generate invoices.');

    const {
      matter_id,
      matter_table = 'matters',
      client_name,
      client_email,
      billing_period_start,
      billing_period_end,
      tax_rate = 0,
      notes,
      due_date,
      entry_ids,  // optional: specific entry IDs; if omitted, all unbilled for matter
    } = req.body || {};

    if (!client_name?.trim()) return err400(res, 'client_name is required.');
    if (!matter_id)           return err400(res, 'matter_id is required.');

    // Find unbilled entries
    let entriesQuery = `SELECT id, firm_id, matter_id, matter_table, user_id, entry_date, hours, rate_cents, narrative, task_code, activity_code, billing_status, invoice_id, created_at, updated_at FROM time_entries
                        WHERE firm_id=? AND matter_id=? AND billing_status='unbilled'`;
    const queryParams = [ctx.firm_id, safeInt(matter_id)];

    if (Array.isArray(entry_ids) && entry_ids.length) {
      entriesQuery += ` AND id IN (${entry_ids.map(() => '?').join(',')})`;
      queryParams.push(...entry_ids.map(id => safeInt(id)));
    }
    if (billing_period_start) { entriesQuery += ' AND entry_date>=?'; queryParams.push(sanitizeStr(billing_period_start,20)); }
    if (billing_period_end)   { entriesQuery += ' AND entry_date<=?'; queryParams.push(sanitizeStr(billing_period_end,20)); }

    const entries = await db.all(entriesQuery, queryParams);
    if (!entries.length) return err400(res, 'No unbilled time entries found for the specified criteria.');

    // Calculate totals
    const subtotal = entries.reduce((sum, e) => sum + Math.round((e.hours||0) * (e.rate_cents||0)), 0);
    const safeTax  = Math.max(0, Math.min(safeFloat(tax_rate, 0), 50)); // max 50% tax
    const taxCents = Math.round(subtotal * safeTax / 100);
    const total    = subtotal + taxCents;

    const invoiceNumber = await generateInvoiceNumber(db, ctx.firm_id);

    const inv = await db.run(
      `INSERT INTO invoices
        (firm_id, matter_id, matter_table, invoice_number, client_name, client_email,
         billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents,
         total_cents, status, due_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ctx.firm_id, safeInt(matter_id), sanitizeStr(matter_table, 20),
        invoiceNumber,
        truncateStr(sanitizeStr(client_name, 200), 200),
        client_email ? truncateStr(sanitizeStr(client_email, 200), 200) : null,
        billing_period_start || null, billing_period_end || null,
        subtotal, safeTax, taxCents, total,
        'draft', due_date || null,
        notes ? truncateStr(sanitizeStr(notes, 2000), 2000) : null,
        req.user.id,
      ]
    );

    // Mark entries as billed
    const invId = inv.lastID;
    for (const e of entries) {
      await db.run(
        "UPDATE time_entries SET billing_status='billed', invoice_id=? WHERE id=?",
        [invId, e.id]
      );
    }

    dispatchWebhookEvent(db, ctx.firm_id, 'invoice.created', { invoice_id: invId, invoice_number: invoiceNumber, total_cents: total, matter_id: safeInt(matter_id) }).catch(()=>{});
    await writeAuditLog(db, {
      user_id:  req.user.id,
      firm_id:  ctx.firm_id,
      action:   'invoice_create',
      resource: 'invoice',
      target_id: invId,
      detail:   JSON.stringify({ invoice_number: invoiceNumber, entries: entries.length, total_cents: total }),
      ip:       req.ip,
      ua:       req.headers['user-agent'],
    });

    const invoice = await db.get('SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE id=?', [invId]);
    res.json({ ...invoice, entry_count: entries.length, entries });
  } catch (e) {
    logger.error('[time/invoices/create]', e.message);
    res.status(500).json({ error: 'Could not generate invoice.' });
  }
});

// GET /api/time/invoices — list invoices
router.get('/invoices', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx?.firm_id) return res.json({ invoices: [], total: 0 });

    const { status, limit = 20, offset = 0 } = req.query;
    let sql = 'SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE firm_id=?';
    const params = [ctx.firm_id];
    if (status) { sql += ' AND status=?'; params.push(sanitizeStr(status, 20)); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(safeInt(limit,20), 50), safeInt(offset,0));

    const rows  = await db.all(sql, params);
    const total = await db.get('SELECT COUNT(*) as n FROM invoices WHERE firm_id=?', [ctx.firm_id]);
    res.json({ invoices: rows, total: total?.n || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Could not load invoices.' });
  }
});

// GET /api/time/invoices/:id — get invoice with line items
router.get('/invoices/:id', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const ctx     = await loadFirmContext(req);
    const invoice = await db.get('SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE id=?', [safeInt(req.params.id)]);
    if (!invoice) return err404(res, 'Invoice not found.');
    if (invoice.firm_id !== ctx?.firm_id) return err403(res);

    const entries = await db.all(
      `SELECT te.*, u.display_name AS attorney_name
       FROM time_entries te
       LEFT JOIN users u ON u.id = te.user_id
       WHERE te.invoice_id=? ORDER BY te.entry_date ASC`,
      [invoice.id]
    );
    res.json({ ...invoice, entries: entries.map(e => ({ ...e, amount_cents: Math.round((e.hours||0)*(e.rate_cents||0)) })) });
  } catch (e) {
    res.status(500).json({ error: 'Could not load invoice.' });
  }
});

// PUT /api/time/invoices/:id — update invoice status
router.put('/invoices/:id', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db      = await getDb();
    const ctx     = req.firmCtx;
    const invoice = await db.get('SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE id=?', [safeInt(req.params.id)]);
    if (!invoice) return err404(res, 'Invoice not found.');
    if (invoice.firm_id !== ctx?.firm_id) return err403(res);

    const VALID_STATUS = ['draft','sent','paid','overdue','void'];
    const { status, paid_date, due_date, notes } = req.body || {};

    const updates = []; const params = [];
    if (status && VALID_STATUS.includes(status)) { updates.push('status=?'); params.push(status); }
    if (paid_date)  { updates.push('paid_date=?');  params.push(sanitizeStr(paid_date, 20)); }
    if (due_date)   { updates.push('due_date=?');   params.push(sanitizeStr(due_date, 20)); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? truncateStr(sanitizeStr(notes,2000),2000) : null); }
    if (!updates.length) return err400(res, 'Nothing to update.');

    // If voiding, un-bill the time entries
    if (status === 'void' && invoice.status !== 'void') {
      dispatchWebhookEvent(db, ctx?.firm_id, 'invoice.voided', { invoice_id: invoice.id }).catch(()=>{});
      await db.run(
        "UPDATE time_entries SET billing_status='unbilled', invoice_id=NULL WHERE invoice_id=?",
        [invoice.id]
      );
    }

    if (status === 'paid' && invoice.status !== 'paid') dispatchWebhookEvent(db, ctx?.firm_id, 'invoice.paid', { invoice_id: invoice.id }).catch(()=>{});
    if (status === 'sent' && invoice.status !== 'sent') dispatchWebhookEvent(db, ctx?.firm_id, 'invoice.sent', { invoice_id: invoice.id }).catch(()=>{});
    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id));
    await db.run(`UPDATE invoices SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE id=?', [safeInt(req.params.id)]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Could not update invoice.' });
  }
});

// GET /api/time/invoices/:id/pdf — generate PDF invoice
router.get('/invoices/:id/pdf', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const ctx     = await loadFirmContext(req);
    const invoice = await db.get('SELECT id, firm_id, matter_id, matter_table, invoice_number, client_name, client_email, billing_period_start, billing_period_end, subtotal_cents, tax_rate, tax_cents, total_cents, status, due_date, paid_date, notes, pdf_generated, created_by, created_at, updated_at FROM invoices WHERE id=?', [safeInt(req.params.id)]);
    if (!invoice) return err404(res, 'Invoice not found.');
    if (invoice.firm_id !== ctx?.firm_id) return err403(res);

    const entries = await db.all(
      `SELECT te.*, u.display_name AS attorney_name
       FROM time_entries te LEFT JOIN users u ON u.id=te.user_id
       WHERE te.invoice_id=? ORDER BY te.entry_date ASC`,
      [invoice.id]
    );

    const firm = await db.get('SELECT name FROM firms WHERE id=?', [invoice.firm_id]).catch(() => null);

    const pdfBuffer = await generateInvoicePDF(invoice, entries, firm);

    // Mark PDF as generated
    await db.run("UPDATE invoices SET pdf_generated=1 WHERE id=?", [invoice.id]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    logger.error('[time/invoices/pdf]', e.message);
    res.status(500).json({ error: 'Could not generate invoice PDF.' });
  }
});

// ── PDF Generator ─────────────────────────────────────────────────────────────
function generateInvoicePDF(invoice, entries, firm) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc    = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title:   `Invoice ${invoice.invoice_number}`,
        Author:  firm?.name || 'Justice Gavel',
        Subject: `Legal Services Invoice — ${invoice.client_name}`,
      },
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const DARK   = '#0D1B2A';
    const ACCENT = '#1A3A5C';
    const GRAY   = '#6B7280';
    const LIGHT  = '#F3F4F6';
    const PAGE_W = 468; // 612 - 72 - 72

    const fmt$ = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const fmtH = h    => `${h.toFixed(1)} hrs`;

    // ── Header ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(22).fillColor(DARK)
       .text(firm?.name || 'Law Firm', 72, 72);
    doc.font('Helvetica').fontSize(10).fillColor(GRAY)
       .text('Legal Services', { continued: false });
    doc.moveDown(0.2);

    // Invoice label (right-aligned)
    doc.font('Helvetica-Bold').fontSize(26).fillColor(ACCENT)
       .text('INVOICE', 72, 72, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(DARK)
       .text(`# ${invoice.invoice_number}`, { align: 'right' });

    doc.moveDown(1);
    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor(ACCENT).lineWidth(2).stroke();
    doc.moveDown(0.8);

    // ── Bill To / Invoice Details ─────────────────────────────────────────────
    const metaY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('BILL TO', 72, metaY);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
       .text(invoice.client_name, 72, metaY + 14);
    if (invoice.client_email) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(invoice.client_email);
    }

    const detailsX = 350;
    const detailsData = [
      ['Invoice Date:', new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })],
      ['Due Date:',     invoice.due_date
        ? new Date(invoice.due_date + 'T00:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
        : 'Upon Receipt'],
      ['Status:',       (invoice.status || 'draft').toUpperCase()],
    ];
    if (invoice.billing_period_start) {
      detailsData.push(['Period:', `${invoice.billing_period_start} — ${invoice.billing_period_end || '—'}`]);
    }

    let detY = metaY;
    for (const [label, value] of detailsData) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text(label, detailsX, detY, { width: 80 });
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(value, detailsX + 80, detY, { width: 108 });
      detY += 16;
    }

    doc.y = Math.max(doc.y, detY) + 20;
    doc.moveDown(1);

    // ── Time Entries Table ────────────────────────────────────────────────────
    const COL = { date: 72, atty: 145, code: 285, hrs: 340, rate: 385, amt: 455 };

    // Table header
    doc.rect(72, doc.y, PAGE_W, 20).fill(ACCENT);
    const hY = doc.y + 5;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
    doc.text('DATE',         COL.date, hY);
    doc.text('ATTORNEY',     COL.atty, hY);
    doc.text('TASK',         COL.code, hY);
    doc.text('HRS',          COL.hrs,  hY, { width: 40, align: 'right' });
    doc.text('RATE/HR',      COL.rate, hY, { width: 60, align: 'right' });
    doc.text('AMOUNT',       COL.amt,  hY, { width: 60, align: 'right' });
    doc.moveDown(0.3);

    // Table rows
    let rowTotal = 0;
    entries.forEach((e, idx) => {
      const rowH   = 32;
      const rowY   = doc.y;
      const amount = Math.round((e.hours||0) * (e.rate_cents||0));
      rowTotal    += amount;

      if (idx % 2 === 0) {
        doc.rect(72, rowY, PAGE_W, rowH).fill(LIGHT);
      }
      doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
      doc.text(e.entry_date, COL.date, rowY + 4);
      doc.text((e.attorney_name || '').slice(0, 18), COL.atty, rowY + 4);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ACCENT)
         .text(e.task_code || '—', COL.code, rowY + 4);
      doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
      doc.text(fmtH(e.hours||0), COL.hrs, rowY + 4, { width: 40, align: 'right' });
      doc.text(fmt$(e.rate_cents||0), COL.rate, rowY + 4, { width: 60, align: 'right' });
      doc.text(fmt$(amount), COL.amt, rowY + 4, { width: 60, align: 'right' });

      // Narrative (below main row)
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
         .text(e.narrative.slice(0, 110), COL.atty, rowY + 18, { width: PAGE_W - (COL.atty - 72) });

      doc.y = rowY + rowH + 2;
    });

    doc.moveDown(0.5);
    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5);

    // ── Totals block ─────────────────────────────────────────────────────────
    const totX  = 350;
    const totW1 = 120;
    const totW2 = 90;

    const totalHours = entries.reduce((s, e) => s + (e.hours||0), 0);

    [
      ['Total Hours:',   fmtH(totalHours),           false],
      ['Subtotal:',      fmt$(invoice.subtotal_cents), false],
      invoice.tax_rate > 0 ? [`Tax (${invoice.tax_rate}%):`, fmt$(invoice.tax_cents), false] : null,
      ['TOTAL DUE:',     fmt$(invoice.total_cents),   true],
    ].filter(Boolean).forEach(([label, value, bold]) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(bold ? 11 : 9)
         .fillColor(bold ? ACCENT : DARK);
      doc.text(label, totX, y, { width: totW1 });
      doc.text(value, totX + totW1, y, { width: totW2, align: 'right' });
      doc.moveDown(bold ? 0.4 : 0.3);
    });

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (invoice.notes) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('NOTES');
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
         .text(invoice.notes.slice(0, 500), { width: PAGE_W });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.moveDown(2);
    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
       .text('This invoice was generated by Justice Gavel Legal Platform. Questions? Contact your attorney of record.', { align: 'center' });

    doc.end();
  });
}


// ── GET /api/time/matter/:matterId/billing-summary — unified matter economics ──
router.get('/matter/:matterId/billing-summary', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);
    const ctx      = await loadFirmContext(req);

    const [timeRows, invoiceRows, matter] = await Promise.all([
      db.all(
        `SELECT billing_status, SUM(hours) as hours, SUM(hours * rate_cents) as amount
         FROM time_entries WHERE matter_id=? GROUP BY billing_status`,
        [matterId]
      ),
      db.all(
        `SELECT status, SUM(total_cents) as total, COUNT(*) as count
         FROM invoices WHERE matter_id=? GROUP BY status`,
        [matterId]
      ),
      db.get(
        'SELECT id, title, client_name, billing_rate, status FROM matters WHERE id=?',
        [matterId]
      ).catch(() => null),
    ]);

    const byStatus = {};
    for (const r of timeRows) {
      byStatus[r.billing_status] = { hours: Math.round((r.hours||0)*10)/10, amount_cents: r.amount||0 };
    }

    const inv = {};
    let collected = 0, invoiced = 0;
    for (const r of invoiceRows) {
      inv[r.status] = { count: r.count, total_cents: r.total || 0 };
      if (['sent','paid'].includes(r.status)) invoiced  += (r.total || 0);
      if (r.status === 'paid')               collected += (r.total || 0);
    }

    const unbilledHours  = byStatus['unbilled']?.hours || 0;
    const unbilledAmount = byStatus['unbilled']?.amount_cents || 0;
    const billedHours    = byStatus['billed']?.hours || 0;
    const billedAmount   = byStatus['billed']?.amount_cents || 0;
    const totalHours     = Object.values(byStatus).reduce((s,v)=>s+(v.hours||0),0);
    const totalAmount    = Object.values(byStatus).reduce((s,v)=>s+(v.amount_cents||0),0);

    const realizationRate = invoiced > 0 && totalAmount > 0
      ? Math.round(collected / totalAmount * 100)
      : null;

    res.json({
      matter_id:       matterId,
      matter:          matter || null,
      time: {
        total_hours:    Math.round(totalHours * 10) / 10,
        total_amount:   totalAmount,
        unbilled_hours: unbilledHours,
        unbilled_amount: unbilledAmount,
        billed_hours:   billedHours,
        billed_amount:  billedAmount,
        by_status:      byStatus,
      },
      invoices: {
        total_invoiced:  invoiced,
        total_collected: collected,
        outstanding:     invoiced - collected,
        by_status:       inv,
      },
      realization_rate: realizationRate,
      wip_value:        unbilledAmount,
    });
  } catch (e) {
    logger.error('[time/billing-summary]', e.message);
    res.status(500).json({ error: 'Could not load billing summary.' });
  }
});

export default router;
