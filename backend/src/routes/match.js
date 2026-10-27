import { anthropicFetch } from '../services/aiClient.js';
import { safeJson, safeInt, sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { CLAUDE_MODEL } from '../utils/ai.js';
/**
 * /api/match — Two-stage Claude-powered lawyer matching
 * General guidance only, not legal advice.
 *
 * GET /api/match/lawyers
 *   Query params:
 *     lat, lng    {number}  the person's location (nearest first), or
 *     city        {string}  a place typed by the person (same search as the lawyer list)
 *     caseType    {string}  e.g. "DUI", "Family Law" — filters always narrow
 *     language    {string}  e.g. "Spanish"
 *     proBonoOnly {boolean}
 *     situation   {string}  free-text situation (used only for the AI narrative)
 *
 *   Returns { jobId, status: 'pending' } — poll GET /api/jobs/:jobId; the job
 *   result is [{ ...listing (same fields as /providers/lawyers), rank,
 *   matchScore, matchReport }] (report in the request's language).
 *   No listing matches → { status: 'done', matches: [], message }.
 */

import { Router }      from 'express';
import { searchDirectory, formatLawyer as formatListing } from '../services/providerDirectory.js';
import { resolveLang, msg, LANG_NAMES } from '../i18n/index.js';
import { generateSlots, lawyerTimeZone, PENDING_HOLD_MINUTES } from '../services/consultationSlots.js';
import { enqueueAIJob as enqueue }     from '../services/aiQueue.js';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { directoryRows } from '../services/directoryCache.js';


// ── Shared column list for providers DB — keeps projections consistent ──────
const LAWYERS_COLS = `l.id, l.name, l.firm, l.phone, l.website, l.address, l.lat, l.lng, l.city, l.state, l.rating,
  l.reviews, l.verified, l.bar_verified, l.jtb_verified, l.pro_bono, l.sliding_scale, l.free_consultation,
  l.years_experience, l.specialties, l.languages, l.bio, l.source_id, l.availability, l.hours, l.source,
  (l.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id)) AS on_app`;


const router = Router();

// Provider data (lawyers / bail_agents) lives in the main Postgres database.
async function openProvidersDb() {
  return await getDb();
}

// ── stage 1: directory search + numeric scoring ──────────────────────────────
// Candidates come from the same directory search as the lawyer list (nearest
// first from the person's location, or the city they typed), with the same
// strict filters. The score uses quality and accessibility signals only —
// never payment / subscription / badge flags (owner rule).

function scoreLawyer(l, { language, userState }) {
  let score = 0;
  score += (Number(l.rating) || 0) * 20;                       // 0–100: rating anchor
  score += Math.min(Number(l.reviews) || 0, 100) * 0.3;        // 0–30:  credibility volume
  score += Math.min(Number(l.years_experience) || 0, 20) * 0.5;
  score += Number(l.free_consultation) === 1 ? 15 : 0;
  score += Number(l.pro_bono) === 1 ? 18 : 0;
  score += Number(l.sliding_scale) === 1 ? 10 : 0;
  score += Number(l.bar_verified) === 1 ? 20 : 0;
  if (l.availability === 'limited') score -= 12;
  if (l.availability === 'unavailable') score -= 50;
  if (language && safeParseJson(l.languages, []).some(x => String(x).toLowerCase().includes(language.toLowerCase()))) score += 25;
  if (userState && String(l.state || '').toUpperCase() === userState.toUpperCase()) score += 15;
  score += (l._caseRank === 2 ? 12 : 0);                        // listing names the case type
  if (Number.isFinite(l._dist)) score -= Math.min(l._dist, 100) * 0.4; // closer = better
  return Math.max(0, Math.round(score));
}

async function fetchAndFilterLawyers(db, { city, caseType, language, lat, lng, proBonoOnly, user_state = null }) {
  const rows = await directoryRows(db, `SELECT ${LAWYERS_COLS} FROM lawyers l WHERE COALESCE(l.active, 1) = 1`);
  const found = searchDirectory(rows, {
    lat, lng, q: Number.isFinite(lat) && Number.isFinite(lng) ? '' : city,
    minResults: 6, filters: { caseType, language, proBonoOnly },
  });
  return found.rows.slice(0, 30)
    .map(l => ({ ...l, matchScore: scoreLawyer(l, { language, userState: user_state }), distanceKm: Number.isFinite(l._dist) ? l._dist : null }))
    .sort((a, b) => b.matchScore - a.matchScore || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    .slice(0, 6);
}

// ── stage 2: Claude writes a personalised match report ───────────────────────

const MATCH_SYSTEM_PROMPT = `You are Justice Gavel's lawyer matching engine. Your job is to write a short, human, personalized match report explaining why each attorney is a good fit for this specific user.

Rules:
- Write 2-3 sentences per lawyer. Be specific — reference their specialties, languages, experience, and any financial accessibility (pro bono, sliding scale, free consultation).
- Lead with the most compelling reason they match this person's situation.
- Use plain language. Warm but professional.
- Do NOT invent information. Only use facts provided in the attorney profile.
- Format your response as a JSON array of objects with keys: source_id (string, copied from the profile), report (string).
- Return ONLY the JSON array. No preamble, no markdown fences.`;

const LANGUAGE_NAMES = { ...LANG_NAMES, es: 'Spanish (neutral Latin American, formal "usted")' };

async function generateMatchReports(candidates, userSituation, caseType, language, lang) {
  const profiles = candidates.map(c => ({
    source_id: String(c.id),
    name: c.name,
    specialties: safeParseJson(c.specialties, []),
    languages: safeParseJson(c.languages, ['English']),
    rating: c.rating,
    reviews: c.reviews,
    years_experience: c.years_experience,
    pro_bono: !!c.pro_bono,
    sliding_scale: !!c.sliding_scale,
    free_consultation: !!c.free_consultation,
    bio: c.bio ? String(c.bio).slice(0, 500) : null,
  }));

  const userContext = [
    userSituation ? `User situation: ${userSituation}` : null,
    caseType ? `Charge/case type: ${caseType}` : null,
    language ? `Preferred language: ${language}` : null
  ].filter(Boolean).join('\n');

  const prompt = `User context:\n${userContext || 'Not specified'}\n\nAttorney profiles:\n${JSON.stringify(profiles, null, 2)}\n\nWrite match reports for each attorney, in ${LANGUAGE_NAMES[lang] || 'English'}.`;

  const response = await anthropicFetch({
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         (process.env.ANTHROPIC_API_KEY ?? ''),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: MATCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })
  }, { route: 'match' });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} — ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '[]';

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return safeJson(clean);
  } catch (e) {
    logger.warn('[match/parseAiReport] JSON parse:', e?.message);
    return [];
  }
}

