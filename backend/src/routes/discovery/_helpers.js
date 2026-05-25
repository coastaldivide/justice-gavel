/**
 * discovery/_helpers.js — File type validation, AI analysis, DB schema
 *
 * Isolates the document analysis logic from route handlers.
 * analyzeDocument() is the core AI function — supports PDF, image, DOCX, and text.
 */
import { getDb }        from '../../db/index.js';
import { enqueue }      from '../../services/aiQueue.js';
import logger             from '../../utils/logger.js';
import { Router }         from 'express';
import multer             from 'multer';
import rateLimit          from 'express-rate-limit';

export function safeJsonParse(str, fallback = null) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests — please wait before trying again.' },
  keyGenerator: (req) => req.user?.id ? `user_${req.user.id}` : req.ip,
});

const router = Router();

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

export const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 32 * 1024 * 1024 }, // 32MB max
  fileFilter: (req, file, cb) => {
    if (isAccepted(file)) return cb(null, true);
    cb(new Error(
      `Unsupported file type: ${file.originalname}. ` +
      'Accepted: PDF, JPEG, PNG, TIFF, HEIC, WebP, DOCX, DOC, TXT'
    ), false);
  },
});

const STRIPE_SECRET  = process.env.STRIPE_SECRET;

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
// ── Convert DOCX → plain text via mammoth ────────────────────────────────────
export async function docxToText(buffer) {
  try {
    const mammoth = await import('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (e) {
    throw new Error('Could not read Word document: ' + e.message);
  }
}

// ── Build Claude content block(s) for the uploaded file ──────────────────────
export async function buildContentBlocks(file) {
  const { buffer, mimetype, originalname } = file;
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

export async function analyzeDocument(file, filename = 'document', docType = '', caseContext = '') {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to backend/.env to enable document analysis.');
  }

  const contextNote = caseContext
    ? `\n\nCase context provided by the esquire: ${caseContext}`
    : '';

  // case_intake: return structured JSON for field population
  if (docType === 'case_intake' || caseContext?.includes('JSON only')) {
    const intakePrompt = `You are a legal document parser. The user has photographed a charging document, bail slip, police report, or similar legal document. Extract the following fields and return ONLY a valid JSON object — no markdown, no explanation, just the JSON:

{
  "title": "brief case description, e.g. DUI Charge — Davidson County",
  "charge": "primary charge, e.g. DUI First Offense",
  "state": "2-letter state code, e.g. TN",
  "court_date": "next court date in YYYY-MM-DD format, or empty string if not found",
  "defendant_name": "defendant name if visible, or empty string",
  "notes": "any other relevant details: attorney, case number, bail amount, hearing type"
}

If a field is not visible in the document, use an empty string. Do not guess.`;

    const fileBlocks = await buildContentBlocks(file);
    const res = await fetch(API_URLS.ANTHROPIC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      temperature: 0.2,
        max_tokens: 600,
        messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: intakePrompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Claude error ${res.status}`);
    const data = await res.json();
    const raw  = data.content?.[0]?.text || '{}';
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return {
        summary:          parsed.notes || '',
        key_facts:        [parsed.charge, parsed.defendant_name, parsed.court_date].filter(Boolean),
        inconsistencies:  [],
        questions:        [],
        page_count:       1,
        doc_type:         'Case Intake',
        // Pass-through structured fields for frontend parseScanResult
        _intake: parsed,
        raw,
      };
    } catch (e) {
      logger.warn('[discovery/analyze] JSON parse:', e?.message);
      return { summary: raw, key_facts: [], inconsistencies: [], questions: [], page_count: 1, doc_type: 'Case Intake', raw };
    }
  }

  const prompt = `You are an expert criminal defense attorney's AI assistant analyzing a discovery document.

Document type: ${docType || 'Unknown — determine from content'}
Filename: ${filename}${contextNote}

Analyze this document thoroughly and respond with ONLY a valid JSON object (no markdown, no explanation):

{
  "summary": "3-5 sentence plain English summary of what this document is and its main content",
  "key_facts": [
    "Most important fact 1 — specific, concrete, useful for defense preparation",
    "Key fact 2...",
    "Key fact 3...",
    "Key fact 4...",
    "Key fact 5..."
  ],
  "inconsistencies": [
    "Any contradiction, gap, or inconsistency found — cite specific page/section and exact language",
    "E.g.: Officer states X on page 3 but report on page 12 shows Y"
  ],
  "questions": [
    "Cross-examination question or follow-up investigation item suggested by this document",
    "Question 2...",
    "Question 3...",
    "Question 4...",
    "Question 5..."
  ],
  "page_count": <estimated page count as integer>,
  "doc_type": "<Police Report | Lab Report | Medical Records | Witness Statement | Body Camera Log | Search Warrant | Other>"
}

Rules:
- key_facts: 5-10 items. Specific facts, dates, names, measurements, locations — defense-relevant
- inconsistencies: Be precise. Quote exact language from the document. Note page numbers when visible.
  If no inconsistencies found, return empty array — do not fabricate.
  For each inconsistency, prefix with a confidence tag:
    [STRONG] — Clear, unambiguous contradiction with specific quotes from two or more locations
    [NOTABLE] — Significant gap or tension worth investigating; needs verification
    [POSSIBLE] — Potential issue that requires comparison with other documents to confirm
  Format: "[STRONG] Officer states on p.3 'defendant was uncooperative' but use-of-force report on p.11 notes 'subject complied immediately.'"
  Never flag speculative items as [STRONG]. If uncertain, use [POSSIBLE] or omit.
- questions: These are defense preparation questions, not rhetorical. Each should be a specific,
  actionable question for cross-examination or investigation.
- Be thorough but precise. A public defender's client's freedom may depend on this analysis.`;

  // Build content blocks based on file type
  const fileBlocks = await buildContentBlocks(file);

  const res = await fetch(API_URLS.ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          ...fileBlocks,
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data  = await res.json();
  const text  = data.content?.[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    logger.warn('[discovery/structureAnalysis] JSON parse:', e?.message);
    return {
      summary:         text.slice(0, 500),
      key_facts:       [],
      inconsistencies: [],
      questions:       [],
      page_count:      0,
      doc_type:        docType || 'Document',
    };
  }
}

// ── POST /api/discovery/analyze ───────────────────────────────────────────────
