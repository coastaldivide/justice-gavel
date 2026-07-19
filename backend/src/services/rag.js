
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
 *   4. Top-8 chunks passed to Claude as grounded context
 *   5. Claude answers citing ONLY retrieved documents
 *   6. Response includes citations with year, jurisdiction, source URL
 *
 * Uses Supabase Edge Functions for embeddings (no OpenAI key required):
 *   POST /functions/v1/embed  { input: string } → { embedding: float[] }
 */

import logger from '../utils/logger.js';
import { getBreaker as withBreaker } from '../utils/circuitBreaker.js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
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

// ── Step 3: Build grounded prompt for Claude ───────────────────────────────
function buildRAGPrompt(userQuery, docs) {
  if (!docs.length) {
    return `You are a legal research assistant. Answer the following question using your training knowledge, but note that no specific case law was retrieved for this query. Always remind the user to consult a licensed attorney.\n\nQuestion: ${userQuery}`;
  }

  const context = docs.map((d, i) =>
    `[${i + 1}] ${d.citation} (${d.jurisdiction}, ${d.year})\n${d.content.slice(0, 800)}`
  ).join('\n\n---\n\n');

  return `You are a legal research assistant with access to retrieved legal documents. Answer ONLY using the provided documents. Cite each source as [1], [2] etc. If the documents don't fully answer the question, say so — do not fabricate case law.

RETRIEVED DOCUMENTS:
${context}

USER QUESTION: ${userQuery}

Instructions:
- Answer based on the retrieved documents only
- Cite every claim with [number] matching the document list
- If a retrieved document is from a different jurisdiction than asked, note that
- End with: "This is legal information, not legal advice. Consult a licensed attorney."
`;
}

// ── Step 4: Generate answer with Claude ───────────────────────────────────
async function generateAnswer(prompt) {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── Main export: full RAG pipeline ────────────────────────────────────────
/**
 * @param {string} query        — user's legal research question
 * @param {object} opts
 * @param {string} opts.practiceArea — 'criminal'|'immigration'|'civil_rights'|'bail'
 * @param {string} opts.jurisdiction — 'federal'|'CA'|'NY' etc.
 * @returns {{ answer: string, citations: Array, docsUsed: number, fromRAG: boolean }}
 */

// ── Build suggested follow-up questions based on query context ────────────
function buildSuggestedQuestions(query, practiceArea) {
  const q = query.toLowerCase();
  const area = (practiceArea || '').toLowerCase();

  const suggestions = [];

  if (q.includes('bail') || area === 'bail') {
    suggestions.push(
      'What factors does a judge consider when setting bail?',
      'Can bail be reduced after it is set?',
      'What happens if I cannot afford bail?'
    );
  } else if (q.includes('right') || q.includes('arrest')) {
    suggestions.push(
      'What are my Miranda rights and when do they apply?',
      'Can I refuse a search without a warrant?',
      'What should I say (and not say) when arrested?'
    );
  } else if (q.includes('expunge') || q.includes('record')) {
    suggestions.push(
      'How long does an expungement take?',
      'Will expunged records appear on background checks?',
      'What crimes can never be expunged?'
    );
  } else if (q.includes('plea') || q.includes('guilty')) {
    suggestions.push(
      'What is the difference between a plea deal and going to trial?',
      'Can I withdraw a guilty plea after I enter it?',
      'What is an Alford plea?'
    );
  } else if (area === 'immigration' || q.includes('immigr') || q.includes('deport')) {
    suggestions.push(
      'What are my rights if ICE comes to my home?',
      'How long can I be detained without a hearing?',
      'What is voluntary departure and is it better than deportation?'
    );
  } else {
    suggestions.push(
      'How do I find a public defender?',
      'What is the statute of limitations for my charge?',
      'What happens at an arraignment?'
    );
  }

  return suggestions.slice(0, 3);
}

export async function ragSearch(query, opts = {}) {
  const t0 = Date.now();

  try {
    // Try embedding + retrieval; fall back to plain Claude if embed service is down
    let docs = [];
    let embedding = null;

    try {
      embedding = await embedQuery(query);
      docs      = await retrieveDocs(embedding, query, opts);
    } catch (embedErr) {
      logger.warn('[rag] embedding failed, falling back to plain Claude:', embedErr?.message);
    }

    const prompt = buildRAGPrompt(query, docs);
    const answer = await generateAnswer(prompt);

    const citations = docs.map(d => ({
      citation:  d.citation,
      title:     d.title,
      year:      d.year,
      source:    d.source_url,
      relevance: Math.round((d.similarity || 0) * 100),
    }));

    logger.info('[rag] query complete', {
      docsFound: docs.length,
      latencyMs: Date.now() - t0,
      fromRAG:   docs.length > 0,
    });

    return {
      answer,
      citations,
      docsUsed:  docs.length,
      fromRAG:   docs.length > 0,
      latencyMs: Date.now() - t0,
    };

  } catch (err) {
    logger.error('[rag] pipeline failed:', err?.message);
    throw err;
  }
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
