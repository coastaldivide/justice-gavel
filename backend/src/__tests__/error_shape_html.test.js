/**
 * error_shape_html.test.js — middleware/errorShape.js (debug scan Oct 30, 2026, issue 16).
 *
 * A 4xx sent as HTML or plain text with its Content-Type already set used to loop forever:
 * res.send → res.json (Express keeps the existing Content-Type) → res.send → … The request never
 * answered. Every 4xx on /api must come back as the usual { error, code, message } JSON.
 */
import express from 'express';
import request from 'supertest';
import { errorShape } from '../middleware/errorShape.js';

function app() {
  const a = express();
  a.use(errorShape());
  a.get('/api/html400', (req, res) => res.status(400).type('html').send('<p>Link not valid</p>'));
  a.get('/api/text404', (req, res) => res.status(404).type('text').send('Not found here.'));
  a.get('/api/ok', (req, res) => res.type('html').send('<p>ok</p>'));
  return a;
}

describe('errorShape with non-JSON error bodies', () => {
  test('an HTML 400 answers (no loop) as shaped JSON', async () => {
    const r = await request(app()).get('/api/html400').timeout(3000);
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toMatch(/json/);
    expect(r.body).toEqual(expect.objectContaining({ code: expect.any(String), message: expect.any(String) }));
  });
  test('a text 404 keeps its sentence as the error', async () => {
    const r = await request(app()).get('/api/text404').timeout(3000);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Not found here.');
  });
  test('a successful HTML page is untouched', async () => {
    const r = await request(app()).get('/api/ok').timeout(3000);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toBe('<p>ok</p>');
  });
});
