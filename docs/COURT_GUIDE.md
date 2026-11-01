# Going to court + Your case, step by step (migration 43)

Two consumer guides, both general information with their sources shown, labelled
**"General information — not legal advice — not reviewed by a lawyer"**, in all eight languages
(Claude's translations for es / pt / vi / ht / zh / ar / tl need native-speaker legal review before launch —
docs/TRANSLATIONS.md). They work signed out and offline (the text is in the app).

## 1. "Going to court: how to dress and act" (`CourtGuideScreen`, `/court-guide`)

Content: `frontend/src/constants/courtGuide.ts` (structure), i18n `cgd_*` (words),
`frontend/src/constants/guideSources.ts` (sources). Each section shows its sources as links with the date checked.

| Section | Items (English) | Sources |
|---|---|---|
| What to wear | Clean, neat clothes are enough — no need to buy anything new · clothes that cover you (no shorts, tank tops, see-through tops, pajama pants) · shoes (many courts bar flip-flops, slippers, house shoes) · hats and sunglasses off unless religious or medical · no rude words or pictures of drugs, alcohol, violence, sex · clothes that break the rules can get you asked to leave · *Need clothes? Ask your public defender or legal aid office if they can help with clothes.* | TN DHS, Texas Court Help, Oregon (Yamhill) |
| What not to bring | No weapons, not even a pocket knife or pepper spray · no sharp things (nail files, scissors, tools) · many courts bar food and drink · phone off / silent, some courtrooms bar phones · no photos or recording · court papers on paper | Nashville General Sessions security, Nebraska Judicial Branch, TN DHS |
| Security and finding your courtroom | Extra time to park, get through security, find the courtroom · metal detector and bag check, security has the final say · your name on the docket outside the courtrooms, or ask at the clerk's office · tell the clerk or court officer you are there | Hamilton County (TN) General Sessions, Nashville GS security, NY courts |
| Inside the courtroom | Stand when the judge comes in or leaves and when you speak · "Your Honor" · wait quietly, no talking during session · no eating, drinking, gum · speak clearly, stay calm and polite · before leaving, make sure your case is finished and you know what's next; ask the clerk | Oregon (Yamhill), TN DHS, Texas Court Help, NY courts, Nebraska |
| What to say — and not say | Let your lawyer talk for you · talk about your case only with your lawyer · not in hallways, elevators, public places · jail calls and visits are recorded · don't post about your case online · button: rights card | Allegheny County PD, Delaware Office of Conflicts Counsel, Pinal County PD, Shelby County DA FAQ, Minnesota OLPR |
| Children and people with you | No children unless the court or your lawyer asked; plan child care · support people follow the same rules; anyone loud can be asked to leave | TN DHS, Texas Court Help, Oregon (Yamhill), Nebraska |
| Running late or can't come | Call your lawyer's office before your court time · arriving late can mean the case goes on without you, or a warrant · can't come: call your lawyer or the clerk before the date and ask how to ask for a new date; don't just stay away · button: missed-court guidance | Pinal County PD, TN DHS, Allegheny County PD, NY courts |
| After your hearing | Make sure you understand what's next; ask the clerk or your lawyer · get a copy of any order · write down the next date and add it to Court dates · button: Court dates | NY courts |

Not said anywhere: that clothing changes how a case turns out, any colour rule (the old "No orange" line had no
source and is gone), any deadline, number or price. A test (`courtGuideSteps.test.js`) fails on a number with a
time unit, a money amount, "orange" or outcome wording.

**Free clothing help.** No Tennessee clothing program with a citable source was found (public-defender clothing
closets exist in other states, reported by news outlets, not on official pages we could read). The guide only says
"Ask your public defender or legal aid office if they can help with clothes."

**This court's posted rules** (`backend/src/data/court_rules.js`, on `GET /api/court-dates/:id` as `court_rules`):
a court date whose courthouse is in a listed county shows the court's own page (link), what it covers, and "We
checked this page on …; the court's page is in English". Other court dates show the general guide only, and the guide
opened for such a date says "We don't have this court's own posted rules."

| County (TN) | Court | Page | Covers |
|---|---|---|---|
| Davidson | General Sessions Court of Metropolitan Nashville & Davidson County | https://gscourt.nashville.gov/coming-to-court/dress-code/ | dress |
| Davidson | General Sessions Court (same) | https://gscourt.nashville.gov/coming-to-court/security/ | security, phones, food |
| Davidson | Trial Courts of Metropolitan Nashville & Davidson County (Criminal, Circuit, Chancery) | https://trialcourts.nashville.gov/general-information/dress-code/ | dress |
| Knox | General Sessions Courts of Knox County | https://www.knoxcounty.org/gsjudges/ | dress, phones, food, conduct |

