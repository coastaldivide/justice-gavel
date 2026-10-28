/**
 * bond_desk_pdf_scripts.int.test.js — Chinese and Arabic names through the real Bond Desk
 * paperwork on real Postgres: an agency named in Arabic, a defendant named in Chinese, an
 * indemnitor named in Arabic. The receipt, the prepared copy, the signed copy and its
 * certificate are read back (content streams + ToUnicode) and must show the letters
 * themselves — Arabic joined and right to left, no "[U+…]" codes, no empty boxes — and stay
 * small (the Chinese and Arabic fonts are subset per document).
 */
import { PDFDocument } from 'pdf-lib';
import { describeIntegration, initSuite } from './_harness.js';
import { extractPdfText, rtlLogical, UNMAPPED } from '../helpers/pdfText.js';

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const ZH = '王小明';
const AR = 'محمد علي';
const AGENCY = 'كفالات الأمل';
const AR_VISUAL = String.fromCodePoint(0xFEF2, 0xFEE0, 0xFECB, 0x20, 0xFEAA, 0xFEE4, 0xFEA4, 0xFEE3);

async function sampleForm() {
  const d = await PDFDocument.create();
  const p = d.addPage([612, 792]);
  const f = d.getForm();
  const field = (name, y) => f.createTextField(name).addToPage(p, { x: 50, y, width: 300, height: 20 });
  field('Defendant', 700); field('Signer Name', 660); field('Signature', 620); field('Signed On', 580);
  return Buffer.from(await d.save());
}

async function readBack(buf) {
  const { pages, shows } = await extractPdfText(buf);
  expect(shows.filter((s) => s.cids.includes(0) && !s.font.includes('Helvetica'))).toEqual([]);
  expect(shows.filter((s) => s.text.includes(UNMAPPED))).toEqual([]);
  const flat = pages.join('').replace(/\n/g, '');
  expect(flat).not.toContain('[U+');
  return { pages, flat, shows };
}

describeIntegration('Bond Desk PDFs in Chinese and Arabic (real Postgres)', () => {
  const ctx = initSuite();
  let agent;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.89.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const bd = (m, path) => req(m, `/api/bond-desk${path}`, agent);

  beforeAll(async () => {
    if (!ctx.app) return;
    agent = await ctx.register({ displayName: 'BD scripts', accountType: 'bail_agent' });
    const r = await req('post', '/api/billing/bondsman/profile', agent).send({ company_name: AGENCY, license_number: 'TN-9', license_state: 'TN', states: ['TN'], counties: ['Davidson'] });
    expect(r.status).toBe(200);
    await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', 'sub_bd_scripts', 9900)`, [agent.user.id]);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM bondsman_subscriptions WHERE user_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [agent.user.id]);
    });
  });

  test('receipt, prepared copy, signed copies and certificates show the names themselves', async () => {
    if (!ctx.app) return;
    const b = (await bd('post', '/bonds').send({ defendant_name: ZH, bond_amount_cents: 500000, state: 'tn' })).body.bond;
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 50000 });

    // receipt: Arabic agency name (bold), Arabic payer
    const pay = await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 12500, method: 'cash', payer_name: AR });
    expect(pay.status).toBe(201);
    const receipt = await bd('get', `/payments/${pay.body.payment.id}/receipt.pdf`).buffer(true).parse(binary);
    expect(receipt.status).toBe(200);
    const rc = await readBack(receipt.body);
    expect(rc.flat).toContain(AR_VISUAL);
    expect(rtlLogical(rc.flat)).toContain(AGENCY);
    expect(rc.flat).toContain(ZH);
    expect(receipt.body.length).toBeLessThan(60 * 1024);

    // the form, mapped; a packet for the defendant (Chinese) and the indemnitor (Arabic)
    const ind = (await bd('post', `/bonds/${b.id}/indemnitors`).send({ full_name: AR, relationship: 'Brother', phone: '615-555-0144' })).body.indemnitor;
    const form = (await bd('post', '/forms').field('name', 'Indemnity Agreement').attach('file', await sampleForm(), 'f.pdf')).body.form;
    expect((await bd('patch', `/forms/${form.id}`).send({ field_map: {
      Defendant: 'bond.defendant_name', 'Signer Name': 'signer.full_name', Signature: 'signature.name', 'Signed On': 'signature.date' } })).status).toBe(200);
    const pk = await bd('post', `/bonds/${b.id}/packets`).send({ form_ids: [form.id], signers: [{ role: 'defendant' }, { role: 'indemnitor', indemnitor_id: ind.id }], lang: 'ar' });
    expect(pk.status).toBe(201);

    for (const [signer, name, visual] of [[pk.body.signers[0], ZH, ZH], [pk.body.signers[1], AR, AR_VISUAL]]) {
      const token = signer.link.split('/sign/')[1];
      const sg = (m, rest = '') => ctx.request()[m](`/api/sign/${token}${rest}`).set('User-Agent', 'JestBrowser/1.0').set('X-Forwarded-For', '203.0.113.9');
      expect((await sg('get')).status).toBe(200);
      const prep = await sg('post', '/prepare');
      expect(prep.status).toBe(200);
      const docId = prep.body.documents[0].id;
      const copy = await sg('get', `/documents/${docId}.pdf`).buffer(true).parse(binary);
      expect(copy.status).toBe(200);
      const cf = (await PDFDocument.load(copy.body)).getForm();
      expect(cf.getTextField('Defendant').getText()).toBe(ZH);
      expect(cf.getTextField('Signer Name').getText()).toBe(name);
      const pc = await readBack(copy.body);
      expect(pc.flat).toContain(ZH);
      expect(pc.flat).toContain(visual);

      expect((await sg('post', '/sign').send({ typed_name: name, agree_esign: true, agree_terms: true })).status).toBe(200);
      const signed = await sg('get', '/signed.pdf').buffer(true).parse(binary);
      expect(signed.status).toBe(200);
      const sd = await PDFDocument.load(signed.body);
      expect(sd.getPageCount()).toBe(2);
      const sc = await readBack(signed.body);
      expect(sc.pages[0].replace(/\n/g, '')).toContain(`/s/ ${visual}`);       // the flattened signature field
      expect(sc.pages[1].replace(/\n/g, '')).toContain(`/s/ ${visual}`);       // the certificate
      expect(sc.pages[1]).toContain('Electronic Signature Certificate');
      expect(sc.pages[1]).toContain('shown to the signer in Arabic');
      expect(signed.body.length).toBeLessThan(600 * 1024);
    }
  });
});
