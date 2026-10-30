# Justice Gavel — review packet for counsel (October 26, 2026)

**Purpose.** Justice Gavel is a mobile and web app for people who have just been arrested and their
families (rights information, finding a lawyer or bail agent, court-date reminders), with paid tools for
bail agents and attorneys. Before public launch we need a licensed attorney to answer the questions
below. Each question states exactly what the app does today and where to see it, so you can answer
yes / no / change it to X. Nothing here has been reviewed by a lawyer yet.

**Suggested scope:** a Tennessee-licensed attorney for the general questions (launch state), plus a
short consult on bail-agent rules in each state where we sell to bail agents. Estimated 4–6 hours.

**Company facts to confirm first:** the legal entity (Tennessee LLC? Wyoming LLC? — unresolved; Terms
choose Tennessee law and JAMS arbitration); conversion to a Delaware C-corp before fundraising.

---

## 1. Paying for leads (highest risk)

**What the app does.** A person asks for help; a professional pays a **flat** fee to get that person's
contact details. The fee never depends on the bail amount or the case value. The person is told only one
attorney receives a case request.

| Lead | Buyer | Fee |
|---|---|---|
| Arrest record of someone without a lawyer (new arrests) | Bail agent | $100 — on sale in the code today; we intend to switch it off until you answer 1.2 |
| Personal injury / medical malpractice request | Attorney | $250 |
| Civil rights request | Attorney | $200 |
| Employment request | Attorney | $100 |
| ICE detention request | Attorney | $75 |

**Questions.**
1.1 Do flat per-lead fees paid by attorneys comply with ABA Model Rule 7.2(b) and Tennessee RPC 7.2 /
5.4 (no payment for a recommendation; no fee-sharing)? Does the "only one attorney receives this
request" design make it a recommendation?
1.2 Is selling arrest-record leads, or new-arrest alerts, to bail agents lawful in TN, and in TX
(Tex. Penal Code § 38.12, barratry/solicitation), FL (Fla. Stat. § 648.44, giving anything of value /
solicitation by bail agents; § 648.45 recruiting) and any other target state? Is a flat monthly
subscription for alerts different from a per-lead fee?
1.3 Is any waiting period before contacting an arrested person required in our launch states?
1.4 Is the app a "lawyer referral service" under Tennessee rules (registration, fee limits)?

## 2. Electronic signatures for bail paperwork (Bond Desk)

**What the app does.** A bail agent uploads their own surety forms (PDF). The app fills the fields from
the case file and sends each defendant and indemnitor a personal link by text or e-mail. The signer
answers questions, uploads a photo ID and a selfie holding it, opens every document, types their full
name (it must match the name on file) and ticks two boxes. No drawn signature. Each signer signs their
**own copy** of each form (counterparts). Every signed copy ends with a certificate page: the SHA-256
fingerprint of the copy reviewed, the timeline (sent, opened, each document opened, signed, in UTC),
IP address, browser, how the link was delivered, and the consent text. Details: docs/BOND_DESK.md.

