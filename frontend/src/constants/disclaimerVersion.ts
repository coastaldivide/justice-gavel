/**
 * disclaimerVersion.ts
 *
 * Increment CURRENT_DISCLAIMER_VERSION when disclaimer language changes.
 * Users who accepted an older version will be shown the new disclaimer
 * on next app launch.
 */
export const CURRENT_DISCLAIMER_VERSION = 2;
export const DISCLAIMER_DATE = '2026-01-01';

export const DISCLAIMER_TEXT = {
  short: 'This app provides AI-generated legal information, not legal advice.',
  full: `Justice Gavel provides AI-generated legal information for educational purposes only.

Nothing in this app constitutes legal advice, creates an attorney-client relationship, or should be relied upon as a substitute for advice from a licensed attorney.

Laws vary by state and change frequently. AI-generated content may be incomplete, inaccurate, or outdated. Always verify information with a licensed attorney before making legal decisions.

In an emergency, call 911. For domestic violence crisis: 1-800-799-7233. For mental health crisis: 988.

By using this app you acknowledge you have read and understood this disclaimer.`,
};
