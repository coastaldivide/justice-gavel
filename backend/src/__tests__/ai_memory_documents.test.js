/**
 * AI step 5 — unit tests (docs/AI_PLATFORM.md §12–13): legal-reference checks, the recap rules,
 * history splitting, the recap prompt, settings, the chat_memory request against the mock's
 * documented 400 rules (incl. the context-management rules the mock now enforces), the ZIP /
 * OOXML writer (read back with unzipper, every part parsed as XML) and the PDF writer in all
 * 8 languages.
 */
import unzipper from 'unzipper';
import { DOMParser } from '@xmldom/xmldom';
import { findRefs, hasLegalRef, sectionNumbers, paragraphCovered, checkParagraphs } from '../ai/legalRefs.js';
import { normalizeRecap, splitRecent, recapPrompt, memorySettings, scrub, publicMemory } from '../services/conversationMemory.js';
import { buildModel, checkDraft, checkStored, storedText, unsign, fileName, WITHHELD_MARK } from '../services/draftDocs/model.js';
import { docxFromModel, xmlText } from '../services/draftDocs/docx.js';
import { pdfFromModel } from '../services/draftDocs/pdf.js';
import { writeZip } from '../services/draftDocs/zip.js';
import { buildRequest } from '../services/aiClient.js';
import { requestProblem, contextProblem } from '../../scripts/anthropic-mock-lib.mjs';
import { SCHEMAS, validate } from '../ai/schemas/index.js';

const LANGS = ['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl'];
const xmlOk = (s) => { let e = 0; new DOMParser({ onError: () => { e += 1; } }).parseFromString(s, 'application/xml'); return e === 0; };
async function parts(buf) {
  const dir = await unzipper.Open.buffer(buf);
  const out = {};
  for (const f of dir.files) out[f.path] = (await f.buffer()).toString('utf8');
  return out;
}

describe('legal references', () => {
  test('statutes, rules and cases are found; dates and money are not section numbers', () => {
    expect(hasLegalRef('Under Tenn. Code Ann. § 40-32-101(a)(1) you may')).toBe(true);
    expect(hasLegalRef('See 18 U.S.C. 3607')).toBe(true);
    expect(hasLegalRef('Cal. Penal Code 1203.4 applies')).toBe(true);
    expect(hasLegalRef('Rule 32 of the rules of criminal procedure')).toBe(true);
    expect(hasLegalRef('See State v. Smith, 123 S.W.3d 456 (Tenn. 2003).')).toBe(true);
    expect(hasLegalRef('IN THE CIRCUIT COURT OF KNOX COUNTY\nPetitioner: [FULL NAME]')).toBe(false);
    expect(hasLegalRef('My court date is 2026-11-02 and bail was $1,500.')).toBe(false);
    expect(sectionNumbers('§ 40-32-101(a)(1) and N.J.S.A. 2C:52-2 on 2026-11-02')).toEqual(expect.arrayContaining(['40-32-101', '2c:52-2']));
    expect(sectionNumbers('on 2026-11-02 and 11/02/2026')).toEqual([]);
    expect(findRefs('Brady v. Maryland, 373 U.S. 83 (1963)')[0].kind).toBe('case');
  });
  test('a paragraph is covered only by a checked citation; cases never', () => {
    const allowed = ['Tenn. Code Ann. § 40-32-101'];
    expect(paragraphCovered('Relief under § 40-32-101(a)(1).', allowed)).toBe(true);
    expect(paragraphCovered('Relief under § 40-32-101 and § 39-13-101.', allowed)).toBe(false);
    expect(paragraphCovered('Relief under the Tennessee Code.', allowed)).toBe(true);
    expect(paragraphCovered('Relief under the Tennessee Code ann. section 5.', [])).toBe(false);
    expect(paragraphCovered('See Brady v. Maryland, 373 U.S. 83 (1963), and § 40-32-101.', allowed)).toBe(false);
    const r = checkParagraphs('CAPTION\nline two\n\nUnder § 40-32-101 yes.\n\nUnder § 1-2-3 no.', allowed);
    expect(r).toMatchObject({ withheld: 1, kept: 2 });
    expect(r.paragraphs[0].text).toBe('CAPTION\nline two');
  });
});

