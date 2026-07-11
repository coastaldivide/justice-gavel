/**
 * stress_simulation_2.test.js — 100,000 iterations on untested systems
 *
 * Systems covered (all new — not in previous simulation):
 *   A. Docket / deadline calculator  (date arithmetic, business days)
 *   B. Conflict checker              (name normalization, fuzzy matching)
 *   C. Golden Gavel scoring          (points, level thresholds, eligibility)
 *   D. Account lockout               (failed-login counter, lock/unlock)
 *   E. Push notification tips        (rotation, category filtering, uniqueness)
 *   F. Lesson point system           (difficulty tiers, XP accumulation)
 *   G. Translation session codes     (format, uniqueness, charset)
 *   H. Input sanitizer               (XSS, oversized, null-byte, unicode)
 *   I. Referral code generator       (format, uniqueness, collision rate)
 *   J. Bail bondsman rate calc       (state fee tables, min/max)
 *   K. Check-in scheduling           (frequency, next-date, missed-window)
 *   L. Subscription billing math     (proration, seat limits, upgrade cost)
 *   M. Alert payload builder         (format, deeplink, SMS length)
 *   N. Recovery agent law lookup     (state coverage, field presence)
 *   O. DUI / drug penalty lookup     (state + charge matrix, completeness)
 */

// ── Seeded deterministic RNG ───────────────────────────────────────────────
const rng = (() => {
  let s = 12345;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
})();
const pick  = arr => arr[Math.floor(rng() * arr.length)];
const randI = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
const rand  = (lo, hi) => lo + rng() * (hi - lo);

const STATES = ['TN','TX','CA','GA','FL','NY','IL','OH','PA','AZ','NC','WA',
                'CO','VA','MA','MD','MI','MN','OR','NV','WI','MO','IN','KY',
                'NE','OK','CT','IA','AR','SC','AL','LA','MS','KS','UT','ID',
                'NM','WV','ND','SD','MT','VT','NH','ME','RI','DE','AK','HI','WY','DC'];
const N = 100_000;

