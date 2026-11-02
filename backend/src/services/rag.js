import { aiMessage } from './aiClient.js';
import { sentences } from '../ai/legalCorpus.js';
import { CITATION_RULES } from '../ai/citations.js';
import { planSources, userTurn, historyMessages, sentInOrder, recordsFor, finishAnswer } from './sourcedAnswers.js';
import { recapPrompt } from './conversationMemory.js';

// External fetch with 15s timeout (embeddings + Anthropic can be slow)
// Embedding model: Supabase gte-small (384 dimensions, no API key needed)
// Schema uses vector(384) — if switching to OpenAI ada-002, change to vector(1536)
async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * services/rag.js — Retrieval-Augmented Generation for Legal Research
 *
 * Pipeline:
 *   1. User asks a legal research question
 *   2. Generate embedding for query (Supabase gte-small, free, no API key)
 *   3. Hybrid search: semantic (pgvector cosine) + keyword (pg_trgm)
 *   4. The relevant chunks (similarity ≥ RAG_MIN_SIMILARITY, with a citation) plus the app's sourced
 *      content (ai/legalCorpus.js) passed to Claude as citable search_result blocks
 *   5. Claude answers citing ONLY those passages; every citation is checked against what was sent
 *      and uncited legal statements are withheld (ai/citations.js)
 *   6. Nothing relevant → no model call: the person is told no source was found
 *   7. Response includes the verified citations with year, jurisdiction, source URL and the passage
 *
 * Uses Supabase Edge Functions for embeddings (no OpenAI key required):
 *   POST /functions/v1/embed  { input: string } → { embedding: float[] }
 */

import logger from '../utils/logger.js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const EMBED_URL        = `${SUPABASE_URL}/functions/v1/embed`;
const SUPABASE_REST    = `${SUPABASE_URL}/rest/v1/rpc/search_legal_docs`;

// ── Step 1: Embed the user query ───────────────────────────────────────────
async function embedQuery(text) {
  const res = await fetchWithTimeout(EMBED_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey':        SUPABASE_KEY,
    },
    body: JSON.stringify({ input: text.slice(0, 512) }),
  });
  if (!res.ok) throw new Error(`Embed error ${res.status}`);
  const { embedding } = await res.json();
  return embedding; // float[]
}

// ── Step 2: Retrieve relevant legal documents ──────────────────────────────
async function retrieveDocs(embedding, queryText, { practiceArea, jurisdiction } = {}) {
  const res = await fetchWithTimeout(SUPABASE_REST, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey':        SUPABASE_KEY,
    },
    body: JSON.stringify({
      query_embedding: embedding,
      query_text:      queryText,
      practice_filter: practiceArea || null,
      juris_filter:    jurisdiction  || null,
      match_count:     8,
    }),
  });
  if (!res.ok) {
    logger.warn('[rag] doc retrieval failed:', res.status);
    return [];
  }
  return res.json(); // [{citation, title, content, similarity, ...}]
}

// ── Step 3: library rows → citable passages ─────────────────────────────────
/** RAG_MIN_SIMILARITY (default 0.35): library rows below it are not relevant enough to send. */
export function minSimilarity() {
  const n = Number(String(process.env.RAG_MIN_SIMILARITY ?? '').trim());
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.35;
}

/**
 * legal_documents rows → passages (ai/legalCorpus.js shape). Only rows with a citation are
 * citable (a legal statement must name its source); the text is split into sentences so a
 * citation points at the exact sentence.
 */
export function libraryPassages(docs = []) {
  return docs
    .filter((d) => d && typeof d.citation === 'string' && d.citation.trim() && typeof d.content === 'string' && d.content.trim())
    .filter((d) => d.similarity == null || Number(d.similarity) >= minSimilarity())
    .map((d) => ({
      id: `lib.${d.id ?? d.citation}`, kind: 'library', lang: 'en',
      title: `${String(d.citation).trim()}${d.title ? ` — ${String(d.title).trim()}` : ''}`.slice(0, 300),
      jurisdiction: d.jurisdiction || null, year: Number.isInteger(d.year) ? d.year : (Number(d.year) || null),
      url: typeof d.source_url === 'string' && /^https?:\/\//.test(d.source_url) ? d.source_url : null,
      publisher: String(d.citation).trim(), checked: null, app_link: null,
      blocks: sentences(String(d.content).slice(0, 2400)), keywords: `${d.title || ''} ${d.practice_area || ''}`,
      similarity: d.similarity ?? null,
    }))
    .filter((p) => p.blocks.length);
}

/** The research library's matches (Supabase legal_documents), or [] when it is not configured / down. */
export async function findLibrary(query, opts = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const embedding = await embedQuery(query);
    return libraryPassages(await retrieveDocs(embedding, query, opts));
  } catch (err) {
    logger.warn('[rag] library search failed — answering from the app\'s sourced content only:', err?.message);
    return [];
  }
}

// ── Step 4: the sourced research answer ───────────────────────────────────
/**
 * One research question, answered only from sources.
 *   sourcedResearch({ query, history, lang, context, jurisdiction, practiceArea, userId, task, route, system })
 *   → { mode, answer (ai/citations.js sourced answer), sent: { text, sources }, docsUsed, libraryUsed }
 * Library passages (when the library is configured) and the app's sourced content (legal tables,
 * rights card, court guide, case steps — ai/legalCorpus.js) go to Claude as citable search
 * results after the cached instructions. Nothing relevant → no model call (mode nothing_found).
 */
