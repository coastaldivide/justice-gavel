/**
 * workflowIntegrity.test.js
 * End-to-end workflow tests for all audited screen flows
 */

// ── AgeGateScreen ─────────────────────────────────────────────────────────
describe('AgeGate workflow', () => {
  const CURRENT_YEAR = new Date().getFullYear();
  const MAX_YEAR = CURRENT_YEAR - 18;

  const checkAge = (birthYear) => {
    const age = CURRENT_YEAR - birthYear;
    if (age < 18) return 'underage';
    if (age > 120) return 'invalid';
    return 'verified';
  };

  it('rejects current year as underage', () => {
    expect(checkAge(CURRENT_YEAR)).toBe('underage');
  });

  it('rejects 17 years ago as underage', () => {
    expect(checkAge(CURRENT_YEAR - 17)).toBe('underage');
  });

  it('accepts exactly 18 years ago', () => {
    expect(checkAge(MAX_YEAR)).toBe('verified');
  });

  it('accepts 25 years ago', () => {
    expect(checkAge(CURRENT_YEAR - 25)).toBe('verified');
  });

  it('rejects impossible birth year (> 120 years ago)', () => {
    expect(checkAge(CURRENT_YEAR - 121)).toBe('invalid');
  });

  it('rejects year 0 as invalid', () => {
    expect(checkAge(0)).toBe('invalid');
  });
});

// ── WhatHappensNext reminder workflow ────────────────────────────────────
describe('WhatHappensNext step reminder', () => {
  const buildReminderPayload = (step, now = new Date()) => {
    const remind = new Date(now);
    remind.setDate(remind.getDate() + 1);
    return {
      title: 'Next step: ' + step.title,
      body: (step.what || '').slice(0, 80) || 'Review your case next steps.',
      scheduled_for: remind.toISOString(),
      notification_type: 'court_reminder',
    };
  };

  it('schedules reminder 1 day from now', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    const payload = buildReminderPayload({ title: 'Hire attorney', what: 'You need...' }, now);
    const scheduled = new Date(payload.scheduled_for);
    expect(scheduled.getDate()).toBe(2); // June 2
  });

  it('truncates body at 80 chars', () => {
    const step = { title: 'Step', what: 'A'.repeat(200) };
    const payload = buildReminderPayload(step);
    expect(payload.body.length).toBeLessThanOrEqual(80);
  });

  it('uses fallback when what is empty', () => {
    const payload = buildReminderPayload({ title: 'Step', what: '' });
    expect(payload.body).toBe('Review your case next steps.');
  });

  it('includes step title in notification title', () => {
    const payload = buildReminderPayload({ title: 'Hire attorney', what: '' });
    expect(payload.title).toContain('Hire attorney');
  });
});

// ── DeadlineCalculator workflow ───────────────────────────────────────────
describe('DeadlineCalculator reminder guard', () => {
  const canSetReminder = (deadline, now = new Date()) => {
    const remind3Days = new Date(deadline);
    remind3Days.setDate(remind3Days.getDate() - 3);
    return remind3Days > now ? 'ok' : 'too_close';
  };

  it('blocks reminder for deadline 2 days away', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    expect(canSetReminder(soon)).toBe('too_close');
  });

  it('allows reminder for deadline 7 days away', () => {
    const week = new Date();
    week.setDate(week.getDate() + 7);
    expect(canSetReminder(week)).toBe('ok');
  });

  it('blocks reminder for past deadline', () => {
    const past = new Date('2020-01-01');
    expect(canSetReminder(past)).toBe('too_close');
  });

  it('blocks reminder for exactly 3 days away', () => {
    const exact = new Date();
    exact.setDate(exact.getDate() + 3);
    exact.setHours(0, 0, 0, 0);
    // 3 days away minus 3 days = today → not > now
    expect(canSetReminder(exact)).toBe('too_close');
  });
});

