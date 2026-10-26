/**
 * services/bondDesk/packets.js — a signer's copies: prepare (fill), sign (typed name +
 * certificate), and the packet's status. Files are stored encrypted (attachmentStorage).
 */
import { newStorageKey } from '../attachmentStorage.js';
import { encryptBuffer, decryptBuffer } from '../encryption.js';
import { preparePdf, signPdf, certificatePdf, sha256, PdfError } from './pdf.js';
import { dataValues, fieldValues, signatureValues, agencyFor, maskPhone, maskEmail, CONSENT_LINES, CONSENT_VERSION, sameName } from './core.js';
import { liveTotal } from './money.js';
import { todayInZone } from '../../utils/timezone.js';

export class SignError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

export async function putFile(storage, buf) {
  const key = newStorageKey();
  await storage.put(key, encryptBuffer(buf));
  return key;
}
export async function getFile(storage, key) {
  return decryptBuffer(await storage.get(key));
}

export const event = (db, { packetId, signerId = null, event: ev, detail = null, ip = null, ua = null }) =>
  db.run('INSERT INTO bd_events (packet_id, signer_id, event, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    [packetId, signerId, ev, detail ? String(detail).slice(0, 300) : null, ip ? String(ip).slice(0, 64) : null, ua ? String(ua).slice(0, 300) : null]);

/** Forms of a packet that the role signs, in the packet's order. */
export async function formsForRole(db, packet, role) {
  const ids = (packet.form_ids || []).map(Number);
  if (!ids.length) return [];
  const rows = await db.all(
    `SELECT id, name, storage_key, field_map, roles FROM bd_forms WHERE id IN (${ids.map(() => '?').join(',')}) AND agent_id = ?`,
    [...ids, packet.agent_id]);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((i) => byId.get(i)).filter((f) => f && (f.roles || []).includes(role));
}

/** The values a signer's copies are filled with. */
export async function signerContext(db, { packet, signer, today }) {
  const bond = await db.get('SELECT * FROM bd_bonds WHERE id = ?', [packet.bond_id]);
  const agency = await agencyFor(db, packet.agent_id);
  const indemnitor = signer.indemnitor_id ? await db.get('SELECT * FROM bd_indemnitors WHERE id = ?', [signer.indemnitor_id]) : null;
  const premiumRows = await db.all(`SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ? AND kind = 'premium'`, [bond.id]);
  const power = await db.get(`SELECT number FROM bd_powers WHERE bond_id = ? AND status = 'executed'`, [bond.id]);
  const day = today || todayInZone(agency.tz);
  return {
    bond, agency, indemnitor, today: day,
    values: dataValues({ bond, agency, signer, indemnitor, premiumCents: liveTotal(premiumRows), powerNumber: power?.number || null, today: day }),
  };
}

/**
 * Fill this signer's copies once. Safe to call twice at once: only one set is kept.
 * → [{ id, name }]
 */
export async function prepareSigner(db, storage, { packet, signer, ip, ua }) {
  if (signer.prepared_at) return listDocs(db, signer.id);
  const forms = await formsForRole(db, packet, signer.role);
  if (!forms.length) throw new SignError(409, 'nothing_to_sign');
  const { values } = await signerContext(db, { packet, signer });
  const made = [];
  try {
    for (const f of forms) {
      const original = await getFile(storage, f.storage_key);
      let pdf;
      try {
        pdf = await preparePdf(original, fieldValues(f.field_map, values));
      } catch (e) {
        if (e instanceof PdfError) throw new SignError(409, 'form_problem', { form: f.name, field: e.detail || null, reason: e.code });
        throw e;
      }
      made.push({ form: f, key: await putFile(storage, pdf), sha: sha256(pdf) });
    }
  } catch (e) {
    for (const m of made) await storage.remove(m.key).catch(() => {});
    throw e;
  }
  const won = await db.transaction(async (tx) => {
    const c = await tx.run(`UPDATE bd_signers SET prepared_at = NOW(), status = CASE WHEN status IN ('sent','opened') THEN 'in_progress' ELSE status END
                             WHERE id = ? AND prepared_at IS NULL`, [signer.id]);
    if (!c.changes) return false;
    for (const m of made) {
      await tx.run(`INSERT INTO bd_documents (packet_id, signer_id, form_id, name, prepared_key, prepared_sha256) VALUES (?, ?, ?, ?, ?, ?)`,
        [packet.id, signer.id, m.form.id, m.form.name, m.key, m.sha]);
    }
    await event(tx, { packetId: packet.id, signerId: signer.id, event: 'prepared', ip, ua });
    await tx.run(`UPDATE bd_packets SET status = 'in_progress' WHERE id = ? AND status = 'sent'`, [packet.id]);
    return true;
  });
  if (!won) for (const m of made) await storage.remove(m.key).catch(() => {});
  return listDocs(db, signer.id);
}

export async function listDocs(db, signerId) {
  const rows = await db.all('SELECT id, name, viewed_at, status FROM bd_documents WHERE signer_id = ? ORDER BY id', [signerId]);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, viewed: !!r.viewed_at, signed: r.status === 'signed' }));
}

