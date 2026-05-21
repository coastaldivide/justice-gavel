// AI route — general guidance only, not legal advice
/**
 * transcribe.js — Voice-to-structured-note
 *
 * POST /api/transcribe/note
 *   Accepts: multipart audio file (m4a/mp4/wav/webm, max 25MB)
 *   Returns: { transcript, note: { date, summary, next_steps[], flags[], raw } }
 *
 * Pipeline:
 *   1. Audio file → OpenAI Whisper → raw transcript (~$0.006/min)
 *   2. Raw transcript → Claude → structured JSON note (~$0.01)
 *   Total cost per note: ~$0.02
 *
 * Falls back gracefully:
 *   - No OPENAI_KEY: returns a mock structured note from the raw text input
 *   - No ANTHROPIC_KEY: returns transcript only, no structure
 */

import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere, API_URLS } from '../utils/routeHelpers.js';
import express    from 'express';
import multer     from 'multer';
import FormData   from 'form-data';
import fetch      from 'node-fetch';
import { authRequired } from './auth.js';
import { enqueue } from '../services/aiQueue.js';
import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';

const router  = express.Router();
// ── Whisper-supported audio formats ──────────────────────────────────────────
// https://platform.openai.com/docs/guides/speech-to-text
const AUDIO_MIME = new Set([
  'audio/m4a', 'audio/x-m4a', 'audio/mp4',
  'audio/mpeg', 'audio/mp3',
  'audio/wav',  'audio/x-wav', 'audio/wave',
  'audio/webm',
  'audio/ogg',  'audio/ogg; codecs=opus',
  'audio/flac', 'audio/x-flac',
  'video/mp4',  // MP4 container — Whisper accepts audio track
  'video/mpeg',
  'application/octet-stream', // fallback — check extension
]);

const AUDIO_EXT = new Set([
  '.m4a', '.mp3', '.mp4', '.wav', '.webm', '.ogg', '.flac', '.mpeg', '.mpga',
]);

function isAudioFile(file) {
  if (AUDIO_MIME.has(file.mimetype)) return true;
  const ext = file.originalname?.toLowerCase().slice(file.originalname.lastIndexOf('.')) || '';
  return AUDIO_EXT.has(ext);
}

const upload  = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 }, // 25MB — Whisper limit
  fileFilter: (req, file, cb) => {
    if (isAudioFile(file)) return cb(null, true);
    cb(new Error(
      `Unsupported audio format: ${file.originalname}. ` +
      'Accepted formats: M4A, MP3, WAV, WEBM, OGG, FLAC, MP4. ' +
      'Video files (body cam, surveillance) cannot be transcribed — extract the audio track first.'
    ), false);
  },
});

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── Whisper transcription ─────────────────────────────────────────────────────
async function transcribeAudio(buffer, mimeType = 'audio/m4a', filename = 'note.m4a') {
  if (!OPENAI_KEY) {
    // No API key configured — return informative error (not a bypass)
    throw new Error('OPENAI_API_KEY not configured. Add it to backend/.env to enable voice transcription.');
  }
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'text');

  const res  = await fetch(API_URLS.OPENAI_STT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, ...form.getHeaders() },
    body:    form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err}`);
  }
  return await res.text(); // plain transcript string
}

// ── Claude structuring ────────────────────────────────────────────────────────
async function structureNote(transcript) {
  if (!ANTHROPIC_KEY) {
    return {
      date:       new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }),
      summary:    transcript,
      next_steps: [],
      flags:      [],
      raw:        transcript,
    };
  }

  const prompt = `You are a legal case management assistant for a public defender.
The following is a voice note dictated by a defense attorney after a client meeting.
Extract and structure it into a clean case note.

Voice note transcript:
"""
${transcript}
"""

Respond with ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "date": "today's date as a readable string e.g. Monday, March 28, 2025",
  "summary": "2-4 sentence plain English summary of the meeting and key facts",
  "next_steps": ["action item 1", "action item 2", "action item 3"],
  "flags": ["any urgent item, deadline, or concern flagged (or empty array)"],
  "raw": "${transcript.replace(/"/g, '\\"').slice(0, 500)}"
}

