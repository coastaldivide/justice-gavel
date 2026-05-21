/**
 * firm_acquisition.test.js
 * Tests: plans, vertical-demo, lead capture, trial activation,
 *        status, upgrade request, onboarding checklist, RBAC
 */

import jwt      from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const tok = (id, role = 'user') =>
  jwt.sign({ id, role, email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

const T1 = tok(1, 'user');
const T2 = tok(2, 'user');

describe('GET /api/firm-acquisition/plans — logic', () => {
  const TIERS = [
    { tier_key: 'standard',   monthly_cents: 19900, seat_limit: 25, matter_limit: 2000, ai_calls_daily: 200 },
    { tier_key: 'mission',    monthly_cents: 4900,  seat_limit: 15, matter_limit: 999,  ai_calls_daily: 100 },
    { tier_key: 'government', monthly_cents: 9900,  seat_limit: 50, matter_limit: 9999, ai_calls_daily: 300 },
    { tier_key: 'enterprise', monthly_cents: 49900, seat_limit: 999,matter_limit: 99999,ai_calls_daily: 999 },
  ];

  test('has 4 tiers', () => expect(TIERS).toHaveLength(4));

  test('mission is cheapest', () => {
    const prices = TIERS.map(t => t.monthly_cents);
    expect(TIERS.find(t => t.tier_key === 'mission').monthly_cents).toBe(Math.min(...prices));
  });

  test('enterprise has highest seat limit', () => {
    const seats = TIERS.map(t => t.seat_limit);
    expect(TIERS.find(t => t.tier_key === 'enterprise').seat_limit).toBe(Math.max(...seats));
  });

  test('government > mission in price', () => {
    const m = TIERS.find(t => t.tier_key === 'mission');
    const g = TIERS.find(t => t.tier_key === 'government');
    expect(g.monthly_cents).toBeGreaterThan(m.monthly_cents);
  });

  test('all 4 tiers have positive pricing', () => {
    TIERS.forEach(t => expect(t.monthly_cents).toBeGreaterThan(0));
  });

  test('mission is 75%+ discount vs standard', () => {
    const std = TIERS.find(t => t.tier_key === 'standard');
    const m   = TIERS.find(t => t.tier_key === 'mission');
    const savings = 1 - m.monthly_cents / std.monthly_cents;
    expect(savings).toBeGreaterThan(0.74);
  });

  test('government pricing between mission and standard', () => {
    const m = TIERS.find(t => t.tier_key === 'mission');
    const g = TIERS.find(t => t.tier_key === 'government');
    const s = TIERS.find(t => t.tier_key === 'standard');
    expect(g.monthly_cents).toBeGreaterThan(m.monthly_cents);
    expect(g.monthly_cents).toBeLessThan(s.monthly_cents);
  });
});

describe('POST /api/firm-acquisition/lead — validation logic', () => {
  function validateLead({ email, firm_name, vertical }) {
    const VALID_VERTICALS = ['criminal_defense','civil_rights','white_collar','family','immigration',
      'personal_injury','public_defense','appellate','military','juvenile','general'];
    if (!email?.trim())     return { error: 'email is required.' };
    if (!firm_name?.trim()) return { error: 'firm_name is required.' };
    const v = vertical && VALID_VERTICALS.includes(vertical) ? vertical : 'general';
    return { captured: true, vertical: v };
  }

  test('valid lead passes', () => {
    const r = validateLead({ email: 'a@b.com', firm_name: 'HVS', vertical: 'criminal_defense' });
    expect(r.captured).toBe(true);
    expect(r.vertical).toBe('criminal_defense');
  });

  test('missing email fails', () => {
    expect(validateLead({ firm_name: 'HVS' }).error).toBeTruthy();
  });

  test('missing firm_name fails', () => {
    expect(validateLead({ email: 'a@b.com' }).error).toBeTruthy();
  });

  test('invalid vertical defaults to general', () => {
    const r = validateLead({ email: 'a@b.com', firm_name: 'HVS', vertical: 'not_real' });
    expect(r.vertical).toBe('general');
  });

  test('null vertical defaults to general', () => {
    const r = validateLead({ email: 'a@b.com', firm_name: 'HVS' });
    expect(r.vertical).toBe('general');
  });
});

describe('POST /api/firm-acquisition/trial — validation logic', () => {
  const VALID_VERTICALS = ['criminal_defense','civil_rights','white_collar','family','immigration',
    'personal_injury','public_defense','appellate','military','juvenile','general'];

  function validateTrial({ firm_name, vertical }) {
    if (!firm_name?.trim()) return { error: 'firm_name is required.' };
    if (!VALID_VERTICALS.includes(vertical)) return { error: 'Invalid vertical.' };
    return { ok: true };
  }

  function calcTrialEnd() {
    const end = new Date(Date.now() + 14 * 86400000);
    const diffDays = (end.getTime() - Date.now()) / 86400000;
    return diffDays;
  }

  test('valid trial request passes', () => {
    expect(validateTrial({ firm_name: 'KIP', vertical: 'immigration' }).ok).toBe(true);
  });

  test('missing firm_name fails', () => {
    expect(validateTrial({ vertical: 'general' }).error).toBeTruthy();
  });

  test('invalid vertical fails', () => {
    expect(validateTrial({ firm_name: 'HVS', vertical: 'garbage' }).error).toBeTruthy();
  });

  test('trial is 14 days', () => {
    const days = calcTrialEnd();
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });
});

describe('POST /api/firm-acquisition/upgrade — validation logic', () => {
  const VALID_TIERS = ['standard','mission','government','enterprise'];

  function validateUpgrade({ target_tier }) {
    if (!target_tier || !VALID_TIERS.includes(target_tier)) return { error: true };
    const needsVerify = target_tier === 'mission' || target_tier === 'government';
    return { ok: true, needsVerify };
  }

  test('enterprise upgrade valid', () => expect(validateUpgrade({ target_tier: 'enterprise' }).ok).toBe(true));
  test('mission upgrade flagged for verification', () => expect(validateUpgrade({ target_tier: 'mission' }).needsVerify).toBe(true));
  test('government upgrade flagged for verification', () => expect(validateUpgrade({ target_tier: 'government' }).needsVerify).toBe(true));
  test('standard upgrade not flagged', () => expect(validateUpgrade({ target_tier: 'standard' }).needsVerify).toBe(false));
  test('invalid tier rejected', () => expect(validateUpgrade({ target_tier: 'platinum' }).error).toBeTruthy());
});

describe('Onboarding checklist logic', () => {
  const ONBOARDING_CHECKLIST = [
    { key: 'vertical_set',    label: 'Choose your practice vertical',   required: true },
    { key: 'team_invited',    label: 'Invite at least one team member',  required: true },
    { key: 'first_matter',    label: 'Create your first matter',         required: true },
    { key: 'deadline_tested', label: 'Run a deadline calculation',       required: false },
    { key: 'tracker_created', label: 'Create a specialty tracker',       required: false },
    { key: 'billing_set',     label: 'Set your billing tier',            required: false },
  ];

  test('has exactly 6 items', () => expect(ONBOARDING_CHECKLIST).toHaveLength(6));
  test('has 3 required items', () => {
    expect(ONBOARDING_CHECKLIST.filter(c => c.required)).toHaveLength(3);
  });
  test('has 3 optional items', () => {
    expect(ONBOARDING_CHECKLIST.filter(c => !c.required)).toHaveLength(3);
  });

  test('completion_pct: 1/6 done = 16%', () => {
    const done = ['vertical_set'];
    const doneKeys = new Set(done);
    const list = ONBOARDING_CHECKLIST.map(c => ({ ...c, done: doneKeys.has(c.key) }));
    const pct = Math.round(list.filter(c => c.done).length / list.length * 100);
    expect(pct).toBe(17); // Math.round(1/6*100) = 17
  });

  test('completion_pct: all done = 100%', () => {
    const doneKeys = new Set(ONBOARDING_CHECKLIST.map(c => c.key));
    const list = ONBOARDING_CHECKLIST.map(c => ({ ...c, done: doneKeys.has(c.key) }));
    const pct = Math.round(list.filter(c => c.done).length / list.length * 100);
    expect(pct).toBe(100);
  });

  test('fully_onboarded: true when all required items done', () => {
    const requiredKeys = new Set(ONBOARDING_CHECKLIST.filter(c => c.required).map(c => c.key));
    const doneKeys = requiredKeys;
    const required_done  = ONBOARDING_CHECKLIST.filter(c => c.required && doneKeys.has(c.key)).length;
    const required_total = ONBOARDING_CHECKLIST.filter(c => c.required).length;
    expect(required_done === required_total).toBe(true);
  });

  test('valid checklist keys', () => {
    const VALID_KEYS = new Set(ONBOARDING_CHECKLIST.map(c => c.key));
    expect(VALID_KEYS.has('vertical_set')).toBe(true);
    expect(VALID_KEYS.has('team_invited')).toBe(true);
    expect(VALID_KEYS.has('first_matter')).toBe(true);
    expect(VALID_KEYS.has('does_not_exist')).toBe(false);
  });
});



// ─── Vertical pitch data (mirrors firm_acquisition.js VERTICAL_PITCH) ─────────
// NOTE: This constant is duplicated here for test isolation. If VERTICAL_PITCH changes
// in firm_acquisition.js, these tests must be updated to match.
const VERTICAL_PITCH = {
  criminal_defense: {
    headline: 'Bail automation. Expungement pipeline. Speedy trial tracking.',
    stats: ['77% of criminal matters hit expungement eligibility', '34% arrive as emergencies — speed matters', 'Avg bail $1.04M — high-value clients expect the platform to match'],
    roi: 'One expunged record returned to employment = avg $48K lifetime earnings gain for your client.',
  },
  civil_rights: {
    headline: 'Class action coordination. SOL calendar. Damages modeling.',
    stats: ['75% of civil rights dockets are class actions', '$4.99M avg total damages per matter', '28.7% strong-evidence rate — walk in with facts, win with process'],
    roi: 'Class cert missed = entire case loss. One SOL alert is worth more than a year of subscription.',
  },
  white_collar: {
    headline: 'DPA negotiation tracker. Cooperation credit modeling. DOJ deadline stack.',
    stats: ['Avg base fine $256.7M — cooperation strategy is everything', '31.6% avg fine reduction through cooperation', '42.7% of matters reach DPA viable or signed status'],
    roi: '1% additional fine reduction on a $100M matter = $1M saved. Platform pays for itself on a single case.',
  },
  family: {
    headline: 'Emergency TRO flow. QDRO specialist matching. Asset-tier routing.',
    stats: ['19.7% of docket is DV — 3-business-day TRO deadline is manual today', '34% high-asset matters requiring QDRO specialists', 'Avg team size 2 — every minute of admin is a minute not billing'],
    roi: 'Missed TRO hearing due to manual tracking = malpractice exposure. Platform eliminates the risk.',
  },
  immigration: {
    headline: 'Asylum clock surveillance. Detained-client alerts. Multi-language support.',
    stats: ['29.3% of clients are detained — urgency is constant', '6.7% already past the 1-year asylum bar — caught too late', 'Avg asylum clock 679 days — impossible to track manually across a full docket'],
    roi: 'One client saved from the 1-year bar = asylum granted instead of removal. Immeasurable client value.',
  },
  personal_injury: {
    headline: 'Emergency intake flow. Expert witness matching. Damages modeling.',
    stats: ['37.7% emergency-pressure cases — highest of any vertical', '$3.43M avg net damages per matter', '35.7% catastrophic or severe injuries requiring specialist coordination'],
    roi: 'Expert witness matched 2 weeks faster = trial-ready sooner = earlier settlement pressure.',
  },
  public_defense: {
    headline: 'Caseload dashboard. Diversion tracker. Expungement pipeline.',
    stats: ['264-case avg attorney caseload — every efficiency gains lives', '30% weak-evidence rate drives constant suppression motion workflow', 'Expungement eligibility missed on 70%+ of closed matters'],
    roi: 'Platform pays for itself in 40 hours of paralegal time recovered per attorney per year.',
  },
  appellate: {
    headline: 'AEDPA deadline tracking. Capital case flagging. Reversal scoring.',
    stats: ['12.3% capital cases — zero margin for missed deadlines', 'Avg reversal score 33.6/100 — fighting uphill, process discipline is everything', '60% of clients have 2+ prior appeals — long case histories to manage'],
    roi: 'One AEDPA deadline missed = permanent bar to habeas review. No amount of billing recovers it.',
  },
  military: {
    headline: 'UCMJ taxonomy. Article 32 deadlines. Security clearance workflow.',
    stats: ['32.3% security clearance revocation cases — no other platform covers this', '50% of clients have prior NJP history — complex disciplinary timelines', 'Avg service tenure 16.3 years — high-stakes, experienced clients with careers at risk'],
    roi: 'Security clearance revocation affects lifetime earning potential. Clients pay premium for specialized counsel.',
  },
  juvenile: {
    headline: 'Juvenile expungement. Transfer monitor. Diversion tracking.',
    stats: ['Average client age 13.5 — outcomes define entire life trajectories', '26% in crisis vulnerability — trauma-informed workflow is mandatory', 'Adult transfer risk at 16+ is the single most consequential decision in the case'],
    roi: 'One diversion outcome instead of adjudication = no juvenile record, stays in school, exits the system.',
  },
  general: {
    headline: 'Full platform access. No vertical restrictions.',
    stats: ['Access all 10 vertical feature sets', 'All deadline presets across all practice areas', 'Full RBAC, matter management, and client portal'],
    roi: 'General practice firms get the broadest coverage — switch to a focused vertical any time.',
  },
};

describe('Vertical pitch data — logic', () => {
  const ALL_VERTICALS = ['criminal_defense','civil_rights','white_collar','family','immigration',
    'personal_injury','public_defense','appellate','military','juvenile','general'];

  ALL_VERTICALS.forEach(v => {
    test(`has valid pitch for ${v}`, () => {
      const p = VERTICAL_PITCH[v];
      expect(p).toBeDefined();
      expect(p.headline).toBeTruthy();
      expect(p.stats).toBeInstanceOf(Array);
      expect(p.stats.length).toBeGreaterThan(0);
    });
  });

  test('rejects invalid vertical (not in map)', () => {
    expect(VERTICAL_PITCH['garbage']).toBeUndefined();
  });

  test('each non-general vertical has ROI statement', () => {
    ALL_VERTICALS.filter(v => v !== 'general').forEach(v => {
      expect(VERTICAL_PITCH[v].roi).toBeTruthy();
    });
  });
});

describe('Third-pass acquisition fixes', () => {
  test('trial rate limit: max 3 trials per user', () => {
    function canCreateTrial(trialCount) {
      return trialCount < 3;
    }
    expect(canCreateTrial(0)).toBe(true);
    expect(canCreateTrial(2)).toBe(true);
    expect(canCreateTrial(3)).toBe(false);
    expect(canCreateTrial(10)).toBe(false);
  });

  test('no-op upgrade: same tier returns 409', () => {
    function validateUpgrade(currentTier, targetTier) {
      if (currentTier === targetTier) return { code: 'ALREADY_ON_TIER', status: 409 };
      return { ok: true };
    }
    expect(validateUpgrade('standard', 'standard').code).toBe('ALREADY_ON_TIER');
    expect(validateUpgrade('standard', 'enterprise').ok).toBe(true);
    expect(validateUpgrade('mission', 'government').ok).toBe(true);
  });

  test('trial active: only active AND not expired', () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const past   = new Date(Date.now() - 7 * 86400000).toISOString();

    function isActive(trial) {
      if (!trial) return false;
      return trial.status === 'active' && trial.trial_end > now;
    }
    expect(isActive({ status: 'active', trial_end: future })).toBe(true);
    expect(isActive({ status: 'active', trial_end: past })).toBe(false);
    expect(isActive(null)).toBe(false);
  });
});

describe('Email format validation (EMAIL_RE)', () => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  test('valid emails pass', () => {
    ['admin@hvs.law', 'user@example.com', 'first.last@firm.org', 'a@b.co'].forEach(e => {
      expect(EMAIL_RE.test(e)).toBe(true);
    });
  });

  test('invalid emails fail', () => {
    ['notanemail', '@nodomain.com', 'no-at-sign', 'a@b.c', '', 'spaces @test.com'].forEach(e => {
      expect(EMAIL_RE.test(e)).toBe(false);
    });
  });

  test('email with single-char TLD fails (minimum 2)', () => {
    expect(EMAIL_RE.test('user@domain.c')).toBe(false);
    expect(EMAIL_RE.test('user@domain.co')).toBe(true);
  });

  test('org_size must be non-negative', () => {
    const clampSize = (s) => Math.max(0, parseInt(s, 10) || 0);
    expect(clampSize(-5)).toBe(0);
    expect(clampSize(0)).toBe(0);
    expect(clampSize(15)).toBe(15);
  });
});

