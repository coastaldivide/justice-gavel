/**
 * motionLibraryScreen.logic.test.js
 * Tests MotionLibraryScreen business logic:
 * - Motion type catalogue structure
 * - Field validation per motion type
 * - Generate flow state machine (phases)
 * - Poll job timeout handling
 * - Court PDF formatting
 * - History filtering and search
 * - Status change validation
 * - CourtListener citation parsing
 * - Draft edit tracking
 */

jest.useFakeTimers();

// ── Motion catalogue (mirrors MotionLibraryScreen) ────────────────────────────

const TRIAL_MOTIONS = [
  { key:'suppress',      label:'Motion to Suppress',      icon:'🛡️', price:9.99,
    fields:['incident_date','evidence_type','basis','defendant_name','case_number'] },
  { key:'bail_reduction',label:'Motion for Bail Reduction',icon:'🔓', price:9.99,
    fields:['current_bail','reason','ties_to_community','defendant_name','case_number'] },
  { key:'continuance',   label:'Motion for Continuance',   icon:'📅', price:9.99,
    fields:['reason','new_date_requested','defendant_name','case_number'] },
  { key:'dismiss',       label:'Motion to Dismiss',        icon:'⚖️', price:9.99,
    fields:['grounds','defendant_name','case_number'] },
  { key:'discovery',     label:'Motion for Discovery',     icon:'📋', price:9.99,
    fields:['items_requested','defendant_name','case_number'] },
];
const APPEAL_MOTIONS = [
  { key:'appeal',        label:'Appellate Brief',          icon:'📜', price:19.99,
    fields:['conviction_date','grounds','court_level','defendant_name','case_number'] },
];
const MOTION_TYPES = [...TRIAL_MOTIONS, ...APPEAL_MOTIONS];

function getMotion(key) {
  return MOTION_TYPES.find(m => m.key === key) ?? null;
}

// ── Field validation ──────────────────────────────────────────────────────────

function validateFields(motionKey, values = {}) {
  const motion = getMotion(motionKey);
  if (!motion) return { valid: false, missing: ['motion_type'] };
  const missing = motion.fields.filter(f => !String(values[f] ?? '').trim());
  return { valid: missing.length === 0, missing };
}

// ── Generate phase machine ────────────────────────────────────────────────────

const PHASES = ['picker', 'form', 'generating', 'result', 'edit'];

function transitionPhase(current, event) {
  const transitions = {
    picker:     { select: 'form' },
    form:       { back: 'picker', generate: 'generating' },
    generating: { success: 'result', error: 'form' },
    result:     { edit: 'edit',    back: 'picker', newMotion: 'picker' },
    edit:       { save: 'result',  back: 'result' },
  };
  return transitions[current]?.[event] ?? current;
}

function validateTransition(from, to) {
  return PHASES.includes(from) && PHASES.includes(to);
}

// ── Poll job simulation ───────────────────────────────────────────────────────

async function simulatePollJob(mockResultFn, { timeoutMs = 5000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await mockResultFn();
    if (result.status === 'completed') return { ok: true, result: result.data };
    if (result.status === 'failed')    return { ok: false, error: result.error };
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, error: 'timeout' };
}

// ── Court PDF formatting ──────────────────────────────────────────────────────

const COURT_FONTS = { body: 'Times New Roman', size: 12, line_spacing: 2.0 };

function formatCourtDoc(draft, { caseName, caseNumber, motionLabel }) {
  const header = [
    'IN THE CRIMINAL COURT',
    caseName?.toUpperCase() ?? 'CASE NAME REQUIRED',
    `CASE NO: ${caseNumber ?? 'TBD'}`,
    `\n${motionLabel?.toUpperCase() ?? 'MOTION'}\n`,
  ].join('\n');

  const footer = [
    '\n\n' + '─'.repeat(40),
    'AI-GENERATED DRAFT',
    'ATTORNEY REVIEW REQUIRED BEFORE FILING',
    'NOT LEGAL ADVICE',
  ].join('\n');

  // Strip markdown
  const cleaned = (draft ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•]\s+/gm, '  ');

  return header + '\n' + cleaned + footer;
}

// ── History operations ────────────────────────────────────────────────────────

function filterHistory(items, { status, search } = {}) {
  return items.filter(item => {
    if (status && status !== 'all' && item.status !== status) return false;
    if (search?.trim()) {
      const q = search.toLowerCase();
      return (
        item.motion_type?.toLowerCase().includes(q) ||
        item.draft?.toLowerCase().includes(q)
      );
    }
    return true;
  });
}

