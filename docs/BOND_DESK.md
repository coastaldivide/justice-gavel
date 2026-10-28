# Bond Desk — bond paperwork, e-signature and bond records for bail agents

Built October 26, 2026 to match what eBail and Captira include in their $99–$349/month plans
(Captira's published comparison and its Easy Bail page, read Oct 26 2026):

| Competitor feature | Bond Desk |
|---|---|
| Surety forms + custom forms grouped into packets | Agent uploads their own PDF forms (surety-issued or custom) once; picks forms per packet |
| Form fields filled from the case file ("Customer Care loads your forms") | The agent maps each fillable PDF field to a case-file value once per form; filled on every packet |
| Question wizard: basic / full / custom question sets | Same three: `basic`, `full`, plus up to 10 custom questions |
| Intake by link sent by text or email; in-office; agent-driven | Link by text and/or email; the agent can also open the same link on an office tablet |
| Indemnitors / co-signers sign by link | Every signer (defendant, each indemnitor) gets their own link |
| Document requests (ID, proof of income) stored on the record | Same, stored encrypted |
| ID verification: selfie holding a government ID, timestamped | Same (photo upload or camera); timestamp recorded by the server |
| E-signature, no per-document fee, signed timestamped PDFs to the case file | Typed-name signature (ESIGN Act / UETA), no per-document fee, signed PDF + certificate stored on the bond |
| Live status: sent, opened, partially completed, signed | Same timeline per signer |
| Prospect pipeline | Bonds in status `prospect` |
| Power inventory with liability tracking | Powers by surety and number, limit, status; liability per surety |
| Surety / DOI reporting | Liability, surety (executed powers), receivables, receipts journal, collateral — on screen and CSV |
| Forfeiture tracking | Forfeiture date, deadline, outcome; dashboard sorted by days left |
| Online payments / payment plans | Payment ledger, numbered receipts, payment plans with overdue tracking; **card payments to the agency's own Stripe account** (Stripe Connect Express): automatic payment-plan charges (⚖, see below) and a public "Pay {agency}" page |
| Auto Pay (Captira), Bail Pay | Automatic payment plans (payer saves a card by link; 99¢ per charge) and the pay page |
| Unlimited users / offices | Staff seats per plan: Starter 3, Pro 10, Market 20 (owner included) |
| Forms loaded for you, data import, backups | Justice Gavel staff map the agency's surety PDFs on request; CSV import of open bonds; export everything as one ZIP |
| SMS 5¢ each | 5¢ per text actually delivered to the carrier, billed on the agent's next invoice |

**Not built on purpose:** a drawn ("finger") signature pad. A typed name with intent, consent and
an audit trail is a valid electronic signature under the federal ESIGN Act (15 U.S.C. § 7001,
§ 7006(5)) and the UETA; it adds nothing to draw squiggles. **No general-ledger accounting,
BUF/premium-remittance math or surety commission splits:** no competitor publishes that, and
surety contracts round and split differently, so any computed remittance could be wrong. The
ledger only adds and subtracts whole cents the agent entered.

Everything is under `/api/bond-desk` for the agent and `/api/sign` for the people signing.

## Access

A bail agent (a `bondsman_profiles` row) with a bail-agent plan in status `active` or `past_due`,
or an admin, or a **staff member** of such an agency (`bd_staff`, see "Staff and seats": they work in
the owner's desk — every row they create belongs to the owner). Otherwise 403 `{ code: 'no_plan' }`
(agent without plan, or staff whose agency has no plan) or 403 `{ code: 'not_agent' }`.
Owner-only routes answer 403 `{ code: 'owner_only' }` to staff.

`GET /api/bond-desk/access` (sign-in only, never 403) →
```
{ allowed: bool, reason: null | 'not_agent' | 'no_plan', plan: 'starter'|'pro'|'market'|null,
  role: 'owner'|'staff'|null, texts_live: bool, email_live: bool, storage_live: bool, text_cents: 5,
  autopay_enabled: bool }
```
`storage_live` false → uploads answer 503 `storage_unavailable`.

## Money, dates

All money is integer cents (`*_cents`). Dates are `YYYY-MM-DD` strings; "today" is the agent's
local day (users.timezone, else the default zone). Timestamps are ISO strings.

## Bonds

Statuses and allowed moves (`POST /bonds/:id/status`):

| from | to |
|---|---|
| prospect | active (needs `date` = posted_on), cancelled |
| active | forfeited (needs `date` = forfeited_on and `deadline_on`), exonerated (`date`), surrendered (`date`) |
| forfeited | active (reinstated; `date`), exonerated, surrendered, forfeiture_paid (`date`, `amount_cents`) |
| exonerated, surrendered, forfeiture_paid, cancelled | — (final) |

Liability = bond amounts of bonds `active` + `forfeited`.

Bond object:
```
{ id, status, defendant_name, defendant_dob, defendant_phone, defendant_email, defendant_address,
  case_number, court_name, county, state, court_date, charges, bond_amount_cents, surety_name,
  posted_on, forfeited_on, forfeiture_deadline_on, discharged_on, forfeiture_paid_cents,
  checkin_enrollment_id, notes, created_at, updated_at,
  power: { id, surety_name, number, limit_cents } | null }
```
- `GET /bond-desk/bonds?status=&q=` → `{ bonds: [ bond + { balance_cents, packet_status } ] }` (q matches defendant name / case number)
- `POST /bond-desk/bonds` body: bond fields (required `defendant_name`, `bond_amount_cents` > 0; `state` 2 letters) → `{ bond }` (status `prospect`)
- `GET /bond-desk/bonds/:id` →
```
{ bond, indemnitors: [indemnitor], charges: [charge], payments: [payment], installments: [installment],
  collateral: [collateral], packets: [packetSummary],
  money: { charged_cents, paid_cents, balance_cents, plan_scheduled_cents, plan_in_sync, overdue_cents, next_due: installment|null } }
```
- `PATCH /bond-desk/bonds/:id` any bond field except status/dates of status/power → `{ bond }`
- `POST /bond-desk/bonds/:id/status` `{ status, date, deadline_on?, amount_cents?, note? }` → `{ bond }`; 409 `bad_transition`. A note is appended to the bond's notes with the date and the move. Posting a bond sets its power's executed date to the posted date.
- `POST /bond-desk/bonds/:id/power` `{ power_id }` executes an available, unexpired power whose limit ≥ bond amount on this bond (one power per bond) → `{ bond }`; 409 `power_unavailable` / `power_limit` / `power_expired` / `bond_has_power`

Indemnitor: `{ id, bond_id, full_name, relationship, phone, email, address, dob, employer, created_at }`
- `POST /bond-desk/bonds/:id/indemnitors` (required `full_name`) · `PATCH /bond-desk/indemnitors/:id` · `DELETE /bond-desk/indemnitors/:id` (409 `on_packet` once on a sent packet)

## Ledger (premium and fees owed, payments received)

- Charge: `{ id, kind: 'premium'|'fee', amount_cents, description, created_at, voided_at, void_reason }`
  - `POST /bond-desk/bonds/:id/charges` `{ kind, amount_cents, description }` · `POST /bond-desk/charges/:id/void` `{ reason }` (409 `would_go_negative` if voiding makes payments exceed charges)
- Payment: `{ id, receipt_no: 'R-000123', amount_cents, method, reference, payer_name, received_on, created_at, voided_at, void_reason, source: 'manual'|'autopay'|'pay_link' }`
  - methods: `cash`, `check`, `card`, `money_order`, `bank_transfer`, `other`
  - `POST /bond-desk/bonds/:id/payments` `{ amount_cents, method, payer_name, received_on?, reference? }` → `{ payment }`; 409 `over_balance` when amount > balance; received_on cannot be in the future
  - `POST /bond-desk/payments/:id/void` `{ reason }` (receipt numbers are never reused)
  - `GET /bond-desk/payments/:id/receipt.pdf`
- Receipt numbers are per agency, sequential, assigned in the same database transaction. Every payment —
  typed in, automatic, or from the pay page — is posted by one function (`services/bondDesk/payments.js`
  `postPayment`): bond locked, balance checked, receipt number drawn; a card payment carries its Stripe
  PaymentIntent id, which is unique, so it is posted at most once.
- Payment plan: `PUT /bond-desk/bonds/:id/plan` `{ installments: [{ due_on, amount_cents }] }` replaces the plan; the amounts must add up to the bond's total non-void charges exactly (409 `plan_total`); `[]` removes it.
  Installment: `{ id, due_on, amount_cents, covered_cents, status: 'paid'|'partial'|'due'|'overdue' }` — payments (non-void, total) cover installments in due-date order.
  `money.plan_in_sync` is false when charges changed after the plan was saved.
- `POST /bond-desk/bonds/:id/remind` `{ to: 'defendant'|'indemnitor', indemnitor_id?, channel: 'sms'|'email', consent_confirmed: true }` sends a payment reminder (text is metered 5¢). 409 `opted_out` if the number replied STOP.

## Collateral

`{ id, receipt_no: 'C-000045', kind: 'cash'|'real_estate'|'vehicle'|'jewelry'|'other', description, value_cents, received_from, received_on, returned_on, returned_to, created_at }`
- `POST /bond-desk/bonds/:id/collateral` · `POST /bond-desk/collateral/:id/return` `{ returned_to, returned_on }` · `GET /bond-desk/collateral/:id/receipt.pdf`

## Powers (power-of-attorney inventory)

`{ id, surety_name, number, limit_cents, received_on, expires_on, status: 'available'|'executed'|'void'|'returned', bond_id, executed_on, void_reason, defendant_name }`
- `GET /bond-desk/powers?status=&surety=` → `{ powers, sureties: [name] }`
- `POST /bond-desk/powers` `{ surety_name, prefix, start, end, limit_cents, received_on, expires_on? }` adds powers `prefix + start … prefix + end` (max 500) → `{ created, skipped }` (numbers already on file are skipped)
- `POST /bond-desk/powers/:id/void` `{ reason }` · `POST /bond-desk/powers/:id/return`

## Forms library

Form: `{ id, name, page_count, roles: ['defendant'|'indemnitor'], fields: [{ name, type: 'text'|'checkbox'|'other' }], field_map: { [fieldName]: dataKey }, archived, created_at }`
- `GET /bond-desk/forms` → `{ forms, data_keys }` (`data_keys`: the list below)
- `POST /bond-desk/forms` multipart: `file` (PDF ≤ 10 MB, not password-protected), `name` → `{ form }`; 400 `bad_pdf`
- Forms still being set up by Justice Gavel staff (`setup_pending`, see "Forms set up for you") are not listed and cannot be sent.
- `GET /bond-desk/forms/:id/preview.pdf` without `bond_id` fills sample data (used by staff, who have no bond of the agency's).
- `PATCH /bond-desk/forms/:id` `{ name?, roles?, field_map? }` (only `text` fields can be mapped; unknown keys → 400 `bad_field_map`)
- `POST /bond-desk/forms/:id/archive` · `GET /bond-desk/forms/:id/file` (original) · `GET /bond-desk/forms/:id/preview.pdf?bond_id=` (filled with that bond's data, for checking the mapping)

Data keys (`data_keys` array, in this order):
`bond.defendant_name, bond.defendant_dob, bond.defendant_address, bond.defendant_phone, bond.defendant_email,
bond.case_number, bond.court_name, bond.county, bond.state, bond.court_date, bond.charges, bond.bond_amount,
bond.premium, bond.power_number, bond.surety_name, agent.name, agent.agency, agent.license, agent.phone,
agent.email, signer.full_name, signer.role, signer.relationship, signer.phone, signer.email, signer.address,
signer.dob, signer.employer, signer.employer_phone, signer.job_title, signer.monthly_income,
signer.years_at_address, signer.drivers_license, signer.vehicle, signer.reference_1, signer.reference_2,
date.today, signature.name, signature.date`

`signature.name` / `signature.date` are filled only on the signed copy ("/s/ Full Name" and the
signing date). Everything else is filled when the signer's copy is prepared.

## Packets (send forms to sign)

Each signer signs their **own copy** of each form whose `roles` include their role (counterparts).

- `POST /bond-desk/bonds/:id/packets`
```
{ form_ids: [id], signers: [{ role: 'defendant' } | { role: 'indemnitor', indemnitor_id }],
  questions: 'none'|'basic'|'full', custom_questions: [string] (≤ 10, ≤ 200 chars),
  doc_requests: ['id_front','id_back','selfie_with_id','proof_of_income','proof_of_address'],
  deliver: 'sms'|'email'|'both'|'none', consent_confirmed: true (needed for sms) }
```
→ `{ packet, signers: [{ id, name, role, link, delivery: { sms: 'sent'|'skipped'|'failed'|'opted_out'|null, email: … } }] }`
`link` is shown only in this response and in the `/link` response (the server keeps a hash).
- `GET /bond-desk/packets/:id` →
```
{ packet: { id, bond_id, status: 'sent'|'in_progress'|'completed'|'voided', questions, custom_questions, doc_requests, created_at, completed_at, voided_at },
  signers: [{ id, role, name, phone, email, status: 'sent'|'opened'|'in_progress'|'signed'|'declined', sent_at, opened_at, signed_at,
              declined_reason, answers, events: [{ event, at, ip }] }],
  documents: [{ id, signer_id, form_id, name, status: 'pending'|'prepared'|'signed', prepared_sha256, signed_sha256 }],
  uploads: [{ id, signer_id, kind, content_type, size, created_at }] }
```
- `POST /bond-desk/packets/:id/signers/:signerId/link` `{ deliver, consent_confirmed }` → `{ id, name, role, link, delivery }`; the old link stops working
- Signer timeline events: `sent`, `delivery_sms` / `delivery_email` (detail: sent, skipped, failed, opted_out), `opened`,
  `answers_saved`, `uploaded` (detail: kind), `prepared`, `viewed` (detail: document id), `signed` (detail: language the
  consent was shown in), `declined`, `link_rotated`; packet-level: `voided`
- `POST /bond-desk/packets/:id/void` `{ reason }`
- `GET /bond-desk/documents/:id.pdf` (signed copy if signed, else the prepared copy) · `GET /bond-desk/packets/:id/signed.pdf` (all signed copies merged) · `GET /bond-desk/uploads/:id` (file)

## Signing (public, by link: `https://<app>/sign/<token>`)

Token = 32 random bytes (base64url); valid 30 days from sending; 60 days after signing (download).
- `GET /api/sign/:token` →
```
{ agency: { name, phone, license }, signer: { name, role }, status, defendant_name,
  questions: [{ key, label_key: 'sgn_q_<key>' | null, label (custom questions) | null, required }], answers,
  doc_requests: [{ kind, uploaded: bool }], documents: [{ id, name, viewed: bool }] (empty until prepared),
  prepared: bool, signed_at, lang, consent: { version: 'esign-2026-10', text_key: 'sgn_esign_consent' } }
```
404 `link_invalid` · 410 `link_expired` · 410 `packet_voided`. First call records `opened`.
- `POST /api/sign/:token/answers` `{ answers: { key: value } }` (until prepared)
- `POST /api/sign/:token/uploads` multipart `file` (JPEG/PNG/HEIC/PDF ≤ 10 MB), `kind`
- `POST /api/sign/:token/prepare` → fills this signer's copies (needs required answers and requested uploads) → `{ documents }`; answers are then locked
- `GET /api/sign/:token/documents/:id.pdf` → the copy to review (records `viewed`)
- `POST /api/sign/:token/sign` `{ typed_name, agree_esign: true, agree_terms: true, lang }` → `{ signed_at }`; 409 `not_viewed` (every document must be opened first), 400 `name_mismatch` (must match the signer's name, ignoring case/spaces)
- `POST /api/sign/:token/decline` `{ reason }`
- `GET /api/sign/:token/signed.pdf` → this signer's signed copies (each followed by its signature certificate)

The consent wording printed on the certificate is, word for word, the English text of the page's
`sgn_esign_consent`, `sgn_agree_esign` and `sgn_agree_terms` (a test keeps them equal); when the signer
saw it in another language the certificate says which.

The signature certificate page lists: document name, SHA-256 of the copy reviewed and of the signed
copy, signer name typed, role, how the link reached the signer (only channels that actually delivered it, masked; otherwise "given directly by the agent"), timestamps (UTC) of sent / opened / each
document viewed / signed, IP address and browser, and the consent wording agreed to.

## Court dates and reminder texts

A bond has any number of hearings (`bd_court_dates`, migration 35). `bond.court_date` is kept as the
next scheduled hearing (or, with none ahead, the latest one not cancelled), so the bond list, forms
(`bond.court_date`) and reports keep working. Setting the court date on the bond form moves the hearing
it showed (or adds one); the hearings themselves are managed here:

- `GET /bond-desk/bonds/:id/court-dates` →
  `{ court_dates: [{ id, court_date, court_time, court_name, room, status, status_source, status_at, asked_at, is_past }],
     reminders_on, text_lang, time_zone, today, texts_live, bond_status,
     recipients: [{ to: 'defendant'|'indemnitor', indemnitor_id, name, phone, phone_masked, consent, consent_at, opted_out }] }`
- `POST /bond-desk/bonds/:id/court-dates` `{ court_date, court_time?: 'HH:MM', court_name?, room? }` → 201 (409 `duplicate`, at most 50)
- `PATCH /bond-desk/bonds/:id/court-dates/:cdId` — any of those fields and/or `status`:
  `scheduled | attended | missed | rescheduled | cancelled` (set by the agent: `status_source: 'agent'`)
- `DELETE /bond-desk/bonds/:id/court-dates/:cdId` — removed; its texts not yet sent are cancelled
- `GET /bond-desk/bonds/:id/reminders` → `{ reminders: [{ id, court_date_id, court_day, step, signer_type, name, to_masked,
  send_at, status: pending|sending|sent|skipped|cancelled|failed, reason, sent_at, delivery_status, error_code }] }`
  (`delivery_status` from Telnyx: delivered / delivery_failed / sending_failed / delivery_unconfirmed; null until reported)
- `PUT /bond-desk/bonds/:id/reminders` `{ on: bool, lang?: en|es|pt|vi }` — the per-bond switch (on by default) and text language
- `PUT /bond-desk/bonds/:id/text-consent` `{ to: 'defendant'|'indemnitor', indemnitor_id?, consent_confirmed: bool }` — the agent's
  "the person gave me this phone number for texts about this bond" for that person's **current** number. A changed number
  needs a new confirmation; until then nothing is texted to it.

**Who and when.** Texts go only for an **active** bond with the switch on, to the defendant and every indemnitor whose
number is confirmed and has not replied STOP (one text per number). Times are wall-clock times in the bond's zone: its
county (split states such as east Tennessee, the Florida panhandle, El Paso), else its state, else the agent's zone:

| step | when | to | text |
|---|---|---|---|
| d7, d3 | 7 and 3 days before, 09:00 | defendant + indemnitors | court reminder |
| d1 | evening before, 18:00 | defendant + indemnitors | court reminder |
| d0 | morning of, 06:30 | defendant + indemnitors | court reminder |
| now | at once, when a hearing is added too late for all of the above | defendant + indemnitors | court reminder |
| ask | 15:00 on the court day | defendant | "Did you make it to court today? Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it" |
| missed | 09:00 the next day, unless marked attended / rescheduled / cancelled by then; at once when marked missed | defendant | "If you missed court, act today…" + link to `/missed-court` |

The morning after (09:00) a hearing still not marked attended or rescheduled, the agent gets a push and an e-mail.
A reply **1 / 2 / 3** from the defendant within 48 hours of the question sets the hearing to attended / rescheduled / missed
(`status_source: 'reply'`; a status the agent set is never overwritten), is confirmed by text, and "missed" sends the
"act today" text at once and alerts the agent ("rescheduled" alerts the agent too). Any other reply changes nothing.

Every row in `bd_reminders` is unique per hearing + court day + number + step, so a step is never texted twice; the job
`bd-court-reminders` (every 5 minutes, `services/bondDesk/courtDates.js`, monitored in `/api/admin/diagnostics/jobs`)
re-checks the bond, hearing, number and confirmation before each text. Closing the bond (exonerated, surrendered,
forfeiture paid, cancelled) or a forfeiture cancels pending texts; reinstating re-plans them.

**Wording (English; es / pt / vi / ht / zh / ar / tl in `i18n/messages`).** English texts stay within 2 segments (GSM-7).
Spanish, Portuguese, Vietnamese, Chinese and Arabic keep their own letters (owner decision, October 27 2026), so they are
sent as Unicode and may use up to 6 segments (about 5–6 for a reminder); Haitian Creole and Tagalog are usually plain
GSM-7 and may use up to 3 GSM-7 segments (`MAX_GSM_SEGMENTS_OTHER`); long names / court names are shortened only beyond that.
Defendant: "{agency}: {first name}, court is in 7 days, Wed, Sep 30 at 10:30 AM at {court}, room {room}. If you miss it, a
warrant can be issued and your bond can be forfeited. Expect security; bring ID and court papers. How will you get there?
Make a plan now. Reply STOP to opt out." Indemnitor: "{agency}: You co-signed {name}'s bail bond. Court is …".
These Bond Desk texts carry no plan link: a Bond Desk defendant may have no app account, and their only page is the
check-in link (below). The app's own reminder texts link to the court date's "Plan your court day" (docs/COURT_DAY_HELP.md).

**Help getting to court on the check-in link page (A8).** When the defendant has a check-in text link, its page
(`/c/<token>`) shows the bond's next hearing (day, time, court, room — nothing else) with "Call 211", the county's
transit agency where `backend/src/data/transit_agencies.js` has a cited row for the bond's county, and map directions.

**Court-date phone line (A10).** A defendant whose number is on an open bond can call the toll-free line and hear the
next hearing's day, time, court and room, or get it by text (docs/PHONE_LINE.md). No case details or balances are read.

**"Your bail agent" card and phone verification.** A defendant's account sees the agency, court date and balance only
through a check-in enrollment linked by a phone number the account VERIFIED with a texted code (migration 40;
docs/CHECKINS.md). No bond is ever matched to an account by an unverified phone or by e-mail.

## Texts (5¢ each)

Every text sent for an agent (signing links, payment reminders, court reminders, "Did you make it?", the
"act today" text and reply confirmations — purposes `signing_link`, `payment_reminder`, `court_reminder`, `court_ask`,
`court_missed`, `court_reply`; card payments: `autopay_link`, `autopay_failed`, `autopay_action`, `payment_receipt`) is logged. `GET /bond-desk/texts?month=YYYY-MM`
Every text sent for an agent (signing links, payment reminders, and check-in texts — link, reminder,
missed-check-in text to the defendant, missed-check-in alert to the agent; docs/CHECKINS.md; re-arrest alerts
`rearrest_alert`) is logged. `GET /bond-desk/texts?month=YYYY-MM`
→ `{ month, count, cents, rows: [{ at, purpose, to_masked, bond_id }] }`. Once a day, unbilled texts are added
to the agent's next bail-agent plan invoice as one line (Stripe invoice item), exactly once.

## Reports (`?format=csv` for a CSV file)

- `GET /bond-desk/reports/liability` → `{ by_surety: [{ surety_name, bonds, amount_cents }], bonds: [...] , total_cents }`
- `GET /bond-desk/reports/surety?surety=&from=&to=` → executed powers in range: `{ rows: [{ power_number, executed_on, defendant_name, case_number, bond_amount_cents, premium_cents, status }], totals }`
- `GET /bond-desk/reports/receivables` → every bond with a balance (cancelled bonds included): charged, paid, balance, overdue, next due
- `GET /bond-desk/reports/receipts?from=&to=` → payments (voided shown, excluded from totals), `by_method: [{ method, amount_cents }]`, `total_cents`
- `GET /bond-desk/reports/collateral` → collateral held (not returned)
- `GET /bond-desk/reports/tn-quarterly?quarter=YYYY-Qn` → the Tennessee quarterly report (CSV or PDF too) — see below
- `GET /bond-desk/reports/appearance?from=&to=` → the agent's own hearings by county (or state) and month of the hearing:
  `{ rows: [{ region, month, asked, attended, rescheduled, missed, no_answer }], totals }` (counts only; `no_answer` = asked
  and still scheduled). Admins see the same for every agent and for app users: `GET /api/admin/metrics/appearance?from=YYYY-MM&to=YYYY-MM`.

## Dashboard

`GET /bond-desk/dashboard` →
```
{ counts: { prospect, active, forfeited }, liability_cents, receivable_cents, overdue_cents,
  overdue: [{ bond_id, defendant_name, due_on, amount_due_cents }],
  forfeitures: [{ bond_id, defendant_name, deadline_on, days_left }],
  awaiting_signature: [{ packet_id, bond_id, defendant_name, pending }],
  texts_this_month: { count, cents },
  missed_checkins: [{ bond_id, enrollment_id, defendant_name, day }],   // last 7 days, bonds linked to a check-in enrollment
  rearrests: [{ id, bond_id, defendant_name, match, status, booking: {...} }] }   // last 30 days (⚖ setting on), possible matches first
```

## Re-arrest alerts (⚖ counsel question 1.2 — `BOND_REARREST_ALERTS_ENABLED`, off in production)

After every roster import (`services/arrest_ingest.js`: nightly and every two hours with `LIVE_REFRESH`), the
NEW bookings are compared with the defendants of the agent's **active and forfeited** bonds
(`services/bondDesk/rearrest.js`):

- **Match** ("strong"): normalized first name + last name (case, accents, commas, initials, suffixes and
  name particles ignored) **and** date of birth. The date of birth comes from the bond (`defendant_dob`, on the
  bond form) or from the defendant's answer in a Bond Desk questionnaire. A booking whose date of birth differs
  from every one on file is not the defendant and is not shown at all.
- **Possible match**: the same first and last name when the roster or the bond has no date of birth (and the
  same state when both have one). The agent **confirms** or **dismisses** it.
- `bd_rearrests` is unique on (bond, booking): an agent is never alerted twice for one booking.
- Never matched: sample / seed rows, records taken down (`suppressed`), and rows whose roster status says
  sealed or expunged (`utils/arrestVisibility.js`). A record taken down later disappears from the bond.
- The agent who wrote the bond is told by **push** and **e-mail**, and by **text** when they turned "Text me too"
  on (strong matches only; 5¢, purpose `rearrest_alert`). The match is added to the bond timeline and the dashboard.
- **Coverage is shown honestly** on the bond: "Watching the jail rosters we import for: <counties>" (from
  `ARREST_FEED_URLS`; a feed without a county lists the counties it sent in the last 30 days). Never "nationwide".
- **Price**: included on every bail-agent plan for now (no extra charge); the agent needs a plan. Only texts cost 5¢.

Routes: `GET /bond-desk/bonds/:id/rearrests` → `{ coverage: { feeds_configured, counties: [{ county, state }] },
watching, dob_on_file, matches: [...], settings, text_cents }`; `POST /bond-desk/rearrests/:id/confirm|dismiss`;
`GET|PUT /bond-desk/rearrest-settings` `{ rearrest_text, alert_phone? }` (the agency phone when empty);
`GET /bond-desk/bonds/:id/timeline` → `{ events: [{ kind, detail, at }] }`. Setting off → 503 `feature_unavailable`;
`GET /bond-desk/access` returns `features: { rearrest_alerts, recovery_sharing }` and the app hides what is off.

## Recovery-agent sharing (⚖ state recovery-agent rules — `BOND_RECOVERY_SHARING_ENABLED`, off in production)

A bail agent shares ONE **forfeited** bond with a recovery agent (`services/bondDesk/recoveryShares.js`):

- The share screen shows the bond state's recovery-agent rule from `routes/recovery_agents.js` (law, notes,
  source) with how it was checked — "checked against secondary summaries, not the statute" or "not verified".
  The agent must tick that they read it. Where that data says recovery is not allowed (IL, KY, MA, OR, WI)
  sharing is refused.
- **Invite by e-mail**: a personal link `https://<app>/recovery/<token>` (32 random bytes, only the SHA-256 is
  stored, 14 days). The recovery agent signs in or creates an account **with the invited address** and accepts;
  the share is then bound to that account. The agent also sees the link to send it another way.
- **Read only**: defendant name and date of birth, photo if one was uploaded with the paperwork (selfie with ID,
  else ID front), the last known addresses and phones from the bond and the questionnaire, employer, references
  and vehicle answers, the last 10 check-ins (locations only when the defendant shared them **and** the agent ticked
  "include check-in locations"), re-arrest matches, the forfeiture deadline and the agent's contact details.
- **Access ends** when the bond is reinstated, exonerated, surrendered or the forfeiture is paid (checked on every
  read and on every status change) and when the agent stops sharing.
- **Every view is logged** (`bd_recovery_views`: details or photo, time) and listed under the share for the agent.

Routes (agent): `GET /bond-desk/bonds/:id/recovery` → `{ bond_status, state, state_rule, shares: [{ id, invite_email,
status: invited|active|invite_expired|ended, ended_reason, views: [{ what, at }] }] }`;
`POST /bond-desk/bonds/:id/recovery/shares { email, share_locations, rule_acknowledged: true }` → 201 `{ share, link, email_status }`;
`POST /bond-desk/recovery/shares/:id/revoke`. Recovery agent (any signed-in account):
`POST /api/recovery-shares/accept { token }`, `GET /api/recovery-shares`, `GET /api/recovery-shares/:id`,
`GET /api/recovery-shares/:id/photo`.

## Tennessee quarterly report (Department of Revenue)

**What the law requires** (checked **October 27, 2026**): Public Chapter 396 (2025) — HB 785 / SB 1237, effective
July 1, 2025, cited by the Tennessee Department of Revenue as **T.C.A. § 40-11-314** — requires every professional
bondsman licensed in Tennessee to file a **quarterly report with the Department of Revenue** stating (1) the total
number of bonds issued in the preceding quarter, (2) the number of bonds issued in each county in which the
bondsman operated, and (3) the total amount of the bondsman's liability in each county. Due **January 25, April 25,
July 25 and October 25** (first report October 25, 2025), as a new schedule of the Bail Bond Tax Return (Form PRV413).
Sources:
- Tennessee Department of Revenue, Important Notice #25-08 (May 2025):
  https://www.tn.gov/content/dam/tn/revenue/documents/notices/bailbond/bailbondsmen2025.pdf
- Department of Revenue news item: https://www.tn.gov/revenue/news/2025/5/8/-important-notice--bail-bondsmen-court-clerk-quarterly-reports.html
- Bill history (HB 785 "Comp. became Pub. Ch. 396"): https://fastdemocracy.com/bill/tn/114/bills/TNB00055355

`GET /bond-desk/reports/tn-quarterly?quarter=YYYY-Qn` (default: the last full quarter; `&format=csv` or `&format=pdf`)
→ `{ quarter, period_from, period_to, due_on, citation, checked_on, totals, counties: [{ county, bonds_issued,
liability_issued_cents, open_bonds_at_end, liability_open_at_end_cents }], needs_county: [...] }`. Counted: the agent's
bonds with state TN posted in the quarter (prospects and cancelled bonds were never issued). The notice does not
define "liability in each county", so both readings are given, labelled: bonds issued in the quarter, and bonds still
open at the end of the quarter — confirm with the Department which one its schedule asks for. Bonds posted in the
quarter without a state or Tennessee county are listed so the agent can fix them. The CSV and PDF headers cite the law,
the date it was checked and the sources. The report is prepared from Bond Desk entries; it is not a filing.
## Card payments (Stripe Connect)

Money a defendant or indemnitor pays goes to the **agency**, never to Justice Gavel. Each agency
connects its own **Stripe Express** account; every card payment is a **direct charge on the agency's
connected account** (Checkout sessions and PaymentIntents are created with the `Stripe-Account` header).
Why direct charges: the agency is the merchant of record (its name on the payer's card statement), the
saved cards (customers, payment methods) belong to the agency's account, and Stripe's processing fee is
taken from the agency's balance by Stripe itself — exactly "Stripe's fee is the agency's" with no
bookkeeping on our side. Justice Gavel's 99¢ per automatic charge is that charge's
**`application_fee_amount`**: collected by Stripe only when the charge succeeds, never on a failed one,
no invoice line to reconcile, and it works even if the agency's plan invoice is unpaid (billing it
"like texts" would need a second exactly-once ledger and could leave fees unpaid). Charges under $1
carry no fee; the pay page carries none.

- `GET /bond-desk/connect` → `{ status: 'none'|'onboarding'|'restricted'|'enabled', charges_enabled, payouts_enabled,
  details_submitted, disabled_reason, fees_acknowledged_at, pay_link, pay_link_on, payments_live, autopay_available,
  autopay_fee_cents: 99, pay_link_limits: { min_cents: 100, max_cents: 5000000 }, role }`
- `POST /bond-desk/connect/start` (owner) `{ fees_acknowledged: true }` → `{ url }` — the Express account is created once
  (`metadata.agent_id`, idempotency key `bd-connect-account-<agent>`), then a fresh Stripe onboarding link
  (return `/bond-desk/settings?connect=return`, refresh `…?connect=refresh`). 400 `fees_ack_required` without the box.
- `POST /bond-desk/connect/refresh` re-reads the account from Stripe · `POST /bond-desk/connect/dashboard` (owner) → `{ url }` Express dashboard
- `PUT /bond-desk/connect/pay-link` (owner) `{ on }`
- Webhook `account.updated` (Connect endpoint, `STRIPE_CONNECT_WEBHOOK_SECRET`) copies the flags. Same handler,
  signature check and replay protection (`stripe_event_log`) as every other Stripe event.
- The app shows the fee terms before set-up: Stripe's card fee is the agency's (taken from the payout; Stripe's
  prices at stripe.com/pricing — no number is quoted by us), 99¢ per automatic payment-plan charge, all payments final,
  disputes handled in the agency's Stripe account. Until `charges_enabled`, Bond Desk shows "Set up card payments".

## Automatic payments (A5, ⚖ counsel question 3.2)

Off unless `BOND_AUTOPAY_ENABLED` (unset = off in production, on elsewhere). Off: the routes below answer
503 `feature_unavailable`, the job does nothing, the app hides the card.

1. **Link.** `POST /bond-desk/bonds/:id/autopay/link` `{ to: 'defendant'|'indemnitor', indemnitor_id?, deliver: 'sms'|'email'|'both'|'none',
   consent_confirmed (texts), lang }` → 201 `{ autopay, link, delivery }`. Needs card payments on, a payment plan in sync
   with the charges (409 `no_plan_to_collect` / `plan_out_of_sync` / `nothing_owed`), and no active autopay (409 `autopay_active`).
   The link (`/autopay/<token>`, 32 random bytes, SHA-256 stored) works 30 days for saving a card, and for as long as autopay is on.
2. **Consent.** `GET /api/bd-pay/autopay/:token?lang=` shows the agency, the schedule (the unpaid part of every installment due
   today or later) and the consent text built on the server in the payer's language. `POST …/start { agree: true, consent_version, lang }`
   stores the snapshot on `bd_autopay` (text exactly as shown, version `autopay-2026-10`, language, schedule, IP, browser, time)
   and opens **Stripe Checkout in setup mode on the agency's account** (customer created there). Only Stripe ids, card brand
   and last 4 are stored. `checkout.session.completed` (or the page itself, reading the session) turns autopay on.
   English consent wording (es / pt / vi / ht / zh / ar / tl in `i18n/messages`, `bd.autopay.consent_*`):
   > I authorize {agency} to charge my card for the payment plan on the bail bond for {defendant}, on these dates and in these amounts:
   > • MM/DD/YYYY: $amount (one line per installment)
   > Each amount is charged on its date. A charge is never more than the balance owed on the bond; if part is already paid, only the rest is charged. If a charge does not go through, it is tried once more 3 days later and you are told by text or e-mail. Other dates or amounts need a new link and your agreement.
   > To stop automatic payments at any time, tap "Stop automatic payments" on this page or contact {agency} at {phone}. Stopping does not change what is owed.
   > Your card is kept by Stripe for {agency}; Justice Gavel never sees your card number. Payments go to {agency}.
   > All payments are final.
3. **Job `bd-autopay`** (hourly, `services/bondDesk/autopay.js`, monitored in `/api/admin/diagnostics/jobs`): for every active
   autopay, from 08:00 in the agency's zone, each installment **due today** whose date and amount the payer agreed to is charged
   off-session on the agency's account: amount = the unpaid part, never more than the bond's balance (under 50¢ is skipped);
   idempotency key `bd-inst-<installmentId>-<attempt>`; one `bd_autopay_attempts` row per installment and attempt (unique).
   - succeeded → posted by `postPayment` (`source: 'autopay'`, numbered receipt, oldest-first coverage) exactly once, receipt e-mailed
   - declined → payer texted (if the agent confirmed the number) and e-mailed, agent pushed, e-mailed and texted; retried once 3 days later
   - the bank asks the payer to confirm (`authentication_required`) → the off-session charge is cancelled, the payer gets a fresh link
     by text / e-mail; `POST …/confirm` opens Checkout (payment mode, same fee) and the webhook posts it. **One Checkout session per
     attempt:** a second click, another tab or a refresh gets the session already open (idempotency key
     `bd-action-<attemptId>-<previous session or "first">-<amount>`, so requests that arrive together get the same session);
     if the amount changed since (a payment was recorded), the open session is expired and a new one made; once the session is
     paid, `…/confirm` answers 409 `payment_received`. If a second successful payment for an already-paid attempt still arrives,
     it is **posted** to the bond (taken, "second payment for one installment"), receipt e-mailed, and the agent gets a push and
     an e-mail "Second card payment for one installment" — never dropped. Any refund is the agency's decision in its Stripe dashboard.
   - a charge Stripe did not answer is re-sent with the same idempotency key (never a second charge)
   - the plan changed after the payer agreed → those installments are not charged; the agent sees "plan changed" and sends a new link
4. **Stop.** The payer: `POST /api/bd-pay/autopay/:token/stop` (the agent is told). The agent: `POST /bond-desk/bonds/:id/autopay/stop`.
   The card is detached from the agency's Stripe customer.
- `GET /bond-desk/bonds/:id/autopay` → `{ enabled, autopay, attempts: [{ due_on, attempt, amount_cents, fee_cents, status:
  processing|succeeded|failed|action_needed|cancelled, failure_code, retry_on, payment_id }], plan_changed, fee_cents }`
- Webhooks (`payment_intent.succeeded` / `payment_intent.payment_failed` / `checkout.session.completed` with `metadata.bd_kind`)
  change nothing on a replay: the event id is claimed once and the PaymentIntent id is unique on `bd_payments`. An automatic
  payment is posted only when the event comes from **the plan's own connected account** (`event.account` = the autopay's
  `stripe_account_id`) and the PaymentIntent's status is `succeeded` (a paid Checkout session counts as succeeded); metadata alone
  is never trusted.
- Payer texts about automatic payments (failed, confirm, receipt) end with the opt-out sentence ("Reply STOP to opt out." and its
  equivalent in each language, `sms.opt_out`); the e-mails built from the same words leave it out.

## Pay link (B2) — "Pay {agency}"

Every agency with card payments on has a public page `/pay/<slug>` (stable random slug; on/off in Settings).
- `GET /api/bd-pay/agency/:slug` → `{ agency: { name, phone, license }, available, min_cents: 100, max_cents: 5000000 }`
- `POST /api/bd-pay/agency/:slug/checkout` `{ amount_cents (100–5,000,000), payer_name, payer_phone?, payer_email? (one needed),
  defendant_name, receipt_by_text?, agree_final: true, lang? }` → `{ url }` Stripe Checkout (payment mode) on the agency's
  account; 10 per IP per 15 minutes. The payer agrees "I am paying {agency}, not Justice Gavel. All payments are final."
- Paid (`payment_intent.succeeded` / `checkout.session.completed`) → `bd_pay_requests.status = 'paid'`, the agent gets a push and an e-mail.
- `GET /bond-desk/pay-requests?status=paid|attached` → "Unassigned payments" on the Bond Desk dashboard.
- `POST /bond-desk/pay-requests/:id/attach { bond_id }` → `{ payment, receipt, over_balance_cents }`, posted by `postPayment`
  (`source: 'pay_link'`, numbered receipt) once (409 `already_attached`); the receipt is e-mailed and, when the payer asked,
  texted (5¢). The card was already charged, so a payment **larger than the bond's balance is still attached** (taken, like
  automatic payments): the response carries `over_balance_cents`, the app shows "Attached. It was $X more than the bond's
  balance — check the ledger.", and the agent gets a push and an e-mail "Pay-page payment above the balance".

## Staff and seats (B8)

Owner = the bail agent whose plan it is; staff = people the owner invited. Staff do everything in Bond Desk
**except** billing / the plan, card-payment set-up (Connect), staff and the export (403 `owner_only`).
Seats include the owner: **Starter 3, Pro 10, Market 20** (`plans.js` `BONDSMAN_TIERS[].seats`, shown on the plans
screen). Used = owner + staff + invitations not accepted / withdrawn / expired. Over the limit an invitation is refused
(409 `seats_full`, "Move up a plan to invite more people") — **no paid extra seats**. A plan moved down keeps the people
already in.
- `GET /bond-desk/staff` → `{ seats: { included, used, staff, pending }, owner, staff: [...], invites: [...], role }`
- `POST /bond-desk/staff/invites` (owner) `{ email }` → 201 `{ invite, link, email_status }` (e-mailed link `/bond-desk/join/<token>`, 14 days)
- `DELETE /bond-desk/staff/invites/:id` · `DELETE /bond-desk/staff/:userId` (owner; access ends at once) · `POST /bond-desk/staff/leave` (staff)
- `GET /bond-desk/staff/invite/:token`, `POST /bond-desk/staff/accept { token }` — signed in with the invited e-mail (403
  `invite_other_email`); one agency per person (409 `other_agency`); an account with its own bail-agent plan cannot join (409 `has_own_plan`).

## Forms set up for you (A12 step 2)

- Agency: `GET /bond-desk/forms-setup` · `POST /bond-desk/forms-setup { note? }` (one open request) ·
  `POST /bond-desk/forms-setup/:id/files` (multipart PDF, as the forms library) · `POST /bond-desk/forms-setup/:id/cancel` (while requested;
  its PDFs go to the library unmapped). Status: requested → in progress → ready.
- Staff (admin role) — `/api/admin/bd-setup`: `GET /?status=open|requested|in_progress|ready|cancelled|all`, `GET /:id`,
  `POST /:id/start`, `POST /:id/ready { note? }`, and the **same forms tool** at `/:id/forms…` (list, upload, map, archive, original,
  preview with sample data) acting on the agency's forms of that request only, while in progress. The PDFs stay hidden from the
  agency's library until "ready"; then the agency gets a push and an e-mail. Every step is in `audit_log`
  (`bond_desk.forms_setup_requested`, `admin.bd_setup_started`, `admin.bd_setup_form_uploaded|mapped|archived`, `admin.bd_setup_ready`).

## Import open bonds (A12 step 3)

- `GET /bond-desk/import/template.csv` — header `defendant_name, defendant_phone, defendant_email, defendant_dob, bond_amount, surety,
  power_number, posted_on, court_date, case_number, court_name, county, state, premium, balance, indemnitor_name, indemnitor_phone`
  (common other spellings such as "Defendant", "Bond Amount", "Power" are accepted).
- `POST /bond-desk/import/preview` (multipart CSV ≤ 2 MB, ≤ 2,000 rows) → `{ rows: [{ line, values, errors: [{ field, code }] }], total, valid,
  invalid, file_errors, unknown_columns }`; nothing is written.
- `POST /bond-desk/import` → 201 `{ imported, bond_ids }`, or 409 `import_has_errors` and nothing written: **one transaction, all or nothing**.
  Each row: an **active** bond (posted on `posted_on`), its executed power (limit = bond amount), its first hearing, its first indemnitor,
  and, when `balance` > 0, one premium charge **"imported balance"** (`source: 'import'`). The file's `premium` is kept on the bond
  (`imported_premium_cents`) for forms (`bond.premium`) and the surety report. Money is parsed from text to cents exactly
  ("$1,234.5" → 123450); power numbers must be unique in the file and not already in the agency's inventory. Imported numbers get
  no texts until the agent confirms them (court-text consent).

## Export everything (A12 step 4)

`GET /bond-desk/export.zip` (owner; 3 an hour) streams one ZIP (`services/bondDesk/zip.js`: store/deflate with node:zlib and CRC-32,
no dependency): `reports/*.csv` (liability, surety, receivables, receipts, collateral held, court appearance — whole history),
`records/*.csv` (bonds, indemnitors, charges, payments, payment plans, collateral, powers, court dates), `receipts/payments/R-*.pdf`,
`receipts/collateral/C-*.pdf`, `signed/…pdf` (every signed copy with its certificate) and `README.txt` listing everything. The agency
owns its Bond Desk data and can export it at any time (docs/TERMS_OF_SERVICE.md).
