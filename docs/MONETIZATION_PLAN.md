# Justice Gavel — monetization plan and pricing (October 26, 2026 — v2, after independent quant review)

*A quant's view: who pays, how much, what it costs to serve them, and which money is safe to take.
Figures marked "benchmark" come from the sources at the end. Scenario numbers are illustrative
models, not forecasts. Not legal or financial advice. Every line that charges lawyers or bail agents
for business needs an attorney's sign-off in each state first.*

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
| Agent Starter | **$69/mo** ($690/yr) | Upgraded listing (photo, hours, languages, license number shown), up to 25 active clients with GPS check-ins and court reminders by text/push | Captira charges $99/mo for full bail software; many agents already pay that, so Starter must sit below it (v2: $99 → $69) |
| Agent Pro | **$199/mo** ($1,990/yr) | 3 counties, up to 100 active clients, missed-check-in alerts, reports | |
| Agency | **$399/mo** ($3,990/yr) | All counties, up to 300 active clients, multiple users | |
| Extra clients | **$1.50 per client per month** above the plan limit | | Replaces the planned $9.99/client, which is far above market |

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
| Verified Pro Profile | **$199/mo flat, everywhere** (v2). **Founding rate $149/mo** for the first 50 lawyers, locked for 12 months. No guarantees, no refunds; billed monthly or annually, cancel anytime to stop renewal. | Bar-verified badge, photo, practice areas, languages, intake form, booking calendar, video consults, profile stats. A flat advertising fee (ABA Rule 7.2(b)(1) allows paying for advertising). **Search order stays merit-based, never paid.** |
| Esquire practice tools | **$49/mo**, or included free in Pro Profile | AI research, motion templates, deadline tools (only once the deadline rules are verified). |
| Per-lead (only in states whose ethics rules allow it) | **DUI $90 · misdemeanor $75 · felony $150 · drug $75 · PI $250 · civil rights $200 · employment $100** | The person asks for contact and picks the lawyer(s). Price is flat and never tied to the case fee. No "we recommend" wording. Benchmarks: criminal $50–$300 a lead; PI $100–$600, average ~$284. Today's $200 PI fee is below market. |

### C. Courts, public defenders, pretrial services (slowest to close, steadiest money)
Court reminders are a known government purchase. They are also the use the 21–26% evidence
supports, once texting via Telnyx is live.

| Package | Annual price | Benchmark |
|---|---|---|
| Small county / one PD office (≤50,000 texts) | **$12,000/yr** + $5,000 setup | Tyler Technologies, Burnet County TX: $15,000/yr for ≤50k texts + $6,135 setup |
| Mid county (≤150,000 texts) | **$25,000–$40,000/yr** | Tyler tiers: $25k (≤100k), $45k (≤300k) |
| Large county (≤1M texts) | **$50,000–$70,000/yr** | Tyler: $70k (≤1M) |

Texts cost ~$0.007 each, so 50,000 texts cost about $350. The gross margin is in the software and
the reporting (appearance rates). Start with a free 90-day pilot at one public defender office —
how Uptrust entered the market — and use the measured appearance rate to sell the next county.

### D. People in crisis (free core; one-time pass instead of subscriptions)
| Product | Price | Includes |
|---|---|---|
| Core path | **Free** | Rights card, lawyer + bail search, court reminders (push, browser, email, text), family followers, 3 AI questions a day |
| Case Pass | **$29 one time for 90 days**; $19 to extend 90 days | Unlimited AI questions, document scan + translation, interpreter, audio transcription, case file tools. Matches how long a case actually lasts. |
| Ongoing Legal Pro (probation, expungement, repeat users) | **$14.99/mo or $149/yr** (v2: true "2 months free") | Replaces the three current tiers. Benchmark: LegalShield $39.95–$59.95/mo includes real lawyers; this app can't promise that, so it must price well below. |
| Video consult booking fee | **$10 / $15 / $25** (15 / 30 / 60 min) — keep | Paid by the person, flat. Never a percentage of the lawyer's fee (fee-splitting). |
| Family Connect ($28.99 for the 3 nearest lawyers + 2 bail agents) | **Make free** | It charges a panicked family for publicly listed phone numbers. Low value, high complaint and FTC risk. Earn on the professional side instead. |

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
| Paying bail agents (avg) | 20 @ $99 | 60 @ $110 | 150 @ $140 |
| Paying lawyers (founding/list mix) | 25 @ $174 | 80 @ $174 | 200 @ $199 |
| County / PD contracts signed | 0 (pilots only) | 1 @ $12k/yr | 3 @ $12k/yr |
| Case Pass buyers per month (one-time, not recurring) | 0.5% of 4,000 | 1% of 12,000 | 1.5% of 40,000 |
| **Revenue per month** | **$7,735** | **$28,000** | **$90,950** |
| **Annual run rate** | **$93K** | **$336K** | **$1.09M** |
| Per-lead fees (only after counsel, state by state) | upside | upside | upside |

Base-case mix:
- lawyers 50%
- bail agents 27% (subscriptions 24% + extra clients 3%)
- Case Pass 12%
- consult fees 8%
- counties 4%

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