/**
 * Sign every copy of this signer. Requires: prepared, each copy opened, the typed name equal
 * to the signer's name, both agreements. → { signed_at }
 */
export async function signSigner(db, storage, { packet, signer, typedName, ip, ua, lang = 'en' }) {
  if (signer.status === 'signed') throw new SignError(409, 'already_signed');
  if (signer.status === 'declined') throw new SignError(409, 'declined');
  if (!signer.prepared_at) throw new SignError(409, 'not_prepared');
  if (!sameName(typedName, signer.name)) throw new SignError(400, 'name_mismatch');
  const docs = await db.all('SELECT d.id, d.name, d.form_id, d.prepared_key, d.prepared_sha256, d.viewed_at, f.field_map FROM bd_documents d JOIN bd_forms f ON f.id = d.form_id WHERE d.signer_id = ? ORDER BY d.id', [signer.id]);
  if (!docs.length) throw new SignError(409, 'not_prepared');
  if (docs.some((d) => !d.viewed_at)) throw new SignError(409, 'not_viewed');

  const signedAt = new Date();
  const ctx = await signerContext(db, { packet, signer });
  const typed = String(typedName).normalize('NFC').trim().replace(/\s+/g, ' ');
  const events = await db.all('SELECT event, detail, at FROM bd_events WHERE signer_id = ? ORDER BY at, id', [signer.id]);
  const timeline = (doc) => [
    ...events.filter((e) => ['sent', 'link_rotated', 'opened'].includes(e.event) || (e.event === 'viewed' && Number(e.detail) === Number(doc.id)))
      .map((e) => ({ at: new Date(e.at).toISOString(), label: e.event === 'viewed' ? `Opened this document (${doc.name})` : LABEL[e.event] })),
    { at: signedAt.toISOString(), label: 'Signed' },
  ];
  // Only the channels that actually delivered the link (delivery_* events with detail 'sent').
  const delivered = new Set(events.filter((e) => e.event.startsWith('delivery_') && e.detail === 'sent').map((e) => e.event));
  const sentTo = [delivered.has('delivery_sms') && signer.phone ? `text to ${maskPhone(signer.phone)}` : null,
    delivered.has('delivery_email') && signer.email ? `e-mail to ${maskEmail(signer.email)}` : null].filter(Boolean).join(', ')
    || 'Not sent by text or e-mail: the agent gave the link to the signer directly';
  const made = [];
  try {
    for (const d of docs) {
      const prepared = await getFile(storage, d.prepared_key);
      if (sha256(prepared) !== d.prepared_sha256) throw new SignError(409, 'document_changed');
      const cert = await certificatePdf({
        document_name: d.name, prepared_sha256: d.prepared_sha256, signer_name: signer.name, typed_name: typed,
        role: signer.role === 'defendant' ? 'defendant' : 'indemnitor', sent_to: sentTo, events: timeline(d),
        ip, user_agent: ua, consent_lines: CONSENT_LINES, consent_lang: LANG_NAMES[lang] || 'English', agency: ctx.agency.agency,
        bond_label: `${ctx.bond.defendant_name}${ctx.bond.case_number ? `, case ${ctx.bond.case_number}` : ''} (Bond Desk #${ctx.bond.id})`,
      });
      let signed;
      try {
        signed = await signPdf(prepared, signatureValues(d.field_map, { typedName: typed, signedDate: todayInZone(ctx.agency.tz, signedAt) }), cert);
      } catch (e) {
        if (e instanceof PdfError) throw new SignError(409, 'form_problem', { form: d.name, field: e.detail || null, reason: e.code });
        throw e;
      }
      made.push({ doc: d, key: await putFile(storage, signed), sha: sha256(signed) });
    }
  } catch (e) {
    for (const m of made) await storage.remove(m.key).catch(() => {});
    throw e;
  }
  let won;
  try { won = await db.transaction(async (tx) => {
    const pk = await tx.get('SELECT status FROM bd_packets WHERE id = ? FOR UPDATE', [packet.id]);
    if (pk.status === 'voided') throw new SignError(410, 'packet_voided');
    const c = await tx.run(
      `UPDATE bd_signers SET status = 'signed', signed_at = ?, typed_name = ?, sign_ip = ?, sign_user_agent = ?, consent_version = ?,
              token_expires_at = GREATEST(token_expires_at, ?::timestamptz + INTERVAL '60 days')
        WHERE id = ? AND status NOT IN ('signed', 'declined') AND prepared_at IS NOT NULL`,
      [signedAt.toISOString(), typed, ip || null, ua ? String(ua).slice(0, 300) : null, CONSENT_VERSION, signedAt.toISOString(), signer.id]);
    if (!c.changes) return false;
    for (const m of made) {
      await tx.run(`UPDATE bd_documents SET status = 'signed', signed_key = ?, signed_sha256 = ? WHERE id = ?`, [m.key, m.sha, m.doc.id]);
    }
    await event(tx, { packetId: packet.id, signerId: signer.id, event: 'signed', detail: lang, ip, ua });
    await refreshPacketStatus(tx, packet.id);
    return true;
  }); } catch (e) {
    for (const m of made) await storage.remove(m.key).catch(() => {});
    throw e;
  }
  if (!won) {
    for (const m of made) await storage.remove(m.key).catch(() => {});
    throw new SignError(409, 'already_signed');
  }
  return { signed_at: signedAt.toISOString() };
}