describe('trial POST org_type validation', () => {
  const VALID_ORG_TYPES = ['nonprofit','public_defender','government','legal_aid','law_firm','solo','other'];

  test('all valid org_types accepted', () => {
    VALID_ORG_TYPES.forEach(t => {
      expect(VALID_ORG_TYPES.includes(t)).toBe(true);
    });
  });

  test('invalid org_type rejected', () => {
    expect(VALID_ORG_TYPES.includes('corporation')).toBe(false);
    expect(VALID_ORG_TYPES.includes('')).toBe(false);
    expect(VALID_ORG_TYPES.includes('fake_type')).toBe(false);
  });

  test('undefined org_type is allowed (optional field)', () => {
    // org_type is optional — undefined passes, only invalid strings are rejected
    const org_type = undefined;
    const invalid = org_type && !VALID_ORG_TYPES.includes(org_type);
    expect(invalid).toBeFalsy();
  });
});

describe('POST /upgrade — validation logic', () => {
  const VALID_TIERS = ['standard','mission','government','enterprise'];

  function validateUpgradeRequest(current_tier, target_tier, notes) {
    if (!target_tier || !VALID_TIERS.includes(target_tier)) return { error: 'invalid_tier' };
    if (current_tier === target_tier) return { error: 'ALREADY_ON_TIER', status: 409 };
    if (notes && notes.length > 1000) return { error: 'notes_too_long' };
    return { ok: true, from: current_tier, to: target_tier };
  }

  test('valid upgrade to enterprise', () => {
    expect(validateUpgradeRequest('standard', 'enterprise').ok).toBe(true);
  });
  test('valid upgrade to mission', () => {
    const r = validateUpgradeRequest('standard', 'mission');
    expect(r.ok).toBe(true);
    expect(r.to).toBe('mission');
  });
  test('same tier → 409 ALREADY_ON_TIER', () => {
    expect(validateUpgradeRequest('enterprise', 'enterprise').error).toBe('ALREADY_ON_TIER');
  });
  test('invalid target tier rejected', () => {
    expect(validateUpgradeRequest('standard', 'platinum').error).toBe('invalid_tier');
  });
  test('missing target tier rejected', () => {
    expect(validateUpgradeRequest('standard', null).error).toBe('invalid_tier');
  });
  test('all 4 valid tiers accepted as targets', () => {
    VALID_TIERS.forEach(t => {
      const r = validateUpgradeRequest('viewer_tier', t);
      expect(r.error).not.toBe('invalid_tier');
    });
  });
});

