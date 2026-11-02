/**
 * ai/legalCorpus.js — the sourced passages the AI may cite (docs/AI_PLATFORM.md §8).
 *
 * Every passage is content the app already shows with its source:
 *   rights_card   the general rights card, 8 languages (services/rightsContent.js — each section names
 *                 its constitutional source; in-app link RightsCard)
 *   court_guide   "Going to court: how to dress and act", 8 sections × 8 languages, each with the
 *                 official pages it comes from (data/guideCorpus.js, generated from the app)
 *   case_steps    "Your case, step by step", 9 stages × 8 languages (same file)
 *   expungement   the record-clearing rules that passed the legal-accuracy gate
 *                 (routes/expungement/rules.js citationOf(): verified/corrected, citation, source URL)
 *   recording_law the audio-recording consent table (verified/corrected rows with a source URL)
 *   library       legal_documents rows from the research library (services/rag.js), when configured
 *
 * Nothing unsourced is ever a passage: the unreviewed per-state rights summaries, withheld legal
 * tables and anything without a recorded source are left out.
 *
 * Retrieval is lexical (BM25 over words; Chinese by character pairs), in the person's language
 * plus the English-only tables, filtered to the person's state (or the states the question names)
 * and the federal / general content. A passage must share real words with the question — common
 * words are ignored — and score at least RELATIVE_FLOOR of the best match; nothing relevant → [].
 */
import { msg, normalizeLang } from '../i18n/index.js';
import { generalSections, STATE_NAMES, CONTENT_LAST_REVIEWED, normalizeState } from '../services/rightsContent.js';
import { GUIDE_CORPUS } from '../data/guideCorpus.js';
import { STATE_RULES_DATA } from '../routes/expungement/rules_data.js';
import { citationOf } from '../routes/expungement/rules.js';
import { RECORDING_LAWS } from '../routes/recordingLaws_data.js';
import { isWithheld, checkedOn, approvedSource } from './sourceOverlay.js';

export const LANGS = Object.freeze(['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl']);

