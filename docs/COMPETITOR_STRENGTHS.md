# Competitor strengths, our strengths, and what to borrow (October 27, 2026)

How this was made: competitor facts come from their own sites and press coverage (sources at the end;
vendor claims are marked as claims). Justice Gavel facts come from scanning this repository
(branch `consumer-core-path`, v8.7.61 plus the merge). "Gap" means I looked for it in the code and did
not find it.

---

## 1. What the competitors do well

### Bail-agent software (Bond Desk's direct competitors)
| Company | What they do well |
|---|---|
| **Captira** | $1 first month, then $99/mo flat, cancel in the app, no contract. Texts 5¢. E-sign with no per-document fee; their staff load an agency's custom surety forms. **Automatic court reminders by text to the defendant, indemnitors and contacts.** GPS check-ins by text, **no app to install**. **Immediate alert when a check-in is missed.** GeoFence alerts by text and e-mail. **Defendant Watch**: alerts when a tracked defendant is booked again (multi-state, about 99¢ per defendant). **Auto Pay** on payment plans (99¢ per payment). "Bail Pay" takes money before the case file exists. Power inventory, forfeiture tracking shared with recovery agents, surety and Department of Insurance reports. First case the same day; migrations in 1–3 days; export any time. Claims 600+ agencies in 42 states. |
| **eBail** | $99 / $199 / $349 tiers (20% off yearly), unlimited bonds, defendant mobile app, GEO check-ins, auto reminders, arrest monitoring, background and ID checks, powers / forfeitures / reports on every tier. $1 for 14 days. Charges per e-sign after 10 ($0.60–$0.75) and per monitored defendant. |
| **BailBooks** | From about $55/mo, unlimited users, real-time GPS and geofence alerts, re-arrest tracking, SMS + e-mail reminders, free defendant app, payment portal, remote co-signer e-signing. |
| **Simply Bail** | Payment plans **scheduled and collected automatically**, re-arrest alerts, recovery-agent access, reports to surety, sheriff and Department of Insurance, unlimited offices, daily backups. |

### Court reminders and people in the system
| Company / program | What they do well |
|---|---|
| **Uptrust** (public defenders and counties) | Sold through **public defender offices**, which have phone numbers for far more clients than courts or police do. Connects clients with **rides, child care and elder care** to get to court, and lets a social worker message clients about services. Priced about $20,000 to install plus $2 per defendant per year (2018). Founder claims failure-to-appear rates cut from 15–20% to 5–10% (not independently checked). Contra Costa offices reported 2.5% failure to appear among people who got reminders. |
| **NYC study (ideas42 / University of Chicago Crime Lab)** | Best text messages cut missed court dates **26%**; with a clearer summons form, **36%**. The winning messages said **what happens if you miss court, what to expect at court, and asked the person to make a plan** (how they will get there, time off, child care). Three texts in the week before, **plus a text after a missed date**. |
| **VINE** (Appriss / Equifax) | Free custody alerts in 48 states: tells victims and families when someone is **released or transferred**. 20M+ users a year; 3.3M registrations, 40M notifications, 49M searches in 2016. **Phone (toll-free, voice menu), text, e-mail, app; TTY; 195 languages through live operators; staffed 24/7.** |
| **Ameelio** (nonprofit) | Free letters, photos and video calls for families of incarcerated people; about 40,000 app users early on. Proves families will adopt a free, respectful app built for them. |

### History we can learn from
| Company | What happened | What it teaches us |
|---|---|---|
| **Avvo Legal Services** | Flat-fee legal services where Avvo set the price and took a "marketing fee" from the lawyer. Eight state bars (NY, OH, PA, SC, NJ, UT, VA, IN) said lawyers should not take part: fee split with a non-lawyer, paying for referrals, holding client money, Avvo setting scope and price, a satisfaction guarantee. Shut down July 31, 2018. | Our attorney leads are flat fees not tied to the case fee, we never set the lawyer's price, and we give no guarantees — keep all three. Get the counsel letter (docs/COUNSEL_REVIEW_PACKET.md §1) before selling leads outside Tennessee. |
| **DoNotPay** | FTC order (final January 2025): $193,000, notice to subscribers, and no claims that it works like a lawyer without evidence. Charge: "robot lawyer" marketing, with no testing and no lawyers checking the output. | Never market the AI as a lawyer. Keep the disclaimer gate and the withheld-unless-sourced rule, and add a recorded lawyer review of a sample of AI answers. |
| **Promise** (bail-reform start-up) | Raised $3M (Roc Nation, First Round, Kapor) in 2018 to offer alternatives to cash bail. The founder stopped selling to jails because the tools made jailing people *more efficient*, then pivoted to payment plans for government fees and utilities and raised a $20M Series A. | Keep the person in trouble as the customer. When we sell to counties, sell appearance support, not surveillance. Government fee payment plans are a proven adjacent market. |

