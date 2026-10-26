# Real-device test script

Everything here uses native modules that the automated web journeys can't reach. Run it on
**one iPhone and one Android phone**, using an EAS development or preview build pointed at
**staging** (`EXPO_PUBLIC_API_BASE`), with the staging keys from the handoff (§6) set.
Run each step in English, then repeat the starred (★) steps in Spanish or Vietnamese.

Record the result for every step: pass, or fail with a screenshot or screen recording, the
device model and the OS version. A step passes only if what's described happens with no
crash, freeze or English text in another language.

## A. First launch and account
1. ★ Fresh install → age check (year field shows "e.g. 1990" in full) → onboarding → Home.
2. Deny every permission when asked (location, notifications, camera, microphone): the app
   keeps working and each feature explains what it needs.
3. Register a consumer account → Terms gate → Home. Kill the app → reopen: still signed in
   (`expo-secure-store`).
4. Settings → App lock on → background the app for more than 60 s → Face ID / fingerprint
   prompt (`expo-local-authentication`). Cancel → the app stays locked. Succeed → back where
   you were.
5. Sign out → no previous user's name, contacts, cases or court dates are left anywhere.

## B. "Just arrested?" core path
6. ★ Home → Just arrested? → Rights card for your state. Turn on airplane mode → reopen
   the Rights card: it still shows.
7. Help Now with location allowed: nearest lawyers and bail agents; **Call** opens the dialer
   with the number; **Text** opens Messages; **Directions** opens Maps.
8. Help Now with location denied: asks for a city; typing "Dallas, TX" shows results there.
9. Add a court date (with a courthouse) → open it → **Add to calendar** (.ics file through the
   share sheet): the phone's calendar imports it on the right day and time. Also check
   Deadline calculator → add to calendar (`expo-calendar`, asks for calendar permission).
10. Reminders: create a court date 2 days out → push notifications arrive at the expected
    local times (`expo-notifications`). Tapping one opens that court date.

## C. Safety features
11. SOS: tap SOS → confirm → each emergency contact gets a text (Twilio on staging). Then
    remove the Twilio keys: the app says the text didn't go out and opens Messages pre-filled
    for all contacts (on iOS, check the multi-recipient link).
12. Call 911 / Crisis 988 buttons open the dialer with the right number. The Veterans line
    dials 988 and the screen says to press 1; the Crisis Text Line opens Messages to 741741.
13. Interrogation recorder in a one-party-consent state (e.g. Texas): records and saves. In
    an all-party state (e.g. California): asks for consent first, then records. Deny the
    microphone → a clear message, no crash (`expo-audio`).
14. Voice note on a case → saved, and **appended** to the existing case notes (not replacing them).

## D. Documents and media
15. Document scanner (`expo-camera`) → photo of a paper → attached to a case → opens again.
16. Upload a PDF from Files (`expo-document-picker`) and a photo (`expo-image-picker`) to a
    case → both download again for the owner only.
17. Legal research → export / print a result (`expo-print`, `expo-sharing`) → the share sheet
    opens with a readable PDF.

## E. Pros and payments (staging Stripe test keys)
18. Attorney account → the dashboard opens after the Terms gate; the inbox shows client messages.
19. Bail-agent account → the lead dashboard; buy a test lead with the Stripe payment sheet
    (`@stripe/stripe-react-native`, card 4242 4242 4242 4242) → contact details appear only
    after payment.
20. Consumer → subscribe to Legal Pro with a test card → features unlock. Cancel → they lock
    at the end of the period.
21. Remove the Stripe keys on staging → every payment screen says "Payments aren't available
    yet", with no crash.

## F. Device behavior
22. Rotate, then use the largest system font size: no clipped buttons or text on Home,
    Help Now, the Rights card or Court dates.
23. Turn on VoiceOver (iOS) / TalkBack (Android): Home → Just arrested → Rights card →
    Help Now → Call can be done by voice alone, and icons aren't read out as junk.
24. Dark and light system themes: everything readable in both.
25. Poor network (Settings → developer → network link conditioner, or a weak signal): friendly
    errors with **Try again**; nothing hangs forever; offline cases sync when back online,
    exactly once.

When every step passes on both phones, tick "real-device testing" in
`docs/OWNER_DECISIONS.md` §4.