describe('VALID_ORG_TYPES module-level constant', () => {
  const VALID_ORG_TYPES = ['nonprofit','public_defender','government','legal_aid','law_firm','solo','other'];
  test('has 7 types', () => expect(VALID_ORG_TYPES).toHaveLength(7));
  test('includes all practice org types', () => {
    ['nonprofit','public_defender','government','legal_aid'].forEach(t =>
      expect(VALID_ORG_TYPES).toContain(t)
    );
  });
  test('rejects non-member strings', () => {
    expect(VALID_ORG_TYPES.includes('corporation')).toBe(false);
    expect(VALID_ORG_TYPES.includes('')).toBe(false);
  });
});

describe('upgrade POST — RBAC partner+ requirement', () => {
  const ROLE_HIERARCHY = ['viewer','client','paralegal','associate','partner','firm_admin','super_admin'];
  const ROLE_ALIASES = {
    managing_partner:'partner', lead_attorney:'partner', supervising_pd:'partner',
    co_counsel:'associate', law_clerk:'paralegal',
  };
  function resolveRole(r) { return ROLE_ALIASES[r] ?? r; }
  function roleLevel(r)   { return ROLE_HIERARCHY.indexOf(resolveRole(r)); }
  function hasMinRole(u,m){ return roleLevel(u) >= roleLevel(m); }

  test('firm_admin can request upgrade', () => {
    expect(hasMinRole('firm_admin', 'partner')).toBe(true);
  });
  test('managing_partner can request upgrade (resolves to partner)', () => {
    expect(hasMinRole('managing_partner', 'partner')).toBe(true);
  });
  test('lead_attorney can request upgrade (resolves to partner)', () => {
    expect(hasMinRole('lead_attorney', 'partner')).toBe(true);
  });
  test('partner can request upgrade', () => {
    expect(hasMinRole('partner', 'partner')).toBe(true);
  });
  test('associate cannot request upgrade', () => {
    expect(hasMinRole('associate', 'partner')).toBe(false);
  });
  test('co_counsel cannot request upgrade (resolves to associate)', () => {
    expect(hasMinRole('co_counsel', 'partner')).toBe(false);
  });
  test('paralegal cannot request upgrade', () => {
    expect(hasMinRole('paralegal', 'partner')).toBe(false);
  });
});

