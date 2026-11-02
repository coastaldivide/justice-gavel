# AI platform review: findings and fixes (November 2, 2026)

A reviewer who had not seen the build read the AI work (steps 1–5), then verified each finding by
reproducing it with a script or tracing the code end to end. Every finding was fixed with a
regression test. Migration: `00000000000049_ai_review_fixes.sql`. Details are in
docs/AI_PLATFORM.md (§9 source re-checks, §10 batches, §11 documents, §13 Word / PDF drafts).

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | An automatic source re-check could renew a rule's "checked on" date with any sentence from the page, such as the site's welcome line, even when the page now says something different (stored "48 hours", page "12 hours") | The date moves only when the quote supports the stored rule. Claude must also copy the part of the stored rule it compared (`stored_claim`), and that text must really be in the stored row. Every number in it must be in the quote, most of its key words must be in the quote, and every number of the whole stored row must be on the fetched page. Anything less goes to an admin. | `ai_source_checks.test.js` "the quote must support the stored rule (48 hours → 12 hours)" (welcome line, numbers that differ, an invented claim, a number missing from the page, the true match) |
| 2 | High | Citations written without "§" ("Tennessee Code Annotated 40-32-105", "N.J.S.A. 2C:52-2", "ORS 137.225", "KRS 431.073", "A.R.S. 13-905") were not found, so unchecked statutes reached the Word / PDF downloads | A reference is now also found by a state code abbreviation or code word followed by a section number, or by a statute-shaped number on its own. Dates, times, money, phone numbers and year ranges are not treated as citations. The same helper serves the petition check, the downloads and the recap filter. | `ai_memory_documents.test.js` "citations without §" (15 forms withheld, the checked section kept, 8 ordinary-number lines not withheld) |
| 3 | Medium | "By: /s/ Jane Doe" and "Signature: /s/ Jane Doe" kept the typed electronic signature in the downloads | A "/s/" mark anywhere on a line becomes a blank signature line, from the mark onward. The label ("By:") stays, and slashes in links are not touched. | `ai_memory_documents.test.js` "electronic signature marks anywhere on a line" |
| 4 | Medium | A source-check verdict could be applied to a row whose text changed after the batch was sent (a deploy or an admin edit) | Each request stores a hash of the row's text and source. The verdict is applied only if the row still matches it. Database rows are re-read under a row lock before the date moves. Otherwise nothing changes, the row is marked `row_changed`, and it is due on the next run. Approving a review of a changed row is refused (409 `row_changed`) and the review is superseded. | `ai_source_checks.int.test.js` "row changed between the batch and its results" (database row and code row), "approving a review whose row changed" |
| 5 | Medium | If a batch's result handler failed partway (or the server restarted), the remaining results were lost and the batch still showed "processed" | Results are downloaded again on every pass, and the handler gets every item not yet applied (new `applied_at`). In source checks, one item's error does not stop the others. A failing item is tried again and, after 3 tries, recorded as failed. A batch is "processed" only when every item is applied or recorded as failed. Usage is metered once. | `ai_source_checks.int.test.js` "a handler that throws once" (second pass gets all items), "per-item handler errors are isolated" |
| 6 | Medium | Retry batches skipped the per-batch cost cap and the daily budget, and left out the web fetch cost | Retries pass the same checks as a first send, using the stored web-fetch worst case per item. If a cap would be passed, nothing is sent and the items are marked failed. Both checks also set aside the worst case of batches still open. | `ai_source_checks.int.test.js` "retry batches: no POST when the daily budget is exhausted or the per-batch cap would be passed" |
| 7 | Medium | Bond Desk staff accepting two field suggestions at once could lose one of them | The suggestion row is locked, and the form's field map and decisions are merged one key at a time in the database | `ai_documents.int.test.js` D5 (three accepts in parallel, all kept) |
| 8 | Low | Parallel requests could get past the per-person court-paper limit (and the staff form-mapping limit) | The limit is claimed in one step: a per-person lock, count, and record, in one transaction. The court-paper routes also have a burst limit (30 a minute). | `ai_documents.int.test.js` D5 (25 parallel reads with a limit of 20 → exactly 20 AI calls; 25 parallel suggestions with a limit of 20 → 20) |
| 9 | Low | The motion PDF export (AI clean-up, and the saved-draft PDF) skipped the citation withholding that the other downloads apply | Both PDFs now go through the same check (no checked source for motion citations, so every citing paragraph is withheld with the marker) and the same signature rule | `ai_memory_documents.int.test.js` P6 (refined motion with "§ 1983" → PDF shows the marker, no "1983", no "/s/") |

Not changed: Messages requests that use a file id still send the `files-api-2025-04-14` beta
header (the reviewer's minor note; it works today and is listed for the live-key check). A
`pause_turn` retry still resends the request from the start rather than continuing the paused
turn; it is now counted at its full worst case against the caps. Continuing the turn needs a
live-key check.

The reviewer found these areas clean:
- Admin-only routes: source checks, batches, AI diagnostics and metrics check for an admin role.
- No access to other people's records through the new routes: court-paper attachments, chat and research memory,
  petition and motion downloads, and Bond Desk suggestions are all scoped to their owner.
- File ids are never accepted from the app; remote file names carry no personal data.
- Account deletion covers every new table and column, and the remote file copies.
- The web fetch allow-list: official domains only, the never-list wins, no punycode, credentials or wildcards; the
  server never fetches a URL the model supplies; the batch results URL is pinned to the API host.
- AI output is never saved by itself: court-paper fields, form suggestions, proposed sources and corrections all
  wait for a person.
- The conversation recap uses only the person's own words, scrubbed of contact and ID numbers, and nothing is saved
  for a forgotten conversation.
- Streaming chat shows only checked parts; refusals are discarded.
- The .docx and PDF files are valid in en, ar, zh and vi.
- Migrations 44–48 apply cleanly on an empty database.
- Every new text exists in all 8 languages.
- No prompts or document contents are logged.