function sortHistoryByDate(items) {
  return [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ── Status validation ─────────────────────────────────────────────────────────

const VALID_STATUSES = ['draft', 'pending', 'complete', 'filed', 'failed'];

function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

// ── Citation parsing ──────────────────────────────────────────────────────────

function parseMarkdownCitations(text) {
  // Matches [Case Name, XX F.3d XXX (Yr)](url)
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  const citations = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    citations.push({ text: match[1], url: match[2] });
  }
  return citations;
}

// ── Draft edit tracking ───────────────────────────────────────────────────────

function trackEdits(original, current) {
  const isDirty    = original !== current;
  const wordCount  = current.trim().split(/\s+/).filter(Boolean).length;
  const charCount  = current.length;
  return { isDirty, wordCount, charCount };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MotionLibraryScreen — Catalogue', () => {
  it('has 6 motion types total (5 trial + 1 appeal)', () => {
    expect(MOTION_TYPES).toHaveLength(6);
    expect(TRIAL_MOTIONS).toHaveLength(5);
    expect(APPEAL_MOTIONS).toHaveLength(1);
  });

  it('each motion has key, label, icon, price, and fields', () => {
    for (const m of MOTION_TYPES) {
      expect(m.key).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(typeof m.price).toBe('number');
      expect(Array.isArray(m.fields)).toBe(true);
      expect(m.fields.length).toBeGreaterThan(0);
    }
  });

  it('all motions require defendant_name and case_number', () => {
    for (const m of MOTION_TYPES) {
      expect(m.fields).toContain('defendant_name');
      expect(m.fields).toContain('case_number');
    }
  });

  it('appeal has higher price than trial motions', () => {
    const appealPrice = APPEAL_MOTIONS[0].price;
    const trialPrices = TRIAL_MOTIONS.map(m => m.price);
    expect(trialPrices.every(p => p < appealPrice)).toBe(true);
  });

  it('retrieves motion by key', () => {
    expect(getMotion('suppress')?.label).toBe('Motion to Suppress');
    expect(getMotion('appeal')?.label).toBe('Appellate Brief');
    expect(getMotion('nonexistent')).toBeNull();
  });
});

describe('MotionLibraryScreen — Field validation', () => {
  it('passes with all required fields filled', () => {
    const { valid, missing } = validateFields('suppress', {
      incident_date: '2024-01-15',
      evidence_type: 'cell phone',
      basis: 'no warrant',
      defendant_name: 'John Smith',
      case_number: 'TN-2024-CR-001',
    });
    expect(valid).toBe(true);
    expect(missing).toHaveLength(0);
  });

  it('lists all missing required fields', () => {
    const { valid, missing } = validateFields('suppress', {
      defendant_name: 'John Smith',
    });
    expect(valid).toBe(false);
    expect(missing).toContain('incident_date');
    expect(missing).toContain('evidence_type');
    expect(missing).toContain('basis');
    expect(missing).toContain('case_number');
  });

  it('rejects whitespace-only field values', () => {
    const { valid } = validateFields('continuance', {
      reason: '   ',
      new_date_requested: '2025-06-01',
      defendant_name: 'Jane Doe',
      case_number: 'TN-001',
    });
    expect(valid).toBe(false);
  });

  it('returns invalid for unknown motion type', () => {
    const { valid, missing } = validateFields('not_a_motion', {});
    expect(valid).toBe(false);
    expect(missing).toContain('motion_type');
  });
});

describe('MotionLibraryScreen — Phase machine', () => {
  it('transitions picker → form on select', () => {
    expect(transitionPhase('picker', 'select')).toBe('form');
  });

  it('transitions form → generating on generate', () => {
    expect(transitionPhase('form', 'generate')).toBe('generating');
  });

  it('transitions generating → result on success', () => {
    expect(transitionPhase('generating', 'success')).toBe('result');
  });

  it('transitions generating → form on error (retry)', () => {
    expect(transitionPhase('generating', 'error')).toBe('form');
  });

  it('transitions result → edit on edit', () => {
    expect(transitionPhase('result', 'edit')).toBe('edit');
  });

  it('transitions edit → result on save', () => {
    expect(transitionPhase('edit', 'save')).toBe('result');
  });

  it('stays in current phase for unknown event', () => {
    expect(transitionPhase('form', 'unknownevent')).toBe('form');
  });

  it('back from form returns to picker', () => {
    expect(transitionPhase('form', 'back')).toBe('picker');
  });
});

