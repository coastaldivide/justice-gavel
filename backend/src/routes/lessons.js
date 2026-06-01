import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';

// Pre-built at module load — not re-created per request
const STATE_RIGHTS = {
  AL: {
    stopRule: 'Alabama: You must provide your name if lawfully detained. You do not have to show ID.',
    bailNote: 'Alabama sets bail at initial appearance, usually within 72 hours of arrest.',
    mustID: true,
  },
  AK: {
    stopRule: 'Alaska: You must provide your name and address if lawfully stopped by police.',
    bailNote: 'Alaska arraignment typically within 24–48 hours.',
    mustID: true,
  },
  AZ: {
    stopRule: 'Arizona: You must provide your name if detained. You may also be asked for your address and an explanation of your actions.',
    bailNote: 'Arizona: Initial appearance within 24 hours. Release on recognizance possible for minor offenses.',
    mustID: true,
  },
  AR: {
    stopRule: 'Arkansas: You must provide your name, address, and an explanation of your actions if lawfully stopped.',
    bailNote: 'Arkansas bail set at arraignment, typically within 48 hours.',
    mustID: true,
  },
  CA: {
    stopRule: 'California: You do NOT have to provide ID unless you are driving or under arrest. You may calmly state: "I do not wish to answer questions."',
    bailNote: 'California: Bail schedule varies by county. Some offenses have zero-bail policies. Contact a bondsman immediately.',
    mustID: false,
  },
  CO: {
    stopRule: 'Colorado: You must provide your name and address if lawfully detained.',
    bailNote: 'Colorado: Initial appearance within 48 hours. PR bonds (release without bail) available for non-violent charges.',
    mustID: true,
  },
  CT: {
    stopRule: 'Connecticut: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Connecticut: Arraignment within 24–48 hours. Bail commissioner may set bond before court.',
    mustID: false,
  },
  DE: {
    stopRule: 'Delaware: You must provide your name if lawfully detained.',
    bailNote: 'Delaware: Initial appearance within 24 hours of arrest.',
    mustID: true,
  },
  DC: {
    stopRule: 'Washington D.C.: You are not required to identify yourself to police during a Terry stop.',
    bailNote: 'D.C.: Arraignment within 24 hours. Pretrial Services Agency may recommend release conditions.',
    mustID: false,
  },
  FL: {
    stopRule: 'Florida: You must provide your name and address if lawfully stopped. You do not have to produce a photo ID unless driving.',
    bailNote: 'Florida: First appearance within 24 hours. Bond amount set by judge at first appearance.',
    mustID: true,
  },
  GA: {
    stopRule: 'Georgia: You must provide your name and address if lawfully detained.',
    bailNote: 'Georgia: First appearance typically within 48–72 hours. Bail bondsmen are common.',
    mustID: true,
  },
  HI: {
    stopRule: 'Hawaii: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Hawaii: Arraignment within 48 hours. Hawaii has a bail reform program prioritizing non-monetary release.',
    mustID: false,
  },
  ID: {
    stopRule: 'Idaho: You must provide your name if lawfully detained.',
    bailNote: 'Idaho: Initial appearance within 48 hours. Bail set by magistrate.',
    mustID: true,
  },
  IL: {
    stopRule: 'Illinois: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Illinois: Pretrial Fairness Act (2023) — cash bail abolished. Release conditions set by judge.',
    mustID: true,
  },
  IN: {
    stopRule: 'Indiana: You must provide your name if lawfully stopped. You do not have to provide your address.',
    bailNote: 'Indiana: Initial hearing within 48 hours. PR bonds available.',
    mustID: true,
  },
  IA: {
    stopRule: 'Iowa: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Iowa: Initial appearance within 24 hours. Bail schedule set by county.',
    mustID: false,
  },
  KS: {
    stopRule: 'Kansas: You must provide your name if detained on reasonable suspicion.',
    bailNote: 'Kansas: First appearance within 48 hours of arrest.',
    mustID: true,
  },
  KY: {
    stopRule: 'Kentucky: You must provide your name if lawfully stopped.',
    bailNote: 'Kentucky: Arraignment within 24–48 hours. Bail set by District Court judge.',
    mustID: true,
  },
  LA: {
    stopRule: 'Louisiana: You must provide your name and, if applicable, address if detained. Louisiana uses the Civil Code — your rights follow federal standards during stops.',
    bailNote: 'Louisiana: First appearance within 72 hours. Bail bondsmen widely available.',
    mustID: true,
  },
  ME: {
    stopRule: 'Maine: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Maine: Initial appearance within 48 hours. Court commissioners set bail.',
    mustID: false,
  },
  MD: {
    stopRule: 'Maryland: You are not required to identify yourself during a Terry stop. You may calmly decline to answer.',
    bailNote: 'Maryland: Initial appearance within 24 hours. Pretrial release is common for non-violent charges.',
    mustID: false,
  },
  MA: {
    stopRule: 'Massachusetts: You must provide your name if stopped on reasonable suspicion. You do not have to show ID unless driving.',
    bailNote: 'Massachusetts: Arraignment typically within 24 hours. Bail set by District Court.',
    mustID: true,
  },
  MI: {
    stopRule: 'Michigan: You are not required to identify yourself during a Terry stop. However, you must identify yourself if operating a vehicle.',
    bailNote: 'Michigan: Arraignment within 48 hours. Michigan Clean Slate law (2021) expanded bail reform.',
    mustID: false,
  },
  MN: {
    stopRule: 'Minnesota: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Minnesota: First appearance within 36 hours (48 on weekends). Omnibus hearing follows.',
    mustID: true,
  },
  MS: {
    stopRule: 'Mississippi: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Mississippi: Initial appearance within 48 hours. Justice Court handles bail for misdemeanors.',
    mustID: false,
  },
  MO: {
    stopRule: 'Missouri: You are not required to identify yourself during a Terry stop. Remain calm and silent.',
    bailNote: 'Missouri: Initial appearance within 24 hours. Bail set at first appearance.',
    mustID: false,
  },
  MT: {
    stopRule: 'Montana: You must provide your name and present ID if you have it when lawfully stopped.',
    bailNote: 'Montana: Initial appearance within 48 hours.',
    mustID: true,
  },
  NE: {
    stopRule: 'Nebraska: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Nebraska: First appearance within 24–48 hours. County courts set bail.',
    mustID: true,
  },
  NV: {
    stopRule: 'Nevada: You must identify yourself if stopped on reasonable suspicion. Provide your name.',
    bailNote: 'Nevada: Initial appearance within 48 hours. Justice Courts handle bail.',
    mustID: true,
  },
  NH: {
    stopRule: 'New Hampshire: You are not required to identify yourself during a Terry stop.',
    bailNote: 'New Hampshire: Arraignment within 24 hours. Bail commissioner may set conditions before court.',
    mustID: false,
  },
  NJ: {
    stopRule: 'New Jersey: You are not required to identify yourself during a Terry stop. New Jersey eliminated cash bail in 2017.',
    bailNote: 'New Jersey: Pretrial detention hearing within 48 hours. No cash bail — risk assessment determines release.',
    mustID: false,
  },
  NM: {
    stopRule: 'New Mexico: You are not required to identify yourself during a Terry stop.',
    bailNote: 'New Mexico: Eliminated cash bail in 2016. Detention hearing within 24 hours.',
    mustID: false,
  },
  NY: {
    stopRule: 'New York: You are not required to show ID during a stop. You must provide your name if detained. You may say: "I am exercising my right to remain silent."',
    bailNote: 'New York: Arraignment within 24 hours (less in NYC). Bail eliminated for most misdemeanors and non-violent felonies (2020 reform).',
    mustID: false,
  },
  NC: {
    stopRule: 'North Carolina: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'North Carolina: First appearance within 48 hours. Bail bondsmen widely available.',
    mustID: true,
  },
  ND: {
    stopRule: 'North Dakota: You must provide your name if lawfully stopped.',
    bailNote: 'North Dakota: Initial appearance within 48 hours.',
    mustID: true,
  },
  OH: {
    stopRule: 'Ohio: You must provide your name and address if lawfully detained.',
    bailNote: 'Ohio: Arraignment within 48 hours. Bail reform ongoing at county level.',
    mustID: true,
  },
  OK: {
    stopRule: 'Oklahoma: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Oklahoma: First appearance within 48 hours. Bail reform (SQ 805) failed in 2020 — traditional bail bondsmen.',
    mustID: true,
  },
  OR: {
    stopRule: 'Oregon: You are not required to identify yourself during a Terry stop. Measure 110 (2021) affects drug-related stops.',
    bailNote: 'Oregon: First appearance within 36 hours. Release on recognizance common for minor charges.',
    mustID: false,
  },
  PA: {
    stopRule: 'Pennsylvania: You are not required to identify yourself during a Terry stop. You may decline to answer questions.',
    bailNote: 'Pennsylvania: Preliminary arraignment within 6 hours of arrest (must be prompt). Bail set by Magisterial District Judge.',
    mustID: false,
  },
  RI: {
    stopRule: 'Rhode Island: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Rhode Island: Bail set at District Court arraignment within 48 hours.',
    mustID: false,
  },
  SC: {
    stopRule: 'South Carolina: You must provide your name and address if lawfully detained.',
    bailNote: 'South Carolina: Bond hearing within 24 hours. Note: UPL laws in SC are strict — get a licensed attorney.',
    mustID: true,
  },
  SD: {
    stopRule: 'South Dakota: You must provide your name and address if lawfully stopped.',
    bailNote: 'South Dakota: Initial appearance within 48 hours.',
    mustID: true,
  },
  TN: {
    stopRule: 'Tennessee: You must provide your name if police have reasonable suspicion you committed a crime (T.C.A. § 40-7-123). You do not have to answer other questions.',
    bailNote: 'Tennessee: Commissioner sets bail within hours. General Sessions Court handles bail review.',
    mustID: true,
  },
  TX: {
    stopRule: 'Texas: You must provide your name, address, and date of birth if lawfully stopped (Tex. Penal Code § 38.02). Failure to identify is a Class C misdemeanor.',
    bailNote: 'Texas: Magistrate appearance within 48 hours. Personal bonds available for most misdemeanors.',
    mustID: true,
  },
  UT: {
    stopRule: 'Utah: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Utah: Initial appearance within 72 hours. Utah has a legal tech sandbox — bail reform ongoing.',
    mustID: true,
  },
  VT: {
    stopRule: 'Vermont: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Vermont: Arraignment within 48 hours. Vermont has no commercial bail bondsmen — court sets conditions.',
    mustID: false,
  },
  VA: {
    stopRule: 'Virginia: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Virginia: Bail hearing within 72 hours. Virginia eliminated cash bail for most misdemeanors (2021).',
    mustID: false,
  },
  WA: {
    stopRule: 'Washington: You are not required to identify yourself during a Terry stop. You may politely decline to answer.',
    bailNote: 'Washington: First appearance within 72 hours. Release on personal recognizance common for non-violent offenses.',
    mustID: false,
  },
  WV: {
    stopRule: 'West Virginia: You must provide your name and address if lawfully stopped.',
    bailNote: 'West Virginia: Magistrate hearing within 24 hours of arrest.',
    mustID: true,
  },
  WI: {
    stopRule: 'Wisconsin: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Wisconsin: Initial appearance within 48 hours. Bail set by Circuit Court commissioner.',
    mustID: true,
  },
  WY: {
    stopRule: 'Wyoming: You must provide your name if lawfully stopped.',
    bailNote: 'Wyoming: Initial appearance within 48 hours.',
    mustID: true,
  },
};

