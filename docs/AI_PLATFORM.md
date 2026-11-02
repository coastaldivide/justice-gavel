# AI platform — the gateway (step 1) and verified citations (step 2), November 2 2026

Justice Gavel gives legal **information**, never legal advice. Every AI feature keeps the
disclaimer gate, the "general information — not reviewed by a lawyer" labels and the rule that
legal content is shown only with a source. This document covers the gateway every model call goes
through; later steps extend it.

All request shapes come from the official docs, read on **2026-11-02**:

| Feature | Doc page | Field / header we send |
|---|---|---|
| Structured outputs | build-with-claude/structured-outputs | `output_config.format: { type: "json_schema", schema }` (no beta header) |
| Prompt caching | build-with-claude/prompt-caching | `cache_control: { type: "ephemeral" [, ttl: "1h"] }` on system blocks; top-level `cache_control` (automatic) |
| Effort | build-with-claude/effort | `output_config.effort` |
| Thinking | build-with-claude/thinking | `thinking: { type: "adaptive", display: "omitted" }` / `disabled` / `between_tools` |
| Token counting | build-with-claude/token-counting | `POST /v1/messages/count_tokens` (free, own rate limit) |
| Refusals + fallback | build-with-claude/refusals-and-fallback | `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01` |
| Pricing | about-claude/pricing | — (table in `backend/src/ai/pricing.js`) |
| Search results (step 2) | build-with-claude/search-results | `search_result` blocks `{ source, title, content: [text…], citations: { enabled: true } }` in the user turn (no beta header) |
| Citations (step 2) | build-with-claude/citations | response text blocks with `citations` (`search_result_location`); streams `citations_delta`; never with `output_config.format` |

## Where it lives

| File | What |
|---|---|
| `backend/src/services/aiClient.js` | the gateway: `aiMessage()`, `aiStream()`, `buildRequest()`, `preflight()`, `countTokens()`, metering, refusal handling, tracing; `anthropicFetch()` kept as the low-level metered transport |
| `backend/src/ai/tasks.js` | task classes (quick / standard / deep), the task registry, per-model thinking / effort rules, fallback mode |
| `backend/src/ai/schemas/index.js` | one JSON Schema per structured task + the validator (`validate`, `parseStructured`) |
| `backend/src/ai/pricing.js` | the one price table (doc URL + date), cache / long-context / refusal billing |
| `backend/src/services/aiBudget.js` | daily cap, `recordAiUsage()` → `ai_usage_log` |
| `backend/src/monitoring/aiHealth.js` | hourly error / refusal alarm, metrics summary |
| `supabase/migrations/00000000000044_ai_gateway_metering.sql` | new `ai_usage_log` columns |
| `backend/scripts/anthropic-mock-lib.mjs` | the documented-API mock shared by `anthropic-mock.mjs` and the jest harness |
| `backend/src/ai/legalCorpus.js` | step 2: the sourced passages the AI may cite + retrieval |
| `backend/src/ai/citations.js` | step 2: search_result blocks, citation verification, the legal-statement check, plain-text rendering |
| `backend/src/services/sourcedAnswers.js` | step 2: grounded / nothing_found / plain modes, history rebuild, streamed assembly |
| `backend/src/data/guideCorpus.js` | step 2: generated copy of the court guide + case steps (8 languages, with sources) — `node backend/scripts/build-guide-corpus.mjs` |
| `supabase/migrations/00000000000045_ai_citations.sql` | step 2: `ai_answer` / `ai_sent` on chat_sessions and research_messages |

No call site names a model; nothing calls the API outside the gateway (the evaluation scripts
included — `run_eval.js --model` overrides the model on purpose, for comparisons).

## 1. Task classes and routing

| Class | Default model | Effort | Thinking | Tasks |
|---|---|---|---|---|
| quick | `claude-haiku-5-5` | low | disabled | `translate`, `note_structure`, `match_reports`, `eval_grade` |
| standard | `CLAUDE_MODEL` (`claude-sonnet-5-5`) | medium | adaptive | `chat`, `chat_defender`, `bar_explain`, `queue_job`, `discovery_intake`, `speaker_tags`, `privilege_log`, `motion_refine`, `eval_answer` |
| deep | `claude-opus-5-5` | high | adaptive | `research`, `research_rag`, `motion_generate`, `motion_generate_appeal`, `motion_review`, `discovery_analysis`, `expungement_petition`, `contract_generate`, `contract_review`, `contract_redline`, `contract_negotiation` |

