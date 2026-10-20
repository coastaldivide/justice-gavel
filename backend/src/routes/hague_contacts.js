/**
 * hague_contacts.js — Hague Abduction Convention (1980) contacts + case intake
 *
 * The country list, the Central Authorities and the U.S. resources come from
 * hague_central_authorities / hague_resources (migration 26). Every answer
 * carries each row's source, when it was recorded and when it was last checked
 * (null = never re-checked). Nothing here has been reviewed by a lawyer.
 *
 *   GET  /member-states                  public — stored countries (code, authority, contracting, source)
 *   GET  /central-authority/:countryCode public — one country's authority (404 when not stored)
 *   GET  /us-resources                   public — U.S. Central Authority + NCMEC / FBI / INTERPOL
 *   POST /report-intake                  signed in — pre-application record on the person's own case
 *   GET  /intake/:caseId                 signed in — that record (own case only)
 *
 * Justice Gavel does not file anything: the application goes to the U.S.
 * Central Authority (by the parent or their lawyer).
 */
import { Router }         from 'express';
import { getDb }          from '../db/index.js';
import { authRequired }   from '../middleware/auth.js';
import { apiLimiter }     from '../middleware/rateLimiters.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { msg, resolveLang } from '../i18n/index.js';
import { parseDateOnly }  from '../utils/timezone.js';
import logger             from '../utils/logger.js';

const router = Router();
const intakeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: (req) => msg(resolveLang(req), 'hague.err.rate_limited') });

const HCCH_LIST = 'https://www.hcch.net/en/states/authorities';
const AUTH_COLS = `country_code, country_name, authority_name, website, phone, emergency_phone, email, hours_note,
  contracting, source, source_url, recorded_at, last_verified_at`;

const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const sourceOf = (r) => ({ label: r.source, url: r.source_url || null, recorded_at: day(r.recorded_at), last_verified_at: day(r.last_verified_at), reviewed: false });

function authorityOut(r, lang) {
  return {
    country_code: r.country_code,
    country_name: r.country_name,
    found: true,
    contracting_state: !!r.contracting,
    note: msg(lang, r.contracting ? 'hague.note.contracting' : 'hague.note.non_contracting'),
    central_authority: {
      name: r.authority_name,
      website: r.website || null,
      phone: r.phone || null,
      emergency_phone: r.emergency_phone || null,
      email: r.email || null,
    },
    source: sourceOf(r),
  };
}

const fail = (res, lang, status, key, code) => res.status(status).json({ error: msg(lang, key), code, message: msg(lang, key) });

// ── GET /member-states ───────────────────────────────────────────────────────
router.get('/member-states', apiLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const rows = await db.all(`SELECT ${AUTH_COLS} FROM hague_central_authorities WHERE country_code <> 'US' ORDER BY country_name`);
    res.setHeader('Vary', 'Accept-Language');
    res.json({
      member_states: rows.map(r => ({
        code: r.country_code, name: r.country_name, authority: r.authority_name, website: r.website || null,
        contracting: !!r.contracting, source: sourceOf(r),
      })),
      total: rows.length,
      partial: true,
      note: msg(lang, 'hague.note.partial'),
      hcch_full_list: HCCH_LIST,
    });
  } catch (e) {
    logger.error('[hague] member-states', e.message);
    return fail(res, lang, 500, 'hague.err.server', 'server_error');
  }
});

// ── GET /central-authority/:countryCode ──────────────────────────────────────
router.get('/central-authority/:countryCode', apiLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const code = String(req.params.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return fail(res, lang, 400, 'hague.err.bad_country', 'invalid_country');
  try {
    const db = await getDb();
    const row = await db.get(`SELECT ${AUTH_COLS} FROM hague_central_authorities WHERE country_code = ?`, [code]);
    if (!row) {
      return res.status(404).json({ error: msg(lang, 'hague.err.not_stored'), code: 'not_stored', message: msg(lang, 'hague.err.not_stored'),
        country_code: code, found: false, hcch_full_list: HCCH_LIST });
    }
    res.setHeader('Vary', 'Accept-Language');
    return res.json(authorityOut(row, lang));
  } catch (e) {
    logger.error('[hague] central-authority', e.message);
    return fail(res, lang, 500, 'hague.err.server', 'server_error');
  }
});

// ── GET /us-resources ────────────────────────────────────────────────────────
router.get('/us-resources', apiLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const us = await db.get(`SELECT ${AUTH_COLS} FROM hague_central_authorities WHERE country_code = 'US'`);
    const resources = await db.all(
      `SELECT key, name, phone, website, statute, source, source_url, recorded_at, last_verified_at
         FROM hague_resources ORDER BY sort_order, key`);
    res.setHeader('Vary', 'Accept-Language');
    res.json({
      central_authority: us ? authorityOut(us, lang) : null,
      resources: resources.map(r => ({ key: r.key, name: r.name, phone: r.phone || null, website: r.website || null,
        statute: r.statute || null, source: sourceOf(r) })),
      legal_note: msg(lang, 'hague.note.legal'),
      hcch_full_list: HCCH_LIST,
    });
  } catch (e) {
    logger.error('[hague] us-resources', e.message);
    return fail(res, lang, 500, 'hague.err.server', 'server_error');
  }
});

