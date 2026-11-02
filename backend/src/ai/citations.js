/**
 * ai/citations.js — citable sources in, verified cited answers out (docs/AI_PLATFORM.md §8).
 *
 * Request side — https://platform.claude.com/docs/en/build-with-claude/search-results (read 2026-11-02):
 *   retrieved passages go to Claude as top-level `search_result` blocks in the user turn
 *     { type: 'search_result', source, title, content: [{ type: 'text', text }…], citations: { enabled: true } }
 *   (no beta header; all active models but Haiku 3; citations all-or-none per request; only in user
 *   messages). We use search results rather than `document` blocks
 *   (https://platform.claude.com/docs/en/build-with-claude/citations, read 2026-11-02) because the
 *   docs name them for RAG / retrieved passages: each citation carries our own `source` id and
 *   title, and our passages are already split into the sentences / items we want cited
 *   (a whole text block is the smallest citable unit).
 *   Citations + structured outputs (`output_config.format`) → 400, so a cited answer is always
 *   prose; the gateway refuses to build such a request (services/aiClient.js buildRequest).
 *
 * Response side: text blocks carry `citations: [{ type: 'search_result_location', source, title,
 *   cited_text, search_result_index, start_block_index, end_block_index }]` (streams:
 *   `citations_delta` inside content_block_delta). verifyCitation() accepts a citation only when
 *   it points at a search result WE sent (index in range, same source id, same title, block
 *   range inside the passage, cited_text equal to those blocks); everything else is dropped and
 *   counted. The passage the person sees on tap is our stored text, never the model's copy.
 *
 * Owner rule (docs/LEGAL_ACCURACY_REVIEW.md): a legal rule, number, deadline or verdict is shown
 * only with a named source. So a part of the answer with no (verified) citation is shown only
 * when it makes no legal statement (looksLegal() — a deliberately broad, 8-language check);
 * otherwise it is replaced by the marker "No source found for this part — not shown" and never
 * reaches the person, the history or an export.
 */
import { msg } from '../i18n/index.js';

export const SOURCE_PREFIX = 'jg:';

/** search_result blocks for passages (ai/legalCorpus.js shape). */
export function toSearchResults(passages) {
  return passages.map((p) => ({
    type: 'search_result',
    source: `${SOURCE_PREFIX}${p.id}`,
    title: String(p.title).slice(0, 300),
    content: p.blocks.map((t) => ({ type: 'text', text: String(t) })),
    citations: { enabled: true },
  }));
}

/** What we keep about a passage we sent (stored with the question, so history can be rebuilt). */
export function sentRecord(p) {
  return {
    id: p.id, kind: p.kind, lang: p.lang, title: String(p.title).slice(0, 300), jurisdiction: p.jurisdiction ?? null,
    year: p.year ?? null, url: p.url ?? null, publisher: p.publisher ?? null, checked: p.checked ?? null,
    app_link: p.app_link ?? null, also: Array.isArray(p.also) ? p.also : [], blocks: p.blocks.map(String),
  };
}

/** The search_result block for a stored record — identical to the one first sent (cache prefix). */
export function recordToSearchResult(r) {
  return toSearchResults([r])[0];
}

