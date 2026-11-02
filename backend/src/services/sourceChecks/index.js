/**
 * sourceChecks/index.js — the source re-check job (docs/AI_PLATFORM.md §9).
 *
 * Weekly ('source-check', Sundays) and on demand by an admin, the job picks the sourced legal rows
 * due for a check (registry.js; skips rows attempted in the last SOURCE_CHECK_SKIP_DAYS days and
 * rows with a review still pending; at most SOURCE_CHECK_MAX_ROWS per run) and sends them as ONE
 * Message Batch (services/aiBatch.js). Each request asks Claude, with the web fetch tool, to open
 * the row's official page and compare it with the stored text, answering in a fixed schema:
 * still_matches | changed | page_gone | cant_tell, with a word-for-word quote from the page.
 *
 * Web fetch tool — https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
 * (read 2026-11-02): tool `{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses,
 * allowed_domains, max_content_tokens }` (no beta header; every model; works in Message Batches;
 * no charge beyond the fetched tokens). It only opens URLs that appeared in the user turn or in an
 * earlier fetch result, so the source URL is in the user message. Response: `server_tool_use`
 * { name: 'web_fetch', input: { url } } then `web_fetch_tool_result` { content: { type:
 * 'web_fetch_result', url, content: { type: 'document', source: { type: 'text', media_type,
 * data } | { type: 'base64', media_type: 'application/pdf', data }, title }, retrieved_at } } or
 * { content: { type: 'web_fetch_tool_result_error', error_code } }; usage.server_tool_use
 * .web_fetch_requests. We do NOT enable the tool's citations: citations + output_config.format is
 * a 400, and the quote check below works on the fetched text itself.
 *
 * Rules (owner decision, never relaxed):
 *   - Only official domains (ai/sourceDomains.js). allowed_domains lists only the row's own
 *     official host (or, for a proposal, that jurisdiction's official domains); a row whose source
 *     is not official is never fetched. A fetched page on any other host is ignored.
 *   - A "still_matches" verdict changes ONE thing — the row's "checked on" date — and only when
 *     its quote (≥ 5 words) is found, word for word, in the text of the page that was fetched from
 *     the row's own official host. Everything else (changed, page gone, can't tell, a quote that
 *     is not on the page, a PDF page whose text we cannot read) goes to the admin review queue and
 *     the row stays exactly as it is.
 *   - Withheld rows are never published by the job: it may PROPOSE an official page (quote found
 *     on it) for an admin to approve. Rows whose source is not official are handled the same way
 *     when the jurisdiction has official domains configured (PROPOSAL_SOURCES).
 *   - Refused / invalid / failed requests change nothing (they are recorded; the row is due again
 *     next run).
 */
import { createBatch } from '../aiBatch.js';
import { sourceCheckSettings, sourceChecksEnabled } from './settings.js';
import { AiError } from '../aiClient.js';
import { allRows, checkMode, DB_DATASETS } from './registry.js';
import { fetchDomainFor, hostOf, isAllowedUrl, proposalSourcesFor } from '../../ai/sourceDomains.js';
import { reloadOverlay } from './overlayStore.js';
import { stalenessScore } from '../contentStaleness.js';
import logger from '../../utils/logger.js';

export const WEB_FETCH_TOOL = 'web_fetch_20250910';
const str = (v) => String(v ?? '').trim();

export { sourceCheckSettings, sourceChecksEnabled };

// ── Prompts (stable → cached for 1 hour; batches: identical cache_control blocks per request) ──
const RECHECK_SYSTEM = `You check whether one stored rule in a legal-information app still matches the official web page it was taken from.

How to work:
1. Use the web_fetch tool to open the source URL given in the user message. If that page has moved, you may open a page it links to on the same official site. Do not open any other website.
2. Read the page and compare it with the stored text, fact by fact (who, what, numbers, deadlines, conditions, citations).
3. Decide only from the fetched page. Never use your own knowledge of the law, other sources or assumptions, even if you believe the stored text is right or wrong.

Answer in the JSON format you were given:
- verdict "still_matches": the page still says what the stored text says (every fact in the stored text is supported by the page).
- verdict "changed": the page now says something different from the stored text. Say exactly what changed in what_changed (old → new, in plain words).
- verdict "page_gone": the page cannot be opened, is a "not found" / error page, or no longer covers this topic.
- verdict "cant_tell": the page is about the topic but you cannot confirm or deny the stored text from it (it is incomplete, too general, or unclear).
- quote: copy one or two complete sentences from the fetched page, word for word, exactly as they appear (no paraphrase, no "...", no added words), that best support your verdict. For page_gone use null.
- fetched_url: the exact URL of the page the quote comes from (null for page_gone).
- what_changed: null unless the verdict is "changed".

The stored text is information for the public, not legal advice; you are only checking it against its source.`;

