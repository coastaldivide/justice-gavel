/**
 * AI step 4 — documents (docs/AI_PLATFORM.md §11): images / PDFs for Claude, the Files API,
 * court-paper extraction rules, surety-form field suggestions. Unit level, against the documented
 * mock (scripts/anthropic-mock-lib.mjs). Real-Postgres flows: integration/ai_documents.int.test.js.
 */
import http from 'http';
import { PDFDocument } from 'pdf-lib';
import {
  freshState, messageResponse, countTokensResponse, requestProblem, mediaProblem, createFileStore, filesRoute, parseMultipart, pdfPages,
} from '../../scripts/anthropic-mock-lib.mjs';

const mock = { server: null, state: freshState(), files: createFileStore(), requests: [] };
let media, files, paper, mapping, gw, schemas, core, courtDates;

/** A PNG header (IHDR) of the given size — enough for the size / type checks. */
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h) {
  // SOI, APP0 (len 16), SOF0 (len 17: precision, height, width, …)
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}
async function pdf(pages = 1, withFields = false) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([612, 792]);
  if (withFields) {
    const f = d.getForm();
    const p0 = d.getPage(0);
    const t = f.createTextField('DefName'); t.addToPage(p0, { x: 50, y: 700, width: 300, height: 20 });
    t.acroField.dict.set((await import('pdf-lib')).PDFName.of('TU'), (await import('pdf-lib')).PDFString.of("Defendant's full name"));
    f.createTextField('Premium').addToPage(d.getPage(pages - 1), { x: 50, y: 660, width: 120, height: 20 });
    f.createCheckBox('Married').addToPage(p0, { x: 50, y: 620, width: 12, height: 12 });
  }
  return Buffer.from(await d.save());
}

beforeAll(async () => {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let body = null;
      if (!String(req.headers['content-type'] || '').startsWith('multipart/')) { try { body = JSON.parse(raw.toString()); } catch { /* none */ } }
      mock.requests.push({ path: req.url, method: req.method, headers: req.headers, body });
      const fr = filesRoute(mock.files, req.method, req.url, raw, req.headers);
      if (fr) { res.writeHead(fr.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(fr.json)); }
      const r = req.url.endsWith('/count_tokens') ? countTokensResponse(body, { files: mock.files }) : messageResponse(body, { ...mock.state, files: mock.files }, req.headers);
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...(r.headers || {}) });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  media = await import('../ai/media.js');
  files = await import('../services/aiFiles.js');
  paper = await import('../services/courtPaper.js');
  mapping = await import('../services/bondDesk/formMapping.js');
  gw = await import('../services/aiClient.js');
  schemas = await import('../ai/schemas/index.js');
  core = await import('../services/bondDesk/core.js');
  courtDates = await import('../routes/courtDates.js');
});
afterAll(async () => {
  await new Promise((r) => mock.server.close(r));
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'AI_FILES_API', 'AI_FILES_TTL_DAYS']) delete process.env[k];
});
beforeEach(() => { mock.state = freshState(); mock.requests = []; });