// ── Legal-statement check (for parts of an answer without a citation) ─────────
const PHONE = /\b(?:911|988)\b|\b1?[-. (]*\d{3}[-. )]*\d{3}[-. ]*\d{4}\b|\b\d{5}\b(?=\D*(?:text|texto|SMS))/gi;
const LATIN_TERMS = [
  // en
  'law', 'laws', 'legal', 'legally', 'illegal', 'unlawful', 'lawful', 'statute', 'statutes', 'constitution', 'constitutional', 'amendment',
  'rights', 'right to', 'must', 'required', 'requires', 'allowed', 'permitted', 'prohibited', 'forbidden', 'eligible', 'eligibility',
  'expunge', 'expunged', 'expungement', 'sealed', 'sealing', 'deadline', 'penalty', 'penalties', 'fined', 'sentence', 'sentenced',
  'jail', 'prison', 'felony', 'misdemeanor', 'bail', 'bond', 'warrant', 'probable cause', 'search', 'consent', 'miranda',
  'plea', 'guilty', 'convicted', 'conviction', 'charged', 'charges', 'arrest', 'arrested', 'judge', 'appeal', 'probation',
  'parole', 'court-appointed', 'free lawyer', 'entitled',
  // es
  'ley', 'leyes', 'ilegal', 'derecho', 'derechos', 'debe', 'deben', 'obligatorio', 'requisito', 'plazo', 'multa', 'sentencia',
  'carcel', 'prision', 'delito', 'fianza', 'orden de arresto', 'orden judicial', 'registrar', 'consentimiento', 'culpable', 'condena',
  'cargos', 'arresto', 'juez', 'apelacion', 'elegible', 'antecedentes', 'libertad condicional',
  // pt
  'lei', 'leis', 'direito', 'direitos', 'obrigatorio', 'prazo', 'cadeia', 'prisao', 'crime', 'fianca', 'mandado',
  'culpado', 'condenacao', 'acusacao',
  // vi (diacritics folded)
  'luat', 'phap luat', 'hop phap', 'bat hop phap', 'quyen', 'phai', 'bat buoc', 'thoi han', 'tien phat', 'nha tu', 'pham toi', 'tai ngoai',
  'bao lanh', 'lenh', 'kham xet', 'co toi', 'ket an', 'cao buoc', 'bat giu', 'tham phan', 'khang cao', 'xoa an tich',
  // ht
  'lwa', 'dwa', 'dwe', 'oblije', 'dele', 'amann', 'santans', 'prizon', 'krim', 'kosyon', 'manda', 'fouye', 'konsantman',
  'koupab', 'kondanasyon', 'akizasyon', 'arete', 'jij', 'apel',
  // tl
  'batas', 'karapatan', 'dapat', 'kailangan', 'kinakailangan', 'multa', 'sentensiya', 'kulungan', 'bilangguan', 'krimen',
  'piyansa', 'halughog', 'pahintulot', 'nagkasala', 'hatol', 'kaso', 'paratang', 'aresto', 'hukom', 'apela',
];
const LATIN_RE = new RegExp(`(?<![\\p{L}])(?:${LATIN_TERMS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![\\p{L}])`, 'iu');
const ZH_RE = /法律|法规|法例|合法|非法|违法|权利|有权|必须|应当|期限|罚款|判决|判刑|监狱|坐牢|拘留|重罪|轻罪|保释|搜查|逮捕|同意|有罪|定罪|指控|法官|上诉|封存|消除记录|资格|宪法|缓刑|假释/;
const AR_RE = /قانون|قانوني|حق|حقوق|يجب|إلزامي|مهلة|غرامة|حكم|سجن|جناية|جنحة|كفالة|مذكرة|تفتيش|موافقة|مذنب|إدانة|تهمة|اعتقال|القبض|قاض|استئناف|محو السجل|دستور|إفراج مشروط/;
const SYMBOLS = /[§$¢€]|\bU\.?S\.?C\b|\bC\.?F\.?R\b/i;

const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');

// Referrals the app itself makes everywhere ("your rights card", "a legal aid office") are not
// legal statements; they are removed before the check.
const SAFE_PHRASES = /rights card|legal aid|tarjeta de derechos|ayuda legal|cart[aã]o de direitos|assist[eê]ncia jur[ií]dica|th[eẻ] quy[eề]n|tr[oợ] gi[uú]p ph[aá]p l[yý]|kat dwa|[eè]d legal|权利卡|法律援助|بطاقة الحقوق|المساعدة القانونية/giu;

/** Does this text make (or look like it makes) a legal statement? Errs on the side of yes. */
export function looksLegal(text) {
  const raw = String(text || '').replace(SAFE_PHRASES, ' ');
  const noPhones = raw.replace(PHONE, ' ');
  if (/\d/.test(noPhones)) return true;                     // numbers: deadlines, amounts, sections
  if (SYMBOLS.test(raw)) return true;
  if (ZH_RE.test(raw) || AR_RE.test(raw)) return true;
  return LATIN_RE.test(fold(raw));
}

// ── Verifying citations ───────────────────────────────────────────────────────
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * A citation from the response → { ok: true, index, start, end } or { ok: false, reason }.
 * `sent` is the list of stored records in request order (search_result_index counts every
 * search_result block in the request, across all messages — the docs).
 */
