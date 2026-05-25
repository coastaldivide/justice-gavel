/**
 * interrogation.js — Police Encounter Recorder
 *
 * POST /api/interrogation/transcribe
 *   Accepts: multipart audio file (m4a/mp4/wav/webm)
 *   Returns: { transcript, dialogue[], pdf_base64, recording_law }
 *
 * Pipeline:
 *   1. Detect user's state → check recording consent law
 *   2. Audio → OpenAI Whisper → raw transcript
 *   3. Raw transcript → Claude → speaker-tagged dialogue
 *   4. Dialogue → PDFKit → formatted PDF document
 *   5. PDF returned as base64 (client saves to device + emails attorney)
 *
 * Recording law data:
 *   One-party consent: 37 states (legal — only YOU need to consent)
 *   Two-party consent: CA, CT, FL, IL, MD, MA, MI, MT, NH, OR, PA, WA, WI
 *   (also called "all-party consent")
 */

import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere, API_URLS } from '../utils/routeHelpers.js';
import express  from 'express';
import multer   from 'multer';
import FormData from 'form-data';
import fetch    from 'node-fetch';
import PDFDocument from 'pdfkit';
import { authRequired } from '../middleware/auth.js';
import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ── Recording consent law by state ───────────────────────────────────────────
const RECORDING_LAWS = {
  // Two-party / all-party consent states
  CA: { consent: 'two-party', law: 'California Penal Code § 632', warn: true,
    note: 'California requires ALL parties to consent to being recorded. Recording without consent is a crime. However, you have the right to record police in PUBLIC spaces.' },
  CT: { consent: 'two-party', law: 'Conn. Gen. Stat. § 52-570d', warn: true,
    note: 'Connecticut requires all-party consent for private conversations. Police in public may be recorded.' },
  FL: { consent: 'two-party', law: 'Fla. Stat. § 934.03', warn: true,
    note: 'Florida requires all-party consent. Exception: recording police performing official duties in public is generally protected.' },
  IL: { consent: 'two-party', law: '720 ILCS 5/14-2', warn: true,
    note: 'Illinois requires all-party consent. Recording police in public is legal under People v. ACLU of Ill.' },
  MD: { consent: 'two-party', law: 'Md. Code Ann., Cts. & Jud. Proc. § 10-402', warn: true,
    note: 'Maryland requires all-party consent for private conversations.' },
  MA: { consent: 'two-party', law: 'Mass. Gen. Laws ch. 272, § 99', warn: true,
    note: 'Massachusetts requires all-party consent. Recording in public spaces generally protected.' },
  MI: { consent: 'two-party', law: 'MCL § 750.539c', warn: true,
    note: 'Michigan requires all-party consent for private conversations.' },
  MT: { consent: 'two-party', law: 'Mont. Code Ann. § 45-8-213', warn: true,
    note: 'Montana requires all-party consent.' },
  NH: { consent: 'two-party', law: 'RSA § 570-A:2', warn: true,
    note: 'New Hampshire requires all-party consent.' },
  OR: { consent: 'two-party', law: 'ORS § 165.540', warn: true,
    note: 'Oregon requires all-party consent. Exception for public officials.' },
  PA: { consent: 'two-party', law: '18 Pa. Cons. Stat. § 5703', warn: true,
    note: 'Pennsylvania requires all-party consent.' },
  WA: { consent: 'two-party', law: 'RCW § 9.73.030', warn: true,
    note: 'Washington requires all-party consent.' },
  WI: { consent: 'two-party', law: 'Wis. Stat. § 968.31', warn: true,
    note: 'Wisconsin requires all-party consent for private conversations.' },
};

function getRecordingLaw(state) {
  const upper = (state || '').toUpperCase();
  return RECORDING_LAWS[upper] || {
    consent: 'one-party',
    law: 'First Amendment / one-party consent',
    warn: false,
    note: 'In your state, only one party (you) needs to consent to recording. You have the right to record police performing their duties in public spaces.',
  };
}

// ── Audio upload handler ──────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — longer encounters
  fileFilter: (req, file, cb) => {
    const ok = /audio\/(m4a|mp4|mpeg|wav|webm|ogg|flac|x-m4a)|video\/mp4|application\/octet-stream/.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported format'), ok);
  },
});

