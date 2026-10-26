/**
 * crisisResources.ts — Verified crisis hotlines
 * Last verified: January 2026
 * Verify quarterly at: https://www.samhsa.gov/find-help/national-helpline
 */
export const CRISIS_RESOURCES = {
  // General
  suicidePrevention:    { name: 'Suicide & Crisis Lifeline',        number: '988',           sms: 'TEXT 988',   verified: '2026-01' },
  crisisText:           { name: 'Crisis Text Line',                  number: null,            sms: 'TEXT HOME to 741741', verified: '2026-01' },
  // Domestic Violence
  domesticViolence:     { name: 'National DV Hotline',               number: '1-800-799-7233', sms: 'TEXT START to 88788', verified: '2026-01' },
  // Immigration
  // Was 'National Immigration Legal Svcs 1-800-354-0365' — no such organization could be found
  // (Oct 2026 review). Replaced with the official immigration court case line (EOIR, justice.gov).
  immigrationHelp:      { name: 'Immigration Court Case Info (EOIR)', number: '1-800-898-7180', sms: null,       verified: '2026-10' },
  // Substance Abuse
  substanceAbuse:       { name: 'SAMHSA National Helpline',          number: '1-800-662-4357', sms: null,        verified: '2026-01' },
  // Legal Aid
  legalAidFinder:       { name: 'LawHelp.org',                       url: 'https://lawhelp.org', verified: '2026-01' },
  // Eating Disorders (National Alliance, NOT NEDA which is disconnected)
  // A weekday therapist-staffed helpline, not a 24/7 crisis line: in a crisis call or text 988.
  eatingDisorders:      { name: 'National Alliance for ED',          number: '1-866-662-1235', verified: '2026-01' },
};

export function getEmergencyLine(category: keyof typeof CRISIS_RESOURCES) {
  return CRISIS_RESOURCES[category] ?? CRISIS_RESOURCES.crisisText;
}
