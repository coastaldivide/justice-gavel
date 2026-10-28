# Public defender channel

Build plan A11 (docs/BUILD_PLAN_COMPETITOR_FEATURES.md). A public defender office gets an account with staff seats,
uploads its client list, and its clients get court reminders and the "Did you make it to court?" question by text under
the office's name. Replies that are not 1 / 2 / 3 go to the office's shared inbox, where staff answer by text.
The pilot plan is in docs/PUBLIC_DEFENDER_PILOT.md.

> ⚖ Counsel questions 3.2b and 6.1 (docs/COUNSEL_REVIEW_PACKET.md). Everything here is behind
> `PUBLIC_DEFENDER_CHANNEL_ENABLED` (`backend/src/utils/counselFlags.js`). Unset, it is **off in production** and on
> elsewhere. Off: `/api/pd/*` and `/api/admin/pd-offices/*` answer `503 feature_unavailable` (`GET /api/pd/status`
> answers `{ enabled: false }`). The `pd-court-reminders` job sends nothing, inbound texts are not routed, and the app hides
> the office card and the admin entry.

## Office accounts and seats
- New tables (migration 39), not the firm tables. A firm needs an owner account from the start and is a law-firm
  subscription (plan, trial, public listing, matters). A public defender office is set up by Justice Gavel staff before
  anyone in the office has an account, and it is billed by annual invoice.
  - `pd_offices` holds the name, county / state, office phone, seat count, billing e-mail, consent basis and baseline.
  - `pd_staff` has one row per person, role `admin | staff`. A person belongs to one office.
  - `pd_invites` holds the e-mail invitations: a SHA-256 hashed token, valid 14 days, used once.
- A Justice Gavel admin (users.role `admin` / `super_admin`) uses the app's Admin review screen → Public defender offices.
  They create the office and the first office admin is invited by e-mail. From the same screen they change the seat count
  or billing e-mail, invite more people and invoice the office.
- Office admins invite and remove staff, change roles and withdraw invitations. Seats used = members + pending invitations.
  An invitation over the seat count is refused (`409 seats_full`). An office always keeps at least one admin
  (`409 last_admin`).
- The invited person opens `https://justicegavel.app/pd/join/<token>`, then signs in or creates an account **with the
  invited e-mail address** and accepts.

## Consent basis
No client of an office is texted until an office admin ticks:

> These clients gave this office their number and agreed to receive texts about their case.

The text, who ticked it and when are stored (`pd_offices.consent_basis_*`) and shown on the office dashboard. Before that,
reminders are not planned and staff replies are refused (`409 consent_basis_required`). STOP from a number blocks every
future text to it (`sms_opt_outs`). START undoes it.

