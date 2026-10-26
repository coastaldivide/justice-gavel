/**
 * Paperwork on a bond: send the agency's forms to the defendant and each
 * indemnitor to sign by link (typed-name e-signature — no drawn signature),
 * then follow each signer (sent → opened → in progress → signed), resend a
 * link, void a packet, and download the signed copies and uploaded IDs.
 *
 * Links are shown once, right after sending or after "new link" (the server
 * keeps only a hash), with a copy button so the agent can also hand the link
 * over in person or open it on an office tablet.
 */
import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api, apiErrorMessage } from '../../services/api';
import { fetchFile } from '../../services/fileDownload';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../../hooks/useConfirm';
import { useTheme } from '../../constants/theme';
import { t, useLang } from '../../i18n';
import { Btn, Card, Check, Chips, Field, Line, Pill, useTextPrompt } from './ui';
import {
  type Access, type BondDetail, type BondForm, type CreatedSigner, type Delivery, type DocRequest, type PacketDetail, type SignerStatus,
  DOC_REQUESTS, fmtWhen, tOr,
} from '../../services/bondDesk';

const signerTone: Record<SignerStatus, 'muted' | 'ok' | 'warn' | 'danger'> = { sent: 'muted', opened: 'warn', in_progress: 'warn', signed: 'ok', declined: 'danger' };

/** The POST body for a new packet, or an i18n error key. */
export function packetBody(p: { formIds: number[]; signers: string[]; questions: string; custom: string; docs: DocRequest[]; deliver: Delivery; consent: boolean }) {
  if (!p.formIds.length) return { error: 'bdk_err_pick_form' };
  if (!p.signers.length) return { error: 'bdk_err_pick_signer' };
  const custom = p.custom.split('\n').map(s => s.trim()).filter(Boolean);
  if (custom.length > 10) return { error: 'bdk_err_custom_count' };
  if (custom.some(q => q.length > 200)) return { error: 'bdk_err_custom_long' };
  if ((p.deliver === 'sms' || p.deliver === 'both') && !p.consent) return { error: 'bdk_err_consent' };
  return {
    body: {
      form_ids: p.formIds,
      signers: p.signers.map(k => (k === 'defendant' ? { role: 'defendant' } : { role: 'indemnitor', indemnitor_id: Number(k) })),
      questions: p.questions, custom_questions: custom, doc_requests: p.docs, deliver: p.deliver, consent_confirmed: p.consent,
    },
  };
}

