/**
 * routes/motions/export.js — PDF Motion Export
 *
 * Converts an existing AI-generated motion draft into a court-ready PDF.
 *
 * GET  /api/motions/export/:id/pdf    — export motion from history as PDF
 * POST /api/motions/export/preview    — convert arbitrary text to motion PDF
 *
 * PDF Layout:
 *   - Letter size (8.5" × 11"), 1-inch margins
 *   - Times New Roman 12pt body text (Courier fallback in PDFKit)
 *   - Double-spaced body paragraphs (legal convention)
 *   - Page numbers in footer
 *   - Caption block with court, case, parties, motion title
 *   - Proper legal document formatting throughout
 */

import { Router }          from 'express';
import PDFDocument         from 'pdfkit';
import { getDb }           from '../../db/index.js';
import { authRequired }    from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { enqueue }         from '../../services/aiQueue.js';
import { MOTION_PDF_SYSTEM_PROMPT } from '../chat/_prompts.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }         from '../../utils/routeHelpers.js';
import { API_URLS }        from '../../utils/routeHelpers.js';
import logger              from '../../utils/logger.js';

const router      = Router();
const pdfLimiter  = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: 'PDF export limit reached.' });
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── POST /api/motions/export/preview — render any motion text to PDF ──────────
router.post('/preview', authRequired, pdfLimiter, async (req, res) => {
  try {
    const {
      motion_text,
      motion_type = 'Motion',
      case_number,
      court_name,
      defendant_name,
      state,
      attorney_name,
      bar_number,
    } = req.body || {};

    if (!motion_text?.trim()) return err400(res, 'motion_text is required.');

    const meta = {
      motion_type:    truncateStr(sanitizeStr(motion_type, 200), 200),
      case_number:    case_number ? sanitizeStr(case_number, 50) : null,
      court_name:     court_name  ? truncateStr(sanitizeStr(court_name, 200), 200) : null,
      defendant_name: defendant_name ? truncateStr(sanitizeStr(defendant_name, 200), 200) : null,
      state:          state ? sanitizeStr(state, 50) : null,
      attorney_name:  attorney_name ? truncateStr(sanitizeStr(attorney_name, 200), 200) : null,
      bar_number:     bar_number ? sanitizeStr(bar_number, 50) : null,
    };

    const pdfBuffer = await generateMotionPDF(motion_text, meta);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="motion-preview-${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    logger.error('[motions/export/preview]', e.message);
    res.status(500).json({ error: 'Could not generate motion PDF.' });
  }
});

// ── GET /api/motions/export/:id/pdf — export saved motion from history ────────
router.get('/:id/pdf', authRequired, pdfLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const motion = await db.get(
      'SELECT * FROM motion_history /* intentional: export needs full record */ WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!motion) return err404(res, 'Motion not found.');

    let fields = {};
    try { fields = JSON.parse(motion.case_fields || '{}'); } catch {}

    const meta = {
      motion_type:    motion.motion_type,
      case_number:    fields.case_number || null,
      court_name:     fields.court_name  || null,
      defendant_name: fields.defendant_name || null,
      state:          fields.state || null,
      attorney_name:  fields.attorney_name || null,
      bar_number:     fields.bar_number || null,
    };

    const pdfBuffer = await generateMotionPDF(motion.draft, meta);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="motion-${motion.motion_type.replace(/\s+/g,'-').toLowerCase()}-${motion.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    logger.error('[motions/export/pdf]', e.message);
    res.status(500).json({ error: 'Could not generate motion PDF.' });
  }
});

// ── POST /api/motions/export/:id/refine — AI-refine for PDF before export ────
router.post('/:id/refine', authRequired, pdfLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const motion = await db.get(
      'SELECT * FROM motion_history /* intentional: export needs full record */ WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!motion) return err404(res, 'Motion not found.');

    if (!ANTHROPIC_KEY) {
      // In demo mode, just export the existing draft
      return res.redirect(307, `/api/motions/export/${req.params.id}/pdf`);
    }

    const jobId = await enqueue('motion_refine', async () => {
      // Ask Claude to clean up the draft for PDF (remove markdown, fix formatting)
      const cleanPrompt = `${MOTION_PDF_SYSTEM_PROMPT}

The following motion draft was AI-generated and needs to be cleaned for court filing.
Remove any markdown symbols (**, #, *, etc.), fix spacing, ensure all sections are properly
numbered, and ensure the document reads as clean, professional legal text.
Do NOT change the substance — only clean up formatting and remove AI meta-commentary.

DRAFT:
${motion.draft.slice(0, 8000)}

OUTPUT ONLY the cleaned motion text. No explanatory notes. No markdown.`;

      const resp = await fetch(API_URLS.ANTHROPIC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:       'claude-sonnet-4-20250514',
          temperature: 0.05,
          max_tokens:  8000,
          messages:    [{ role: 'user', content: cleanPrompt }],
        }),
      });

      const data    = await resp.json();
      const refined = data.content?.[0]?.text || motion.draft;

      let fields = {};
      try { fields = JSON.parse(motion.case_fields || '{}'); } catch {}

      const meta = {
        motion_type:    motion.motion_type,
        case_number:    fields.case_number || null,
        court_name:     fields.court_name || null,
        defendant_name: fields.defendant_name || null,
        state:          fields.state || null,
        attorney_name:  fields.attorney_name || null,
        bar_number:     fields.bar_number || null,
      };

      const pdfBuffer = await generateMotionPDF(refined, meta);
      return { pdf_base64: pdfBuffer.toString('base64'), pdf_size_kb: Math.round(pdfBuffer.length / 1024) };
    });

    res.json({ jobId, status: 'pending', async: true,
      message: `Motion refinement and PDF generation queued. Poll /api/jobs/${jobId}.` });
  } catch (e) {
    logger.error('[motions/export/refine]', e.message);
    res.status(500).json({ error: 'Could not refine motion for PDF.' });
  }
});