// ── POST /report-intake ──────────────────────────────────────────────────────
router.post('/report-intake', authRequired, intakeLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const caseId = Number(b.caseId);
  if (!Number.isSafeInteger(caseId) || caseId <= 0) return fail(res, lang, 400, 'hague.err.case_required', 'case_required');
  const code = typeof b.countryCode === 'string' ? b.countryCode.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code) || code === 'US') return fail(res, lang, 400, 'hague.err.bad_country', 'invalid_country');
  const childName = typeof b.childName === 'string' ? b.childName.trim() : '';
  if (!childName || childName.length > 100) return fail(res, lang, 400, 'hague.err.child_name', 'child_name_required');
  let childAge = null;
  if (b.childAge != null && b.childAge !== '') {
    childAge = Number(b.childAge);
    if (!Number.isInteger(childAge) || childAge < 0 || childAge > 17) return fail(res, lang, 400, 'hague.err.child_age', 'invalid_child_age');
  }
  const dateStr = typeof b.abductionDate === 'string' ? b.abductionDate.trim() : '';
  const d = parseDateOnly(dateStr);
  if (!d || dateStr.length !== 10 || Date.UTC(d.y, d.m - 1, d.d) > Date.now() + 86400000) {
    return fail(res, lang, 400, 'hague.err.date', 'invalid_date');
  }
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '';

  try {
    const db = await getDb();
    const cas = await db.get('SELECT id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [caseId, req.user.id]);
    if (!cas) return fail(res, lang, 404, 'hague.err.case_not_found', 'case_not_found');
    const country = await db.get(`SELECT ${AUTH_COLS} FROM hague_central_authorities WHERE country_code = ?`, [code]);
    if (!country) return fail(res, lang, 400, 'hague.err.not_stored', 'not_stored');
    const us = await db.get(`SELECT ${AUTH_COLS} FROM hague_central_authorities WHERE country_code = 'US'`);

    const vals = [code, country.country_name, childName, childAge, dateStr, notes];
    const upd = await db.run(
      `UPDATE hague_intakes SET country_code = ?, country = ?, child_name = ?, child_age = ?, abduction_date = ?, notes = ?
        WHERE case_id = ? AND user_id = ?`, [...vals, String(caseId), req.user.id]);
    if (!upd.changes) {
      await db.run(
        `INSERT INTO hague_intakes (country_code, country, child_name, child_age, abduction_date, notes, case_id, user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,NOW())`, [...vals, String(caseId), req.user.id]);
    }

    const oci = us?.emergency_phone || us?.phone || '';
    const steps = country.contracting
      ? [1, 2, 3, 4, 5].map(n => msg(lang, `hague.steps.contracting.${n}`, { phone: oci }))
      : [1, 2, 3, 4].map(n => msg(lang, `hague.steps.non_contracting.${n}`, { phone: '1-800-843-5678' }));
    return res.json({
      success: true,
      intake_recorded: true,
      contracting_state: !!country.contracting,
      next_steps: steps,
      next_steps_reviewed: false,
      authority: authorityOut(country, lang),
      legal_notice: msg(lang, 'hague.note.intake'),
    });
  } catch (e) {
    logger.error('[hague] report-intake', e.message);
    return fail(res, lang, 500, 'hague.err.server', 'server_error');
  }
});

// ── GET /intake/:caseId ──────────────────────────────────────────────────────
router.get('/intake/:caseId', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  const caseId = Number(req.params.caseId);
  if (!Number.isSafeInteger(caseId) || caseId <= 0) return fail(res, lang, 404, 'hague.err.no_intake', 'not_found');
  try {
    const db = await getDb();
    const intake = await db.get(
      `SELECT h.id, h.case_id, h.country_code, h.country, h.child_name, h.child_age, h.abduction_date, h.notes, h.status, h.created_at
         FROM hague_intakes h JOIN cases c ON c.id::text = h.case_id AND c.user_id = h.user_id AND c.deleted_at IS NULL
        WHERE h.case_id = ? AND h.user_id = ?`, [String(caseId), req.user.id]);
    if (!intake) return fail(res, lang, 404, 'hague.err.no_intake', 'not_found');
    return res.json({ intake });
  } catch (e) {
    logger.error('[hague] intake-get', e.message);
    return fail(res, lang, 500, 'hague.err.server', 'server_error');
  }
});

export default router;