Left out (not verifiable): **Shelby** — no criminal or General Sessions page with posted dress / conduct rules (only
the Probate Court's dress code and the DA's witness FAQ); **Hamilton** — only General Sessions *civil* guidelines.
tncourts.gov local-rules pages could not be read from the build machine (browser check).

**Hook-ins.**
- Court date (`CourtDateDetailScreen`): the checklist's "What to wear" line now reads "Clean, neat clothes are enough
  — you do not need to buy anything. See 'Going to court…'" (source: TN DHS, replaces `guidance.wear.1`
  "Business casual minimum. No orange…") with a button to the guide; the posted-rules box; the court-day plan's new
  **"Clothes ready"** item (saved in `court_dates.plan` with the others) with a link to the guide.
- Court dates list and the missed-court page: the checklist's guide button.
- Just arrested, step 3: "Going to court: how to dress and act".
- The **day-before reminder push** (app) adds "Open Justice Gavel to see what to wear and what to expect in court."
  and `data.guide = 'court'`; tapping it opens the guide for that court date (`notificationRoute.ts`). The e-mail
  fallback carries the same sentence.
- **Texts left alone**: the 3-day (and every) reminder text already ends with the court date's link, and English must
  stay within 2 segments; the court date page links the guide. Nothing was added to any text.

## 2. "Your case, step by step: from arrest to clearing your record" (`CaseStepsScreen`, `/case-steps`)

Nine stages (`frontend/src/constants/caseSteps.ts`; ids in `caseStepsCatalog.json`, the same list the server
validates in `backend/src/services/caseSteps.js` — a test compares them). Each: a one-paragraph explanation with
its sources, 4–5 items to tick, "I'm at this stage", and buttons to what helps (only screens the consumer app shows;
custody alerts only when on).