describe('ai/media — files checked before they go to Claude', () => {
  test('type is sniffed from the bytes; sizes read from headers', () => {
    expect(media.sniffMime(png(10, 10))).toBe('image/png');
    expect(media.sniffMime(jpeg(10, 10))).toBe('image/jpeg');
    expect(media.sniffMime(Buffer.from('GIF89a\x10\x00\x20\x00......', 'latin1'))).toBe('image/gif');
    expect(media.sniffMime(Buffer.from('%PDF-1.7 hello world'))).toBe('application/pdf');
    expect(media.sniffMime(Buffer.from('not an image at all, just text'))).toBeNull();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    expect(media.sniffMime(heic)).toBe('image/heic');
    expect(media.imageSize(png(1200, 900), 'image/png')).toEqual({ width: 1200, height: 900 });
    expect(media.imageSize(jpeg(1600, 2000), 'image/jpeg')).toEqual({ width: 1600, height: 2000 });
    expect(media.imageSize(Buffer.from('GIF89a\x10\x00\x20\x00......', 'latin1'), 'image/gif')).toEqual({ width: 16, height: 32 });
  });

  test('inspectUpload: limits and clear codes', async () => {
    await expect(media.inspectUpload(Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty' });
    await expect(media.inspectUpload(png(1000, 1000), { maxBytes: 10 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(media.inspectUpload(Buffer.from('plain text pretending to be a jpg'))).rejects.toMatchObject({ code: 'unsupported_type' });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    await expect(media.inspectUpload(heic)).rejects.toMatchObject({ code: 'heic' });
    await expect(media.inspectUpload(png(9000, 100))).rejects.toMatchObject({ code: 'image_too_big' });
    await expect(media.inspectUpload(png(100, 100))).rejects.toMatchObject({ code: 'image_too_small' });
    await expect(media.inspectUpload(await pdf(3), { maxPages: 2 })).rejects.toMatchObject({ code: 'too_many_pages', maxPages: 2 });
    await expect(media.inspectUpload(Buffer.from('%PDF-1.7 broken'))).rejects.toMatchObject({ code: 'bad_pdf' });
    expect(await media.inspectUpload(await pdf(2), { maxPages: 10 })).toEqual({ mime: 'application/pdf', pages: 2 });
    expect(await media.inspectUpload(png(1200, 900))).toMatchObject({ mime: 'image/png', width: 1200 });
  });

  test('content blocks in the documented shapes; file sources add the Files beta header', () => {
    expect(media.mediaBlock('image/png', { buffer: Buffer.from('x') })).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'eA==' } });
    expect(media.mediaBlock('application/pdf', { fileId: 'file_1' })).toEqual({ type: 'document', source: { type: 'file', file_id: 'file_1' } });
    const msgs = [{ role: 'user', content: [media.mediaBlock('application/pdf', { fileId: 'file_1' }), { type: 'text', text: 'x' }] }];
    expect(media.hasFileSources(msgs)).toBe(true);
    const req = gw.buildRequest({ task: 'court_paper_read', system: 'S', messages: msgs });
    expect(req.headers['anthropic-beta'].split(',')).toEqual(['server-side-fallback-2026-07-01', gw.FILES_BETA]);
    expect(req.body.output_config.format.schema).toBe(schemas.SCHEMAS.court_paper);
    expect(requestProblem(req.body, req.headers)).toBeNull();
    const inline = gw.buildRequest({ task: 'form_field_map', system: 'S', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] });
    expect(inline.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(requestProblem(inline.body, inline.headers)).toBeNull();
  });

  test('schemas match the app lists (hearing types, data keys without the signature keys)', () => {
    expect(schemas.HEARING_VALUES).toEqual([...courtDates.HEARING_TYPES, 'none']);
    expect(schemas.FORM_MAP_KEYS).toEqual(core.DATA_KEYS.filter((k) => !core.SIGNATURE_KEYS.includes(k)));
    expect(JSON.stringify(schemas.SCHEMAS.form_field_map)).not.toContain('signature.');
  });
});

describe('the mock speaks images, documents and the Files API like the docs', () => {
  const body = (content) => ({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content }] });
  test('400 for a media type that is not what the bytes are; 404 for an unknown file_id; PDF page cap', async () => {
    const wrong = body([{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: png(300, 300).toString('base64') } }]);
    expect(mediaProblem(wrong)).toMatchObject({ status: 400, message: expect.stringMatching(/does not match/) });
    expect(mediaProblem(body([{ type: 'image', source: { type: 'file', file_id: 'file_nope' } }]), mock.files)).toMatchObject({ status: 404, type: 'not_found_error' });
    const big = await pdf(101);
    expect(pdfPages(big)).toBe(101);
    expect(mediaProblem(body([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: big.toString('base64') } }]))).toMatchObject({ status: 400, message: expect.stringMatching(/100 PDF pages/) });
    const r = messageResponse(wrong, freshState(), {});
    expect(r.status).toBe(400);
    expect(countTokensResponse(body([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (await pdf(2)).toString('base64') } }])).body.input_tokens).toBeGreaterThan(4000);
  });

  test('Files API: multipart upload (expires_in_seconds checked), metadata, not downloadable, delete, 404', async () => {
    const form = new FormData();
    form.append('file', new Blob([await pdf(1)], { type: 'application/pdf' }), 'jg-bd_form-1.pdf');
    form.append('expires_in_seconds', '100');
    const enc = async (f) => { const r = new Response(f); return { raw: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') }; };
    let e = await enc(form);
    expect(parseMultipart(e.raw, e.ct).map((p) => p.name)).toEqual(['file', 'expires_in_seconds']);
    expect(filesRoute(mock.files, 'POST', '/v1/files', e.raw, { 'content-type': e.ct }).status).toBe(400);
    form.set('expires_in_seconds', '3600');
    e = await enc(form);
    const up = filesRoute(mock.files, 'POST', '/v1/files', e.raw, { 'content-type': e.ct });
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ type: 'file', filename: 'jg-bd_form-1.pdf', mime_type: 'application/pdf', downloadable: false });
    expect(Date.parse(up.json.expires_at)).toBeGreaterThan(Date.now() + 3500_000);
    expect(filesRoute(mock.files, 'GET', `/v1/files/${up.json.id}/content`, Buffer.alloc(0)).status).toBe(400);
    expect(mediaProblem(body([{ type: 'image', source: { type: 'file', file_id: up.json.id } }]), mock.files)).toMatchObject({ status: 400, message: expect.stringMatching(/image block/) });
    expect(mediaProblem(body([{ type: 'document', source: { type: 'file', file_id: up.json.id } }]), mock.files)).toBeNull();
    expect(filesRoute(mock.files, 'DELETE', `/v1/files/${up.json.id}`, Buffer.alloc(0)).json).toEqual({ id: up.json.id, type: 'file_deleted' });
    expect(filesRoute(mock.files, 'DELETE', `/v1/files/${up.json.id}`, Buffer.alloc(0)).status).toBe(404);
  });
});