const router = Router();
const lessonsLimiter = makeUserLimiter({ windowMs: 3600000, max: 100, message: 'Lesson completion limit reached. Try again later.' });


router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT id, title, category, body, body as content, difficulty, duration_min FROM lessons ORDER BY id ASC LIMIT 200');
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600');
    return res.json(rows);
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not load lessons' }); }
});

router.post('/:id/complete', authRequired, lessonsLimiter, async (req, res) => {
  try {
    const db = await getDb();
    // Always use authenticated user ID — never trust user_id from body
    const user_id = req.user.id;
    const lesson_id = safeInt(req.params.id);
    // Upsert progress
    const existing = await db.get('SELECT id, user_id, lesson_id, completed, completed_at FROM lesson_progress WHERE user_id=? AND lesson_id=? LIMIT 1', [user_id, lesson_id]);
    if (!existing) {
      await db.run(
        'INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at) VALUES (?,?,1, datetime("now"))',
        [user_id, lesson_id]
      );
    }
    // Award points
    await db.run(
      'INSERT INTO rewards (user_id, points, updated_at) VALUES (?,10, datetime("now")) ON CONFLICT(user_id) DO UPDATE SET points = points + 10, updated_at=datetime("now")',
      [user_id]
    );
    return res.json({ ok: true, pointsAwarded: 10 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not mark complete' }); }
});

router.get('/progress/:userId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND completed=1', [req.params.userId]);
    const rewards = await db.get('SELECT points FROM rewards WHERE user_id=?', [req.params.userId]);
    return res.json({ completed: rows.map(r => r.lesson_id), points: rewards?.points || 0 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not load progress' }); }
});

// ── GET /api/lessons/rights-card?state=XX ─────────────────────────────────────
// Returns structured rights card data for any US state.
// Used by the frontend to render + share a wallet-sized card.
router.get('/rights-card', async (req, res) => {
  try {
  const stateCode = (req.query.state || 'US').toString().toUpperCase().slice(0, 2);

  // ── All 50 states + DC — stop-and-identify laws ─────────────────────────────
  // Source: Published state statutes and case law
  // Last verified: April 2026

  const stateData = STATE_RIGHTS[stateCode];

  const stopRule = stateData
    ? stateData.stopRule
    : `${stateCode}: Know your state's specific ID laws — laws vary. Consult a licensed attorney in your state.`;

  const bailNote = stateData
    ? stateData.bailNote
    : `Bail processes vary by state. Use Justice Gavel's Bail Finder for local options.`;

  const mustID = stateData ? stateData.mustID : null;

  const stateName = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
    CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington D.C.',FL:'Florida',
    GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
    KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
    MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
    MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
    NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
    OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
    SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
    WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  }[stateCode] || stateCode;

  const card = {
    state: stateCode,
    stateName,
    mustID,
    title: 'Know Your Rights',
    subtitle: `${stateName} — What to say & do if you're stopped or arrested`,
    brandLine: 'JusticeGavel.app  ·  Free legal help  ·  Available 24/7',
    rights: [
      {
        heading: '1. RIGHT TO REMAIN SILENT',
        body: 'Say: "I am invoking my right to remain silent."\nYou do NOT have to answer questions — in any state.',
      },
      {
        heading: '2. RIGHT TO A LAWYER',
        body: 'Say: "I want a lawyer."\nDo not answer questions until your lawyer is present.',
      },
      {
        heading: '3. RIGHT AGAINST UNREASONABLE SEARCH',
        body: 'Say: "I do not consent to a search."\nPolice need a warrant or probable cause to search.',
      },
      {
        heading: `4. IF STOPPED — ${stateName.toUpperCase()} LAW`,
        body: stopRule,
        stateSpecific: true,
        mustID,
      },
      {
        heading: '5. DURING ARREST',
        body: 'Do not resist — even if it\'s unlawful.\nStay calm. Challenge the arrest in court.',
      },
      {
        heading: `6. BAIL — ${stateName.toUpperCase()}`,
        body: bailNote,
        stateSpecific: true,
      },
      {
        heading: '7. YOUR KEY PHRASES',
        body: '"I am invoking my right to remain silent."\n"I want a lawyer."\n"I do not consent to a search."',
      },
    ],
    emergency: [
      `Bail help:  JusticeGavel.app → Bail Finder (${stateName})`,
      `Lawyer:     JusticeGavel.app → Find a Lawyer (${stateName})`,
    ],
    footer: 'General legal information only — not legal advice. Laws change. Verify with a licensed attorney in your state.',
    last_updated: '2026-04',
    source_note: 'Based on published state statutes and case law as of April 2026.',
  };

  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  return res.json(card);

  } catch (_e) {
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.', code: 'server_error' });
  }
});

// GET /api/lessons/progress/me — current user's streak + completed count
router.get('/progress/me', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const completed = await db.all(
      'SELECT lesson_id, completed_at FROM lesson_progress WHERE user_id=? AND completed=1 ORDER BY completed_at DESC',
      [req.user.id]
    );
    // Calculate streak
    const days = [...new Set(completed.map(r => r.completed_at?.slice(0,10)))].sort().reverse();
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < days.length; i++) {
      const d = new Date(days[i]); d.setHours(0,0,0,0);
      const expected = new Date(today); expected.setDate(today.getDate() - i);
      if (d.getTime() === expected.getTime()) streak++;
      else break;
    }
    return res.json({ completed: completed.length, streak, lesson_ids: completed.map(r => r.lesson_id) });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message });
    return res.status(500).json({ error: 'Could not load progress' });
  }
});

export default router;