describe('the recap', () => {
  const said = 'I was arrested in Knox County on March 3. My email is a@b.co and phone 615-555-1234.';
  test('only what the person said; contact details scrubbed; legal references dropped; capped', () => {
    const r = normalizeRecap({
      case_stage: 'Arrested; waiting', places: ['Knox County', 'Atlantis'],
      dates: [{ what: 'Arrest', date: 'March 3' }, { what: 'Hearing', date: 'June 30' }, { what: '', date: '3' }],
      facts: ['Email a@b.co, phone 615-555-1234', 'Per T.C.A. § 40-11-118 bail', 'SSN 123-45-6789', ...Array.from({ length: 12 }, (_, i) => `fact ${i}`)],
      asked: ['bail', 'bail'],
    }, said);
    expect(r.places).toEqual(['Knox County']);
    expect(r.dates).toEqual([{ what: 'Arrest', date: 'March 3' }]);
    expect(r.facts[0]).toBe('Email […], phone […]');
    expect(r.facts.join(' ')).not.toMatch(/§|123-45/);
    expect(r.facts.length).toBe(8);
    expect(r.asked).toEqual(['bail']);
    expect(normalizeRecap({ case_stage: '', places: [], dates: [], facts: [], asked: [] }, said)).toBeNull();
    expect(normalizeRecap(null, said)).toBeNull();
    expect(scrub('x'.repeat(500)).length).toBe(200);
  });
  test('accents and other scripts: places match the person\'s words', () => {
    expect(normalizeRecap({ case_stage: '', places: ['Condado de Bexár'], dates: [], facts: [], asked: [] }, 'vivo en el condado de Bexar')?.places).toEqual(['Condado de Bexár']);
    expect(normalizeRecap({ case_stage: '', places: ['休斯顿'], dates: [], facts: [], asked: [] }, '我在休斯顿被捕')?.places).toEqual(['休斯顿']);
  });
  test('split keeps the last N exchanges starting at a question', () => {
    const rows = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'].map((role, i) => ({ role, content: String(i) }));
    const [older, recent] = splitRecent(rows, 2);
    expect(older.map((r) => r.content)).toEqual(['0', '1']);
    expect(recent[0]).toMatchObject({ role: 'user', content: '2' });
    expect(splitRecent(rows, 5)).toEqual([[], rows]);
  });
  test('prompt block says "not a source"; empty recap → nothing', () => {
    const p = recapPrompt({ case_stage: 'Arrested', places: ['Knox County'], dates: [{ what: 'Arrest', date: 'March 3' }], facts: ['x'], asked: ['bail'] });
    expect(p).toMatch(/NOT a source: never cite it/);
    expect(p).toContain('- Date: Arrest — March 3');
    expect(recapPrompt(null)).toBe('');
  });
  test('settings and the public view', () => {
    const keep = { ...process.env };
    process.env.AI_MEMORY_THRESHOLD_TOKENS = '100'; process.env.AI_MEMORY_KEEP_TURNS = '99'; process.env.AI_MEMORY = 'off';
    expect(memorySettings()).toEqual({ enabled: false, threshold: 4000, keepTurns: 10 });
    delete process.env.AI_MEMORY_THRESHOLD_TOKENS; delete process.env.AI_MEMORY_KEEP_TURNS; delete process.env.AI_MEMORY;
    expect(memorySettings()).toEqual({ enabled: true, threshold: 16000, keepTurns: 3 });
    expect(publicMemory({ recap: { case_stage: 'a' }, covered_rows: 7, forgotten: false, updated_at: 'x' })).toMatchObject({ remembered: true, covered_turns: 3 });
    expect(publicMemory({ recap: null, forgotten: true })).toMatchObject({ remembered: false, forgotten: true, recap: null });
    Object.assign(process.env, keep);
  });
  test('the chat_memory request is quick class + structured, and passes the mock\'s 400 rules', () => {
    const r = buildRequest({ task: 'chat_memory', system: [{ text: 'x' }], messages: [{ role: 'user', content: 'y' }] });
    expect(r.cls).toBe('quick');
    expect(r.body.model).toBe('claude-haiku-5-5');
    expect(r.body.output_config.format.schema).toEqual(SCHEMAS.chat_memory);
    expect(requestProblem(r.body, r.headers)).toBeNull();
    expect(validate(SCHEMAS.chat_memory, { case_stage: '', places: [], dates: [{ what: 'a', date: 'b' }], facts: [], asked: [] }).ok).toBe(true);
  });
  test('mock: the documented context-management / compaction rules', () => {
    const b = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] };
    expect(contextProblem({ ...b, compaction: { type: 'summarize' } })).toMatch(/compact-2026-09-04/);
    expect(contextProblem({ ...b, compaction: { type: 'summarize' } }, { 'anthropic-beta': 'compact-2026-09-04' })).toBeNull();
    expect(contextProblem({ ...b, model: 'claude-haiku-4-5', compaction: { type: 'summarize' } }, { 'anthropic-beta': 'compact-2026-09-04' })).toMatch(/not supported/);
    expect(contextProblem({ ...b, compaction: { type: 'summarize' }, context_management: { edits: [] } }, { 'anthropic-beta': 'compact-2026-09-04' })).toMatch(/cannot be combined/);
    expect(contextProblem({ ...b, context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] } })).toMatch(/context-management-2025-06-27/);
    const h = { 'anthropic-beta': 'context-management-2025-06-27' };
    expect(contextProblem({ ...b, context_management: { edits: [{ type: 'clear_tool_uses_20250919' }, { type: 'clear_thinking_20251015' }] } }, h)).toMatch(/first/);
    expect(contextProblem({ ...b, context_management: { edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens', value: 1000 } }] } }, { 'anthropic-beta': 'compact-2026-01-12' })).toMatch(/50000/);
    expect(requestProblem({ ...b, context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] } }, h)).toBeNull();
  });
});