export function PaperworkSection({ detail, reload, access }: { detail: BondDetail; reload: () => Promise<void>; access: Access | null }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const prompt = useTextPrompt();
  const b = detail.bond;

  const [forms, setForms] = useState<BondForm[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [formIds, setFormIds] = useState<number[]>([]);
  const [signers, setSigners] = useState<string[]>(['defendant']);
  const [questions, setQuestions] = useState<'none' | 'basic' | 'full'>('basic');
  const [custom, setCustom] = useState('');
  const [docs, setDocs] = useState<DocRequest[]>(['id_front', 'selfie_with_id']);
  const [deliver, setDeliver] = useState<Delivery>('both');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<CreatedSigner[] | null>(null);
  const [packet, setPacket] = useState<PacketDetail | null>(null);
  const [packetErr, setPacketErr] = useState('');
  const [resendBy, setResendBy] = useState<Delivery>('none');
  const [resendConsent, setResendConsent] = useState(false);

  const startCompose = async () => {
    setErr(''); setLinks(null); setComposing(true);
    try {
      const r = await api.get<{ forms: BondForm[] }>('/bond-desk/forms');
      setForms((r.data?.forms || []).filter(f => !f.archived));
    } catch (e) { setErr(apiErrorMessage(e, t('bdk_load_failed'))); setForms([]); }
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const send = async () => {
    const { body, error } = packetBody({ formIds, signers, questions, custom, docs, deliver, consent });
    if (error) { setErr(t(error)); return; }
    setBusy('send'); setErr('');
    try {
      const r = await api.post<{ packet: { id: number }; signers: CreatedSigner[] }>(`/bond-desk/bonds/${b.id}/packets`, body);
      setComposing(false); setLinks(r.data.signers || []); showToast(t('bdk_packet_sent'), 'success'); await reload();
    } catch (e) { setErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  const openPacket = async (id: number) => {
    setPacketErr('');
    try { const r = await api.get<PacketDetail>(`/bond-desk/packets/${id}`); setPacket(r.data); }
    catch (e) { setPacketErr(apiErrorMessage(e, t('bdk_load_failed'))); }
  };

  const newLink = async (signerId: number) => {
    if (!packet) return;
    if ((resendBy === 'sms' || resendBy === 'both') && !resendConsent) { showToast(t('bdk_err_consent'), 'error'); return; }
    setBusy(`link-${signerId}`);
    try {
      const r = await api.post<CreatedSigner>(`/bond-desk/packets/${packet.packet.id}/signers/${signerId}/link`, { deliver: resendBy, consent_confirmed: resendConsent });
      setLinks([r.data]); showToast(t('bdk_new_link_made'), 'success'); await openPacket(packet.packet.id);
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { setBusy(null); }
  };
  const voidPacket = async () => {
    if (!packet) return;
    const reason = await prompt.ask(t('bdk_void_packet_title'), t('bdk_void_reason'));
    if (!reason) return;
    try { await api.post(`/bond-desk/packets/${packet.packet.id}/void`, { reason }); showToast(t('bdk_voided'), 'success'); await openPacket(packet.packet.id); await reload(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };
  const download = async (url: string, name: string, mime = 'application/pdf') => {
    try { await fetchFile(url, name, mime, mime === 'application/pdf' ? 'view' : 'download'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };
  const copy = async (link: string) => {
    try { await Clipboard.setStringAsync(link); showToast(t('bdk_link_copied'), 'success'); }
    catch { showToast(t('bdk_copy_failed'), 'error'); }
  };

  const signerOptions = [{ key: 'defendant', label: t('bdk_role_defendant_named', { name: b.defendant_name }) },
    ...detail.indemnitors.map(i => ({ key: String(i.id), label: t('bdk_role_indemnitor_named', { name: i.full_name }) }))];

  return (
    <>
      {prompt.element}
      {!!links?.length && (
        <Card title={t('bdk_links_title')} testID="packet-links">
          <Line muted>{t('bdk_links_help')}</Line>
          {links.map(l => (
            <View key={l.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }} testID={`packet-link-${l.id}`}>
              <Line strong>{l.name} · {t(`bdk_role_${l.role}`)}</Line>
              <Line muted>{l.link}</Line>
              {!!l.delivery && <Line>{t('bdk_delivery_line', { sms: (l.delivery.sms ? t(`bdk_dl_${l.delivery.sms}`) : '—'), email: (l.delivery.email ? t(`bdk_dl_${l.delivery.email}`) : '—') })}</Line>}
              <Btn kind="ghost" label={t('bdk_copy_link')} onPress={() => copy(l.link)} testID={`packet-copy-${l.id}`} />
            </View>
          ))}
          <Btn kind="ghost" label={t('bdk_done')} onPress={() => setLinks(null)} />
        </Card>
      )}

      <Card title={t('bdk_paperwork')} testID="bond-paperwork">
        {!detail.packets.length && <Line muted>{t('bdk_packets_none')}</Line>}
        {detail.packets.map(p => (
          <TouchableOpacity key={p.id} accessibilityRole="button" testID={`packet-${p.id}`} onPress={() => openPacket(p.id)}
            style={{ minHeight: 44, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Line strong>{t('bdk_packet_n', { n: p.id })} · {fmtWhen(p.created_at)}</Line>
            <Pill text={t(`bdk_ps_${p.status}`)} tone={p.status === 'completed' ? 'ok' : p.status === 'voided' ? 'danger' : 'warn'} />
          </TouchableOpacity>
        ))}
        {!!packetErr && <Line tone="danger">{packetErr}</Line>}
        {!composing && <Btn label={t('bdk_send_paperwork')} onPress={startCompose} testID="packet-compose" />}
      </Card>

      {composing && (
        <Card title={t('bdk_send_paperwork')} testID="packet-form">
          <Line strong>{t('bdk_pick_forms')}</Line>
          {forms === null ? <Line muted>{t('bdk_loading')}</Line> : !forms.length ? <Line tone="warn" testID="packet-no-forms">{t('bdk_no_forms_yet')}</Line> : (
            <Chips multi options={forms.map(f => ({ key: String(f.id), label: `${f.name} (${f.roles.map(r => t(`bdk_role_${r}`)).join(', ')})` }))}
              value={formIds.map(String)} onChange={k => setFormIds(p => toggle(p, Number(k)))} testIDPrefix="packet-form" />
          )}
          <Line strong>{t('bdk_pick_signers')}</Line>
          <Chips multi options={signerOptions} value={signers} onChange={k => setSigners(p => toggle(p, k))} testIDPrefix="packet-signer" />
          <Line muted>{t('bdk_counterparts_help')}</Line>
          <Line strong>{t('bdk_questions')}</Line>
          <Chips options={(['none', 'basic', 'full'] as const).map(k => ({ key: k, label: t(`bdk_q_${k}`) }))} value={questions} onChange={setQuestions} testIDPrefix="packet-q" />
          <Field label={t('bdk_custom_questions')} value={custom} onChangeText={setCustom} multiline maxLength={2200} testID="packet-custom" placeholder={t('bdk_custom_ph')} />
          <Line strong>{t('bdk_doc_requests')}</Line>
          <Chips multi options={DOC_REQUESTS.map(k => ({ key: k, label: t(`bdk_doc_${k}`) }))} value={docs} onChange={k => setDocs(p => toggle(p, k))} testIDPrefix="packet-doc" />
          <Line strong>{t('bdk_deliver')}</Line>
          <Chips options={(['sms', 'email', 'both', 'none'] as const).map(k => ({ key: k, label: t(`bdk_deliver_${k}`) }))} value={deliver} onChange={setDeliver} testIDPrefix="packet-deliver" />
          {(deliver === 'sms' || deliver === 'both') && (
            <>
              <Line muted>{t('bdk_text_cost', { cost: `${access?.text_cents ?? 5}¢` })}</Line>
              {!access?.texts_live && <Line tone="warn">{t('bdk_texts_off')}</Line>}
              <Check label={t('bdk_consent_text')} value={consent} onChange={setConsent} testID="packet-consent" />
            </>
          )}
          {!!err && <Line tone="danger" testID="packet-error">{err}</Line>}
          <Btn label={t('bdk_send')} onPress={send} busy={busy === 'send'} testID="packet-send" />
          <Btn kind="ghost" label={t('cancel')} onPress={() => setComposing(false)} />
        </Card>
      )}

      {packet && (
        <Card title={t('bdk_packet_n', { n: packet.packet.id })} testID="packet-detail">
          <Pill text={t(`bdk_ps_${packet.packet.status}`)} tone={packet.packet.status === 'completed' ? 'ok' : packet.packet.status === 'voided' ? 'danger' : 'warn'} />
          {packet.packet.status !== 'voided' && packet.packet.status !== 'completed' && (
            <>
              <Line muted>{t('bdk_resend_by')}</Line>
              <Chips options={(['sms', 'email', 'both', 'none'] as const).map(k => ({ key: k, label: t(`bdk_deliver_${k}`) }))} value={resendBy} onChange={setResendBy} testIDPrefix="resend-by" />
              {(resendBy === 'sms' || resendBy === 'both') && <Check label={t('bdk_consent_text')} value={resendConsent} onChange={setResendConsent} testID="resend-consent" />}
            </>
          )}
          {packet.signers.map(sg => (
            <View key={sg.id} testID={`signer-${sg.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Line strong>{sg.name} · {t(`bdk_role_${sg.role}`)}</Line>
              <Pill text={t(`bdk_ss_${sg.status}`)} tone={signerTone[sg.status]} />
              {!!sg.declined_reason && <Line tone="danger">{t('bdk_declined_reason', { reason: sg.declined_reason })}</Line>}
              {sg.events.map((ev, i) => <Line key={i} muted>{fmtWhen(ev.at)} · {tOr(`bdk_ev_${ev.event}`, ev.event, { detail: ev.detail ?? '' })}</Line>)}
              {!!sg.answers && Object.keys(sg.answers).length > 0 && (
                <View style={{ marginTop: 4 }}>
                  {Object.entries(sg.answers).map(([k, v]) => <Line key={k}>{tOr(`sgn_q_${k}`, k)}: {v}</Line>)}
                </View>
              )}
              {packet.documents.filter(d => d.signer_id === sg.id).map(d => (
                <Btn key={d.id} kind="ghost" label={`${d.name} (${t(`bdk_ds_${d.status}`)})`} disabled={d.status === 'pending'}
                  onPress={() => download(`/bond-desk/documents/${d.id}.pdf`, `${d.name}.pdf`)} testID={`doc-${d.id}`} />
              ))}
              {packet.uploads.filter(u => u.signer_id === sg.id).map(u => (
                <Btn key={u.id} kind="ghost" label={t('bdk_open_upload', { kind: tOr(`bdk_doc_${u.kind}`, u.kind) })}
                  onPress={() => download(`/bond-desk/uploads/${u.id}`, `${u.kind}-${u.id}${u.content_type === 'application/pdf' ? '.pdf' : u.content_type === 'image/png' ? '.png' : '.jpg'}`, u.content_type)} testID={`upload-${u.id}`} />
              ))}
              {packet.packet.status !== 'voided' && sg.status !== 'signed' && (
                <Btn kind="ghost" label={t('bdk_new_link')} onPress={() => newLink(sg.id)} busy={busy === `link-${sg.id}`} testID={`signer-link-${sg.id}`} />
              )}
            </View>
          ))}
          {packet.packet.status === 'completed' && (
            <Btn label={t('bdk_download_signed')} onPress={() => download(`/bond-desk/packets/${packet.packet.id}/signed.pdf`, `packet-${packet.packet.id}-signed.pdf`)} testID="packet-download" />
          )}
          {packet.packet.status !== 'voided' && packet.packet.status !== 'completed' && (
            <Btn kind="danger" label={t('bdk_void_packet')} testID="packet-void" onPress={async () => {
              if (await confirm(t('bdk_void_packet_title'), t('bdk_void_packet_body'), { confirmLabel: t('bdk_void'), destructive: true })) voidPacket();
            }} />
          )}
          <Btn kind="ghost" label={t('bdk_close')} onPress={() => setPacket(null)} testID="packet-close" />
        </Card>
      )}
    </>
  );
}