// ── Whisper transcription ─────────────────────────────────────────────────────
async function transcribeAudio(buffer, mimetype, filename) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not configured');

  const form = new FormData();
  form.append('file', buffer, { filename: filename || 'encounter.m4a', contentType: mimetype });
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json'); // includes timestamps per segment
  form.append('language', 'en');

  const res = await fetch(API_URLS.OPENAI_STT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, ...form.getHeaders() },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.text,
    segments: data.segments || [], // [{id, start, end, text}]
    duration: data.duration,
  };
}

// ── Claude speaker tagging ────────────────────────────────────────────────────
async function tagSpeakers(transcript, segments, context = {}) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const segText = segments.length > 0
    ? segments.map(s => `[${Math.floor(s.start)}s] ${s.text}`).join('\n')
    : transcript;

  if (!ANTHROPIC_KEY) {
    // Fallback: return transcript as single speaker block
    return segments.map(s => ({
      timestamp: formatTime(s.start || 0),
      speaker: 'SPEAKER',
      text: s.text.trim(),
    }));
  }

  const prompt = `You are a forensic transcription assistant reviewing a recorded police encounter.

The following is a timestamped transcription of an audio recording made during a police encounter or questioning.
Your task: identify who is speaking each segment — the PERSON BEING QUESTIONED or a LAW ENFORCEMENT OFFICER.

Context provided:
- User name: ${context.userName || 'Unknown'}
- Date/time: ${context.dateTime || new Date().toISOString()}
- Location: ${context.location || 'Unknown'}

Transcript with timestamps:
${segText}

Rules for speaker identification:
- Law enforcement typically: asks questions, states charges, gives Miranda warnings, uses command language ("step out", "do you understand")
- Person questioned typically: answers questions, says "I don't know", "I want a lawyer", "I don't consent"
- If genuinely unclear, mark as UNKNOWN
- Preserve exact wording — do not paraphrase or correct

Respond ONLY with a valid JSON array. No markdown. No explanation.
Format:
[
  { "timestamp": "0:00", "speaker": "OFFICER", "text": "exact words" },
  { "timestamp": "0:08", "speaker": "SUSPECT", "text": "exact words" },
  { "timestamp": "0:12", "speaker": "UNKNOWN", "text": "unclear segment" }
]

Speaker labels MUST be exactly one of: OFFICER, SUSPECT, UNKNOWN
The label SUSPECT is the legal term for the person being questioned — it carries no implication of guilt.`;

  const res = await fetch(API_URLS.ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';

  try {
    return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch (e) {
    // Claude returned malformed JSON — build from raw segments
    return segments.map(s => ({
      timestamp: formatTime(s.start || 0),
      speaker: 'UNKNOWN',
      text: s.text.trim(),
    }));
  }
}

// ── PDF generation ────────────────────────────────────────────────────────────
function generatePDF(dialogue, meta) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: 'Police Encounter Recording Transcript',
        Author: 'Justice Gavel',
        Subject: `Recording — ${meta.dateTime}`,
        Keywords: 'police, recording, transcript, legal',
      },
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ──────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(18)
       .fillColor('#020E1C')
       .text('POLICE ENCOUNTER TRANSCRIPT', { align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11)
       .fillColor('#B71C1C')
       .text('⚖  INNOCENT UNTIL PROVEN GUILTY', { align: 'center' });

    doc.moveDown(0.5);
    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor('#1E2D42').lineWidth(1.5).stroke();
    doc.moveDown(0.5);

    // ── Meta block ──────────────────────────────────────────────
    const metaItems = [
      ['Date & Time', meta.dateTime],
      ['Location', meta.location || 'Not available'],
      ['Duration', meta.duration ? `${Math.floor(meta.duration / 60)}m ${Math.floor(meta.duration % 60)}s` : 'Unknown'],
      ['Recorded By', meta.userName || 'Justice Gavel User'],
      ['Recording Law', meta.recordingLaw],
      ['Generated', new Date().toLocaleString('en-US', { timeZoneName: 'short' })],
    ];

    doc.font('Helvetica').fontSize(9).fillColor('#444');
    metaItems.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(`${label}:  `, { continued: true })
         .font('Helvetica').text(value || '—');
    });

    doc.moveDown(0.5);

    // ── Legal notice ─────────────────────────────────────────────
    const noticeText = `LEGAL NOTICE: This recording was made pursuant to First Amendment rights and applicable state law. ${meta.consentNote || 'Recording was made with the consent of at least one party to the conversation.'} This transcript was generated by AI and may contain errors. It is intended as a reference document and should be reviewed by qualified legal counsel.`;

    doc.rect(72, doc.y, 468, null).fillColor('#FFF9C4').fill();
    doc.fillColor('#5D4037')
       .font('Helvetica').fontSize(8.5)
       .rect(72, doc.y, 468, 0)
       .text(noticeText, 78, doc.y + 6, { width: 456, lineGap: 2 });
    doc.moveDown(0.3);

    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor('#1E2D42').lineWidth(1).stroke();
    doc.moveDown(0.8);

    // ── Dialogue ─────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(12)
       .fillColor('#020E1C')
       .text('TRANSCRIPT', { align: 'left' });
    doc.moveDown(0.5);

    const speakerColors = {
      OFFICER:  '#B71C1C',  // dark red
      SUSPECT:  '#1565C0',  // dark blue
      UNKNOWN:  '#555555',  // grey
    };

    dialogue.forEach((line, idx) => {
      const color = speakerColors[line.speaker] || '#333';
      const label = line.speaker === 'SUSPECT' ? 'YOU' : line.speaker;
      const bgColor = idx % 2 === 0 ? '#F9F9F9' : '#FFFFFF';

      // Alternate row background
      const rowHeight = Math.max(28, doc.heightOfString(line.text, { width: 380 }) + 14);
      doc.rect(72, doc.y, 468, rowHeight).fillColor(bgColor).fill();

      const rowY = doc.y + 5;

      // Timestamp
      doc.font('Helvetica').fontSize(8)
         .fillColor('#888')
         .text(line.timestamp || '', 72, rowY, { width: 48 });

      // Speaker label
      doc.font('Helvetica-Bold').fontSize(9)
         .fillColor(color)
         .text(label, 124, rowY, { width: 64 });

      // Text
      doc.font('Helvetica').fontSize(10)
         .fillColor('#111')
         .text(line.text || '', 192, rowY, { width: 340 });

      doc.y = rowY + rowHeight - 5;
      doc.moveDown(0.15);
    });

    // ── Summary flags ─────────────────────────────────────────────
    const mirandaGiven = dialogue.some(d =>
      /miranda|right to remain silent|right to an attorney|anything you say/i.test(d.text)
    );
    const lawyerRequested = dialogue.some(d =>
      d.speaker !== 'OFFICER' && /i want (a|my) lawyer|i'd like (a|my) lawyer|i need (a|my) attorney|attorney/i.test(d.text)
    );
    const consentGiven = dialogue.some(d =>
      d.speaker !== 'OFFICER' && /i consent|you can search|go ahead/i.test(d.text)
    );
    const consentRefused = dialogue.some(d =>
      d.speaker !== 'OFFICER' && /i do not consent|i don't consent|no consent/i.test(d.text)
    );

    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(13)
       .fillColor('#020E1C')
       .text('AUTOMATED ANALYSIS', { align: 'left' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#555')
       .text('This section is generated by AI and is NOT legal advice. Have your attorney review the full transcript.');
    doc.moveDown(0.5);

    const flags = [
      { label: 'Miranda Rights Given', value: mirandaGiven, ok: true },
      { label: 'Attorney Requested by Subject', value: lawyerRequested, ok: true },
      { label: 'Consent to Search Given', value: consentGiven, ok: false },
      { label: 'Consent to Search Refused', value: consentRefused, ok: true },
    ];

    flags.forEach(flag => {
      const icon = flag.value ? '✓' : '✗';
      const fColor = flag.value ? (flag.ok ? '#2E7D32' : '#B71C1C') : '#888';
      doc.font('Helvetica-Bold').fontSize(11)
         .fillColor(fColor)
         .text(`${icon}  ${flag.label}`, { indent: 12 });
    });

    doc.moveDown(1);

    // ── What happens next ─────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(12)
       .fillColor('#020E1C')
       .text('NEXT STEPS');
    doc.moveDown(0.3);

    const nextSteps = [
      'Share this transcript with your criminal defense attorney immediately.',
      'Do not discuss the contents of this recording with anyone other than your attorney.',
      lawyerRequested ? 'You requested an attorney — questioning should have stopped at that point. Note if it continued.' : 'If you have not requested an attorney, do so now.',
      'Save this PDF to a secure location and email a copy to your attorney.',
      'Do not post this recording or transcript on social media.',
    ];

    nextSteps.forEach((step, i) => {
      doc.font('Helvetica').fontSize(10).fillColor('#222')
         .text(`${i + 1}.  ${step}`, { indent: 12, lineGap: 2 });
      doc.moveDown(0.3);
    });

    // ── Footer ────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.moveTo(72, doc.y).lineTo(540, doc.y).strokeColor('#1E2D42').lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(8).fillColor('#888')
       .text('Generated by Justice Gavel  ·  justicegavel.app  ·  Innocent until proven guilty.', { align: 'center' });
    doc.text(`Document ID: ${meta.docId || Date.now()}  ·  ${new Date().toISOString()}`, { align: 'center' });

    doc.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── POST /api/interrogation/transcribe ────────────────────────────────────────
router.post('/transcribe', authRequired, (req, res, next) => {
  upload.single('audio')(req, res, err => {
    if (err instanceof multer.MulterError) {
      return err400(res, 'File too large. Maximum 100MB.');
    }
    if (err) return res.status(415).json({ error: 'Unsupported audio format.' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return err400(res, 'Audio file required');

    const { state, userName, location, dateTime, caseId } = req.body;
    const law = getRecordingLaw(state);

    // Step 1: Whisper
    let whisperResult;
    try {
      whisperResult = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname || 'encounter.m4a'
      );
    } catch (e) {
      return res.status(502).json({ error: 'Transcription service unavailable. Try again.' });
    }

    const { text, segments, duration } = whisperResult;

    if (!text || text.trim().length < 5) {
      return res.status(422).json({ error: 'Could not understand audio. Try again in a quieter environment.' });
    }

    // Step 2: Speaker tagging
    let dialogue;
    try {
      dialogue = await tagSpeakers(text, segments, { userName, dateTime, location });
    } catch (e) {
      logger.warn('[interrogation/tagSpeakers]', e?.message);
      dialogue = [{ timestamp: '0:00', speaker: 'UNKNOWN', text: text.trim() }];
    }

    // Step 3: PDF
    const meta = {
      dateTime: dateTime || new Date().toLocaleString('en-US', { timeZoneName: 'short' }),
      location,
      duration,
      userName,
      recordingLaw: `${law.consent === 'two-party' ? 'All-party consent' : 'One-party consent'} state — ${law.law}`,
      consentNote: law.note,
      docId: `JG-${Date.now()}`,
    };

    let pdfBuffer;
    try {
      pdfBuffer = await generatePDF(dialogue, meta);
    } catch (e) {
      // PDF failed — return transcript without PDF
      return res.json({
        transcript: text,
        dialogue,
        pdf_base64: null,
        pdf_error: 'PDF generation failed',
        recording_law: law,
        duration,
      });
    }

    res.json({
      transcript: text,
      dialogue,
      pdf_base64: pdfBuffer.toString('base64'),
      pdf_size_kb: Math.round(pdfBuffer.length / 1024),
      recording_law: law,
      duration,
      doc_id: meta.docId,
    });

  } catch (e) {
    logger.error('[interrogation/transcribe]', e.message);
    res.status(500).json({ error: 'Could not process recording. Try again.' });
  }
});

// ── GET /api/interrogation/recording-law ─────────────────────────────────────
// Returns recording law for a given state (call before showing the recorder)
router.get('/recording-law', async (req, res) => {
  const { state } = req.query;
  res.json(getRecordingLaw(state));
});

export default router;