| Stage | Explanation in short | Buttons | Sources |
|---|---|---|---|
| Arrest and the first hours | Right to stay silent and to a lawyer; say it, stop talking; don't resist; jail calls are recorded | Rights card, Tell family | Justice Gavel rights card (5th/6th Amendments), Pinal County PD |
| Booking and getting released | A judge or court officer decides release and conditions (bail, bond, promise to return); conditions are court rules you must follow | Find a lawyer or bail agent, Bail agents, Tell family, Custody alerts* | USAO-MN, Arizona Judicial Branch, US Pretrial Services E.D. Tenn. |
| First court date (arraignment) | Charges and rights; plea guilty / not guilty / no contest; ask for a lawyer | Add a court date, the guide, Find help | Arizona, NY CourtHelp, California Courts |
| Getting a lawyer | Ask the court to appoint one (often a public defender); the court asks about income; whether it's free can depend on state and charge | Find a lawyer, Find help | USAO-MN, NY CourtHelp, Arizona, Delaware OCC |
| Before trial | Several court dates — go to all; follow conditions; answer your lawyer; report phone / address changes; keep papers together | Court dates, Check-in, the guide, I missed court | Pinal County PD, Allegheny County PD, US Pretrial Services |
| Plea or trial | Plea deal with the prosecutor (guilty / no contest), else trial before judge or jury; proof beyond a reasonable doubt | Find a lawyer, the guide, Court dates | California Courts, Arizona, NY CourtHelp |
| Sentencing | The judge decides; can include jail or prison, probation, fines, restitution, community service, classes | Court dates, the guide, Find a lawyer | California Courts, USAO-MN, NJ Judiciary, NY courts |
| Probation and finishing your sentence | Report to probation; do what the court ordered (work/school, classes/treatment, community service, fines); ask about a payment plan | Check-in, Court dates | NJ Judiciary Probation Services |
| Clearing your record | You may be able to clear it (expungement / sealing); who and how long depend on state and charge — then **the app's own sourced record-clearing data for the person's state** (`GET /api/expungement/check`: dismissed, misdemeanor, felony; a verdict and waiting period only when the rule names a citation, else "Not checked yet — ask legal aid") | Check if my record can be cleared, Find a lawyer | California Courts, Justice Gavel record-clearing check (each rule's own citation) |

\* only when `GET /api/custody/status` says custody alerts are on.

**Nothing guessed.** The stage is null until the person picks one. Two items are ticked by court dates, never by
hand (and the server refuses them): "My first court date is saved" (the case has a court date) and "I know my next
court date" (an upcoming scheduled one). Guests: the same from court dates saved on the phone.

**Saving.**
- Signed in: per case, `case_steps` (migration 43: case_id PK → cases, user_id → users, stage, checked JSONB,
  share_stage). `GET /api/case-steps/:caseId`, `PUT /api/case-steps/:caseId { stage?, checked?: { id: bool }, share_stage? }`
  (60 writes a minute). Owner only — another account's case is 404 for read and write. Deleted with the case
  (`DELETE /api/cases/:id`) and with the account (`accountDeletion.js` USER_REFS + CASE_CHILDREN); in the data export.
- Guest: AsyncStorage `case_steps_guest_v1` (one progress, no case), like `guestCourtDates`. It is not moved to the
  account on sign-in (an account's progress is per case; the person picks the stage again for the case).

**Family.** Followers already invited with the owner's consent (`case_family_access`) see the **stage name only** on
Court dates → family section, and only when the owner turns on "Let family who follow this case see which stage I'm
in" (`share_stage`, off by default). Never the checklist (`GET /api/following` → `case_stage`).

**Entry points.** Home tile "Your Case, Step by Step" (replaces "What Happens Next?", which opened Just arrested a
second time; the old `/what-happens-next` link now opens this screen), Just arrested step 3 ("What happens next: your
case, step by step"), each case's card on My Cases ("Step by step"), the record-clearing screen.

## Sources (all checked 2026-11-01)

| Id | Publisher — page | URL |
|---|---|---|
| tn_dhs | Tennessee Department of Human Services — What to Expect in Court | https://www.tn.gov/content/dam/tn/human-services/documents/Child%20Support%20What%20to%20Expect%20in%20Court.pdf |
| ny_tips | New York State Unified Court System — Tips for Your Day in Court | https://nycourts.gov/courtsnyccivil/tips.shtml |
| tx_help | Texas Court Help (Texas OCA and partners) — Appearing in Court | https://texascourthelp.gov/civil/appearing-in-court/ |
| ne_judicial | Nebraska Judicial Branch — What You Need to Know Before Going to Court | https://nebraskajudicial.gov/self-help/need-to-know |
| or_yamhill | Oregon Judicial Department, Yamhill County Circuit Court — Courtroom Etiquette | https://courts.oregon.gov/courts/yamhill/go/Pages/etiquette.aspx |
| nash_gs_security | General Sessions Court of Metropolitan Nashville & Davidson County — Security | https://gscourt.nashville.gov/coming-to-court/security/ |
| hamilton_gs | Hamilton County (TN) General Sessions Court — Guidelines and Helpful Information | https://www.hamiltontn.gov/PDF/Courts/Sessions/Courtroom%20Guidelines%20080825.pdf |
| allegheny_pd | Allegheny County (PA) Office of the Public Defender — new client advice | https://www.alleghenycounty.us/files/assets/county/v/1/government/public-defender/documents/new-client-advice.pdf |
| pinal_pd | Pinal County (AZ) Public Defender — FAQ | https://www.pinal.gov/m/faq?cat=64 |
| de_ocd | Delaware Office of Conflicts Counsel — Client Responsibilities | https://conflictscounsel.delaware.gov/clients-responsibility/ |
| shelby_da | Shelby County (TN) District Attorney General — FAQ (hosted on Squarespace; canonical scdag.com/faq) | https://scdag.squarespace.com/faq |
| mn_lprb | Minnesota Office of Lawyers Professional Responsibility — Clients should be aware of social media pitfalls (2013) | https://lprb.mncourts.gov/articles/Articles/Ethics%20Clients%20should%20be%20aware%20of%20social%20media%20pitfalls.pdf |
| az_steps | Arizona Judicial Branch — Steps in a Criminal Case | https://www.azcourts.gov/legalinfohub/Legal-Info-Sheets/Criminal/Steps-in-a-Criminal-Case |
| ny_steps | NY CourtHelp — Basic Steps in a Criminal Case | https://nycourts.gov/Courthelp/Criminal/caseBasicsCriminal.shtml |
| ca_overview | California Courts Self-Help Guide — Criminal court overview | https://selfhelp.courts.ca.gov/fil/node/1597 |
| usao_mn | U.S. Attorney's Office, District of Minnesota — Criminal Procedures | https://www.justice.gov/usao-mn/criminal-procedures |
| tned_pretrial | U.S. Probation and Pretrial Services, E.D. Tenn. — Pretrial Expectations | https://www.tnep.uscourts.gov/content/pretrial-expectations |
| nj_probation | New Jersey Judiciary, Probation Services — Probation Supervision: What Happens Next? | https://www.njcourts.gov/sites/default/files/forms/12629_prob_sprv_what_expect.pdf |

Notes for the reviewer: several sources are from other states or federal courts (general courtroom practice, not a
Tennessee rule); the TN DHS page is written for child-support hearings; USAO-MN describes federal procedure; the
California page URL is the site's /fil/ path (English text). Re-check yearly; replace a source rather than keep a
broken link.