describe('services/aiFiles — the Files API client', () => {
  test('setting: on in dev, off in production unless AI_FILES_API=on; TTL clamped to the API range', () => {
    const env = process.env.NODE_ENV;
    try {
      delete process.env.AI_FILES_API;
      process.env.NODE_ENV = 'development'; expect(files.filesApiEnabled()).toBe(true);
      process.env.NODE_ENV = 'production'; expect(files.filesApiEnabled()).toBe(false);
      process.env.AI_FILES_API = 'on'; expect(files.filesApiEnabled()).toBe(true);
      process.env.AI_FILES_API = 'off'; process.env.NODE_ENV = 'development'; expect(files.filesApiEnabled()).toBe(false);
    } finally { process.env.NODE_ENV = env; delete process.env.AI_FILES_API; }
    process.env.AI_FILES_TTL_DAYS = '0.001'; expect(files.fileTtlSeconds()).toBe(3600);
    process.env.AI_FILES_TTL_DAYS = '365'; expect(files.fileTtlSeconds()).toBe(7_776_000);
    delete process.env.AI_FILES_TTL_DAYS; expect(files.fileTtlSeconds()).toBe(30 * 86_400);
    expect(files.remoteFilename('message_attachment', 12, 'image/jpeg')).toBe('jg-message_attachment-12.jpg');
  });

  test('upload (multipart, no beta header, expires_in_seconds) and delete (gone on 404)', async () => {
    const f = await files.uploadFile({ buffer: png(400, 400), mime: 'image/png', filename: 'jg-message_attachment-1.png', ttlSeconds: 7200 });
    expect(f.id).toMatch(/^file_mock_/);
    const sent = mock.requests.find((r) => r.path === '/v1/files');
    expect(sent.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.headers['anthropic-beta']).toBeUndefined();
    expect(mock.files.files.get(f.id).bytes.length).toBe(33);
    // a Messages request referencing it, with the beta header, through the gateway
    const out = await gw.aiMessage({ task: 'court_paper_read', system: 'S', messages: [{ role: 'user', content: [media.mediaBlock('image/png', { fileId: f.id }), { type: 'text', text: 'Read.' }] }] });
    expect(out.json.kind).toBe('court_paper');
    const m = mock.requests.find((r) => r.path === '/v1/messages');
    expect(m.headers['anthropic-beta']).toContain(gw.FILES_BETA);
    expect(m.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'file', file_id: f.id } });
    expect(mock.requests.some((r) => r.path === '/v1/messages/count_tokens' && r.headers['anthropic-beta'] === gw.FILES_BETA)).toBe(true);
    expect(await files.deleteRemoteFile(f.id)).toBe('deleted');
    expect(await files.deleteRemoteFile(f.id)).toBe('gone');
    // a deleted file referenced again → the API's 404 (the caller then falls back to inline bytes)
    await expect(gw.aiMessage({ task: 'court_paper_read', system: 'S', messages: [{ role: 'user', content: [media.mediaBlock('image/png', { fileId: f.id })] }] }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('services/courtPaper — what may be proposed', () => {
  const F = (value, source_text, confidence = 'high') => ({ value, source_text, confidence });
  const base = () => ({
    kind: 'court_paper',
    fields: {
      court_date: F('2027-03-02', 'Tuesday, March 2, 2027'), court_time: F('9:00', 'at 9:00 AM'),
      court_name: F('Davidson County General Sessions Court', 'GENERAL SESSIONS COURT OF DAVIDSON COUNTY'),
      court_address: F('408 2nd Ave N, Nashville, TN 37201', '408 2nd Avenue North'), courtroom: F('Courtroom 4B', 'Courtroom 4B', 'medium'),
      case_number: F('GS-123456', 'Case No. GS-123456'), judge: F('', '', 'not_found'), hearing_type: F('arraignment', 'ARRAIGNMENT'),
    },
    bring: [{ text: 'Photo ID', source_text: 'Bring a photo ID', confidence: 'high' }, { text: 'invented', source_text: '', confidence: 'high' }],
  });
  test('formats, words-from-the-paper rule, warnings', () => {
    const n = paper.normalizeExtraction(base(), { today: '2026-11-02' });
    expect(n.result).toBe('read');
    expect(n.fields.court_time).toEqual({ value: '09:00', source_text: 'at 9:00 AM', confidence: 'high' });
    expect(n.fields.judge).toEqual({ value: '', source_text: '', confidence: 'not_found' });
    expect(n.bring).toEqual([{ text: 'Photo ID', source_text: 'Bring a photo ID', confidence: 'high' }]);
    expect(n.warnings).toEqual([]);
    const b = base();
    b.fields.court_date = F('2027-02-30', 'Feb 30'); b.fields.case_number = F('GS-1', ''); b.fields.court_time = F('25:00', '25:00');
    const m = paper.normalizeExtraction(b, { today: '2026-11-02' });
    expect(m.fields.court_date).toEqual({ value: '', source_text: 'Feb 30', confidence: 'low' });
    expect(m.fields.case_number).toEqual({ value: '', source_text: '', confidence: 'not_found' });   // a value without its words is dropped
    expect(m.fields.court_time.value).toBe('');
    expect(m.warnings).toEqual(['no_date']);
    const p = base(); p.fields.court_date = F('2025-01-05', 'January 5, 2025');
    expect(paper.normalizeExtraction(p, { today: '2026-11-02' }).warnings).toEqual(['date_past']);
    const far = base(); far.fields.court_date = F('2030-01-05', 'January 5, 2030'); far.fields.court_time = F('', '', 'not_found');
    expect(paper.normalizeExtraction(far, { today: '2026-11-02' }).warnings).toEqual(['date_far', 'no_time']);
    const h = base(); h.fields.hearing_type = F('none', '', 'not_found');
    expect(paper.normalizeExtraction(h).fields.hearing_type.value).toBe('');
  });
  test('not a court paper / nothing readable → no fields at all', () => {
    expect(paper.normalizeExtraction({ ...base(), kind: 'not_court_paper' })).toEqual({ result: 'not_court_paper', fields: null, bring: [], warnings: [] });
    const empty = base();
    for (const k of Object.keys(empty.fields)) empty.fields[k] = F('', '', 'not_found');
    empty.bring = [];
    expect(paper.normalizeExtraction(empty).result).toBe('unreadable');
    expect(paper.normalizeExtraction({ ...base(), kind: 'unreadable' }).fields).toBeNull();
  });
  test('limits come from the environment with safe caps', () => {
    process.env.COURT_PAPER_MAX_MB = '100'; process.env.COURT_PAPER_MAX_PAGES = '500';
    expect(paper.courtPaperLimits()).toMatchObject({ maxBytes: 20 * 1024 * 1024, maxPages: 100, perHour: 10, perDay: 20 });
    delete process.env.COURT_PAPER_MAX_MB; delete process.env.COURT_PAPER_MAX_PAGES;
    expect(paper.courtPaperLimits()).toMatchObject({ maxBytes: 8 * 1024 * 1024, maxPages: 10 });
    process.env.COURT_PAPER_READER = 'off'; expect(paper.courtPaperEnabled()).toBe(false);
    delete process.env.COURT_PAPER_READER; expect(paper.courtPaperEnabled()).toBe(true);
  });
});

describe('services/bondDesk/formMapping — field suggestions', () => {
  test('describes AcroForm text fields with page, position and tooltip; counts the rest', async () => {
    const d = await mapping.describeFormFields(await pdf(2, true));
    expect(d.pageCount).toBe(2);
    expect(d.other).toBe(1);
    expect(d.text).toEqual([
      { name: 'DefName', page: 1, rect: [50, 700, 301, 21], tooltip: "Defendant's full name", max_length: null },
      { name: 'Premium', page: 2, rect: [50, 660, 121, 21], tooltip: null, max_length: null },
    ]);
    expect((await mapping.describeFormFields(await pdf(1))).text).toEqual([]);
  });
  test('only listed text fields, once each, known keys; skipped fields still listed', () => {
    const fields = [{ name: 'DefName', page: 1 }, { name: 'Premium', page: 2 }, { name: 'Office', page: 1 }];
    const out = mapping.cleanSuggestions([
      { field: 'DefName', data_key: 'bond.defendant_name', confidence: 'high', reason: 'Label "Defendant"' },
      { field: 'DefName', data_key: 'bond.charges', confidence: 'high', reason: 'dup' },
      { field: 'Invented', data_key: 'bond.premium', confidence: 'high', reason: 'x' },
      { field: 'Premium', data_key: 'signature.name', confidence: 'HIGH', reason: 'x' },
    ], fields);
    expect(out).toEqual([
      { field: 'DefName', data_key: 'bond.defendant_name', confidence: 'high', reason: 'Label "Defendant"', page: 1 },
      { field: 'Premium', data_key: null, confidence: 'low', reason: 'x', page: 2 },
      { field: 'Office', data_key: null, confidence: 'low', reason: '', page: 1 },
    ]);
  });
});
