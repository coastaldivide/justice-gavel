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
  immigrationHelp:      { name: 'National Immigration Legal Svcs',   number: '1-800-354-0365', sms: null,        verified: '2026-01' },
  // Substance Abuse
  substanceAbuse:       { name: 'SAMHSA National Helpline',          number: '1-800-662-4357', sms: null,        verified: '2026-01' },
  // Legal Aid
  legalAidFinder:       { name: 'LawHelp.org',                       url: 'https://lawhelp.org', verified: '2026-01' },
  // Eating Disorders (National Alliance, NOT NEDA which is disconnected)
  eatingDisorders:      { name: 'National Alliance for ED',          number: '1-866-662-1235', verified: '2026-01' },
};

export function getEmergencyLine(category: keyof typeof CRISIS_RESOURCES) {
  return CRISIS_RESOURCES[category] ?? CRISIS_RESOURCES.crisisText;
}
