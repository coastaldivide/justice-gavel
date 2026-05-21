/**
 * routes/docket.js — Docket / Deadline Calculation Engine
 *
 * POST   /api/docket/calculate          — calculate deadlines from a trigger event
 * POST   /api/docket/entries            — create a docket entry manually
 * GET    /api/docket/entries            — list docket entries (filtered)
 * GET    /api/docket/entries/:id        — get single entry
 * PUT    /api/docket/entries/:id        — update entry (mark complete, reschedule)
 * DELETE /api/docket/entries/:id        — delete entry
 * GET    /api/docket/matter/:matterId   — all deadlines for a matter
 * GET    /api/docket/upcoming           — firm upcoming deadlines (next N days)
 * GET    /api/docket/rules              — list calculation rule sets
 *
 * Deadline Rules Implemented:
 *   Federal (FRCP):
 *     - Answer to complaint: 21 days (FRCP 12(a)(1)(A))
 *     - Answer to amended complaint: 14 days (FRCP 15(a)(3))
 *     - Reply to counterclaim: 21 days (FRCP 12(a)(1)(B))
 *     - Motion to dismiss response: 14 days (FRCP 12(a)(4)(A))
 *     - Summary judgment response: 21 days (local rules vary)
 *     - Initial disclosures: 14 days after Rule 26(f) conference (FRCP 26(a)(1))
 *     - Expert disclosures: set by scheduling order (default 90 days)
 *     - Discovery close: set by scheduling order (default 120 days)
 *     - Pretrial disclosures: 30 days before trial (FRCP 26(a)(3))
 *     - Notice of appeal (civil): 30 days (FRAP 4(a)(1)(A))
 *     - Notice of appeal (USA party): 60 days (FRAP 4(a)(1)(B))
 *   State (Criminal):
 *     - Arraignment: 3 business days from arrest
 *     - Preliminary hearing: 14 days (felony) / 10 days (misdemeanor)
 *     - Speedy trial: 70 days (federal Speedy Trial Act)
 *     - Notice of appeal: 30 days (most states)
 *     - Habeas corpus (AEDPA): 365 days from final conviction
 */

import { Router }          from 'express';
import { getDb }           from '../db/index.js';
import { authRequired }    from '../middleware/auth.js';
import { loadFirmContext } from '../middleware/rbac.js';
import { writeAuditLog }   from '../middleware/audit.js';
import { dispatchWebhookEvent } from './webhooks/outbound.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { err400, err404, safeInt,
         sanitizeStr, truncateStr }         from '../utils/routeHelpers.js';
import logger              from '../utils/logger.js';

const router        = Router();
const docketLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Docket limit reached.' });

// ── Shared column list — avoids SELECT * /* intentional */ and keeps projections consistent ────
const DOCKET_COLS = 'id, firm_id, matter_id, matter_table, entry_type, title, description,'
  + ' due_date, due_time, court, rule_citation, calculated_from, days_from_event,'
  + ' status, priority, assigned_to, reminder_days, reminded_at, completed_at,'
  + ' created_by, created_at, updated_at';

// ── Valid entry types, priorities and statuses — module-level for POST and PUT
const VALID_ENTRY_TYPES  = ['deadline','hearing','filing','appointment','reminder','conference','deposition','trial'];
const VALID_ENTRY_PRIO   = ['critical','high','normal','low'];
const VALID_ENTRY_STATUS = ['pending','completed','missed','waived'];

// ── Priority sort expression — maps text values to severity order (critical first) ─
// Alphabetic DESC would sort 'normal' highest; this CASE gives critical=4 > high=3 > normal=2 > low=1
const PRIO_SORT = "CASE de.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC";

// ── Date arithmetic ───────────────────────────────────────────────────────────

/** Add calendar days to a date string (YYYY-MM-DD) */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add business days (skip Saturday/Sunday) */
function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++; // skip Sun(0) and Sat(6)
  }
  return d.toISOString().slice(0, 10);
}

/** Days between two date strings */
function daysBetween(a, b) {
  const dateA = new Date(a + 'T12:00:00Z');
  const dateB = new Date(b + 'T12:00:00Z');
  return Math.ceil((dateB - dateA) / 86400000);
}

/** Is a date in the past? */
function isPast(dateStr) {
  return new Date(dateStr + 'T23:59:59Z') < new Date();
}

