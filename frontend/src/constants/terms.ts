/**
 * terms.ts — the one place the Terms of Service version and effective date live.
 *
 * Before the October 2026 legal accuracy review the Terms screen said May 25, 2026
 * and the acceptance pop-up said May 1, 2026. Both now read this file.
 *
 * TOS_VERSION must equal CURRENT_TOS_VERSION in backend/src/routes/auth.js (a bump
 * makes every user accept the Terms again). OWNER: set TOS_EFFECTIVE_ISO to the day
 * this version is published, and bump both versions together.
 */
import { locale } from '../i18n';

export const TOS_VERSION = '2.2';
export const TOS_EFFECTIVE_ISO = '2026-10-26';

/** The effective date in the reader's language, e.g. "26 de octubre de 2026". */
export const tosEffectiveDate = (): string =>
  new Date(`${TOS_EFFECTIVE_ISO}T12:00:00Z`).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
