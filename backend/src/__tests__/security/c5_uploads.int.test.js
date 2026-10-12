/**
 * audit11 C5 — unauthenticated / cheap memory-exhaustion DoS through uploads.
 *
 * Original attack (verified live): 4 concurrent 95 MB multipart uploads to
 * /api/interrogation/transcribe drove RSS from 146 MB to 588 MB and the
 * self-healing monitor killed the process. These tests replay that shape
 * against the REAL app over real sockets and prove:
 *   • anonymous uploads are refused before any body byte is read (401);
 *   • a declared 95 MB body is refused up front (413) — never buffered;
 *   • a body WITHOUT Content-Length (chunked) is cut off at the route cap;
 *   • per-user concurrency and the process-wide byte budget are enforced
 *     (429 / 503 upload_busy), and reservations are released afterwards;
 *   • an attack loop of oversized chunked uploads does not grow the heap;
 *   • the legitimate 10 MB-capped attachment upload still works.
 */
import http from 'http';
import { jest } from '@jest/globals';
import { describeIntegration, initSecuritySuite } from './_world.js';

const MB = 1024 * 1024;

/** Raw multipart POST over a socket. Streams `bodyBytes` of filler unless the server answers first. */
function rawUpload(port, path, { headers = {}, bodyBytes = 0, chunked = false, declared = null, field = 'file', filename = 'a.pdf', mime = 'application/pdf' } = {}) {
  return new Promise((resolve) => {
    const boundary = '----c5boundary' + Math.random().toString(16).slice(2);
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = head.length + bodyBytes + tail.length;
    const h = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...headers };
    if (!chunked) h['Content-Length'] = String(declared ?? total);
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: h });
    let settled = false;
    let answered = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on('response', (res) => {
      answered = true;           // stop sending; read the answer, then drop the socket
      let data = '';
      res.on('data', (c) => { data += c; });
      const finish = () => {
        let body = null; try { body = JSON.parse(data); } catch { /* not json */ }
        done({ status: res.statusCode, body });
        req.destroy();
      };
      res.on('end', finish);
      // The request body is deliberately left unfinished, so some servers never
      // complete the response stream — settle on what has arrived after a moment.
      setTimeout(finish, 800);
    });
    req.on('error', () => done({ status: 'socket_closed', body: null }));
    req.write(head);
    // Stream the filler in 256 KB slices until done or the server has answered.
    const slice = Buffer.alloc(256 * 1024, 0x41);
    let sent = 0;
    const pump = () => {
      while (!settled && !answered && sent < bodyBytes) {
        const n = Math.min(slice.length, bodyBytes - sent);
        sent += n;
        if (!req.write(n === slice.length ? slice : slice.subarray(0, n))) { req.once('drain', pump); return; }
      }
      if (!settled && !answered && sent >= bodyBytes) req.end(tail);
    };
    pump();
  });
}

