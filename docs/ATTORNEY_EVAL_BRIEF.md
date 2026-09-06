# Justice Gavel — Attorney Evaluation Brief

## What This Is

We are building an AI assistant that helps criminal defendants understand their legal rights.
Before we launch publicly, we need licensed criminal defense attorneys to write gold-standard
answers to 200 real defendant questions — so we can measure how accurately our AI answers them.

This document tells you exactly what we need, what we pay, and how to submit.

---

## Compensation

**$25 per question. $1,000 per state file (40 questions).**

Payment via Venmo, PayPal, or check within 5 business days of accepted submission.
You can take one state file ($1,000) or multiple ($2,000–$5,000).

No minimum commitment. If the quality of the first 10 answers is good, we'll pay for the rest
and send more files.

---

## The Files

Each state has a JSON file with 40 questions:

| File | State | Pay |
|------|-------|-----|
| `TN_gold_answers.json` | Tennessee | $1,000 |
| `TX_gold_answers.json` | Texas | $1,000 |
| `FL_gold_answers.json` | Florida | $1,000 |
| `CA_gold_answers.json` | California | $1,000 |
| `NY_gold_answers.json` | New York | $1,000 |

**Ideal attorney profile:** 3+ years criminal defense in the state. Public defenders,
former public defenders, and solo criminal defense practitioners are all excellent fits.

---

## What You're Writing

For each question you fill in four things:

### 1. `gold_answer` — the correct answer (2-5 sentences)

Write what a competent criminal defense attorney would tell a defendant who asked this.
Direct, accurate, and specific to the state listed. Include the governing statute or case.

**Example question:** "My bail is set at $5,000. The bondsman wants $500 to post bond.
Is that legal in Tennessee?"

**Example answer:** "Yes, that is legal and standard in Tennessee. Bail bondsmen in Tennessee
are permitted to charge a premium of 10% of the total bail amount, which would be $500 on a
$5,000 bond. This fee is set by T.C.A. § 56-53-103. The premium is non-refundable even if
charges are dropped. You are not getting that $500 back regardless of how your case resolves."

### 2. `key_facts` — list of facts a correct answer must contain

These become the rubric for grading AI responses. If the AI's answer contains all your key
facts, it scores well on factual accuracy.

**Example:** `["10% premium rate", "non-refundable", "T.C.A. § 56-53-103"]`

### 3. `gold_citations` — the specific legal authorities

Use proper citation format:
- Cases: `Miranda v. Arizona, 384 U.S. 436 (1966)`
- Statutes: `T.C.A. § 40-11-118` or `Tex. Code Crim. Proc. Art. 17.03`
- Constitutional: `U.S. Const. amend. IV`

### 4. `if_must_refuse_say` — for questions marked `must_refuse: true`

Some questions ask the AI to make a strategic judgment the AI shouldn't make.
Write what the AI SHOULD say when declining. Example: "I can give you information
about how plea deals work, but whether this specific deal is right for your situation
depends on facts about your case that only your attorney knows. Please consult your
defense attorney before deciding."

---

## What Makes a Good Answer

**Factually accurate.** Every fact in your answer should be verifiable from the citation
you provide. If you're not certain of the specific statute number, look it up.

**State-specific.** If the law differs from the federal rule or from neighboring states,
say so. "Unlike federal law, Tennessee requires..." is the kind of detail that matters.

**Calibrated.** Use "typically" or "in most cases" for areas where judges have discretion.
Use direct statements for clear statutory rules. Don't hedge on settled law.

**Appropriately scoped.** These are information questions, not advice questions.
You're writing "how does bail work in Tennessee" not "should this defendant post bail."

---

## What Makes a Bad Answer

- Citing a statute without checking whether it says what you claim
- Giving a generic federal-law answer when the question is state-specific
- Over-hedging ("it depends on many factors") when the law is clear
- Under-hedging ("definitely" on a question where judges have wide discretion)
- Forgetting to note major exceptions (e.g., DUI bail in a state with mandatory minimums)

---

## The 5 Categories

**Bail** — How bail is set, reduced, and posted. Bondsman fees. Conditions of release.
**Rights during a stop** — What police can and can't do. What you must and must not say.
**Expungement eligibility** — Which convictions qualify, waiting periods, what expungement does.
**Arraignment procedure** — What happens, when it occurs, what to expect, what to plead.
**Plea basics** — How plea bargains work, what rights are waived, what no-contest means.

---

## How to Submit

1. Email `aa.n.hart@gmail.com` saying which state file(s) you want
2. We send you the JSON file(s) and your NDA (one page)
3. Fill in the JSON fields for each question (use any text editor)
4. Send back the completed file(s)
5. We review, confirm quality, and pay within 5 business days

**Timeline:** Most attorneys complete a state file in 4-6 hours working from memory
and occasional statute lookups. Rush timeline available for premium pay.

---

## Confidentiality

The questions and your answers become part of Justice Gavel's internal evaluation dataset.
Your name and bar number are recorded for internal attribution only — not published.
We will send a one-page NDA before you start.

---

## Questions?

Aaron Hart — `aa.n.hart@gmail.com`

*Justice Gavel is building the AI layer for criminal defense. This evaluation is how we
ensure we're actually helping defendants rather than misleading them.*
