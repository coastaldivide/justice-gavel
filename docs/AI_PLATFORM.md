# AI platform — the gateway (step 1), verified citations (step 2), source re-checks and batches (step 3), November 2 2026

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
| Pricing | about-claude/pricing | — (table in `backend/src/ai/pricing.js`; batch = 50 %, `BATCH_DISCOUNT`) |
| Search results (step 2) | build-with-claude/search-results | `search_result` blocks `{ source, title, content: [text…], citations: { enabled: true } }` in the user turn (no beta header) |
| Citations (step 2) | build-with-claude/citations | response text blocks with `citations` (`search_result_location`); streams `citations_delta`; never with `output_config.format` |
| Message Batches (step 3) | build-with-claude/batch-processing + api/cli/messages/batches | `POST /v1/messages/batches` `{ requests: [{ custom_id, params }] }`, `GET …/{id}`, `GET …/{id}/results` (.jsonl), `POST …/{id}/cancel`; no beta header; no `stream` / `fallbacks` in params |
| Web fetch tool (step 3) | agents-and-tools/tool-use/web-fetch-tool + server-tools ("Domain filtering") | `tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses, allowed_domains, max_content_tokens }]`; no beta header; no wildcards in domains |

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
| `backend/src/services/aiBatch.js` | step 3: the batch layer (create / poll / results by custom_id / retries / metering at the batch price / kind handlers), job `ai-batches` |
| `backend/src/ai/sourceDomains.js` | step 3: THE allow-list of official domains (the one config file) + proposal domains per jurisdiction |
| `backend/src/ai/sourceOverlay.js` | step 3: the in-memory "checked on" / withheld / approved-source overlay the app reads |
| `backend/src/services/sourceChecks/` | step 3: `registry.js` (every sourced row and where its URL + date live), `index.js` (the job, request builder, verdict rules), `reviews.js` (admin queue), `overlayStore.js`, `settings.js` |
| `backend/src/services/evalBatch.js` | step 3: the evaluation as batches (prompts shared with `src/scripts/run_eval.js` / `grade_eval.js`) |
| `backend/src/services/translationDrafts.js` + `backend/scripts/apply-translation-drafts.mjs` | step 3: "translate new keys" drafts and how a developer applies them |
| `backend/src/routes/admin/sourceChecks.js`, `routes/admin/aiBatches.js`, `routes/legalSources.js` | step 3: admin queue + batch tools (admin role), public checked-on status |
| `frontend/src/screens/AdminSourceChecksScreen.tsx` | step 3: Admin → Source checks (queue, withheld rows, batch tools) |
| `supabase/migrations/00000000000046_source_checks_and_batches.sql` | step 3: `ai_batches`, `ai_batch_items`, `legal_source_checks`, `legal_source_reviews`, `ai_usage_log.batch_id` |

No call site names a model; nothing calls the API outside the gateway (the evaluation scripts
included — `run_eval.js --model` overrides the model on purpose, for comparisons).

## 1. Task classes and routing

