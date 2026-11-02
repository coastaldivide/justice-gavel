/**
 * services/caseSteps.js — "Your case, step by step: from arrest to clearing your record"
 * (migration 43, docs/COURT_GUIDE.md).
 *
 * The words, sources and buttons of each stage live in the app (frontend/src/constants/
 * caseSteps.ts + i18n, so they work offline and for guests). The server keeps only what the
 * person saved for one of their cases:
 *
 *   stage        the stage THEY say the case is in (null until they pick one — nothing here
 *                ever guesses a case's status)
 *   checked      the checklist items they ticked: { "<item id>": true }
 *   share_stage  family members who already follow the case (case_family_access, the owner's
 *                consent) may see the stage name — never the checklist
 *
 * Two items are ticked from the case's own court dates (`auto`), not by the person:
 *   first.date_saved    the case has a court date saved
 *   pretrial.next_date  the case has an upcoming court date still scheduled
 *
 * STAGES must match frontend/src/constants/caseStepsCatalog.json (a test checks it).
 */
import { resolveReminderTimeZone } from './courtReminders.js';
import { todayInZone } from '../utils/timezone.js';

export const STAGES = Object.freeze([
  { id: 'arrest',    items: ['silent', 'family', 'no_talk', 'papers'] },
  { id: 'release',   items: ['bail_known', 'conditions_copy', 'conditions_understood', 'agent_saved'] },
  { id: 'first',     items: ['date_saved', 'plan', 'ask_lawyer', 'next_date'] },
  { id: 'lawyer',    items: ['have', 'saved', 'contact', 'money_papers'] },
  { id: 'pretrial',  items: ['next_date', 'calls', 'conditions', 'papers', 'checkins'] },
  { id: 'plea',      items: ['explained', 'questions', 'trial_date', 'guide'] },
  { id: 'sentence',  items: ['date', 'copy', 'list', 'ask'] },
  { id: 'probation', items: ['officer', 'owe', 'proof', 'checkins'] },
  { id: 'record',    items: ['finished', 'checked', 'papers', 'help'] },
]);
export const STAGE_IDS = Object.freeze(STAGES.map(s => s.id));
export const ITEM_IDS = Object.freeze(STAGES.flatMap(s => s.items.map(i => `${s.id}.${i}`)));
/** Items the case's court dates tick (the person cannot tick or untick them). */
export const AUTO_ITEMS = Object.freeze(['first.date_saved', 'pretrial.next_date']);

export class StepsError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/**
 * Body { stage?, checked?, share_stage? } → a clean patch, or throws StepsError(400).
 *   stage        one of STAGE_IDS, or null (no stage chosen)
 *   checked      { "<item id>": boolean } — only known, non-automatic items
 *   share_stage  boolean
 */
export function normalizeSteps(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StepsError(400, 'bad_steps');
  const out = {};
  if (body.stage !== undefined) {
    if (body.stage !== null && !STAGE_IDS.includes(body.stage)) throw new StepsError(400, 'bad_stage');
    out.stage = body.stage;
  }
  if (body.checked !== undefined) {
    const c = body.checked;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new StepsError(400, 'bad_steps');
    const keys = Object.keys(c);
    if (keys.length > ITEM_IDS.length) throw new StepsError(400, 'bad_steps');
    out.checked = {};
    for (const k of keys) {
      if (!ITEM_IDS.includes(k) || AUTO_ITEMS.includes(k)) throw new StepsError(400, 'bad_item');
      if (typeof c[k] !== 'boolean') throw new StepsError(400, 'bad_steps');
      out.checked[k] = c[k];
    }
  }
  if (body.share_stage !== undefined) {
    if (typeof body.share_stage !== 'boolean') throw new StepsError(400, 'bad_steps');
    out.share_stage = body.share_stage;
  }
  if (!Object.keys(out).length) throw new StepsError(400, 'bad_steps');
  return out;
}

