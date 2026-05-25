/**
 * hague_contacts.js — Hague Convention Central Authority + Reporting Links
 *
 * Hague Abduction Convention (1980): Civil Aspects of International Child Abduction
 * Scope: family law attorneys + parents facing cross-border child abduction
 *
 * Routes:
 *   GET  /api/hague-contacts/central-authority/:countryCode
 *        → Returns the Central Authority for a specific country (name, address,
 *          phone, email, website). Sourced from HCCH member state registry.
 *
 *   GET  /api/hague-contacts/us-resources
 *        → US-specific resources:
 *          - Office of Children's Issues (State Dept Central Authority for US)
 *          - NCMEC (National Center for Missing & Exploited Children)
 *          - FBI IC3 for federal international parental kidnapping reporting
 *          - OCI emergency line
 *
 *   GET  /api/hague-contacts/member-states
 *        → Full list of Hague Convention member states with ISO codes
 *
 *   POST /api/hague-contacts/report-intake
 *        → Records a pre-application intake for attorney tracking.
 *          Does NOT submit to authority — attorney submits directly.
 *          Stores: caseId, countryCode, childName, abductionDate, notes
 *
 *   GET  /api/hague-contacts/intake/:caseId
 *        → Retrieves intake record for a specific case
 *
 * Auth: all routes require authRequired
 * Rate: standard authRequired rate limiting
 *
 * Legal note: Justice Gavel provides contact information and intake tracking.
 * Actual Hague applications must be submitted by attorneys directly to the
 * relevant Central Authority. We do not file on behalf of clients.
 */

import { err400, err401, err403, err404, err422, err500, safeInt, sanitizeStr }
  from '../utils/routeHelpers.js';
import { Router }        from 'express';
import { getDb }         from '../db/index.js';
import { authRequired }  from '../middleware/auth.js';
import logger            from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();

// ── US Central Authority and Key Resources ─────────────────────────────────
const US_RESOURCES = {
  central_authority: {
    name:    'Office of Children\'s Issues (OCI) — U.S. Central Authority',
    agency:  'U.S. Department of State',
    phone:   '+1-202-501-4444',
    emergency: '+1-888-407-4747',
    email:   'abduction@state.gov',
    website: 'https://travel.state.gov/content/travel/en/International-Parental-Child-Abduction.html',
    submit_application: 'https://travel.state.gov/content/travel/en/International-Parental-Child-Abduction/prevention/hague-convention.html',
    note:    'Available Mon–Fri 8am–8pm ET. Emergency line available 24/7 for US citizens abroad.',
  },
  ncmec: {
    name:    'National Center for Missing & Exploited Children (NCMEC)',
    phone:   '1-800-THE-LOST (1-800-843-5678)',
    website: 'https://www.missingkids.org',
    report:  'https://www.cybertipline.org',
    note:    'Available 24/7. Reports international parental abduction to FBI and Interpol.',
  },
  fbi: {
    name:    'FBI — International Parental Kidnapping (IPKCA)',
    statute: '18 U.S.C. § 1204',
    website: 'https://www.fbi.gov/investigate/violent-crime/parental-kidnapping',
    ic3:     'https://www.ic3.gov',
    note:    'File IC3 report for federal jurisdiction. FBI coordinates with Interpol for international cases.',
  },
  interpol: {
    name:    'INTERPOL — Child Abduction',
    website: 'https://www.interpol.int/Crimes/Crimes-against-children/Child-abduction',
    ncb:     'https://www.interpol.int/en/Contact/Contact-INTERPOL',
    note:    'Contact through FBI or local law enforcement. INTERPOL issues Yellow Notices for missing children.',
  },
};