describe('draft documents', () => {
  const allowed = ['Tenn. Code Ann. § 40-32-101'];
  const draft = 'IN THE COURT\nOF KNOX COUNTY\n\nUnder § 40-32-101 the petitioner asks.\n\nSee State v. Smith, 123 S.W.3d 456 (2003).\n\n/s/ Jane Doe';
  const model = (lang) => buildModel({
    title: 'Petition', lang, draft, allowed,
    sources: [{ citation: allowed[0], url: 'https://www.tn.gov/x', checked: '2026-10-25' }],
    fields: [{ label: 'Name', value: lang === 'ar' ? 'محمد علي' : lang === 'zh' ? '王小明 😀' : 'José <Núñez> & Co' }],
    signerName: 'Jane Doe',
  });
  test('the model: withheld paragraph, no /s/ signature, own words verbatim, sources, blank signature block', () => {
    expect(unsign('a\n/s/ Jane Doe\nb')).toBe('a\n______________________________\nb');
    const m = model('en');
    expect(m.withheld).toBe(1);
    expect(m.blocks.find((b) => b.type === 'withheld').text).toBe('[No source found for this part — not shown]');
    expect(JSON.stringify(m.blocks)).not.toContain('/s/');
    expect(m.blocks.find((b) => b.type === 'field').value).toBe('José <Núñez> & Co');
    expect(m.blocks.find((b) => b.type === 'source')).toMatchObject({ citation: allowed[0], checked: 'checked 2026-10-25' });
    expect(m.blocks[m.blocks.length - 1]).toMatchObject({ type: 'signature', name: 'Jane Doe' });
    expect(m.notice).toMatch(/^Prepared by you with Justice Gavel — general legal information, not legal advice\. Have a lawyer or the court clerk review before filing\.$/);
    // stored form: withheld paragraphs never keep their words, and come back withheld
    const c = checkDraft(draft, allowed);
    const stored = storedText(c.paragraphs);
    expect(stored).toContain(WITHHELD_MARK);
    expect(stored).not.toContain('Smith');
    expect(checkStored(stored, allowed)).toMatchObject({ withheld: 1, kept: 3 });
    expect(fileName('Motion — Dismiss!', 7, 'pdf')).toBe('motion-dismiss-7.pdf');
  });
  test('zip: deflated entries read back byte for byte', async () => {
    const big = 'x'.repeat(5000) + 'é中';
    const z = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: big }]);
    const p = await parts(z);
    expect(p).toEqual({ 'a.txt': 'hello', 'dir/b.txt': big });
    expect(xmlText('a\u0001<b>&"')).toBe('a&lt;b&gt;&amp;&quot;');
  });
  test.each(LANGS)('docx (%s): valid OOXML parts, notice in header + footer, RTL for Arabic', async (lang) => {
    const m = model(lang);
    const p = await parts(docxFromModel(m));
    expect(Object.keys(p).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/header1.xml', 'word/styles.xml']);
    for (const [name, xml] of Object.entries(p)) expect([name, xmlOk(xml)]).toEqual([name, true]);
    expect(p['word/header1.xml']).toContain(xmlText(m.notice));
    expect(p['word/footer1.xml']).toContain(xmlText(m.notice));
    expect(p['word/footer1.xml']).toMatch(/NUMPAGES/);
    expect(p['word/document.xml']).not.toContain('Smith');
    expect(p['word/document.xml']).toContain('<w:headerReference w:type="default" r:id="rId2"/>');
    if (lang === 'ar') { expect(p['word/header1.xml']).toContain('<w:bidi/>'); expect(p['word/document.xml']).toContain('<w:rtl/>'); }
    if (lang === 'en') expect(p['word/document.xml']).toContain('José &lt;Núñez&gt; &amp; Co');
  });
  test.each(LANGS)('pdf (%s): renders with the bundled fonts', async (lang) => {
    const buf = await pdfFromModel(model(lang));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const s = buf.toString('latin1');
    if (lang === 'zh') expect(s).toMatch(/NotoSansSC/);
    if (lang === 'ar') expect(s).toMatch(/DejaVuSansArabic/);
  }, 20_000);
});
