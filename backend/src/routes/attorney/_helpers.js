/**
 * attorney/_helpers.js — Shared utilities for the attorney platform
 */
import { getDb }        from '../../db/index.js';
import { err401 }       from '../../utils/routeHelpers.js';

// ── Profile field sanitiser — strip HTML tags and control characters ───────────
// Prevents stored XSS if profile data is ever rendered in a WebView context.
// We strip rather than encode because our app renders in React Native Text
// components (not HTML), so angle brackets are display artefacts not markup.
export function sanitiseField(value, maxLen = 500) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')          // strip HTML tags
    .replace(/[^\P{Cc}\t\n\r]/gu, '') // strip control chars (keeps tab / newline / CR)
    .trim()
    .slice(0, maxLen);
}

export function sanitiseProfileFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const safe = {};
  for (const [k, v] of Object.entries(obj)) {
    safe[k] = typeof v === 'string' ? sanitiseField(v) : v;
  }
  return safe;
}


// ── Access helpers ───────────────────────────────────────────────────────────
// Both return { db, user } when allowed. When NOT allowed they send the 401/403
// response themselves and return null — callers must `if (!ctx) return;`.
const ATTORNEY_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);

async function loadUser(db, id) {
  return await db.get(
    `SELECT id, display_name, email, role, bar_number, bar_state, bar_verified, jtb_verified,
            is_admin, is_defender, office_id
       FROM users WHERE id = ?`, [id]);
}

export async function requireDefender(req, res) {
  const db   = await getDb();
  const user = await loadUser(db, req.user.id);
  if (!user) { err401(res, 'Not found'); return null; }
  if (ATTORNEY_ROLES.has(user.role) || Number(user.is_defender) === 1) return { db, user };
  // Attorney subscription also grants access
  const sub = await db.get(
    `SELECT tier FROM subscriptions WHERE user_id=? AND provider_type='lawyer'
     AND status IN ('active','trialing') LIMIT 1`, [req.user.id]
  );
  if (!sub) {
    res.status(403).json({ error: 'Attorney account required' });
    return null;
  }
  return { db, user };
}

export async function requireAttorney(req, res) {
  const db   = await getDb();
  const user = await loadUser(db, req.user.id);
  if (!user) { err401(res, 'Not found'); return null; }
  if (!ATTORNEY_ROLES.has(user.role) && Number(user.is_defender) !== 1) {
    res.status(403).json({ error: 'Attorney access required' });
    return null;
  }
  return { db, user };
}

// ── CASES ─────────────────────────────────────────────────────────────────────

export const STATE_BAR_LOOKUP = {
  AL: 'https://www.alabar.org/for-the-public/find-a-lawyer/',
  AK: 'https://www.alaskabar.org/for-the-public/find-an-attorney/',
  AZ: 'https://www.azbar.org/for-the-public/attorney-search/',
  AR: 'https://www.arkbar.com/for-the-public/find-a-lawyer',
  CA: 'https://apps.calbar.ca.gov/attorney/Licensee/Detail/',
  CO: 'https://www.cobar.org/For-the-Public/Find-A-Lawyer',
  CT: 'https://www.ctbar.org/public/find-a-lawyer',
  DE: 'https://www.dsba.org/for-the-public/find-an-attorney/',
  DC: 'https://www.dcbar.org/for-the-public/find-a-member/',
  FL: 'https://www.floridabar.org/directories/find-mbr/',
  GA: 'https://www.gabar.org/for-the-public/find-a-lawyer.cfm',
  HI: 'https://www.hawaiilawyerreferral.com/',
  ID: 'https://isb.idaho.gov/member-search/',
  IL: 'https://www.illinoislawyerfinder.com/',
  IN: 'https://www.inbar.org/findlawyer/',
  IA: 'https://www.iowabar.org/find-an-attorney/',
  KS: 'https://www.ksbar.org/find-a-lawyer',
  KY: 'https://www.kybar.org/find-a-lawyer/',
  LA: 'https://www.lsba.org/public/find-a-lawyer.aspx',
  ME: 'https://www.mainebar.org/page/findalawyer',
  MD: 'https://www.msba.org/for-the-public/find-a-lawyer/',
  MA: 'https://www.massbbo.org/licensed-attorneys/',
  MI: 'https://www.michbar.org/member/attorney_search',
  MN: 'https://lprb.mncourts.gov/attorney-directory/',
  MS: 'https://www.msbar.org/for-the-public/find-a-lawyer/',
  MO: 'https://www.mobar.org/find-a-lawyer/',
  MT: 'https://montanabar.org/findlawyer/',
  NE: 'https://www.nebar.com/find-a-lawyer/',
  NV: 'https://www.nvbar.org/find-a-lawyer/',
  NH: 'https://www.nhbar.org/find-a-lawyer/',
  NJ: 'https://www.njlawpublichub.com/attorney-search/',
  NM: 'https://www.nmbar.org/for-the-public/find-an-attorney/',
  NY: 'https://iapps.courts.state.ny.us/attorneyservices/search',
  NC: 'https://www.ncbar.gov/member-services/attorney-search/',
  ND: 'https://www.sband.org/find-a-lawyer/',
  OH: 'https://www.supremecourt.ohio.gov/attorney-services/attorney-status/',
  OK: 'https://www.okbar.org/find-a-lawyer/',
  OR: 'https://www.osbar.org/public/ris/memberDirectory.html',
  PA: 'https://www.padisciplinaryboard.org/for-the-public/find-attorney/',
  RI: 'https://www.ribar.com/public-resources/find-a-lawyer/',
  SC: 'https://www.scbar.org/find-a-lawyer/',
  SD: 'https://statebarofsouthdakota.com/find-a-lawyer/',
  TN: 'https://www.tba.org/member-services/find-an-attorney/',
  TX: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer',
  UT: 'https://www.utahbar.org/public-information/attorney-search/',
  VT: 'https://www.vtbar.org/public/find-a-lawyer/',
  VA: 'https://www.vsb.org/site/publications/member_search',
  WA: 'https://www.mywsba.org/PersonifyEbusiness/WSBAOnline/SearchLawyersAndParalegals.aspx',
  WV: 'https://wvbar.org/for-the-public/find-a-lawyer/',
  WI: 'https://www.wisbar.org/forPublic/Pages/find-a-lawyer.aspx',
  WY: 'https://www.wyomingbar.org/for-the-public/hire-a-lawyer/',
};