/**
 * routes/transcribe.js — Audio transcription via OpenAI Whisper
 * POST /api/transcribe/audio
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { transcribeLimiter } from '../utils/rateLimiters.js';
import multer from 'multer';
import logger from '../utils/logger.js';
import { aiConfigured, CLAUDE_MODEL, ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION } from '../utils/ai.js';

const router = Router();
const upload = multer({ 
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB Whisper limit
  storage: multer.memoryStorage()
});

router.post('/audio', authRequired, transcribeLimiter, upload.single('audio'), async (req, res) => {
  // Input validation guard
  if (req.body && JSON.stringify(req.body).length > 50000) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  // Require Advisor tier+ for AI transcription
  const PAID_TIERS = new Set(['advisor','legal_pro','esquire','24_hour_advisor','attorney','pro','starter']);
  if (!PAID_TIERS.has(req.user?.tier || 'free')) return res.status(403).json({ error: 'Transcription requires Advisor plan or higher.', code: 'upgrade_required', upgrade_url: '/subscription' });
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return res.status(503).json({ error: 'Transcription not configured' });
    
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No audio file provided' });
    
    // Build multipart form for Whisper API
    const FormData = (await import('form-data')).default;
    const fetch = (await import('node-fetch')).default;
    
    const form = new FormData();
    form.append('file', file.buffer, { filename: 'audio.m4a', contentType: file.mimetype });
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${OPENAI_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    if (!resp.ok) {
      const err = await resp.text();
      logger.error('[transcribe]', err);
      return res.status(502).json({ error: 'Transcription failed' });
    }
    
    const data = await resp.json();
    res.json({ text: data.text, duration: data.duration || null });
  } catch(e) {
    logger.error('[transcribe]', e.message);
    res.status(500).json({ error: 'Transcription error' });
  }
});

// ── Voice-note structuring (used by VoiceNoteScreen) ─────────────────────────
// Returns { date, summary, next_steps[], flags[], raw }. Uses Claude when an
// Anthropic key is configured; otherwise a deterministic keyword fallback, so
// typed notes work without any AI provider.
const NEXT_STEP_RE = /\b(need to|needs to|should|must|have to|call|file|bring|schedule|remember to|don't forget)\b/i;
const FLAG_RE      = /\b(deadline|court date|hearing|warrant|arrest|bail|bond|probation|lawyer|attorney|due|missed|fta|failure to appear)\b/i;

function structureLocally(text) {
  const raw = String(text || '').trim();
  const sentences = raw.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  return {
    date:       new Date().toISOString().slice(0, 10),
    summary:    sentences.slice(0, 3).join(' ').slice(0, 600) || raw.slice(0, 600),
    next_steps: sentences.filter(x => NEXT_STEP_RE.test(x)).slice(0, 8),
    flags:      sentences.filter(x => FLAG_RE.test(x)).slice(0, 8),
    raw,
  };
}

async function structureNote(text) {
  const base = structureLocally(text);
  if (!aiConfigured()) return base;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const r = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 600, temperature: 0.2,
        system: 'You organise a person\'s personal notes about their legal case. Reply with ONLY a JSON object: '
          + '{"summary": string (2-3 sentences), "next_steps": string[], "flags": string[] (deadlines, court dates, risks)}. '
          + 'Do not give legal advice and do not invent facts.',
        messages: [{ role: 'user', content: String(text).slice(0, 8000) }],
      }),
    }).finally(() => clearTimeout(t));
    if (!r.ok) throw new Error('Anthropic ' + r.status);
    const data = await r.json();
    const txt  = data.content?.[0]?.text || '';
    const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return {
      ...base,
      summary:    typeof json.summary === 'string' ? json.summary : base.summary,
      next_steps: Array.isArray(json.next_steps) ? json.next_steps.map(String).slice(0, 10) : base.next_steps,
      flags:      Array.isArray(json.flags) ? json.flags.map(String).slice(0, 10) : base.flags,
    };
  } catch (e) {
    logger.warn('[transcribe/structure] AI structuring failed, using fallback:', e.message);
    return base;
  }
}

// POST /api/transcribe/text { text } → { note }
router.post('/text', authRequired, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 20_000) return res.status(413).json({ error: 'Note too long (max 20,000 characters).' });
  try {
    res.json({ note: await structureNote(text) });
  } catch (e) {
    logger.error('[transcribe/text]', e.message);
    res.status(500).json({ error: 'Could not structure note' });
  }
});

// POST /api/transcribe/note (multipart "audio") → { note }
router.post('/note', authRequired, transcribeLimiter, upload.single('audio'), async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return res.status(503).json({ error: 'transcription_unavailable', message: 'Voice transcription is not available right now. You can type your note instead.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
  try {
    const FormData = (await import('form-data')).default;
    const nodeFetch = (await import('node-fetch')).default;
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'note.m4a', contentType: req.file.mimetype || 'audio/m4a' });
    form.append('model', 'whisper-1');
    const resp = await nodeFetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, ...form.getHeaders() }, body: form,
    });
    if (!resp.ok) {
      logger.error('[transcribe/note] whisper', resp.status, (await resp.text()).slice(0, 200));
      return res.status(502).json({ error: 'Transcription failed' });
    }
    const data = await resp.json();
    res.json({ note: await structureNote(data.text || '') });
  } catch (e) {
    logger.error('[transcribe/note]', e.message);
    res.status(500).json({ error: 'Transcription error' });
  }
});

export default router;