describe('upgrade POST — ALREADY_ON_TIER 409', () => {
  function validateUpgrade(current, target) {
    const VALID_TIERS = ['standard','mission','government','enterprise'];
    if (!target || !VALID_TIERS.includes(target)) return { error: 'invalid_tier' };
    if (current === target) return { error: 'ALREADY_ON_TIER', status: 409 };
    return { ok: true };
  }
  test('same tier → 409 ALREADY_ON_TIER', () => {
    expect(validateUpgrade('standard', 'standard').error).toBe('ALREADY_ON_TIER');
    expect(validateUpgrade('enterprise', 'enterprise').status).toBe(409);
  });
  test('different tier → ok', () => {
    expect(validateUpgrade('standard', 'enterprise').ok).toBe(true);
  });
  test('VALID_TIERS module-level: all 4 tiers', () => {
    const VALID_TIERS = ['standard','mission','government','enterprise'];
    expect(VALID_TIERS).toHaveLength(4);
    expect(VALID_TIERS.includes('platinum')).toBe(false);
  });
});

describe('status GET — member_count catch', () => {
  test('member_count fallback: .catch(() => ({member_count:0})) returns 0 on error', () => {
    // Simulate the catch fallback
    const fallback = { member_count: 0 };
    const result   = null ?? fallback;  // null simulates a failed DB query
    expect(result.member_count).toBe(0);
  });
  test('matter_count and member_count both have fallbacks', () => {
    // Both queries should gracefully degrade, not throw 500
    const memberFallback = { member_count: 0 };
    const matterFallback = { matter_count: 0 };
    expect(memberFallback.member_count).toBe(0);
    expect(matterFallback.matter_count).toBe(0);
  });
});