// ── Hague Member States (ISO 3166-1 alpha-2 + Central Authority summary) ──
const MEMBER_STATES = [
  { code:'AR', name:'Argentina',       authority:'Dirección Nacional del Menor y la Familia', website:'https://www.argentina.gob.ar' },
  { code:'AU', name:'Australia',       authority:'Central Authority (Canberra)', website:'https://www.ag.gov.au/families-and-marriage/hague-conventions' },
  { code:'AT', name:'Austria',         authority:'Bundesministerium für Justiz', website:'https://www.justiz.gv.at' },
  { code:'BE', name:'Belgium',         authority:'Service public fédéral Justice', website:'https://justice.belgium.be' },
  { code:'BR', name:'Brazil',          authority:'Autoridade Central Federal — ACAF', website:'https://www.gov.br/mj/pt-br' },
  { code:'CA', name:'Canada',          authority:'Central Authority (varies by province)', website:'https://www.justice.gc.ca/eng/fl-df/hague-lahaye/index.html' },
  { code:'CN', name:'China',           authority:'Not a contracting state — see HCCH', website:'https://www.hcch.net' },
  { code:'FR', name:'France',          authority:'Bureau de l\'entraide civile et commerciale internationale (BECCI)', website:'https://www.justice.gouv.fr' },
  { code:'DE', name:'Germany',         authority:'Bundesamt für Justiz', website:'https://www.bundesjustizamt.de' },
  { code:'GR', name:'Greece',          authority:'Ministry of Justice', website:'http://www.ministryofjustice.gr' },
  { code:'IN', name:'India',           authority:'Not a contracting state — bilateral channels required', website:'https://www.hcch.net' },
  { code:'IL', name:'Israel',          authority:'Ministry of Justice, Department of International Affairs', website:'https://www.gov.il/en/departments/topics/hague-convention' },
  { code:'IT', name:'Italy',           authority:'Ministero della Giustizia', website:'https://www.giustizia.it' },
  { code:'JP', name:'Japan',           authority:'Ministry of Foreign Affairs', website:'https://www.mofa.go.jp/ca/fna/hague/' },
  { code:'MX', name:'Mexico',          authority:'Secretaría de Gobernación — SEGOB', website:'https://www.gob.mx/segob' },
  { code:'NL', name:'Netherlands',     authority:'Ministry of Justice and Security', website:'https://www.rijksoverheid.nl' },
  { code:'NZ', name:'New Zealand',     authority:'Ministry of Justice', website:'https://www.justice.govt.nz' },
  { code:'PK', name:'Pakistan',        authority:'Not a contracting state — bilateral channels required', website:'https://www.hcch.net' },
  { code:'RU', name:'Russia',          authority:'Ministry of Education of the Russian Federation', website:'https://www.hcch.net' },
  { code:'ZA', name:'South Africa',    authority:'Department of Justice and Constitutional Development', website:'https://www.justice.gov.za' },
  { code:'ES', name:'Spain',           authority:'Dirección General de Cooperación Jurídica Internacional', website:'https://www.mjusticia.gob.es' },
  { code:'SE', name:'Sweden',          authority:'Ministry for Foreign Affairs', website:'https://www.government.se' },
  { code:'CH', name:'Switzerland',     authority:'Federal Office of Justice — FOJ', website:'https://www.bj.admin.ch' },
  { code:'TR', name:'Turkey',          authority:'Ministry of Justice', website:'https://www.adalet.gov.tr' },
  { code:'GB', name:'United Kingdom',  authority:'International Child Abduction & Contact Unit (ICACU)', website:'https://www.gov.uk/international-parental-child-abduction' },
  { code:'US', name:'United States',   authority:'Office of Children\'s Issues, U.S. Department of State', website:'https://travel.state.gov' },
  { code:'UY', name:'Uruguay',         authority:'Ministerio de Educación y Cultura', website:'https://www.gub.uy' },
  { code:'VE', name:'Venezuela',       authority:'Ministerio del Poder Popular para Relaciones Exteriores', website:'https://www.hcch.net' },
];

// ── Route: GET /us-resources ───────────────────────────────────────────────
router.get('/us-resources', authRequired, async (req, res) => {
  try {
    res.json({
      resources: US_RESOURCES,
      legal_note: 'Justice Gavel provides contact information only. Applications must be filed directly by attorneys with the relevant Central Authority.',
      hcch_full_list: 'https://www.hcch.net/en/states/authorities',
    });
  } catch (e) {
    logger.error('[hague] us-resources error', e);
    return err500(res, 'Failed to load US resources');
  }
});

// ── Route: GET /member-states ──────────────────────────────────────────────
router.get('/member-states', authRequired, async (req, res) => {
  try {
    res.json({
      member_states: MEMBER_STATES,
      total: MEMBER_STATES.length,
      note: 'Partial list. Full HCCH member state registry: https://www.hcch.net/en/states/hcch-members',
      hcch_full_list: 'https://www.hcch.net/en/states/authorities',
    });
  } catch (e) {
    logger.error('[hague] member-states error', e);
    return err500(res, 'Failed to load member states');
  }
});

