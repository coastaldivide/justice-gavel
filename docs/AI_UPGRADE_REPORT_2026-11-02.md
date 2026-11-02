# AI upgrade report, November 2, 2026

Justice Gavel gives legal **information and support, never legal advice**. This upgrade uses the current
Claude platform features to make the app's AI more reliable, cheaper and easier to check. Every rule
still holds:
- legal content is shown only with a cited source and a checked date;
- nothing the AI produces is saved until a person confirms it;
- no drawn or fake signatures;
- no prompts or documents in the logs.

Branch `consumer-core-path`, commits `9f0b171` to `d65fa96`, migrations 44–49. Full technical detail
(request shapes, the doc page each one came from, settings, costs) is in `docs/AI_PLATFORM.md`.

## What was built
| Step | What it does for people | Where |
|---|---|---|
| 1. AI gateway | Every AI call goes through one place, `backend/src/services/aiClient.js`. Simple tasks use a cheaper, faster model and hard ones the most capable. The model must answer in a fixed format, and an answer that fails the check is never shown. A refusal is handled cleanly and the server can fall back to another model. The long chat instructions are cached for 1 hour, which lowers the cost of every chat question. Large requests are measured before sending and refused over the cap. Admins can see cost, errors and refusals. | AI_PLATFORM.md §1–7 |
| 2. Verified citations | Research and chat answers point to the exact passage they came from in our sourced legal library (546 passages). Any legal statement without a passage is hidden: "No source found for this part — not shown". | §8 |
| 3. Source re-checks and batches | Each week, sourced legal rows are compared against the official government page. Only government sites and a short named list are allowed. A "checked on" date moves forward by itself only when Claude quotes the page and the quote supports the stored rule word for word. Anything changed, missing or unclear goes to **Admin → Source checks** for a person to decide, and every decision is recorded. Bulk jobs (source checks, quality tests, translation drafts) run at half price as batches. | §9–10 |
| 4. Documents | **Read my court paper:** a photo or PDF of a court paper becomes a pre-filled court date. Each line shows the words it was read from. Nothing is saved until the person checks it against the paper and taps confirm. **Bond Desk forms:** staff get a suggested app data field for each fillable PDF field, and accept or change each one; signature fields are never suggested. **Upload once:** a document read more than once is uploaded once and deleted with the case or account. | §11 |
| 5. Long chats and downloads | **Long chats** keep a short recap built only from the person's own messages, with contact and ID numbers removed and no legal claims. People can see and erase it ("What the assistant remembers" → "Forget this"). **Downloads:** expungement petitions and saved motions download as Word or PDF. Every page carries "information, not legal advice — have a lawyer or the court clerk review", with a blank signature line; Chinese and Arabic print correctly. | §12–13 |
| Review | An independent reviewer verified 9 defects in steps 1–5: 2 high, 5 medium, 2 low. All are fixed with regression tests. The worst: a source re-check could mark a changed law as checked today. | REVIEW_FIXES_AI_2026-11-02.md |

## Decisions for you
1. **Uploading documents once (`AI_FILES_API`) is off in production by default.** Anthropic's zero-data-retention and HIPAA terms
   don't cover those uploads. With it off, the app sends the document with each request, so nothing is lost.
2. **Downloaded motions lose their legal argument.** The app has no checked source for case law, so every paragraph
   that cites a case or statute is withheld from the Word/PDF download (your sourcing rule). The draft inside the app is unchanged.
3. **"Forget this" is permanent for that chat.** No new recap is made; the chat sends its last 20 messages, as before the upgrade.
4. **Privacy policy (May 2025) needs new wording** for the stored chat recaps, the kept petition drafts and the court
   paper reader. You or counsel should add it before launch; it was not edited.
5. **Source coverage.** 161 rows have an official page and are re-checked. 265 rows rest only on Justia, CCRC or RCFP,
   so they are never fetched; for Tennessee and federal rows the job proposes an official page for an admin to approve.
6. **Cost caps.**
   - Each weekly source-check run is limited to 100 rows and `AI_BATCH_MAX_USD` ($10); the worst case is about $5.70.
   - Court paper reads are limited to 10 an hour and 20 a day per person, at about $0.01 to $0.02 each.
   - A chat recap costs about $0.001.

## Not built, and why
- **Anthropic's ready-made compaction, memory tool and context editing.** Compaction returns a sealed summary we
  can't show the person or check, and it would carry the AI's legal statements forward without their sources.
  Context editing has nothing to clear in these chats. The memory tool lets the model decide what to remember.
  Our own recap does the same job in a way people can see and erase.
- **Anthropic's ready-made Word/PDF skills.** They need Anthropic's code-running sandbox, which the
  zero-data-retention terms don't cover. The files are built on our server instead.
- **A letter-to-the-court or records-request generator.** No such feature exists in the app, so no downloads were added for one.
- **Hosted agents run by Anthropic.** Optional and not needed now.

## Before turning it on with a real key
Nothing here could be tested against the real Claude API from the build machine. Everything was tested against
a stand-in that follows the official documentation. Run `docs/LIVE_TEST.md` sections L–P on staging with
your key (about 2¼ hours, plus up to an hour waiting for a batch). They cover:
- caching, fallback and refusals;
- citations;
- source checks and batches;
- reading accuracy on real court papers in English and Spanish;
- recap quality;
- the Word file opening in Word, Google Docs and LibreOffice.

## Final verification (November 2, 2026, fresh Postgres 16 database, migrations 00–49)
| Check | Result |
|---|---|
| Database and security suites (real Postgres) | 531 tests passed |
| Backend unit suite | 28,622 tests passed |
| Frontend logic and screen tests | 874 + 401 passed; TypeScript clean |
| Smoke test against a running server | 44/44 |
| Route sweep with the AI stand-in (846 routes × 6 callers) | no findings |
