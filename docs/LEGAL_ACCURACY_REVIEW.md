# Legal accuracy review — October 26, 2026

**What this is:** every piece of legal content in Justice Gavel, checked against official
sources (statute text, court and agency sites) or recognized references (CCRC Restoration of
Rights Project, NCSL, RCFP, IIHS/GHSA, HCCH, U.S. State Department, EOIR). It was done by an
AI legal research assistant. **It is not a lawyer's review.** Each record names the page it
was checked against, so a licensed attorney can confirm it quickly. Several records rest on
secondary references rather than the statute text; each one says so in its research note.

**The rule the app now follows:** a legal rule, number, deadline or verdict is shown only
when it was checked against a named source. In code: `routes/legaldata.js isVerifiedRow()` needs a
`source_url` and a `verified_by` of the form "Source-checked YYYY-MM-DD …" (this review) or
"Attorney: …" (a lawyer). One seeded TN DUI row labelled "Legal audit May 2026" did not count: its
felony threshold and admin-hearing deadline conflict with the research. Everything else is withheld and the person sees:
*"We haven't checked these rules for {state} against the official law yet, so we don't show
them… A criminal defense lawyer or public defender in {state} can tell you the current rule."*
Wrong legal numbers are worse than none, and this closes the FTC "overclaiming" exposure
(DoNotPay, $193,000, 2024–25) without inventing anything.

About "no grey area": some law is genuinely unsettled — circuit splits on recording police,
offenses that depend on facts or a judge's discretion, rules with county-level variation, new
statutes not yet construed. Those records are marked `varies: true` and say so in plain words.
Presenting them as settled would be the inaccurate choice.

## 1. Scorecard by content area

| Area | Records | Checked OK | Corrected | Could not check yet | What the app shows now |
|---|---|---|---|---|---|
| Adult expungement / sealing (51 × 6) | 306 | 117 | 178 | 11 | Verdicts for the 295 checked; "not verified" for 11 |
| Juvenile record sealing | 51 | 4 | 43 | 4 | Served from the server; 4 show "not verified" |
| Recording-consent law | 51 | 44 | 7 | 0 | All 51 (all-party / one-party / **mixed**) |
| Legal tip of the day | 15 | 6 | 9 | 0 | All 15 rewritten where wrong (4 languages) |
| Statutes of limitation (51 × 5) | 255 | 168 | 55 | 32 | 223 shown; 32 withheld |
| Drug penalties | 153 | 5 | 3 | 145 | 8 shown (Texas); 145 withheld |
| DUI laws | 51 | 0 | 0 | 51 | All withheld (hearing deadlines wrong in several states; interlock and admin-suspension research partly done) |
| Bail dollar amounts | 504 | 0 | 0 | 504 | All withheld — no row names an official schedule; IL rows are illegal after 2023 |
| Bail law by state (commercial bail, cash bail) | 51 | 51* | — | — | *NCSL-based; not yet wired into a screen |
| Bail recovery agent law | 51 | 19* | 25* | 7 | Shown with "checked against a 50-state summary"; 7 "not verified" |
| Victim compensation programs | 51 | 0 | 9 | 42 | 9 shown; 42 withheld |
| Attorney-discipline offices | 51 | 0 | 0 | 51 | Shown as a directory (contacts only); research pending |
| Hague Convention countries | 28 | 5 | 23 | 0 | All corrected, plus a new "U.S. treaty partner" flag |
| Specialty courts | 30 | 0 | 0 | 30 | All withheld (placeholder-looking data) |
| Immigration courts | 44 | 1 | 42 | 0 (1 removed) | 43 corrected; fabricated Milwaukee court removed |
| Crisis / ICE help lines | 12 | 1 | — | 11 | Fabricated number removed; ICE list reduced to verified EOIR resources |
| Deadline calculator rules | 77 | 0 | 0 | 77 | Unchanged — see open item L7 |
| Rights card, lessons, guide screens | ~600 strings | — | — | not started | See open item L8 |

\* secondary source, flagged in the app.

