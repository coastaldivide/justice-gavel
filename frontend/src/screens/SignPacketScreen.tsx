/**
 * SignPacketScreen — the page a defendant or indemnitor opens from the link a
 * bail agent sent (https://justicegavel.app/sign/<token>). No account needed;
 * it works signed out, browsing or signed in (a root-level route, like the
 * password-reset link).
 *
 *   1. Questions   the agency's intake questions (basic / full / custom)
 *   2. Documents   the photos or files the agency asked for (ID front/back,
 *                  a selfie holding the ID — camera — proof of income/address)
 *   3. Prepare     the server fills this signer's own copy of each form
 *   4. Review      every document must be opened before signing
 *   5. Sign        type the full name exactly as shown + agree to sign
 *                  electronically (ESIGN Act consumer disclosure) and to the
 *                  documents. A typed name is the signature — there is no
 *                  drawn / finger signature.
 *   Done           download the signed copies (each with its certificate).
 *
 * The signer can decline instead. Contract: docs/BOND_DESK.md (Signing).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { appendPicked, fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang, getLang } from '../i18n';
import { Btn, Card, Check, Field, Line, Notice, Row, useTextPrompt } from '../components/bondDesk/ui';
import { fmtWhen, nameMatches, tOr } from '../services/bondDesk';

export interface SignInfo {
  agency: { name: string; phone: string | null; license: string | null };
  signer: { name: string; role: 'defendant' | 'indemnitor' };
  status: string; defendant_name: string;
  questions: { key: string; label_key: string | null; label: string | null; required: boolean }[];
  answers: Record<string, string> | null;
  doc_requests: { kind: string; uploaded: boolean }[];
  documents: { id: number; name: string; viewed: boolean }[];
  prepared: boolean; signed_at: string | null;
  consent: { version: string; text_key: string } | null;
}

const MAX_FILE = 10 * 1024 * 1024;
const LINK_ERRORS: Record<string, string> = { link_invalid: 'sgn_link_invalid', link_expired: 'sgn_link_expired', packet_voided: 'sgn_packet_voided' };

/** Which step the signer is on. */
export function signStep(info: SignInfo, answers: Record<string, string>): 'questions' | 'uploads' | 'review' | 'done' | 'declined' {
  if (info.signed_at) return 'done';
  if (info.status === 'declined') return 'declined';
  if (info.prepared) return 'review';
  const missing = info.questions.some(q => q.required && !String(answers[q.key] ?? '').trim());
  const saved = info.questions.every(q => !q.required || String(info.answers?.[q.key] ?? '').trim());
  if (info.questions.length && (missing || !saved)) return 'questions';
  return 'uploads';
}

