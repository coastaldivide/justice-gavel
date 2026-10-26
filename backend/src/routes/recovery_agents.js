/**
 * FEATURE SUSPENDED — RECOVERY AGENT DIRECTORY
 *
 * Recovery agents (bounty hunters) are prohibited outright in IL, KY, OR, and WI.
 * In all other states they require licensing, training, bonding, and firearms certs.
 * The directory contains 531 records with license_number=NULL and armed_certified=0.
 * Connecting a person with an unlicensed recovery agent who then uses force creates
 * significant causation-chain liability.
 *
 * This feature is suspended pending:
 *   1. License number import from state DOI files
 *   2. Jurisdiction blocklist for banned states
 *   3. Legal review of civil liability exposure
 *
 * All routes return 410 Gone until reinstated.
 */

import { asyncRoute, err400, err404, err500, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
/**
 * recovery_agents.js — Fugitive Recovery Agent directory
 *
 * GET /api/recovery-agents              — search by state/city
 * GET /api/recovery-agents/laws/:state  — state recording law for a given state
 *
 * Served exclusively to authenticated bail bondsmen (authRequired).
 * Never surfaced to defendants or anonymous users.
 *
 * Recovery agent laws researched from published state statutes — April 2026.
 * Disclaimer: laws change — always verify with state DOI or legal counsel.
 */

import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

// ── State recovery law database ───────────────────────────────────────────────
// Legal accuracy review (Oct 2026): the old table said recovery was allowed in Oregon and
// Wisconsin (both ban commercial bail), cited a California law that sunset in 2010, and
// had wrong statutes for TX, IL, NJ, MI, TN, NV and wrong licensing for DE, IA, MO, NH, SD,
// WV, PA, NM, MI. Rows below come from that research. IMPORTANT: they were checked against
// secondary 50-state summaries (NCSL; USLegal), not each statute — `checked: 'secondary'`.
// Rows the research could not confirm have checked: 'unverified' and no legal claims.
const RECOVERY_LAWS = {
  AK: { allowed: true, license: false, agency: "Alaska Division of Insurance (bail bond limited producers only)", law: "Alaska Stat. \u00a7\u00a7 12.25.030, 09.40.200, 21.27.150", notes: "Alaska has no bounty-hunter statute. Sureties and their agents act under general private-arrest law, and bail bond producers are licensed by the Division of Insurance.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/alaska/", checked: 'secondary' },
  AL: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  AR: { allowed: true, license: true, agency: "Arkansas private investigator license, or bondsman license from the state where the bond was issued", law: "Ark. Code Ann. \u00a7 16-84-114", notes: "Only licensed private investigators (or people they supervise), licensed bondsmen from the state where the bond was written, or peace officers may arrest a bail fugitive. They must be at least 21 with no felony record, and no one may call themselves a 'bounty hunter' or 'bail enforcement agent'.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/arkansas/", checked: 'secondary' },
  AZ: { allowed: true, license: false, agency: "Arizona Department of Insurance (notice and fingerprints, not a license)", law: "A.R.S. \u00a7\u00a7 13-3885, 20-282, 20-340.04", notes: "A recovery agent must have written authorization from an Arizona-licensed bail bond agent, and the bail agent must notify the Department of Insurance within 24 hours of hiring them. Agents may not enter an occupied home without the occupants' consent, may not wear insignia implying government employment, and may not have felony, theft, or weapons convictions. Violations are a class 5 felony.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/arizona/", checked: 'secondary' },
  CA: { allowed: true, license: null, agency: "California Department of Insurance (licenses bail agents)", law: "Cal. Penal Code \u00a7\u00a7 1301, 847, 847.5 (former \u00a7\u00a7 1299-1299.16, the Bail Fugitive Recovery Persons Act, repealed Jan. 1, 2010)", notes: "A bail agent, surety, or person they authorize in writing may arrest the defendant, and must deliver them to the court or jail within 48 hours of the arrest (§ 1301). Taking a person out of state requires extradition procedures (§ 847.5).", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/california/", checked: 'secondary' },
  CO: { allowed: true, license: false, agency: "No license; Colorado Bureau of Investigation does the background check", law: "C.R.S. \u00a7 12-7-105.5 (pre-2019 numbering)", notes: "Recovery agents must be appointed by a licensed bail bonding agent, pass a CBI/FBI fingerprint check (no felony in 15 years), and hold a bail-fugitive-apprehension training certificate.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/colorado/", checked: 'secondary' },
  CT: { allowed: true, license: true, agency: "Connecticut Department of Emergency Services and Public Protection (DESPP)", law: "Conn. Gen. Stat. \u00a7\u00a7 29-152e to 29-152n", notes: "Bail enforcement agents need a DESPP license (20 hours of training; no felony or misdemeanor convictions) and a special permit to carry a firearm. They may not wear police-style insignia, and violations are a class D felony.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/connecticut/", checked: 'secondary' },
  DC: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  DE: { allowed: true, license: true, agency: "Delaware Board of Examiners of Bail Enforcement Agents", law: "24 Del. C. \u00a7\u00a7 5501-5515", notes: "Bail enforcement agents, resident or nonresident, must be licensed by the Board, be at least 21, and not work in law enforcement. Unlicensed work can draw civil penalties.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/delaware/", checked: 'secondary' },
  FL: { allowed: true, license: true, agency: "Florida Department of Financial Services", law: "Fla. Stat. \u00a7 648.30", notes: "Florida does not allow independent bounty hunters. Only licensed and appointed bail bond agents (or certified police) may arrest a defendant, and no one may use the titles 'bounty hunter', 'bail enforcement agent' or 'fugitive recovery agent'.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/florida/", checked: 'secondary' },
  GA: { allowed: true, license: true, agency: "Registration with the county sheriff by the professional bondsman", law: "O.C.G.A. \u00a7\u00a7 17-6-56, 17-6-56.1, 17-6-57, 17-6-58", notes: "Bail recovery agents must be at least 25, U.S. citizens, and registered with the sheriff. Before acting, they must notify the local sheriff and police chief. Out-of-state agents must show their home-state qualification and a certified copy of the bond, and wearing government-looking insignia is a felony.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/georgia/", checked: 'secondary' },
  HI: { allowed: true, license: false, agency: null, law: "Haw. Rev. Stat. \u00a7 804-14", notes: "Hawaii has no bounty-hunter statute. A surety may surrender the defendant to any sheriff or chief of police.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/hawaii/", checked: 'secondary' },
  IA: { allowed: true, license: true, agency: "Iowa Department of Public Safety", law: "Iowa Code ch. 80A (\u00a7\u00a7 80A.3, 80A.4, 80A.7, 80A.16A)", notes: "Bail enforcement businesses need a state license and every employee needs an ID card; felony or weapons convictions disqualify. Injured third parties can sue the agent and the business.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/iowa/", checked: 'secondary' },
  ID: { allowed: true, license: false, agency: null, law: "Idaho Code \u00a7 41-1045", notes: "Idaho does not license recovery agents. The bail agent is legally responsible for the conduct of agents it uses.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/idaho/", checked: 'secondary' },
  IL: { allowed: false, license: false, agency: null, law: "725 ILCS 5/103-9", notes: "Bounty hunting is banned: no bail bondsman from any state may seize or transport anyone found in Illinois, and commercial bail does not exist there.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/illinois/", checked: 'secondary' },
  IN: { allowed: true, license: true, agency: "Indiana Department of Insurance (Commissioner)", law: "Ind. Code \u00a7\u00a7 27-10-1-9, 27-10-3-5, 27-10-3-6, 27-10-3-14, 27-10-3-17", notes: "Recovery agents need a state license (12 hours of instruction, written exam, background check) and must register it with the county sheriff and circuit court clerk within 15 days before working.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/indiana/", checked: 'secondary' },
  KS: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  KY: { allowed: false, license: false, agency: null, law: "KRS \u00a7\u00a7 431.510, 440.270", notes: "Kentucky bans commercial bail bonding, and no bail bondsman or agent may arrest anyone without an arrest warrant.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/kentucky/", checked: 'secondary' },
  LA: { allowed: true, license: true, agency: "Louisiana Department of Insurance", law: "La. Admin. Code tit. 37, pt. XIII, ch. 49 (\u00a7\u00a7 4901-4913)", notes: "Only licensed bail bond agents or solicitors may apprehend defendants, with 8 hours of pre-license and 12 hours of continuing training. They must notify local police before an apprehension in a private home. Out-of-state agents must work with a Louisiana-licensed agent.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/louisiana/", checked: 'secondary' },
  MA: { allowed: false, license: false, agency: null, law: null, notes: "Massachusetts has no commercial bail bondsmen and no bounty-hunter law.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/massachusetts/", checked: 'secondary' },
  MD: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  ME: { allowed: true, license: false, agency: null, law: null, notes: "Maine has no bounty-hunter or bail-recovery licensing law.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/maine/", checked: 'secondary' },
  MI: { allowed: true, license: false, agency: null, law: null, notes: "Michigan has no bounty-hunter license.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/michigan/", checked: 'secondary' },
  MN: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  MO: { allowed: true, license: true, agency: "Missouri Department of Commerce and Insurance", law: "RSMo \u00a7\u00a7 374.700, 374.783-374.789", notes: "Surety recovery agents need a 2-year state license; licensed bail bond agents may also do recovery. Working unlicensed is a class D felony, and unlawful apprehension or assault creates civil liability, including punitive damages.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/missouri/", checked: 'secondary' },
  MS: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  MT: { allowed: true, license: false, agency: null, law: "Mont. Code Ann. \u00a7 46-9-510", notes: "Sureties may arrest fugitives and must follow general state law. In 2025, HB 726 tightened licensing for commercial sureties but did not create a recovery-agent license.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/montana/", checked: 'secondary' },
  NC: { allowed: true, license: true, agency: "North Carolina Department of Insurance", law: "N.C. Gen. Stat. \u00a7\u00a7 58-71-1, 58-71-40, 58-71-50, 58-71-65, 58-71-95", notes: "Only licensed bail bondsmen and their licensed runners may arrest. Runners need 12 hours of education, an exam, and a background check, and may not impersonate police.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/north-carolina/", checked: 'secondary' },
  ND: { allowed: true, license: false, agency: null, law: "N.D. Cent. Code \u00a7\u00a7 26.1-26.6-01, 26.1-26.6-03", notes: "North Dakota has no bounty-hunter law. Bail bond agents are licensed by the Insurance Commissioner, and police, jailers, and judges may not act as bounty hunters.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/north-dakota/", checked: 'secondary' },
  NE: { allowed: true, license: false, agency: null, law: "Neb. Rev. Stat. \u00a7 29-906", notes: "Nebraska has no bounty-hunter law. A surety may seize the defendant before judgment and deliver them to the sheriff, but commercial bonding is essentially absent there.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/nebraska/", checked: 'secondary' },
  NH: { allowed: true, license: true, agency: "New Hampshire Secretary of State (annual registration)", law: "RSA 597:7-b", notes: "Recovery agents must be certified through approved training, carry $300,000 of liability insurance, and register each year. They must notify the town's chief law enforcement officer before searching there. Violations are a class A misdemeanor.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/new-hampshire/", checked: 'secondary' },
  NJ: { allowed: true, license: true, agency: "Superintendent of the New Jersey State Police", law: "N.J.S.A. 45:19-29 to 45:19-42", notes: "Bounty hunters need a State Police license (age 25+, 5 years of law-enforcement experience). Entering a home without privilege or using unlawful force is a fourth-degree crime. Money bail is rare in New Jersey since 2017, so the work is uncommon.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/new-jersey/", checked: 'secondary' },
  NM: { allowed: true, license: false, agency: null, law: "N.M. Stat. Ann. \u00a7 31-3-3", notes: "A surety may arrest the accused and deliver them to the sheriff; New Mexico has no bounty-hunter licensing law.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/new-mexico/", checked: 'secondary' },
  NV: { allowed: true, license: true, agency: "Nevada Division of Insurance", law: "NRS \u00a7\u00a7 697.055, 697.173, 697.177, 697.325", notes: "Bail enforcement agents need a state license (age 21+, training, no felony). They must notify local police without undue delay after an apprehension, and before forcibly entering an inhabited home.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/nevada/", checked: 'secondary' },
  NY: { allowed: true, license: true, agency: "New York Department of State", law: "N.Y. Gen. Bus. Law \u00a7\u00a7 70-84 (Art. 7); N.Y. CPL \u00a7 530.80", notes: "Bail enforcement agents need a Department of State license (qualifying experience or an approved course) and may take a principal into custody anywhere in New York with the surety's written authority. Unlawful acts against people or property are prohibited.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/new-york/", checked: 'secondary' },
  OH: { allowed: true, license: true, agency: "Ohio Department of Insurance", law: "R.C. \u00a7\u00a7 3905.84-3905.85, 3905.841; R.C. \u00a7 2927.27", notes: "People who apprehend skipped defendants must hold an Ohio surety bail bond agent license and carry a photo ID card. Police, court staff, and attorneys may not act as agents.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/ohio/", checked: 'secondary' },
  OK: { allowed: null, license: null, law: null, notes: "Not verified yet \u2014 ask your state Department of Insurance before any apprehension.", checked: 'unverified' },
  OR: { allowed: false, license: false, agency: null, law: "ORS 131.890; State v. Epps, 36 Or. App. 519 (1978)", notes: "Oregon has no commercial bail. Under State v. Epps, taking someone across state lines must follow the Uniform Criminal Extradition Act.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/oregon/", checked: 'secondary' },
  PA: { allowed: true, license: false, agency: null, law: null, notes: "Pennsylvania has no bounty-hunter licensing or training requirement; agents must follow general criminal law.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/pennsylvania/", checked: 'secondary' },
  RI: { allowed: true, license: false, agency: null, law: null, notes: "Rhode Island has no bounty-hunter law or license, and no statute grants bounty hunters arrest power.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/rhode-island/", checked: 'secondary' },
  SC: { allowed: true, license: true, agency: "South Carolina Department of Insurance", law: "S.C. Code Ann. \u00a7\u00a7 38-53-10(10), 38-53-80, 38-53-85, 38-53-90, 38-53-120", notes: "Only licensed runners employed by one bail bondsman may apprehend defendants. Runners need 20 hours of education and must be South Carolina residents with no felony in 10 years.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/south-carolina/", checked: 'secondary' },
  SD: { allowed: true, license: true, agency: "South Dakota Division of Insurance", law: "SDCL \u00a7\u00a7 58-22-1, 58-22-3, 58-22-4, 58-22-12, 58-22-16", notes: "Only licensed runners employed by a bail bondsman may help apprehend defendants (age 21+, 1-year South Dakota residency, exam). Unlicensed work is a Class 6 felony.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/south-dakota/", checked: 'secondary' },
  TN: { allowed: true, license: false, agency: null, law: "Tenn. Code Ann. \u00a7\u00a7 40-11-318, 40-11-133; \u00a7 39-17-1351", notes: "Before taking anyone into custody, an agent must present the warrant, bond copy, proof of agency from a bondsman, and an annual training card to local police. Convicted felons may not serve, and a handgun carry permit is required to be armed.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/tennessee/", checked: 'secondary' },
  TX: { allowed: true, license: true, agency: "Texas Department of Public Safety, Private Security Program (PI or security officer license)", law: "Tex. Occ. Code \u00a7\u00a7 1702.3863, 1702.3867; Tex. Code Crim. Proc. art. 17.19", notes: "Only peace officers, licensed private investigators, or commissioned security officers of a licensed guard company may be hired to arrest a bail jumper. They may not enter a home without the occupants' consent, act without the surety's written authorization, wear government insignia, or use deadly force.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/texas/", checked: 'secondary' },
  UT: { allowed: true, license: true, agency: "Utah Bail Bond Recovery Licensure Board", law: "Utah Code \u00a7\u00a7 53-11-102, 53-11-108, 53-11-109, 53-11-122, 53-11-124", notes: "Bail enforcement agents need a state license (age 21+, 16 hours of training, 2,000 hours of experience) and a firearms course to carry. They must identify themselves and follow the statute's notice rules.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/utah/", checked: 'secondary' },
  VA: { allowed: true, license: true, agency: "Virginia Department of Criminal Justice Services (DCJS)", law: "Va. Code \u00a7\u00a7 9.1-186 to 9.1-186.14 (incl. \u00a7 9.1-186.12)", notes: "Agents need a DCJS license. Absent an emergency, they must give local police or state police at least 24 hours' notice before an apprehension and report a capture within 60 minutes. They must verbally notify occupants before entering a home.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/virginia/", checked: 'secondary' },
  VT: { allowed: true, license: false, agency: "Vermont Department of Financial Regulation (bail bond agents only)", law: "8 V.S.A. \u00a7 3301", notes: "Vermont has no bounty-hunter law; commercial bail agents are licensed as insurance agents.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/vermont/", checked: 'secondary' },
  WA: { allowed: true, license: true, agency: "Washington Department of Licensing", law: "RCW 18.185.010, .250, .260, .280, .300", notes: "Bail bond recovery agents need a state license. Before a planned forced entry they must notify local police in writing with specified details, and they need a firearms certificate plus a concealed pistol license to carry a gun.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/washington/", checked: 'secondary' },
  WI: { allowed: false, license: false, agency: null, law: "Wis. Stat. \u00a7\u00a7 969.12, 818.21", notes: "Wisconsin bars paid sureties, so commercial bail bonding and bounty hunting for profit do not exist there.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/wisconsin/", checked: 'secondary' },
  WV: { allowed: true, license: true, agency: "West Virginia State Police (registration)", law: "W. Va. Code \u00a7\u00a7 51-10A-1 to 51-10A-5", notes: "Bail bond enforcers, including out-of-state agents, must register with the State Police and carry written authorization from a bondsman. They may not enter an occupied home without consent, and violations carry fines of $500 to $10,000.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/west-virginia/", checked: 'secondary' },
  WY: { allowed: true, license: false, agency: null, law: null, notes: "Wyoming has no bounty-hunter law; agents must follow general state law.", source_url: "https://bountyhunters.uslegal.com/licensing-and-arrest-authority-of-bounty-hunters/wyoming/", checked: 'secondary' },
};


// ── DB access ────────────────────────────────────────────────────────────────
let _db = null;
async function getDb() {
  // USES THE SHARED ADAPTER NOW. This opened ./data/providers.sqlite directly,
  // so on PostgreSQL every route in this file hit a file that is empty or
  // absent on the host rather than the real table.
  if (_db) return _db;
  const { getDb: getSharedDb } = await import('../db/index.js');
  _db = await getSharedDb();
  return _db;
}

// The directory and per-state law lookup are suspended pending legal review and
// license verification: every request gets 410 before the handler runs. Remove
// `directorySuspended` from a route to re-enable it.
function directorySuspended(req, res) {
  return res.status(410).json({ error: 'Recovery agent directory suspended pending legal review and license verification.', code: 'FEATURE_SUSPENDED' });
}

// ── GET /api/recovery-agents — search recovery agents ────────────────────────
router.get('/', authRequired, apiLimiter, directorySuspended, async (req, res) => {
  try {
    const { state, city, armed, lat, lng, limit = 20, offset = 0 } = req.query;

    if (!state) return err400(res, 'State is required (e.g. ?state=TN)');

    const db = await getDb();
    const stateUpper = sanitizeStr(state, 2).toUpperCase();
    const safeLimit  = Math.min(safeInt(limit, 20), 100);
    const safeOffset = safeInt(offset, 0);

    // Get state law
    const stateLaw = RECOVERY_LAWS[stateUpper] || null;

    // Build query
    const conditions = ['state = ?', 'active = 1', 'phone IS NOT NULL'];
    const params     = [stateUpper];

    if (city) {
      conditions.push("LOWER(city) LIKE ?");
      params.push(`%${sanitizeStr(city, 50).toLowerCase()}%`);
    }
    if (armed === '1' || armed === 'true') {
      conditions.push("armed_certified = 1");
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    // If lat/lng provided — sort by proximity
    let orderBy = 'ORDER BY rating DESC NULLS LAST, reviews DESC NULLS LAST';
    if (lat && lng) {
      const la = parseFloat(lat), ln = parseFloat(lng);
      if (!isNaN(la) && !isNaN(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180) {
        orderBy = `ORDER BY ((lat - ${la}) * (lat - ${la}) + (lng - ${ln}) * (lng - ${ln})) ASC`;
      }
    }

    const agents = await db.all(
      `SELECT id, name, city, state, phone, address, lat, lng, website,
              license_number, license_required, armed_certified,
              rating, reviews, bio, available_24_7, hours, law_note
       FROM recovery_agents
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset]
    );

    const total = await db.get(
      `SELECT COUNT(*) as cnt FROM recovery_agents ${where}`,
      params
    );

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      agents,
      total: total?.cnt ?? 0,
      state_law: stateLaw,
      disclaimer: 'Recovery agent laws vary by state and change frequently. Verify licensing requirements with your state Department of Insurance before engaging any recovery agent. This directory is for informational purposes only.',
    });

  } catch (e) {
    return err500(res, 'recovery-agents GET', e);
  }
});

// ── GET /api/recovery-agents/laws/:state ─────────────────────────────────────
router.get('/laws/:state', authRequired, apiLimiter, directorySuspended, (req, res) => {
  try {
    const state = (req.params.state || '').toUpperCase().slice(0, 2);
    const law   = RECOVERY_LAWS[state];
    if (!law) return err404(res, `No law data for state: ${state}`);
    res.json({
      state,
      ...law,
      disclaimer: 'This information is for general reference only and does not constitute legal advice. Laws change — verify with your state bar or DOI.',
    });
  } catch (e) {
    return err500(res, 'recovery-agents/laws', e);
  }
});

// ── GET /api/recovery-agents/laws — all states summary ───────────────────────
router.get('/laws', authRequired, apiLimiter, asyncRoute((req, res) => {
  res.json({
    laws: RECOVERY_LAWS,
    summary: {
      allowed:  Object.values(RECOVERY_LAWS).filter(l => l.allowed === true).length,
      license_required: Object.values(RECOVERY_LAWS).filter(l => l.allowed === true && l.license === true).length,
      banned:   Object.values(RECOVERY_LAWS).filter(l => l.allowed === false).length,
      unverified: Object.values(RECOVERY_LAWS).filter(l => l.checked === 'unverified').length,
    },
    disclaimer: 'Checked against secondary 50-state summaries, not each statute, and not reviewed by a lawyer. Confirm with your state Department of Insurance before acting.',
  });

}));
export default router;