## 2. Inconsistencies found → how each was resolved

### Expungement (the 4 contradictions + the 155 unsourced rules)
1. **CT dismissed** (wait 0 vs "13 months"): both are law. A nolle is erased automatically
   13 months after entry (C.G.S. § 54-142a(c)(1)). A dismissal or acquittal is erased when the
   appeal period ends (§ 54-142a(a)). Stored as 13 months with both rules in the note.
2. **TX dismissed** (wait 0 vs "after statute of limitations"): art. 55.01 became Code Crim.
   Proc. ch. 55A on Jan 1, 2025. Acquittal: immediately. Dismissal: 180 days (Class C),
   1 year (A/B) or 3 years (felony) from arrest, or sooner on prosecutor certification.
3. **NV domestic** ("not eligible" vs "extended wait"): a misdemeanor DV battery can be
   sealed 7 years after release or the end of the sentence (NRS 179.245(1)(e)). Now conditional.
4. **AZ domestic** ("not eligible" vs "restricted"): neither § 13-905 (set-aside) nor
   § 13-911 (sealing) excludes DV. Sealing waits 2–5 years by class. Now conditional.
5. **The 155 rules with no statute**: every one was researched. The old rule that DUI, DV and
   sex offenses are "not eligible" everywhere was wrong in about 25 states (e.g. PA, MA, MI,
   NY, CT, OK, IN, KS, UT, NE). Clean Slate laws were missing for NY, PA, CT, MI, MN, OK, DE,
   DC, VA and NC.
6. **Rules that cited a statute were mostly wrong too** — 178 of 306 corrected. Examples:
   - **Tennessee:** DUI is on the never-eligible list (the app said first DUI may qualify).
     Class C/D felonies wait 10 years and Class E 5 years, and the sections were renumbered
     (§ 40-32-107).
   - **Iowa** has no felony expungement. **Hawaii** has no adult conviction expungement.
   - **Maine's** "Clean Slate" bill was vetoed (Apr 29, 2026).
   - **Illinois** misdemeanor wait is 2 years from June 1, 2026.
   - **Ohio** 4th/5th-degree felonies wait 1 year (SB 288).
   - **Florida** sealing has no waiting period.
7. **Louisiana juvenile**: since Apr 19, 2024 every 17-year-old is an adult again (Ch.C. art.
   804(1), Acts 2024 2nd E.S. No. 13), so their records follow the adult rules.
8. **Juvenile "automatic" flags** were wrong in both directions in about 20 states. For
   example, MD, MA and MN were marked automatic and are not; AK, AR, MI, ND, WV and VA are
   automatic and were marked petition-only.

How: `backend/src/routes/expungement/rules_data.js` (generated), with a strict gate in
`rules.js citationOf()`. No verdict is shown without status verified/corrected, a citation,
a source URL and an eligibility value.

### Immigration / ICE
9. **"You get a lawyer even if you cannot afford one"** (ICE screen and AI prompt) — wrong
   for immigration court (8 U.S.C. § 1362: "at no expense to the Government"). Rewritten in
   4 languages, and the AI prompt now states the exception.
10. **"National Immigration Legal Svcs 1-800-354-0365"** — no such organization could be
    found. Replaced with the official EOIR case line 1-800-898-7180.
11. **ICE screen call buttons** (RAICES, NILC, ACLU, ILRC, CLINIC): the numbers could not be
    confirmed, and four of the five groups don't take calls from detained people. Replaced
    with the verified EOIR case line and the official EOIR free-legal-provider list.
12. **Immigration court directory**: 42 of 44 phone numbers were wrong. LA Olive St
    (closed 2024), "San Francisco", "Arlington VA" and "Bloomington MN" no longer exist,
    Oakdale was tagged AL, and the "Milwaukee" court is fabricated (removed). Fixed by
    migration 30.

### Recording police
13. **Wisconsin** listed as all-party → it is one-party (§ 968.31(2)(c)).
14. **Delaware, Nevada, Oregon, Connecticut, Michigan, Hawaii, Maine, Missouri** were wrongly
    treated as plain one-party or plain all-party. They are all-party (DE) or **mixed**: for
    example, Nevada phone calls need all parties and in-person only one; Oregon is the
    opposite, with a police exception.