**Consent text shown before signing (English; also shown in Spanish, Portuguese, Vietnamese, Haitian Creole, Chinese, Arabic and Tagalog — the last four translated by Claude, not yet reviewed by a native-speaker legal translator, docs/TRANSLATIONS.md):**
> Signing electronically: you may ask the agency for paper copies of these documents at no charge, and
> you may sign on paper instead — to do that, do not sign here and contact the agency (phone above). You
> can stop at any time before you sign. You need a device that can open PDF files; you will get a copy of
> everything you sign right after signing. Your typed name is your legal signature (federal ESIGN Act and
> your state's Uniform Electronic Transactions Act).
>
> ☐ I agree to sign these documents electronically and to receive them electronically.
> ☐ I have read the documents and agree to them.

**Questions.**
2.1 Does this satisfy ESIGN 15 U.S.C. § 7001(c) consumer-disclosure requirements (scope of consent,
right to paper, withdrawal, hardware/software, "reasonably demonstrates" ability to access)? Change the
wording if not.
2.2 Do bail statutes or Department of Insurance rules in our states require **wet** signatures, a
specific form, or in-person signing for: the bail bond application, indemnity agreement, premium
receipt, collateral receipt, or the bond itself?
2.3 Are separately signed counterparts acceptable for indemnity agreements, or must all indemnitors
sign one instrument?
2.4 Is collecting a selfie holding a government ID permitted, and does it trigger biometric-privacy law
(we store the photo encrypted; no face matching is done)?
2.5 The agent ticks "The person gave me this phone number for texts about this bond" before texting.
Is that sufficient for 3.x below?

## 3. Text messages (TCPA)

**What the app does.** Three kinds of automated texts, all ending "Reply STOP to opt out", sent from our
Telnyx number on a registered 10DLC campaign:
- court-date reminders to app users who turned them on (consent text below; up to 4 per court date:
  7 days and 3 days before at 9:00, the evening before at 18:00, the morning of at 6:30, local time);
- Bond Desk signing links to defendants/indemnitors;
- Bond Desk payment reminders, sent when the agent presses "remind".
STOP from any number blocks every future text to it (accounts and Bond Desk); START unblocks Bond Desk
texts; app reminders stay off until the person turns them on again in the app.

**Consent text (app reminders):**
> By turning on text reminders, you agree to receive automated court-date reminder texts from Justice
> Gavel at this number (up to 4 per court date). Consent is not required to use the app. Msg & data
> rates may apply. Reply STOP to cancel, HELP for help. See our Terms and Privacy Policy.

**Questions.**
3.1 Is this prior express consent sufficient for informational texts under the TCPA and the FCC's 2023–
2025 consent rules (one-to-one consent; revocation by any reasonable means)?
3.2 Bond Desk texts are sent by our platform **on behalf of** a bail agent to people who are not our
users. Who is the "sender" for TCPA purposes, and is the agent's confirmation (2.5) adequate consent?
Are payment reminders "debt collection" communications (FDCPA / state law), given the agent is the
creditor?
3.2b **Public defender offices (built, off in production: `PUBLIC_DEFENDER_CHANNEL_ENABLED`; docs/PUBLIC_DEFENDER.md).**
A public defender office uploads its clients (name, phone, language, case number, court dates) and an office admin ticks
"These clients gave this office their number and agreed to receive texts about their case." (stored with who and when).
The clients then get court reminders, "Did you make it to court?" and a morning-after text, each starting with the office's
name, and any reply goes to a shared office inbox where staff answer by text. Who is the sender (the office or Justice Gavel),
is the office's statement adequate consent for these informational texts and for two-way staff texts, and does anything
change for a government office (public records, retention of the message log)?
3.2c **Nightly lead e-mails to directory lawyers (built, off in production: `OUTBOUND_BOT_ENABLED`; added Oct 30, 2026).**
Each night the bot finds new arrests with bail set and no lawyer listed, and e-mails a county summary (how many arrests,
how many without a lawyer, the top charge types; no names) to lawyers in the public directory who have an e-mail address,
with a link to the attorney dashboard and a one-click unsubscribe link. These lawyers never signed up. Is this allowed lead generation in each launch state (docs/LEAD_FEE_RULES.md),
and do the e-mails meet CAN-SPAM and state rules for messages to people who did not opt in?
3.2a **Automatic payment-plan charges (built, off in production: `BOND_AUTOPAY_ENABLED`).** The payer (defendant or
indemnitor) opens a personal link from the agent, reads the dates and amounts, how to stop and "All payments are final"
(wording in docs/BOND_DESK.md "Automatic payments"), ticks "I agree" and saves a card in Stripe Checkout on the **agency's**
Stripe account. Each installment is charged on its due date; a declined card is tried once more 3 days later and the payer
and agent are told; the payer can stop it on the same page. Justice Gavel's 99¢ fee is taken from each successful charge
(Stripe application fee). Is this authorization adequate for recurring card charges, and does running these charges for the
agency make Justice Gavel (or the agency) subject to debt-collection rules for payment-plan collection?
3.3 Quiet hours: the morning-of reminder is at 6:30 local time. Do any launch states' laws (e.g., FL,
OK, MD, WA mini-TCPA statutes) restrict informational texts before 8:00? If so we will move it.
3.4 HELP keyword handling and the campaign's sample messages — anything to add?

## 4. Payments, renewals, "all sales final"