// ── route ─────────────────────────────────────────────────────────────────────

router.get('/lawyers', authRequired, perUserAiLimit, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const city      = sanitizeStr(req.query.city  || '', 100).trim();
    const caseType  = sanitizeStr(req.query.caseType || '', 80).trim();
    const language  = sanitizeStr(req.query.language || '', 50).trim();
    const situation = truncateStr(String(req.query.situation || ''), 500);
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const proBonoOnly = req.query.proBonoOnly === 'true';
    const limit = Math.min(Math.max(safeInt(req.query.limit || '3'), 1), 5);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    if (!city && !hasCoords) {
      return res.status(400).json({ error: msg(lang, 'match.err.need_place'), code: 'bad_location' });
    }

    const db = await openProvidersDb();
    const user_state = req.user?.user_state ?? null;
    const candidates = await fetchAndFilterLawyers(db, {
      city, caseType, language,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      proBonoOnly, user_state,
    });
    if (candidates.length === 0) {
      return res.json({ status: 'done', matches: [], message: msg(lang, 'match.none') });
    }

    const apiKeyMissing = !(process.env.ANTHROPIC_API_KEY ?? '');
    const cands = candidates.slice(0, limit);

    // AI report generation runs as a job (poll GET /api/jobs/:id); it belongs to this user.
    const jobId = await enqueue('match', async () => {
      const rmap = {};
      if (!apiKeyMissing) {
        try {
          const rpts = await generateMatchReports(cands, situation, caseType, language, lang);
          for (const r of Array.isArray(rpts) ? rpts : []) {
            if (r?.source_id && r?.report) rmap[r.source_id] = String(r.report);
          }
        } catch (err) {
          logger.error('[match] AI report failed, using numeric fallback:', err.message);
        }
      }
      return cands.map((l, i) => formatMatch(l, i + 1, rmap[String(l.id)] ?? buildFallbackReport(l, lang)));
    }, req.user.id);

    res.json({
      jobId,
      status:           'pending',
      async:            true,
      not_legal_advice: true,
      disclaimer:       msg(lang, 'match.disclaimer'),
    });
  } catch (err) {
    logger.error('[match/lawyers]', err);
    res.status(500).json({ error: msg(lang, 'match.err.failed'), code: 'server_error' });
  }
});

// ── formatters ────────────────────────────────────────────────────────────────

function formatMatch(l, rank, matchReport) {
  return {
    ...formatListing(l, l.distanceKm),
    rank,
    matchScore: l.matchScore ?? null,
    matchReport: matchReport ?? null,
  };
}

