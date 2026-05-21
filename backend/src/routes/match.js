/**
 * /api/match — Two-stage Claude-powered lawyer matching
 * General guidance only, not legal advice.
 *
 * GET /api/match/lawyers
 *   Query params:
 *     city        {string}  required
 *     caseType    {string}  e.g. "DUI", "Drug Offenses", "Assault"
 *     language    {string}  e.g. "Spanish"
 *     lat, lng    {number}  for distance sorting
 *     proBonoOnly {boolean}
 *     situation   {string}  free-text user situation (used for AI narrative)
 *
 *   Returns: [{ rank, name, phone, website, address, distanceKm?,
 *               specialties, languages, rating, reviews,
 *               pro_bono, sliding_scale, free_consultation,
 *               years_experience, matchScore, matchReport }]
 */

import { err400, safeInt, sanitizeStr, truncateStr, API_URLS } from '../utils/routeHelpers.js';
import { Router }      from 'express';
import { enqueue }     from '../services/aiQueue.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import path from 'path';
import { authRequired } from './auth.js';
import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DB = path.resolve(__dirname, '../../data/providers.sqlite');

// ── Shared column list for providers DB — keeps projections consistent ──────
const LAWYERS_COLS = 'id, name, phone, website, address, lat, lng, city, state, rating, reviews,'
  + ' verified, bar_verified, jtb_verified, pro_bono, sliding_scale, free_consultation,'
  + ' years_experience, specialties, languages, bio, source_id, active';

const router = Router();

async function openProvidersDb() {
  return open({ filename: PROVIDERS_DB, driver: sqlite3.Database });
}

// ── geo distance (haversine) ──────────────────────────────────────────────────

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
}

// ── stage 1: SQL hard filter + numeric scoring ────────────────────────────────

async function fetchAndFilterLawyers(db, { city, caseType, language, lat, lng, proBonoOnly, user_state = null }) {
  // Pull a broad candidate pool for the city
  const rows = await db.all(
    `SELECT ${LAWYERS_COLS} FROM lawyers WHERE city = ? COLLATE NOCASE ORDER BY jtb_verified DESC, bar_verified DESC, rating DESC, reviews DESC LIMIT 100`,
    [city]
  );

  // Cache once — these are request-level constants, not per-lawyer values
  const languageLow   = language ? language.toLowerCase() : '';
  const userStateUp   = user_state ? user_state.toUpperCase() : '';

  return rows
    .filter(l => {
      if (proBonoOnly && !l.pro_bono) return false;

      // Language filter (if requested)
      if (languageLow && languageLow !== 'english') {
        const langs = safeParseJson(l.languages, []);
        const hasLang = langs.some(lg => lg.toLowerCase().includes(languageLow));
        if (!hasLang) return false;
      }

      // Case type soft filter — allow through if no specialties data yet
      if (caseType) {
        const specs = safeParseJson(l.specialties, []);
        if (specs.length > 0) {
          const caseTypeLow = caseType.toLowerCase();
          const match = specs.some(s => {
            const sLow = s.toLowerCase();
            return sLow.includes(caseTypeLow) || caseTypeLow.includes(sLow.split(' ')[0]);
          });
          if (!match) return false;
        }
      }

      return true;
    })
    .map(l => {
      // Numeric match score
      let score = 0;

      // ── Quality signals ──────────────────────────────────────────────────
      score += (l.rating || 0) * 20;                          // 0–100: rating anchor
      score += Math.min(l.reviews || 0, 100) * 0.3;          // 0–30:  credibility volume
      score += Math.min(l.years_experience || 0, 20) * 0.5;  // 0–10:  experience

      // ── Accessibility signals (high weight — affects ability to help) ────
      score += (l.free_consultation ? 15 : 0);   // free consult removes a barrier
      score += (l.pro_bono         ? 18 : 0);    // pro bono = highest accessibility
      score += (l.sliding_scale    ? 10 : 0);    // sliding scale = next best

      // ── Trust / verification signals ─────────────────────────────────────
      score += (l.bar_verified     ? 20 : 0);    // bar verified = confirmed active
      score += (l.jtb_verified     ? 12 : 0);    // JTB verified = reviewed by us
      score += (l.golden_gavel     ?  8 : 0);    // golden gavel = top tier
      score += Math.min(l.gavel_level || 0, 5) * 4; // 0–20: gavel tier progression

      // ── Availability signals ─────────────────────────────────────────────
      if (l.availability === 'accepting')  score += 20;  // actively taking clients
      if (l.availability === 'limited')    score += 8;   // limited but possible
      if (l.availability === 'unavailable') score -= 30; // not taking clients

      // ── Language match (high value for non-English speakers) ────────────
      if (languageLow && l.languages) {
        const langs = safeParseJson(l.languages, []);
        if (langs.some(lang => lang.toLowerCase().includes(languageLow))) {
          score += 25;  // language match is a strong filter for many users
        }
      }

      // ── State match (in-state attorney knows local courts + judges) ──────
      if (userStateUp && l.state && l.state.toUpperCase() === userStateUp) {
        score += 15;
      }

      // ── Response rate ─────────────────────────────────────────────────────
      // avg_response_hrs: lower is better. < 2h = excellent, > 24h = poor
      if (l.avg_response_hrs != null) {
        if (l.avg_response_hrs <= 2)  score += 15;
        else if (l.avg_response_hrs <= 6)  score += 10;
        else if (l.avg_response_hrs <= 24) score +=  5;
        else score -= 5;  // slow responders rank lower
      }

      // Distance boost (closer = better)
      let distanceKm = null;
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(l.lat) && Number.isFinite(l.lng)) {
        distanceKm = haversineKm(lat, lng, l.lat, l.lng);
        score -= Math.min(distanceKm, 50) * 0.2; // mild distance penalty
      }

      return { ...l, matchScore: Math.round(score), distanceKm };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6); // top 6 candidates go to stage 2
}

