import { aiMessage } from '../../services/aiClient.js';
import { safeJson } from '../../utils/routeHelpers.js';
/**
 * discovery/_helpers.js — File type validation, AI analysis, DB schema
 *
 * Isolates the document analysis logic from route handlers.
 * analyzeDocument() is the core AI function — supports PDF, image, DOCX, and text.
 */

export function safeJsonParse(str, fallback = null) {
  try { return str ? safeJson(str) : fallback; } catch { return fallback; }
}



// ── Accepted file types ───────────────────────────────────────────────────────
export const ACCEPTED_MIME = new Set([
  // PDF
  'application/pdf',
  // Images
  'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif',
  'image/heic', 'image/heif', 'image/webp', 'image/bmp',
  // Word documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Plain text / transcripts
  'text/plain',
  // Octet-stream fallback — check extension
  'application/octet-stream',
]);

export const ACCEPTED_EXT = new Set([
  '.pdf',
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif', '.webp', '.bmp',
  '.doc', '.docx',
  '.txt',
]);

export function getFileExt(filename = '') {
  return filename.toLowerCase().slice(filename.lastIndexOf('.')) || '';
}

export function isAccepted(file) {
  if (ACCEPTED_MIME.has(file.mimetype)) return true;
  if (file.mimetype === 'application/octet-stream') {
    return ACCEPTED_EXT.has(getFileExt(file.originalname));
  }
  return ACCEPTED_EXT.has(getFileExt(file.originalname));
}

// File type category helpers
export function isPdf(file)   { return file.mimetype === 'application/pdf' || getFileExt(file.originalname) === '.pdf'; }
export function isImage(file) {
  return file.mimetype.startsWith('image/') ||
    ['.jpg','.jpeg','.png','.tiff','.tif','.heic','.heif','.webp','.bmp'].includes(getFileExt(file.originalname));
}
export function isDocx(file) {
  return ['application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    .includes(file.mimetype) ||
    ['.doc','.docx'].includes(getFileExt(file.originalname));
}
export function isText(file) {
  return file.mimetype === 'text/plain' || getFileExt(file.originalname) === '.txt';
}

// Map image extension → Claude media_type
export function imageMediaType(file) {
  const ext = getFileExt(file.originalname);
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tiff': 'image/jpeg', '.tif': 'image/jpeg', // convert to jpeg-compatible
    '.heic': 'image/jpeg', '.heif': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/png',
  };
  if (file.mimetype.startsWith('image/jpeg')) return 'image/jpeg';
  if (file.mimetype.startsWith('image/png'))  return 'image/png';
  if (file.mimetype.startsWith('image/webp')) return 'image/webp';
  return map[ext] || 'image/jpeg';
}

// (The former 32 MB in-memory `upload` export here was unused; uploads go through
// middleware/uploads.js uploadGuard — see discovery/analyze.js.)


// discovery_analyses managed by db/index.js Year 2 block.
// ensureTables kept as a no-op export to avoid import-side errors in legacy callers.
export async function ensureTables(_db) { /* no-op — table created at startup */ }

// ── Discovery Pro subscription check ─────────────────────────────────────────
export async function hasDiscoveryPro(db, userId) {
  const sub = await db.get(
    `SELECT id FROM subscriptions
     WHERE user_id=? AND tier IN ('discovery_pro','discovery_pro_annual')
     AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1`,
    [userId]
  ).catch(() => null);
  return !!sub;
}

// ── Claude document analysis ──────────────────────────────────────────────────
// ── Convert DOCX → plain text (custom extractor — no mammoth dependency) ────
// DOCX is a ZIP archive containing XML files. We extract word/document.xml
// and pull text from <w:t> elements. This replaces mammoth entirely, removing
// jszip@3.7.1 (CVE-2022-48285) and underscore@1.13.x (CVE-2026-27601).
export async function docxToText(buffer) {
  try {
    const unzipper = await import('unzipper');

    // Open DOCX (ZIP) directly from buffer
    const directory = await unzipper.Open.buffer(buffer);

    // Target XML files that contain document text
    const targets = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];
    const textParts = [];

    for (const entry of directory.files) {
      if (!targets.includes(entry.path)) continue;
      const xmlBuffer = await entry.buffer();
      const xml       = xmlBuffer.toString('utf8');

      // Extract all <w:t> text nodes (Word text runs)
      // Also handle <w:delText> (tracked deletions) — skip those
      const textRuns = xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || [];
      for (const run of textRuns) {
        const m = run.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
        if (m) textParts.push(m[1]);
      }

      // Paragraph breaks: insert newline at each </w:p>
      const paraCount = (xml.match(/<\/w:p>/g) || []).length;
      if (paraCount > 0 && textParts.length > 0) textParts.push('\n');
    }

    // Decode XML entities
    const raw = textParts
      .join(' ')
      .replace(/&amp;/g,  '&')
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]+);/g,         (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/ +/g, ' ')
      .trim();

    if (!raw) throw new Error('No text found in document — file may be image-based or empty');
    return raw;
  } catch (e) {
    throw new Error('Could not read Word document: ' + e.message);
  }
}