| Class | Default model | Effort | Thinking | Tasks |
|---|---|---|---|---|
| quick | `claude-haiku-5-5` | low | disabled | `translate`, `note_structure`, `match_reports`, `eval_grade` |
| standard | `CLAUDE_MODEL` (`claude-sonnet-5-5`) | medium | adaptive | `chat`, `chat_defender`, `bar_explain`, `queue_job`, `discovery_intake`, `speaker_tags`, `privilege_log`, `motion_refine`, `eval_answer`, step 3 batch-only: `source_check`, `source_propose`, `translate_keys` |
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
  `tool_choice`. Since step 3 the only tool is the **web fetch server tool** (source re-checks,
  batch only); it goes first in the prefix (tools → system → messages). Server tools take no
  `strict` (that is for custom tools' input schemas). The final answer is still structured
  (`output_config.format` applies to Claude's direct output after the tool results — read with
  `finalText()`, the text blocks after the last tool block).

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

## 9. Source re-checks (step 3, November 2 2026)

Every sourced legal row the app shows or withholds is re-checked against its official page on a
schedule, with Claude and the **web fetch tool**, on official domains only. A row never changes by
itself: the only automatic effect is a newer "checked on" date, and only when the check is verified.

**What is checked** (`services/sourceChecks/registry.js` — where each URL and date lives):

| Dataset | Rows | Source URL / "checked on" | Shown when |
|---|---|---|---|
| expungement (rules_data.js) | 306 | `source_url` / generated 2026-10-25 | `citationOf()` passes (295) |
| juvenile (rules_data.js) | 51 | `source_url` / 2026-10-25 | verified + citation + URL |
| recording (recordingLaws_data.js) | 51 | `source_url` / 2026-10-25 | verified + URL |
| court_rules (data/court_rules.js) | 4 | `url` / `checked` | always |
| transit (data/transit_agencies.js) | 10 | `source_url` / `checked` | always |
| guide (data/guideCorpus.js ← constants/guideSources.ts) | 18 with a URL | `url` / `checked` | always |
| tn_report (bondDesk/tnReport.js) | 1 | `sources[1]` (tn.gov page) / `checked_on` | always |
| rights_card (rc_1–rc_3) | 3 | none recorded (constitutional source named) / April 2026 | always |
| deadlines (routes/docket.js RULE_SETS) | 31 | none recorded / none | always (open item L7) |
| bail_schedules, dui_laws, drug_penalties, statute_of_limitations, victim_compensation, specialty_courts | DB | `source_url` / `last_reviewed_at` (migration 46 adds it to the last two) | `isVerifiedRow()` |
| rights_cards (state sections) | DB | `source_url` / `content_verified_at` | a source URL |

Each row has a mode (`checkMode`): **recheck** (shown, source on an official domain — 161 rows in
code today), **propose** (withheld — e.g. the Tennessee bail rows), **not_official** (shown, but the
source is commercial / secondary: Justia, CCRC, RCFP … — 265 rows in code) and **no_url**. Rows in
the last three modes get a *proposal* request when their jurisdiction has official domains
configured (`PROPOSAL_SOURCES`: federal and Tennessee today); the rest are counted as "need a
person" on the admin screen and never fetched.

**The allow-list** (`ai/sourceDomains.js`, the one config file): `.gov` hosts; `state.<xx>.us`
hosts; an explicit list of official bodies on other domains (Kansas Revisor, Maine Legislature,
Oklahoma State Courts Network, Pennsylvania General Assembly, Allegheny and Knox County
governments, and six public transit authorities — for the transit rows only); and a never-list that
wins over everything (Justia, FindLaw, Lexis, Westlaw, Casetext, CourtListener, Cornell LII, Nolo,
FastDemocracy, LegiScan, Squarespace / Wix / WordPress / Blogspot hosts, NCSL, CCRC, RCFP, archive.org…).
ASCII only (punycode refused — the docs warn about homographs), no credentials in URLs. The web
fetch docs forbid wildcards in `allowed_domains` (`*.gov` is a 400), so each request lists the exact
official host of the row's source (`fetchDomainFor`: the host without `www.`, which also covers its
subdomains), or for a proposal the jurisdiction's official domains. A test builds every request
from every row and checks each domain against the allow-list.

**Request** (task `source_check` / `source_propose`, standard class = Sonnet 5.5, structured output
`source_check` / `source_proposal`, cached 1-hour system prompt): the user turn holds the dataset,
row label, the source URL (web fetch only opens URLs that appeared in the user turn or an earlier
fetch result) and the stored text. Tool: `web_fetch_20250910`, `max_uses` 2 (proposals 4),
`max_content_tokens` 20,000, **no tool citations** (citations + `output_config.format` is a 400;
the quote check below uses the fetched text itself). Claude answers `{ verdict: still_matches |
changed | page_gone | cant_tell, quote, what_changed, fetched_url }` — "decide only from the fetched
page, never from your own knowledge", the quote word for word.

**What a verdict may do** (`decideRecheck`, pure, unit-tested):