* Settings per class: `AI_MODEL_<C>`, `AI_EFFORT_<C>`, `AI_THINKING_<C>`, `AI_THINKING_HEADROOM_<C>`
  (`<C>` = QUICK / STANDARD / DEEP). Thinking counts toward `max_tokens`, so classes with thinking
  get headroom on top of each task's answer budget (standard +2,000, deep +6,000).
* Deep-class jobs get longer job timeouts (services/aiQueue.js `JOB_TIMEOUT_BY_TYPE`: discovery and
  contracts 150 s, privilege log 120 s, research 120 s, motions 200 s; others `AI_JOB_TIMEOUT_MS`, 45 s).
* Thinking text is never shown: `display: "omitted"` is always sent (also the 5.x default), and
  only `text` blocks are read (thinking / fallback blocks skipped, streams read only `text_delta`).
* The gateway maps the class setting onto what the chosen model accepts, so changing a model by
  env cannot produce a 400: Opus 5.5 accepts only adaptive; Sonnet 5.5 rejects `disabled` (its
  lowest setting `between_tools`, effort ≤ high, no other field); Haiku 5.5 accepts `disabled`
  at effort ≤ high; Haiku 4.5 / Sonnet 4.5 get no effort field.
* Opus 5.5 and Sonnet 5.5 reject forced tool use and prefill, so structured output never uses
  `tool_choice`. **No call site uses tools today**, so there are no tool definitions to cache or to
  mark `strict`; when a later step adds tools they go in the cached prefix with `strict: true`.

## 2. Structured outputs

Eleven tasks return JSON through `output_config.format` (15 schemas); the schema list is in
`backend/src/ai/schemas/index.js` (motion_review, discovery_intake, discovery_analysis,
match_reports, note_structure, speaker_tags, privilege_entries, contract_review, contract_redline,
contract_negotiation, and five eval_* grader schemas). Every property is required (nullable ones
use a type array) and every object has `additionalProperties: false`; no unsupported keyword
(min/max, minLength…) is used — a unit test runs every schema through the mock's 400 checks.

Every parsed answer is validated (enum casing normalised, missing / extra / wrong-typed keys
rejected). Failure paths (code `ai_invalid_output`, metered with status `invalid`):

| Feature | When the answer is invalid, cut off (`max_tokens`) or refused |
|---|---|
| Motion review | 502 `review_unreadable` (existing message); refusal 422 `ai_refused` |
| Discovery analysis / intake | job fails; nothing saved, so a paid analysis can be retried with the same payment |
| Contracts review / redline / negotiation | job fails; nothing saved |
| Privilege log | job fails; nothing saved — no placeholder entries |
| Lawyer match reports | the numeric (non-AI) reports are shown; reports for unknown lawyer ids are dropped |
| Voice notes | the local keyword structuring is kept |
| Police-encounter transcript | the transcript is kept as heard with every speaker UNKNOWN (the words come from the transcription, never from the model) |

