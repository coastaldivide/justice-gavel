/**
 * CourtPaperScreen — "Read my court paper" (AI step 4; docs/AI_PLATFORM.md §11).
 *
 *   1. The person takes a photo of a court paper, or chooses a photo or a PDF — or a document
 *      already attached to the case (route param caseId).
 *   2. The server reads it (POST /court-papers/read | read-attachment) into PROPOSED lines: date,
 *      time, court, address, courtroom, case number, judge, kind of hearing, what to bring — each
 *      with the exact words it was read from and a confidence flag.
 *   3. Review: every line is an editable field pre-filled with what was read, the words from the
 *      paper under it. "We read this from your paper. Check every line against the paper before
 *      saving." Nothing is saved until "Save court date": the ordinary POST /court-dates (reminders
 *      as usual). The paper is attached to the case only if the person turns that on.
 *   Not a court paper / unreadable → a clear message, nothing saved, "Add the date by hand".
 * Information, not advice: the app copies what the paper says; it does not say what to do.
 *
 * Navigation params: caseId?, caseTitle?
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage, unwrapList, deviceTimeZone } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { HEARING_TYPES, hearingLabel, saveCoreProgress } from '../services/corePath';
import { getUserState } from '../utils/userState';
import {
  attachToCase, checkForm, courtDateBody, formFromRead, preparePhoto, readCaseDocument, readPaperFile,
  type Confidence, type PaperForm, type PaperRead, type PaperStatus, type PickedFile,
} from '../services/courtPaper';

type Phase = 'choose' | 'reading' | 'result';
type LineKey = Exclude<keyof PaperForm, 'hearing_type' | 'bring'>;
const LINES: { key: LineKey; max: number; keyboard?: 'numbers-and-punctuation' }[] = [
  { key: 'court_date', max: 10, keyboard: 'numbers-and-punctuation' }, { key: 'court_time', max: 5, keyboard: 'numbers-and-punctuation' },
  { key: 'court_name', max: 150 }, { key: 'court_address', max: 200 }, { key: 'courtroom', max: 60 },
  { key: 'case_number', max: 60 }, { key: 'judge', max: 120 },
];
const CONF_TONE: Record<Confidence, 'ok' | 'warn' | 'danger' | 'muted'> = { high: 'ok', medium: 'warn', low: 'danger', not_found: 'muted' };
interface CaseDoc { attachment_id: number; attachment_name: string | null; attachment_type: string | null }

export function ConfidencePill({ c }: { c: Confidence }) {
  return <Pill text={t(`cpr_conf_${c}`)} tone={CONF_TONE[c]} />;
}

function CourtPaperScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const params = (route?.params ?? {}) as { caseId?: number | string };
  const routeCase = Number(params.caseId) > 0 ? Number(params.caseId) : null;
  const { hasSession, recheck } = useHasSession();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [status, setStatus] = useState<PaperStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [read, setRead] = useState<PaperRead | null>(null);
  const [form, setForm] = useState<PaperForm | null>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [docs, setDocs] = useState<CaseDoc[]>([]);
  const [cases, setCases] = useState<{ id: number; title: string }[]>([]);
  const [caseId, setCaseId] = useState<number | null>(routeCase);
  const [caseTitle, setCaseTitle] = useState('');
  const [attach, setAttach] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const st = await api.get<PaperStatus>('/court-papers/status');
      if (mounted.current) setStatus(st.data);
    } catch { if (mounted.current) setStatus({ enabled: false, max_mb: 8, max_pages: 10, types: [], reads_left_today: 0 }); }
    api.get('/cases').then(r => { if (mounted.current) { const rows = unwrapList<{ id: number; title: string }>(r.data, 'cases'); setCases(rows); if (!routeCase && rows.length === 1) setCaseId(rows[0].id); } }).catch(() => {});
    if (routeCase) {
      api.get<{ messages: CaseDoc[] }>(`/messages/${routeCase}`, { params: { limit: 100 } })
        .then(r => { if (mounted.current) setDocs((r.data?.messages || []).filter(m => m.attachment_id && /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(m.attachment_type || '')).reverse()); })
        .catch(() => {});
    }
  }, [routeCase]);
  useEffect(() => { if (hasSession) load(); }, [hasSession, load]);

  const run = async (fn: () => Promise<PaperRead>, picked: PickedFile | null) => {
    setPhase('reading'); setError(''); setFile(picked); setAttach(false);
    try {
      const r = await fn();
      if (!mounted.current) return;
      setRead(r); setForm(r.result === 'read' ? formFromRead(r) : null);
      if (r.case_id) setCaseId(r.case_id);
      setPhase('result');
    } catch (e) {
      if (!mounted.current) return;
      setError(apiErrorMessage(e, t('cpr_read_failed'))); setPhase('choose');
    }
  };
  const tooBig = (size?: number | null) => !!size && !!status && size > status.max_mb * 1024 * 1024;

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { setError(t('cpr_camera_needed')); Linking.openSettings().catch(() => {}); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false });
    if (r.canceled || !r.assets?.length) return;
    const p = await preparePhoto(r.assets[0]);
    run(() => readPaperFile(p), p);
  };
  const pick = async (kind: 'photo' | 'pdf') => {
    const r = await DocumentPicker.getDocumentAsync({ type: kind === 'pdf' ? 'application/pdf' : 'image/*', copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if (tooBig(a.size)) { setError(t('cpr_too_big', { mb: status?.max_mb ?? 8 })); return; }
    const p: PickedFile = kind === 'pdf'
      ? { uri: a.uri, name: a.name || 'court-paper.pdf', type: 'application/pdf', size: a.size }
      : await preparePhoto({ uri: a.uri });
    run(() => readPaperFile(p), p);
  };

  const save = async () => {
    if (!form || saving) return;
    const problem = checkForm(form, { caseId, caseTitle });
    if (problem) { setError(t(`cpr_err_${problem}`)); return; }
    setSaving(true); setError('');
    try {
      const st = (await getUserState())?.code ?? null;
      const tz = deviceTimeZone();
      const r = await api.post<{ id: number; case_id: number }>('/court-dates', courtDateBody(form, { caseId, caseTitle, state: st }), tz ? { headers: { 'X-Timezone': tz } } : undefined);
      saveCoreProgress({ mark: 'court' }).catch(() => {});
      if (attach && file) {
        try { await attachToCase(file, r.data.case_id, t('cpr_attachment_caption')); }
        catch { showToast(t('cpr_attach_failed'), 'warning'); }
      }
      showToast(t('cpr_saved'), 'success');
      (navigation as any).navigate('CourtDateDetail', { id: r.data.id });
    } catch (e: any) {
      setError(e?.response?.status === 409 ? t('cd_err_duplicate') : apiErrorMessage(e, t('cd_save_failed')));
    } finally { if (mounted.current) setSaving(false); }
  };
  const byHand = () => (navigation as any).navigate('CourtDates', { add: true, ...(caseId ? { caseId } : {}) });
  const reset = () => { setPhase('choose'); setRead(null); setForm(null); setFile(null); setError(''); };

  if (hasSession === false) {
    return <SignInNeeded navigation={navigation} title={t('cpr_title')} body={t('cpr_intro')} onSignedIn={recheck} testID="court-paper-sign-in" />;
  }
  if (hasSession === null || !status) return <View style={[s.center, { backgroundColor: colors.bg }]} testID="court-paper-screen"><ActivityIndicator color={colors.textBrand} /></View>;

  return (
    <ScrollView testID="court-paper-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('cpr_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('cpr_intro')}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" testID="court-paper-error" />}

      {!status.enabled && (
        <Card testID="court-paper-off">
          <Line>{t('cpr_unavailable')}</Line>
          <Btn label={t('cpr_by_hand')} onPress={byHand} testID="court-paper-by-hand" />
        </Card>
      )}

      {status.enabled && phase === 'choose' && (
        <Card testID="court-paper-choose">
          <Line muted>{t('cpr_privacy')}</Line>
          {Platform.OS !== 'web' && <Btn label={t('cpr_take_photo')} onPress={takePhoto} testID="court-paper-camera" />}
          <Btn kind={Platform.OS === 'web' ? 'primary' : 'ghost'} label={t('cpr_choose_photo')} onPress={() => pick('photo')} testID="court-paper-photo" />
          <Btn kind="ghost" label={t('cpr_choose_pdf')} onPress={() => pick('pdf')} testID="court-paper-pdf" />
          <Line muted>{t('cpr_limits', { mb: status.max_mb, pages: status.max_pages })}</Line>
          {docs.length > 0 && (
            <>
              <Line strong>{t('cpr_case_docs')}</Line>
              {docs.slice(0, 10).map(d => (
                <Btn key={d.attachment_id} kind="ghost" label={d.attachment_name || t('cpr_attachment_caption')} testID={`court-paper-doc-${d.attachment_id}`}
                  onPress={() => run(() => readCaseDocument(d.attachment_id), null)} />
              ))}
            </>
          )}
          <Btn kind="ghost" label={t('cpr_by_hand')} onPress={byHand} testID="court-paper-by-hand" />
        </Card>
      )}

      {phase === 'reading' && (
        <Card testID="court-paper-reading">
          <ActivityIndicator color={colors.textBrand} />
          <Line>{t('cpr_reading')}</Line>
        </Card>
      )}

      {phase === 'result' && read && read.result !== 'read' && (
        <Card testID="court-paper-not-read">
          <Line>{read.message || t('cpr_read_failed')}</Line>
          <Btn label={t('cpr_start_over')} onPress={reset} testID="court-paper-again" />
          <Btn kind="ghost" label={t('cpr_by_hand')} onPress={byHand} testID="court-paper-by-hand" />
        </Card>
      )}

      {phase === 'result' && read?.result === 'read' && form && (
        <>
          <Notice text={`${t('cpr_notice')} ${t('cpr_info_only')}`} testID="court-paper-notice" />
          {read.warnings.map(w => <Notice key={w} text={t(`cpr_w_${w}`)} tone="error" testID={`court-paper-warning-${w}`} />)}
          <Card testID="court-paper-review">
            {LINES.map(({ key, max, keyboard }) => {
              const f = read.fields?.[key];
              return (
                <View key={key} style={s.line} testID={`court-paper-line-${key}`}>
                  <Field label={t(`cpr_f_${key}`)} value={form[key]} onChangeText={v => setForm({ ...form, [key]: v })} maxLength={max}
                    keyboardType={keyboard} testID={`court-paper-input-${key}`} />
                  <View style={s.source}>
                    {f?.confidence && <ConfidencePill c={f.confidence} />}
                    <Text maxFontSizeMultiplier={1.4} style={s.sourceText} testID={`court-paper-source-${key}`}>
                      {f?.source_text ? t('cpr_from_paper', { text: f.source_text }) : t('cpr_not_on_paper')}
                    </Text>
                  </View>
                </View>
              );
            })}
            <View style={s.line} testID="court-paper-line-hearing_type">
              <Line strong>{t('cpr_f_hearing_type')}</Line>
              <Chips options={HEARING_TYPES.map(h => ({ key: h as string, label: hearingLabel(h) }))} value={form.hearing_type || null}
                onChange={k => setForm({ ...form, hearing_type: form.hearing_type === k ? '' : k })} testIDPrefix="court-paper-hearing" />
              <View style={s.source}>
                {read.fields?.hearing_type?.confidence && <ConfidencePill c={read.fields.hearing_type.confidence} />}
                <Text maxFontSizeMultiplier={1.4} style={s.sourceText}>
                  {read.fields?.hearing_type?.source_text ? t('cpr_from_paper', { text: read.fields.hearing_type.source_text }) : t('cpr_not_on_paper')}
                </Text>
              </View>
            </View>
            <View style={s.line} testID="court-paper-line-bring">
              <Field label={t('cpr_f_bring')} value={form.bring} onChangeText={v => setForm({ ...form, bring: v })} multiline maxLength={1000} testID="court-paper-input-bring" />
              {read.bring.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.sourceText}>{t('cpr_not_on_paper')}</Text>}
              {read.bring.map((b, i) => (
                <View key={i} style={s.source}>
                  <ConfidencePill c={b.confidence} />
                  <Text maxFontSizeMultiplier={1.4} style={s.sourceText}>{t('cpr_from_paper', { text: b.source_text })}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Card title={t('cd_case')} testID="court-paper-case">
            {cases.length > 0 && (
              <Chips options={cases.slice(0, 8).map(c => ({ key: String(c.id), label: c.title }))} value={caseId ? String(caseId) : null}
                onChange={k => setCaseId(caseId === Number(k) ? null : Number(k))} testIDPrefix="court-paper-case" />
            )}
            {!caseId && <Field label={t('cd_name_case')} value={caseTitle} onChangeText={setCaseTitle} placeholder={t('cd_case_placeholder')} maxLength={300} testID="court-paper-case-title" />}
            {!!file && (
              <>
                <Chips options={[{ key: 'attach', label: t('cpr_attach') }]} value={attach ? ['attach'] : []} multi onChange={() => setAttach(v => !v)} testIDPrefix="court-paper-attach" />
                <Line muted>{t('cpr_attach_help')}</Line>
              </>
            )}
          </Card>

          <View style={{ paddingHorizontal: 16 }}>
            <Btn label={t('cpr_save')} onPress={save} busy={saving} testID="court-paper-save" />
            <Btn kind="ghost" label={t('cpr_start_over')} onPress={reset} testID="court-paper-again" />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: c.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, fontWeight: '900', color: c.textOnNavy },
  sub: { color: c.textOnNavy, fontSize: 14, lineHeight: 20, marginTop: 4 },
  line: { marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  source: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  sourceText: { color: c.textSecond, fontSize: 14, lineHeight: 19, flexShrink: 1 },
});

export default React.memo(CourtPaperScreen);