const PROPOSE_SYSTEM = `You look for an official web page that states one rule used by a legal-information app, so that a person can review it. The rule is not shown to anyone until a person approves the page you find.

How to work:
1. Use the web_fetch tool, starting from the official pages listed in the user message. You may follow links you find on those pages, but only on the official sites they belong to. Do not open any other website.
2. Look for the page that states this rule (the statute, court rule, or the official agency page about it).
3. Decide only from pages you fetched. Never use your own knowledge of the law.

Answer in the JSON format you were given:
- found: true only if a fetched page clearly states the rule (or the rule's key facts).
- url: the exact URL of that page (null if not found).
- quote: one or two complete sentences copied word for word from that page, exactly as they appear (no paraphrase, no "...", no added words), that state the rule (null if not found).
- explanation: one plain sentence on how the page relates to the stored text, including any difference you see (null if not found).`;

const userTurn = (row, extra) => [
  `Dataset: ${row.dataset}`,
  `Row: ${row.label}${row.state ? ` (${row.state})` : ''}`,
  extra,
  '',
  'Stored text:',
  row.text,
].join('\n');

/** A batch item for a re-check of a shown row on an official source, or null. */
export function recheckItem(row, s = sourceCheckSettings()) {
  if (checkMode(row) !== 'recheck') return null;
  const domain = fetchDomainFor(row.source_url);
  if (!domain) return null;
  return {
    customId: customIdFor('r', row), logicalKey: `src:${row.dataset}:${row.key}`,
    ref: { mode: 'recheck', dataset: row.dataset, key: row.key }, task: 'source_check',
    system: [{ text: RECHECK_SYSTEM, cache: '1h' }],
    messages: [{ role: 'user', content: userTurn(row, `Source URL: ${row.source_url}`) }],
    tools: [{ type: WEB_FETCH_TOOL, name: 'web_fetch', max_uses: s.maxFetches, allowed_domains: [domain], max_content_tokens: s.maxContentTokens }],
    extraInputTokens: s.maxFetches * s.maxContentTokens,
  };
}

/** A batch item for a proposal (withheld / unofficial / no source), or null when nowhere official is configured. */
export function proposalItem(row, s = sourceCheckSettings()) {
  const mode = checkMode(row);
  if (mode === 'recheck') return null;
  const conf = proposalSourcesFor(row.jurisdiction);
  if (!conf) return null;
  const start = [...(row.source_url && isAllowedUrl(row.source_url) ? [row.source_url] : []), ...conf.start];
  const domains = [...new Set([...conf.domains, ...(row.source_url && isAllowedUrl(row.source_url) ? [fetchDomainFor(row.source_url)] : [])])].filter(Boolean);
  return {
    customId: customIdFor('p', row), logicalKey: `src:${row.dataset}:${row.key}`,
    ref: { mode: 'propose', dataset: row.dataset, key: row.key, domains }, task: 'source_propose',
    system: [{ text: PROPOSE_SYSTEM, cache: '1h' }],
    messages: [{ role: 'user', content: userTurn(row, `Official pages to start from:\n${start.map((u) => `- ${u}`).join('\n')}`) }],
    tools: [{ type: WEB_FETCH_TOOL, name: 'web_fetch', max_uses: s.proposalFetches, allowed_domains: domains, max_content_tokens: s.maxContentTokens }],
    extraInputTokens: s.proposalFetches * s.maxContentTokens,
  };
}

/** custom_id: ^[a-zA-Z0-9_-]{1,64}$ — readable prefix + a short hash of dataset/key. */
export function customIdFor(prefix, row) {
  let h = 2166136261;
  for (const c of `${row.dataset}\u0000${row.key}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const readable = `${row.dataset}_${row.key}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 44);
  return `${prefix}_${readable}_${h.toString(36)}`.slice(0, 64);
}

// ── Reading a result ──────────────────────────────────────────────────────────
/** The pages the web fetch tool returned: [{ url, text | null, pdf, error }] (in order). */
export function fetchedPages(message) {
  const out = [];
  for (const b of Array.isArray(message?.content) ? message.content : []) {
    if (b?.type !== 'web_fetch_tool_result') continue;
    const c = b.content || {};
    if (c.type === 'web_fetch_result') {
      const src = c.content?.source || {};
      const text = src.type === 'text' && typeof src.data === 'string' ? src.data : null;
      out.push({ url: String(c.url || ''), text, pdf: src.type === 'base64' || /pdf/i.test(String(src.media_type || '')), error: null });
    } else if (c.type === 'web_fetch_tool_result_error') {
      out.push({ url: null, text: null, pdf: false, error: String(c.error_code || 'unavailable') });
    }
  }
  return out;
}

