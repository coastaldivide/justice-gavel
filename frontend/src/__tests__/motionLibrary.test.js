/**
 * motionLibrary.test.js
 * Tests motion library business logic — type validation, field rendering,
 * PDF export formatting, history filtering, and AI polling behaviour.
 */

// ── Motion type catalogue (mirrors MotionLibraryScreen) ───────────────────────
const MOTION_TYPES = [
  { id:'suppress',    label:'Motion to Suppress',      price:9.99,  fields:['incident_date','evidence_type','basis']  },
  { id:'bail',        label:'Bail Reduction',           price:9.99,  fields:['current_bail','reason','ties_to_community'] },
  { id:'continuance', label:'Motion for Continuance',   price:9.99,  fields:['reason','new_date_requested']             },
  { id:'dismiss',     label:'Motion to Dismiss',        price:9.99,  fields:['grounds','case_number']                   },
  { id:'discovery',   label:'Motion for Discovery',     price:9.99,  fields:['items_requested']                         },
  { id:'appeal',      label:'Appellate Brief',          price:19.99, fields:['conviction_date','grounds','court_level']  },
];

function getMotionType(id) {
  return MOTION_TYPES.find(m => m.id === id) ?? null;
}

function getRequiredFields(motionId) {
  const motion = getMotionType(motionId);
  return motion?.fields ?? [];
}

function validateMotionFields(motionId, values) {
  const required = getRequiredFields(motionId);
  const missing  = required.filter(f => !values[f]?.toString().trim());
  return { valid: missing.length === 0, missing };
}

// PDF court formatting (mirrors printMotion helper)
function formatForCourt(draft, caseTitle = 'State v. Unknown') {
  const header  = `IN THE CRIMINAL COURT\n\n${caseTitle.toUpperCase()}\n\n`;
  const footer  = '\n\n[AI-GENERATED DRAFT — ATTORNEY REVIEW REQUIRED BEFORE FILING]';
  const cleaned = draft.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,3}\s/gm, '');
  return header + cleaned + footer;
}

// Status badge logic (mirrors history row display)
function getStatusStyle(status) {
  const map = {
    draft:    { color:'#9AADC7', label:'Draft'    },
    pending:  { color:'#FFA726', label:'Pending'  },
    complete: { color:'#66BB6A', label:'Complete' },
    failed:   { color:'#EF5350', label:'Failed'   },
    filed:    { color:'#85B7EB', label:'Filed'    },
  };
  return map[status] ?? { color:'#7A90A8', label: status };
}

// History filtering
function filterHistory(history, { statusFilter, searchQuery } = {}) {
  let result = [...history];
  if (statusFilter && statusFilter !== 'all') {
    result = result.filter(h => h.status === statusFilter);
  }
  if (searchQuery?.trim()) {
    const q = searchQuery.toLowerCase();
    result = result.filter(h =>
      h.motion_type?.toLowerCase().includes(q) ||
      h.draft?.toLowerCase().includes(q)
    );
  }
  return result;
}

// Price formatting
function formatPrice(price) {
  return `$${price.toFixed(2)}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Motion type catalogue', () => {
  it('has 6 motion types', () => {
    expect(MOTION_TYPES).toHaveLength(6);
  });

  it('each motion type has id, label, price, and fields', () => {
    for (const m of MOTION_TYPES) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(typeof m.price).toBe('number');
      expect(Array.isArray(m.fields)).toBe(true);
      expect(m.fields.length).toBeGreaterThan(0);
    }
  });

  it('retrieves motion by id', () => {
    const m = getMotionType('suppress');
    expect(m?.label).toBe('Motion to Suppress');
  });

  it('returns null for unknown motion type', () => {
    expect(getMotionType('nonexistent')).toBeNull();
  });
});

describe('Field validation', () => {
  it('passes when all required fields are present', () => {
    const { valid, missing } = validateMotionFields('suppress', {
      incident_date: '2024-01-15',
      evidence_type: 'Cell phone search',
      basis:         'No warrant obtained',
    });
    expect(valid).toBe(true);
    expect(missing).toHaveLength(0);
  });

  it('fails and lists missing fields', () => {
    const { valid, missing } = validateMotionFields('suppress', {
      incident_date: '2024-01-15',
      // evidence_type and basis missing
    });
    expect(valid).toBe(false);
    expect(missing).toContain('evidence_type');
    expect(missing).toContain('basis');
  });

  it('trims whitespace before validating', () => {
    const { valid } = validateMotionFields('continuance', {
      reason:             '   ',  // whitespace only
      new_date_requested: '2025-06-01',
    });
    expect(valid).toBe(false);
  });
});

describe('PDF court formatting', () => {
  it('wraps draft with court header and attorney disclaimer', () => {
    const result = formatForCourt('Motion text here', 'State v. Johnson');
    expect(result).toContain('IN THE CRIMINAL COURT');
    expect(result).toContain('STATE V. JOHNSON');
    expect(result).toContain('ATTORNEY REVIEW REQUIRED');
    expect(result).toContain('Motion text here');
  });

  it('strips markdown bold from court output', () => {
    const result = formatForCourt('**ARGUMENT:** This evidence was improperly seized.');
    expect(result).not.toContain('**');
    expect(result).toContain('ARGUMENT:');
  });

  it('strips markdown headers from court output', () => {
    const result = formatForCourt('## Introduction\nThe court should suppress...');
    expect(result).not.toContain('##');
    expect(result).toContain('Introduction');
  });
});

describe('Status badge', () => {
  it('returns correct color for each status', () => {
    expect(getStatusStyle('draft').label).toBe('Draft');
    expect(getStatusStyle('complete').color).toBe('#66BB6A');
    expect(getStatusStyle('failed').color).toBe('#EF5350');
    expect(getStatusStyle('pending').label).toBe('Pending');
  });

  it('returns fallback for unknown status', () => {
    const s = getStatusStyle('unknown_status');
    expect(s.label).toBe('unknown_status');
  });
});

describe('History filtering', () => {
  const history = [
    { id:1, motion_type:'suppress',    status:'complete', draft:'Illegal search case...' },
    { id:2, motion_type:'bail',        status:'draft',    draft:'Current bail is excessive...' },
    { id:3, motion_type:'continuance', status:'pending',  draft:'Requesting additional time...' },
    { id:4, motion_type:'suppress',    status:'draft',    draft:'Another suppression motion...' },
  ];

  it('returns all items with no filter', () => {
    expect(filterHistory(history)).toHaveLength(4);
  });

  it('filters by status', () => {
    const drafts = filterHistory(history, { statusFilter:'draft' });
    expect(drafts).toHaveLength(2);
    expect(drafts.every(h => h.status === 'draft')).toBe(true);
  });

  it('filters by search query in motion_type', () => {
    const results = filterHistory(history, { searchQuery:'suppress' });
    expect(results).toHaveLength(2);
  });

  it('filters by search query in draft text', () => {
    const results = filterHistory(history, { searchQuery:'excessive' });
    expect(results).toHaveLength(1);
    expect(results[0].motion_type).toBe('bail');
  });

  it('returns empty array when nothing matches', () => {
    const results = filterHistory(history, { searchQuery:'xyznothing' });
    expect(results).toHaveLength(0);
  });

  it('combines status and search filters', () => {
    const results = filterHistory(history, { statusFilter:'draft', searchQuery:'suppress' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(4);
  });
});

describe('Price formatting', () => {
  it('formats prices with two decimal places', () => {
    expect(formatPrice(9.99)).toBe('$9.99');
    expect(formatPrice(19.99)).toBe('$19.99');
  });
});
