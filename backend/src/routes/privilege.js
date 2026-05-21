/**
 * routes/privilege.js — Privilege Log Generator
 *
 * POST   /api/privilege/generate         — AI-generate privilege entries from document description
 * POST   /api/privilege/entries          — create privilege log entry manually
 * GET    /api/privilege/entries          — list entries for a matter
 * GET    /api/privilege/entries/:id      — get single entry
 * PUT    /api/privilege/entries/:id      — update entry
 * DELETE /api/privilege/entries/:id      — delete entry
 * GET    /api/privilege/matter/:matterId — full privilege log for a matter
 * GET    /api/privilege/matter/:matterId/pdf — export privilege log as PDF
 * GET    /api/privilege/matter/:matterId/csv — export as CSV
 * GET    /api/privilege/bases            — list privilege bases
 *
 * Privilege Bases:
 *   attorney_client   — ACP: confidential communication between client and attorney
 *   work_product      — Work Product: materials prepared in anticipation of litigation
 *   joint_defense     — JDA: shared among co-defendants under joint defense agreement
 *   common_interest   — CIP: shared among parties with common legal interest
 *   self_critical     — Self-critical analysis privilege (not universally recognized)
 */

import { Router }          from 'express';
import PDFDocument         from 'pdfkit';
import { getDb }           from '../db/index.js';
import { authRequired }    from '../middleware/auth.js';
import { loadFirmContext, requireFirmRole } from '../middleware/rbac.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { enqueue }         from '../services/aiQueue.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }         from '../utils/routeHelpers.js';
import { API_URLS }        from '../utils/routeHelpers.js';
import logger              from '../utils/logger.js';

const router     = Router();
const privLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 100, message: 'Privilege log limit reached.' });
const aiLimiter   = makeUserLimiter({ windowMs: 3_600_000, max: 20,  message: 'AI privilege generation limit reached.' });

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const PRIVILEGE_BASES = {
  attorney_client: {
    label:      'Attorney-Client Privilege',
    short:      'ACP',
    description:'Confidential communication between attorney and client made for the purpose of seeking or providing legal advice.',
    elements:   ['Communication between attorney and client','Made in confidence','For purpose of legal advice'],
  },
  work_product: {
    label:      'Work Product Doctrine',
    short:      'WP',
    description:'Materials prepared by or for a party or its representative in anticipation of litigation or trial.',
    elements:   ['Prepared in anticipation of litigation','By or for a party or representative','Includes opinion work product (heightened protection)'],
  },
  joint_defense: {
    label:      'Joint Defense Agreement',
    short:      'JDA',
    description:'Communications shared among co-defendants or co-parties pursuant to a joint defense agreement.',
    elements:   ['Joint defense agreement exists','Common legal interest','Shared for purpose of common defense'],
  },
  common_interest: {
    label:      'Common Interest Privilege',
    short:      'CIP',
    description:'Communications shared among parties with a common legal interest, even absent formal representation.',
    elements:   ['Common legal interest','Shared in furtherance of that interest','Reasonable expectation of confidentiality'],
  },
  self_critical: {
    label:      'Self-Critical Analysis',
    short:      'SCA',
    description:'Internal analysis or review conducted to evaluate and improve compliance or safety. (Not universally recognized.)',
    elements:   ['Internal analysis or review','Conducted to improve compliance or operations','Voluntary disclosure would chill candid self-assessment'],
  },
};

// ── Auto-number doc numbers ───────────────────────────────────────────────────
async // nextDocNumber: counter is passed to avoid N+1 per entry
function nextDocNumber(counter) {
  counter.n += 1;
  return `PRIV-${String(counter.n).padStart(4, '0')}`;
}

// ── GET /api/privilege/bases ──────────────────────────────────────────────────
router.get('/bases', authRequired, (req, res) => {
  res.json({ bases: PRIVILEGE_BASES });
});

