# Owner decisions and lawyer review — from the October 2026 debug pass

The debug pass (sections A–H, details in `docs/fix-notes/debug_pass.md`) fixed every
functional bug it found. What is left here can't be fixed in code: it needs a business
decision, a lawyer, an account key, or a real phone.

## 1. Decisions (business)

| # | Question | Where things stand now |
|---|---|---|
| 1 | **Refund policy.** The Terms say "refunds within 48 hours on request". The app refunds automatically within 7 days, or for a billing error. Which is right? | The Terms text is unchanged; the code uses 7 days. |
| 2 | **Bail-agent plans.** The old feature lists were invented. | They are defined as new-arrest alerts for 1 county, 3 counties or all counties. Confirm. |
| 3 | **Firm plans.** There are no paid firm plans, so "Upgrade" only sends a request. | Contract Pro and Discovery Pro features can't be unlocked. Create the plans, or hide the features. |
| 4 | **Check-in billing ($9.99).** | It is shown as "billing not active" because no Stripe product exists. Decide the price when Stripe is set up. |
| 5 | **Check-in enrollment** links a defendant by an e-mail or phone that nobody has verified. | Add an e-mail or text verification code (recommended). |
| 6 | **Video consults** require Legal Pro even after a paid booking. | Keep it, or let a paid booking include video? |
| 7 | **Terms effective date:** May 25, 2026 on the Terms screen, May 1, 2026 in the accept pop-up. | Pick one. |
| 8 | **Privacy Policy badges** ("✓ GDPR ✓ CCPA ✓ Apple ✓ Google Play") have nothing behind them. | Keep or remove. |
| 9 | **Insurance tile.** Its screen now says there is no insurance product. | Remove the tile, or add a real partner. |
| 10 | **Push notifications** reach one device per user. | Fine for launch; multi-device push is a later feature. |
| 11 | **Eight languages (Oct 27 2026).** Haitian Creole, Chinese, Arabic and Tagalog were translated by Claude. | Shipped, labelled in docs/TRANSLATIONS.md as needing a native-speaker legal translator's review before launch. Hire reviewers, or hide those four languages until reviewed. |
| 12 | **Text length in Haitian Creole and Tagalog.** They are mostly plain GSM-7 but longer than English. | Default chosen: up to 3 GSM-7 segments (459 characters) in any language other than English; English stays at 2; Unicode languages keep the 6-segment limit. |
| 13 | **Stripe Checkout language.** Stripe has Chinese and Filipino pages but no Haitian Creole or Arabic. | Haitian Creole and Arabic payers see Stripe's English page (our pages around it are in their language). |
| 14 | **Arabic / Chinese letters in PDFs.** The bundled Inter font has neither, and no font with them is in node_modules. | Default chosen: such text prints as Unicode code points ("[U+738B …]") with a note; the certificate stays English. To print the letters, add Noto Sans Arabic + Noto Sans SC to backend/assets/fonts and a right-to-left shaping step (needs a decision on a new dependency). |

## 2. Lawyer review (legal content: shown, labelled "not reviewed by a lawyer", never invented)

- **Recording consent:** the Illinois note cites "People v. ACLU of Ill." (it probably means *ACLU v. Alvarez*). The all-party-consent list and the "one-party everywhere else" default need review.
- **Expungement:** 306 rules. 147 name a statute and give a verdict. 155 name none and give no verdict. 4 contradict their own notes (CT, TX, NV, AZ). The per-rule list is in `docs/fix-notes/expungement_rules_review.txt`.
- **Contradictions:**
  - The ICE screen says you get a lawyer "even if you cannot afford one", but immigration court appoints no free lawyer.
  - Housing says self-help eviction is illegal "in every state"; Tenant rights says "most states".
  - Louisiana's juvenile row contradicts itself.
- **Possibly wrong:**
  - Pakistan is marked as not part of the Hague Convention.
  - The Hague "6 weeks under Article 11" step.
  - A Broward veterans court is linked to the Tampa VA hospital.
- **No source at all:**
  - the 5 ICE help-line numbers;
  - 51 juvenile sealing rows;
  - 30 specialty courts;
  - the Family court, Housing, Tenant and Immigration cards;
  - lessons;
  - some drug and DUI rows;
  - push-notification tips;
  - the deadline calculator's state tables;
  - courthouse rows;
  - court-form links;
  - the bail schedule (vague source labels);
  - matter-intelligence signals.
- **Child support:** no state formula has a source, so the calculator shows "unavailable" for all 51 states until sourced guidelines are added.
- **Home "Legal tip" rotation:** tips such as "A DUI checkpoint must be publicly announced in advance in most US states" have no source (some states don't allow checkpoints at all). Review every tip.
- **Bar prep:** the answer keys lean heavily towards "B".
- **Translations to do after the review:** expungement notes and other database legal text are shown in English (labelled) in es/pt/vi. Translate them once the English is approved.

## 3. Keys and accounts (each feature is off, with a clear message, until its key is set)

Stripe (all payments), Resend (e-mail, password reset), Telnyx (SMS reminders and SOS texts; 10DLC registration), Daily.co
(video), Expo and web-push keys (notifications), plus the Render secrets in
`DEPLOY_ENV_SETUP.md`. Keep the existing `ENCRYPTION_KEY` and JWT secrets.

## 4. Real-device testing

Camera, microphone, recording, the document scanner, the native payment sheet, push
delivery and the iOS multi-recipient SMS link were checked in code only. They need a run on
a real iPhone and Android phone (see [REAL_DEVICE_TEST_SCRIPT.md](./REAL_DEVICE_TEST_SCRIPT.md)).