Rules:
- next_steps must be concrete actionable items, each starting with a verb
- flags should include: deadlines, potential violations, alibi witnesses, evidence issues
- If the transcript is too short or unclear, still return the structure with best effort
- Keep summary factual, not interpretive`;

  const res = await fetch(API_URLS.ANTHROPIC, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      temperature: 0.1,
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(text);
  } catch (e) {
    logger.warn('[transcribe/structureNote] JSON parse:', e?.message);
    // Claude returned malformed JSON — return safe fallback
    return {
      date:       new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }),
      summary:    transcript.slice(0, 400),
      next_steps: [],
      flags:      [],
      raw:        transcript,
    };
  }
}

// ── POST /api/transcribe/note ─────────────────────────────────────────────────
// Multer error handler wrapper — surfaces file type errors to client
function uploadAudio(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Audio file too large. Maximum size is 25MB. Try a shorter recording.',
        });
      }
      return err400(res, 'Transcription failed. Please try again.');
    }
    if (err) {
      return res.status(415).json({ error: 'Transcription failed. Please try again.' }); // 415 Unsupported Media Type
    }
    next();
  });
}

// ── API key guard — fail fast with clear error rather than cryptic undefined ─
if (!process.env.ANTHROPIC_API_KEY) {
  logger.error('[transcribe.js] ANTHROPIC_API_KEY not set — all AI routes will fail');
}

router.post('/note', authRequired, uploadAudio, async (req, res) => {
  try {

    // Verify caller has an active subscription or is using defender mode
    let subCheck = null;
    try {
      const db = await (await import('../db/index.js')).getDb();
      subCheck = await db.get(
        `SELECT id FROM subscriptions WHERE user_id=? AND status='active' LIMIT 1`,
        [req.user.id]
      ).catch(() => null);
    } catch (e) { logger.warn('[transcribe/sub-check]', e?.message); subCheck = null; }
    const isDefender = req.user?.role === 'defender' || req.user?.role === 'attorney';
    if (!subCheck && !isDefender) {
      return res.status(402).json({
        error: 'Active subscription required',
        code: 'subscription_required',
        upgrade_url: '/subscribe'
      });
    }

   if (!req.file) return err400(res, 'Audio file required');

    const { buffer, mimetype, originalname } = req.file;
    const filename = originalname || 'note.m4a';

    // Step 1: Whisper
    let transcript;
    try {
      transcript = await transcribeAudio(buffer, mimetype, filename);
    } catch (e) {
      return res.status(502).json({ error: 'Upstream service error. Please try again.' });
    }

    if (!transcript || transcript.trim().length < 5) {
      return res.status(422).json({ error: 'Could not understand audio. Please try again in a quiet location.' });
    }

    // Step 2: Claude structuring — async via job queue
    const jobId = await enqueue('transcribe', async () => {
      let note;
      try {
        note = await structureNote(transcript.trim());
      } catch (e) {
        logger.warn('[transcribe/structureNote] fallback used:', e?.message);
        note = {
          date:       new Date().toLocaleDateString('en-US'),
          summary:    transcript.trim(),
          next_steps: [],
          flags:      [],
          raw:        transcript.trim(),
        };
      }
      return { transcript: transcript.trim(), note };
    });

    res.json({ jobId, status: 'pending', async: true });
  } catch (e) {
    logger.error('[transcribe/note]', e.message);
    res.status(500).json({ error: 'Could not process voice note. Try again.' });
  }
});

// ── POST /api/transcribe/text — structure plain text (no audio) ───────────────
// Used when user types instead of speaks
router.post('/text', authRequired, perUserAiLimit, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return err400(res, 'text is required');
    const note = await structureNote(text.trim());
    res.json({ transcript: text.trim(), note });
  } catch (e) {
    logger.error('[transcribe/text]', e.message);
    res.status(500).json({ error: 'Could not structure note.' });
  }
});

export default router;
