/**
 * data/court_rules.js — dress and conduct rules a court publishes itself, for "Going to court:
 * how to dress and act" (docs/COURT_GUIDE.md).
 *
 * A court is listed ONLY when we read its rules on the court's own official page. A court date
 * whose courthouse is in a listed county shows "This court's posted rules" with the link, what the
 * page covers and the date we checked it; every other court date shows the general guide only.
 * The rules themselves are not copied here (they change and are in English): the person opens the
 * court's page. `covers` names what the page covers (dress / security / phones / food / conduct),
 * shown in the person's language.
 *
 * Tennessee first. Checked and left out:
 *   - Shelby County: no criminal or General Sessions court page with posted dress or conduct rules
 *     was found (only the Probate Court's dress code and the District Attorney's witness FAQ).
 *   - Hamilton County: the posted guidelines found are for General Sessions CIVIL court only.
 * Re-check yearly; remove a row rather than keep a broken link.
 */
import { isWithheld, checkedOn } from '../ai/sourceOverlay.js';

export const COURT_RULES_CHECKED = '2026-11-01';

export const COURT_RULES = Object.freeze([
  {
    id: 'tn-davidson-general-sessions-dress', state: 'TN', county: 'Davidson',
    court: 'General Sessions Court of Metropolitan Nashville & Davidson County',
    title: 'Dress Code', covers: ['dress'],
    url: 'https://gscourt.nashville.gov/coming-to-court/dress-code/', checked: COURT_RULES_CHECKED,
  },
  {
    id: 'tn-davidson-general-sessions-security', state: 'TN', county: 'Davidson',
    court: 'General Sessions Court of Metropolitan Nashville & Davidson County',
    title: 'Security', covers: ['security', 'phones', 'food'],
    url: 'https://gscourt.nashville.gov/coming-to-court/security/', checked: COURT_RULES_CHECKED,
  },
  {
    id: 'tn-davidson-trial-courts-dress', state: 'TN', county: 'Davidson',
    court: 'Trial Courts of Metropolitan Nashville & Davidson County (Criminal, Circuit and Chancery Courts)',
    title: 'Dress Code', covers: ['dress'],
    url: 'https://trialcourts.nashville.gov/general-information/dress-code/', checked: COURT_RULES_CHECKED,
  },
  {
    id: 'tn-knox-general-sessions', state: 'TN', county: 'Knox',
    court: 'General Sessions Courts of Knox County',
    title: 'Courtroom rules', covers: ['dress', 'phones', 'food', 'conduct'],
    url: 'https://www.knoxcounty.org/gsjudges/', checked: COURT_RULES_CHECKED,
  },
]);

export const COVERS = Object.freeze(['dress', 'security', 'phones', 'food', 'conduct']);

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+county$/, '').replace(/\s+/g, ' ');

/** The posted rules for a courthouse ({ state, county } or null) → [] when none are listed. */
export function courtRulesFor(ch) {
  if (!ch || !ch.state || !ch.county) return [];
  const st = String(ch.state).trim().toUpperCase();
  const co = norm(ch.county);
  // Source re-checks (ai/sourceOverlay.js): a withheld row is not shown; the date follows the latest verified check.
  return COURT_RULES.filter(r => r.state === st && norm(r.county) === co && !isWithheld('court_rules', r.id)).map(r => ({
    id: r.id, court: r.court, title: r.title, covers: [...r.covers], url: r.url, checked: checkedOn('court_rules', r.id, r.checked),
  }));
}