// ── Build Claude content block(s) for the uploaded file ──────────────────────
export async function buildContentBlocks(file) {
  const { buffer, originalname } = file;
  const b64 = buffer.toString('base64');

  if (isPdf(file)) {
    return [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: b64 },
    }];
  }

  if (isImage(file)) {
    return [{
      type: 'image',
      source: { type: 'base64', media_type: imageMediaType(file), data: b64 },
    }];
  }

  if (isDocx(file)) {
    const text = await docxToText(buffer);
    if (!text.trim()) throw new Error('Word document appears to be empty or could not be read.');
    return [{ type: 'text', text: `[Word Document: ${originalname}]

${text}` }];
  }

  if (isText(file)) {
    const text = buffer.toString('utf-8');
    return [{ type: 'text', text: `[Text File: ${originalname}]

${text}` }];
  }

  throw new Error('Unsupported file type: ' + originalname);
}

/**
 * Analyse one uploaded document. Structured output (ai/schemas discovery_intake /
 * discovery_analysis): the answer is schema-checked JSON. A refused, cut-off or invalid answer
 * throws (job fails with ai_refused / ai_invalid_output) — nothing is saved, so a paid
 * analysis can be retried with the same payment.
 */
export async function analyzeDocument(file, filename = 'document', docType = '', caseContext = '', userId = null) {
  if (!(process.env.ANTHROPIC_API_KEY ?? '')) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to backend/.env to enable document analysis.');
  }

  const contextNote = caseContext
    ? `\n\nCase context provided by the esquire: ${caseContext}`
    : '';

  // case_intake: structured fields for the "scan a document" form
  if (docType === 'case_intake' || caseContext?.includes('JSON only')) {
    const fileBlocks = await buildContentBlocks(file);
    const out = await aiMessage({
      task: 'discovery_intake',
      system: [{ text: INTAKE_SYSTEM, cache: '5m' }],
      messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: 'Extract the fields from this document.' }] }],
      route: 'discovery_intake',
      userId,
    });
    const parsed = out.json;
    return {
      summary:          parsed.notes || '',
      key_facts:        [parsed.charge, parsed.defendant_name, parsed.court_date].filter(Boolean),
      inconsistencies:  [],
      questions:        [],
      page_count:       1,
      doc_type:         'Case Intake',
      // Pass-through structured fields for frontend parseScanResult
      _intake: parsed,
      raw: JSON.stringify(parsed),
    };
  }

  const fileBlocks = await buildContentBlocks(file);
  const out = await aiMessage({
    task: 'discovery_analysis',
    system: [{ text: ANALYSIS_SYSTEM, cache: '5m' }],
    messages: [{
      role: 'user',
      content: [
        ...fileBlocks,
        { type: 'text', text: `Document type: ${docType || 'Unknown — determine from content'}\nFilename: ${filename}${contextNote}\n\nAnalyze this document.` },
      ],
    }],
    route: 'discovery',
    userId,
    timeoutMs: 120_000,
  });
  return out.json;
}

// ── Prompts (stable → prompt-cached; the JSON shape is enforced by the schema) ──
const INTAKE_SYSTEM = `You are a legal document parser. The user has photographed a charging document, bail slip, police report, or similar legal document. Extract these fields:
- title: brief case description, e.g. "DUI Charge — Davidson County"
- charge: primary charge, e.g. "DUI First Offense"
- state: 2-letter state code, e.g. "TN"
- court_date: next court date in YYYY-MM-DD format, or an empty string if not found
- defendant_name: defendant name if visible, or an empty string
- notes: any other relevant details: attorney, case number, bail amount, hearing type

If a field is not visible in the document, use an empty string. Do not guess.`;

const ANALYSIS_SYSTEM = `You are an expert criminal defense attorney's AI assistant analyzing a discovery document.

Analyze the document thoroughly and answer with:
- summary: 3-5 sentence plain English summary of what this document is and its main content
- key_facts: 5-10 items. Specific facts, dates, names, measurements, locations — defense-relevant, concrete and useful for defense preparation
- inconsistencies: any contradiction, gap, or inconsistency found — cite specific page/section and exact language
- questions: cross-examination questions or follow-up investigation items suggested by this document (about 5)
- page_count: estimated page count (integer)
- doc_type: Police Report | Lab Report | Medical Records | Witness Statement | Body Camera Log | Search Warrant | Other

Rules:
- inconsistencies: Be precise. Quote exact language from the document. Note page numbers when visible.
  If no inconsistencies found, return an empty list — do not fabricate.
  For each inconsistency, prefix with a confidence tag:
    [STRONG] — Clear, unambiguous contradiction with specific quotes from two or more locations
    [NOTABLE] — Significant gap or tension worth investigating; needs verification
    [POSSIBLE] — Potential issue that requires comparison with other documents to confirm
  Format: "[STRONG] Officer states on p.3 'defendant was uncooperative' but use-of-force report on p.11 notes 'subject complied immediately.'"
  Never flag speculative items as [STRONG]. If uncertain, use [POSSIBLE] or omit.
- questions: These are defense preparation questions, not rhetorical. Each should be a specific,
  actionable question for cross-examination or investigation.
- Be thorough but precise. A public defender's client's freedom may depend on this analysis.`;

// ── POST /api/discovery/analyze ───────────────────────────────────────────────