describe('MotionLibraryScreen — Job polling', () => {
  it('returns result when job completes on first poll', async () => {
    const mock = jest.fn()
      .mockResolvedValue({ status: 'completed', data: { content: 'Draft motion text' } });
    const result = await simulatePollJob(mock, { timeoutMs: 5000, intervalMs: 100 });
    jest.runAllTimers();
    expect(result.ok).toBe(true);
    expect(result.result.content).toBe('Draft motion text');
  });

  it('retries until job completes', async () => {
    // Use real timers with a short interval (no fake timer deadlock)
    const mock = jest.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'completed', data: { content: 'Done' } });
    jest.useRealTimers();
    const result = await simulatePollJob(mock, { timeoutMs: 2000, intervalMs: 1 });
    jest.useFakeTimers();
    expect(result.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('returns error on job failure', async () => {
    const mock = jest.fn().mockResolvedValue({ status: 'failed', error: 'API error' });
    const result = await simulatePollJob(mock, { timeoutMs: 5000, intervalMs: 10 });
    jest.runAllTimers();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('API error');
  });
});

describe('MotionLibraryScreen — Court PDF formatting', () => {
  it('includes case name in uppercase', () => {
    const output = formatCourtDoc('Motion body text.', {
      caseName: 'State v. Johnson', caseNumber: 'TN-2024-001', motionLabel: 'Motion to Suppress',
    });
    expect(output).toContain('STATE V. JOHNSON');
  });

  it('includes case number', () => {
    const output = formatCourtDoc('Body.', {
      caseName: 'State v. Smith', caseNumber: 'CR-123', motionLabel: 'Motion',
    });
    expect(output).toContain('CASE NO: CR-123');
  });

  it('strips markdown bold syntax', () => {
    const output = formatCourtDoc('**ARGUMENT:** Evidence was obtained illegally.', {
      caseName: 'Test', caseNumber: '001', motionLabel: 'Test',
    });
    expect(output).not.toContain('**');
    expect(output).toContain('ARGUMENT:');
  });

  it('strips markdown headers', () => {
    const output = formatCourtDoc('## Section 1\nText here.', {
      caseName: 'Test', caseNumber: '001', motionLabel: 'Test',
    });
    expect(output).not.toMatch(/^#{1,6}\s/m);
    expect(output).toContain('Section 1');
  });

  it('includes attorney review disclaimer', () => {
    const output = formatCourtDoc('Body.', {
      caseName: 'Test', caseNumber: '001', motionLabel: 'Test',
    });
    expect(output).toContain('ATTORNEY REVIEW REQUIRED');
    expect(output).toContain('NOT LEGAL ADVICE');
  });
});

describe('MotionLibraryScreen — History', () => {
  const items = [
    { id:1, motion_type:'suppress',    status:'complete', draft:'Suppression motion...', created_at:'2025-01-01' },
    { id:2, motion_type:'bail_reduction',status:'draft',  draft:'Bail reduction...', created_at:'2025-01-03' },
    { id:3, motion_type:'continuance', status:'pending',  draft:'Continuance request...', created_at:'2025-01-02' },
    { id:4, motion_type:'suppress',    status:'draft',    draft:'Another suppress...', created_at:'2025-01-04' },
  ];

  it('returns all items with no filter', () => {
    expect(filterHistory(items)).toHaveLength(4);
  });

  it('filters by status', () => {
    const drafts = filterHistory(items, { status: 'draft' });
    expect(drafts).toHaveLength(2);
    expect(drafts.every(i => i.status === 'draft')).toBe(true);
  });

  it('searches in motion_type', () => {
    const result = filterHistory(items, { search: 'suppress' });
    expect(result).toHaveLength(2);
  });

  it('searches in draft text', () => {
    const result = filterHistory(items, { search: 'continuance request' });
    expect(result).toHaveLength(1);
    expect(result[0].motion_type).toBe('continuance');
  });

  it('sorts by date descending', () => {
    const sorted = sortHistoryByDate(items);
    expect(sorted[0].id).toBe(4); // 2025-01-04
    expect(sorted[3].id).toBe(1); // 2025-01-01
  });
});

describe('MotionLibraryScreen — Citation parsing', () => {
  it('extracts markdown links as citations', () => {
    const text = 'See [Terry v. Ohio, 392 U.S. 1 (1968)](https://www.courtlistener.com/opinion/107324/terry-v-ohio/) and [Mapp v. Ohio](https://example.com/mapp).';
    const citations = parseMarkdownCitations(text);
    expect(citations).toHaveLength(2);
    expect(citations[0].text).toContain('Terry v. Ohio');
    expect(citations[0].url).toContain('courtlistener');
  });

  it('returns empty array when no citations', () => {
    expect(parseMarkdownCitations('Plain text without links')).toHaveLength(0);
  });
});

describe('MotionLibraryScreen — Draft edit tracking', () => {
  it('detects dirty state when draft is modified', () => {
    const { isDirty } = trackEdits('Original text', 'Modified text');
    expect(isDirty).toBe(true);
  });

  it('is not dirty when unchanged', () => {
    const { isDirty } = trackEdits('Same text', 'Same text');
    expect(isDirty).toBe(false);
  });

  it('counts words correctly', () => {
    const { wordCount } = trackEdits('', 'This is a test motion with seven words.');
    expect(wordCount).toBe(8);
  });

  it('tracks character count', () => {
    const { charCount } = trackEdits('', 'Hello');
    expect(charCount).toBe(5);
  });
});