| Result | Effect |
|---|---|
| `still_matches` + a quote of ≥ 5 words / 25 characters found (whitespace, quote marks, dashes normalised) in the text of a page fetched from the row's own official host | **automatic**: `checked_on` = today (`legal_source_checks`, `checked_how = auto_quote`); DB rows: `last_reviewed_at` (or `content_verified_at`) = now. Text, source and verifier untouched. |
| `still_matches` but the quote is not on the page, or the page is a PDF (we cannot read PDF text locally), or the source page was not fetched | review queue (`quote_not_on_page` / `pdf_not_verifiable` / `source_page_not_fetched`) |
| `changed`, `page_gone`, `cant_tell` | review queue with the model's quote and "what changed" |
| a fetched page on any non-allowed host (even if the API returned one) | ignored; never counts as the source |
| refusal, invalid JSON, errored request | nothing changes; recorded (`last_outcome = failed`); the row is due again next run |
| proposal: `found` + a URL on the allowed domains that was actually fetched + the quote on that page (or a PDF) | review queue as "proposed source" — **never published without a person** |
| proposal not found / URL not allowed / not fetched / quote not on the page | nothing queued (`no_source_found`) |

**Admin review queue** (Admin → Source checks; `GET/POST /api/admin/source-checks/*`, admin role,
every decision in `audit_log` — `resource_type 'legal_source'`): each item shows the row, the stored
text, the verdict, the quote (found on the page or not), what changed and links to the stored /
checked / proposed page. **Approve** — a re-check: the row as stored is confirmed, dated today; a
proposal: DB rows get the official `source_url` and `verified_by "Source-checked <date> — source
approved by an admin …"` (so a withheld row is shown from now on — a human approved it); code rows
record the approved source (shown by the rights card, deadline calculator, record clearing and
recording law where they have a source link). **Edit** — DB rows: the table's text columns only (and
optionally a new official source), dated today; code rows: a correction for a developer, and the
row is withheld until the code is changed (`GET …/withheld` lists them; restore afterwards).
**Withhold** — the row stops being shown everywhere (legaldata, record clearing, recording law,
court rules, transit, the guide's source link, AI citations) until restored.

**The overlay** (`ai/sourceOverlay.js`): rows in code cannot be edited at run time, so the app reads
`legal_source_checks` through a synchronous in-memory overlay (loaded at start-up, every 5 minutes
and after each change): `checkedOn()` (never moves a date back), `isWithheld()`, `approvedSource()`.
The app's bundled guide sources merge `GET /api/legal-sources/status` (public, cached 5 min).

**Schedule and caps:** job `source-check`, Sundays 04:40 (`REFRESH_TZ`), idempotent per ISO week,
one run at a time (`run_in_progress` otherwise); admin "Run a check now" (`POST …/run`, idempotent per
previous run). At most `SOURCE_CHECK_MAX_ROWS` (100) rows per run, never-attempted first, then the
oldest attempt, then the stalest verified date; rows attempted in the last `SOURCE_CHECK_SKIP_DAYS`
(30) days and rows with a pending review are skipped. One run = one batch (§10). Both jobs are in
`jobHealth` (`source-check` weekly, `ai-batches` every 10 minutes). `contentRefresh.js` (daily, no AI)
reports how many shown rows were not verified in 180 days; it no longer stamps crisis resources as
verified when none is stale (that "verified" date was never a check).

**Cost** (Sonnet 5.5 at the batch price, $1 / $5 per MTok): a re-check ≈ 1k system (cached after the
first) + 2–25k fetched page tokens + ~300 output ≈ **$0.003–0.03 per row**; worst case per row (2
pages × 20k tokens + max_tokens) ≈ $0.057, so a 100-row run is capped at ≈ $5.7 (and by
`AI_BATCH_MAX_USD`, default $10, and what is left of the daily budget). Web fetch adds no charge.

## 10. Message Batches (step 3)

`services/aiBatch.js` — the gateway's batch layer; requests are built by the gateway
(`buildRequest({ batch: true })`: never streams, never sends `fallbacks` — the batch docs reject
both; server-side fallback is therefore off for batch tasks and a refusal is recorded instead).

* **Create** (`createBatch`): custom_id `^[a-zA-Z0-9_-]{1,64}$`, unique per batch; idempotent by
  `idempotency_key` (the same work returns the same batch — e.g. weekly per ISO week, eval per minute
  + filters, a retry per parent batch); worst case (every input token uncached + tool pages +
  `max_tokens`, at 50 %) over `AI_BATCH_MAX_USD` (10) or over what is left of today's budget → refused
  before sending (`ai_too_large`). Items are stored first (`ai_batch_items.params` — only non-personal
  content is batched), then one `POST /v1/messages/batches` (one retry of a 429 / 5xx; a network
  failure after sending is marked `create_unconfirmed`, never silently re-sent).
* **Poll** (job `ai-batches`, every 10 minutes; Admin → Batch tools → "Check batches now"): retrieve;
  when `ended`, one instance claims the batch (`ended → processing`, stale claims retried after 30
  minutes), reads `results_url` (only on the API host — the key is sent with it; else the documented
  `/results` path), and maps each JSONL line to its item **by custom_id** (results come in any order;
  unknown ids and duplicate lines are ignored; an item without a line is `missing_result`).
* **Results**: `succeeded` → priced at the batch rate (`pricing.costUsd(…, { batch: true })`, 50 % of
  every category, cache reads / writes included), metered in `ai_usage_log` (`route batch:<kind>`,
  `batch_id`), structured output validated against the exact schema sent (an invalid answer is
  `invalid`, never used); refusals follow the refusal billing rule; `errored` (nested
  `error.error.type`), `canceled`, `expired` are not billed.
* **Retries**: transient errors (`overloaded_error`, `api_error`, `rate_limit_error`, `timeout_error`),
  `pause_turn` (a server-tool loop that paused) and `expired` requests are sent again in ONE new batch
  (same custom_id, `attempt + 1`, `parent_id`), up to `AI_BATCH_MAX_ATTEMPTS` (3); others (e.g.
  `invalid_request_error`) are final. Processing a batch twice changes nothing.
* **Handlers** (by kind, after the retries are sent): `source_check` (§9), `eval_answer` → starts the
  grading batch, `eval_grade` → stores the scores, `translate_keys` → the review file.

**Uses:**

| Use | Trigger | Stored |
|---|---|---|
| Source re-check (§9) | weekly job; admin "Run a check now" | `legal_source_checks`, `legal_source_reviews`, batch output (counts) |
| Evaluation (data/eval/questions.json) | Admin → Batch tools → "Run the evaluation (10 questions)" (`POST /api/admin/ai-batches/eval { state?, category?, limit? }`); `node src/scripts/run_eval.js --batch`, `grade_eval.js --run … --batch` | answers in `ai_batch_items`, scores + per-question / per-state / per-dimension means and cost in the first batch's `output.eval` (`GET /api/admin/ai-batches/:id/eval`); the scripts also write `responses.json` / `grades.json` |
| Content staleness | `contentRefresh.js` flags (no AI); the checking is the source re-check batch, stalest first | as §9 |
| "Translate new keys" | Admin → Batch tools → "Draft translations for new text" (`POST /api/admin/ai-batches/translate`) | review file in the batch output (`GET /api/admin/ai-batches/:id/translation-draft`) |

**Translate new keys.** Finds keys present in English but missing (or empty) in any of the seven
other languages — app (`frontend/src/i18n/<lang>.json`) and server (`backend/src/i18n/messages/<lang>.js`)
— one request per catalog × language × 60 keys, the translator brief as the cached system prompt,
structured output `{ translations: [{ key, text }] }` (task `translate_keys`, standard class). Every
draft is checked with the parity tests' rules (`checkDraft`: same `{placeholders}` / `{{x}}` / `%s` /
`${…}` and emoji, not empty, not identical to English, not much shorter, STOP kept in text-message
keys, only keys that were asked); failures are listed with the reason, never in the draft. **Nothing
is applied.** A developer downloads the review file, has it reviewed (a native-speaker legal
translator before launch — docs/TRANSLATIONS.md), then:

```
node backend/scripts/apply-translation-drafts.mjs translation-draft-<id>.json          # dry run: re-check + list
node backend/scripts/apply-translation-drafts.mjs translation-draft-<id>.json --write  # write the catalogs
cd frontend && npx jest --config jest.frontend.config.js src/__tests__/i18nParity.test.js
cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest src/__tests__/i18n_server_content.test.js
```
The script re-checks every draft against the current catalogs, skips keys translated meanwhile,
rewrites the app JSON in English key order and inserts server lines after the nearest preceding key
(comments kept). A server deployed without the app's files drafts the server catalog only.

**Tests** (step 3): `ai_source_checks.test.js` (18: allow-list incl. every registry request, mock web
fetch shapes and 400s, verdict and proposal rules incl. a page from a non-allowed host, overlay,
batch params / result reading / JSONL / pricing, translation checks), `integration/ai_source_checks.int.test.js`
(7, real Postgres: batch lifecycle with partial errors / retry / idempotency / metering / caps, a
source-check run end to end, the non-allowed-host case, admin queue auth + audit + approve / edit /
withhold / restore, eval through batches, translation drafts), frontend `render/sourceChecks.test.tsx`
(5). The mock (`scripts/anthropic-mock-lib.mjs`) speaks the batch endpoints (results reversed on
purpose), per-request errors (`batchErrors`), web fetch results / errors / PDFs and `rogueFetch`.