// ── POST /api/privilege/generate — AI-generate entries ───────────────────────
router.post('/generate', authRequired, aiLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id,
      matter_table = 'matters',
      documents = [],   // array of { description, date, author, recipients, doc_type }
      privilege_basis,
      context,          // case context for AI
      save = false,
    } = req.body || {};

    if (!Array.isArray(documents) || !documents.length) {
      return err400(res, 'documents array required (max 50). Each: { description, date?, author?, recipients?, doc_type? }.');
    }
    if (documents.length > 50) return err400(res, 'Maximum 50 documents per generation request.');
    if (privilege_basis && !PRIVILEGE_BASES[privilege_basis]) {
      return err400(res, `Unknown privilege_basis. Valid: ${Object.keys(PRIVILEGE_BASES).join(', ')}`);
    }

    const matterId = matter_id ? safeInt(matter_id) : null;

    const jobId = await enqueue('privilege_generate', async () => {
      let entries;

      if (ANTHROPIC_KEY) {
        const docList = documents.map((d, i) =>
          `Doc ${i+1}: ${d.description || 'No description'}` +
          (d.date ? ` | Date: ${d.date}` : '') +
          (d.author ? ` | Author: ${d.author}` : '') +
          (d.recipients ? ` | Recipients: ${d.recipients}` : '') +
          (d.doc_type ? ` | Type: ${d.doc_type}` : '')
        ).join('\n');

        const basisInfo = privilege_basis
          ? `\nPrimary privilege basis to apply: ${PRIVILEGE_BASES[privilege_basis].label} (${PRIVILEGE_BASES[privilege_basis].short})`
          : '\nAssign the most appropriate privilege basis to each document.';

        const prompt = `You are a senior litigation attorney preparing a privilege log for discovery.

${context ? `MATTER CONTEXT:\n${context}\n` : ''}
${basisInfo}

PRIVILEGE BASES AVAILABLE:
- ACP (attorney_client): Confidential attorney-client communication for legal advice
- WP (work_product): Prepared in anticipation of litigation
- JDA (joint_defense): Shared under joint defense agreement
- CIP (common_interest): Common legal interest

DOCUMENTS TO LOG:
${docList}

For each document, generate a privilege log entry. Respond ONLY with valid JSON array, no preamble:
[
  {
    "doc_number_suffix": "1",
    "doc_type": "email|memo|letter|draft|notes|other",
    "privilege_basis": "attorney_client|work_product|joint_defense|common_interest",
    "withheld": true,
    "description": "Non-privileged description (2-3 sentences max, no privileged content)",
    "privilege_assertion": "One sentence explaining why privilege applies",
    "doc_date": "YYYY-MM-DD or null",
    "author": "name or null",
    "recipients": "names or null",
    "page_count_estimate": null
  }
]

CRITICAL: The description must NOT reveal privileged content. It must only describe the general nature, date, author, recipient, and document type — never the substance of legal advice or litigation strategy.`;

        const resp = await fetch(API_URLS.ANTHROPIC, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:       'claude-sonnet-4-20250514',
            temperature: 0.10,
            max_tokens:  4000,
            messages:    [{ role: 'user', content: prompt }],
          }),
        });

        const data = await resp.json();
        const raw  = data.content?.[0]?.text || '[]';
        try {
          entries = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch (e) {
          logger.warn('[privilege/generate] JSON parse failed — using fallback:', e?.message);
          entries = buildFallbackEntries(documents, privilege_basis);
        }
      } else {
        entries = buildFallbackEntries(documents, privilege_basis);
      }

      // Save entries if requested
      const saved = [];
      if (save && matterId && ctx?.firm_id) {
        // Fetch existing count ONCE before loop (eliminates N+1)
        const existingPriv = await db.get(
          'SELECT COUNT(*) as n FROM privilege_log WHERE matter_id=? AND firm_id=?',
          [matterId, ctx.firm_id]
        ).catch(() => ({ n: 0 }));
        const docCounter = { n: existingPriv?.n || 0 };

        for (const e of entries) {
          const docNum = nextDocNumber(docCounter); // uses pre-fetched counter
          const r = await db.run(
            `INSERT INTO privilege_log
              (firm_id, matter_id, matter_table, doc_number, doc_date, doc_type,
               author, recipients, description, privilege_basis, withheld,
               page_count, ai_generated, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
            [
              ctx.firm_id, matterId, sanitizeStr(matter_table, 20),
              docNum,
              e.doc_date || null,
              sanitizeStr(e.doc_type || 'other', 30),
              e.author ? truncateStr(sanitizeStr(e.author, 200), 200) : null,
              e.recipients ? truncateStr(sanitizeStr(e.recipients, 500), 500) : null,
              truncateStr(sanitizeStr(e.description || '', 2000), 2000),
              e.privilege_basis || privilege_basis || 'attorney_client',
              e.withheld !== false ? 1 : 0,
              e.page_count_estimate || null,
              req.user.id,
            ]
          );
          saved.push({ id: r.lastID, doc_number: docNum, ...e });
        }
      }

      return {
        generated: entries,
        saved:     save ? saved : [],
        count:     entries.length,
        ai_powered: !!ANTHROPIC_KEY,
      };
    });

    res.json({ jobId, status: 'pending', async: true,
      message: `Privilege log generation queued. Poll /api/jobs/${jobId} for results.` });
  } catch (e) {
    logger.error('[privilege/generate]', e.message);
    res.status(500).json({ error: 'Could not generate privilege log entries.' });
  }
});

function buildFallbackEntries(documents, privilege_basis) {
  return documents.map((d, i) => ({
    doc_number_suffix: String(i + 1),
    doc_type:          d.doc_type || 'other',
    privilege_basis:   privilege_basis || 'attorney_client',
    withheld:          true,
    description:       `[DEMO] ${d.description || 'Document'} — Add ANTHROPIC_API_KEY for AI-generated privilege log entries with proper legal descriptions.`,
    privilege_assertion: 'Document constitutes a confidential communication between attorney and client for purposes of obtaining legal advice.',
    doc_date:          d.date || null,
    author:            d.author || null,
    recipients:        d.recipients || null,
    page_count_estimate: null,
  }));
}

// ── POST /api/privilege/entries — manual entry ────────────────────────────────
router.post('/entries', authRequired, privLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const {
      matter_id, matter_table = 'matters',
      doc_date, doc_type = 'other',
      author, recipients, description,
      privilege_basis, withheld = true, page_count,
    } = req.body || {};

    if (!description?.trim())   return err400(res, 'description is required.');
    if (!privilege_basis || !PRIVILEGE_BASES[privilege_basis]) {
      return err400(res, `privilege_basis required. Valid: ${Object.keys(PRIVILEGE_BASES).join(', ')}`);
    }

    const matterId = matter_id ? safeInt(matter_id) : null;
    const firmId   = ctx?.firm_id || null;
    const docNum   = matterId && firmId ? await nextDocNumber(db, matterId, firmId) : `PRIV-${Date.now()}`;

    const DOC_TYPES = ['email','memo','letter','draft','notes','report','contract','other'];

    const r = await db.run(
      `INSERT INTO privilege_log
        (firm_id, matter_id, matter_table, doc_number, doc_date, doc_type,
         author, recipients, description, privilege_basis, withheld, page_count, ai_generated, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      [
        firmId, matterId, sanitizeStr(matter_table, 20),
        docNum,
        doc_date ? sanitizeStr(doc_date, 20) : null,
        DOC_TYPES.includes(doc_type) ? doc_type : 'other',
        author ? truncateStr(sanitizeStr(author, 200), 200) : null,
        recipients ? truncateStr(sanitizeStr(recipients, 500), 500) : null,
        truncateStr(sanitizeStr(description, 2000), 2000),
        privilege_basis,
        withheld ? 1 : 0,
        page_count ? safeInt(page_count) : null,
        req.user.id,
      ]
    );

    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [r.lastID]);
    res.json(entry);
  } catch (e) {
    logger.error('[privilege/entries/create]', e.message);
    res.status(500).json({ error: 'Could not create privilege log entry.' });
  }
});

