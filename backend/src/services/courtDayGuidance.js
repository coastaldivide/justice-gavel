/**
 * services/courtDayGuidance.js — "What to bring / what to wear" and "I missed
 * my court date — what now?". Generic, and only text that already exists in
 * the app (court-reminder copy, the in-app FAQ, the bail-hearing lesson, the
 * bail calculator), each line labelled with where it comes from. No
 * deadlines, no state rules. Missed-date guidance always ends with
 * "Call your lawyer or the court clerk." Not yet reviewed by a lawyer.
 */

const REMINDER_COPY = 'Justice Gavel court-reminder guidance';
const BAIL_LESSON = 'Justice Gavel lesson: "How to Prepare for Your Bail Hearing"';
const FAQ = 'Justice Gavel in-app FAQ: "court date / missed hearing"';
const BAIL_CALC = 'Justice Gavel bail calculator: "How bail bondsmen work"';

export const CALL_LAWYER_OR_CLERK = 'Call your lawyer or the court clerk.';

export const COURT_DAY_CHECKLIST = Object.freeze({
  title: 'Court day checklist',
  bring: [
    { text: 'Arrive early.', source: REMINDER_COPY },
    { text: 'Bring all your court paperwork and documents.', source: REMINDER_COPY },
    { text: 'For a bail hearing, things that can help: an employment letter or pay stubs, a lease or mortgage showing stable housing, and family members present in court.', source: BAIL_LESSON },
  ],
  wear: [
    { text: 'Business casual minimum. No orange. Clean and conservative.', source: BAIL_LESSON },
  ],
  last_reviewed: null,
  lawyer_reviewed: false,
  note: 'General information only — your lawyer or the court can tell you exactly what your hearing needs.',
});

export const MISSED_COURT_GUIDANCE = Object.freeze({
  title: 'I missed my court date — what now?',
  steps: [
    { text: 'Missing court can lead to a bench warrant, and often the loss of any bail that was paid.', source: `${REMINDER_COPY}; ${FAQ}` },
    { text: 'Do not just stay away — a bench warrant stays active until it is dealt with.', source: FAQ },
    { text: 'If a bail agent posted your bond, tell them — when you miss court, the bondsman is responsible for the full bail amount.', source: BAIL_CALC },
    { text: CALL_LAWYER_OR_CLERK, source: REMINDER_COPY },
  ],
  last_reviewed: null,
  lawyer_reviewed: false,
  note: 'General information only — not legal advice.',
});

export function courtDayGuidance() {
  return { checklist: COURT_DAY_CHECKLIST, missed: MISSED_COURT_GUIDANCE };
}