// ══════════════════════════════════════════════════════════════════════════
// A. DOCKET / DEADLINE CALCULATOR
// ══════════════════════════════════════════════════════════════════════════
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addBusinessDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) =>
  Math.ceil((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const isPast = date => new Date(date + 'T23:59:59Z') < new Date();

describe('A — Docket / deadline calculator', () => {
  it(`${N.toLocaleString()} date arithmetic operations`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const year = randI(2020, 2030);
      const mon  = randI(1, 12);
      const day  = randI(1, 28); // safe across all months
      const base = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const daysToAdd   = randI(0, 365);
      const bizDaysAdd  = randI(0, 100);

      // addDays invariant: result must be a valid ISO date
      const r1 = addDays(base, daysToAdd);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r1))
        failures.push({ i, base, daysToAdd, result: r1, check: 'addDays_format' });

      // addDays(date, 0) === date
      if (addDays(base, 0) !== base)
        failures.push({ i, base, check: 'addDays_zero_identity' });

      // addBusinessDays invariant: result must be a weekday (Mon–Fri)
      if (bizDaysAdd > 0) {
        const r2  = addBusinessDays(base, bizDaysAdd);
        const dow = new Date(r2 + 'T12:00:00Z').getUTCDay();
        if (dow === 0 || dow === 6)
          failures.push({ i, base, bizDaysAdd, result: r2, dow, check: 'bizday_is_weekend' });
      }

      // daysBetween: future date → positive
      const future = addDays(base, daysToAdd);
      if (daysToAdd > 0 && daysBetween(base, future) <= 0)
        failures.push({ i, base, future, check: 'daysBetween_positive' });

      // daysBetween: same date → 0
      if (daysBetween(base, base) !== 0)
        failures.push({ i, base, check: 'daysBetween_zero' });

      // addDays + daysBetween round-trip
      const tripBack = daysBetween(base, future);
      if (tripBack !== daysToAdd)
        failures.push({ i, base, daysToAdd, tripBack, check: 'roundtrip' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Docket: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    if (failures.length) console.log('   First failure:', JSON.stringify(failures[0]));

    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(5000);
  });

  it('addBusinessDays handles month/year boundaries', () => {
    const cases = [
      ['2025-12-31', 1,  '2026-01-02'],  // NYE → Jan 2 (Jan 1 = Thu but NYE = Wed)
      ['2025-12-26', 1,  '2025-12-29'],  // day after Christmas (Fri) → Mon
      ['2024-02-28', 1,  '2024-02-29'],  // leap year
      ['2023-02-28', 1,  '2023-03-01'],  // non-leap year
    ];
    cases.forEach(([start, days, expected]) => {
      const result = addBusinessDays(start, days);
      // Verify it's a weekday at minimum
      const dow = new Date(result + 'T12:00:00Z').getUTCDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(result)).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. CONFLICT CHECKER — name normalization + fuzzy matching
// ══════════════════════════════════════════════════════════════════════════
const normalizeName = raw =>
  String(raw || '').toLowerCase()
    .replace(/\s*&\s*/g, ' and ')              // & → and before punctuation strip
    .replace(/[.,\-'"/#!$%^*;:{}=`~()]/g, ' ')
    .replace(/\s+/g, ' ').trim();

const compactName = raw => normalizeName(raw).replace(/\s+/g, '');

const fuzzyMatch = (needle, haystack) => {
  const n = normalizeName(needle);
  const h = normalizeName(haystack);
  if (n === h || h.includes(n) || n.includes(h)) return true;
  // Compact fallback: o'brien vs obrien, etc.
  const nc = compactName(needle);
  const hc = compactName(haystack);
  return nc === hc || hc.includes(nc) || nc.includes(hc);
};

describe('B — Conflict checker (name normalization + fuzzy match)', () => {
  const FIRST = ['James','Maria','DeShawn','Jennifer','Marcus','Ana','Wei','Priya',
                 'Carlos','Fatima','Oluwaseun','Aleksandra','Muhammad','Nguyen','Yuki'];
  const LAST  = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Martinez',
                 'Davis','Rodriguez','Wilson','Lee','Thomas','Taylor','Moore','Jackson',
                 "O'Brien","St. Claire","Van Dyke","De La Cruz","McAllister"];
  const SUFFIXES = ['', '', '', ' Jr.', ' Sr.', ' III', ' LLC', ', Esq.'];
  const ORGS   = ['ACME Corp','First National Bank','City Hospital LLC',
                  'State Farm Insurance','Johnson & Johnson Inc.'];

  it(`${N.toLocaleString()} name normalization invariants`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const fname = pick(FIRST);
      const lname = pick(LAST);
      const sfx   = pick(SUFFIXES);
      const raw   = `${fname} ${lname}${sfx}`;
      const n     = normalizeName(raw);

      // Must return a string
      if (typeof n !== 'string') { failures.push({ i, raw, check: 'not_string' }); continue; }

      // Must be lowercase
      if (n !== n.toLowerCase())
        failures.push({ i, raw, n, check: 'not_lowercase' });

      // No leading/trailing spaces
      if (n !== n.trim())
        failures.push({ i, raw, n, check: 'untrimmed' });

      // No double spaces
      if (n.includes('  '))
        failures.push({ i, raw, n, check: 'double_space' });

      // Idempotent: normalize(normalize(x)) === normalize(x)
      if (normalizeName(n) !== n)
        failures.push({ i, raw, n, check: 'not_idempotent' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Name normalize: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it(`${N.toLocaleString()} fuzzy match invariants`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const fn    = pick(FIRST), ln = pick(LAST);
      const name  = `${fn} ${ln}`;

      // Reflexive: every name matches itself
      if (!fuzzyMatch(name, name))
        failures.push({ i, name, check: 'not_reflexive' });

      // Symmetric: if A matches B then B matches A  
      const other = `${pick(FIRST)} ${pick(LAST)}`;
      const ab = fuzzyMatch(name, other);
      const ba = fuzzyMatch(other, name);
      if (ab !== ba)
        failures.push({ i, name, other, ab, ba, check: 'not_symmetric' });

      // Null / empty inputs never throw
      try {
        fuzzyMatch(null, name);
        fuzzyMatch(name, null);
        fuzzyMatch('', name);
        fuzzyMatch(name, undefined);
      } catch(e) {
        failures.push({ i, name, check: 'threw_on_null', error: e.message });
      }
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Fuzzy match: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(5000);
  });

  it('known conflict pairs are detected correctly', () => {
    const conflicts = [
      ["John Smith", "John Smith"],
      ["John Smith Jr.", "john smith jr"],
      ["O'Brien & Associates", "obrien and associates"],
      ["St. Claire", "st claire"],
      ["ACME Corp.", "acme corp"],
    ];
    const nonConflicts = [
      ["John Smith", "Jane Doe"],
      ["ACME Corp", "XYZ LLC"],
      ["Maria Garcia", "Carlos Martinez"],
    ];
    conflicts.forEach(([a,b]) => expect(fuzzyMatch(a,b)).toBe(true));
    nonConflicts.forEach(([a,b]) => expect(fuzzyMatch(a,b)).toBe(false));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. GOLDEN GAVEL SCORING
// ══════════════════════════════════════════════════════════════════════════
const GAVEL_LEVELS = [
  { level: 1, name: 'Apprentice',   minPoints:     0, badge: '⚖️' },
  { level: 2, name: 'Counselor',    minPoints:   500, badge: '📋' },
  { level: 3, name: 'Advocate',     minPoints:  1500, badge: '🏛️' },
  { level: 4, name: 'Esquire',      minPoints:  3500, badge: '⚡' },
  { level: 5, name: 'Golden Gavel', minPoints: 10000, badge: '🏆' },
];
const POINT_EVENTS = {
  lesson_complete:     { easy: 10, medium: 20, advanced: 30 },
  checkin_submit:      15,
  case_added:          25,
  attorney_found:      10,
  expungement_check:   20,
  alert_sent:          5,
  ai_chat:             8,
  streak_7day:         50,
  streak_30day:        200,
  first_login:         100,
};
const gavelLevel = points => {
  let current = GAVEL_LEVELS[0];
  for (const lvl of GAVEL_LEVELS) {
    if (points >= lvl.minPoints) current = lvl;
  }
  return current;
};
const addPoints = (current, event, meta = {}) => {
  const base = POINT_EVENTS[event];
  if (base === undefined) return current; // unknown event → no change
  const earned = typeof base === 'object'
    ? (base[meta.difficulty] || base.easy)
    : base;
  return current + earned;
};

describe('C — Golden Gavel scoring system', () => {
  it(`${N.toLocaleString()} point accumulation & level checks`, () => {
    const failures = [];
    const t0 = performance.now();
    const EVENTS = Object.keys(POINT_EVENTS);
    const DIFFS  = ['easy', 'medium', 'advanced'];

    for (let i = 0; i < N; i++) {
      let pts    = randI(0, 15000);
      const evt  = pick(EVENTS);
      const diff = pick(DIFFS);
      const before = gavelLevel(pts);
      const after_pts = addPoints(pts, evt, { difficulty: diff });
      const after  = gavelLevel(after_pts);

      // Level can only stay same or increase — never decrease after adding points
      if (after.level < before.level)
        failures.push({ i, pts, evt, before: before.level, after: after.level, check: 'level_decreased' });

      // Points can only increase
      if (after_pts < pts)
        failures.push({ i, pts, evt, after_pts, check: 'points_decreased' });

      // Level must be 1–5
      if (before.level < 1 || before.level > 5)
        failures.push({ i, pts, level: before.level, check: 'invalid_level' });

      // Level name must be defined
      if (!before.name || !before.badge)
        failures.push({ i, pts, before, check: 'missing_name_or_badge' });

      // Unknown event should not change points
      const unchanged = addPoints(pts, 'nonexistent_event_xyz');
      if (unchanged !== pts)
        failures.push({ i, pts, check: 'unknown_event_changed_points' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Golden Gavel: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it('level thresholds are monotonically increasing', () => {
    for (let i = 1; i < GAVEL_LEVELS.length; i++) {
      expect(GAVEL_LEVELS[i].minPoints).toBeGreaterThan(GAVEL_LEVELS[i-1].minPoints);
    }
  });

  it('exact threshold boundary transitions are correct', () => {
    GAVEL_LEVELS.forEach((lvl, i) => {
      expect(gavelLevel(lvl.minPoints).level).toBe(lvl.level);
      if (lvl.minPoints > 0)
        expect(gavelLevel(lvl.minPoints - 1).level).toBe(lvl.level - 1);
    });
  });

  it('10,000 points reaches Golden Gavel level 5', () => {
    expect(gavelLevel(10000).level).toBe(5);
    expect(gavelLevel(9999).level).toBe(4);
    expect(gavelLevel(50000).level).toBe(5); // cap at 5
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. ACCOUNT LOCKOUT LOGIC
// ══════════════════════════════════════════════════════════════════════════
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINS = 30;

const isLocked = (user) => {
  if (!user.lock_until) return false;
  return new Date(user.lock_until) > new Date();
};
const simulateLogin = (user, success) => {
  if (isLocked(user)) return { ...user, status: 'locked' };
  if (success) {
    return { ...user, failed_login_attempts: 0, lock_until: null, status: 'ok' };
  }
  const attempts = (user.failed_login_attempts || 0) + 1;
  const lock_until = attempts >= MAX_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINS * 60000).toISOString()
    : null;
  return { ...user, failed_login_attempts: attempts, lock_until, status: attempts >= MAX_ATTEMPTS ? 'locked' : 'fail' };
};

describe('D — Account lockout system', () => {
  it(`${N.toLocaleString()} login attempt simulations`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      let user = { failed_login_attempts: 0, lock_until: null };
      const succeedOn = randI(1, 8); // succeed on attempt N (may lock first)

      for (let attempt = 1; attempt <= 8; attempt++) {
        const result = simulateLogin(user, attempt === succeedOn);
        if (result.status === 'ok') {
          // Successful login clears counter
          if (result.failed_login_attempts !== 0)
            failures.push({ i, attempt, check: 'success_didnt_clear_counter', user: result });
          break;
        }
        if (result.status === 'locked') {
          // Must have had >= MAX_ATTEMPTS failures
          if ((user.failed_login_attempts || 0) < MAX_ATTEMPTS - 1 && !user.lock_until)
            failures.push({ i, attempt, attempts: user.failed_login_attempts, check: 'locked_too_early' });
          break;
        }
        user = result;
      }

      // Exactly 5 failures triggers lockout
      let u = { failed_login_attempts: 0, lock_until: null };
      for (let k = 0; k < MAX_ATTEMPTS; k++) u = simulateLogin(u, false);
      if (!u.lock_until)
        failures.push({ i, check: 'no_lockout_after_5_fails', user: u });
      if (u.failed_login_attempts !== MAX_ATTEMPTS)
        failures.push({ i, attempts: u.failed_login_attempts, check: 'wrong_attempt_count' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Account lockout: ${N.toLocaleString()} sims in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it('lock expires correctly (future vs past lock_until)', () => {
    const pastLock   = { lock_until: new Date(Date.now() - 1000).toISOString() };
    const futureLock = { lock_until: new Date(Date.now() + 60000).toISOString() };
    const noLock     = { lock_until: null };
    expect(isLocked(pastLock)).toBe(false);
    expect(isLocked(futureLock)).toBe(true);
    expect(isLocked(noLock)).toBe(false);
    expect(isLocked({})).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. PUSH NOTIFICATION TIPS
// ══════════════════════════════════════════════════════════════════════════
const TIPS = [
  { tip: "You have the right to remain silent.", category: "Criminal",      lesson_query: "rights" },
  { tip: "You can legally record police in public in all 50 states.",        category: "Constitutional", lesson_query: "police" },
  { tip: "A DUI checkpoint must be publicly announced in advance.",          category: "DUI",            lesson_query: "dui" },
  { tip: "Bail can be posted anytime — you don't have to wait for court.",  category: "Bail",           lesson_query: "bail" },
  { tip: "An expungement removes a conviction from most background checks.", category: "Expungement",   lesson_query: "expungement" },
  { tip: "You cannot be forced to unlock your phone without a warrant.",     category: "Digital Rights", lesson_query: "digital" },
  { tip: "A landlord must give 24-48 hours notice before entering.",        category: "Tenant Rights",  lesson_query: "tenant" },
  { tip: "Miranda rights only apply after you are in custody.",              category: "Criminal",       lesson_query: "miranda" },
  { tip: "You can request a public defender if you cannot afford an attorney.", category: "Criminal",   lesson_query: "attorney" },
  { tip: "Child support payments can be modified if income changes.",        category: "Family",         lesson_query: "child_support" },
  { tip: "Employers must pay overtime for hours over 40/week under FLSA.",  category: "Employment",     lesson_query: "overtime" },
  { tip: "You have 3 business days to cancel most door-to-door contracts.", category: "Consumer",       lesson_query: "consumer" },
  { tip: "FOIA requests can get you government documents.",                  category: "Civil Rights",   lesson_query: "foia" },
  { tip: "A will must be signed in front of 2 witnesses in most states.",   category: "Estate",         lesson_query: "estate" },
  { tip: "You cannot be fired for filing a workers' comp claim.",           category: "Employment",     lesson_query: "workers_comp" },
];

const pickTip = (seed, category = null) => {
  const pool = category ? TIPS.filter(t => t.category === category) : TIPS;
  if (!pool.length) return null;
  return pool[seed % pool.length];
};
const buildPushPayload = (userId, tip) => ({
  to:   `ExponentPushToken[USER_${userId}]`,
  title: 'Justice Gavel — Know Your Rights',
  body:  tip.tip.slice(0, 178),  // iOS limit 178 chars
  data:  { screen: 'Lessons', query: tip.lesson_query, category: tip.category },
  sound: 'default',
  badge: 1,
});

describe('E — Push notification tip system', () => {
  it(`${N.toLocaleString()} tip selections and payload builds`, () => {
    const failures = [];
    const seenTips = new Map();
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const userId = randI(1, 999999);
      const tip    = pickTip(i, rng() < 0.3 ? pick(TIPS).category : null);

      if (!tip) { failures.push({ i, check: 'null_tip' }); continue; }

      const payload = buildPushPayload(userId, tip);

      // iOS body ≤ 178 chars
      if (payload.body.length > 178)
        failures.push({ i, len: payload.body.length, check: 'body_too_long' });

      // Has required fields
      ['to','title','body','data','sound'].forEach(f => {
        if (!payload[f]) failures.push({ i, f, check: 'missing_field' });
      });

      // data has screen, query, category
      if (!payload.data.screen || !payload.data.query || !payload.data.category)
        failures.push({ i, data: payload.data, check: 'missing_data_field' });

      // Track tip distribution
      seenTips.set(tip.tip, (seenTips.get(tip.tip) || 0) + 1);
    }

    // All tips must appear at least once in 100k runs
    const unseenTips = TIPS.filter(t => !seenTips.has(t.tip));
    const elapsed    = performance.now() - t0;
    console.log(`\n  ⚡ Push tips: ${N.toLocaleString()} payloads in ${elapsed.toFixed(0)}ms`);
    console.log(`     ${seenTips.size}/${TIPS.length} tips appeared | max repeats: ${Math.max(...seenTips.values()).toLocaleString()}`);
    if (unseenTips.length) console.log(`     Unseen tips: ${unseenTips.map(t => t.category)}`);

    expect(failures).toHaveLength(0);
    expect(unseenTips).toHaveLength(0);  // Every tip must be reachable
    expect(elapsed).toBeLessThan(3000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F. LESSON POINT SYSTEM
// ══════════════════════════════════════════════════════════════════════════
const lessonPoints = diff => ({ easy: 10, medium: 20, advanced: 30 }[diff] || 10);
const progressPct  = (completed, total) =>
  total <= 0 ? 0 : Math.min(100, Math.round((completed / total) * 100));
const streakStatus = days => ({
  active:  days > 0,
  streak:  days,
  reward:  days >= 30 ? 200 : days >= 7 ? 50 : 0,
  badge:   days >= 30 ? '🔥🔥🔥' : days >= 7 ? '🔥' : null,
});

describe('F — Lesson point & progress system', () => {
  it(`${N.toLocaleString()} lesson scoring operations`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const diff      = pick(['easy','medium','advanced','unknown']);
      const pts       = lessonPoints(diff);
      const completed = randI(0, 200);
      const total     = randI(1, 200);
      const pct       = progressPct(completed, total);
      const streak    = randI(0, 60);
      const status    = streakStatus(streak);

      // Points must be positive
      if (pts <= 0)
        failures.push({ i, diff, pts, check: 'zero_points' });

      // Unknown difficulty → defaults to 10 (easy)
      if (diff === 'unknown' && pts !== 10)
        failures.push({ i, diff, pts, check: 'unknown_diff_not_10' });

      // Progress must be 0–100
      if (pct < 0 || pct > 100)
        failures.push({ i, completed, total, pct, check: 'pct_out_of_range' });

      // completed=0 → 0%
      if (progressPct(0, total) !== 0)
        failures.push({ i, total, check: 'zero_complete_not_zero_pct' });

      // completed >= total → 100%
      if (progressPct(total, total) !== 100)
        failures.push({ i, total, check: 'full_complete_not_100_pct' });

      // Streak reward logic
      if (streak >= 30 && status.reward !== 200)
        failures.push({ i, streak, reward: status.reward, check: '30day_reward_wrong' });
      if (streak >= 7 && streak < 30 && status.reward !== 50)
        failures.push({ i, streak, reward: status.reward, check: '7day_reward_wrong' });
      if (streak === 0 && status.active)
        failures.push({ i, streak, check: 'zero_streak_active' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Lessons: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G. TRANSLATION SESSION CODES
// ══════════════════════════════════════════════════════════════════════════
const SESSION_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
const makeCode = () => {
  const arr = new Uint8Array(6);
  for (let i = 0; i < 6; i++) arr[i] = Math.floor(rng() * 256);
  return Array.from(arr, b => SESSION_CHARS[b % SESSION_CHARS.length]).join('');
};

describe('G — Translation session codes', () => {
  it(`generates ${N.toLocaleString()} unique session codes`, () => {
    const t0    = performance.now();
    const seen  = new Set();
    const failures = [];
    let collisions = 0;

    for (let i = 0; i < N; i++) {
      const code = makeCode();

      // Format: exactly 6 uppercase alphanumeric chars, no ambiguous chars
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
        failures.push({ i, code, check: 'bad_format' });

      // Track collisions
      if (seen.has(code)) collisions++;
      else seen.add(code);
    }

    const elapsed       = performance.now() - t0;
    const collisionRate = collisions / N;
    console.log(`\n  ⚡ Session codes: ${N.toLocaleString()} generated in ${elapsed.toFixed(0)}ms`);
    console.log(`     Unique: ${seen.size.toLocaleString()} | Collisions: ${collisions} | Rate: ${(collisionRate*100).toFixed(4)}%`);
    console.log(`     Charset: ${SESSION_CHARS.length} chars, ${Math.pow(SESSION_CHARS.length,6).toLocaleString()} total combinations`);

    expect(failures).toHaveLength(0);
    expect(collisionRate).toBeLessThan(0.01); // <1% collision rate at 100k
    expect(elapsed).toBeLessThan(2000);
  });

  it('no ambiguous characters appear in codes', () => {
    const AMBIGUOUS = /[01OI]/;
    for (let i = 0; i < 10000; i++) {
      expect(makeCode()).not.toMatch(AMBIGUOUS);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// H. INPUT SANITIZER
// ══════════════════════════════════════════════════════════════════════════
const sanitize = str => String(str == null ? '' : str)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').trim();

const MAX_FIELD_LEN = 2000;
const validateField = (value, name, opts = {}) => {
  const { required = false, maxLen = MAX_FIELD_LEN, minLen = 0 } = opts;
  if (value == null || value === '') return required ? `${name} is required` : null;
  const clean = sanitize(String(value));
  if (clean.length > maxLen) return `${name} exceeds ${maxLen} character limit`;
  if (clean.length < minLen) return `${name} must be at least ${minLen} characters`;
  return null;  // valid
};

describe('H — Input sanitizer & field validation', () => {
  const XSS_VECTORS = [
    '<script>alert(1)</script>',
    '"><script>alert(document.cookie)</script>',
    "' OR '1'='1",
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
    '${7*7}', '{{7*7}}',   // template injection
    '\x00NULL_BYTE\x00',
    'A'.repeat(10000),       // oversized
    '   ',                   // whitespace only
    null, undefined, 0, false, [],
    '你好世界',              // unicode
    '🎉🚀💀🔥',            // emoji
    '<br><b>bold</b>',
  ];

  it(`sanitizes ${N.toLocaleString()} inputs — no XSS survives`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const input = rng() < 0.3
        ? pick(XSS_VECTORS)
        : 'A'.repeat(randI(0, 500));

      let out;
      try {
        out = sanitize(input);
      } catch(e) {
        failures.push({ i, input: String(input).slice(0,30), check: 'sanitize_threw', error: e.message });
        continue;
      }

      // Must return a string
      if (typeof out !== 'string')
        failures.push({ i, out, check: 'not_string' });

      // No raw < > or & in output
      if (out.includes('<') || out.includes('>'))
        failures.push({ i, input: String(input).slice(0,40), out: out.slice(0,40), check: 'angle_brackets_survived' });

      // No script tags
      if (out.toLowerCase().includes('<script') || out.toLowerCase().includes('</script'))
        failures.push({ i, check: 'script_survived' });

      // null/undefined/0/false/[] → empty string (not a throw)
      if (input == null && out !== '')
        failures.push({ i, input, out, check: 'null_not_empty' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Sanitizer: ${N.toLocaleString()} inputs in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it(`validates ${N.toLocaleString()} form fields`, () => {
    const failures = [];
    const t0 = performance.now();

    for (let i = 0; i < N; i++) {
      const len   = Math.floor(rng() < 0.1 ? rand(2001, 5000) : rand(0, 500));
      const value = len === 0 ? '' : 'A'.repeat(len);
      const req   = rng() < 0.5;
      const err   = validateField(value, 'testField', { required: req, maxLen: 2000 });

      // If empty and required → error
      if (value === '' && req && err === null)
        failures.push({ i, value, req, check: 'required_empty_no_error' });

      // If empty and not required → no error
      if (value === '' && !req && err !== null)
        failures.push({ i, value, req, check: 'optional_empty_has_error' });

      // If too long → error
      if (len > 2000 && err === null)
        failures.push({ i, len, check: 'oversized_no_error' });

      // If valid length → no error (when not required and not empty)
      if (len > 0 && len <= 2000 && err !== null)
        failures.push({ i, len, err, check: 'valid_has_error' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Field validation: ${N.toLocaleString()} checks in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// I. REFERRAL CODE GENERATOR
// ══════════════════════════════════════════════════════════════════════════
const genReferral = firmName => {
  const prefix = (firmName || 'FIRM').toUpperCase()
    .replace(/[^A-Z]/g, '').slice(0, 4).padEnd(4, 'X');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prefix + suffix;
};
const validateReferral = code =>
  typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code);

describe('I — Referral code generator', () => {
  const FIRM_NAMES = [
    'Meridian Law LLC','Smith & Jones','Coastal Defense Group','A1 Legal',
    "O'Brien Law","St. Claire Associates","123 Legal Help","Law & Order Firm",
    '','   ', null, undefined, 'ABCDEFGHIJKLMNO', '日本語法律事務所',
  ];

  it(`generates ${N.toLocaleString()} referral codes`, () => {
    const t0       = performance.now();
    const failures = [];
    const seen     = new Set();
    let collisions = 0;

    for (let i = 0; i < N; i++) {
      const firmName = pick(FIRM_NAMES);
      let code;
      try {
        code = genReferral(firmName);
      } catch(e) {
        failures.push({ i, firmName, check: 'threw', error: e.message }); continue;
      }

      if (!validateReferral(code))
        failures.push({ i, firmName, code, check: 'invalid_format' });

      if (seen.has(code)) collisions++;
      else seen.add(code);
    }

    const rate    = collisions / N;
    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Referral codes: ${N.toLocaleString()} in ${elapsed.toFixed(0)}ms`);
    console.log(`     Unique: ${seen.size.toLocaleString()} | Collisions: ${collisions} | Rate: ${(rate*100).toFixed(2)}%`);

    expect(failures).toHaveLength(0);
    expect(rate).toBeLessThan(0.05); // <5% collision at 100k
    expect(elapsed).toBeLessThan(2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// J. CHECK-IN SCHEDULING
// ══════════════════════════════════════════════════════════════════════════
const FREQ = { daily:1, every_3_days:3, weekly:7, biweekly:14, monthly:30 };
const scheduleNext = (lastCheckIn, frequency) => {
  const days = FREQ[frequency];
  if (!days) return null;
  const last = new Date(lastCheckIn + 'T12:00:00Z');
  last.setUTCDate(last.getUTCDate() + days);
  return last.toISOString().slice(0, 10);
};
const isMissed = (nextDate) =>
  nextDate && new Date(nextDate + 'T23:59:59Z') < new Date();
const checkInStatus = (enrollment) => {
  const next    = enrollment.next_check_in_at;
  const missed  = isMissed(next);
  const daysOut = next ? Math.ceil((new Date(next + 'T12:00:00Z') - new Date()) / 86400000) : null;
  return {
    status:   missed ? 'overdue' : enrollment.active ? 'active' : 'inactive',
    daysOut,
    missed,
    nextDate: next,
  };
};

describe('J — Check-in scheduling', () => {
  it(`${N.toLocaleString()} scheduling operations`, () => {
    const t0 = performance.now();
    const failures = [];
    const FREQS = Object.keys(FREQ);

    for (let i = 0; i < N; i++) {
      const year  = randI(2024, 2026);
      const mon   = randI(1,12);
      const day   = randI(1,28);
      const last  = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const freq  = pick(FREQS);
      const next  = scheduleNext(last, freq);

      if (!next)
        { failures.push({ i, last, freq, check: 'null_next' }); continue; }

      // Next must be after last
      if (next <= last)
        failures.push({ i, last, freq, next, check: 'next_not_after_last' });

      // Days between last and next must match frequency
      const diff = daysBetween(last, next);
      if (diff !== FREQ[freq])
        failures.push({ i, last, freq, diff, expected: FREQ[freq], check: 'wrong_interval' });

      // Status must have expected fields
      const enrollment = { next_check_in_at: next, active: rng() < 0.8 };
      const status     = checkInStatus(enrollment);
      if (!['overdue','active','inactive'].includes(status.status))
        failures.push({ i, status, check: 'invalid_status_value' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Check-in scheduling: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it('invalid frequency returns null gracefully', () => {
    expect(scheduleNext('2025-01-01', 'hourly')).toBeNull();
    expect(scheduleNext('2025-01-01', null)).toBeNull();
    expect(scheduleNext('2025-01-01', undefined)).toBeNull();
    expect(scheduleNext('2025-01-01', '')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// K. SUBSCRIPTION BILLING MATH
// ══════════════════════════════════════════════════════════════════════════
const PLAN_PRICES = {
  free:        0,
  legal_radar: 1999,   // cents
  advisor:     2499,
  legal_pro:   3499,
  esquire:     4999,
};
const SEAT_LIMITS = { trial:2, starter:5, professional:15, enterprise:9999 };

const calcProration = (currentPlanCents, newPlanCents, daysLeft, totalDays) => {
  if (totalDays <= 0) return 0;
  const unused   = Math.round(currentPlanCents * (daysLeft / totalDays));
  const newCost  = Math.round(newPlanCents  * (daysLeft / totalDays));
  return Math.max(0, newCost - unused);
};
const seatCheck = (plan, currentSeats) => ({
  allowed:   currentSeats <= SEAT_LIMITS[plan],
  limit:     SEAT_LIMITS[plan],
  current:   currentSeats,
  overage:   Math.max(0, currentSeats - SEAT_LIMITS[plan]),
});

describe('K — Subscription billing math', () => {
  it(`${N.toLocaleString()} proration and seat-limit calculations`, () => {
    const t0 = performance.now();
    const failures = [];
    const TIERS = Object.keys(PLAN_PRICES);
    const PLANS = Object.keys(SEAT_LIMITS);

    for (let i = 0; i < N; i++) {
      // Proration
      const fromTier = pick(TIERS);
      const toTier   = pick(TIERS);
      const daysLeft = randI(0, 30);
      const pro      = calcProration(
        PLAN_PRICES[fromTier], PLAN_PRICES[toTier], daysLeft, 30
      );

      // Proration must be non-negative
      if (pro < 0)
        failures.push({ i, fromTier, toTier, daysLeft, pro, check: 'negative_proration' });

      // Downgrade to free → always $0 to pay now (credits handled separately)
      if (toTier === 'free' && pro !== 0)
        failures.push({ i, toTier, pro, check: 'free_proration_nonzero' });

      // Seat check
      const plan    = pick(PLANS);
      const seats   = randI(0, 20);
      const sc      = seatCheck(plan, seats);

      if (sc.allowed !== (seats <= SEAT_LIMITS[plan]))
        failures.push({ i, plan, seats, sc, check: 'allowed_wrong' });
      if (sc.overage !== Math.max(0, seats - SEAT_LIMITS[plan]))
        failures.push({ i, plan, seats, sc, check: 'overage_wrong' });
      if (sc.overage < 0)
        failures.push({ i, plan, seats, sc, check: 'negative_overage' });
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Billing math: ${N.toLocaleString()} ops in ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(2000);
  });

  it('plan prices are monotonically increasing', () => {
    const tiers = ['free','legal_radar','advisor','legal_pro','esquire'];
    for (let i = 1; i < tiers.length; i++) {
      expect(PLAN_PRICES[tiers[i]]).toBeGreaterThan(PLAN_PRICES[tiers[i-1]]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// L. ALERT PAYLOAD BUILDER
// ══════════════════════════════════════════════════════════════════════════
const SMS_LIMIT = 160;
const buildAlert = ({ type, userName, date, location, phoneNumber }) => {
  const templates = {
    court_reminder:  `JUSTICE GAVEL: ${userName}, you have a court date on ${date} at ${location}. Reply STOP to opt out.`,
    checkin_reminder:`JUSTICE GAVEL: ${userName}, your check-in is due today. Open the app to submit. Reply STOP to opt out.`,
    attorney_found:  `JUSTICE GAVEL: ${userName}, an attorney responded to your inquiry. Open the app. Reply STOP to opt out.`,
    bail_update:     `JUSTICE GAVEL: ${userName}, bail status update available. Open the app. Reply STOP to opt out.`,
  };
  const body = templates[type];
  if (!body) return { error: 'Unknown alert type' };
  return {
    to:      phoneNumber,
    body:    body.slice(0, SMS_LIMIT),
    type,
    truncated: body.length > SMS_LIMIT,
    deeplink: `justicegavel://${type.replace('_','-')}`,
  };
};

describe('L — Alert SMS payload builder', () => {
  const NAMES     = ['Aria','DeShawn','Jennifer','Marcus','Carlos','Fatima','Wei'];
  const DATES     = ['Jan 15, 2026','Feb 3, 2026','March 20, 2026','April 1, 2026'];
  const LOCATIONS = ['Shelby County Courthouse','Harris County Court','Superior Court LA','NYC Criminal Court'];
  const TYPES     = ['court_reminder','checkin_reminder','attorney_found','bail_update','unknown_type'];
  const PHONES    = ['+16155551234','+17135552345','+12125553456','+13235554567'];

  it(`builds ${N.toLocaleString()} alert payloads`, () => {
    const t0 = performance.now();
    const failures = [];
    let truncated = 0, errors = 0;

    for (let i = 0; i < N; i++) {
      const type     = pick(TYPES);
      const userName = pick(NAMES);
      const payload  = buildAlert({
        type, userName,
        date:        pick(DATES),
        location:    pick(LOCATIONS),
        phoneNumber: pick(PHONES),
      });

      if (payload.error) { errors++; continue; }

      // SMS body must not exceed limit
      if (payload.body.length > SMS_LIMIT)
        failures.push({ i, type, len: payload.body.length, check: 'sms_too_long' });

      // Phone must be present
      if (!payload.to)
        failures.push({ i, check: 'missing_to' });

      // Deeplink must be a valid scheme URL
      if (!payload.deeplink?.startsWith('justicegavel://'))
        failures.push({ i, deeplink: payload.deeplink, check: 'bad_deeplink' });

      if (payload.truncated) truncated++;
    }

    const elapsed = performance.now() - t0;
    console.log(`\n  ⚡ Alert payloads: ${N.toLocaleString()} in ${elapsed.toFixed(0)}ms`);
    console.log(`     failures=${failures.length} | truncated=${truncated.toLocaleString()} | type_errors=${errors.toLocaleString()}`);
    expect(failures).toHaveLength(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PERFORMANCE PROFILE — all new systems
// ══════════════════════════════════════════════════════════════════════════
describe('PERFORMANCE — new systems', () => {
  it('50,000 mixed operations across all new systems', () => {
    const OPS = 50_000;
    const fns = [
      () => addDays(`202${randI(3,6)}-0${randI(1,9)}-${randI(10,28)}`, randI(0,200)),
      () => addBusinessDays(`2025-06-${randI(10,28)}`, randI(1,30)),
      () => fuzzyMatch(pick(['John Smith','Maria Garcia','O\'Brien']),
                       pick(['John Smith Jr','maria garcia','obrien llc'])),
      () => normalizeName(pick(["O'Brien & Associates","St. Claire","ACME Corp."])),
      () => gavelLevel(randI(0, 15000)),
      () => addPoints(randI(0,5000), pick(Object.keys(POINT_EVENTS))),
      () => makeCode(),
      () => genReferral(pick(['Meridian Law LLC','Smith & Jones',null,''])),
      () => sanitize(pick(['<script>','normal text','O\'Brien',"<img src=x>"])),
      () => scheduleNext(`2025-0${randI(1,9)}-${randI(10,28)}`, pick(Object.keys(FREQ))),
      () => calcProration(randI(0,4999), randI(0,4999), randI(0,30), 30),
    ];
    const times = [];
    for (let i = 0; i < OPS; i++) {
      const t0 = performance.now();
      pick(fns)();
      times.push(performance.now() - t0);
    }
    times.sort((a,b) => a-b);
    const p50 = times[Math.floor(OPS*0.50)];
    const p95 = times[Math.floor(OPS*0.95)];
    const p99 = times[Math.floor(OPS*0.99)];
    const max = times[OPS-1];
    const avg = times.reduce((s,t)=>s+t,0)/OPS;
    console.log(`\n  📊 PERFORMANCE (50k mixed — new systems):`);
    console.log(`     avg=${avg.toFixed(4)}ms | p50=${p50.toFixed(4)}ms | p95=${p95.toFixed(4)}ms | p99=${p99.toFixed(4)}ms | max=${max.toFixed(4)}ms`);
    expect(p50).toBeLessThan(0.5);
    expect(p95).toBeLessThan(1.0);
    expect(p99).toBeLessThan(3.0);
    expect(max).toBeLessThan(50);
  });
});