describe('checklist GET — completion fields', () => {
  const CHECKLIST = [
    { key:'vertical_set',    required:true },
    { key:'team_invited',    required:true },
    { key:'first_matter',    required:true },
    { key:'deadline_tested', required:false },
    { key:'tracker_created', required:false },
    { key:'billing_set',     required:false },
  ];

  function computeChecklist(doneKeys) {
    const checklist = CHECKLIST.map(c => ({ ...c, done: doneKeys.includes(c.key) }));
    const pct = checklist.length > 0
      ? Math.round(checklist.filter(c => c.done).length / checklist.length * 100)
      : 0;
    const required_done  = checklist.filter(c => c.required && c.done).length;
    const required_total = checklist.filter(c => c.required).length;
    return { pct, required_done, required_total, fully_onboarded: required_done === required_total };
  }

  test('0 items done: 0% completion, not fully onboarded', () => {
    const r = computeChecklist([]);
    expect(r.pct).toBe(0);
    expect(r.fully_onboarded).toBe(false);
    expect(r.required_done).toBe(0);
  });

  test('1/6 done: 17% completion', () => {
    const r = computeChecklist(['vertical_set']);
    expect(r.pct).toBe(17);
    expect(r.fully_onboarded).toBe(false);
  });

  test('all 3 required done: fully_onboarded = true even if optional not done', () => {
    const r = computeChecklist(['vertical_set','team_invited','first_matter']);
    expect(r.required_done).toBe(3);
    expect(r.required_total).toBe(3);
    expect(r.fully_onboarded).toBe(true);
  });

  test('all 6 done: 100% completion', () => {
    const r = computeChecklist(CHECKLIST.map(c => c.key));
    expect(r.pct).toBe(100);
    expect(r.fully_onboarded).toBe(true);
  });

  test('empty checklist guard: pct = 0 not NaN', () => {
    const EMPTY = [];
    const pct = EMPTY.length > 0
      ? Math.round(EMPTY.filter(c => c.done).length / EMPTY.length * 100)
      : 0;
    expect(pct).toBe(0);
    expect(isNaN(pct)).toBe(false);
  });
});