15. **Illinois** cited "People v. ACLU of Ill." (does not exist) → *ACLU of Ill. v. Alvarez*
    (7th Cir. 2012), *People v. Melongo* and *People v. Clark* (2014), Pub. Act 98-1142.
16. **"Record police in all 50 states"** → rewritten. Four circuits have not squarely ruled,
    and buffer laws exist (FL 25 ft in force; IN, LA and AZ blocked; TN challenged).

### Tips, rights, AI
17. Nine of the 15 daily tips were wrong. Examples: checkpoints "must be announced", "one
    phone call", Miranda "only after arrest", "public defender is free", "federal law
    protects all jurors", "marijuana" ignoring legal states. All rewritten in 4 languages.
18. "Use your one phone call" (DUI guide) → not a constitutional right; rewritten.
19. **AI prompt** told the model to say "in most states" when unsure. It now must say the
    rule depends on the state instead, and may not state a deadline, fine, sentence or
    dollar figure unless it can name the source. The defender prompt's "30 days (most
    states)" appeal rule was replaced with the federal rule plus "confirm the state rule".

### Hague Convention
20. **Pakistan** "not a contracting state" → acceded 2017; a U.S. treaty partner since
    Oct 1, 2020.
21. **Russia** has joined the Convention but is not a U.S. partner. The app gave it the Hague
    return steps. A new `us_partner` flag now drives the steps (Art. 38), with a new message
    in 4 languages.
22. **Article 11** "Central Authorities must respond within 6 weeks" → wrong. Courts that
    haven't decided within 6 weeks can be asked for a statement of reasons. Fixed in
    4 languages.
23. **"Applications must be filed by attorneys"** → wrong (Art. 8: any parent may apply).
    Fixed.
24. **Five wrong Central Authority names** (MX, AR, FR, ES, ZA), most websites, and the U.S.
    hours ("8am–8pm" → 8:15–5:00 ET; emergencies any time) — all fixed.

### Bail, DUI, penalties, deadlines (withheld until checked)
25. **Bail amounts**: 0 of 504 rows name an official schedule. Ten sampled city/county rows
    matched no official source. The 10 Illinois rows show cash bail that has been abolished
    since Sept 18, 2023. All withheld.
26. **DUI**: admin-hearing deadlines are wrong in several states — GA 10→30 days, AZ 15→30,
    UT 29→10, NM 20→10 — and NJ/NY have no such hearing. There are unit mix-ups (hours or
    months entered as days), and interlock rules were wrong in 49 states. All withheld until
    each state is checked.
27. **Drug penalties**: suspected errors in about 35 rows of the first half alone (federal
    § 841 tiers, FL trafficking, GA, MD, OR (HB 4002), OK (SQ 780), WA (Blake fix), TN
    maximums). 145 rows withheld; 8 Texas rows corrected and shown.
28. **Statutes of limitation**: rape limits were wrong in 12+ states, and ~30 DUI rows used
    the felony period (e.g. IL "18 years" is 18 months). Fixed or withheld.
29. **Victim compensation**: CA deadline 3→7 years (minors until 28), AL cap $30,000→$15,000,
    wrong official sites for AK, AR and DE. 9 rows fixed; the rest withheld.
30. **Recovery agents**: OR and WI shown as allowed (both ban commercial bail); a CA law that
    sunset in 2010 was cited; wrong statutes in TX, IL, NJ, MI, TN and NV. Rewritten.

### Marketing / FTC / consumer-law consistency
31. Privacy-policy "✓ GDPR ✓ CCPA ✓ Apple ✓ Google Play" badges implied certifications →
    removed.
32. Refund terms: the Terms said 48 hours, the code does 7 days, and the policy doc said "no
    refunds monthly". All now state the code's real rule (7 days or billing error,
    automatic). The Terms also described Apple/Google in-app purchase, which the app doesn't
    use — rewritten to the Stripe reality with auto-renewal disclosures (price, frequency,
    trial, online cancellation).
