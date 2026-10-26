# Justice Gavel — monetization plan and pricing (October 26, 2026 — v3: priced to match competitors)

*A quant's view: who pays, how much, what it costs to serve them, and which money is safe to take.
Figures marked "benchmark" come from the sources at the end. Scenario numbers are illustrative
models, not forecasts. Not legal or financial advice. Every line that charges lawyers or bail agents
for business needs an attorney's sign-off in each state first.*

## 0. Competitor price map (v3 — prices copied from the market)

Rule: match the competitor that sells the **same thing**. Where Justice Gavel has less (no citator,
no lawyer included), copy the competitor tier that has the same features, not the top one. Prices
checked October 26, 2026. The bond paperwork and bond records eBail and Captira include are now built
(Bond Desk, docs/BOND_DESK.md); what is in the code is listed in section 7.

| JG product | Closest competitor (published price) | JG price (copied) |
|---|---|---|
| **Bail agent software** — check-ins, court reminders, client tracking | **eBail** $99 / $199 / $349 a month, 20% off annual · **Captira** $99/mo flat · **BailBooks** from ~$55/mo | **$99 / $199 / $349 a month** (Starter 1 county · Pro 3 · Market all), **20% off annual** = $950 / $1,910 / $3,350 a year |
| Reminder texts sent for bail agents | Captira and eBail: **5¢ per text** | **5¢ per text** (our cost ≈0.7¢) |
| Re-arrest monitoring per client | eBail: 10 free, then **$0.65–0.75 per client a month** | **$0.75 per client a month** after 10 free — *paused until counsel clears arrest data use* |
| **Lawyer profile** — badge, photo, reviews, no competitor ads | **Avvo Pro** $49.95/mo ($599/yr) · **Justia Connect Pro** $19.99/mo ($199.80/yr) | **$49.95/mo, $499/yr** |
| **Lawyer case-match membership** — exclusive client requests in chosen areas | **LegalMatch** from **$455/mo** · FindLaw packages from ~$500/mo | **$455/mo**. Sell only once a county shows steady request volume; until then, Pro Profile only |
| **Per-lead (where state ethics rules allow)** | Google Local Services Ads, legal: **$195–250 a lead** · criminal market: DUI $75–150, felony $150–300, drug $50–125 · PI $100–600 | **DUI $110 · felony $225 · drug $90 · misdemeanor $110 · PI $250** (market midpoints) |
| **Attorney AI tools** (Esquire: AI research chat, motions, deadlines) | Budget legal AI: LegesGPT $13.99, TheLawGPT $19.99, Descrybe $25–50 · grounded research: Midpage $80–100, Vaquill $100–120 | **$49/mo** (Descrybe tier — no citator, so not $100) |
| **Consumer legal help subscription** (AI answers, no lawyer included) | AI chat apps $13.99–19.99 · Rocket Lawyer $34.99–64.99/mo, annual $149–349 · LegalShield $39.95–59.95 (real lawyers) · LegalZoom Personal $199/yr (lawyer consults) | **Legal Pro $19.99/mo or $149/yr** (AI-app tier; JG includes no lawyer, so not LegalShield's price) |
| One-time **Case Pass** (90 days) | No direct competitor. JustAnswer charges $1–5 to ask, then $28–60/mo — and draws FTC complaints for it. **Do not copy the trial-to-membership trap.** | **$29 one time** (≈ 1.5 months of Legal Pro) |
| **Consultation booking** (platform fee on top of the lawyer's own fee) | Rocket Lawyer sessions $149 (30 min) / $249 (60 min) *including* the lawyer | **$10 / $15 / $25** platform fee (unchanged; the lawyer sets their own fee) |
| **Court / PD reminder service** | **Tyler Technologies** (Burnet County TX): **$15,000/yr** ≤50k texts · $25k ≤100k · $45k ≤300k · $50k ≤500k · $70k ≤1M · **$6,135 setup** | **Same tiers: $15k / $25k / $45k / $50k / $70k a year + $6,000 setup** |
| **Bar prep** | **UWorld MBE** $419 · **AdaptiBar** $395 | Parked: 548 unreviewed questions can't be sold at their price. If relaunched after review, **$199** |

**Where this changes v2:**
- Bail agents: $69/$199/$399 → **$99/$199/$349**, to match eBail exactly.
- Lawyers: one $199 profile → **$49.95 profile + $455 case-match membership**, to match Avvo Pro and LegalMatch.
- Consumer: $14.99 → **$19.99/mo, $149/yr**.
- Counties: $12k → **Tyler's tiers**.
- Per-lead: moved to market midpoints.

**The one thing not to copy:** JustAnswer-style $1 trials that turn into $46–60 a month without
clear consent. Under the FTC's ROSCA and state auto-renewal laws that model draws complaints and
enforcement. Justice Gavel shows the price and the renewal before charging.

## 1. The core insight

The people the app serves (just arrested, and their families) are the worst customers to charge
and the best audience to aggregate:
- They need the app for weeks, not years.
- They are often broke.
- They are in crisis, which is where regulators look for unfair practices.

The businesses that serve them (bail agents, defense lawyers, PI lawyers, courts and public
defenders) have money and a measurable reason to pay.

**So: keep the core path free for people, and charge the professionals and institutions that
profit when those people show up, show up on time, and find help.**

The current price list does the opposite. Three consumer subscriptions ($19.99, $24.99, $34.99 a
month) are aimed at people whose need lasts a few weeks. Subscription apps already lose about 72%
of annual subscribers in year one (benchmark), and a criminal case is shorter than that.

## 2. What it costs to serve one person (so nothing bleeds)

| Cost driver | Unit cost | Note |
|---|---|---|
| AI answer (Claude Sonnet, ~2.5k tokens in / 600 out) | about $0.017 | The app's own price table ($3 / $15 per million tokens). There is already a $50/day budget cap. |
| Text message (Telnyx long code) | about $0.007 | $0.004 Telnyx + ~$0.003 carrier fees (benchmark). Plus $1/month per number and about $10/month for the carrier campaign. |
| Court reminder set (4 texts) | about $0.03 per court date | Push and email are about free. |
| Card payment (Stripe) | 2.9% + $0.30 | A $29 sale nets $27.86; $149 nets $144.38. |
| Apple fee | 0% via a web-checkout link (US, for now); 15–30% via in-app purchase | See rule M3 below. |

**Conclusion:** reminders, the rights card, the lawyer/bail search and family sharing cost pennies
per person. Keep them free. They drive downloads, goodwill and the data that sells the business
products.

## 3. Price list — what to sell, to whom, for how much

### A. Bail agents (sell first — fastest money, clearest return)
Every missed court date can cost a bail agent the full bail amount. Check-ins and reminders for
*their* clients protect that money.

| Plan | Price | Includes | Benchmark |
|---|---|---|---|
| Agent Starter | **$99/mo** ($950/yr) — matches eBail/Captira | 1 county of new-arrest alerts; check-ins and court reminders for clients (no per-client fee); **Bond Desk**: bonds and prospects, the agent's own forms filled from the case file, signing links by text/e-mail, typed e-signature with a certificate, ID and document requests, premium ledger with numbered receipts, payment plans, collateral receipts, power inventory, forfeiture deadlines, liability / surety / receivables / receipts / collateral reports | eBail $99 · Captira $99 |
| Agent Pro | **$199/mo** ($1,910/yr) — matches eBail | Same, 3 counties | eBail $199 |
| Agency | **$349/mo** ($3,350/yr) — matches eBail | Same, all counties | eBail $349 |
| Texts sent for the agent | **5¢ per text** (matches Captira/eBail) — signing links and payment reminders; billed on the plan invoice | | Replaces the planned $9.99/client, which is far above market |

Not built, so not sold: card payments taken online for the agent (needs Stripe Connect per agency),
multiple users per agency, re-arrest monitoring, general-ledger / premium-remittance accounting.

- **Stop:** the "Top placement in all searches" promise (the app doesn't do it, and it would be a
  paid recommendation).
- **Pause until a lawyer clears it:** the flat $100 per accepted bail lead, and selling new-arrest
  alerts to agents. Bail agents are tightly regulated: Florida, for example, makes it a felony for
  an agent to give anything of value to certain people (Fla. Stat. § 648.44). A flat subscription
  is the low-risk way to earn from agents.

### B. Defense and PI lawyers
| Product | Price | Rule that keeps it legal |
|---|---|---|
| Free basic listing | $0 | Keeps the directory complete and neutral. |
| Verified Pro Profile | **$49.95/mo or $499/yr, flat everywhere** (v3 — matches Avvo Pro). No guarantees, no refunds. |
| Case-match membership | **$455/mo** (matches LegalMatch). Exclusive client requests in chosen practice areas and counties. Launch per county once request volume is steady. No guarantees, no refunds. | Bar-verified badge, photo, practice areas, languages, intake form, booking calendar, video consults, profile stats. A flat advertising fee (ABA Rule 7.2(b)(1) allows paying for advertising). **Search order stays merit-based, never paid.** |
| Esquire practice tools | **$49/mo** (matches Descrybe-tier legal AI) | AI research, motion templates, deadline tools (only once the deadline rules are verified). |
| Per-lead (only in states whose ethics rules allow it) | **DUI $110 · misdemeanor $110 · felony $225 · drug $90 · PI $250 · civil rights $200 · employment $100** (v3 market midpoints) | The person asks for contact and picks the lawyer(s). Price is flat and never tied to the case fee. No "we recommend" wording. Benchmarks: criminal $50–$300 a lead; PI $100–$600, average ~$284. Today's $200 PI fee is below market. |

### C. Courts, public defenders, pretrial services (slowest to close, steadiest money)
Court reminders are a known government purchase. They are also the use the 21–26% evidence
supports, once texting via Telnyx is live.

| Package | Annual price | Benchmark |
|---|---|---|
| Small county / one PD office (≤50,000 texts) | **$15,000/yr** + $6,000 setup (v3 — matches Tyler) | Tyler Technologies, Burnet County TX: $15,000/yr for ≤50k texts + $6,135 setup |
| Mid county | **$25,000/yr** (≤100k texts) · **$45,000/yr** (≤300k) | Tyler tiers: $25k (≤100k), $45k (≤300k) |
| Large county | **$50,000/yr** (≤500k) · **$70,000/yr** (≤1M) | Tyler: $70k (≤1M) |

Texts cost ~$0.007 each, so 50,000 texts cost about $350. The gross margin is in the software and
the reporting (appearance rates). Start with a free 90-day pilot at one public defender office —
how Uptrust entered the market — and use the measured appearance rate to sell the next county.

### D. People in crisis (free core; one-time pass instead of subscriptions)
| Product | Price | Includes |
|---|---|---|
| Core path | **Free** | Rights card, lawyer + bail search, court reminders (push, browser, email, text), family followers, 3 AI questions a day |
| Case Pass | **$29 one time for 90 days**; $19 to extend 90 days | Unlimited AI questions, legal research, interpreter, audio transcription, bar-prep questions (the 24 Hour Advisor feature set). No renewal. Matches how long a case actually lasts. |
| Ongoing Legal Pro (probation, expungement, repeat users) | **$19.99/mo or $149/yr** (v3 — AI legal app tier; Rocket Lawyer's entry annual is $149) | Replaces the three current tiers. Benchmark: LegalShield $39.95–$59.95/mo includes real lawyers; this app can't promise that, so it must price well below. |
| Video consult booking fee | **$10 / $15 / $25** (15 / 30 / 60 min) — keep | Paid by the person, flat. Never a percentage of the lawyer's fee (fee-splitting). |
| Family Connect (3 nearest lawyers + 2 bail agents) | **Free** (was $28.99) | It charged a panicked family for publicly listed phone numbers. Low value, high complaint and FTC risk. Earn on the professional side instead. |

### E. Stop, park or spin off
- **Bar prep:** 548 unreviewed questions against $1,000+ incumbents. Park it, or sell separately at
  $19/mo only after review.
- **Never:** sell user data, run third-party ads to people in crisis, or rank by payment. Arrest
  status is sensitive data, and the privacy policy already promises "we do not sell".

## 4. Rules that keep the money (M1–M6)

- **M1. Flat fees beat per-lead fees.** Flat advertising fees are the clearly permitted model; per-lead
  depends on the state; percentage-of-fee is prohibited (ABA 5.4 fee-splitting). Launch with
  subscriptions, and add per-lead state by state after counsel.
- **M2. No paid ranking.** Paid placement is a "recommendation" under ABA Rule 7.2 comment 5 and some
  states' rules. Sell visibility (badge, photo, booking), not position.
- **M3. iPhone payments.** Apple's in-app purchase takes 15–30%. Since 2025 US apps may link to web
  checkout with no Apple commission. A Supreme Court ruling is expected by June 2027, and Apple may
  later be allowed a "reasonable" fee. The app currently shows a Stripe payment sheet inside the iOS
  app for digital subscriptions, which App Review can reject. Move consumer purchases to a web
  checkout link, and sell business plans on a web dashboard.
- **M4. Auto-renewal law.** Show the price, frequency and cancel path before purchase, and allow
  cancel online (done in the Terms on Oct 26). Prefer one-time passes for people in crisis.
- **M5. Cost caps.** Keep the AI daily budget cap. Use a cheaper model for simple questions and cache
  rights-card answers. Texts are already ~3¢ per court date.
- **M6. All sales final (owner decision, Oct 26).** No refunds and no guarantees on any product, consumer or professional. The only exceptions are billing errors and duplicate charges, which card networks reverse anyway through chargebacks (plus a fee). Consultation platform fees are non-refundable once confirmed. The policy is shown before every purchase, in the Terms and in the app (4 languages), which is what keeps chargeback disputes winnable.
- **M7. Annual prepay.** Offer 2 months free (above) to cut churn and fund growth up front.

## 5. Revenue scenarios at the end of year 1 (v2 — corrected after independent review)

The v1 scenarios had four problems, each fixed here:
- They counted per-lead fees (31% of revenue) that the plan itself pauses until counsel clears them.
- They treated the one-time Case Pass as recurring revenue, at an optimistic 3% buy rate.
- They assumed 3–8 county contracts in year 1, when government purchases take 6–18 months.
- They used lawyer and county prices that didn't match the price list.

| | Conservative | Base | Strong |
|---|---|---|---|
| Paying bail agents (avg plan) | 20 @ $120 | 60 @ $150 | 150 @ $180 |
| Agent reminder texts (5¢; 150 clients × 8 texts) | $1,200 | $3,600 | $9,000 |
| Lawyer Pro Profiles @ $49.95 | 40 | 120 | 300 |
| Case-match memberships @ $455 | 0 | 10 | 40 |
| County / PD contracts @ $15k | 0 (pilots) | 1 | 3 |
| Case Pass buyers per month ($29, one-time) | 0.5% of 4,000 | 1% of 12,000 | 1.5% of 40,000 |
| **Revenue per month** | **$6,778** | **$30,124** | **$97,835** |
| **Annual run rate** | **$81K** | **$361K** | **$1.17M** |
| Per-lead fees (only after counsel) | upside | upside | upside |

Base-case mix (v3):
- bail agents 42% (plans 30% + texts 12%)
- lawyers 35% (profiles 20% + case-match 15%)
- Case Pass 12%
- consult fees 7%
- counties 4%

Copying competitor prices lowers the lawyer profile price ($199 → $49.95) and moves the money to
the case-match tier, which, like LegalMatch's, must deliver real client requests to hold.

**AI cost guardrail:** the $50/day AI cap covers about 2,900 answers a day. At 12,000 monthly
users that can bind, so raise the cap as Case Pass revenue grows (each $29 pass covers about
1,700 answers) rather than cutting the free tier.

**Biggest risk (two-sided marketplace):** lawyers and bail agents pay only if arrested people reach
them through the app. Measure first, in the launch county:
1. contact requests per county per week;
2. contact requests per paying lawyer and agent per month;
3. month-3 churn of paying professionals.

If paying lawyers average fewer than 2 contact requests a month, no price will hold. Fix traffic
before raising prices.

## 6. 90-day order of operations

1. **Weeks 1–3:** turn on Stripe and Telnyx.
   - Re-price the bail agent plans as above.
   - Pull Tennessee's licensed bail agents from the Department of Insurance producer file and call
     them. Target: 10 paying agents.
2. **Weeks 3–6:** launch Verified Pro Profiles for Tennessee defense lawyers.
   - Do it with free basic listings and merit ranking left unchanged.
   - Target: 20 paying lawyers.
3. **Weeks 4–8:** replace the three consumer tiers with Case Pass + Legal Pro, make Family Connect
   free, and move iOS checkout to a web link.
4. **Weeks 6–12:** offer one Tennessee public defender office a free 90-day reminder pilot and
   measure appearance rates, which become your sales sheet.
5. **After counsel:** add per-lead pricing state by state.

## 7. What the code charges now (October 26, 2026)

| Item | In the code | Where |
|---|---|---|
| Bail-agent plans | $99 / $199 / $349 a month; $950 / $1,910 / $3,350 a year | `routes/billing/plans.js` BONDSMAN_TIERS |
| Check-ins | Included in every bail-agent plan (no per-defendant fee) | `routes/checkins.js` |
| Texts sent for agents | 5¢ each, logged when the carrier accepts the text, added once a day to the plan invoice (one Stripe invoice item per batch, never twice) | `AGENT_TEXT_CENTS`, `services/bondDesk/textBilling.js` |
| Bond Desk | Included in every bail-agent plan | `routes/bondDesk/*`, `routes/sign.js`, docs/BOND_DESK.md |
| Consumer plan | Legal Pro $19.99/mo or $149/yr; Legal Radar and 24 Hour Advisor retired (old subscribers keep them; never sold again) | `TIERS` (`legacy: true`) |
| Case Pass | $29 one time for 90 days, $19 adds 90 days after the current pass; no renewal | `CASE_PASS`, `routes/billing/casePass.js` |
| Family Connect | Free; no Stripe call | `routes/billing/connections.js` |
| PI / medical lead | $250 flat (civil rights $200, employment $100, ICE $75) | `routes/billing/attorneyLeadFee.js` + app `constants/leadFee.ts` |
| Attorney Pro Profile $49.95 / Case Match $455 | Priced, **not on sale** until the features exist | `ATTORNEY_MARKETING` (`on_sale: false`) |
| Refunds | All sales final; only billing errors and duplicate charges are refunded | `routes/billing/subscriptions.js` |

A Stripe price id set in the environment is used only when it equals the price above; otherwise the
exact amount is sent to Stripe inline (`services/stripeBilling.js` chargeItem). Re-run
`backend/scripts/setup-stripe-products.js` to create matching Stripe prices.

## Sources
- Criminal defense cost per lead: https://www.leadgen-economy.com/blog/criminal-defense-lead-generation-strategies/
- Personal injury lead costs: https://rankings.io/personal-injury-lead-costs/
- Captira bail software pricing: https://www.captira.com/pages/pricing-bail-management
- Burnet County TX / Tyler eNotices cost proposal: https://public.destinyhosted.com/burnedocs/2024/ComCt/20240723_4480/77%5FBurnet%5FCounty%5FTX%5FElectronic%5FNotifications%5FCost%5FProposal%2Epdf
- LegalShield pricing: https://legalshield.com/personal-plan/coverage-and-pricing/
- Telnyx SMS pricing: https://telnyx.com/resources/twilio-telnyx-sms-pricing
- 10DLC fees: https://www.calilio.com/blogs/10dlc-pricing
- RevenueCat subscription benchmarks 2026: https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026.md
- Apple v. Epic status: https://thenextweb.com/news/supreme-court-apple-epic-contempt-app-store-commission
- Lawyer lead-generation ethics: https://www.attorneyatwork.com/ethics-lead-generation-services/
- Fla. Stat. § 648.44: https://florida.public.law/statutes/fla._stat._648.44
- J-PAL court reminder study: https://www.povertyactionlab.org/node/2395