const norm = (s) => String(s || '').normalize('NFKC').replace(/­/g, '').replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"')
  .replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
/** Is the quote really on the page? (≥ 5 words and ≥ 25 characters, whitespace / quote marks / dashes normalised) */
export function quoteOnPage(quote, text) {
  const q = norm(quote).replace(/^["']|["']$/g, '');
  if (q.length < 25 || q.split(' ').length < 5) return false;
  return !!text && norm(text).includes(q);
}
const sameSite = (a, b) => { const x = fetchDomainFor(a); const y = fetchDomainFor(b); return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)); };

/**
 * Decide what a re-check answer may do (pure).
 * → { outcome: 'verified' | 'queue', verdict, quote, quoteVerified, reason, fetchedUrl, whatChanged }
 */
export function decideRecheck(row, json, message) {
  const pages = fetchedPages(message).filter((p) => p.url && isAllowedUrl(p.url));          // never accept another host
  const disallowed = fetchedPages(message).some((p) => p.url && !isAllowedUrl(p.url));
  const verdict = json?.verdict;
  const quote = str(json?.quote) || null;
  const claimed = str(json?.fetched_url) || null;
  const base = { verdict, quote, whatChanged: str(json?.what_changed) || null, fetchedUrl: claimed && isAllowedUrl(claimed) ? claimed : null };
  if (verdict !== 'still_matches') return { ...base, outcome: 'queue', quoteVerified: false, reason: verdict || 'cant_tell' };
  const own = pages.filter((p) => sameSite(p.url, row.source_url));
  if (!own.length) return { ...base, outcome: 'queue', quoteVerified: false, reason: disallowed ? 'fetched_page_not_allowed' : 'source_page_not_fetched' };
  const hit = own.find((p) => p.text && quoteOnPage(quote, p.text));
  if (hit) return { ...base, outcome: 'verified', quoteVerified: true, reason: 'quote_on_page', fetchedUrl: hit.url };
  if (own.every((p) => p.pdf || !p.text)) return { ...base, outcome: 'queue', quoteVerified: false, reason: 'pdf_not_verifiable', fetchedUrl: own[0].url };
  return { ...base, outcome: 'queue', quoteVerified: false, reason: 'quote_not_on_page', fetchedUrl: own[0].url };
}

/**
 * Decide what a proposal answer may do (pure).
 * → { outcome: 'propose' | 'none', url, quote, quoteVerified, reason, explanation }
 */