export async function sourcedResearch({ query, history = [], lang = 'en', context = '', jurisdiction = null, practiceArea = null, userId = null, task = 'research', route = task, system, prepare = null }) {
  const library = await findLibrary(query, { practiceArea, jurisdiction });
  // AI step 5: a long research conversation sends its recap + the recent turns
  // (services/conversationMemory.js); `prepare(build)` returns the history to use.
  if (prepare) {
    const build = (rows, recap) => researchRequest({ query, history: rows, lang, context, jurisdiction, library, task, system, recap });
    const prepared = await prepare(build);
    return await answerResearch(prepared.request, { lang, route, userId });
  }
  return await answerResearch(researchRequest({ query, history, lang, context, jurisdiction, library, task, system }), { lang, route, userId });
}

/** The research request (pure): the plan, the messages, the citable records in request order. */
export function researchRequest({ query, history, lang, context, jurisdiction, library, task, system, recap = null }) {
  const plan = planSources({ question: query, lang, state: jurisdiction, history, extra: library, limit: 8, legal: true });
  const fresh = recordsFor(plan.fresh);
  const text = (context ? `[Case: ${context}]\n\n` : '') + query;
  const sent = { text, sources: fresh };
  const messages = [...historyMessages(history), userTurn(text, fresh)];
  const records = [...plan.sentBefore, ...fresh];
  const byId = new Map(records.map((r) => [`jg:${r.id}`, r]));
  const order = sentInOrder(messages).map((b) => byId.get(b.source)).filter(Boolean);
  const recapText = recapPrompt(recap);
  const sys = recapText && Array.isArray(system) ? [...system, { text: recapText }] : system;
  return { task, system: sys, messages, mode: plan.mode, sent, fresh, order };
}

async function answerResearch(req, { lang, route, userId }) {
  const { task, system, messages, sent, fresh, order } = req;
  if (req.mode === 'nothing_found') {
    return { mode: req.mode, answer: finishAnswer({ mode: req.mode, lang, kind: 'research' }), sent, docsUsed: 0, libraryUsed: 0 };
  }
  const plan = { mode: req.mode };
  // Routing (class 'deep'), caching, budget, timeout/retries, refusals, metering: aiClient.
  const out = await aiMessage({
    task, system, messages, cacheConversation: true, route, userId, timeoutMs: 100_000, retries: 1,
  });
  const answer = finishAnswer({ mode: plan.mode, content: out.content, text: out.text, sent: order, lang, kind: 'research' });
  if (answer.dropped) logger.warn({ route, dropped: answer.dropped, reasons: answer.dropReasons }, '[rag] citations to sources we did not send were dropped');
  return { mode: plan.mode, answer, sent, docsUsed: fresh.length, libraryUsed: fresh.filter((r) => r.kind === 'library').length };
}

/** The research instructions for POST /research/rag (the stable, cached part). */
export const RAG_SYSTEM_GROUNDED = `You are a legal research assistant. Each question comes with search results: passages from a legal research library and from Justice Gavel's checked legal information, each titled with its citation and jurisdiction.

Instructions:
- Answer only from the search results, and cite every legal statement from them
- If a search result is from a different jurisdiction than asked, note that
- If the search results do not fully answer the question, say so plainly — do not fabricate or complete case law from memory
- Do not add a disclaimer or a source list: the app shows them under every answer

${CITATION_RULES}`;

/**
 * POST /research/rag — one stateless sourced answer.
 * @returns {{ answer, citations, docsUsed, fromRAG, latencyMs, mode }}
 */
export async function ragSearch(query, opts = {}) {
  const t0 = Date.now();
  const lang = opts.lang || 'en';
  const r = await sourcedResearch({
    query, lang, jurisdiction: opts.jurisdiction || null, practiceArea: opts.practiceArea || null,
    userId: opts.userId ?? null, task: 'research_rag', route: 'research_rag',
    system: [{ text: RAG_SYSTEM_GROUNDED, cache: '5m' }, { text: opts.languageLine || '' }],
  });
  logger.info('[rag] query complete', { docsSent: r.docsUsed, library: r.libraryUsed, mode: r.mode, cited: r.answer.sources.length, latencyMs: Date.now() - t0 });
  return {
    answer: r.answer,
    citations: r.answer.sources,
    docsUsed: r.docsUsed,
    fromRAG: r.libraryUsed > 0,
    mode: r.mode,
    latencyMs: Date.now() - t0,
  };
}

// ── Seed utility: add a legal document to the index ─────────────────────
export async function indexLegalDocument({
  docType, citation, title, content,
  jurisdiction, practiceArea, year, sourceUrl
}) {
  try {
    const embedding = await embedQuery(`${title}. ${content.slice(0, 400)}`);

    const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/legal_documents`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey':        SUPABASE_KEY,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        doc_type:      docType,
        citation,
        title,
        content:       content.slice(0, 8000),
        jurisdiction,
        practice_area: practiceArea,
        year,
        embedding,
        token_count:   Math.ceil(content.length / 4),
        source_url:    sourceUrl || null,
      }),
    });
    if (!res.ok) throw new Error(`Insert error ${res.status}: ${await res.text()}`);
    return res.json();
  } catch (err) {
    logger.error('[rag] indexLegalDocument failed:', err?.message);
    throw err;
  }
}