The old hacks (stripping ```json fences, slicing from the first `{`, `content[0].text`) are gone;
`content[0]` would have been the thinking block on 5.x models.

## 3. Refusals and fallback

`stop_reason: "refusal"` (or `stop_details.type: "refusal"`) is its own outcome, code
`ai_refused`, worded in all 8 languages: **"This request can't be answered here. You can ask it a
different way, or talk to a lawyer or a legal aid office about it."** Nothing is saved:

* job path — the job fails with `ai_refused`; no chat turn, no research message, no draft;
* stream — a refusal before or during the answer ends with
  `{ type: 'error', code: 'ai_refused', discard: true }`; the app removes the text it already
  showed and offers no retry (the same words would be declined again); nothing is saved, not
  even on Stop.

Fallback (`AI_FALLBACK`, default `auto`) — appropriate here because every task is legal
information the app is allowed to give, so a classifier decline is most likely a false positive
on a frightening topic:

| Model of the class | What is retried | On which model |
|---|---|---|
| Sonnet 5.5, Opus 5.5 (standard, deep) | server-side, inside the same call (streams included): `fallbacks: "default"` + beta header `server-side-fallback-2026-07-01` | the API's default fallback target (`allowed_fallback_models`); the serving model is read from the response `model` / the `fallback` block |
| Haiku 5.5 (quick) — no server-side fallback | one client-side resend of the same request (thinking / effort re-mapped; never both client and server fallback) | `AI_FALLBACK_MODEL`, default the standard class model (Sonnet 5.5) |
| any | `reasoning_extraction` refusals are never retried (the docs: change the prompt) | — |

`AI_FALLBACK=off` sends no `fallbacks` and makes no retry. Rate limits / overload / 5xx are not
fallback triggers (the docs); they are retried by the transport (up to 2 retries with backoff).

Metering: a refusal is billed under the documented rule — before any output only the categories
`bio`, `frontier_llm`, `reasoning_extraction` are billed; `cyber`, `general_harms` and `null` cost
$0; a mid-stream refusal bills input + streamed output. With server-side fallback each attempt
in `usage.iterations` is priced on its own model. `ai_usage_log.status`: `refused` (the person got
the refusal), `declined` (refused, then retried client-side), `completed` with `refusal = true`
and `fallback_model` set (a fallback answered).

## 4. Prompt caching

| Prefix | Breakpoint | Why |
|---|---|---|
| Chat system prompt + sources rules (consumer ≈ 2.4k tokens), defender prompt + sources rules (~1.5k tokens) | **1 hour** (`AI_CHAT_CACHE_TTL`) | identical for every person; the state note and language line follow in an uncached block. Since step 2 the rights card is no longer in the prompt: it is one of the citable passages (§8) |
| Chat / research conversation (incl. the citable search results of earlier turns) | automatic (top-level `cache_control`, 5 min) | a follow-up re-reads the history from cache: earlier user turns are rebuilt byte-for-byte from `ai_sent` (exact text + the same search_result blocks) |
| Research instructions + sources rules (~1.5–1.8k tokens), RAG instructions | 5 min | |
| Motion templates (trial / appellate), motion clean-up, motion review, discovery, petition, privilege-log, speaker-tagging instructions | 5 min | the template moved to the system prompt, the case facts to the user turn |
| Contract prompts, translation, match, notes | none | short and per-request (under the 512-token minimum) |

Breakpoints: at most 4 per request, 1h before 5m (the gateway enforces both), prefix order
tools → system → messages. Prefixes under the 512-token minimum of the 5.5 models are simply not
cached (no error). Changing a class's thinking or effort setting starts a new cache prefix.
`AI_CACHE=off` removes every breakpoint.

**1-hour break-even (chat, Sonnet 5.5, prefix P ≈ 3,000 tokens):** uncached $0.0060 per question;
5-min write $0.0075 (1.25×); 1-hour write $0.0120 (2×); read $0.0003 (0.05×). With k questions in
an hour spaced more than 5 minutes apart (the realistic pattern at launch volumes):

* no cache: $0.0060·k · 5-min cache: $0.0075·k (every question re-writes — worse than none) ·
  1-hour cache: $0.0120 + $0.0003·(k−1)
* 1-hour beats no cache from **k = 3** questions per hour (k > 2.05) and beats the 5-minute cache
  from **k = 2**. When traffic is continuous (gaps always < 5 min) the 5-minute cache would be
  $0.0045 cheaper per hour — negligible. At 100 questions/hour: $0.042 vs $0.60 uncached.

So the 1-hour cache is on for the chat prompt. A cache read refreshes the entry for free, so the
entry lives as long as one question arrives each hour.

Metering: `ai_usage_log.cache_read_tokens`, `cache_write_5m_tokens`, `cache_write_1h_tokens`,
each priced at its own rate in the daily budget.

## 5. Preflight: token counting before big calls

* Requests with a PDF / image, or whose local estimate is ≥ `AI_COUNT_TOKENS_THRESHOLD`
  (20,000 tokens), are counted with `POST /v1/messages/count_tokens` (free, separate rate
  limit). Smaller text requests use the local estimate (characters ÷ 3 — errs high: the 5.x
  tokenizer gives ~30 % more tokens than the old ~4 chars/token rule), because a count call would
  add a round trip to every chat question. A failed count falls back to the estimate.
* Refused **before sending** with code `ai_too_large` (413 on synchronous routes; message
  "This request is too large for the AI to handle right now. Try a shorter question or a smaller
  document, or try again tomorrow."):
  input over `AI_MAX_INPUT_TOKENS` (150,000); worst case (all input uncached + `max_tokens` output)
  over `AI_MAX_REQUEST_USD` ($2); or worst case over what is left of today's budget.
* The figure is stored in `ai_usage_log.input_tokens_estimated` with `preflight` = counted | estimated.

## 6. Pricing (USD per million tokens, read 2026-11-02)

| Model | Input | Output | 5m write | 1h write | Cache read |
|---|---|---|---|---|---|
| claude-opus-5-5 | 4 | 20 | 5 | 8 | 0.20 |
| claude-sonnet-5-5 | 2 | 10 | 2.50 | 4 | 0.10 |
| claude-haiku-5-5 (≤ 100k prompt) | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 |
| claude-haiku-5-5 (> 100k prompt) | 0.50 | 2.50 | 0.625 | 1 | 0.05 |
| claude-sonnet-5 | 2 | 10 | 2.50 | 4 | 0.20 |
| claude-opus-5 | 5 | 25 | 6.25 | 10 | 0.50 |
| claude-haiku-4-5 | 1 | 5 | 1.25 | 2 | 0.10 |
| anything else (e.g. a fallback model not in the table) | family default: Opus 15/75, Sonnet 3/15, Haiku 1/5 (errs high) | | ×1.25 | ×2 | ×0.1 |

`AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` still override every model.

## 7. Tracing and monitoring

`ai_usage_log` (migration 44) — one row per attempt: route, task, task_class, requested_model,
model (served), input / output / cache read / cache write 5m / 1h tokens, cost_usd, duration_ms,
stop_reason, refusal, refusal_category, fallback_model, status, error_code, request_id (the API's
`request-id` header), trace_id, input_tokens_estimated, preflight. Prompts and documents are never
logged.

* `GET /api/admin/metrics/ai?days=7` (admin + `X-Admin-Key`): per day × route × class — calls,
  cost, tokens, cache-read share, p50 / p95 latency, refusal rate (final), decline rate (classifier
  declines incl. those a fallback answered), error rate; totals by class and route.
* `GET /api/admin/diagnostics/ai`: the last hour + today's budget.
* Hourly watchdog (server.js, next to jobHealth / smsHealth): alerts `ai_error_rate` when more than
  `AI_ALERT_ERROR_PCT` (20 %) of calls fail or fail validation, `ai_refusal_rate` when more than
  `AI_ALERT_REFUSAL_PCT` (10 %) end refused, once at least `AI_ALERT_MIN_CALLS` (20) calls ran.
  Refusals are HTTP 200, so provider error monitoring would never see them.
* OpenTelemetry: the docs' SDK tracing needs the SDK's own client and a registered tracer
  provider (`@opentelemetry/*` packages are only present as Sentry's transitive dependencies, and
  the gateway uses raw fetch). What fits without new packages: `AI_TRACE_PROPAGATION=on` sends a
  W3C `traceparent` header on every call (the header the SDK integration sends) and stores the
  trace id, so a row can be matched with the API's trace. To enable full tracing later: add
  `@opentelemetry/api` + an OTLP exporter as direct dependencies, register a tracer provider in
  `instrument.js`, wrap `post()` in aiClient.js in a span named `anthropic.messages.create`, and
  follow "Set up API tracing" (platform.claude.com/docs/en/manage-claude/opentelemetry/api — that
  page could not be read from this environment, so its console steps are not described here).

## 8. Verified citations (step 2, November 2 2026)

Every legal statement in a chat or research answer must trace to a source. Docs read 2026-11-02:
build-with-claude/search-results and build-with-claude/citations (URLs and date also in
`services/aiClient.js` and `ai/citations.js`).

**Which block type.** Retrieved passages go to Claude as top-level **`search_result`** blocks in
the user turn (`{ type, source, title, content: [{ type: 'text', text }…], citations: { enabled: true } }`),
not `document` blocks: the docs name search results for RAG, each citation then carries our own
`source` id (`jg:<passage id>`) and title, and our passages are already cut into the units we want
cited (the docs: a text block is the smallest citable unit; one sentence or one guide item per
block). No beta header; all active models but Haiku 3. Citations are enabled on every block (the
docs: all or none). The blocks sit in the user turn, after the cached system prompt, so the 1-hour
chat prefix stays identical for everyone.

**Citations vs structured outputs.** The citations page: enabling citations together with
`output_config.format` is a **400**. So cited answers are always prose, and structured output is
used only where nothing needs a citation (motion review, discovery, contracts, notes …). The
gateway refuses to build a request that combines them (`buildRequest` throws before sending), and
the mock returns the API's 400 if one ever slipped through.

**The corpus** (`ai/legalCorpus.js`, 546 passages): the general rights card (8 languages; each
section names its constitutional source; opens the Rights card), the court guide (8 sections) and
the nine case stages (8 languages, with the official pages and the date checked —
`data/guideCorpus.js`, generated from the app; a test fails if it drifts), the record-clearing
rules that pass `citationOf()` (295 state × category rows: verified / corrected, citation, source
URL — English only) and the recording-consent table (51 rows). Research adds the research library
(`legal_documents` in Supabase, when `SUPABASE_URL` + key are set): rows with a citation and
similarity ≥ `RAG_MIN_SIMILARITY` (0.35). Nothing unsourced is a passage (unreviewed state
summaries, withheld tables). Retrieval is lexical BM25 in the person's language plus the
English-only tables, limited to the person's state and the states the question names (other
states' verdicts are never sent), lenient on purpose: the safety is in verification.

**Modes** (`services/sourcedAnswers.js`):

| Mode | When | What happens |
|---|---|---|
| grounded | relevant passages found (or the conversation already has some) | passages sent as citable search results (max 6 chat / 8 defender + research; a passage already sent earlier in the conversation is not resent — its index stays valid); answer verified |
| nothing_found | a legal question (8-language check) and nothing relevant | **no model call**; the person is told no checked source was found and pointed to legal aid / the rights card (research: "check a primary source") — never an answer from model memory |
| plain | not a legal question (app help, a kind word, scheduling) | asked without sources; any sentence that still makes a legal statement is withheld |

**Verification rules** (`ai/citations.js verifyCitation`): a citation is kept only if
`type === 'search_result_location'`, `search_result_index` is in range of the search results in
that request (counted across all messages, as the docs say), `source` equals the id we sent at that
index, `title` (when given) equals ours, `0 ≤ start_block_index < end_block_index ≤ blocks` and
`cited_text` is contained in those blocks. Anything else (other citation types, foreign ids,
invented text) is dropped, counted (`dropped`, logged by reason) and never shown. The passage shown
on tap is **our stored text**, not the model's copy.

**Uncited text** (owner rule, LEGAL_ACCURACY_REVIEW): a part with no surviving citation is shown
only if it makes no legal statement (`looksLegal()`: any number other than a crisis line, §/$,
and legal words in all 8 languages — deliberately broad); otherwise it is replaced by
"No source found for this part — not shown" and never reaches the person, the history or an
export. If nothing visible is left, the nothing-found answer is shown; if the answer cited nothing
but some parts were withheld, the app adds the rights card / legal help buttons (`no_source`).

**Streaming.** `citations_delta` events are collected into their text block; a block is shown only
when it is complete and checked (`segment` frames); plain answers are shown sentence by sentence.
No unchecked text reaches the app (no `token` frames except a replayed, already-checked answer).
Stop saves only the checked parts already shown; a refusal still discards everything.

**What people see.** Chat bubble and research answer (`components/CitedAnswer.tsx`): the text
with tappable numbers [1] [2]; "Sources" with title, kind, jurisdiction, year and "checked
<date>"; tapping a source shows the exact passage, "Open the source" (official page) and
"Open in the app" (rights card, court guide, case steps, record clearing); the "not shown" marker
in place of uncited legal parts; the label "General information — not legal advice — not reviewed
by a lawyer". All 8 languages; mirrors in Arabic. Text-only callers get `reply` / `answer` with
[n] markers and a numbered source list.

**Storage** (migration 45): assistant rows keep `ai_answer` (segments + sources: id, kind, title,
jurisdiction, year, URL, publisher, checked date, passage) so history renders exactly as first
shown; user rows keep `ai_sent` (exact question text + the passages sent). `content` keeps the
visible words only. Both are deleted with the account (chat rows by user; research messages via
the user's research sessions — this step also closes the gap that research messages were left
behind) and included in the data export (`research_messages`).

**Costs.** Passages add input tokens (~150–400 per passage; a chat question ≈ +1–2k tokens, cached
on follow-ups), the docs note citations add a little more for chunking; `cited_text` is not billed
as output. No new model call: nothing_found saves the call entirely.

**Tests.** `ai_citations.test.js` (21: request shape, 400 rules, verification incl. foreign ids,
withholding in 8 languages, retrieval / modes, cache hit on the follow-up, streaming, corpus
drift), `integration/ai_citations.int.test.js` (7, real Postgres: stream, history, follow-up cache
read, foreign ids, nothing found, refusal unchanged, research /ask + /rag, export + deletion),
frontend `render/citedAnswer.test.tsx` (9 incl. Arabic / RTL). The mock (`citeMode` auto | none |
foreign | blocks) returns citation-bearing responses in the documented shapes, JSON and SSE.

**Live-key checks** (docs/LIVE_TEST.md section M): real `search_result_location` fields and
`citations_delta` order on Sonnet 5.5 / Opus 5.5, that `cited_text` matches our blocks, how often a
real answer leaves legal sentences uncited (withheld rate), cache reads with search results in the
history, and the 400 for citations + `output_config.format`.

## Settings

All in DEPLOY_ENV_SETUP.md and both `.env.example` files: `AI_MODEL_QUICK|STANDARD|DEEP`,
`AI_EFFORT_*`, `AI_THINKING_*`, `AI_THINKING_HEADROOM_*`, `AI_FALLBACK`, `AI_FALLBACK_MODEL`,
`AI_CACHE`, `AI_CHAT_CACHE_TTL`, `AI_COUNT_TOKENS_THRESHOLD`, `AI_MAX_INPUT_TOKENS`,
`AI_MAX_REQUEST_USD`, `AI_TRACE_PROPAGATION`, `AI_ALERT_MIN_CALLS`, `AI_ALERT_ERROR_PCT`,
`AI_ALERT_REFUSAL_PCT`, `RAG_MIN_SIMILARITY` (step 2) (plus the existing `CLAUDE_MODEL`, `AI_DAILY_BUDGET_USD`,
`AI_BUDGET_ALERT_PCT`, `AI_PRICE_*`).

## Tests

* `backend/src/__tests__/ai_gateway.test.js` — pricing, routing, every task's request checked
  against the mock's 400 rules, schemas, outcomes (structured, invalid, refusal, server and client
  fallback, provider errors, tracing), preflight, streaming.
* `backend/src/__tests__/integration/ai_gateway.int.test.js` — real Postgres: chat cached and
  metered, refusals (job + stream) save nothing and are worded in the person's language, server
  fallback recorded, motion review schema-checked, oversized request refused unsent, admin metrics,
  aiHealth alarms.
* The mock (`scripts/anthropic-mock-lib.mjs`) answers like the documented API and returns the 400
  the real API would for sampling params, wrong thinking values per model, forced tool use /
  prefill on Opus 5.5 / Sonnet 5.5, `fallbacks` without the beta header or on Haiku 5.5,
  unsupported schema keywords, more than 4 breakpoints or a 1h breakpoint after a 5m one.

## Needs a live-key check (docs/LIVE_TEST.md sections L and M)

Nothing here was verified against the real API: the mock follows the docs. To check with a key:
structured outputs on each model, cache write then read on the second chat question (1h TTL in
`usage.cache_creation.ephemeral_1h_input_tokens`), `count_tokens` on a PDF, server-side fallback
accepted with `"default"` on Sonnet 5.5 / Opus 5.5 (the beta header) and the `fallback` block /
`usage.iterations` shape, a real refusal's `stop_details`, `between_tools` accepted on Sonnet 5.5,
effort `low` + `disabled` on Haiku 5.5, and the `request-id` header.
