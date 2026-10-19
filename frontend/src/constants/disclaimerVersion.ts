
import { t, perLang } from '../i18n';/**
 * disclaimerVersion.ts
 *
 * Increment CURRENT_DISCLAIMER_VERSION when disclaimer language changes.
 * Users who accepted an older version will be shown the new disclaimer
 * on next app launch.
 */
export const CURRENT_DISCLAIMER_VERSION = 2;
export const DISCLAIMER_DATE = '2026-01-01';

export const DISCLAIMER_TEXT = perLang(() => ({
  short: t('x_disclaimer_version_this_app_provides_ai'),
  full: t('x_disclaimer_version_justice_gavel_provides_ai'),
}));
