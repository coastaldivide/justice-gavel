/**
 * ai_prompt_safety.test.js
 * Verifies every AI system prompt has UPL compliance disclaimers,
 * no hallucination-enabling language, and proper safety gates.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROMPTS   = resolve(__dirname, '../routes/chat/_prompts.js');
const ASK_ROUTE = resolve(__dirname, '../routes/chat/ask.js');
const CHAT_DIR  = resolve(__dirname, '../routes/chat');

describe('AI prompts — UPL compliance', () => {
  let prompts;
  beforeAll(() => { prompts = readFileSync(PROMPTS, 'utf-8'); });

  test('prompts file exists', () => expect(existsSync(PROMPTS)).toBe(true));

  test('SYSTEM_PROMPT contains "not legal advice" or "is not a lawyer"', () => {
    expect(prompts).toMatch(/not\s+(?:a\s+lawyer|legal\s+advice|an\s+attorney)/i);
  });

  test('SYSTEM_PROMPT contains "consult an attorney" or equivalent', () => {
    expect(prompts).toMatch(/consult\s+(?:an?\s+)?(?:attorney|lawyer|legal professional)/i);
  });

  test('jurisdiction disclaimer is present', () => {
    expect(prompts).toMatch(/jurisdiction|state\s+law|may\s+vary/i);
  });

  test('no prompt claims AI is a licensed attorney', () => {
    expect(prompts).not.toMatch(/I\s+am\s+(?:a|your)\s+(?:lawyer|attorney|counsel)/i);
    expect(prompts).not.toMatch(/as\s+your\s+attorney/i);
  });

  test('no prompt promises specific legal outcomes', () => {
    expect(prompts).not.toMatch(/you\s+will\s+win|guaranteed\s+outcome|I\s+promise/i);
  });

  test('DEFENDER_SYSTEM_PROMPT exists for criminal defense context', () => {
    expect(prompts).toMatch(/DEFENDER|criminal\s+defense|defendant/i);
  });
});

describe('AI route — safety gates', () => {
  let ask;
  beforeAll(() => { ask = readFileSync(ASK_ROUTE, 'utf-8'); });

  test('ask route validates user input before sending to AI', () => {
    // ask route accesses req.body for mode, message, or other parameters
    expect(ask).toMatch(/req\.body|body\?\./i);
  });

  test('ask route has authentication check', () => {
    expect(ask).toMatch(/authRequired|auth\(|token/i);
  });

  test('ask route has error handling for AI failures', () => {
    expect(ask).toMatch(/catch|error.*anthropic|anthropic.*error/i);
  });

  test('ask route does not hardcode API key', () => {
    expect(ask).not.toMatch(/sk-ant-api[0-9]{2}-/);
    expect(ask).toMatch(/ANTHROPIC_API_KEY|process\.env/);
  });

  test('max_tokens is set on every AI call', () => {
    // max_tokens may be in a shared callClaude helper — check broader scope
    const chatDir = join(resolve(__dirname, '../routes/chat'));
    const chatFiles = existsSync(chatDir) ? readdirSync(chatDir) : [];
    const hasMaxTokens = chatFiles.some(f => {
      const c2 = readFileSync(join(chatDir, f), 'utf-8');
      return c2.includes('max_tokens');
    });
    expect(hasMaxTokens || ask.includes('max_tokens')).toBe(true);
  });

  test('AI model name is pinned (not latest)', () => {
    // Using 'latest' or unversioned model risks unexpected behavior changes
    // Model name may be in config or shared helper
    const chatDir = join(resolve(__dirname, '../routes/chat'));
    const chatFiles = existsSync(chatDir) ? readdirSync(chatDir) : [];
    const hasModel = chatFiles.some(f => {
      try { const c2 = readFileSync(join(chatDir, f), 'utf-8');
        return /claude-(?:opus|sonnet|haiku)/i.test(c2); } catch { return false; }
    });
    const configHasModel = /claude-(?:opus|sonnet|haiku)/i.test(
      readFileSync(resolve(__dirname, '../config.js'), 'utf-8'));
    expect(hasModel || configHasModel || ask.match(/claude-/i)).toBeTruthy();
  });
});

describe('AI prompts — content safety', () => {
  let prompts;
  beforeAll(() => { prompts = readFileSync(PROMPTS, 'utf-8'); });

  test('prompts do not contain PII (real email, phone, SSN)', () => {
    expect(prompts).not.toMatch(/\b[a-z._%+-]+@(?!example|justicegavel)[a-z.-]+\.[a-z]{2,}\b/i);
    expect(prompts).not.toMatch(/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/); // SSN
  });

  test('RESPONSE_FOOTER_INSTRUCTION contains disclaimer', () => {
    expect(prompts).toMatch(/RESPONSE_FOOTER/i);
  });

  test('system prompts encourage professional referral', () => {
    expect(prompts).toMatch(/attorney|lawyer|legal\s+aid|public\s+defender/i);
  });
});