/** Only known, non-automatic items that are ticked: { "<item id>": true }. */
export function cleanChecked(checked) {
  const c = checked && typeof checked === 'object' && !Array.isArray(checked) ? checked : {};
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => v === true && ITEM_IDS.includes(k) && !AUTO_ITEMS.includes(k)).map(([k]) => [k, true]));
}

/** The owner's case (or null): { id, title, state, user_id }. */
export async function ownedCase(db, userId, caseId) {
  return await db.get('SELECT id, title, state, user_id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [caseId, userId]);
}

/** Items ticked by the case's court dates. */
export async function autoItems(db, userId, c) {
  const { tz } = await resolveReminderTimeZone(db, userId, c.state);
  const today = todayInZone(tz);
  const r = await db.get(
    `SELECT COUNT(*) AS n,
            COUNT(*) FILTER (WHERE status = 'scheduled' AND court_date >= CAST(? AS date)) AS upcoming,
            MIN(court_date) FILTER (WHERE status = 'scheduled' AND court_date >= CAST(? AS date)) AS next_date
       FROM court_dates WHERE case_id = ? AND deleted_at IS NULL`, [today, today, c.id]);
  const out = {};
  if (Number(r?.n || 0) > 0) out['first.date_saved'] = true;
  if (Number(r?.upcoming || 0) > 0) out['pretrial.next_date'] = true;
  const next = r?.next_date ? (r.next_date instanceof Date ? r.next_date.toISOString().slice(0, 10) : String(r.next_date).slice(0, 10)) : null;
  return { auto: out, next_court_date: next };
}

function view(c, row, auto) {
  return {
    case_id: Number(c.id), case_title: c.title, state: c.state || null,
    stage: row?.stage || null,
    checked: cleanChecked(row?.checked),
    auto: auto.auto, next_court_date: auto.next_court_date,
    share_stage: row?.share_stage === true,
    updated_at: row?.updated_at || null,
  };
}

/** The saved progress of one of the owner's cases (stage null and nothing ticked when never saved). */
export async function getSteps(db, userId, caseId) {
  const c = await ownedCase(db, userId, caseId);
  if (!c) throw new StepsError(404, 'not_found');
  const row = await db.get('SELECT stage, checked, share_stage, updated_at FROM case_steps WHERE case_id = ? AND user_id = ?', [c.id, userId]);
  return view(c, row, await autoItems(db, userId, c));
}

/** Save a patch (normalizeSteps) for one of the owner's cases; ticked items are merged. */
export async function saveSteps(db, userId, caseId, body) {
  const patch = normalizeSteps(body);
  const c = await ownedCase(db, userId, caseId);
  if (!c) throw new StepsError(404, 'not_found');
  const cur = await db.get('SELECT stage, checked, share_stage FROM case_steps WHERE case_id = ? AND user_id = ?', [c.id, userId]);
  const checked = cleanChecked(cur?.checked);
  for (const [k, v] of Object.entries(patch.checked || {})) { if (v) checked[k] = true; else delete checked[k]; }
  const stage = patch.stage !== undefined ? patch.stage : (cur?.stage || null);
  const share = patch.share_stage !== undefined ? patch.share_stage : cur?.share_stage === true;
  const row = await db.get(
    `INSERT INTO case_steps (case_id, user_id, stage, checked, share_stage, updated_at)
     VALUES (?, ?, ?, CAST(? AS jsonb), ?, NOW())
     ON CONFLICT (case_id) DO UPDATE SET stage = EXCLUDED.stage, checked = EXCLUDED.checked,
       share_stage = EXCLUDED.share_stage, updated_at = NOW()
       WHERE case_steps.user_id = EXCLUDED.user_id
     RETURNING stage, checked, share_stage, updated_at`,
    [c.id, userId, stage, JSON.stringify(checked), share]);
  if (!row) throw new StepsError(404, 'not_found');
  return view(c, row, await autoItems(db, userId, c));
}