**What the app does.** Prices are shown before purchase with the renewal period, trial length and first
charge date. Cancel online any time in Settings; access continues to the end of the paid period.
**All sales are final**: no refunds for change of mind, non-use or unused time; only billing errors and
duplicate charges are refunded (owner decision). The Case Pass ($29, 90 days) never renews. Terms:
docs/TERMS_OF_SERVICE.md "Payments and Subscriptions".

**Questions.**
4.1 Does the flow comply with the FTC's negative-option rules and the California Automatic Renewal Law
(and similar state laws) for subscribers in those states?
4.2 Is an "all sales final" policy enforceable for consumers in our launch states, including for annual
plans cancelled early? Any state that requires a pro-rated refund?
4.3 iPhone users buy digital plans on the website (Apple rule). Any disclosure needed?

## 5. Legal information and the unauthorized practice of law

**What the app does.** AI answers general legal questions after the user accepts this disclaimer (AI
features refuse to answer until it is accepted):
> The {feature} feature uses AI to provide general legal information based on publicly available law.
> This is educational content only. It is not: legal advice specific to your situation; a substitute for
> an attorney; a lawyer-client relationship. AI can make mistakes and may be out of date. Laws vary by
> jurisdiction and change frequently. Your situation may have facts that change the legal outcome. For
> matters with significant consequences, always consult a licensed attorney in your jurisdiction.

Legal tables (expungement rules, penalties, bail law, deadlines) are shown only when a row has a cited
source checked on a date; unchecked rows are withheld. Everything is labelled "not reviewed by a lawyer".
Details: docs/LEGAL_ACCURACY_REVIEW.md.

**Questions.**
5.1 Is the disclaimer and its placement adequate to avoid UPL in Tennessee and to avoid an FTC
"deceptive AI legal services" claim (cf. FTC v. DoNotPay, 2024–2025)?
5.2 AI-drafted documents (motions, letters) say they must be reviewed by a licensed attorney before
filing. Enough?
5.3 Sign-off on a sample of each legal table (we will send 20 rows per table with their sources), and on
the rights card for Tennessee.

## 6. Privacy and data

**What the app stores:** account details; case notes and documents (encrypted at rest); court dates;
for Bond Desk: defendant and indemnitor contact details, answers (DOB, address, employer, driver's
license number, references — **no Social Security numbers**), ID photos and selfies (encrypted), signed
documents, payments received. Arrest records come from public county rosters; a takedown request flow
exists. Service providers: Render (hosting), Supabase (database and file storage), Stripe (payments),
Telnyx (texts), Resend (e-mail), Expo (push), Anthropic (AI), Sentry (error tracking), Google Places
(directory data).

**Questions.**
6.1 Privacy policy (docs/PRIVACY_POLICY.md) — complete and accurate for the above? State laws that apply
at launch (TN Information Protection Act from July 2025; CCPA if California users). Also covers the public defender
channel (3.2b): client names, phones, case numbers, court dates and every text with the office (bodies encrypted at rest),
visible to that office's staff and exportable by them — what must the policy and the office agreement say?
6.2 **Record retention for bail agents.** Today, when a bail agent deletes their account, their Bond Desk
records are deleted. State law requires bail agents to keep bond records for years. Should we instead
(a) require an export first and (b) archive for N years? Which N per state?
6.3 Arrest records: how long may we show them; what must happen when charges are dismissed or the
record is expunged/sealed (today a person can request takedown and staff review it)?

## 7. Company and IP
7.1 Contributor IP assignment (CIIAA) for Aaron Hart and Russell Allen — please provide your standard form (or approve one).
7.2 Much of the code was written with AI assistance. Position on copyright and what to disclose to investors.
7.3 Entity: confirm what exists, then the Delaware conversion steps.

---

## Documents to send with this packet
- docs/BOND_DESK.md — Bond Desk, step by step
- docs/TERMS_OF_SERVICE.md, docs/PRIVACY_POLICY.md
- docs/LEGAL_ACCURACY_REVIEW.md — what legal content is shown, withheld, and why
- docs/MONETIZATION_PLAN.md section 7 — every price the app charges
- A signed sample packet (PDF) from staging: a form + its certificate page
- Screenshots: SMS consent, AI disclaimer, signing page, plan checkout

## How to answer
For each question number: **OK as is** / **change to …** / **do not launch this until …**. We will change
the code and text to match and send back the changed wording for a final look.