/** Split a paragraph into sentences (the citable units of a passage). */
export function sentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const parts = s.match(/[^.!?。！？؟]+(?:[.!?。！？؟]+["”»)]*\s*|$)/g) || [s];
  return parts.map((p) => p).filter((p) => p.trim());
}

// ── Passages ─────────────────────────────────────────────────────────────────
const yearOf = (d) => { const m = /^(\d{4})/.exec(String(d || '')); return m ? Number(m[1]) : null; };

function rightsPassages() {
  const out = [];
  for (const lang of LANGS) {
    for (const s of generalSections(lang)) {
      out.push({
        id: `rights.${s.key}.${lang}`, kind: 'rights_card', lang, jurisdiction: 'US',
        title: `${msg(lang, 'ai.cite.kind.rights_card')}: ${s.heading.replace(/^\d+\.\s*/, '')}`,
        publisher: s.source, url: null, checked: CONTENT_LAST_REVIEWED, year: yearOf(CONTENT_LAST_REVIEWED),
        app_link: 'RightsCard', blocks: sentences(s.body), keywords: s.topic.replace(/_/g, ' '),
      });
    }
  }
  return out;
}

function guideSourceList(ids, lang) {
  return ids.map((id) => GUIDE_CORPUS.sources[id]).filter(Boolean).map((s) => ({
    publisher: s.label ? s.label[lang] || s.label.en : `${s.org} — ${s.page}`,
    url: s.url,
  }));
}

function guidePassages() {
  const out = [];
  for (const lang of LANGS) {
    for (const sec of GUIDE_CORPUS.sections) {
      const srcs = guideSourceList(sec.sources, lang);
      out.push({
        id: `guide.${sec.id}.${lang}`, kind: 'court_guide', lang, jurisdiction: 'US',
        title: `${msg(lang, 'ai.cite.kind.court_guide')}: ${sec.title[lang]}`,
        publisher: srcs.map((s) => s.publisher).join('; '), url: srcs.find((s) => s.url)?.url || null,
        also: srcs.filter((s) => s.url).slice(1), checked: GUIDE_CORPUS.checked, year: yearOf(GUIDE_CORPUS.checked),
        app_link: 'CourtGuide', blocks: sec.items[lang].map((t) => t.trim()).filter(Boolean), keywords: 'court courtroom',
      });
    }
    for (const st of GUIDE_CORPUS.stages) {
      const srcs = guideSourceList(st.sources, lang);
      out.push({
        id: `steps.${st.id}.${lang}`, kind: 'case_steps', lang, jurisdiction: 'US',
        title: `${msg(lang, 'ai.cite.kind.case_steps')}: ${st.title[lang]}`,
        publisher: srcs.map((s) => s.publisher).join('; '), url: srcs.find((s) => s.url)?.url || null,
        also: srcs.filter((s) => s.url).slice(1), checked: GUIDE_CORPUS.checked, year: yearOf(GUIDE_CORPUS.checked),
        app_link: 'CaseSteps', blocks: sentences(st.body[lang]), keywords: 'case',
      });
    }
  }
  return out;
}

const EXP_LABEL = {
  misdemeanor: 'misdemeanor conviction', felony: 'felony conviction', dui: 'DUI / DWI conviction',
  dismissed: 'dismissed case or acquittal', domestic: 'domestic violence conviction', sexual: 'sex offense conviction',
};
const EXP_WORDS = {
  misdemeanor: 'misdemeanor', felony: 'felony', dui: 'dui dwi drunk driving owi',
  dismissed: 'dismissed dismissal acquitted acquittal not guilty', domestic: 'domestic violence dv assault', sexual: 'sex offense sexual',
};
// Words people use for clearing a record, in the app's languages (matching only — never cited).
const RECORD_WORDS = 'expunge expungement expunction seal sealing sealed clear clearing record criminal set aside '
  + 'borrar antecedentes expunción expungir sellar limpiar récord registro limpar ficha apagar '
  + 'xóa án tích hồ sơ efase dosye kriminèl 消除 记录 封存 犯罪记录 محو السجل الجنائي burahin rekord';

function expungementPassages() {
  const out = [];
  for (const [code, st] of Object.entries(STATE_RULES_DATA)) {
    for (const cat of Object.keys(EXP_LABEL)) {
      const r = st[cat];
      const cite = r && citationOf(r);
      if (!cite) continue;
      const blocks = [String(r.note || '').trim()].filter(Boolean);
      if (r.waitFrom) blocks.push(`Waiting period runs from: ${String(r.waitFrom).trim()}.`);
      if (st.remedy) blocks.push(`How a record is cleared in ${st.name}: ${String(st.remedy).trim()}.`);
      out.push({
        id: `expungement.${code}.${cat}`, kind: 'expungement', lang: 'en', jurisdiction: code,
        title: `${st.name} — clearing a record: ${EXP_LABEL[cat]} (${cite})`,
        publisher: cite, url: r.source_url, checked: '2026-10-25', year: 2026,
        app_link: 'Expungement', blocks, keywords: `${RECORD_WORDS} ${EXP_WORDS[cat]} ${st.name} ${code}`,
        varies: !!r.varies,
      });
    }
  }
  return out;
}

const RECORDING_WORDS = 'record recording audio video film filming tape consent wiretap eavesdrop police phone call conversation '
  + 'grabar grabación gravar gravação ghi âm quay phim anrejistre filme 录音 录像 تسجيل تصوير i-record pagre-record';

function recordingPassages() {
  const out = [];
  for (const [code, r] of Object.entries(RECORDING_LAWS)) {
    if (!['verified', 'corrected'].includes(r.status) || !r.citation || !/^https?:\/\//.test(r.source_url || '')) continue;
    const name = STATE_NAMES[code] || code;
    out.push({
      id: `recording.${code}`, kind: 'recording_law', lang: 'en', jurisdiction: code,
      title: `${name} — recording conversations and police (${r.citation})`,
      publisher: r.citation, url: r.source_url, checked: '2026-10-25', year: 2026,
      app_link: null, blocks: [r.note, r.police_in_public].map((x) => String(x || '').trim()).filter(Boolean),
      keywords: `${RECORDING_WORDS} ${r.consent} ${name} ${code}`,
    });
  }
  return out;
}

// ── Tokenizing + BM25 ────────────────────────────────────────────────────────
const STOP = new Set((
  'a an the and or but if of to in on at by for with from as is are was were be been being am do does did done have has had '
  + 'i me my we our you your he she it they them their this that these those what which who whom how why when where can could '
  + 'would should will shall may might must not no yes so than then there here about into out up down over just also very '
  + 'get got go going want know tell please help hi hello thanks thank ok okay like need any some all more most much many '
  + 'el la los las un una unos unas y o de del en con por para que qué como cómo es son está están ser mi mis tu su sus yo '
  + 'me te se lo le les al si sí no puedo puede pueden hay muy más ya o um uma uns umas e do da dos das no na nos nas com '
  + 'por para que é são está estão eu meu minha você seu sua ele ela isso este esta posso pode podem tem '
  + 'tôi bạn của và là có không được cho với này khi thì những các một người mình gì sao như thế nào '
  + 'mwen ou li nou yo ak nan pou se ki sa kijan èske gen pa ka mwen an la '
  + 'ako ikaw ka siya kami tayo sila ang ng sa na at ay mga ba ko mo niya ito iyan paano ano bakit kung po opo '
  + 'في من على إلى عن أن هل ما ماذا كيف هذا هذه أنا أنت هو هي نحن هم مع أو لا نعم'
).split(/\s+/));

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const HAN = /[㐀-鿿]/;

/** Words of a text (diacritics folded, stop words dropped); Chinese as character pairs. */
export function tokens(text) {
  const out = [];
  const raw = String(text || '').toLowerCase();
  for (const run of raw.match(/[\p{L}\p{N}]+/gu) || []) {
    if (HAN.test(run)) {
      const chars = [...run].filter((c) => HAN.test(c));
      if (chars.length === 1) out.push(chars[0]);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    const w = fold(run);
    if (w.length < 2 || STOP.has(w) || STOP.has(run)) continue;
    // light suffix folding so "searches" / "searched" meet "search", "charged" meets "charge"
    out.push(w.length > 4 ? w.replace(/(ings|ing|ed|es|s|e)$/, '') : w);
  }
  return out;
}

let INDEX = null;
function buildIndex(extra = []) {
  const docs = [...rightsPassages(), ...guidePassages(), ...expungementPassages(), ...recordingPassages(), ...extra];
  const df = new Map();
  let totalLen = 0;
  const entries = docs.map((d) => {
    const toks = tokens(`${d.title} ${d.title} ${d.publisher || ''} ${d.blocks.join(' ')} ${d.keywords || ''}`);
    totalLen += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { doc: d, tf, len: toks.length };
  });
  return { entries, df, n: entries.length, avgLen: totalLen / Math.max(1, entries.length) };
}
function index() { return INDEX || (INDEX = buildIndex()); }

/** Every passage (tests, docs). */
export function allPassages() { return index().entries.map((e) => e.doc); }

/** States a question names ("in Texas", "TX"): codes. */
export function statesNamed(text) {
  const out = new Set();
  const t = ` ${fold(text)} `;
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (t.includes(` ${fold(name)} `) || t.includes(` ${fold(name)}?`) || t.includes(` ${fold(name)},`) || t.includes(` ${fold(name)}.`)) out.add(code);
    if (new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(String(text || ''))) out.add(code);
  }
  out.delete('IN'); out.delete('ME'); out.delete('OR'); out.delete('OK');   // ordinary words, upper-cased
  for (const code of ['IN', 'ME', 'OR', 'OK']) if (t.includes(` ${fold(STATE_NAMES[code])} `)) out.add(code);
  return out;
}

const ENGLISH_ONLY = new Set(['expungement', 'recording_law', 'library']);
export const RELATIVE_FLOOR = 0.35;
export const MIN_SCORE = 1.2;
export const MIN_COVERAGE = 0.3;

/**
 * Passages relevant to `query`, best first.
 *   retrieve(query, { lang, state, limit, kinds, extra })
 *   lang   the person's language: passages in it, plus the English-only tables
 *   state  the person's state (2 letters) — state tables of other states are left out;
 *          states the question names are included too
 *   extra  library passages (services/rag.js) scored with the rest
 * → [{ ...passage, score }]
 */
export function retrieve(query, { lang = 'en', state = null, limit = 6, kinds = null, extra = [] } = {}) {
  const l = normalizeLang(lang) || 'en';
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const idx = extra.length ? buildIndex(extra) : index();
  const allowed = new Set([normalizeState(state), ...statesNamed(query)].filter(Boolean));
  const k1 = 1.4, b = 0.75;
  const idfOf = (t) => { const df = idx.df.get(t) || 0; return Math.log(1 + (idx.n - df + 0.5) / (df + 0.5)); };
  // Coverage counts the words the corpus knows: a word no passage has (a name, a typo, "tomorrow")
  // says nothing about relevance. Retrieval is deliberately lenient — the safety is downstream:
  // every citation is verified and uncited legal statements are withheld (ai/citations.js).
  const known = q.filter((t) => idx.df.get(t));
  if (!known.length) return [];
  const totalIdf = known.reduce((a, t) => a + idfOf(t), 0) || 1;
  const scored = [];
  for (const e of idx.entries) {
    const d = e.doc;
    if (kinds && !kinds.includes(d.kind)) continue;
    // the person's language; the English-only tables (and the library) for everyone
    if (d.lang !== l && !(d.lang === 'en' && ENGLISH_ONLY.has(d.kind))) continue;
    if (d.jurisdiction && !['US', 'federal', null].includes(d.jurisdiction) && d.kind !== 'library') {
      if (!allowed.has(d.jurisdiction)) continue;
    }
    if (d.kind === 'library' && d.jurisdiction && !['US', 'federal'].includes(d.jurisdiction) && allowed.size && !allowed.has(d.jurisdiction)) continue;
    let score = 0, matched = 0, matchedIdf = 0;
    for (const t of q) {
      const f = e.tf.get(t);
      if (!f) continue;
      matched += 1;
      const idf = idfOf(t);
      matchedIdf += idf;
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (e.len / idx.avgLen)));
    }
    if (!matched) continue;
    // Source re-checks (ai/sourceOverlay.js): a row an admin withheld is never a passage; the
    // checked date / an admin-approved official source follow the latest check.
    const ov = overlayKey(d.id);
    if (ov && isWithheld(ov[0], ov[1])) continue;
    scored.push({ ...d, ...(ov ? { checked: checkedOn(ov[0], ov[1], d.checked), url: approvedSource(ov[0], ov[1]) || d.url } : {}), score, coverage: matchedIdf / totalIdf });
  }
  scored.sort((a, b2) => b2.score - a.score);
  // Relevant = the best passage carries a fair share of the question's known words (by rarity)
  // and a real score.
  if (!scored.length || scored[0].score < MIN_SCORE || scored[0].coverage < MIN_COVERAGE) return [];
  const floor = Math.max(MIN_SCORE, scored[0].score * RELATIVE_FLOOR);
  return scored.filter((d) => d.score >= floor && d.coverage >= MIN_COVERAGE / 2).slice(0, limit);
}

/** passage id → [dataset, key] in the source-check overlay (expungement / recording rows). */
function overlayKey(id) {
  const m = /^(expungement)\.([A-Z]{2}\.[a-z]+)$/.exec(String(id || '')) || /^(recording)\.([A-Z]{2})$/.exec(String(id || ''));
  return m ? [m[1], m[2]] : null;
}

/** Drop the cached index (tests that change the data). */
export function resetCorpusIndex() { INDEX = null; }