## Client list
- **CSV upload** (Clients → Upload a CSV list; ≤ 5,000 rows, ≤ 2 MB). The columns are:
  - `name`, `phone`, `language` (`en es pt vi`, or the language's name), `case_number`;
  - `court_dates`: one or more, separated by `;`. Each is `YYYY-MM-DD` or `M/D/YYYY`, optionally followed by a 24-hour
    time `HH:MM`. A file holds up to 20 per client, between 1 year ago and 3 years ahead;
  - optional `email` and `court`.
  1. **Preview**: every row is checked and shown with its own errors. It says whether the row adds a client or updates one.
     Nothing is written.
  2. **Import**: all rows are written in **one transaction**, or none: one bad row refuses the whole file.
- **De-duplication**: a client is unique per office on phone + case number (case number compared without regard to case).
  - The same pair twice in one file is an error on the second row.
  - A pair already on the list is updated: name, language and e-mail are refreshed.
  - Its court dates are brought in line with the file. Dates in the file are added. Upcoming scheduled dates that are no
    longer in the file are removed. Past dates and their answers stay.
- Clients can also be added, changed (including "send court reminders" on / off) and removed one at a time. Court dates
  can be added, moved, removed and marked attended / rescheduled / missed / cancelled.

## Reminders (same plan and wording rules as A1 / A6 / A7)
For every client court date (`pd_reminders`, unique per hearing + number + step + day, never sent twice):

| Step | When (office's zone: county → state → America/Chicago) |
|---|---|
| reminder | 7 and 3 days before at 09:00, the evening before at 18:00, the morning of at 06:30 (`COURT_REMINDER_PLAN`); a date added too late for all of them gets one text right away |
| "Did you make it?" | 15:00 on the court day: "Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it" |
| morning after | 09:00 the next day, unless the date was marked attended / rescheduled / cancelled: "if you missed court, act today: call your public defender (office phone) or the court clerk" + the missed-court guide link; sent at once when the date is marked missed |

- **Wording.** Every text starts with the office's name ("Metro Nashville Public Defender: …") and is in the client's
  language. It ends "Reply STOP to opt out". It warns that a warrant can be issued, says what to expect and prompts a plan.
  English stays within 2 SMS segments. es / pt / vi / zh / ar keep their own letters within 6 Unicode segments; ht / tl stay within 3 GSM-7 segments (tested).
- **Replies** `1 / 2 / 3` (services/courtReplies.js) answer the newest question of the last 48 hours. That can be an app
  user's, a Bond Desk defendant's or an office client's question. The answer sets that court date's status, unless staff
  already set it. "3" sends the morning-after text right away. The reply is logged in the conversation.
- The job `pd-court-reminders` runs every 5 minutes (services/scheduler.js; monitored in monitoring/jobHealth.js). It
  plans what bulk uploads left to plan (`plan_needed`) and sends what is due. Rows are claimed `FOR UPDATE SKIP LOCKED`.
  Each text is re-checked at send time: the office, the consent basis, the client's switch, the number, the date and STOP.

## Two-way messages
- Any inbound text that is not STOP / START / HELP / 1 / 2 / 3 goes to the **shared inbox** of the office whose client has
  that number (routes/webhooks/telnyx.js → `routeInbound`). If the number belongs to clients of **more than one office**,
  it goes to **no** office (one office must never read another office's client's message): it is kept in
  `pd_unroutable_texts` (body encrypted, the number as an HMAC + last 4 digits, the offices' ids), shown to Justice Gavel
  admins (`GET /api/admin/pd-offices/unroutable`, "Client texts not delivered to any office" on the admin screen), and the
  sender is texted (not to a STOP number): "Justice Gavel: We could not tell which public defender office your message is
  for, so it was not delivered. Please call your public defender's office. Reply STOP to opt out." (8 languages,
  `pd.sms.unroutable`, in the language of the client's most recent office record). Kept 90 days (daily clean-up).
- Replayed Telnyx webhooks (same `data.id`) are processed once (`telnyx_event_log`); routing runs after Telnyx has its 200.
- Office members get a push "New text from a client", with no message content.
- Staff see one conversation per client: every text sent and received, newest first, 100 per page. They can:
  - reply by text, sent as "{office}: …", up to 480 characters, never to a STOP number;
  - mark the conversation handled. It reopens when the client writes again.
- Unread counts per client and per office. The inbox is newest first, 30 per page (at most 50).
- Every text is a `pd_messages` row: direction, kind, status, carrier id (joined to `sms_delivery` for the delivery
  status) and who sent it. The body is encrypted at rest (AES-256-GCM, services/encryption.js). The in-app `messages`
  table is not used: it links two app accounts, and clients are not app users.

## Dashboard and export
- The dashboard shows clients, court dates in the next 30 days, upcoming dates, unread texts and opt-outs.
- It shows **appearance per month** for the office's clients' past hearings: attended / rescheduled / missed / no answer
  (the date passed and the status is still "scheduled"), and the rate = attended ÷ (attended + missed).
- It shows the office's **baseline** next to the same rate measured since the pilot start (see the pilot doc).
- It shows texts sent / received / failed per month.
- **Export everything** (`GET /api/pd/export.zip`) holds:
  - `clients.csv`, `court_dates.csv`, `appearance.csv`;
  - `messages.csv` (every text, decrypted);
  - `opt_outs.csv`, `baseline.csv`, README.
  Each part is also available as `GET /api/pd/export/<part>.csv`.

## Billing
- One annual invoice per office and year through **Stripe invoicing**. It is sent by e-mail to the office's billing
  address and due in 30 days. A Justice Gavel admin creates it with "Create annual invoice".
- The preview shows the count and the amount first. The request needs `confirm: true`.

| Line | Default (owner can change) | Setting |
|---|---|---|
| Setup fee, first invoice of the office only | $20,000.00 (2,000,000 cents) | `PD_SETUP_FEE_CENTS` |
| Per active client per year | $2.00 (200 cents) | `PD_CLIENT_YEAR_CENTS` |

- **Active client**: a client on the office's list with at least one court date (not removed or cancelled) from 365 days
  before the invoice day onwards.
- **Texts are a platform cost included in these fees.** They are never billed per text and never written to `bd_texts`.
- **Idempotent per office + year.**
  - The `pd_invoices` row (unique `office_id, year`) freezes the count and amounts when it is first created.
  - Every Stripe call carries a key derived from that row: customer, invoice, each line, finalize and send.
  - A failure leaves the row pending with the error. Creating it again continues where it stopped, and never makes a
    second invoice or a second line.
- Without a Stripe key the action answers `503 payments_unavailable`.

## API
`/api/pd` (signed in; office members unless noted): `GET /status` (any account, never 503), `GET /invite/:token`,
`POST /invite/accept`, `GET /office`, `PATCH /office` (office admin), `POST /office/consent` (office admin),
`PUT /office/baseline` (office admin), `GET /dashboard`, `GET /export.zip`, `GET /export/:part.csv`, `GET|POST /clients`,
`GET /clients/template.csv`, `POST /clients/import/preview`, `POST /clients/import`, `GET|PATCH|DELETE /clients/:id`,
`POST /clients/:id/court-dates`, `PATCH|DELETE /court-dates/:id`, `GET /inbox`, `GET /inbox/unread`,
`GET|POST /clients/:id/messages`, `POST /clients/:id/handled`, `GET /staff`, `POST /staff/invites`,
`DELETE /staff/invites/:id`, `PATCH|DELETE /staff/:userId` (office admin).

`/api/admin/pd-offices` (admin role): `GET /`, `POST /`, `GET|PATCH /:id`, `POST /:id/invites`,
`GET /:id/invoice-preview?year=`, `POST /:id/invoices`.

## Account deletion
Deleting an account removes the person's office membership. The office, its clients and its message log stay with the
office; who sent a text or ticked the consent basis is anonymised (services/accountDeletion.js).

## Tests
- `backend/src/__tests__/public_defender_units.test.js`: wording and length in all eight languages, CSV checks, the 5,000-row
  limit, inbox routing words, prices, the ⚖ setting, and the consent text shared with the app.
- `backend/src/__tests__/integration/public_defender.int.test.js` (PD1–PD8, real Postgres, fake Telnyx and Stripe
  invoicing).
- `frontend/src/__tests__/render/publicDefender.test.tsx`.
- Live: docs/LIVE_TEST.md E19.