export function verifyCitation(c, sent) {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'not_an_object' };
  if (c.type !== 'search_result_location') return { ok: false, reason: `type:${String(c.type).slice(0, 40)}` };
  const i = c.search_result_index;
  if (!Number.isInteger(i) || i < 0 || i >= sent.length) return { ok: false, reason: 'index_out_of_range' };
  const rec = sent[i];
  if (c.source !== `${SOURCE_PREFIX}${rec.id}`) return { ok: false, reason: 'source_mismatch' };
  if (c.title != null && norm(c.title) !== norm(String(rec.title).slice(0, 300))) return { ok: false, reason: 'title_mismatch' };
  const s = c.start_block_index, e = c.end_block_index;
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > rec.blocks.length) return { ok: false, reason: 'block_range' };
  const passage = rec.blocks.slice(s, e).join('');
  if (c.cited_text != null && norm(c.cited_text) && !norm(passage).includes(norm(c.cited_text))) return { ok: false, reason: 'cited_text_mismatch' };
  return { ok: true, index: i, start: s, end: e, passage };
}

/**
 * Builds a sourced answer block by block (streams: one call per finished text block; the
 * non-streamed path feeds every block). add() returns what became visible: [{ segment, sources }]
 * — `sources` are the ones first used by that segment. Consecutive withheld parts collapse into
 * one marker.
 *   result() → { grounded: true, segments: [{ text, cites: [n…] } | { withheld: true }],
 *     sources: [{ n, id, kind, title, jurisdiction, year, url, publisher, checked, app_link, also,
 *     passage }], dropped, dropReasons, withheld, cited }
 * Thinking / fallback blocks are skipped. Sources are numbered in order of first use.
 */
export class CitedAssembler {
  constructor(sent, { strict = true } = {}) {
    this.sent = sent; this.strict = strict;
    this.segments = []; this.sources = []; this.byKey = new Map();
    this.dropped = 0; this.withheld = 0; this.cited = 0; this.dropReasons = {};
  }

  add(b) {
    if (b?.type !== 'text' || typeof b.text !== 'string' || !b.text) return [];
    const cites = [];
    const fresh = [];
    for (const c of Array.isArray(b.citations) ? b.citations : []) {
      const v = verifyCitation(c, this.sent);
      if (!v.ok) { this.dropped += 1; this.dropReasons[v.reason] = (this.dropReasons[v.reason] || 0) + 1; continue; }
      const key = `${v.index}:${v.start}:${v.end}`;
      let n = this.byKey.get(key);
      if (!n) {
        const r = this.sent[v.index];
        n = this.sources.length + 1;
        this.byKey.set(key, n);
        const src = {
          n, id: r.id, kind: r.kind, title: r.title, jurisdiction: r.jurisdiction, year: r.year, url: r.url,
          publisher: r.publisher, checked: r.checked, app_link: r.app_link, also: r.also || [], passage: v.passage,
        };
        this.sources.push(src);
        fresh.push(src);
      }
      if (!cites.includes(n)) cites.push(n);
    }
    if (cites.length) {
      this.cited += 1;
      const segment = { text: b.text, cites };
      this.segments.push(segment);
      return [{ segment, sources: fresh }];
    }
    if (this.strict && looksLegal(b.text)) {
      this.withheld += 1;
      if (this.segments.length && this.segments[this.segments.length - 1].withheld) return [];
      const segment = { withheld: true };
      this.segments.push(segment);
      return [{ segment, sources: [] }];
    }
    const segment = { text: b.text, cites: [] };
    this.segments.push(segment);
    return [{ segment, sources: [] }];
  }

  result() {
    return {
      grounded: true, segments: this.segments, sources: this.sources, dropped: this.dropped,
      dropReasons: this.dropReasons, withheld: this.withheld, cited: this.cited,
    };
  }
}

/** The response's content blocks → a sourced answer (CitedAssembler.result()). */
export function buildCitedAnswer(content, sent, opts = {}) {
  const a = new CitedAssembler(sent, opts);
  for (const b of Array.isArray(content) ? content : []) a.add(b);
  return a.result();
}

