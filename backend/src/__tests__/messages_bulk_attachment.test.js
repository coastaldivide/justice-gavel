/**
 * messages_bulk_attachment.test.js — the REAL routes/messages.js router
 * (POST /bulk, POST /attachment, GET /attachment/:id, case thread encryption,
 * GET /direct) against an in-memory fake of the DB adapter.
 *
 * Verifies: validation, only directory attorneys WITH an account are messaged
 * (others reported as skipped), lawyer rows are never written, bodies and files
 * are encrypted at rest, sniffed type / size limits, case access control, and a
 * clear 503 when no attachment storage is available.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SECRET = process.env.JWT_SECRET;
const tok = (id, role = 'user') => jwt.sign({ id, role }, SECRET, { expiresIn: '1h' });

// ── fake DB ────────────────────────────────────────────────────────────────
const state = {};
const writes = [];
function reset() {
  Object.assign(state, {
    users: [1, 2, 3, 50, 60].map(id => ({ id, display_name: `User ${id}`, name: `User ${id}` })),
    lawyers: [
      { id: 10, name: 'No Account Esq', firm: 'Solo', phone: '555-0100', website: 'https://a.example', user_id: null },
      { id: 11, name: 'Has Account Esq', firm: null, phone: '555-0111', website: null, user_id: 50 },
      { id: 12, name: 'Claimed Listing Esq', firm: null, phone: null, website: null, user_id: null },
      { id: 13, name: 'Self Esq', firm: null, phone: null, website: null, user_id: 1 },
      { id: 14, name: 'Same Account Esq', firm: null, phone: null, website: null, user_id: 50 },
    ],
    attorney_profiles: [{ lawyer_id: 12, user_id: 60 }],
    cases: [{ id: 100, user_id: 1, title: 'My case' }, { id: 200, user_id: 2, title: 'Other case' }],
    case_assignments: [{ case_id: 100, defender_id: 3, status: 'active' }],
    messages: [], case_messages: [], message_attachments: [],
  });
  writes.length = 0;
}
const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const fakeDb = {
  async get(sql, p = []) { return (await this.all(sql, p))[0]; },
  async all(sql, p = []) {
    const s = norm(sql);
    if (/^SELECT id, user_id, title FROM cases WHERE id = \?/.test(s)) return state.cases.filter(c => c.id === p[0]);
    if (/FROM case_assignments WHERE case_id = \? AND defender_id = \?/.test(s))
      return state.case_assignments.filter(a => a.case_id === p[0] && a.defender_id === p[1] && a.status === 'active');
    if (/FROM lawyers l LEFT JOIN attorney_profiles/.test(s)) {
      return state.lawyers.filter(l => p.includes(l.id)).map(l => {
        const ap = state.attorney_profiles.find(a => a.lawyer_id === l.id);
        const uid = l.user_id ?? ap?.user_id ?? null;
        return { id: l.id, name: l.name, firm: l.firm, phone: l.phone, website: l.website,
          account_id: state.users.some(u => u.id === uid) ? uid : null };
      });
    }
    if (/^SELECT \* FROM message_attachments WHERE id = \?/.test(s)) return state.message_attachments.filter(a => a.id === p[0]);
    if (/FROM case_messages m LEFT JOIN users u ON m.sender_id = u.id LEFT JOIN message_attachments/.test(s)) {
      return state.case_messages.filter(m => m.case_id === p[0] && !m.deleted_at).map(m => {
        const a = state.message_attachments.find(x => x.message_id === m.id);
        return { ...m, attachment_id: a?.id ?? null, attachment_name: a?.original_name ?? null };
      });
    }
    if (/FROM case_messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.id = \?/.test(s)) return state.case_messages.filter(m => m.id === p[0]);
    if (/^SELECT deleted_at FROM case_messages WHERE id = \?/.test(s)) return state.case_messages.filter(m => m.id === p[0]);
    if (/FROM case_assignments ca LEFT JOIN users u/.test(s)) return [];
    if (/FROM messages m LEFT JOIN users su/.test(s))
      return state.messages.filter(m => m.recipient_id === p[0] || m.sender_id === p[1]).reverse();
    throw new Error('fake db: unhandled SELECT ' + s.slice(0, 120));
  },
  async run(sql, p = []) {
    const s = norm(sql);
    writes.push(s);
    if (/^INSERT INTO messages /.test(s)) {
      const row = { id: nextId(state.messages), sender_id: p[0], recipient_id: p[1], case_id: p[2], sender_role: p[3], lang: p[4], content: p[5] };
      state.messages.push(row); return { lastID: row.id, changes: 1 };
    }
    if (/^INSERT INTO message_attachments/.test(s)) {
      const [uploader_id, case_id, original_name, mime_type, size_bytes, sha256, storage, storage_key] = p;
      const row = { id: nextId(state.message_attachments), uploader_id, case_id, original_name, mime_type, size_bytes, sha256, storage, storage_key, encrypted: 1, message_id: null };
      state.message_attachments.push(row); return { lastID: row.id, changes: 1 };
    }
    if (/^INSERT INTO case_messages/.test(s)) {
      const attachment = /'attachment'/.test(s);
      const row = attachment
        ? { id: nextId(state.case_messages), case_id: p[0], sender_id: p[1], sender_type: p[2], body: p[3], message_type: 'attachment' }
        : { id: nextId(state.case_messages), case_id: p[0], sender_id: p[1], sender_type: p[2], body: p[3], message_type: p[4] };
      state.case_messages.push(row); return { lastID: row.id, changes: 1 };
    }
    if (/^UPDATE message_attachments SET message_id/.test(s)) {
      state.message_attachments.find(a => a.id === p[1]).message_id = p[0]; return { changes: 1 };
    }
    if (/^UPDATE case_messages SET read_at/.test(s)) return { changes: 0 };
    throw new Error('fake db: unhandled write ' + s.slice(0, 120));
  },
  async transaction(fn) { return fn(fakeDb); },
};

const pushes = [];
jest.unstable_mockModule('../db/index.js', () => ({ getDb: async () => fakeDb, default: fakeDb }));
jest.unstable_mockModule('../services/pushDelivery.js', () => ({
  sendPushToUser: async (uid, payload) => { pushes.push({ uid, payload }); return { sent: 1 }; },
}));
jest.unstable_mockModule('../utils/auditLog.js', () => ({ auditLog: async () => {} }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authRequired: (req, res, next) => {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    try { req.user = jwt.verify(t, SECRET); next(); } catch { res.status(401).json({ error: 'auth' }); }
  },
}));

const { default: router, BULK_MAX, ATTACHMENT_MAX_BYTES } = await import('../routes/messages.js');
const { decrypt, decryptBuffer } = await import('../services/encryption.js');
const storageMod = await import('../services/attachmentStorage.js');

const app = express();
app.use(express.json());
app.use('/api/messages', router);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\nconfidential plea offer\n%%EOF\n');
let tmpDir;

beforeEach(() => {
  reset(); pushes.length = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-attach-'));
  process.env.ATTACHMENTS_DIR = tmpDir;
  delete process.env.ATTACHMENTS_STORAGE;
  storageMod.resetAttachmentStorage();
});
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); delete process.env.ATTACHMENTS_DIR; });

const filesIn = (dir) => fs.readdirSync(dir, { recursive: true })
  .map(f => path.join(dir, f)).filter(f => fs.statSync(f).isFile());

// ── POST /bulk ─────────────────────────────────────────────────────────────
describe('POST /api/messages/bulk', () => {
  const send = (body, user = 1) => request(app).post('/api/messages/bulk').set('Authorization', `Bearer ${tok(user)}`).send(body);

  it('requires auth', async () => {
    expect((await request(app).post('/api/messages/bulk').send({ lawyer_ids: [10], message: 'hi' })).status).toBe(401);
  });

  it.each([
    ['no lawyer_ids', { message: 'hi' }],
    ['empty lawyer_ids', { lawyer_ids: [], message: 'hi' }],
    ['non-numeric id', { lawyer_ids: ['x'], message: 'hi' }],
    ['4 recipients', { lawyer_ids: [10, 11, 12, 14], message: 'hi' }],
    ['blank message', { lawyer_ids: [10], message: '   ' }],
    ['message over 5000 chars', { lawyer_ids: [10], message: 'x'.repeat(5001) }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await send(body)).status).toBe(400);
  });

  it(`allows at most ${BULK_MAX} recipients (the app's limit is 3)`, () => expect(BULK_MAX).toBe(3));

  it('messages only attorneys with an account and reports the rest as skipped', async () => {
    const r = await send({ lawyer_ids: [10, 11, 12], message: 'Can you take my DUI case?' });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(2);
    expect(r.body.requested).toBe(3);
    expect(r.body.recipients.map(x => x.lawyer_id).sort()).toEqual([11, 12]);
    expect(r.body.skipped).toEqual([expect.objectContaining({ lawyer_id: 10, reason: 'no_account', phone: '555-0100' })]);
    // one direct message per account, encrypted at rest
    expect(state.messages.map(m => m.recipient_id).sort()).toEqual([50, 60]);
    for (const m of state.messages) {
      expect(m.sender_id).toBe(1);
      expect(m.content).not.toContain('DUI');
      expect(decrypt(m.content)).toBe('Can you take my DUI case?');
    }
    await new Promise(r2 => setImmediate(r2));
    expect(pushes.map(p => p.uid).sort()).toEqual([50, 60]);
  });

  it('when no selected attorney has an account: 200, sent 0, friendly summary, nothing stored', async () => {
    const r = await send({ lawyer_ids: [10], message: 'hello' });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(0);
    expect(r.body.skipped[0].reason).toBe('no_account');
    expect(r.body.message).toMatch(/not|None/);
    expect(state.messages).toHaveLength(0);
  });

  it('skips self, duplicate accounts and unknown ids', async () => {
    const r = await send({ lawyer_ids: [11, 13, 14], message: 'hello' });
    expect(r.body.sent).toBe(1);
    expect(r.body.skipped.map(s => s.reason).sort()).toEqual(['duplicate', 'self']);
    const r2 = await send({ lawyer_ids: [999], message: 'hello' });
    expect(r2.body.skipped).toEqual([{ lawyer_id: 999, reason: 'not_found' }]);
  });

  it('never writes to the lawyers / attorney_profiles tables', async () => {
    await send({ lawyer_ids: [10, 11, 12], message: 'hello' });
    expect(writes.filter(w => /\b(lawyers|attorney_profiles|bail_agents)\b/i.test(w))).toEqual([]);
  });

  // (rate limit: 10 bulk sends per user per hour — the remaining tests use other senders)
  it('case_id must belong to the sender', async () => {
    expect((await send({ lawyer_ids: [11], message: 'hi', case_id: 100 }, 2)).status).toBe(404);
    const ok = await send({ lawyer_ids: [11], message: 'hi', case_id: 200 }, 2);
    expect(ok.status).toBe(200);
    expect(state.messages[0].case_id).toBe(200);
  });

  it('GET /direct shows the recipient the decrypted message', async () => {
    await send({ lawyer_ids: [11], message: 'Please call me back' }, 3);
    const r = await request(app).get('/api/messages/direct').set('Authorization', `Bearer ${tok(50)}`);
    expect(r.status).toBe(200);
    expect(r.body.messages[0]).toEqual(expect.objectContaining({ content: 'Please call me back', direction: 'received', sender_id: 3 }));
  });

  it('is rate limited per user (429 after 10 sends in an hour)', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await send({ lawyer_ids: [10], message: 'spam' }, 60);
    expect(last.status).toBe(429);
  });
});

// ── case thread encryption ─────────────────────────────────────────────────
describe('case messages are encrypted at rest', () => {
  it('POST stores ciphertext, GET returns plaintext; outsiders get 404, unassigned attorneys 403', async () => {
    const s = await request(app).post('/api/messages/100').set('Authorization', `Bearer ${tok(1)}`).send({ body: 'my hearing moved' });
    expect(s.status).toBe(200);
    expect(s.body.message.body).toBe('my hearing moved');
    expect(state.case_messages[0].body).not.toContain('hearing');
    const g = await request(app).get('/api/messages/100').set('Authorization', `Bearer ${tok(3, 'attorney')}`);
    expect(g.status).toBe(200);
    expect(g.body.messages[0].body).toBe('my hearing moved');
    expect((await request(app).get('/api/messages/100').set('Authorization', `Bearer ${tok(2)}`)).status).toBe(404);
    expect((await request(app).get('/api/messages/200').set('Authorization', `Bearer ${tok(3, 'attorney')}`)).status).toBe(403);
  });
});

// ── POST /attachment ───────────────────────────────────────────────────────
describe('POST /api/messages/attachment', () => {
  const up = (buf, { field = 'file', name = 'doc.jpg', caseId, user = 1 } = {}) => {
    const req = request(app).post('/api/messages/attachment').set('Authorization', `Bearer ${tok(user)}`);
    if (caseId !== undefined) req.field('case_id', String(caseId));
    return req.attach(field, buf, { filename: name, contentType: 'image/jpeg' });
  };

  it('stores an encrypted file, posts it into the case thread, and serves it back', async () => {
    const r = await up(PNG, { caseId: 100, name: '../../etc/passwd.jpg' });
    expect(r.status).toBe(201);
    expect(r.body.attachment).toEqual(expect.objectContaining({ mime_type: 'image/png', size_bytes: PNG.length, case_id: 100 }));
    expect(r.body.attachment.name).toBe('passwd.png');     // path stripped, extension from sniffed type
    expect(r.body.url).toBe(`/api/messages/attachment/${r.body.id}`);
    const files = filesIn(tmpDir);
    expect(files).toHaveLength(1);
    const stored = fs.readFileSync(files[0]);
    expect(stored.equals(PNG)).toBe(false);
    expect(decryptBuffer(stored).equals(PNG)).toBe(true);
    expect(state.case_messages[0]).toEqual(expect.objectContaining({ case_id: 100, message_type: 'attachment' }));
    expect(state.message_attachments[0].message_id).toBe(state.case_messages[0].id);

    const dl = await request(app).get(r.body.url).set('Authorization', `Bearer ${tok(1)}`).buffer(true)
      .parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.body.equals(PNG)).toBe(true);
    // the assigned attorney can read it, another user cannot
    expect((await request(app).get(r.body.url).set('Authorization', `Bearer ${tok(3, 'attorney')}`)).status).toBe(200);
    expect((await request(app).get(r.body.url).set('Authorization', `Bearer ${tok(2)}`)).status).toBe(404);
  });

  it('accepts the web field name "document" and works without a case', async () => {
    const r = await up(PDF, { field: 'document', name: 'plea.pdf' });
    expect(r.status).toBe(201);
    expect(r.body.attachment).toEqual(expect.objectContaining({ mime_type: 'application/pdf', case_id: null, message_id: null }));
    expect(fs.readFileSync(filesIn(tmpDir)[0]).includes(Buffer.from('confidential'))).toBe(false);
  });

  it('rejects files whose bytes are not an allowed type (415), whatever the declared type', async () => {
    const r = await up(Buffer.from('<html><script>alert(1)</script></html>'), { name: 'x.jpg' });
    expect(r.status).toBe(415);
    expect(filesIn(tmpDir)).toHaveLength(0);
  });

  it('rejects files over the size limit with 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES)]);
    const r = await up(big);
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('file_too_large');
  });

  it('400 for JSON / missing file, 404 for someone else\'s case', async () => {
    expect((await request(app).post('/api/messages/attachment').set('Authorization', `Bearer ${tok(1)}`).send({ a: 1 })).status).toBe(400);
    expect((await request(app).post('/api/messages/attachment').set('Authorization', `Bearer ${tok(1)}`).field('case_id', '100')).status).toBe(400);
    expect((await up(PNG, { caseId: 200 })).status).toBe(404);
    expect(filesIn(tmpDir)).toHaveLength(0);
  });

  it('answers 503 storage_unavailable when no storage is configured / writable', async () => {
    process.env.ATTACHMENTS_STORAGE = 'off';
    storageMod.resetAttachmentStorage();
    const r = await up(PNG);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('storage_unavailable');

    delete process.env.ATTACHMENTS_STORAGE;
    const ro = path.join(tmpDir, 'file-not-dir');
    fs.writeFileSync(ro, 'x');
    process.env.ATTACHMENTS_DIR = path.join(ro, 'sub');   // cannot be created
    storageMod.resetAttachmentStorage();
    expect((await up(PNG)).status).toBe(503);
  });

  it('requires auth', async () => {
    expect((await request(app).post('/api/messages/attachment').attach('file', PNG, 'a.png')).status).toBe(401);
  });
});