// ── GET /api/privilege/entries — list entries ─────────────────────────────────
router.get('/entries', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const ctx  = await loadFirmContext(req);
    const { matter_id, privilege_basis, withheld, limit = 50, offset = 0 } = req.query;

    let sql = `SELECT pl.*, u.display_name AS created_by_name
               FROM privilege_log pl LEFT JOIN users u ON u.id=pl.created_by WHERE 1=1`;
    const params = [];

    if (ctx?.firm_id) { sql += ' AND pl.firm_id=?'; params.push(ctx.firm_id); }
    else              { sql += ' AND pl.created_by=?'; params.push(req.user.id); }
    if (matter_id)       { sql += ' AND pl.matter_id=?';        params.push(safeInt(matter_id)); }
    if (privilege_basis) { sql += ' AND pl.privilege_basis=?';  params.push(sanitizeStr(privilege_basis,30)); }
    if (withheld !== undefined) { sql += ' AND pl.withheld=?';  params.push(withheld === 'true' ? 1 : 0); }

    sql += ' ORDER BY pl.doc_number ASC LIMIT ? OFFSET ?';
    params.push(Math.min(safeInt(limit,50),100), safeInt(offset,0));

    const rows = await db.all(sql, params);
    res.json({ entries: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load privilege log.' });
  }
});

