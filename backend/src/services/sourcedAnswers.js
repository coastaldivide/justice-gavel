/**
 * services/sourcedAnswers.js — legal answers that trace to a source (chat + research).
 *
 *   planSources({ question, lang, state, history, extra, limit, legal })
 *       → { mode: 'grounded' | 'nothing_found' | 'plain', fresh: [passage], sentBefore: [record] }
 *   userTurn(text, passages)        the user message: search_result blocks, then the question
 *   historyMessages(rows)           stored turns → messages, rebuilt exactly as first sent
 *   finishAnswer({ mode, content, text, sent, lang, kind })   → sourced answer (ai/citations.js)
 *
 * Modes:
 *   grounded       relevant sourced passages were found: they go to Claude as citable search
 *                  results after the cached system prompt; the answer is verified citation by
 *                  citation, uncited legal statements are withheld.
 *   nothing_found  the question is a legal one and nothing relevant was found: no model call —
 *                  the person is told so and pointed to legal aid / the rights card (never an
 *                  answer from model memory).
 *   plain          not a legal question (app help, a kind word, scheduling): asked without
 *                  sources; any sentence that still makes a legal statement is withheld.
 * Passages already sent earlier in the conversation are not sent again (their blocks are in the
 * history, and citations to them stay valid).
 */
import { retrieve } from '../ai/legalCorpus.js';
import {
  toSearchResults, sentRecord, recordToSearchResult, looksLegal, buildCitedAnswer, buildUncitedAnswer,
  nothingFoundAnswer, visibleText, CitedAssembler, SentenceAssembler,
} from '../ai/citations.js';

const LEGAL_INTENT = /arrest|bail|bond|charge|warrant|court|judge|lawyer|attorney|rights?\b|police|search|jail|prison|expung|seal|record|probation|parole|plea|sentence|felony|misdemeanor|dui|dwi|deport|ice\b|immigra|custody|divorce|evict|statute|law\b/i;

/** Is this a legal-information question? (broad — a false yes only means "find a source first") */
export function isLegalQuestion(text) {
  return looksLegal(text) || LEGAL_INTENT.test(String(text || ''));
}

export function planSources({ question, lang = 'en', state = null, history = [], extra = [], limit = 6, legal = null }) {
  const sentBefore = [];
  for (const h of history) for (const r of h?.ai_sent?.sources || []) sentBefore.push(r);
  // `extra` = library passages already judged relevant by the library's own search (similarity
  // floor): kept first; the app's sourced content fills the rest by lexical relevance.
  const pinned = extra.slice(0, Math.max(0, limit - 2));
  const own = retrieve(question, { lang, state, limit: Math.max(2, limit - pinned.length) });
  const hits = [...pinned, ...own.filter((p) => !pinned.some((x) => x.id === p.id))];
  const seen = new Set(sentBefore.map((r) => r.id));
  const fresh = hits.filter((p) => !seen.has(p.id));
  if (hits.length) return { mode: 'grounded', fresh, sentBefore, hits };
  const isLegal = legal ?? isLegalQuestion(question);
  if (isLegal) return { mode: 'nothing_found', fresh: [], sentBefore, hits };
  // A follow-up in a conversation that already has sources stays grounded on them.
  if (sentBefore.length) return { mode: 'grounded', fresh: [], sentBefore, hits };
  return { mode: 'plain', fresh: [], sentBefore, hits };
}

/** The user message: the passages (citable), then the question. */
export function userTurn(text, records) {
  if (!records?.length) return { role: 'user', content: text };
  return { role: 'user', content: [...records.map(recordToSearchResult), { type: 'text', text }] };
}

/**
 * Stored turns ({ role, content, ai_sent }) → messages. A user turn that was sent with sources is
 * rebuilt from ai_sent (same text, same search_result blocks), so the request prefix is
 * byte-identical to the earlier one (prompt cache) and its search_result indexes still line up.
 */
export function historyMessages(rows) {
  const out = [];
  for (const h of rows) {
    if (h.role === 'user' && h.ai_sent && typeof h.ai_sent.text === 'string') {
      out.push(userTurn(h.ai_sent.text, h.ai_sent.sources || []));
    } else if (String(h.content ?? '').trim()) {
      // (an answer with nothing visible left — all withheld, then stopped — is not resent: the API rejects empty text)
      out.push({ role: h.role, content: String(h.content) });
    }
  }
  // The API needs alternating turns ending with an assistant turn before the new question.
  while (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

/** Every record sent in a request, in request order (search_result_index order). */
export function sentInOrder(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b?.type === 'search_result') out.push(b);
  }
  return out;
}

/** Stored records for passages (fresh ones of this turn). */
export function recordsFor(passages) {
  return passages.map(sentRecord);
}

/**
 * The model's answer → the sourced answer the person sees (and that is stored).
 *   mode 'grounded': content blocks + every record sent (history first, then this turn)
 *   mode 'plain':    the text, sentence by sentence
 */
export function finishAnswer({ mode, content, text, sent, lang = 'en', kind = 'chat' }) {
  if (mode === 'nothing_found') return nothingFoundAnswer(lang, kind);
  const answer = mode === 'grounded' ? buildCitedAnswer(content, sent) : buildUncitedAnswer(text);
  return finishAssembled(answer, { mode, lang, kind });
}

/**
 * A streamed answer, shown only after checking: grounded answers block by block (each block's
 * citations verified first), plain answers sentence by sentence.
 *   const s = streamAnswer({ mode, sent });
 *   stream.read(s.onText, { onBlock: s.onBlock })   — both call emit({ segment, sources }) per visible part
 *   s.end(); s.result() → the sourced answer so far (finishAnswer rules applied by the caller)
 */
export function streamAnswer({ mode, sent }, emit) {
  const cited = mode === 'grounded' ? new CitedAssembler(sent) : null;
  const plain = cited ? null : new SentenceAssembler();
  const out = (list) => { for (const e of list) emit(e); };
  return {
    onText: (t) => { if (plain) out(plain.push(t)); },
    onBlock: (b) => { if (cited) out(cited.add(b)); },
    end: () => { if (plain) out(plain.end()); },
    result: () => (cited ? cited.result() : plain.result()),
  };
}

/** finishAnswer() for an answer already assembled (streams). */
export function finishAssembled(answer, { mode, lang = 'en', kind = 'chat' }) {
  if (mode === 'nothing_found') return nothingFoundAnswer(lang, kind);
  if (!visibleText(answer)) return { ...nothingFoundAnswer(lang, kind), withheld: answer.withheld, dropped: answer.dropped };
  if (mode === 'grounded' && answer.cited === 0 && answer.withheld > 0) answer.no_source = true;
  return answer;
}

export { toSearchResults };