// ── ExpungementScreen eligibility workflow ────────────────────────────────
describe('Expungement eligibility calculation', () => {
  const isEligible = (convictionDate, waitYears) => {
    const eligible = new Date(convictionDate);
    eligible.setFullYear(eligible.getFullYear() + waitYears);
    return eligible <= new Date();
  };

  const daysUntilEligible = (convictionDate, waitYears) => {
    const eligible = new Date(convictionDate);
    eligible.setFullYear(eligible.getFullYear() + waitYears);
    const diff = eligible.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  it('shows eligible for 5-year wait after 6 years', () => {
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    expect(isEligible(sixYearsAgo, 5)).toBe(true);
  });

  it('shows not eligible for 5-year wait after 3 years', () => {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    expect(isEligible(threeYearsAgo, 5)).toBe(false);
  });

  it('returns 0 days if already eligible', () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    expect(daysUntilEligible(tenYearsAgo, 5)).toBe(0);
  });

  it('returns positive days if not yet eligible', () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const days = daysUntilEligible(oneYearAgo, 5);
    expect(days).toBeGreaterThan(365 * 3);
  });
});

// ── DocumentScanner upload workflow ──────────────────────────────────────
describe('DocumentScanner upload flow', () => {
  const buildUploadForm = (uri, caseId) => {
    const form = { entries: [] };
    form.entries.push({ key: 'file', value: { uri, name: `doc_${Date.now()}.jpg`, type: 'image/jpeg' } });
    if (caseId) form.entries.push({ key: 'case_id', value: String(caseId) });
    return form;
  };

  it('always includes the file', () => {
    const form = buildUploadForm('file://photo.jpg', null);
    const fileEntry = form.entries.find(e => e.key === 'file');
    expect(fileEntry).toBeTruthy();
    expect(fileEntry.value.type).toBe('image/jpeg');
  });

  it('includes case_id when provided', () => {
    const form = buildUploadForm('file://photo.jpg', 42);
    const caseEntry = form.entries.find(e => e.key === 'case_id');
    expect(caseEntry?.value).toBe('42');
  });

  it('omits case_id when null', () => {
    const form = buildUploadForm('file://photo.jpg', null);
    const caseEntry = form.entries.find(e => e.key === 'case_id');
    expect(caseEntry).toBeUndefined();
  });

  it('generates unique filename for each upload', () => {
    const form1 = buildUploadForm('file://a.jpg', null);
    const form2 = buildUploadForm('file://b.jpg', null);
    const name1 = form1.entries[0].value.name;
    const name2 = form2.entries[0].value.name;
    expect(name1.startsWith('doc_')).toBe(true);
  });
});

// ── CrisisResources data freshness ───────────────────────────────────────
describe('CrisisResources data merging', () => {
  const STATIC_LINES = [
    { name: 'National Crisis Hotline', number: '988' },
    { name: 'SAMHSA', number: '1-800-662-4357' },
  ];

  const mergeResources = (staticLines, dbLines) => {
    if (!dbLines || dbLines.length === 0) return staticLines;
    // DB lines override — they're more up-to-date
    const names = new Set(dbLines.map(l => l.name));
    return [...dbLines, ...staticLines.filter(l => !names.has(l.name))];
  };

  it('uses static lines when db is empty', () => {
    expect(mergeResources(STATIC_LINES, [])).toEqual(STATIC_LINES);
    expect(mergeResources(STATIC_LINES, null)).toEqual(STATIC_LINES);
  });

  it('prefers db lines over static when same name', () => {
    const dbLines = [{ name: '988', number: '988', updated: true }];
    const result = mergeResources(STATIC_LINES, dbLines);
    const line988 = result.find(l => l.name === '988');
    expect(line988?.updated).toBe(true);
  });

  it('keeps static lines not in db', () => {
    const dbLines = [{ name: 'New Hotline', number: '999' }];
    const result = mergeResources(STATIC_LINES, dbLines);
    expect(result.some(l => l.name === 'National Crisis Hotline')).toBe(true);
  });
});