// ── Deadline Rule Sets ────────────────────────────────────────────────────────

const RULE_SETS = {
  frcp_complaint_served: {
    label: 'Federal — Complaint Served on Defendant',
    description: 'FRCP deadlines triggered when a defendant is served with a complaint.',
    trigger: 'service_date',
    rules: [
      { id: 'frcp_answer',        title: 'Answer or Motion to Dismiss',         days: 21,  rule: 'FRCP 12(a)(1)(A)',    priority: 'critical', type: 'filing' },
      { id: 'frcp_26f',           title: 'Rule 26(f) Conference',               days: 21,  rule: 'FRCP 26(f)',          priority: 'high',     type: 'hearing' },
      { id: 'frcp_26a1',          title: 'Initial Disclosures',                 days: 35,  rule: 'FRCP 26(a)(1)',       priority: 'critical', type: 'filing' },
      { id: 'frcp_scheduling',    title: 'Scheduling Order Deadline',            days: 90,  rule: 'FRCP 16(b)',          priority: 'high',     type: 'deadline' },
      { id: 'frcp_discovery',     title: 'Discovery Closes (default)',           days: 120, rule: 'FRCP 26 / Local R.',  priority: 'high',     type: 'deadline' },
      { id: 'frcp_expert_init',   title: 'Initial Expert Disclosures',          days: 90,  rule: 'FRCP 26(a)(2)(D)',    priority: 'high',     type: 'filing' },
      { id: 'frcp_expert_rebt',   title: 'Rebuttal Expert Disclosures',         days: 120, rule: 'FRCP 26(a)(2)(D)(ii)',priority: 'high',     type: 'filing' },
      { id: 'frcp_msj',           title: 'Dispositive Motions Deadline',        days: 150, rule: 'Local Rules',         priority: 'high',     type: 'filing' },
      { id: 'frcp_pretrial_disc', title: 'Pretrial Disclosures',                days: 210, rule: 'FRCP 26(a)(3)',       priority: 'critical', type: 'filing' },
    ],
  },

  frcp_judgment_entered: {
    label: 'Federal — Judgment Entered (Civil)',
    description: 'Post-judgment deadlines from date of entry of final judgment.',
    trigger: 'judgment_date',
    rules: [
      { id: 'frcp_jnov',         title: 'Motion for Judgment as Matter of Law', days: 28, rule: 'FRCP 50(b)',          priority: 'critical', type: 'filing' },
      { id: 'frcp_new_trial',    title: 'Motion for New Trial',                 days: 28, rule: 'FRCP 59(b)',          priority: 'critical', type: 'filing' },
      { id: 'frcp_alter_amend',  title: 'Motion to Alter or Amend Judgment',    days: 28, rule: 'FRCP 59(e)',          priority: 'critical', type: 'filing' },
      { id: 'frcp_appeal_civil', title: 'Notice of Appeal (Civil)',             days: 30, rule: 'FRAP 4(a)(1)(A)',     priority: 'critical', type: 'filing' },
      { id: 'frcp_appeal_usa',   title: 'Notice of Appeal (US Gov Party)',      days: 60, rule: 'FRAP 4(a)(1)(B)',     priority: 'critical', type: 'filing' },
      { id: 'frcp_bill_costs',   title: 'Bill of Costs',                        days: 14, rule: 'FRCP 54(d)(1)',       priority: 'normal',   type: 'filing' },
    ],
  },

  criminal_arrest: {
    label: 'Criminal — Arrest / First Appearance',
    description: 'Criminal defense deadlines from date of arrest or initial appearance.',
    trigger: 'arrest_date',
    business_days: true,
    rules: [
      { id: 'crim_arraignment',  title: 'Arraignment',                          days: 3,   rule: 'Fed. R. Crim. P. 10', priority: 'critical', type: 'hearing',  business: true },
      { id: 'crim_bail',         title: 'Bail/Bond Hearing',                    days: 1,   rule: 'Fed. R. Crim. P. 46', priority: 'critical', type: 'hearing',  business: false },
      { id: 'crim_prelim_fel',   title: 'Preliminary Hearing (Felony)',         days: 14,  rule: 'Fed. R. Crim. P. 5.1',priority: 'critical', type: 'hearing',  business: false },
      { id: 'crim_prelim_mis',   title: 'Preliminary Hearing (Misdemeanor)',    days: 10,  rule: 'Fed. R. Crim. P. 5.1',priority: 'high',     type: 'hearing',  business: false },
      { id: 'crim_speedy',       title: 'Speedy Trial Act (Federal)',           days: 70,  rule: '18 U.S.C. § 3161(c)', priority: 'critical', type: 'deadline', business: false },
      { id: 'crim_indictment',   title: 'Indictment Deadline',                  days: 30,  rule: 'Fed. R. Crim. P. 7',  priority: 'critical', type: 'deadline', business: false },
    ],
  },

  criminal_conviction: {
    label: 'Criminal — Conviction / Sentencing',
    description: 'Post-conviction deadlines from date of judgment of conviction.',
    trigger: 'conviction_date',
    rules: [
      { id: 'crim_appeal_fed',   title: 'Notice of Appeal (Criminal)',          days: 14,  rule: 'FRAP 4(b)(1)(A)',     priority: 'critical', type: 'filing' },
      { id: 'crim_appeal_gov',   title: 'Notice of Appeal (Govt)',              days: 30,  rule: 'FRAP 4(b)(1)(B)',     priority: 'critical', type: 'filing' },
      { id: 'crim_2255',         title: 'Motion to Vacate (28 U.S.C. § 2255)',  days: 365, rule: '28 U.S.C. § 2255',   priority: 'critical', type: 'filing' },
      { id: 'crim_aedpa',        title: 'Habeas Corpus (AEDPA)',                days: 365, rule: '28 U.S.C. § 2244(d)',priority: 'critical', type: 'filing' },
    ],
  },

  transactional_loi: {
    label: 'Transactional — Letter of Intent Signed',
    description: 'M&A and deal deadlines from LOI execution date.',
    trigger: 'loi_date',
    rules: [
      { id: 'txn_dd_start',      title: 'Due Diligence Opens',                  days: 1,   rule: 'LOI § Exclusivity',   priority: 'high',     type: 'deadline' },
      { id: 'txn_dd_end',        title: 'Due Diligence Closes (default)',        days: 45,  rule: 'LOI § DD Period',     priority: 'critical', type: 'deadline' },
      { id: 'txn_exclusivity',   title: 'Exclusivity Period Expires',            days: 60,  rule: 'LOI § Exclusivity',   priority: 'critical', type: 'deadline' },
      { id: 'txn_draft_apa',     title: 'Draft APA / Term Sheet Due',            days: 21,  rule: 'Market Practice',     priority: 'high',     type: 'filing' },
      { id: 'txn_hsr',           title: 'HSR Filing (if applicable)',            days: 30,  rule: '15 U.S.C. § 18a',    priority: 'critical', type: 'filing' },
      { id: 'txn_closing',       title: 'Target Closing Date',                   days: 90,  rule: 'LOI § Closing',       priority: 'critical', type: 'deadline' },
    ],
  },
};