export function decideProposal(row, json, message, domains = []) {
  const pages = fetchedPages(message).filter((p) => p.url && isAllowedUrl(p.url));
  const url = str(json?.url) || null;
  const quote = str(json?.quote) || null;
  const explanation = str(json?.explanation) || null;
  if (!json?.found || !url) return { outcome: 'none', reason: 'not_found' };
  if (!isAllowedUrl(url)) return { outcome: 'none', reason: 'proposed_url_not_allowed' };
  const h = hostOf(url);
  if (domains.length && !domains.some((d) => h === d || h.endsWith(`.${d}`))) return { outcome: 'none', reason: 'proposed_url_outside_domains' };
  const page = pages.find((p) => p.url === url) || pages.find((p) => p.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
  if (!page) return { outcome: 'none', reason: 'proposed_url_not_fetched' };
  if (page.text && quoteOnPage(quote, page.text)) return { outcome: 'propose', url, quote, quoteVerified: true, reason: 'quote_on_page', explanation };
  if (page.pdf || !page.text) return { outcome: 'propose', url, quote, quoteVerified: false, reason: 'pdf_not_verifiable', explanation };
  return { outcome: 'none', reason: 'quote_not_on_page' };
}

// ── Starting a run ────────────────────────────────────────────────────────────
/** Rows due, in order: never attempted first, then oldest attempt. */
export async function dueRows(db, { maxRows, skipDays, rows: given = null } = {}) {
  const s = sourceCheckSettings();
  const cap = maxRows ?? s.maxRows;
  const skip = skipDays ?? s.skipDays;
  const rows = given || await allRows(db);
  const state = new Map((await db.all(
    `SELECT dataset, row_key, last_attempt_at FROM legal_source_checks ORDER BY dataset, row_key LIMIT 20000`)).map((r) => [`${r.dataset}|${r.row_key}`, r]));
  const pending = new Set((await db.all(`SELECT dataset, row_key FROM legal_source_reviews WHERE status = 'pending' ORDER BY id LIMIT 20000`)).map((r) => `${r.dataset}|${r.row_key}`));
  const cutoff = Date.now() - skip * 86_400_000;
  // not_official / no_url: shown rows we cannot check automatically (no proposal domains configured
  // for their jurisdiction); withheld_unconfigured: withheld rows with nowhere official to look.
  const counts = { total: rows.length, recheck: 0, propose: 0, not_official: 0, no_url: 0, withheld_unconfigured: 0, skipped_recent: 0, skipped_pending: 0 };
  const due = [];
  for (const row of rows) {
    const id = `${row.dataset}|${row.key}`;
    const mode = checkMode(row);
    const item = mode === 'recheck' ? recheckItem(row, s) : proposalItem(row, s);
    if (!item) {
      if (mode === 'not_official' || mode === 'no_url') counts[mode] += 1;
      else if (mode === 'propose') counts.withheld_unconfigured += 1;
      continue;
    }
    const last = state.get(id)?.last_attempt_at;
    if (pending.has(id)) { counts.skipped_pending += 1; continue; }
    if (last && new Date(last).getTime() > cutoff) { counts.skipped_recent += 1; continue; }
    due.push({ row, item, last: last ? new Date(last).getTime() : 0 });
  }
  // never attempted first, then the oldest attempt; ties: the stalest verified date first
  due.sort((a, b) => a.last - b.last || stalenessScore(b.row.checked) - stalenessScore(a.row.checked));
  const picked = due.slice(0, cap);
  for (const d of picked) counts[d.item.ref.mode === 'recheck' ? 'recheck' : 'propose'] += 1;
  return { picked, counts: { ...counts, due: due.length, sent: picked.length } };
}

/**
 * Start a run: one batch. → { batch, created, counts }   (409-style AiError 'run_in_progress' when
 * a source-check batch is still open — one run at a time).
 *   trigger 'weekly' (idempotent per ISO week) | 'admin' (idempotent per previous run: a double click is one run)
 */
export async function startSourceCheckRun(db, { trigger = 'admin', createdBy = null, maxRows, skipDays, now = new Date(), fetchImpl, rows = null } = {}) {
  const open = await db.get(`SELECT id FROM ai_batches WHERE kind = 'source_check' AND status IN ('creating', 'in_progress', 'canceling', 'ended', 'processing') ORDER BY id DESC LIMIT 1`);
  if (open) throw new AiError('run_in_progress', 'a source check is already running', { batchId: Number(open.id) });
  const last = await db.get(`SELECT MAX(id)::bigint AS id FROM ai_batches WHERE kind = 'source_check'`);
  const { picked, counts } = await dueRows(db, { maxRows, skipDays, rows });
  if (!picked.length) return { batch: null, created: false, counts };
  // weekly: once per ISO week; admin: "the run after batch N" — two clicks at once make one run.
  const key = trigger === 'weekly' ? `source_check:weekly:${isoWeek(now)}` : `source_check:admin:after:${last?.id ?? 0}`;
  const out = await createBatch(db, { kind: 'source_check', items: picked.map((p) => p.item), idempotencyKey: key, createdBy,
    meta: { trigger, counts }, fetchImpl });
  if (out.created) {
    // Mark the rows attempted now, so a failed run does not pick them again until next week.
    for (const p of picked) {
      await db.run(
        `INSERT INTO legal_source_checks (dataset, row_key, source_url, last_attempt_at, last_batch_id, updated_at)
         VALUES (?, ?, ?, NOW(), ?, NOW())
         ON CONFLICT (dataset, row_key) DO UPDATE SET last_attempt_at = NOW(), last_batch_id = EXCLUDED.last_batch_id,
           source_url = EXCLUDED.source_url, updated_at = NOW()`,
        [p.row.dataset, p.row.key, p.row.source_url, out.batch.id]);
    }
  }
  return { ...out, counts };
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

// ── Applying a processed batch ────────────────────────────────────────────────
async function record(db, row, fields) {
  const cols = Object.keys(fields);
  await db.run(
    `INSERT INTO legal_source_checks (dataset, row_key, source_url, ${cols.join(', ')}, updated_at)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, NOW())
     ON CONFLICT (dataset, row_key) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, source_url = EXCLUDED.source_url, updated_at = NOW()`,
    [row.dataset, row.key, row.source_url, ...cols.map((c) => fields[c])]);
}

async function queue(db, row, r, batch, itemId) {
  // One pending review per row (partial unique index); a newer verdict replaces an older pending one.
  await db.run(`UPDATE legal_source_reviews SET status = 'superseded', decided_at = NOW(), decision_note = 'superseded by a newer check'
                 WHERE dataset = ? AND row_key = ? AND status = 'pending'`, [row.dataset, row.key]);
  await db.run(
    `INSERT INTO legal_source_reviews (dataset, row_key, kind, label, state, source_url, old_text, verdict, quote, quote_verified, reason,
       what_changed, fetched_url, proposed_source_url, batch_id, batch_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.dataset, row.key, r.kind, row.label, row.state, row.source_url, row.text, r.verdict, r.quote, !!r.quoteVerified, r.reason,
     r.whatChanged || r.explanation || null, r.fetchedUrl || null, r.proposedUrl || null, batch.id, itemId]);
}

/** aiBatch handler for kind 'source_check'. Returns the run summary (stored as the batch output). */
export async function onBatchProcessed(db, batch, handled) {
  const rows = await allRows(db);
  const byKey = new Map(rows.map((r) => [`${r.dataset}|${r.key}`, r]));
  const sum = { verified: 0, queued: 0, proposed: 0, no_source_found: 0, failed: 0, row_missing: 0 };
  for (const h of handled) {
    const ref = typeof h.item.ref === 'string' ? JSON.parse(h.item.ref) : h.item.ref;
    const row = ref && byKey.get(`${ref.dataset}|${ref.key}`);
    if (!row) { sum.row_missing += 1; continue; }
    if (h.item.status !== 'succeeded' || !h.outcome?.json) {
      sum.failed += 1;
      await record(db, row, { last_outcome: 'failed', last_verdict: h.item.status, last_batch_id: batch.id });
      continue;
    }
    if (ref.mode === 'recheck') {
      const d = decideRecheck(row, h.outcome.json, h.message);
      if (d.outcome === 'verified') {
        sum.verified += 1;
        await record(db, row, { checked_on: new Date().toISOString().slice(0, 10), checked_how: 'auto_quote', last_outcome: 'verified',
          last_verdict: d.verdict, last_quote: d.quote, last_fetched_url: d.fetchedUrl, last_batch_id: batch.id });
        if (row.storage === 'db' && DB_DATASETS[row.table]) {
          // Only the date moves — the row's own text, source and verifier stay as they are.
          const col = row.table === 'rights_cards' ? 'content_verified_at' : 'last_reviewed_at';
          await db.run(`UPDATE ${row.table} SET ${col} = NOW() WHERE id = ?`, [row.id]);
        }
      } else {
        sum.queued += 1;
        await record(db, row, { last_outcome: 'queued', last_verdict: d.verdict, last_quote: d.quote, last_fetched_url: d.fetchedUrl, last_batch_id: batch.id });
        await queue(db, row, { ...d, kind: 'recheck' }, batch, h.item.id);
      }
    } else {
      const d = decideProposal(row, h.outcome.json, h.message, ref.domains || []);
      if (d.outcome === 'propose') {
        sum.proposed += 1;
        await record(db, row, { last_outcome: 'queued', last_verdict: 'source_found', last_quote: d.quote, last_fetched_url: d.url, last_batch_id: batch.id });
        await queue(db, row, { kind: 'proposal', verdict: 'source_found', quote: d.quote, quoteVerified: d.quoteVerified, reason: d.reason,
          explanation: d.explanation, fetchedUrl: d.url, proposedUrl: d.url }, batch, h.item.id);
      } else {
        sum.no_source_found += 1;
        await record(db, row, { last_outcome: 'no_source_found', last_verdict: d.reason, last_batch_id: batch.id });
      }
    }
  }
  await reloadOverlay(db);
  logger.info({ batchId: batch.id, ...sum }, '[source-checks] run applied');
  return { ...(typeof batch.meta === 'object' && batch.meta ? { counts: batch.meta.counts, trigger: batch.meta.trigger } : {}), applied: sum, retry_batch_id: batch.retried_batch_id ?? null };
}

/** The 'source-check' weekly job. */
export async function runWeeklySourceCheck(db, { now = new Date(), fetchImpl } = {}) {
  if (!sourceChecksEnabled()) return { skipped: 'off' };
  try {
    const r = await startSourceCheckRun(db, { trigger: 'weekly', now, fetchImpl });
    return { batch_id: r.batch?.id ?? null, created: r.created, ...r.counts };
  } catch (e) {
    if (e.code === 'run_in_progress') return { skipped: 'run_in_progress', batch_id: e.batchId };
    throw e;
  }
}