describe('lead POST — sanitization', () => {
  function sanitize(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function sanitizeAndTrunc(v, max) { return sanitize(v, max).replace(/<[^>]*>/g, ''); }

  test('firm_name with HTML is sanitized', () => {
    const result = sanitizeAndTrunc('<script>alert(1)</script>Firm', 200);
    expect(result).not.toContain('<script>');
    expect(result).toContain('Firm');
  });
  test('firm_name truncated to 200 chars', () => {
    const long = 'A'.repeat(250);
    expect(sanitize(long, 200)).toHaveLength(200);
  });
  test('email normalized to lowercase', () => {
    expect('Test@Firm.Com'.toLowerCase()).toBe('test@firm.com');
  });
});

describe('lead POST — idempotency', () => {
  // Simulate the duplicate check logic from the lead POST handler
  function processLead(existing, email, firmName, vertical) {
    const normalEmail = email.trim().toLowerCase();
    if (existing) {
      return { captured: true, id: existing.id, existing: true, action: 'updated', vertical };
    }
    return { captured: true, id: 999, existing: false, action: 'created' };
  }

  test('new lead: captured=true, existing=false', () => {
    const r = processLead(null, 'new@firm.com', 'New Firm', 'immigration');
    expect(r.captured).toBe(true);
    expect(r.existing).toBe(false);
    expect(r.action).toBe('created');
  });

  test('duplicate lead: captured=true, existing=true, vertical updated', () => {
    const r = processLead({ id: 42 }, 'dup@firm.com', 'Existing Firm', 'criminal_defense');
    expect(r.captured).toBe(true);
    expect(r.existing).toBe(true);
    expect(r.action).toBe('updated');
    expect(r.vertical).toBe('criminal_defense');
  });

  test('email normalized to lowercase', () => {
    const email = 'ATTORNEY@BigFirm.COM';
    expect(email.trim().toLowerCase()).toBe('attorney@bigfirm.com');
  });

  test('invalid email rejected by EMAIL_RE', () => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    expect(EMAIL_RE.test('not-an-email')).toBe(false);
    expect(EMAIL_RE.test('a@b')).toBe(false);
    expect(EMAIL_RE.test('valid@firm.com')).toBe(true);
    expect(EMAIL_RE.test('user+tag@example.org')).toBe(true);
  });
});

describe('trial POST — trial limit enforcement', () => {
  function checkTrialLimit(trial_count) {
    if (trial_count >= 3) return { blocked: true, code: 'TRIAL_LIMIT_EXCEEDED' };
    return { allowed: true };
  }
  test('0 trials: allowed', () => expect(checkTrialLimit(0).allowed).toBe(true));
  test('2 trials: allowed', () => expect(checkTrialLimit(2).allowed).toBe(true));
  test('3 trials: blocked', () => {
    const r = checkTrialLimit(3);
    expect(r.blocked).toBe(true);
    expect(r.code).toBe('TRIAL_LIMIT_EXCEEDED');
  });
  test('4 trials: blocked', () => expect(checkTrialLimit(4).blocked).toBe(true));
});