// ── GET /api/privilege/entries/:id
router.get('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Entry not found.');
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: 'Could not load entry.' });
  }
});

// ── PUT /api/privilege/entries/:id
router.put('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Entry not found.');

    const allowed = ['doc_date','doc_type','author','recipients','description','privilege_basis','withheld','page_count'];
    const updates = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      if (key === 'description') val = truncateStr(sanitizeStr(String(val), 2000), 2000);
      if (key === 'privilege_basis' && !PRIVILEGE_BASES[val]) continue;
      if (key === 'withheld') val = val ? 1 : 0;
      updates.push(`${key}=?`); params.push(val);
    }
    if (!updates.length) return err400(res, 'Nothing to update.');
    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id));
    await db.run(`UPDATE privilege_log SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Could not update entry.' });
  }
});

// ── DELETE /api/privilege/entries/:id
router.delete('/entries/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const entry = await db.get('SELECT id FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Entry not found.');
    await db.run('DELETE FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete entry.' });
  }
});

// ── GET /api/privilege/matter/:matterId — full log
router.get('/matter/:matterId', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);

    const entries  = await db.all(
      `SELECT pl.*, u.display_name AS reviewed_by_name
       FROM privilege_log pl LEFT JOIN users u ON u.id=pl.reviewed_by
       WHERE pl.matter_id=? ORDER BY pl.doc_number ASC`,
      [matterId]
    );

    const summary = {
      total:           entries.length,
      withheld:        entries.filter(e => e.withheld).length,
      produced_redacted: entries.filter(e => !e.withheld).length,
      by_basis:        {},
      ai_generated:    entries.filter(e => e.ai_generated).length,
    };
    for (const e of entries) {
      summary.by_basis[e.privilege_basis] = (summary.by_basis[e.privilege_basis] || 0) + 1;
    }

    res.json({ matter_id: matterId, entries, summary });
  } catch (e) {
    res.status(500).json({ error: 'Could not load privilege log.' });
  }
});

// ── GET /api/privilege/matter/:matterId/pdf — PDF export
router.get('/matter/:matterId/pdf', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);
    const ctx      = await loadFirmContext(req);
    const firm     = ctx?.firm_id ? await db.get('SELECT name FROM firms WHERE id=?', [ctx.firm_id]).catch(() => null) : null;

    // Get matter title
    const matter   = await db.get('SELECT title, client_name FROM matters WHERE id=?', [matterId]).catch(() => null);

    const entries  = await db.all(
      'SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE matter_id=? ORDER BY doc_number ASC',
      [matterId]
    );

    if (!entries.length) return err400(res, 'No privilege log entries found for this matter.');

    const pdfBuffer = await generatePrivilegePDF(entries, matter, firm);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="privilege-log-matter-${matterId}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    logger.error('[privilege/pdf]', e.message);
    res.status(500).json({ error: 'Could not generate privilege log PDF.' });
  }
});

// ── GET /api/privilege/matter/:matterId/csv — CSV export
router.get('/matter/:matterId/csv', authRequired, async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);

    const entries = await db.all(
      'SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE matter_id=? ORDER BY doc_number ASC',
      [matterId]
    );
    if (!entries.length) return err400(res, 'No privilege log entries found.');

    const header = 'Doc Number,Date,Type,Author,Recipients,Description,Privilege Basis,Withheld,Pages,AI Generated';
    const rows = entries.map(e => [
      e.doc_number, e.doc_date||'', e.doc_type, e.author||'', e.recipients||'',
      `"${(e.description||'').replace(/"/g,'""')}"`,
      PRIVILEGE_BASES[e.privilege_basis]?.short || e.privilege_basis,
      e.withheld ? 'Yes' : 'No (Redacted)',
      e.page_count || '',
      e.ai_generated ? 'Yes' : 'No',
    ].join(','));

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="privilege-log-${matterId}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'Could not export privilege log.' });
  }
});