// ── PDF Generator ─────────────────────────────────────────────────────────────
function generateMotionPDF(motionText, meta = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc    = new PDFDocument({
      size:    'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title:   meta.motion_type || 'Legal Motion',
        Subject: `${meta.motion_type} — ${meta.case_number || ''}`,
        Author:  meta.attorney_name || 'Justice Gavel',
        Creator: 'Justice Gavel Legal Platform',
      },
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Page numbering in footer
    let pageNum = 0;
    doc.on('pageAdded', () => {
      pageNum++;
      // Footer
      const y = doc.page.height - 45;
      doc.font('Helvetica').fontSize(10).fillColor('#000000');
      doc.text(String(pageNum), 72, y, { width: 468, align: 'center' });
    });

    const BODY_FONT  = 'Times-Roman';
    const BOLD_FONT  = 'Times-Bold';
    const LINE_GAP   = 10; // simulates double-spacing at 12pt
    const BODY_SIZE  = 12;
    const LEFT       = 72;
    const WIDTH      = 468;

    // ── Caption Block ─────────────────────────────────────────────────────────
    if (meta.court_name) {
      doc.font(BOLD_FONT).fontSize(12).fillColor('#000000')
         .text(meta.court_name.toUpperCase(), { align: 'center' });
      doc.moveDown(0.5);
    }

    doc.font(BODY_FONT).fontSize(BODY_SIZE);

    // Case parties
    if (meta.defendant_name) {
      doc.text('STATE OF ' + (meta.state || '').toUpperCase(), LEFT, doc.y, { continued: true });
      doc.text('  )', { continued: false });
      doc.text('               Plaintiff,', LEFT, doc.y);
      doc.text('vs.', LEFT, doc.y + 4);
      doc.text(meta.defendant_name.toUpperCase() + ',', LEFT, doc.y + 4);
      doc.text('               Defendant.', LEFT, doc.y);
    }

    // Dividing line
    doc.moveDown(0.5);
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).strokeColor('#000000').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Case number
    if (meta.case_number) {
      doc.font(BODY_FONT).fontSize(BODY_SIZE)
         .text(`Case No. ${meta.case_number}`, { align: 'center' });
      doc.moveDown(0.3);
    }

    // Motion title
    doc.font(BOLD_FONT).fontSize(BODY_SIZE + 1)
       .text((meta.motion_type || 'MOTION').toUpperCase(), { align: 'center' });
    doc.moveDown(1);

    doc.moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).strokeColor('#000000').lineWidth(1).stroke();
    doc.moveDown(1);

    // ── Body Text ─────────────────────────────────────────────────────────────
    // Parse the motion text into sections
    const lines = (motionText || '').split('\n');
    let inSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        doc.moveDown(0.8);
        continue;
      }

      // Detect section headings (all caps or Roman numeral patterns)
      const isHeading = (
        /^[IVX]+\.\s/.test(trimmed) ||              // Roman numerals
        /^\d+\.\s[A-Z]/.test(trimmed) ||            // Numbered sections
        /^[A-Z][A-Z\s,.:]{8,}$/.test(trimmed) ||  // ALL CAPS line
        /^INTRODUCTION|^STATEMENT|^ARGUMENT|^CONCLUSION|^BACKGROUND|^DISCUSSION|^PRAYER|^WHEREFORE|^COMES NOW/.test(trimmed)
      );

      if (isHeading) {
        doc.moveDown(0.5);
        doc.font(BOLD_FONT).fontSize(BODY_SIZE).fillColor('#000000')
           .text(trimmed, LEFT, doc.y, { width: WIDTH, lineGap: LINE_GAP });
        doc.moveDown(0.3);
        inSection = true;
      } else if (trimmed.startsWith('[') && (trimmed.includes('ATTORNEY TO VERIFY') || trimmed.includes('CITATION NEEDED'))) {
        // Highlight verification flags
        doc.font('Helvetica-Oblique').fontSize(10).fillColor('#B71C1C')
           .text(trimmed, LEFT, doc.y, { width: WIDTH, lineGap: 4 });
      } else {
        // Body paragraph
        doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('#000000')
           .text(trimmed, LEFT, doc.y, { width: WIDTH, lineGap: LINE_GAP, align: 'justify' });
      }
    }

    // ── Signature Block ────────────────────────────────────────────────────────
    doc.moveDown(2);
    doc.font(BODY_FONT).fontSize(BODY_SIZE)
       .text('Respectfully submitted,', LEFT, doc.y);
    doc.moveDown(2);
    doc.text('_______________________________', LEFT, doc.y);
    doc.text(meta.attorney_name || '[ATTORNEY NAME]', LEFT, doc.y + 2);
    if (meta.bar_number) {
      doc.text(`Bar No. ${meta.bar_number}`, LEFT, doc.y + 2);
    }
    doc.moveDown(0.5);
    doc.text('[ADDRESS]', LEFT, doc.y);
    doc.text('[PHONE] | [EMAIL]', LEFT, doc.y + 2);
    doc.moveDown(1);
    doc.text(`Date: ${'_'.repeat(30)}`, LEFT, doc.y);

    // ── Disclaimer ────────────────────────────────────────────────────────────
    doc.moveDown(1.5);
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
       .text('This document was AI-assisted using Justice Gavel. All citations marked [ATTORNEY TO VERIFY] must be independently confirmed. Not legal advice.', {
         width: WIDTH, align: 'center',
       });

    doc.end();
  });
}

export default router;