/** A short, factual report from the listing itself (no AI), in the person's language. */
function buildFallbackReport(l, lang) {
  const specs = safeParseJson(l.specialties, []);
  const langs = safeParseJson(l.languages, ['English']);
  const parts = [];
  if (specs.length > 0) parts.push(msg(lang, 'match.fb.specialties', { name: l.name, list: specs.slice(0, 3).join(', ') }));
  if (langs.length > 1) parts.push(msg(lang, 'match.fb.languages', { list: langs.join(', ') }));
  if (Number(l.free_consultation) === 1) parts.push(msg(lang, 'match.fb.free_consult'));
  if (Number(l.sliding_scale) === 1) parts.push(msg(lang, 'match.fb.sliding'));
  if (Number(l.pro_bono) === 1) parts.push(msg(lang, 'match.fb.pro_bono'));
  if (Number(l.rating) > 0 && Number(l.reviews) > 0) parts.push(msg(lang, 'match.fb.rating', { rating: Number(l.rating).toFixed(1), count: Number(l.reviews) }));
  if (Number.isFinite(l.distanceKm)) parts.push(msg(lang, 'match.fb.distance', { mi: (l.distanceKm * 0.621371).toFixed(1) }));
  return parts.join(' ') || msg(lang, 'match.fb.generic');
}

function safeParseJson(val, fallback) {
  if (!val) return fallback;
  try {
    const parsed = safeJson(val);
    // If the caller expects an array, enforce it — JSON.parse('null') = null
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed;
  } catch { return fallback; }
}


// ── GET /api/match/profile/:lawyerId — JTB platform data for a specific attorney ──
// Called by LawyerProfileScreen when viewing a JTB-registered attorney.
// Returns platform rating, outcome record, available slots (next 3 days).
router.get('/profile/:lawyerId', async (req, res) => {
  try {
    const lawyerId = safeInt(req.params.lawyerId);
    if (!lawyerId || lawyerId <= 0) return res.json({ is_jtb_registered: false });

    // Check if this attorney is JTB-registered
    const appDb = await (await import('../db/index.js')).getDb();
    const profile = await appDb.get(
      `SELECT ap.user_id, ap.platform_rating, ap.platform_review_count,
              ap.outcome_score, ap.outcome_count, ap.availability_schedule,
              ap.practice_areas, ap.bar_verification_status,
              u.display_name, u.firm_name, u.bar_state,
              u.avg_response_hrs,
              u.whatsapp_number
         FROM attorney_profiles ap
         JOIN users u ON u.id = ap.user_id
        WHERE ap.lawyer_id = ?`,
      [lawyerId]
    ).catch(() => null);

    if (!profile) {
      return res.json({ is_jtb_registered: false });
    }

    // Next 3 bookable slots — the same slots the booking screen offers (lawyer's zone).
    const lawyer = await appDb.get('SELECT state FROM lawyers WHERE id = ?', [lawyerId]).catch(() => null);
    const booked = await appDb.all(
      `SELECT date_slot, time_slot FROM consultation_bookings
        WHERE lawyer_id = ? AND date_slot >= CURRENT_DATE - 1
          AND (status = 'confirmed' OR (status = 'pending_payment' AND created_at > NOW() - INTERVAL '${PENDING_HOLD_MINUTES} minutes'))
        LIMIT 2000`,
      [lawyerId]
    ).catch(() => []);
    const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
    const slots = generateSlots({
      timeZone: lawyerTimeZone(lawyer?.state), schedule: profile.availability_schedule,
      booked: new Set(booked.map(x => `${iso(x.date_slot)}|${x.time_slot}`)),
    });
    const nextSlots = slots.days.flatMap(d => d.times.filter(t => t.available).map(t => ({ date: d.date, time: t.time, starts_at: t.starts_at }))).slice(0, 3);

    res.json({
      is_jtb_registered:     true,
      platform_rating:       profile.platform_rating,
      platform_review_count: profile.platform_review_count,
      outcome_score:         profile.outcome_score,
      outcome_count:         profile.outcome_count,
      outcome_positive_pct:  profile.outcome_count > 0
        ? Math.max(0, Math.min(100, Math.round(((profile.outcome_score || 3) - 3) / 2 * 100)))
        : null,
      avg_response_hrs:      profile.avg_response_hrs,
      whatsapp_number:       profile.whatsapp_number || null,
      bar_verified:          profile.bar_verification_status === 'approved',
      next_slots:            nextSlots,
      time_zone:             slots.time_zone,
    });
  } catch {
    res.json({ is_jtb_registered: false });
  }
});

export default router;