// ── PDF Generator ─────────────────────────────────────────────────────────────
function generatePrivilegePDF(entries, matter, firm) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: {
        Title:   'Privilege Log',
        Subject: matter?.title || 'Privilege Log',
        Author:  firm?.name || 'Justice Gavel',
      },
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const DARK   = '#0D1B2A';
    const ACCENT = '#1A3A5C';
    const GRAY   = '#6B7280';
    const LIGHT  = '#F3F4F6';
    const PAGE_W = 702; // 756 - 54 - 54 (landscape)

    // ── Header ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK)
       .text('PRIVILEGE LOG', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(
      [firm?.name, matter?.title, `Generated: ${new Date().toLocaleDateString()}`]
        .filter(Boolean).join('  •  '),
      { align: 'center' }
    );
    doc.moveDown(0.5);
    doc.moveTo(54, doc.y).lineTo(756, doc.y).strokeColor(ACCENT).lineWidth(2).stroke();
    doc.moveDown(0.5);

    // ── Confidentiality notice ────────────────────────────────────────────────
    doc.rect(54, doc.y, PAGE_W, 24).fill('#FFF3CD');
    const noticeY = doc.y + 6;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#7B3F00')
       .text('CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGE / ATTORNEY WORK PRODUCT', 54, noticeY, { align: 'center', width: PAGE_W });
    doc.moveDown(0.8);

    // ── Table header ──────────────────────────────────────────────────────────
    const COLS = { num: 54, date: 110, type: 168, auth: 220, desc: 310, basis: 530, with: 620, pg: 672 };

    doc.rect(54, doc.y, PAGE_W, 20).fill(ACCENT);
    const hY = doc.y + 5;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
    doc.text('DOC#',        COLS.num,  hY, { width: 50 });
    doc.text('DATE',        COLS.date, hY, { width: 52 });
    doc.text('TYPE',        COLS.type, hY, { width: 46 });
    doc.text('AUTHOR',      COLS.auth, hY, { width: 84 });
    doc.text('DESCRIPTION', COLS.desc, hY, { width: 214 });
    doc.text('BASIS',       COLS.basis,hY, { width: 84 });
    doc.text('WITHHELD',    COLS.with, hY, { width: 46 });
    doc.text('PGS',         COLS.pg,   hY, { width: 30, align: 'right' });
    doc.moveDown(0.4);

    // ── Table rows ────────────────────────────────────────────────────────────
    entries.forEach((e, idx) => {
      const rowH = 36;
      const rowY = doc.y;

      if (doc.y + rowH > doc.page.height - 70) {
        doc.addPage();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRAY)
           .text('CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGE / ATTORNEY WORK PRODUCT — CONTINUED', { align: 'center' });
        doc.moveDown(0.5);
      }

      if (idx % 2 === 0) doc.rect(54, rowY, PAGE_W, rowH).fill(LIGHT);

      doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT);
      doc.text(e.doc_number, COLS.num, rowY + 4, { width: 50 });

      doc.font('Helvetica').fontSize(7.5).fillColor(DARK);
      doc.text(e.doc_date || '—',    COLS.date, rowY + 4, { width: 52 });
      doc.text((e.doc_type || 'other').toUpperCase().slice(0,7), COLS.type, rowY + 4, { width: 46 });
      doc.text((e.author || '—').slice(0, 20), COLS.auth, rowY + 4, { width: 84 });
      doc.text((e.description || '').slice(0, 160), COLS.desc, rowY + 4, { width: 214, lineGap: 0 });

      const basisShort = PRIVILEGE_BASES[e.privilege_basis]?.short || e.privilege_basis || '—';
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(e.withheld ? '#B71C1C' : '#1B5E20');
      doc.text(basisShort, COLS.basis, rowY + 4, { width: 84 });
      doc.text(e.withheld ? 'WITHHELD' : 'REDACTED', COLS.with, rowY + 4, { width: 46 });

      doc.font('Helvetica').fillColor(GRAY);
      doc.text(e.page_count ? String(e.page_count) : '—', COLS.pg, rowY + 4, { width: 30, align: 'right' });

      doc.y = rowY + rowH;
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.moveTo(54, doc.y).lineTo(756, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    doc.moveDown(0.5);

    const withheld = entries.filter(e => e.withheld).length;
    const redacted = entries.filter(e => !e.withheld).length;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
       .text(`Total Entries: ${entries.length}  |  Withheld: ${withheld}  |  Produced (Redacted): ${redacted}  |  This log was prepared by counsel and constitutes attorney work product.`, { align: 'center' });

    doc.end();
  });
}


