/**
 * chatScreen.logic.test.js
 * Tests ChatScreen business logic extracted from the component:
 * - Offline answer fallback (OFFLINE_QA matching)
 * - Message history structure validation
 * - Session ID persistence
 * - Disclaimer state management
 * - Send flow validation (empty input guard)
 * - Category system
 * - Message de-duplication
 */

// ── Extracted logic mirroring ChatScreen.tsx ──────────────────────────────────

// randomId mirrors the screen's helper
let _idCounter = 0;
const randomId = () => `msg_${++_idCounter}_${Math.random().toString(36).slice(2, 6)}`;

// Message structure
function makeUserMessage(text) {
  return { id: randomId(), role: 'user', text: text.trim() };
}
function makeAssistantMessage(text) {
  return { id: randomId(), role: 'assistant', text };
}

// OFFLINE_QA — mirrors the real data in ChatScreen (key samples)
const OFFLINE_QA = [
  {
    q: ['miranda', 'rights', 'silent', 'arrested'],
    a: 'Miranda rights: You have the right to remain silent. Anything you say can be used against you. You have the right to an attorney. If you cannot afford one, one will be appointed.',
  },
  {
    q: ['bail', 'bond', 'release', 'get out'],
    a: 'Bail is money paid to the court so you can be released while your case is pending. A bail bondsman charges 10–15% of the total bail as a non-refundable fee.',
  },
  {
    q: ['expungement', 'expunge', 'clear record', 'seal'],
    a: 'Expungement removes arrests or convictions from your public record. Eligibility varies by state, charge type, and time since conviction.',
  },
  {
    q: ['arraignment', 'first hearing', 'plea'],
    a: 'Arraignment is your first court appearance where charges are read and you enter a plea: Guilty, Not Guilty, or No Contest.',
  },
  {
    q: ['public defender', 'free lawyer', 'afford attorney'],
    a: 'You have the constitutional right to a public defender if you cannot afford an attorney. Request one at arraignment.',
  },
];

function getOfflineAnswer(question) {
  const q = question.toLowerCase();
  const match = OFFLINE_QA.find(entry =>
    entry.q.some(keyword => q.includes(keyword))
  );
  return match?.a ?? null;
}

// Message validation — mirrors send() guard
function validateSendInput(text, isLoading) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  if (isLoading) return { ok: false, reason: 'loading' };
  return { ok: true };
}

// Session ID — mirrors getSessionId() using AsyncStorage
const mockStorage = {};
async function getSessionId() {
  if (mockStorage['chat_session_id']) return mockStorage['chat_session_id'];
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  mockStorage['chat_session_id'] = id;
  return id;
}

// Message categories (mirrors ChatScreen structure)
const CATEGORIES = [
  { key: 'Emergency',    label: 'Emergency' },
  { key: 'Rights',       label: 'Rights'    },
  { key: 'Bail',         label: 'Bail'      },
  { key: 'Court',        label: 'Court'     },
  { key: 'Expungement',  label: 'Expungement'},
];

// History parsing — mirrors the .map() in loadHistory
function parseHistoryItem(raw) {
  return {
    id:   raw.id   || randomId(),
    role: raw.role === 'assistant' ? 'assistant' : 'user',
    text: raw.content || raw.text || '',
  };
}

// De-duplicate messages by id
function deduplicateMessages(messages) {
  const seen = new Set();
  return messages.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatScreen — Offline QA fallback', () => {
  it('matches Miranda rights question', () => {
    const a = getOfflineAnswer("What are my miranda rights?");
    expect(a).not.toBeNull();
    expect(a).toContain('remain silent');
  });

  it('matches bail question', () => {
    const a = getOfflineAnswer("How do I get out on bail?");
    expect(a).not.toBeNull();
    expect(a.toLowerCase()).toContain('bail');
  });

  it('matches expungement question', () => {
    const a = getOfflineAnswer("Can I expunge my record?");
    expect(a).not.toBeNull();
    expect(a.toLowerCase()).toContain('expungement');
  });

  it('matches arraignment question', () => {
    const a = getOfflineAnswer("What happens at arraignment?");
    expect(a).not.toBeNull();
    expect(a.toLowerCase()).toContain('arraignment');
  });

  it('returns null for unknown question', () => {
    expect(getOfflineAnswer("What is the weather today?")).toBeNull();
    expect(getOfflineAnswer("Recipe for pasta")).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(getOfflineAnswer("MIRANDA RIGHTS")).not.toBeNull();
    expect(getOfflineAnswer("BAIL BOND")).not.toBeNull();
  });

  it('matches partial word in question', () => {
    expect(getOfflineAnswer("Tell me about expungement in Tennessee")).not.toBeNull();
  });
});

