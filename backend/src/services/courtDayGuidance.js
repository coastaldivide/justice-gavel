/**
 * services/courtDayGuidance.js — "What to bring / what to wear" and "I missed
 * my court date — what now?". Generic, and only text that already exists in
 * the app (court-reminder copy, the in-app FAQ, the bail-hearing lesson, the
 * bail calculator) or an official source (what to wear: the Tennessee
 * Department of Human Services' "What to Expect in Court"; the full guide is
 * the app's "Going to court: how to dress and act", docs/COURT_GUIDE.md),
 * each line labelled with where it comes from. No deadlines, no state rules. Missed-date guidance always ends with
 * "Call your lawyer or the court clerk." Not yet reviewed by a lawyer.
 *
 * Text lives in i18n/messages/<lang>.js (guidance.*); courtDayGuidance(lang)
 * returns it in any of the app's eight languages (English for anything else), with the same
 * structure in every language.
 */
import { msg, normalizeLang } from '../i18n/index.js';

const SRC = { reminder: 'guidance.src.reminder', lesson: 'guidance.src.bail_lesson', faq: 'guidance.src.faq', calc: 'guidance.src.bail_calc', tn_dhs: 'guidance.src.tn_dhs' };
/** Official page behind the wear line (also listed in the app's guide sources). */
export const WEAR_SOURCE_URL = 'https://www.tn.gov/content/dam/tn/human-services/documents/Child%20Support%20What%20to%20Expect%20in%20Court.pdf';

function build(lang) {
  const l = normalizeLang(lang) || 'en';
  const t = (k) => msg(l, k);
  const checklist = Object.freeze({
    title: t('guidance.checklist.title'),
    bring: [
      { id: 'bring_1', text: t('guidance.bring.1'), source: t(SRC.reminder) },
      { id: 'bring_2', text: t('guidance.bring.2'), source: t(SRC.reminder) },
      { id: 'bring_3', text: t('guidance.bring.3'), source: t(SRC.lesson) },
    ],
    wear: [
      { id: 'wear_1', text: t('guidance.wear.1'), source: t(SRC.tn_dhs), source_url: WEAR_SOURCE_URL, guide: 'court_guide' },
    ],
    last_reviewed: null,
    lawyer_reviewed: false,
    note: t('guidance.checklist.note'),
    language: l,
  });
  const missed = Object.freeze({
    title: t('guidance.missed.title'),
    steps: [
      { id: 'missed_1', text: t('guidance.missed.1'), source: `${t(SRC.reminder)}; ${t(SRC.faq)}` },
      { id: 'missed_2', text: t('guidance.missed.2'), source: t(SRC.faq) },
      { id: 'missed_3', text: t('guidance.missed.3'), source: t(SRC.calc) },
      { id: 'missed_4', text: t('guidance.missed.4'), source: t(SRC.reminder) },
    ],
    last_reviewed: null,
    lawyer_reviewed: false,
    note: t('guidance.missed.note'),
    language: l,
  });
  return { checklist, missed, language: l };
}

const CACHE = new Map();
/** { checklist, missed, language } in `lang`. */
export function courtDayGuidance(lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  if (!CACHE.has(l)) CACHE.set(l, build(l));
  return CACHE.get(l);
}

export const CALL_LAWYER_OR_CLERK = msg('en', 'guidance.missed.4');
export const COURT_DAY_CHECKLIST = courtDayGuidance('en').checklist;
export const MISSED_COURT_GUIDANCE = courtDayGuidance('en').missed;