// ── PUT /api/privilege/entries/:id/review — mark entry as reviewed ────────────
router.put('/entries/:id/review', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db    = await getDb();
    const ctx   = req.firmCtx;
    const entry = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    if (!entry) return err404(res, 'Privilege log entry not found.');
    if (entry.firm_id !== ctx?.firm_id) return err403(res);

    await db.run(
      "UPDATE privilege_log SET reviewed_by=?, updated_at=datetime('now') WHERE id=?",
      [req.user.id, safeInt(req.params.id)]
    );

    const updated = await db.get('SELECT id, firm_id, matter_id, matter_table, doc_number, doc_date, doc_type, author, recipients, description, privilege_basis, withheld, page_count, ai_generated, reviewed_by, created_by, created_at, updated_at FROM privilege_log WHERE id=?', [safeInt(req.params.id)]);
    res.json({ ...updated, reviewed: true, reviewed_by_id: req.user.id });
  } catch (e) {
    logger.error('[privilege/review]', e.message);
    res.status(500).json({ error: 'Could not mark entry as reviewed.' });
  }
});

// ── GET /api/privilege/matter/:matterId/review-status — review summary ─────────
router.get('/matter/:matterId/review-status', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db       = await getDb();
    const matterId = safeInt(req.params.matterId);
    const ctx      = await loadFirmContext(req);

    const [total, reviewed, aiGenerated] = await Promise.all([
      db.get('SELECT COUNT(*) as n FROM privilege_log WHERE matter_id=?', [matterId]),
      db.get('SELECT COUNT(*) as n FROM privilege_log WHERE matter_id=? AND reviewed_by IS NOT NULL', [matterId]),
      db.get('SELECT COUNT(*) as n FROM privilege_log WHERE matter_id=? AND ai_generated=1', [matterId]),
    ]);

    const totalN    = total?.n    || 0;
    const reviewedN = reviewed?.n || 0;

    res.json({
      matter_id:        matterId,
      total:            totalN,
      reviewed:         reviewedN,
      pending_review:   totalN - reviewedN,
      ai_generated:     aiGenerated?.n || 0,
      review_complete:  totalN > 0 && reviewedN === totalN,
      review_pct:       totalN > 0 ? Math.round(reviewedN / totalN * 100) : 100,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load review status.' });
  }
});

export default router;