/**
 * The signer opened the link / a document. Writing these on a GET is deliberate: the
 * signature certificate must show when each document was opened (an audit record of the view
 * itself). First time only.
 */
export async function markOpened(db, { packet, signer, ip, ua }) {
  const c = await db.run(`UPDATE bd_signers SET opened_at = NOW(), status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
                           WHERE id = ? AND opened_at IS NULL AND status NOT IN ('signed','declined')`, [signer.id]);
  if (c.changes) {
    await event(db, { packetId: packet.id, signerId: signer.id, event: 'opened', ip, ua });
    await refreshPacketStatus(db, packet.id);
  }
}
export async function markViewed(db, { packet, signer, docId, ip, ua }) {
  const c = await db.run('UPDATE bd_documents SET viewed_at = NOW() WHERE id = ? AND signer_id = ? AND viewed_at IS NULL', [docId, signer.id]);
  if (c.changes) await event(db, { packetId: packet.id, signerId: signer.id, event: 'viewed', detail: String(docId), ip, ua });
}

const LANG_NAMES = { en: 'English', es: 'Spanish', pt: 'Portuguese', vi: 'Vietnamese' };
const LABEL = { sent: 'Signing link sent', link_rotated: 'New signing link sent', opened: 'Signing link opened' };

/** completed when every signer signed; otherwise in_progress once anyone started. */
export async function refreshPacketStatus(db, packetId) {
  const p = await db.get('SELECT status FROM bd_packets WHERE id = ?', [packetId]);
  if (!p || p.status === 'voided') return;
  const s = await db.get(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'signed')::int AS signed,
                                 COUNT(*) FILTER (WHERE status <> 'sent')::int AS started FROM bd_signers WHERE packet_id = ?`, [packetId]);
  if (s.n > 0 && s.signed === s.n) {
    await db.run(`UPDATE bd_packets SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = ? AND status <> 'voided'`, [packetId]);
  } else if (s.started > 0) {
    await db.run(`UPDATE bd_packets SET status = 'in_progress' WHERE id = ? AND status = 'sent'`, [packetId]);
  }
}
