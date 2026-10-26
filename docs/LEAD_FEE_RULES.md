# Lead-fee rules by state (October 26, 2026)

How lawyers may pay Justice Gavel for client requests, state by state. The code is
`backend/src/services/leadRules.js`; this page explains it. Not legal advice. Rules
change, so re-check each opinion before launching a new state.

## Rules that apply in every state

1. **Flat price per lead type.** The price never changes with whether the person hires the
   lawyer, the size of the case or the lawyer's fee. It is never a percentage of the fee
   (ABA Model Rule 5.4). Prices: personal injury / medical $250, civil rights $200,
   employment $100, ICE detention $75.
2. **No recommendation.** Requests are shown by state, city and case type only. Every lead
   screen and API response carries this disclosure:
   > Justice Gavel does not recommend or endorse any lawyer. Lawyers pay to receive requests.
   > Requests are shown by state, city and case type only, and the price never depends on
   > whether you hire the lawyer.
3. **The person asked.** Lawyers only answer requests someone sent. They never cold-contact.

## Ways to pay

| Mode | What it means | API |
|---|---|---|
| `per_lead` | Pay for one request at a time by card, or spend credits | `POST /pi-lead/accept/:id`, or `/pi-lead/claim/:id` |
| `credits` | Only prepaid credit packs: a fixed number of credits at a fixed price, spent on requests the lawyer chooses | `/pi-lead/credits/buy`, `/confirm`, `/pi-lead/claim/:id` |
| `subscription` | Only a flat monthly fee for chosen areas. Not on sale yet, so no leads are sold there | — |
| `directory_only` | No lead sales. People call listed lawyers directly | — |

**Credits:** 1 credit = $25. Packs: 20 credits ($500), 40 ($1,000), 100 ($2,500). Lead costs
in credits: personal injury / medical 10, civil rights 8, employment 4, ICE 3. Credits are never
refunded because of how a case turns out.

## The state table

| State | Mode | Source | What it says |
|---|---|---|---|
| **Tennessee** (launch) | credits | Tenn. Formal Ethics Op. 2018-F-165 | Fixed-price quote packages used at the lawyer's discretion are allowed. Fees based on how many people contact or hire the lawyer are not. |
| New York | per_lead | NYSBA Ethics Op. 1294 (Mar. 2026); Op. 1131 | Per-lead or credits are allowed if there's no recommendation, selection is neutral and disclosed, and the price doesn't vary with retention or fee. |
| Washington | per_lead | WSBA Advisory Op. 201401 | Flat, monthly or pay-per-click is allowed, with matching on disclosed objective criteria. |
| Texas | subscription | Tex. Ethics Ops. 561, 573; Penal Code § 38.12 | Only a fixed subscription for chosen areas. Paid solicitation is barratry. |
| Florida | credits **after registration** | R. Regulating Fla. Bar 4-7.22 | Register as a Qualifying Provider and file annual reports first. No fee division. |
| California | directory_only (credits once certified) | B&P § 6155; *Jackson v. LegalMatch.com*; AB 931 / SB 37 (2026) | Sending a request to chosen lawyers counts as a referral and needs State Bar certification. |
| Colorado | directory_only | SB 26-174, C.R.S. § 6-1-741 (in effect Aug. 12, 2026) | Lead generation for legal services is banned in every form, including subscriptions. |
| New Jersey | credits | ACPE Op. 732 / CAA Op. 44 / UPL Op. 54 (2017) | Flat fees only, no per-matter marketing fee. |
| Ohio | credits | Bd. Prof. Conduct Op. 2016-3 | Same. |
| Pennsylvania | credits | Formal Op. 2016-200 | Same. |
| South Carolina | credits | Ethics Adv. Op. 16-06 | Same. |
| Every other state | credits | ABA Model Rule 7.2(b)(1) and cmt. [5]; Rule 5.4(a) | The default. |

## Turning on a registration-gated state

Florida and California stay `directory_only` until the filing is done. The operator then sets
the matching environment variable on the server (code never sets it):

- Florida: `LEAD_REG_FL_QUALIFYING_PROVIDER=1`, after the Florida Bar registration and the
  first annual report.
- California: `LEAD_REG_CA_CERTIFIED_LRS=1`, after State Bar certification as a lawyer
  referral service.

## Adding or changing a state

Edit `STATE_LEAD_RULES` in `services/leadRules.js` with the mode, the source and a one-line
note. Then run `backend/src/__tests__/lead_rules.test.js` and the G9b test in
`integration/pro_billing_g.int.test.js`.

## Sources

- Tenn. Formal Ethics Op. 2018-F-165: https://ezel.ai/ethics-opinions/tnbpr/2018-f-165-legal-services-marketplace-website
- NYSBA Op. 1294: https://nysba.org/ethics-opinion-1294-solicitation-advertisement-lead-generators/
- Texas Op. 561: https://legalethicstexas.com/resources/opinions/opinion-561/ · Op. 573: https://ezel.ai/ethics-opinions/tx/573-paying-to-participate-internet-client-lawyer-service
- WSBA Op. 201401: https://ezel.ai/ethics-opinions/wsba/201401-online-lead-generation-services
- Florida Bar Qualifying Providers: https://www.floridabar.org/ethics/etad/qualifying-providers-lawyer-referral-services/
- *Jackson v. LegalMatch*: https://www.ocbar.org/All-News/News-View/ArticleId/3799/April-2020-Ethically-Speaking-Jackson-v-LegalMatch-com-An-Examination-of-Online-Lead-Generation-Services-for-Attorneys
- California AB 931 / SB 37: https://www.ceb.com/wp-content/uploads/2026/02/CEB_Two-New-CA-Laws-Tighten-Standards-1.pdf
- Colorado SB 26-174: https://webris.org/colorado-lead-generation-ban/
- NJ / OH / PA / SC Avvo opinions: https://www.lawyersmutualnc.com/risk-management-resources/articles/the-road-less-traveled-north-carolina-splits-from-other-jurisdictions-on-fee-splitting-issue