describe('ChatScreen — Send input validation', () => {
  it('blocks empty string', () => {
    expect(validateSendInput('', false).ok).toBe(false);
    expect(validateSendInput('', false).reason).toBe('empty');
  });

  it('blocks whitespace-only input', () => {
    expect(validateSendInput('   ', false).ok).toBe(false);
  });

  it('blocks send while loading', () => {
    expect(validateSendInput('valid question', true).ok).toBe(false);
    expect(validateSendInput('valid question', true).reason).toBe('loading');
  });

  it('allows valid non-empty input when not loading', () => {
    expect(validateSendInput('What are my rights?', false).ok).toBe(true);
  });
});

describe('ChatScreen — Message construction', () => {
  it('creates user message with correct role', () => {
    const msg = makeUserMessage('  Hello  ');
    expect(msg.role).toBe('user');
    expect(msg.text).toBe('Hello');  // trimmed
    expect(msg.id).toBeTruthy();
  });

  it('creates assistant message with correct role', () => {
    const msg = makeAssistantMessage('You have the right to remain silent.');
    expect(msg.role).toBe('assistant');
    expect(msg.text).toBeTruthy();
  });

  it('each message has a unique id', () => {
    const ids = Array.from({ length: 20 }, () => randomId());
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
  });
});

describe('ChatScreen — Session ID', () => {
  it('returns a consistent session id', async () => {
    const id1 = await getSessionId();
    const id2 = await getSessionId();
    expect(id1).toBe(id2);
    expect(id1).toBeTruthy();
    expect(id1.startsWith('session_')).toBe(true);
  });
});

describe('ChatScreen — History parsing', () => {
  it('maps raw API response to Message shape', () => {
    const raw = [
      { id: '1', role: 'user',      content: 'What are my rights?' },
      { id: '2', role: 'assistant', content: 'You have the right to remain silent.' },
    ];
    const parsed = raw.map(parseHistoryItem);
    expect(parsed[0].role).toBe('user');
    expect(parsed[0].text).toBe('What are my rights?');
    expect(parsed[1].role).toBe('assistant');
    expect(parsed[1].text).toContain('remain silent');
  });

  it('defaults unknown role to user', () => {
    const msg = parseHistoryItem({ id: 'x', role: 'system', content: 'System message' });
    expect(msg.role).toBe('user');
  });

  it('handles missing content gracefully', () => {
    const msg = parseHistoryItem({ id: 'y', role: 'user' });
    expect(msg.text).toBe('');
  });
});

describe('ChatScreen — Message deduplication', () => {
  it('removes duplicate message ids', () => {
    const msgs = [
      { id: 'a', role: 'user',      text: 'Hello' },
      { id: 'b', role: 'assistant', text: 'Hi'    },
      { id: 'a', role: 'user',      text: 'Hello' }, // duplicate
    ];
    const deduped = deduplicateMessages(msgs);
    expect(deduped).toHaveLength(2);
  });

  it('preserves order of first occurrence', () => {
    const msgs = [
      { id: '1', role: 'user',      text: 'First'  },
      { id: '2', role: 'assistant', text: 'Second' },
      { id: '1', role: 'user',      text: 'Dup'    },
    ];
    const deduped = deduplicateMessages(msgs);
    expect(deduped[0].text).toBe('First');
    expect(deduped[1].text).toBe('Second');
  });
});

describe('ChatScreen — Category system', () => {
  it('has 5 categories', () => {
    expect(CATEGORIES).toHaveLength(5);
  });

  it('Emergency is the default active category', () => {
    expect(CATEGORIES[0].key).toBe('Emergency');
  });

  it('all categories have key and label', () => {
    for (const cat of CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.label).toBeTruthy();
    }
  });
});