33. Terms effective date: May 1 vs May 25 → one constant (`constants/terms.ts`), version 2.2
    (users accept again).
34. Insurance tile for a product that doesn't exist → removed from Home.
35. Bar-prep answer key: 53% "B" → balanced (A 131 / B 152 / C 133 / D 132). Option text is
    unchanged; 38 position-dependent questions were left as they were (migration 29).

## 3. Still open — in order

| # | Step | Who |
|---|---|---|
| L1 | Finish research on withheld rows. Each pass is limited by a per-message web-search budget (about 200 searches), so say "continue the legal research" to run the next batch. Order: DUI (51) → drug penalties (145) → limitations (32) → victim compensation (42) → specialty courts (30) → expungement leftovers (11) → juvenile (4). | Claude |
| L2 | Re-read statute text for records that rest on CCRC/NCSL/Justia only (listed in each record's `issue`): CA, NC, ND, OH, GA, HI, MD, MA, MI, MN, VT, TN juvenile. | Claude, then attorney |
| L3 | **Attorney sign-off** on: lead-fee structure (runner-capper laws, ABA 5.4/7.2), UPL disclaimers, rights card, and a sample of each table. The app labels everything "not reviewed by a lawyer" until then. | Owner + attorney |
| L4 | Translate the corrected English legal notes (expungement, juvenile, recording) into es/pt/vi. They are labeled "shown in English" today. | Claude |
| L5 | Wire the verified bail-law table (commercial bail legal? cash bail abolished?) into the bail screen. That's more useful than dollar figures nobody publishes statewide. | Claude |
| L6 | App Store listing still claims "jurisdiction-specific guidance for all 50 states", "2,000+ attorneys by specialty" and a "24/7 filter". Rewrite to match what ships. | Claude + owner |
| L7 | Deadline calculator: 77 rules reviewed but none confirmed against a source yet. About 17 look wrong (e.g. "Arraignment 3 business days, Fed. R. Crim. P. 10" — Rule 10 sets no deadline), and 21 are scheduling-order dates, not rules. Fix and source next pass; until then the attorney dashboard should label them "verify against the local rules". | Claude |
| L8 | Line-by-line review of the rights card, 50 lessons and the guide screens (housing, tenant, family, juvenile, diversion). Not started this pass: the search budget ran out. | Claude |
| L9 | Directory listings (404 courthouses, 89 federal courts, 57 probation offices, 96 clinics, 51 public defenders, 51 bar offices): research flagged non-PD organizations in the public-defender list (associations, appellate-only offices, a nonprofit). Verify contacts. | Claude |

## 4. Files changed

- Expungement: `backend/src/routes/expungement/{rules.js,rules_data.js,check.js,index.js}` (+ `GET /api/expungement/juvenile`)
- Juvenile screen: `frontend/src/screens/JuvenileJusticeScreen.tsx`
- Recording: `backend/src/routes/{interrogation.js,recordingLaws_data.js}`, both recorder screens
- Data: `supabase/migrations/00000000000029_bar_prep_answer_balance.sql`, `…30_legal_accuracy_data.sql`, `…31_sms_consent_record.sql`
- Gate: `backend/src/routes/{legaldata.js,bail.js,help.js}` + the penalties, specialty-courts and bail screens
- Hague: `backend/src/routes/hague_contacts.js` + strings; ICE: `IceDetentionScreen.tsx`, `constants/crisisResources.ts`
- Tips: `backend/src/routes/push.js` + `tip.*` strings; AI: `backend/src/routes/chat/_prompts.js`
- Recovery agents: `backend/src/routes/recovery_agents.js`, `RecoveryAgentsScreen.tsx`
- Terms/privacy/home: `constants/terms.ts`, Terms screens, `PrivacyPolicyScreen.tsx`, `HomeScreen.tsx`, `docs/TERMS_OF_SERVICE.md`, `auth.js` (ToS 2.2)