// ── stage 2: Claude writes a personalised match report ───────────────────────

const MATCH_SYSTEM_PROMPT = `You are Justice Gavel's lawyer matching engine. Your job is to write a short, human, personalized match report explaining why each attorney is a good fit for this specific user.

Rules:
- Write 2-3 sentences per lawyer. Be specific — reference their specialties, languages, experience, and any financial accessibility (pro bono, sliding scale, free consultation).
- Lead with the most compelling reason they match this person's situation.
- Use plain language. Warm but professional.
- Do NOT invent information. Only use facts provided in the attorney profile.
- Format your response as a JSON array of objects with keys: source_id (string), report (string).
- Return ONLY the JSON array. No preamble, no markdown fences.`;

async function generateMatchReports(candidates, userSituation, caseType, language) {
  const profiles = candidates.map(c => ({
    source_id: c.source_id,
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

  const prompt = `User context:\n${userContext || 'Not specified'}\n\nAttorney profiles:\n${JSON.stringify(profiles, null, 2)}\n\nWrite match reports for each attorney.`;

  const response = await fetch(API_URLS.ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      temperature: 0.25,
      max_tokens: 1000,
      system: MATCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} — ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '[]';

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    logger.warn('[match/parseAiReport] JSON parse:', e?.message);
    return [];
  }
}

// ── route ─────────────────────────────────────────────────────────────────────

router.get('/lawyers', authRequired, perUserAiLimit, async (req, res) => {
  try {
    const city      = sanitizeStr(req.query.city  || '', 100).trim();
    const caseType  = sanitizeStr(req.query.caseType || '', 80).trim();
    const language  = sanitizeStr(req.query.language || '', 50).trim();
    const situation = truncateStr(String(req.query.situation || ''), 500);
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const proBonoOnly = req.query.proBonoOnly === 'true';
    const limit = Math.min(safeInt(req.query.limit || '3'), 5);

    // Require either city or valid GPS coords
    if (!city && !(Number.isFinite(lat) && Number.isFinite(lng))) {
      return err400(res, 'city or lat/lng required.');
    }

    const db = await openProvidersDb();
    try {
      // Stage 1: filter + numeric score
      const user_state = req.user?.user_state ?? null;
      const candidates = await fetchAndFilterLawyers(db, {
        city, caseType, language,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        proBonoOnly, user_state,
      });

      if (candidates.length === 0) {
        // Fallback: no matches — return top-rated nationally
        const fallback = await db.all(
          city
            ? `SELECT ${LAWYERS_COLS} FROM lawyers WHERE city = ? COLLATE NOCASE ORDER BY rating DESC LIMIT 3`
            : `SELECT ${LAWYERS_COLS} FROM lawyers ORDER BY rating DESC LIMIT 3`,
          city ? [city] : []
        );
        return res.json(fallback.map((l, i) => formatLawyer(l, i + 1, null, null)));
      }

      const apiKeyMissing = !process.env.ANTHROPIC_API_KEY;
      const cands = candidates.slice(0, limit);

      // Async: enqueue AI report generation — return jobId immediately
      const jobId = await enqueue('match', async () => {
        const rmap = {};
        if (!apiKeyMissing) {
          try {
            const rpts = await generateMatchReports(cands, situation, caseType, language);
            for (const r of rpts) {
              if (r.source_id && r.report) rmap[r.source_id] = r.report;
            }
          } catch (err) {
            logger.error('[match] AI report failed, using numeric fallback:', err.message);
          }
        }
        return cands.map((l, i) => {
          const report = rmap[l.source_id] ?? buildFallbackReport(l, caseType, language);
          return formatLawyer(l, i + 1, report, l.distanceKm);
        });
      });

      res.json({
        jobId,
        status:           'pending',
        async:            true,
        not_legal_advice: true,
        disclaimer:       'Attorney matching is based on location and available data. Verify credentials independently before retaining counsel.',
        message:          `Matching in progress. Poll /api/jobs/${jobId} for results.`,
      });
    } finally {
      // Always close the providers DB connection — SQLite file handle
      await db.close().catch(() => {});
    }
  } catch (err) {
    logger.error('[match/lawyers]', err);
    res.status(500).json({ error: 'Match service error. Please try again.' });
  }
});

// ── formatters ────────────────────────────────────────────────────────────────

function formatLawyer(l, rank, matchReport, distanceKm) {
  return {
    rank,
    name: l.name,
    phone: l.phone,
    website: l.website,
    address: l.address,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
    rating: l.rating,
    reviews: l.reviews,
    specialties: safeParseJson(l.specialties, []),
    languages: safeParseJson(l.languages, ['English']),
    pro_bono: !!l.pro_bono,
    sliding_scale: !!l.sliding_scale,
    free_consultation: !!l.free_consultation,
    years_experience: l.years_experience ?? null,
    matchScore: l.matchScore ?? null,
    matchReport: matchReport ?? null,
    golden_gavel: !!l.golden_gavel,
    gavel_level:  l.gavel_level ?? (l.golden_gavel ? 3 : 0),
  };
}

function buildFallbackReport(l, caseType, language) {
  const specs = safeParseJson(l.specialties, []);
  const langs = safeParseJson(l.languages, ['English']);
  const parts = [];

  if (specs.length > 0) {
    parts.push(`${l.name} specializes in ${specs.slice(0, 3).join(', ')}.`);
  }
  if (langs.length > 1) {
    const langList = langs.length > 2
      ? `${langs.slice(0, -1).join(', ')}, and ${langs[langs.length - 1]}`
      : langs.join(' and ');
    parts.push(`Offers services in ${langList}.`);
  }
  if (l.free_consultation) parts.push('Free initial consultation available.');
  if (l.sliding_scale) parts.push('Sliding-scale fees for qualifying clients.');
  if (l.pro_bono) parts.push('Takes pro bono cases.');
  if (l.years_experience) parts.push(`${l.years_experience} years of criminal defense experience.`);

  return parts.join(' ') || 'Highly rated criminal defense attorney in your area.';
}

function safeParseJson(val, fallback) {
  if (!val) return fallback;
  try {
    const parsed = JSON.parse(val);
    // If the caller expects an array, enforce it — JSON.parse('null') = null
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed;
  } catch { return fallback; }
}

export default router;