**Live-key checks** (docs/LIVE_TEST.md section N): the real batch object / results shapes and the
errored-line nesting; a web fetch inside a batch with `output_config.format` (does the final text
block hold the JSON? does a pre-tool text block appear?); `allowed_domains` with a bare host
accepted and a fetch outside it refused (`url_not_allowed`); `max_content_tokens` honoured; HTML
pages arrive as `source.type: "text"` (the quote check depends on it); the batch price in the
console matches `ai_usage_log`; `pause_turn` frequency.

## Settings

All in DEPLOY_ENV_SETUP.md and both `.env.example` files: `AI_MODEL_QUICK|STANDARD|DEEP`,
`AI_EFFORT_*`, `AI_THINKING_*`, `AI_THINKING_HEADROOM_*`, `AI_FALLBACK`, `AI_FALLBACK_MODEL`,
`AI_CACHE`, `AI_CHAT_CACHE_TTL`, `AI_COUNT_TOKENS_THRESHOLD`, `AI_MAX_INPUT_TOKENS`,
`AI_MAX_REQUEST_USD`, `AI_TRACE_PROPAGATION`, `AI_ALERT_MIN_CALLS`, `AI_ALERT_ERROR_PCT`,
`AI_ALERT_REFUSAL_PCT`, `RAG_MIN_SIMILARITY` (step 2), `AI_BATCHES`, `AI_BATCH_MAX_USD`,
`AI_BATCH_MAX_ATTEMPTS`, `SOURCE_CHECK_ENABLED`, `SOURCE_CHECK_MAX_ROWS`, `SOURCE_CHECK_SKIP_DAYS`,
`SOURCE_CHECK_MAX_FETCHES`, `SOURCE_CHECK_PROPOSAL_FETCHES`, `SOURCE_CHECK_MAX_CONTENT_TOKENS` (step 3)
(plus the existing `CLAUDE_MODEL`, `AI_DAILY_BUDGET_USD`,
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

## Needs a live-key check (docs/LIVE_TEST.md sections L, M and N)

Nothing here was verified against the real API: the mock follows the docs. To check with a key:
structured outputs on each model, cache write then read on the second chat question (1h TTL in
`usage.cache_creation.ephemeral_1h_input_tokens`), `count_tokens` on a PDF, server-side fallback
accepted with `"default"` on Sonnet 5.5 / Opus 5.5 (the beta header) and the `fallback` block /
`usage.iterations` shape, a real refusal's `stop_details`, `between_tools` accepted on Sonnet 5.5,
effort `low` + `disabled` on Haiku 5.5, and the `request-id` header.