// ── GET /api/docket/rules ─────────────────────────────────────────────────────
router.get('/rules', authRequired, (req, res) => {
  const rules = Object.entries(RULE_SETS).map(([key, rs]) => ({
    key,
    label:       rs.label,
    description: rs.description,
    trigger:     rs.trigger,
    rule_count:  rs.rules.length,
  }));
  res.json({ rule_sets: rules });
});

// ── POST /api/docket/calculate — compute deadlines from trigger event ─────────
router.post('/calculate', authRequired, docketLimiter, async (req, res) => {
  try {
    const db = await getDb();

    const {
      rule_set,
      trigger_date,
      matter_id,
      matter_table = 'matters',
      assigned_to,
      save = false,
    } = req.body || {};

    if (!rule_set)      return err400(res, 'rule_set is required (see GET /api/docket/rules).');
    if (!trigger_date)  return err400(res, 'trigger_date (YYYY-MM-DD) is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trigger_date)) return err400(res, 'trigger_date must be YYYY-MM-DD format.');

    const rs = RULE_SETS[rule_set];
    if (!rs) return err400(res, `Unknown rule_set "${rule_set}". GET /api/docket/rules for options.`);

    const ctx = await loadFirmContext(req);

    // Calculate all deadlines
    const today = new Date().toISOString().slice(0, 10);
    const calculated = rs.rules.map(rule => {
      const due = rule.business
        ? addBusinessDays(trigger_date, rule.days)
        : addDays(trigger_date, rule.days);
      return {
        rule_id:        rule.id,
        title:          rule.title,
        due_date:       due,
        days_from_event: rule.days,
        rule_citation:  rule.rule,
        entry_type:     rule.type,
        priority:       rule.priority,
        is_past:        isPast(due),
        days_from_today: daysBetween(today, due),
        business_days:  !!rule.business,
      };
    }).sort((a, b) => a.due_date.localeCompare(b.due_date));

    // Save to docket if requested
    let savedIds = [];
    if (save && matter_id) {
      const assignTo = assigned_to ? safeInt(assigned_to) : req.user.id;
      for (const d of calculated) {
        if (d.is_past) continue; // don't save past deadlines
        const r = await db.run(
          `INSERT INTO docket_entries
            (firm_id, matter_id, matter_table, entry_type, title, due_date,
             rule_citation, calculated_from, days_from_event, status, priority,
             assigned_to, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ctx?.firm_id ?? null,
            safeInt(matter_id), sanitizeStr(matter_table, 20),
            d.entry_type, d.title, d.due_date,
            d.rule_citation, trigger_date, d.days_from_event,
            'pending', d.priority, assignTo, req.user.id,
          ]
        );
        savedIds.push(r.lastID);
        dispatchWebhookEvent(db, ctx?.firm_id, 'docket.deadline_created', {
          entry_id: r.lastID, title: d.title, due_date: d.due_date, priority: d.priority,
        }).catch(() => {});
      }

      await writeAuditLog(db, {
        user_id:  req.user.id,
        firm_id:  ctx?.firm_id,
        action:   'docket_calculate',
        resource: 'docket',
        target_id: safeInt(matter_id),
        detail:   JSON.stringify({ rule_set, trigger_date, count: savedIds.length }),
        ip:       req.ip,
        ua:       req.headers['user-agent'],
      });
    }

    res.json({
      rule_set,
      rule_set_label: rs.label,
      trigger_date,
      deadlines: calculated,
      total:     calculated.length,
      past:      calculated.filter(d => d.is_past).length,
      upcoming:  calculated.filter(d => !d.is_past).length,
      saved:     savedIds.length,
      saved_ids: savedIds,
    });
  } catch (e) {
    logger.error('[docket/calculate]', e.message);
    res.status(500).json({ error: 'Could not calculate deadlines.' });
  }
});

// ── POST /api/docket/entries — create manual entry ────────────────────────────
router.post('/entries', authRequired, docketLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id, matter_table = 'matters',
      entry_type = 'deadline', title, description,
      due_date, due_time, court, rule_citation,
      priority = 'normal', assigned_to,
      reminder_days = 3,
    } = req.body || {};

    if (!title?.trim())  return err400(res, 'title is required.');
    if (!due_date)       return err400(res, 'due_date (YYYY-MM-DD) is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return err400(res, 'due_date must be YYYY-MM-DD format.');
    if (!VALID_ENTRY_TYPES.includes(entry_type))
      return err400(res, `Invalid entry_type '${entry_type}'. Valid: ${VALID_ENTRY_TYPES.join(', ')}.`);
    if (!VALID_ENTRY_PRIO.includes(priority))
      return err400(res, `Invalid priority '${priority}'. Valid: ${VALID_ENTRY_PRIO.join(', ')}.`);

    const r = await db.run(
      `INSERT INTO docket_entries
        (firm_id, matter_id, matter_table, entry_type, title, description,
         due_date, due_time, court, rule_citation, status, priority,
         assigned_to, reminder_days, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ctx?.firm_id ?? null,
        matter_id ? safeInt(matter_id) : null,
        sanitizeStr(matter_table, 20),
        entry_type,
        truncateStr(sanitizeStr(title, 300), 300),
        description ? truncateStr(sanitizeStr(description, 2000), 2000) : null,
        sanitizeStr(due_date, 20),
        due_time ? sanitizeStr(due_time, 10) : null,
        court ? truncateStr(sanitizeStr(court, 200), 200) : null,
        rule_citation ? sanitizeStr(rule_citation, 100) : null,
        'pending',
        priority,
        assigned_to ? safeInt(assigned_to) : req.user.id,
        Math.min(safeInt(reminder_days, 3), 90),
        req.user.id,
      ]
    );

    const entry = await db.get(`SELECT ${DOCKET_COLS} FROM docket_entries WHERE id=?`, [r.lastID]);
    if (!entry) {
      logger.error('[docket/entries/create] INSERT succeeded but read-back returned null for id:', r.lastID);
      return res.status(500).json({ error: 'Could not create docket entry.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    res.json({ ...entry, days_until_due: daysBetween(today, entry.due_date) });
  } catch (e) {
    logger.error('[docket/entries/create]', e.message);
    res.status(500).json({ error: 'Could not create docket entry.' });
  }
});

// ── GET /api/docket/entries — list entries ────────────────────────────────────
router.get('/entries', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id, status, priority, entry_type,
      assigned_to, date_from, date_to,
      limit = 50, offset = 0,
    } = req.query;

    let sql    = `SELECT de.*, u.display_name AS assigned_to_name
                  FROM docket_entries de
                  LEFT JOIN users u ON u.id = de.assigned_to
                  WHERE 1=1`;
    const params = [];

    if (ctx?.firm_id) { sql += ' AND de.firm_id=?'; params.push(ctx.firm_id); }
    else              { sql += ' AND de.assigned_to=?'; params.push(req.user.id); }

    if (matter_id)  { sql += ' AND de.matter_id=?';    params.push(safeInt(matter_id)); }
    if (status)     {
      if (!VALID_ENTRY_STATUS.includes(status)) return err400(res, `Invalid status '${status}'. Valid: ${VALID_ENTRY_STATUS.join(', ')}.`);
      sql += ' AND de.status=?'; params.push(status);
    }
    if (priority)   {
      if (!VALID_ENTRY_PRIO.includes(priority)) return err400(res, `Invalid priority '${priority}'. Valid: ${VALID_ENTRY_PRIO.join(', ')}.`);
      sql += ' AND de.priority=?'; params.push(priority);
    }
    if (entry_type) {
      if (!VALID_ENTRY_TYPES.includes(entry_type)) return err400(res, `Invalid entry_type '${entry_type}'. Valid: ${VALID_ENTRY_TYPES.join(', ')}.`);
      sql += ' AND de.entry_type=?'; params.push(entry_type);
    }
    if (assigned_to){ sql += ' AND de.assigned_to=?';   params.push(safeInt(assigned_to)); }
    if (date_from)  {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from)) return err400(res, 'date_from must be YYYY-MM-DD format.');
      sql += ' AND de.due_date>=?'; params.push(date_from);
    }
    if (date_to)    {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date_to)) return err400(res, 'date_to must be YYYY-MM-DD format.');
      sql += ' AND de.due_date<=?'; params.push(date_to);
    }

    sql += ` ORDER BY de.due_date ASC, ${PRIO_SORT} LIMIT ? OFFSET ?`;
    params.push(Math.min(safeInt(limit,50),100), safeInt(offset,0));

    const rows = await db.all(sql, params);
    const today = new Date().toISOString().slice(0,10);
    const entries = rows.map(e => ({
      ...e,
      days_until_due: daysBetween(today, e.due_date),
      overdue: e.status === 'pending' && e.due_date < today,
    }));

    res.json({ entries, count: entries.length });
  } catch (e) {
    logger.error('[docket/entries/list]', e.message);
    res.status(500).json({ error: 'Could not load docket entries.' });
  }
});