describeIntegration('C5 — upload limits and memory budget', () => {
  jest.setTimeout(60_000);
  const ctx = initSecuritySuite();
  let server, port, user, other, caseId, uploads;

  beforeAll(async () => {
    if (!ctx.app) return;
    uploads = await import('../../middleware/uploads.js');
    server = http.createServer(ctx.app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    user  = await ctx.persona('Uploader');
    other = await ctx.persona('Uploader2');
    caseId = (await ctx.makeCase(user, { title: `C5 case ${ctx.tag}` })).id;
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM message_attachments WHERE case_id = ?', [caseId]).catch(() => {}); });
  });
  afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

  it('ATTACK: anonymous multipart uploads are refused before the body is read', async () => {
    for (const path of ['/api/interrogation/transcribe', '/api/transcribe/audio', '/api/messages/attachment', '/api/discovery/analyze']) {
      const r = await rawUpload(port, path, { declared: 95 * MB, bodyBytes: 512 * 1024 });
      expect([401, 'socket_closed']).toContain(r.status);
    }
  });

  it('ATTACK: a declared 95 MB upload is refused up front (413), not buffered', async () => {
    const before = process.memoryUsage().rss;
    const results = await Promise.all([1, 2, 3, 4].map(() =>
      rawUpload(port, '/api/messages/attachment', { headers: user.headers, declared: 95 * MB, bodyBytes: 2 * MB })));
    for (const r of results) expect([413, 429, 'socket_closed']).toContain(r.status);
    expect(results.some(r => r.status === 413)).toBe(true);
    expect(process.memoryUsage().rss - before).toBeLessThan(80 * MB);
  });

  it('ATTACK: transcription endpoints refuse before reading audio when transcription is unavailable', async () => {
    delete process.env.OPENAI_API_KEY;
    const a = await rawUpload(port, '/api/interrogation/transcribe', { headers: user.headers, field: 'audio', mime: 'audio/m4a', bodyBytes: 3 * MB, chunked: true });
    expect([503, 'socket_closed']).toContain(a.status);
    const b = await rawUpload(port, '/api/transcribe/note', { headers: user.headers, field: 'audio', mime: 'audio/m4a', bodyBytes: 3 * MB, chunked: true });
    expect([503, 'socket_closed']).toContain(b.status);
    const c = await rawUpload(port, '/api/transcribe/audio', { headers: user.headers, field: 'audio', mime: 'audio/m4a', bodyBytes: 3 * MB, chunked: true });
    expect([403, 'socket_closed']).toContain(c.status);   // free plan: refused before upload
  });

  it('ATTACK: chunked (no Content-Length) bodies are cut off at the route cap', async () => {
    const r = await rawUpload(port, '/api/messages/attachment', { headers: user.headers, chunked: true, bodyBytes: 30 * MB });
    expect([413, 'socket_closed']).toContain(r.status);
    if (r.status === 413) expect(r.body.error).toBe('file_too_large');
  });

  it('ATTACK: an upload attack loop does not grow memory and every reservation is released', async () => {
    global.gc?.();
    const before = process.memoryUsage().rss;
    for (let round = 0; round < 3; round++) {
      await Promise.all([user, other, user, other].map(u =>
        rawUpload(port, '/api/messages/attachment', { headers: u.headers, chunked: true, bodyBytes: 20 * MB })));
    }
    await new Promise(r => setTimeout(r, 200));
    global.gc?.();
    // 12 × 20 MB = 240 MB were thrown at the server; the old code buffered all of it.
    expect(process.memoryUsage().rss - before).toBeLessThan(120 * MB);
    expect(uploads.uploadStats()).toEqual({ memoryInFlight: 0, diskInFlight: 0, users: 0 });
  });

  it('per-user concurrency is limited (429) and the process-wide byte budget answers 503 upload_busy', async () => {
    const { uploadGuard, UPLOAD_LIMITS } = uploads;
    // Unit-level: hold uploads open and check admission directly through the guard.
    const guard = uploadGuard({ maxBytes: 10 * MB, any: true });
    const fakeRes = () => {
      const r = { headers: {}, statusCode: 0, body: null, listeners: {},
        setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }, once(ev, fn) { this.listeners[ev] = fn; } };
      return r;
    };
    const fakeReq = (uid, len) => ({
      user: { id: uid }, headers: { 'content-length': String(len) }, is: () => true,
      // never resolves the body: simulates an upload still in flight
      pipe() {}, on() {}, once() {}, unpipe() {}, resume() {}, readable: true,
    });
    const held = [];
    const admit = (uid, len) => {
      const res = fakeRes();
      const req = fakeReq(uid, len);
      // multer would start parsing here; we only care about the admission decision.
      try { guard(req, res, () => {}); } catch { /* parser on a fake stream */ }
      held.push(res);
      return res;
    };
    try {
      const a = admit(9001, 9 * MB);
      const b = admit(9001, 9 * MB);
      const c = admit(9001, 9 * MB);
      expect(a.statusCode).toBe(0);
      expect(b.statusCode).toBe(0);
      expect(c.statusCode).toBe(429);                       // third concurrent upload by one user
      expect(uploads.uploadStats().memoryInFlight).toBeGreaterThan(0);
      // fill the rest of the budget with other users until it refuses
      let busy = null;
      for (let i = 0; i < 20 && !busy; i++) {
        const r = admit(9100 + i, 9 * MB);
        if (r.statusCode === 503) busy = r;
      }
      expect(busy).toBeTruthy();
      expect(busy.body.error).toBe('upload_busy');
      expect(uploads.uploadStats().memoryInFlight).toBeLessThanOrEqual(UPLOAD_LIMITS.memoryBudgetBytes);
    } finally {
      for (const r of held) { r.listeners.close?.(); r.listeners.finish?.(); }
    }
    expect(uploads.uploadStats()).toEqual({ memoryInFlight: 0, diskInFlight: 0, users: 0 });
  });

  it('LEGIT: a normal PDF attachment (well under 10 MB) still uploads', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200 * 1024, 0x20), Buffer.from('\n%%EOF\n')]);
    const r = await ctx.request().post('/api/messages/attachment').set(user.headers)
      .field('case_id', String(caseId)).attach('file', pdf, { filename: 'bail-papers.pdf', contentType: 'application/pdf' });
    expect([200, 201]).toContain(r.status);
    expect(uploads.uploadStats()).toEqual({ memoryInFlight: 0, diskInFlight: 0, users: 0 });
  });
});