---

## 2. What Justice Gavel already does well (found in the code)

- **Free crisis path with no account.** "Just arrested?" opens a state rights card, and the same search returns both lawyers and bail agents.
- **Court reminders without an account.** Guests get up to four reminder notifications on their phone per court date (7 days, 3 days, the evening before and the morning of); texts need an account. Family followers are added with consent, Family Connect is free, and there is a free in-app guide for a missed court date.
- **Eight languages throughout:** English, Spanish, Portuguese, Vietnamese, Haitian Creole, Chinese (Simplified), Arabic (right to left) and Tagalog. The four newer ones were translated by Claude and need review by a native-speaker legal translator before launch (docs/TRANSLATIONS.md).
- **Bond Desk matches the market and adds what others lack:**
  - **Pricing:** $99 / $199 / $349 plans, texts at 5¢, no per-client fee for check-ins.
  - **Records:** an integer-cent ledger, numbered receipts, payment plans that refuse totals that don't add up, power inventory, collateral receipts, forfeiture deadlines, and CSV reports with formula-injection protection.
  - **E-signature:** each signer gets a personal link, uploads ID and a selfie, and types their name, which must match the name on file. Every signed copy carries a **SHA-256 certificate page**. Most competitors don't publish this level of audit detail.
- **Texting done right:** STOP from any number blocks every future text, and delivery status is tracked and monitored.
- **Legal honesty:** legal tables appear only when a row has a cited source checked on a date; anything else is withheld. AI features are locked until the user accepts the disclaimer, and a counsel review packet is written. State lead-fee rules are in code (for example, Tennessee sells credit packs only, and Colorado and Texas leads are not sold).
- **Operations most start-ups lack:**
  - job-health and text-delivery alerts;
  - a nightly encrypted backup with a restore drill;
  - a launch check of every required setting;
  - CI on every PR;
  - **28,110 unit tests, 414 database tests and 1,029 frontend tests, all passing**;
  - a 40/40 smoke test and a clean sweep of all 678 routes.
- **Plain pricing:** no refunds and no guarantees, stated before purchase; the Case Pass never renews.

---

## 3. Where to strengthen, using what competitors prove works

Ordered by value for the Tennessee bail-agent launch, then the public-defender pilot.

