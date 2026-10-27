# Public defender pilot (Tennessee)

Build plan A11 step 7. One Tennessee public defender office uses the public defender channel (docs/PUBLIC_DEFENDER.md)
for 90 days. We measure its clients' appearance rate against **the office's own baseline** for the 90 days before the
pilot. This document makes no claim about the result. The numbers are reported as counts, with the method, and nothing
beyond them.

> ⚖ Before the pilot starts, counsel answers 3.2b and 6.1 (docs/COUNSEL_REVIEW_PACKET.md). Then
> `PUBLIC_DEFENDER_CHANNEL_ENABLED=true` is set in production. Until then it runs only on staging.

## 1. Setting up the office
1. Agree on the office agreement and the invoice. Defaults: $20,000 setup, then $2.00 per active client per year, texts
   included. We send one Stripe invoice per year (docs/PUBLIC_DEFENDER.md "Billing").
2. A Justice Gavel admin opens Admin review → Public defender offices → New office. They enter:
   - the office name;
   - the county (this sets the time zone: Davidson = Central, Knox = Eastern) and the state TN;
   - the office phone, which appears in the "act today" text;
   - the number of seats;
   - the billing e-mail and the e-mail of the office's first admin.
3. The office admin accepts the e-mailed invitation, signed in with that address. They invite their staff (admin or staff
   role), within the seat count.
4. The office admin ticks the consent-basis statement (section 4). Nothing is texted before that.
5. The office admin enters the baseline and the pilot start date (section 2) on the office dashboard.
6. The office uploads its client list (CSV, section 3). It checks the preview and imports. From then on, new clients and
   court dates are added by re-uploading the list or one at a time.
7. Before the start, a test client with an office staff member's own phone goes through docs/LIVE_TEST.md E19 on
   production.

## 2. What is measured
For each hearing of the office's clients on or before today, the status comes from the client's reply 1 / 2 / 3 or from
office staff:

| Count | Meaning |
|---|---|
| hearings | client court dates in the period (removed and cancelled ones left out) |
| attended | marked attended (reply "1" or staff) |
| rescheduled | marked rescheduled |
| missed | marked missed (reply "3" or staff) |
| no answer | the date passed and nobody marked it |

**Appearance rate = attended ÷ (attended + missed).** Rescheduled and no-answer hearings are shown, not counted in the
rate. A large no-answer count makes the rate less reliable. Office staff can mark those hearings from their own records.

**Baseline.** The office supplies its own numbers for the 90 days before the pilot, from its case management system or
court records. These are the period, the number of hearings, how many the client appeared at, how many were missed, and
where the numbers come from. The dashboard records them as given (`pd_offices.baseline_*`). It computes the baseline rate
the same way: appeared ÷ (appeared + missed). It shows it next to the rate measured since the pilot start date.

The office must count its baseline the way it will count the pilot period. For example, if failures to appear come from
bench-warrant lists, use the same source for both.

**Also reported.** These are taken from the dashboard and its export:
- reminders and questions sent;
- the share of "Did you make it?" questions answered;
- texts received and answered by staff;
- opt-outs (STOP);
- failed deliveries.

**What we will not claim.** The two rates come from different sources (the office's records and our texts and replies),
cover different clients and periods, and have no control group. A difference between them is reported as a difference
in counts. We do not report it as an effect of the reminders. Nothing is published without the office's written
agreement. Any published figure states the period, the counts and this method.

## 3. What the office provides
- The office's name, county, phone and billing e-mail. The names and e-mail addresses of the staff who will use it, within
  the agreed seats.
- The client list as CSV. Columns: name, mobile phone, preferred language (en / es / pt / vi), case number and court dates;
  e-mail and court are optional. Only clients covered by the consent basis (section 4) are listed.
- Court date changes as they happen: re-upload or edit, and mark the outcome when known.
- The 90-day baseline numbers and their source, before the pilot starts.
- Someone who reads the shared inbox on working days. Clients are told in every reminder that they can reply to the text.
- A signed office agreement covering data handling and the invoice.

## 4. Consent basis
- Before any client is texted, an office admin ticks: "These clients gave this office their number and agreed to receive
  texts about their case." Justice Gavel stores who ticked it and when.
- The office is responsible for that statement being true for every client it uploads.
- Each text names the office and says "Reply STOP to opt out". STOP stops every text to that number from Justice Gavel.
  START restarts them.
- HELP is answered by the Telnyx messaging profile.
- Texts go out only through Justice Gavel's registered Telnyx number.

## 5. Counsel questions before the pilot (docs/COUNSEL_REVIEW_PACKET.md)
- **3.2b**: who is the sender for TCPA purposes, the office or Justice Gavel?
  - Is the office's statement adequate consent for informational court texts and for two-way staff texts?
  - Does anything change because the office is a government body (public records, retention of the message log)?
- **6.1**: the privacy policy and the office agreement must cover what is kept. That is client names, phones, case numbers,
  court dates and every text (bodies encrypted at rest), visible to the office's staff and exportable by them.
  - How long is it kept after the pilot?
  - What happens to the data if the office stops?
- **3.3**: quiet hours. The morning-of reminder goes out at 06:30 local time.
