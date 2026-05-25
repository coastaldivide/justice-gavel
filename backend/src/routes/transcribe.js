/**
 * routes/transcribe.js — Audio transcription via OpenAI Whisper
 * POST /api/transcribe/audio
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import multer from 'multer';
import logger from '../utils/logger.js';

const router = Router();
const upload = multer({ 
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB Whisper limit
  storage: multer.memoryStorage()
});

router.post('/audio', authRequired, upload.single('audio'), async (req, res) => {
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

export default router;
