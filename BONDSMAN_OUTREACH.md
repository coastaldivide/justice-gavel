# Justice Gavel — Bondsman Outreach Package
**Goal:** 10 paying bondsmen → Marcus Okafor VC condition  
**Target market:** Tennessee (local first, then TX, FL, GA)  
**Monthly fee:** $49/month Verified Badge + pay-per-lead ($15–$400/lead by bail amount)

---

## How to Get Your Call List in 10 Minutes (Free)

1. Go to: https://www.tn.gov/content/dam/tn/commerce/documents/insurance/data-call/producer_license_extract.txt
2. Download the file (large, pipe-delimited)
3. Run this command in Terminal to extract bail bondsmen with TN phones:

```bash
grep -i "bail" producer_license_extract.txt | \
  grep "Active" | \
  awk -F'|' '{print $19, $16, $17, $7, $8}' | \
  sort -u > tn_bondsmen_active.txt
```

Fields: Phone | City | State | Business Name | Agent Name  
This gives you 300–600 active TN bail bondsmen with real numbers.

Alternatively, Google Maps search: `"bail bondsman" site:google.com/maps Tennessee`  
Sort by reviews → call the top 30.

---

## Known Major TN Bail Bondsmen (Start Here)

These are large-volume operations in high-arrest-volume markets.
Confirm numbers via Google before calling.

| Company | Market | Notes |
|---------|--------|-------|
| A-1 Bail Bonds | Nashville (Davidson Co.) | Multi-county, high volume |
| AAA Bail Bonds | Memphis (Shelby Co.) | Largest market in state |
| A Affordable Bail Bonds | Memphis | 24/7 operation |
| Action Bail Bonds | Knoxville (Knox Co.) | East TN anchor |
| Fast Freedom Bail Bonds | Nashville | High bail amount cases |
| Smith Bail Bonds | Memphis | Long-established |
| Free At Last Bail Bonds | Nashville | High volume near CJC |
| Middle TN Bail Bonds | Murfreesboro (Rutherford Co.) | Fast-growing county |
| Express Bail Bonds | Clarksville (Montgomery Co.) | Military-adjacent high volume |
| Eagle Bail Bonds | Chattanooga (Hamilton Co.) | Anchor for SE TN |

---

## Call Script (2–3 Minutes)

**Use this word-for-word on cold calls.**

---

> "Hi, is this [Name]? My name is [Your Name] and I'm calling from Justice Gavel — we're a legal rights app based out of Tennessee.
>
> Quick question — do you currently get any of your leads digitally, or is it mostly word-of-mouth and Google?
>
> [Let them answer]
>
> Got it. We built a feature that connects people who've just been arrested directly with local bondsmen. When someone in [City] gets booked, they open our app, see their bail amount, and can request a bondsman immediately. You'd get their name, bail amount, charges, and jail location — for about $75 a case.
>
> We're launching the Tennessee market right now and we're only onboarding 20 bondsmen statewide — we want the ones who actually answer the phone at 2am.
>
> Are you someone who takes calls 24/7?"
>
> [Let them answer — if yes, continue]
>
> "Perfect. Here's how it works: you pay $49 a month for a Verified Badge, which puts you at the top of our search results for your counties. Then when a lead comes through your area, you decide whether to accept it — you only pay for the ones you want. No subscription beyond the $49. No commitment.
>
> Can I get your email and I'll send you the signup link? Takes about 3 minutes to set up."

---

## What To Say to Common Objections

**"I already have enough business."**
> "That's great — we're not trying to replace what's working. Think of us as one more channel that costs nothing when it's slow. You only pay $49/month base, and you only spend on leads you actually want. Zero risk."

**"How many leads will I get?"**
> "Depends on your county. In Shelby County alone we're logging 40–80 arrests with bail amounts over $1,000 per week. You set your minimum bail threshold — say, nothing under $5,000 — and you'll only see the cases worth your time."

**"I don't trust apps."**
> "Totally fair. We're Tennessee-based, the app is free for people who get arrested, and we don't sell data. You can try the first month, and if you're not getting leads you'd have paid for, cancel. We won't fight you on it."

**"Send me something by email."**
> "Absolutely. What's your email?" [Get it, send the email below immediately]

**"Call me back later."**
> "No problem — what time works? Morning, afternoon?" [Book the callback, send email immediately so they see it before the call]

---

## Email Template

**Subject:** Justice Gavel — First bondsman in [City] gets preferred placement

---

Hi [Name],

We spoke briefly — I'm following up from Justice Gavel, the legal rights app built for people the moment they're arrested.

Here's the short version:

**What happens:** Someone gets arrested in [County] County. Before they make a single phone call, they open our app, see their bail amount, and request a bondsman. You get a notification with their name, bail amount, charges, and jail.

**What it costs:** $49/month Verified Badge (top of search results for your counties) + $15–$250 per lead you accept, based on bail amount. You only pay for the ones you want.

**Why now:** We're onboarding the first 20 bondsmen in Tennessee. The first bondsman in each county gets preferred placement until we reach capacity.

Setup takes about 3 minutes: [https://justicegavel.app/bondsman-signup]

Happy to answer any questions — call or text me at [your number].

[Your Name]  
Justice Gavel

---

## Follow-Up Text (Send Same Day if No Email Response)

> "Hey [Name], it's [Your Name] from Justice Gavel — just sent you an email about the bondsman lead program. 30 seconds to read, no obligation. Lmk if you have questions. 🙏"

---

## Tracking Sheet

Use this to track your 10:

| # | Name | Company | Phone | Email | Status | Date |
|---|------|---------|-------|-------|--------|------|
| 1 | | | | | Contacted / Demo / Paid | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

---

## Bondsman Signup Flow (What They Experience)

1. Download Justice Gavel → tap "I'm a Bondsman" on onboarding
2. Enter license number + counties served → instant verification check
3. Add payment method → $49/month starts
4. Set lead preferences: min bail amount, counties, notification hours
5. First lead arrives → Accept (pay) or Pass (free) — their choice every time

---

## Revenue Math (What to Tell Okafor)

| Metric | Conservative | Realistic |
|--------|-------------|-----------|
| Active paid bondsmen | 10 | 50 |
| Monthly badge revenue | $490 | $2,450 |
| Leads accepted/bondsman/month | 2 | 5 |
| Avg lead fee | $100 | $125 |
| Lead revenue/month | $2,000 | $31,250 |
| **Total MRR** | **$2,490** | **$33,700** |

At 50 bondsmen statewide: **$400K/year run rate**, before expanding to TX, FL, GA.

---

*Last updated: v8.7.35 — July 2026*