// ── GET /api/docket/entries/:id
router.get('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get(`SELECT ${DOCKET_COLS} FROM docket_entries WHERE id=?`, [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Docket entry not found.');
    // Ownership guard: must belong to caller's firm or be assigned to caller
    const getCtx = await loadFirmContext(req);
    if (entry.firm_id && getCtx?.firm_id !== entry.firm_id)
      return res.status(403).json({ error: 'Access denied.' });
    if (!entry.firm_id && entry.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Access denied.' });
    const today = new Date().toISOString().slice(0,10);
    res.json({ ...entry, days_until_due: daysBetween(today, entry.due_date) });
  } catch (e) {
    logger.error('[docket/entries/get]', e.message);
    res.status(500).json({ error: 'Could not load docket entry.' });
  }
});

// ── PUT /api/docket/entries/:id — update entry
router.put('/entries/:id', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const entryId = safeInt(req.params.id);
    const entry   = await db.get(`SELECT ${DOCKET_COLS} FROM docket_entries WHERE id=?`, [entryId]);
    if (!entry) return err404(res, 'Docket entry not found.');
    // Ownership guard: entry must belong to this user or their firm
    const putCtx = await loadFirmContext(req);
    if (entry.firm_id && putCtx?.firm_id !== entry.firm_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (!entry.firm_id && entry.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const allowed = ['title','description','due_date','due_time','court','rule_citation','status','priority','assigned_to','reminder_days'];
    const updates = [];
    const params  = [];

    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      // Sanitize each allowed field to its correct type / length
      if (key === 'title')        val = truncateStr(sanitizeStr(String(val), 300), 300);
      if (key === 'description')  val = val ? truncateStr(sanitizeStr(String(val), 2000), 2000) : null;
      if (key === 'court')        val = val ? truncateStr(sanitizeStr(String(val), 200), 200) : null;
      if (key === 'rule_citation') val = val ? sanitizeStr(String(val), 100) : null;
      if (key === 'due_time')     val = val ? sanitizeStr(String(val), 10) : null;
      if (key === 'due_date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(val)))
        return err400(res, 'due_date must be YYYY-MM-DD format.');
      if (key === 'priority' && !VALID_ENTRY_PRIO.includes(val))
        return err400(res, `Invalid priority '${val}'. Valid: ${VALID_ENTRY_PRIO.join(', ')}.`);
      if (key === 'assigned_to')  val = safeInt(val);
      if (key === 'reminder_days') val = Math.min(safeInt(val, 3), 90);
      if (key === 'status' && !VALID_ENTRY_STATUS.includes(val))
        return err400(res, `Invalid status '${val}'. Valid: ${VALID_ENTRY_STATUS.join(', ')}.`);
      if (key === 'status' && val === 'completed') {
        // Guard both completed_at and webhook — only act on first transition
        if (entry.status !== 'completed') {
          updates.push('completed_at=?'); params.push(new Date().toISOString());
          dispatchWebhookEvent(db, entry.firm_id, 'docket.deadline_completed', {
            entry_id: entryId,
            title:    entry.title,
            due_date: entry.due_date,
          }).catch(() => {});
        }
      }
      updates.push(`${key}=?`); params.push(val);
    }
    if (!updates.length) return err400(res, 'Nothing to update.');
    updates.push('updated_at=?');
    params.push(new Date().toISOString()); // ISO string works on both SQLite and Postgres
    params.push(entryId);
    await db.run(`UPDATE docket_entries SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get(`SELECT ${DOCKET_COLS} FROM docket_entries WHERE id=?`, [entryId]);
    if (!updated) {
      logger.error('[docket/entries/update] UPDATE succeeded but read-back returned null for id:', entryId);
      return res.status(500).json({ error: 'Could not load updated docket entry.' });
    }

    // If due_date changed and the entry has a calendar event, re-push it
    if (req.body.due_date && req.body.due_date !== entry.due_date && entry.firm_id) {
      // Fire-and-forget: mark calendar event for re-sync (db already in scope)
      Promise.resolve().then(async () => {
        try {
          const cpe = await db.get(
            "SELECT cpe.*, ic.* FROM calendar_push_events cpe JOIN integration_connections ic ON ic.id=cpe.connection_id WHERE cpe.docket_entry_id=? AND cpe.sync_status='synced' LIMIT 1",
            [entryId]
          ).catch(() => null);
          if (cpe) {
            await db.run(
              "UPDATE calendar_push_events SET sync_status='pending' WHERE docket_entry_id=?",
              [entryId]
            );
          }
        } catch (e) { logger.warn('[docket/calendar-resync]', e?.message); }
      }).catch(() => {});
    }

    res.json(updated);
  } catch (e) {
    logger.error('[docket/entries/update]', e.message);
    res.status(500).json({ error: 'Could not update docket entry.' });
  }
});

// ── DELETE /api/docket/entries/:id
router.delete('/entries/:id', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const entryId = safeInt(req.params.id);
    const entry   = await db.get('SELECT id, firm_id, assigned_to FROM docket_entries WHERE id=?', [entryId]);
    if (!entry) return err404(res, 'Docket entry not found.');
    // Ownership guard: entry must belong to this user or their firm
    const delCtx = await loadFirmContext(req);
    if (entry.firm_id && delCtx?.firm_id !== entry.firm_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (!entry.firm_id && entry.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    await db.run('DELETE FROM docket_entries WHERE id=?', [entryId]);
    res.json({ deleted: true });
  } catch (e) {
    logger.error('[docket/entries/delete]', e.message);
    res.status(500).json({ error: 'Could not delete docket entry.' });
  }
});

// ── GET /api/docket/matter/:matterId — all deadlines for a matter
router.get('/matter/:matterId', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);
    const today    = new Date().toISOString().slice(0,10);

    // Ownership guard: restrict to caller's firm or entries assigned to caller
    const matterCtx = await loadFirmContext(req);

    const entries = await db.all(
      `SELECT de.*, u.display_name AS assigned_to_name
       FROM docket_entries de
       LEFT JOIN users u ON u.id = de.assigned_to
       WHERE de.matter_id=?
         AND (de.firm_id IS NULL OR de.firm_id=?)
       ORDER BY de.due_date ASC`,
      [matterId, matterCtx?.firm_id ?? null]
    );

    const enriched = entries.map(e => ({
      ...e,
      days_until_due: daysBetween(today, e.due_date),
      overdue: e.status === 'pending' && e.due_date < today,
    }));

    const summary = {
      total:     entries.length,
      pending:   enriched.filter(e => e.status === 'pending').length,
      overdue:   enriched.filter(e => e.overdue).length,
      critical:  enriched.filter(e => e.priority === 'critical' && e.status === 'pending').length,
      completed: enriched.filter(e => e.status === 'completed').length,
    };

    res.json({ matter_id: matterId, entries: enriched, summary });
  } catch (e) {
    logger.error('[docket/matter]', e.message);
    res.status(500).json({ error: 'Could not load matter docket.' });
  }
});

// ── GET /api/docket/upcoming — firm upcoming deadlines
router.get('/upcoming', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const ctx  = await loadFirmContext(req);
    const days = Math.min(safeInt(req.query.days || '30'), 365);
    const today = new Date().toISOString().slice(0,10);
    const until = addDays(today, days);

    let sql = `SELECT de.*, u.display_name AS assigned_to_name
               FROM docket_entries de
               LEFT JOIN users u ON u.id = de.assigned_to
               WHERE de.status='pending'
                 AND de.due_date >= ?
                 AND de.due_date <= ?`;
    const params = [today, until];

    if (ctx?.firm_id) { sql += ' AND de.firm_id=?'; params.push(ctx.firm_id); }
    else              { sql += ' AND de.assigned_to=?'; params.push(req.user.id); }

    sql += ` ORDER BY de.due_date ASC, ${PRIO_SORT} LIMIT 100`;

    const rows = await db.all(sql, params);
    const entries = rows.map(e => ({
      ...e,
      days_until_due: daysBetween(today, e.due_date),
    }));

    // Group by urgency tier
    const tiers = {
      today:     entries.filter(e => e.days_until_due === 0),
      this_week: entries.filter(e => e.days_until_due > 0 && e.days_until_due <= 7),
      next_week: entries.filter(e => e.days_until_due > 7 && e.days_until_due <= 14),
      this_month: entries.filter(e => e.days_until_due > 14 && e.days_until_due <= 30),
      later:     entries.filter(e => e.days_until_due > 30),
    };

    // Also get overdue
    const overdue = await db.all(
      `SELECT de.*, u.display_name AS assigned_to_name FROM docket_entries de
       LEFT JOIN users u ON u.id=de.assigned_to
       WHERE de.status='pending' AND de.due_date < ?${ctx?.firm_id ? ' AND de.firm_id=?' : ' AND de.assigned_to=?'}
       ORDER BY de.due_date ASC LIMIT 20`,
      ctx?.firm_id ? [today, ctx.firm_id] : [today, req.user.id]
    );

    res.json({
      window_days: days,
      entries,
      tiers,
      overdue: overdue.map(e => ({ ...e, days_overdue: Math.abs(daysBetween(e.due_date, today)) })),
      counts: {
        upcoming: entries.length,
        overdue:  overdue.length,
        critical: entries.filter(e => e.priority === 'critical').length,
      },
    });
  } catch (e) {
    logger.error('[docket/upcoming]', e.message);
    res.status(500).json({ error: 'Could not load upcoming deadlines.' });
  }
});

export default router;