| # | Gap in Justice Gavel (checked in code) | Who proves it works | What to build |
|---|---|---|---|
| 1 | **Bond Desk sends no automatic court-date reminders to the defendant and indemnitors.** Bond Desk texts today are signing links and payment reminders the agent sends by hand. | Captira, eBail, BailBooks, Simply Bail (all four) | Reuse the consumer reminder engine: when a bond has a court date, text the defendant and every indemnitor at 7 days, 3 days, the evening before and the morning of. Bill at 5¢ through the existing text billing, and honour STOP. Agents ask for this first, because a missed court date becomes a forfeiture. |
| 2 | **Check-ins need the app**: reminders are push notifications only. | Captira (by text, no install) | Text a check-in link that opens a web page with no account, the same way signing links work. Share location only with the defendant's consent. |
| 3 | **A missed check-in doesn't alert the agent**; it only lowers the compliance score. | Captira | At the end of the defendant's day, text or e-mail the agent "missed check-in" and show it on the Bond Desk dashboard. |
| 4 | **No re-arrest alert for an agent's own defendants.** We already ingest county arrest rosters and send new-arrest alerts by county. | Captira Defendant Watch, eBail, BailBooks, Simply Bail | Match new roster bookings against active bonds (name + date of birth) and alert the agent who wrote the bond. Ask counsel first, as with question 1.2. |
| 5 | **Payment plans aren't collected automatically.** | Captira Auto Pay, Simply Bail | Save the payer's card through Stripe (with consent text), charge on each due date, and post the payment to the ledger and receipt with a numbered receipt. Same no-refund wording. |
| 6 | **Reminder texts are short, and none follows a missed date.** Today: "Arrive early and bring your paperwork." | NYC study (26% fewer missed dates) | Rewrite the texts in all four languages to say what happens if you miss court, what to expect, and ask for a plan. Send a text the morning after a missed date with what to do now; the missed-court guide already exists. |
| 7 | **No help getting to court.** | Uptrust | Add a "plan your court day" checklist (ride, time off, child care) with local transit and 211 links, and a family follower can offer a ride. |
| 8 | **We don't measure appearance.** Court dates can be marked attended or missed, but nobody is asked. | Uptrust and Captira publish numbers; we have none | Ask "Did you make it to court?" by text or push after each date. Report the appearance rate per county; this is the public-defender pilot metric and the investor proof point. |
| 9 | **No custody alerts for families.** | VINE (20M users a year) | Let a family member follow a booking and get a text when the person is released or transferred, using the roster data we already pull. |
| 10 | **Reach: four languages, no phone access.** (Done Oct 27 2026: eight languages — Haitian Creole, Chinese, Arabic and Tagalog added; the court-date phone line answers in English and Spanish.) | VINE (phone menu, TTY, 195 languages) | Add Haitian Creole, Chinese, Arabic and Tagalog, and a toll-free number that reads the next court date (Telnyx voice). |
| 11 | **No sales channel through public defenders.** | Uptrust; NYC found phone numbers for only 13% of people from police data, versus 90% through public defenders | Make the public-defender pilot the county go-to-market. A defender uploads the client list, and clients get reminders and a two-way message line to the office. Benchmark price: Uptrust's ~$20K setup plus $2 per person per year. |
| 12 | **Onboarding friction for agents.** | Captira ($1 first month, staff load your forms, first case same day); eBail ($1 for 14 days) | Offer $1 for the first month, form setup done for the agency, and a CSV import of open bonds (none exists today). |

### Rules we keep, because history shows the cost of breaking them
- **Avvo:** no fee tied to the lawyer's fee, no setting lawyers' prices, no guarantees.
- **DoNotPay:** never say the AI replaces a lawyer; keep evidence that it is accurate.
- **Promise:** the person in trouble stays the customer; county work stays about getting people to court.

---

## Sources
- [Captira — bail software comparison (Captira, eBail, BailBooks, Simply Bail)](https://www.captira.com/pages/bail-software-comparison) (vendor page; competitor cells partly unverified)
- [Captira — forfeiture prevention](https://www.captira.com/pages/forfeiture-prevention)
- [ABA Journal — text-message reminders and failure to appear (Uptrust, NYC study)](https://www.abajournal.com/lawscribbler/article/text_messages_can_keep_people_out_of_jail)
- [Public Radio Tulsa — Tulsa County public defender using Uptrust](https://www.publicradiotulsa.org/post/tulsa-county-public-defender-now-using-text-reminders-court-and-more)
- [Arkansas DPS — VINE overview 2018](https://dps.arkansas.gov/wp-content/uploads/2020/05/VINE_Overview_2018-1.pdf)
- [Proskauer — Ameelio pro bono spotlight](https://www.proskauer.com/blog/pro-bono-spotlight-ameelioorg-bridging-financial-barriers-for-incarcerated-individuals-trying-to-stay-in-touch-with-loved-ones)
- [Hinshaw — Avvo shuts down its legal services product](https://www.hinshawlaw.com/newsroom-updates-avvo-shuts-down-its-legal-services-product-in-wake-of-ethics-opinions-warning-attorneys-not-to-participate.html)
- [FTC — DoNotPay final order](https://www.ftc.gov/node/87474)
- [TechCrunch — Promise raises $3M (2018)](https://techcrunch.com/2018/03/19/jay-zs-roc-nation-and-first-round-capital-invest-3-million-in-bail-reform-startup-promise)
- [TechCrunch — the art of pivoting (Promise)](https://techcrunch.com/2020/09/16/the-art-of-pivoting-with-phaedra-ellis-lamkins-and-jessica-matthews)
- [Promise $20M Series A](https://www.accountsrecovery.net/2021/02/22/payment-plan-provider-to-govt-agencies-utilities-raises-20mm/)