function SignPacketScreen({ route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const prompt = useTextPrompt();
  const token = String((route?.params as { token?: string } | undefined)?.token || '').trim();
  const base = `/sign/${encodeURIComponent(token)}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [info, setInfo] = useState<SignInfo | null>(null);
  const [linkError, setLinkError] = useState('');
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState('');
  const [agreeEsign, setAgreeEsign] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [editAnswers, setEditAnswers] = useState(false);

  const load = useCallback(async () => {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) { setLinkError(t('sgn_link_invalid')); return; }
    try {
      const r = await api.get<SignInfo>(base);
      if (!mounted.current) return;
      setInfo(r.data); setLinkError('');
      setAnswers(prev => ({ ...(r.data.answers || {}), ...prev }));
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { code?: string; error?: string } } };
      const code = err?.response?.data?.code || err?.response?.data?.error || '';
      if (mounted.current) {
        if (LINK_ERRORS[code]) setLinkError(t(LINK_ERRORS[code]));
        else if (err?.response?.status === 404) setLinkError(t('sgn_link_invalid'));
        else if (err?.response?.status === 410) setLinkError(t('sgn_link_expired'));
        else setError(apiErrorMessage(e, t('sgn_load_failed')));
      }
    }
  }, [base, token]);
  useEffect(() => { load(); }, [load]);

  const qLabel = (q: SignInfo['questions'][number]) => (q.label_key ? tOr(q.label_key, q.label || q.key) : (q.label || tOr(`sgn_q_${q.key}`, q.key)));

  const saveAnswers = async () => {
    if (!info) return;
    const missing = info.questions.filter(q => q.required && !String(answers[q.key] ?? '').trim());
    if (missing.length) { setError(t('sgn_answer_required', { q: qLabel(missing[0]) })); return; }
    setBusy('answers'); setError('');
    try {
      const body: Record<string, string> = {};
      for (const q of info.questions) body[q.key] = String(answers[q.key] ?? '').trim();
      await api.post(`${base}/answers`, { answers: body });
      setEditAnswers(false); await load();
    } catch (e) { setError(apiErrorMessage(e, t('sgn_save_failed'))); } finally { if (mounted.current) setBusy(null); }
  };

  const sendFile = async (kind: string, file: { uri: string; name: string; type: string; size?: number | null }) => {
    if (file.size && file.size > MAX_FILE) { showToast(t('sgn_file_too_big'), 'error'); return; }
    if (!/^(image\/(jpeg|png|heic|heif)|application\/pdf)$/.test(file.type)) { showToast(t('sgn_file_type'), 'error'); return; }
    setBusy(`up-${kind}`);
    try {
      const form = new FormData();
      await appendPicked(form, 'file', file);
      form.append('kind', kind);
      await api.post(`${base}/uploads`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      showToast(t('sgn_uploaded'), 'success'); await load();
    } catch (e) { showToast(apiErrorMessage(e, t('sgn_upload_failed')), 'error'); } finally { if (mounted.current) setBusy(null); }
  };
  const takePhoto = async (kind: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { showToast(t('sgn_camera_needed'), 'error'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false,
      cameraType: kind === 'selfie_with_id' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    await sendFile(kind, { uri: a.uri, name: a.fileName || `${kind}.jpg`, type: a.mimeType || 'image/jpeg', size: a.fileSize ?? null });
  };
  const chooseFile = async (kind: string) => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    await sendFile(kind, { uri: a.uri, name: a.name || kind, type: a.mimeType || 'application/octet-stream', size: a.size ?? null });
  };

  const prepare = async () => {
    setBusy('prepare'); setError('');
    try { await api.post(`${base}/prepare`); await load(); }
    catch (e) { setError(apiErrorMessage(e, t('sgn_prepare_failed'))); } finally { if (mounted.current) setBusy(null); }
  };

  const openDoc = async (d: SignInfo['documents'][number]) => {
    setBusy(`doc-${d.id}`);
    try {
      await fetchFile(`${base}/documents/${d.id}.pdf`, `${d.name}.pdf`, 'application/pdf', 'view');
      setViewed(v => new Set(v).add(d.id));
    } catch (e) { showToast(apiErrorMessage(e, t('sgn_open_failed')), 'error'); } finally { if (mounted.current) setBusy(null); }
  };

  const sign = async () => {
    if (!info) return;
    setBusy('sign'); setError('');
    try {
      await api.post(`${base}/sign`, { typed_name: typed.trim(), agree_esign: true, agree_terms: true, lang: getLang() });
      await load();
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      const c = code?.code || code?.error;
      setError(c === 'not_viewed' ? t('sgn_err_not_viewed') : c === 'name_mismatch' ? t('sgn_err_name', { name: info.signer.name }) : apiErrorMessage(e, t('sgn_sign_failed')));
      if (c === 'not_viewed') load();
    } finally { if (mounted.current) setBusy(null); }
  };

  const decline = async () => {
    if (!(await confirm(t('sgn_decline_title'), t('sgn_decline_body'), { confirmLabel: t('sgn_decline'), destructive: true }))) return;
    const reason = await prompt.ask(t('sgn_decline_title'), t('sgn_decline_reason'), { required: false });
    if (reason === null) return;
    setBusy('decline');
    try { await api.post(`${base}/decline`, { reason }); await load(); }
    catch (e) { setError(apiErrorMessage(e, t('sgn_save_failed'))); } finally { if (mounted.current) setBusy(null); }
  };

  const downloadSigned = async () => {
    try { await fetchFile(`${base}/signed.pdf`, 'signed-bail-documents.pdf', 'application/pdf', 'download'); }
    catch (e) { showToast(apiErrorMessage(e, t('sgn_open_failed')), 'error'); }
  };

  if (linkError) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} testID="sign-packet-screen">
        <Card title={t('sgn_title')} testID="sign-link-error"><Line tone="danger">{linkError}</Line><Line muted>{t('sgn_ask_agent')}</Line></Card>
      </ScrollView>
    );
  }
  if (!info) {
    return (
      <View style={[s.center, { backgroundColor: colors.bg }]} testID="sign-packet-screen">
        {error ? <Card><Line tone="danger">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></Card> : <ActivityIndicator size="large" color={colors.textBrand} />}
      </View>
    );
  }

  const step = editAnswers ? 'questions' : signStep(info, answers);
  const missingUploads = info.doc_requests.filter(d => !d.uploaded);
  const allViewed = info.documents.length > 0 && info.documents.every(d => d.viewed || viewed.has(d.id));
  const nameOk = nameMatches(typed, info.signer.name);
  const canSign = allViewed && nameOk && agreeEsign && agreeTerms;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      {prompt.element}
      <ScrollView testID="sign-packet-screen" contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('sgn_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('sgn_from_agency', { agency: info.agency.name })}</Text>
        </View>
        <Card testID="sign-who">
          <Row label={t('sgn_signer')} value={info.signer.name} testID="sign-signer-name" />
          <Row label={t('sgn_role')} value={t(`bdk_role_${info.signer.role}`)} />
          <Row label={t('sgn_defendant')} value={info.defendant_name} />
          {!!info.agency.phone && <Row label={t('sgn_agency_phone')} value={info.agency.phone} />}
          {!!info.agency.license && <Row label={t('sgn_agency_license')} value={info.agency.license} />}
        </Card>
        {!!error && <Notice text={error} tone="error" testID="sign-error" />}

        {step === 'done' && (
          <Card title={t('sgn_done_title')} testID="sign-done">
            <Line tone="ok">{t('sgn_done_body', { when: fmtWhen(info.signed_at) })}</Line>
            <Btn label={t('sgn_download_signed')} onPress={downloadSigned} testID="sign-download" />
            <Line muted>{t('sgn_keep_copy')}</Line>
          </Card>
        )}
        {step === 'declined' && (
          <Card title={t('sgn_declined_title')} testID="sign-declined"><Line>{t('sgn_declined_body', { agency: info.agency.name })}</Line></Card>
        )}

        {step === 'questions' && (
          <Card title={t('sgn_step_questions')} testID="sign-questions">
            <Line muted>{t('sgn_questions_help')}</Line>
            {info.questions.map(q => (
              <Field key={q.key} label={`${qLabel(q)}${q.required ? ' *' : ''}`} value={answers[q.key] ?? ''} testID={`sign-q-${q.key}`} maxLength={500}
                onChangeText={v => setAnswers(p => ({ ...p, [q.key]: v }))} />
            ))}
            <Btn label={t('sgn_continue')} onPress={saveAnswers} busy={busy === 'answers'} testID="sign-answers-save" />
          </Card>
        )}

        {step === 'uploads' && (
          <>
            {info.doc_requests.length > 0 && (
              <Card title={t('sgn_step_uploads')} testID="sign-uploads">
                <Line muted>{t('sgn_uploads_help')}</Line>
                {info.doc_requests.map(d => (
                  <View key={d.kind} style={s.block} testID={`sign-up-${d.kind}`}>
                    <Line strong>{tOr(`bdk_doc_${d.kind}`, d.kind)}</Line>
                    {d.kind === 'selfie_with_id' && <Line muted>{t('sgn_selfie_help')}</Line>}
                    <Line tone={d.uploaded ? 'ok' : 'warn'}>{d.uploaded ? t('sgn_uploaded_state') : t('sgn_needed_state')}</Line>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Btn kind={d.uploaded ? 'ghost' : 'primary'} label={t('sgn_take_photo')} onPress={() => takePhoto(d.kind)} busy={busy === `up-${d.kind}`} testID={`sign-photo-${d.kind}`} />
                      {d.kind !== 'selfie_with_id' && <Btn kind="ghost" label={t('sgn_choose_file')} onPress={() => chooseFile(d.kind)} disabled={busy === `up-${d.kind}`} testID={`sign-file-${d.kind}`} />}
                    </View>
                  </View>
                ))}
              </Card>
            )}
            <Card title={t('sgn_step_prepare')} testID="sign-prepare">
              {missingUploads.length > 0 && <Line tone="warn">{t('sgn_uploads_missing', { n: missingUploads.length })}</Line>}
              <Line muted>{t('sgn_prepare_help')}</Line>
              <Btn label={t('sgn_prepare')} onPress={prepare} busy={busy === 'prepare'} disabled={missingUploads.length > 0} testID="sign-prepare-btn" />
              {info.questions.length > 0 && <Btn kind="ghost" label={t('sgn_edit_answers')} onPress={() => setEditAnswers(true)} testID="sign-edit-answers" />}
            </Card>
          </>
        )}

        {step === 'review' && (
          <>
            <Card title={t('sgn_step_review')} testID="sign-review">
              <Line muted>{t('sgn_review_help')}</Line>
              {info.documents.map(d => {
                const seen = d.viewed || viewed.has(d.id);
                return (
                  <View key={d.id} style={s.block}>
                    <Line strong>{d.name}</Line>
                    <Line tone={seen ? 'ok' : 'warn'} testID={`sign-doc-state-${d.id}`}>{seen ? t('sgn_doc_opened') : t('sgn_doc_not_opened')}</Line>
                    <Btn kind={seen ? 'ghost' : 'primary'} label={t('sgn_open_doc')} onPress={() => openDoc(d)} busy={busy === `doc-${d.id}`} testID={`sign-doc-${d.id}`} />
                  </View>
                );
              })}
            </Card>
            <Card title={t('sgn_step_sign')} testID="sign-sign">
              <Text maxFontSizeMultiplier={1.4} style={s.consent} testID="sign-esign-text">{tOr(info.consent?.text_key || 'sgn_esign_consent', t('sgn_esign_consent'))}</Text>
              <Check label={t('sgn_agree_esign')} value={agreeEsign} onChange={setAgreeEsign} testID="sign-agree-esign" />
              <Check label={t('sgn_agree_terms')} value={agreeTerms} onChange={setAgreeTerms} testID="sign-agree-terms" />
              <Field label={t('sgn_type_name', { name: info.signer.name })} value={typed} onChangeText={setTyped} testID="sign-typed-name" autoCapitalize="words" maxLength={200} />
              {!!typed.trim() && !nameOk && <Line tone="warn" testID="sign-name-mismatch">{t('sgn_err_name', { name: info.signer.name })}</Line>}
              {!allViewed && <Line tone="warn" testID="sign-need-view">{t('sgn_err_not_viewed')}</Line>}
              {nameOk && <Text maxFontSizeMultiplier={1.4} style={s.typedSig} testID="sign-typed-preview">/s/ {typed.trim()}</Text>}
              <Btn label={t('sgn_sign_now')} onPress={sign} disabled={!canSign} busy={busy === 'sign'} testID="sign-submit" />
              <Line muted>{t('sgn_sign_legal')}</Line>
            </Card>
          </>
        )}

        {(step === 'questions' || step === 'uploads' || step === 'review') && (
          <Card>
            <Btn kind="danger" label={t('sgn_decline')} onPress={decline} busy={busy === 'decline'} testID="sign-decline" />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 14, lineHeight: 20, marginTop: 4 },
  block: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  consent: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 4 },
  typedSig: { fontSize: 20, ...FONTS.semiBold, color: colors.textPrimary, marginTop: 10, fontStyle: 'italic' },
});

export default React.memo(SignPacketScreen);