// ── Route: GET /central-authority/:countryCode ─────────────────────────────
router.get('/central-authority/:countryCode', authRequired, async (req, res) => {
  try {
    const code = (req.params.countryCode || '').toUpperCase().trim();
    if (!code || code.length !== 2) return err400(res, 'Invalid country code (use ISO 3166-1 alpha-2)');

    // US is a special case with full resource object
    if (code === 'US') {
      return res.json({
        country_code: 'US',
        country_name: 'United States',
        central_authority: US_RESOURCES.central_authority,
        additional_resources: {
          ncmec: US_RESOURCES.ncmec,
          fbi:   US_RESOURCES.fbi,
          interpol: US_RESOURCES.interpol,
        },
      });
    }

    const state = MEMBER_STATES.find(s => s.code === code);
    if (!state) {
      return res.json({
        country_code: code,
        found: false,
        note: 'Country not in our member state list. Check HCCH full registry.',
        hcch_link: `https://www.hcch.net/en/states/authorities/details/?aid=`,
        hcch_member_search: 'https://www.hcch.net/en/states/hcch-members',
      });
    }

    res.json({
      country_code: state.code,
      country_name: state.name,
      central_authority: {
        name:    state.authority,
        website: state.website,
        hcch_profile: `https://www.hcch.net/en/states/authorities`,
      },
      contracting_state: !state.authority.includes('Not a contracting state'),
      note: state.authority.includes('Not a contracting state')
        ? 'This country has not ratified the 1980 Hague Convention. Bilateral channels or local counsel required.'
        : 'Contracting state — Hague Convention procedures apply.',
    });
  } catch (e) {
    logger.error('[hague] central-authority error', e);
    return err500(res, 'Failed to load central authority');
  }
});

// ── Route: POST /report-intake ─────────────────────────────────────────────
router.post('/report-intake', authRequired, routeLimiter, async (req, res) => {
  try {
    const { caseId, countryCode, childName, abductionDate, notes, childAge } = req.body;
    if (!caseId)       return err400(res, 'caseId required');
    if (!countryCode)  return err400(res, 'countryCode required');
    if (!childName)    return err422(res, 'childName required');
    if (!abductionDate) return err422(res, 'abductionDate required');

    const db     = await getDb();
    const userId = req.user.id;
    const code   = countryCode.toUpperCase().trim();
    const state  = MEMBER_STATES.find(s => s.code === code);

    // Verify case belongs to user
    const cas = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [safeInt(caseId), userId]);
    if (!cas) return err403(res, 'Access denied to this case');

    await db.run(`
      INSERT OR REPLACE INTO hague_intakes
        (case_id, user_id, country_code, child_name, child_age, abduction_date, notes, created_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))
    `, [safeInt(caseId), userId, code, sanitizeStr(childName, 100),
        safeInt(childAge), sanitizeStr(abductionDate, 20), sanitizeStr(notes || '', 2000)]);

    const isContractingState = state && !state.authority.includes('Not a contracting state');

    res.json({
      success: true,
      intake_recorded: true,
      next_steps: isContractingState ? [
        'Contact U.S. Central Authority (OCI): +1-888-407-4747',
        'Complete the Hague Application form at travel.state.gov',
        'Gather documentation: child\'s birth certificate, proof of residence, photos, custody order',
        'File with OCI — they will forward to the destination country\'s Central Authority',
        'Timeline: Central Authorities must respond within 6 weeks under Article 11',
      ] : [
        'Destination country has not ratified the 1980 Hague Convention',
        'Contact U.S. Embassy in destination country immediately',
        'File with NCMEC for FBI coordination: 1-800-843-5678',
        'Consult bilateral treaty options or local counsel in destination country',
      ],
      resources: {
        oci:       US_RESOURCES.central_authority,
        ncmec:     US_RESOURCES.ncmec,
        authority: state ? { name: state.authority, website: state.website } : null,
        hcch:      'https://www.hcch.net/en/instruments/conventions/full-text/?cid=24',
      },
      legal_notice: 'This intake record is for your case tracking. Your attorney must file the application directly with the U.S. Central Authority.',
    });
  } catch (e) {
    logger.error('[hague] report-intake error', e);
    return err500(res, 'Failed to record intake');
  }
});

// ── Route: GET /intake/:caseId ─────────────────────────────────────────────
router.get('/intake/:caseId', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const userId = req.user.id;
    const caseId = safeInt(req.params.caseId);

    const intake = await db.get(
      'SELECT id, case_id, submitted_by, country_of_removal, child_name, submitted_at, status FROM hague_intakes WHERE case_id=? AND user_id=?',
      [caseId, userId]
    );
    if (!intake) return err404(res, 'No Hague intake found for this case');

    res.json({ intake });
  } catch (e) {
    logger.error('[hague] intake-get error', e);
    return err500(res, 'Failed to load intake');
  }
});

export default router;
