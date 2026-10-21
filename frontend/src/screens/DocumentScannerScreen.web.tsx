/**
 * DocumentScannerScreen.web.tsx — case documents on the web.
 *
 * The browser has no document camera here: the person picks a photo or PDF
 * (the same limits as the server: 10 MB, JPEG / PNG / WebP / HEIC / PDF). It is
 * stored encrypted with the case (POST /messages/attachment) and shows in the
 * case's thread, where the case owner and the attorney on the case can open it.
 * Without a caseId the person first picks the case. The list below shows the
 * case's documents; each downloads with the person's own token.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import { CasePicker, CaseDocumentList, checkUpload } from '../components/CaseDocuments';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

function DocumentScannerScreen(): React.JSX.Element {
  useLang();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const paramId = Number(route?.params?.caseId) || null;
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(paramId ? { id: paramId, title: route?.params?.caseTitle || '' } : null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { hasSession, recheck } = useHasSession();

  const upload = async (file: File | undefined) => {
    if (!file || !picked) return;
    setDone(''); setError('');
    const bad = checkUpload(file.size, file.type || null);
    if (bad) { setError(bad); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('case_id', String(picked.id));
      const res = await api.post('/messages/attachment', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      setDone(t('doc2_saved', { name: res.data?.attachment?.name || file.name }));
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError(apiErrorMessage(err, t('x_document_scanner_could_not_upload_document_2')));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <ScrollView testID="document-scanner-screen" style={s.screen} contentContainerStyle={s.scroll}>
      <Text maxFontSizeMultiplier={1.3} style={s.title} accessibilityRole="header">{t('doc2_title')}</Text>
      {hasSession === null ? null : !hasSession ? <SignInNeeded navigation={navigation} testID="doc-sign-in" body={t('sin_docs_body')} onSignedIn={recheck} />
        : !picked ? <CasePicker onPick={setPicked} /> : (
        <>
          {!!picked.title && <IconLabel icon={ICONS.cases} textStyle={s.muted} maxFontSizeMultiplier={1.4}>{picked.title}</IconLabel>}
          <Text maxFontSizeMultiplier={1.4} style={s.muted}>{t('doc2_web_intro')}</Text>
          <label htmlFor="doc-upload" style={{
            display: 'block', border: `2px dashed ${colors.border}`, borderRadius: 16, padding: '32px 16px',
            textAlign: 'center', cursor: 'pointer', backgroundColor: colors.bgCard, marginTop: 12, marginBottom: 12,
          }}>
            <IconLabel icon={ICONS.document} textStyle={{ fontSize: 36 }} maxFontSizeMultiplier={1.3}></IconLabel>
            <Text maxFontSizeMultiplier={1.3} style={[s.label, { display: 'flex' as any, justifyContent: 'center' }]}>{t('x_document_scanner_click_select_document_photo')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[s.muted, { display: 'flex' as any, justifyContent: 'center' }]}>{t('doc2_limits')}</Text>
            <input ref={inputRef} id="doc-upload" data-testid="doc-upload-input" type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              onChange={e => upload(e.target.files?.[0])} style={{ display: 'none' }} disabled={uploading} />
          </label>
          {uploading && <View style={s.center}><ActivityIndicator color={colors.textBrand} /><Text maxFontSizeMultiplier={1.3} style={s.muted}>{t('doc2_uploading')}</Text></View>}
          {!!error && <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={s.error} maxFontSizeMultiplier={1.4} testID="doc-upload-error">{error}</IconLabel>}
          {!!done && (
            <View style={s.okBox} testID="doc-upload-done">
              <Text maxFontSizeMultiplier={1.4} style={s.label}>✓ {done}</Text>
              <TouchableOpacity accessibilityRole="button" style={s.btn} onPress={() => navigation.navigate('Messages', { caseId: picked.id, caseTitle: picked.title })}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('doc2_open_thread')}</Text>
              </TouchableOpacity>
            </View>
          )}
          <CaseDocumentList caseId={picked.id} refreshKey={refreshKey} />
          {!paramId && (
            <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => { setPicked(null); setDone(''); setError(''); }}>
              <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('doc2_other_case')}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { color: c.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  label: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
  muted: { color: c.textSecond, fontSize: 14, lineHeight: 20 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 10 },
  okBox: { backgroundColor: c.legalBg, borderRadius: 12, padding: 12, marginBottom: 12, gap: 8 },
  btn: { backgroundColor: c.navy, borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: c.textOnNavy, fontSize: 15, fontWeight: '800' },
  secondary: { borderRadius: 12, borderWidth: 1.5, borderColor: c.border, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryText: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
});

export default React.memo(DocumentScannerScreen);
