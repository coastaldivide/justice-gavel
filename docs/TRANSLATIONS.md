# Translations

Justice Gavel runs in eight languages. Every screen, text message, e-mail, push notification and server
error exists in each one (same keys and `{placeholders}` as English — `frontend/src/__tests__/i18nParity.test.js`,
`backend/src/__tests__/i18n_server_content.test.js`).

| Code | Language | Variety | Direction | Translated by | Review status |
|---|---|---|---|---|---|
| `en` | English | US | left to right | Source text | — |
| `es` | Spanish | Neutral US / Latin American, "usted" | left to right | Earlier project rounds (translator not recorded in the repo) | No native-speaker legal review recorded — recommended before launch |
| `pt` | Portuguese | Brazilian | left to right | Earlier project rounds (translator not recorded in the repo) | No native-speaker legal review recorded — recommended before launch |
| `vi` | Vietnamese | US diaspora | left to right | Earlier project rounds (translator not recorded in the repo) | No native-speaker legal review recorded — recommended before launch |
| `ht` | Haitian Creole | Kreyòl ayisyen as used in US Haitian communities | left to right | **Translated by Claude on 2026-10-27** | **Needs review by a native-speaker legal translator before launch** |
| `zh` | Chinese | Simplified (Mandarin, as in US courts' Simplified Chinese materials) | left to right | **Translated by Claude on 2026-10-27** | **Needs review by a native-speaker legal translator before launch** |
| `ar` | Arabic | Modern Standard Arabic, plain style | **right to left** | **Translated by Claude on 2026-10-27** | **Needs review by a native-speaker legal translator before launch** |
| `tl` | Tagalog / Filipino | Everyday Filipino; US legal terms kept in English where that is what people use, with a Tagalog gloss | left to right | **Translated by Claude on 2026-10-27** | **Needs review by a native-speaker legal translator before launch** |

Each translated file's header says: "Translated by Claude on 2026-10-27 — needs review by a native-speaker legal
translator before launch."

## Where the text lives

- App: `frontend/src/i18n/<code>.json` (6,645 keys each), state names in `frontend/src/i18n/stateNames.ts`.
- Server: `backend/src/i18n/messages/<code>.js` (1,155 keys each), state names in `backend/src/i18n/stateNames.js`
  (must match the app's table — tested).
- Specialty-court eligibility and notes (database rows 1–30): `content_translations`, migrations 26 (es / pt / vi) and
  41 (ht / zh / ar / tl). An edited English row falls back to English (source MD5 check).
- Not translated (shown in English, labelled): legal notes from the database that are still waiting for the
  lawyer review (docs/LEGAL_ACCURACY_REVIEW.md), the immigration rights endpoint (English and Spanish only), the
  court-date phone line (English and Spanish voice prompts), the Bond Desk e-signature certificate and other PDFs
  (English — the language of the court record).

## What a reviewer should check first

1. The rights card and 30-second script (`rc_*`, `rs_*`, `rights.*`) — a wrong word here changes a right.
2. Text messages (`*.sms*`): the consequence ("a warrant can be issued", "the bond can be forfeited"), the 1 / 2 / 3
   replies and the opt-out sentence with **STOP** in Latin capitals.
3. The e-signature consent (`sgn_esign_consent`, `sgn_agree_*`) and the automatic-payment consent (`bd.autopay.consent_*`).
4. Prices, deadlines and "all sales final" wording — nothing may be softened, added or dropped.
5. Terms each translator was unsure of (bail bond, indemnitor, arraignment, public defender, expungement).

## How the app handles each language

- Language choice: Settings → Language (each language in its own name), the device language at first start, or a
  link (`/missed-court/<code>`, pay pages' language chips). Signed in, the choice is saved on the account
  (`users.preferred_language`), and reminders, e-mails and texts go out in it.
- Accept-Language / `?lang=` on the API: `zh-Hans-CN` → `zh`, `fil-PH` → `tl`, `ar-EG` → `ar`, `ht-HT` → `ht`.
- Dates: Intl locales `zh-CN`, `ar-u-nu-latn` (Western digits, like the paperwork), `fil-PH`. Intl has no Haitian
  Creole, so court dates are written with Haitian day and month names ("mèkredi 30 septanm 2026",
  `htDay()`); other Haitian Creole dates and amounts use US English formatting.
- **Arabic (right to left):** the app uses React Native's `I18nManager` (`frontend/src/i18n/direction.ts`).
  On iOS and Android a saved choice of Arabic (or leaving Arabic) calls `allowRTL` + `forceRTL` and restarts
  the app once (`Updates.reloadAsync()`, `DevSettings.reload()` in development); `app.json` sets
  `extra.supportsRTL`. A language shown for one visit (pay page, a text's link) changes the words but not the
  layout. On the web, `<html dir="rtl" lang="ar">` is set at once. Core screens use start/end styles and the
  back / forward arrows mirror. E-mails in Arabic carry `dir="rtl"`.
- Text messages: English stays within 2 GSM-7 segments; Spanish, Portuguese, Vietnamese, Chinese and Arabic are
  sent as Unicode (up to 6 segments); Haitian Creole and Tagalog are usually GSM-7 and may use up to 3 segments.
- Stripe Checkout pages: Chinese and Filipino exist; Haitian Creole and Arabic payers see Stripe's English page.
- PDFs: the bundled Inter font has no Arabic or Chinese letters. Names and answers in those scripts are printed
  as Unicode code points ("[U+738B U+5C0F U+660E]") with a note that the exact text is in the bond record; the
  certificate text stays English. Adding fonts (for example Noto Sans Arabic / Noto Sans SC) and right-to-left
  shaping would be needed to print the letters themselves.