const SENTENCE = /[^.!?。！？؟\n]*(?:[.!?。！？؟]+["”»)]*\s+|\n+)/g;

/**
 * An answer given without sources (no legal passage matched a non-legal question), sentence by
 * sentence; a sentence that makes a legal statement is withheld (it has no source).
 * push(text) / end() return what became visible: [{ segment, sources: [] }].
 */
export class SentenceAssembler {
  constructor() { this.buf = ''; this.segments = []; this.withheld = 0; }

  take(p) {
    if (!p) return [];
    if (p.trim() && looksLegal(p)) {
      this.withheld += 1;
      if (this.segments.length && this.segments[this.segments.length - 1].withheld) return [];
      const segment = { withheld: true };
      this.segments.push(segment);
      return [{ segment, sources: [] }];
    }
    const segment = { text: p, cites: [] };
    this.segments.push(segment);
    return [{ segment, sources: [] }];
  }

  push(text) {
    this.buf += String(text || '');
    const out = [];
    let m, last = 0;
    SENTENCE.lastIndex = 0;
    while ((m = SENTENCE.exec(this.buf)) && m[0]) { out.push(...this.take(m[0])); last = SENTENCE.lastIndex; }
    this.buf = this.buf.slice(last);
    return out;
  }

  end() { const rest = this.buf; this.buf = ''; return this.take(rest); }

  result() {
    return { grounded: false, segments: this.segments, sources: [], dropped: 0, dropReasons: {}, withheld: this.withheld, cited: 0 };
  }
}

export function buildUncitedAnswer(text) {
  const a = new SentenceAssembler();
  a.push(text); a.end();
  return a.result();
}

/** The canned answer when nothing relevant was found (no model call). kind: 'chat' | 'research'. */
export function nothingFoundAnswer(lang, kind = 'chat') {
  return {
    grounded: true, nothing_found: true,
    segments: [{ text: msg(lang, kind === 'research' ? 'ai.cite.nothing_found_research' : 'ai.cite.nothing_found'), cites: [] }],
    sources: [], dropped: 0, dropReasons: {}, withheld: 0, cited: 0,
  };
}

/** Has the answer anything left to show? */
export function visibleText(answer) {
  return (answer?.segments || []).filter((s) => !s.withheld).map((s) => s.text).join('').trim();
}

/**
 * Plain text of an answer.
 *   markers: true → "text [1] … [No source found for this part — not shown]" + a numbered source
 *   list (for clients that only show text); false → the visible words only (stored in `content`,
 *   sent back as conversation history).
 */
export function plainText(answer, lang = 'en', { markers = true } = {}) {
  const out = [];
  for (const s of answer?.segments || []) {
    if (s.withheld) { if (markers) out.push(` ${msg(lang, 'ai.cite.withheld')} `); continue; }
    out.push(s.text);
    if (markers && s.cites?.length) out.push(s.cites.map((n) => `[${n}]`).join(''));
  }
  let text = out.join('').replace(/[ \t]{2,}/g, ' ').trim();
  if (markers && answer?.sources?.length) {
    const list = answer.sources.map((s) => `[${s.n}] ${s.title}${s.url ? ` — ${s.url}` : ''}`).join('\n');
    text += `\n\n${msg(lang, 'ai.cite.sources')}\n${list}`;
  }
  return text;
}

/** What is stored / returned for the app: the answer without internal counters. */
export function publicAnswer(answer) {
  if (!answer) return null;
  return {
    grounded: !!answer.grounded,
    nothing_found: !!answer.nothing_found,
    no_source: !!answer.no_source,
    segments: answer.segments.map((s) => (s.withheld ? { withheld: true } : { text: s.text, cites: s.cites || [] })),
    sources: answer.sources,
    withheld: answer.withheld || 0,
    dropped: answer.dropped || 0,
  };
}

/**
 * The rules added to the system prompt when sources are attached (cached with the prompt: the
 * text is the same for every request).
 */
export const CITATION_RULES = `SOURCES RULES (Justice Gavel gives legal information only with a source):
- When the person's message comes with search results, every legal statement you make (a right, a rule, a procedure, a deadline, a number, an eligibility verdict, what police, courts or the law can or must do) must come from those search results and be cited from them. Use the search results only — not your own memory — for anything legal.
- If the search results do not answer part of the question, say plainly that you could not find a source for that part, and suggest a legal aid office, a public defender or the app's rights card. Do not fill the gap from memory.
- If a search result is from a different state than the person's, say so.
- Parts of your answer that are not legal statements (a kind word, a next step in the app, a question back) need no citation.
- Do not add a legal-notice footer, a disclaimer or a list of sources: the app shows them under every answer.`;
