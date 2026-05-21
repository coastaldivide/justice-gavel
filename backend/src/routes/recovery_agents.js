import logger from '../utils/logger.js';
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
import {
  err400, err404, err500, safeInt, sanitizeStr, buildWhere
} from '../utils/routeHelpers.js';

const router = express.Router();

// ── State recovery law database ───────────────────────────────────────────────
const RECOVERY_LAWS = {
  AL: { allowed: true,  license: false, notes: 'No license required. Must act under bondsman authority.' },
  AK: { allowed: true,  license: false, notes: 'No specific statute. Common law applies.' },
  AZ: { allowed: true,  license: true,  law: 'ARS §13-3885', notes: 'License required. Armed agents need firearm permit.' },
  AR: { allowed: true,  license: true,  notes: 'Must be licensed bail enforcement agent.' },
  CA: { allowed: true,  license: true,  law: 'CA PC §1299', notes: 'Must be licensed PI or bail agent. 48-hr notice to local law enforcement required before apprehension.' },
  CO: { allowed: true,  license: true,  notes: 'Must be licensed bail bondsman or work under one.' },
  CT: { allowed: true,  license: true,  notes: 'Must give written notice to local police before apprehension.' },
  DE: { allowed: true,  license: false, notes: 'No specific statute. Must act under bondsman authority.' },
  FL: { allowed: true,  license: true,  law: 'FS §648.30', notes: 'Must be licensed bail bondsman. Cannot break and enter without notice.' },
  GA: { allowed: true,  license: true,  law: 'OCGA §17-6-57', notes: 'Must have power of attorney from bondsman.' },
  HI: { allowed: true,  license: false, notes: 'No specific statute.' },
  ID: { allowed: true,  license: false, notes: 'No license required.' },
  IL: { allowed: false, license: false, law: '725 ILCS 5/110-7', notes: 'Commercial bail bonding effectively prohibited. Recovery agents operate in legal grey area. Consult an attorney before engaging.' },
  IN: { allowed: true,  license: true,  law: 'IC §27-10-3', notes: 'Must be licensed bail enforcement agent.' },
  IA: { allowed: true,  license: false, notes: 'No specific statute.' },
  KS: { allowed: true,  license: true,  law: 'KSA §75-7e01', notes: 'Must be licensed bail enforcement agent.' },
  KY: { allowed: false, license: false, law: 'KRS §431.510', notes: 'Commercial bail effectively banned. Recovery agents not permitted.' },
  LA: { allowed: true,  license: true,  notes: 'Must be licensed bail agent or recovery agent.' },
  ME: { allowed: true,  license: false, notes: 'No specific statute.' },
  MD: { allowed: true,  license: true,  notes: 'Must notify local law enforcement before apprehension.' },
  MA: { allowed: true,  license: true,  notes: 'Must be licensed PI or bail agent.' },
  MI: { allowed: true,  license: true,  law: 'MCL §750.199', notes: 'Must be licensed. Armed agents need additional permit.' },
  MN: { allowed: true,  license: true,  notes: 'Must notify local law enforcement. Force limited to imminent danger situations.' },
  MS: { allowed: true,  license: false, notes: 'No license required.' },
  MO: { allowed: true,  license: false, notes: 'No specific statute. Must act under bondsman authority.' },
  MT: { allowed: true,  license: false, notes: 'No specific statute.' },
  NE: { allowed: true,  license: true,  notes: 'Must be licensed bail agent.' },
  NV: { allowed: true,  license: true,  law: 'NRS §697.300', notes: 'Must be licensed. 24-hr notice to local law enforcement required.' },
  NH: { allowed: true,  license: false, notes: 'No specific statute.' },
  NJ: { allowed: true,  license: true,  law: 'NJSA §17:31-1', notes: 'Must be licensed bail enforcement agent.' },
  NM: { allowed: true,  license: true,  notes: 'Must notify local law enforcement before apprehension.' },
  NY: { allowed: true,  license: true,  notes: 'Must be licensed PI. Significant restrictions on methods and use of force.' },
  NC: { allowed: true,  license: true,  law: 'NCGS §58-71-1', notes: 'Must be licensed bail bondsman.' },
  ND: { allowed: true,  license: false, notes: 'No specific statute.' },
  OH: { allowed: true,  license: true,  notes: 'Must be licensed surety bail bondsman.' },
  OK: { allowed: true,  license: true,  notes: 'Must be licensed bail bondsman or recovery agent.' },
  OR: { allowed: true,  license: true,  law: 'ORS §133.395', notes: 'Must notify local law enforcement before apprehension.' },
  PA: { allowed: true,  license: true,  notes: 'Must notify local law enforcement before apprehension.' },
  RI: { allowed: true,  license: false, notes: 'No specific statute.' },
  SC: { allowed: true,  license: true,  law: 'SCCA §38-53-70', notes: 'Must be licensed bail enforcement agent.' },
  SD: { allowed: true,  license: false, notes: 'No specific statute.' },
  TN: { allowed: true,  license: true,  law: 'TCA §40-11-132', notes: 'Must be licensed bail enforcement agent.' },
  TX: { allowed: true,  license: true,  law: 'TX Occ Code §1704', notes: 'Must be licensed. 24-hr written notice to local law enforcement required.' },
  UT: { allowed: true,  license: true,  notes: 'Must notify local law enforcement before apprehension.' },
  VT: { allowed: true,  license: false, notes: 'No specific statute.' },
  VA: { allowed: true,  license: true,  law: 'VA §9.1-186', notes: 'Must be licensed bail enforcement agent.' },
  WA: { allowed: true,  license: true,  law: 'RCW §18.185', notes: 'Must be licensed. Significant restrictions on methods.' },
  WV: { allowed: true,  license: false, notes: 'No specific statute.' },
  WI: { allowed: true,  license: false, notes: 'No specific statute.' },
  WY: { allowed: true,  license: false, notes: 'No specific statute.' },
  DC: { allowed: false, license: false, notes: 'DC does not use commercial bail. Recovery agents not applicable.' },
};

// ── DB access ────────────────────────────────────────────────────────────────
let _db = null;
async function getDb() {
  if (_db) return _db;
  const { open } = await import('sqlite');
  const sqlite3  = (await import('sqlite3')).default;
  _db = await open({ filename: process.env.PROVIDERS_DB || './data/providers.sqlite', driver: sqlite3.Database });
  await _db.run('PRAGMA journal_mode=WAL');
  return _db;
}

// ── GET /api/recovery-agents — search recovery agents ────────────────────────
router.get('/', authRequired, async (req, res) => {
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
    let orderBy = 'ORDER BY rating DESC, reviews DESC';
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
router.get('/laws/:state', authRequired, async (req, res) => {
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
router.get('/laws', authRequired, async (req, res) => {
  res.json({
    laws: RECOVERY_LAWS,
    summary: {
      allowed:  Object.values(RECOVERY_LAWS).filter(l => l.allowed).length,
      license_required: Object.values(RECOVERY_LAWS).filter(l => l.allowed && l.license).length,
      banned:   Object.values(RECOVERY_LAWS).filter(l => !l.allowed).length,
    },
    disclaimer: 'For informational purposes only. Verify with your state DOI.',
  });
});

export default router;
