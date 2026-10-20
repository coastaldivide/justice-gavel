/**
 * CaseDocuments — shared by DocumentScannerScreen (native and web):
 *
 *   <CasePicker>      documents belong to a case: pick which one (GET /cases)
 *   <CaseDocumentList> the case's documents (attachment messages of its
 *                      thread, GET /messages/:caseId), each opens with the
 *                      person's own token (services/attachments)
 *   checkUpload()     the same limits as the server (10 MB; photos and PDFs)
 *                     so a wrong file is refused before it is sent
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { openAttachment } from '../services/attachments';
import { useToast } from './ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

/** null when the file can be sent, else the message to show. */
export function checkUpload(size: number | null | undefined, mime: string | null | undefined): string | null {
  if (size != null && size > DOC_MAX_BYTES) return t('doc2_too_big', { mb: DOC_MAX_BYTES / 1024 / 1024 });
  if (size === 0) return t('doc2_empty');
  if (mime && !DOC_TYPES.includes(mime.toLowerCase())) return t('doc2_bad_type');
  return null;
}

export function CasePicker({ onPick }: { onPick: (c: { id: number; title: string }) => void }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [cases, setCases] = useState<{ id: number; title: string }[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.get('/cases').then(r => setCases(unwrapList(r.data, 'cases'))).catch(e => setError(apiErrorMessage(e, t('x_messages_could_not_load_cases'))));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <View testID="doc-case-picker">
      <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('doc2_pick_case')}</Text>
      {!cases && !error && <ActivityIndicator color={colors.textBrand} />}
      {!!error && (
        <TouchableOpacity accessibilityRole="button" style={s.row} onPress={load}>
          <Text maxFontSizeMultiplier={1.4} style={s.rowText}>⚠ {error} · {t('try_again')}</Text>
        </TouchableOpacity>
      )}
      {cases?.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.muted}>{t('doc2_no_cases')}</Text>}
      {cases?.map(c => (
        <TouchableOpacity key={c.id} accessibilityRole="button" testID="doc-case-option" style={s.row} onPress={() => onPick({ id: Number(c.id), title: c.title })}>
          <Text maxFontSizeMultiplier={1.4} style={s.rowText} numberOfLines={1}>📁 {c.title}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.muted}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface Doc { id: number; attachment_id: number; attachment_name: string | null; attachment_type: string | null; attachment_size: number | null; sent_at: string }
const kb = (n: number | null) => (!n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function CaseDocumentList({ caseId, refreshKey }: { caseId: number; refreshKey: number }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.get<{ messages: Doc[] }>(`/messages/${caseId}`, { params: { limit: 100 } })
      .then(r => { if (live) setDocs((r.data?.messages || []).filter(m => m.attachment_id).reverse()); })
      .catch(e => { if (live) setError(apiErrorMessage(e, t('doc2_list_failed'))); });
    return () => { live = false; };
  }, [caseId, refreshKey]);
  const open = async (d: Doc) => {
    try {
      const how = await openAttachment(d.attachment_id, d.attachment_name || 'document', d.attachment_type);
      if (how === 'download') showToast(t('msg2_downloaded'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('msg2_cannot_open')), 'error'); }
  };
  return (
    <View testID="doc-list">
      <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('doc2_case_docs')}</Text>
      {!!error && <Text maxFontSizeMultiplier={1.4} style={s.muted}>⚠ {error}</Text>}
      {!docs && !error && <ActivityIndicator color={colors.textBrand} />}
      {docs?.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.muted}>{t('doc2_none')}</Text>}
      {docs?.map(d => (
        <TouchableOpacity key={d.id} accessibilityRole="button" testID="doc-item" style={s.row} onPress={() => open(d)}
          accessibilityLabel={t('doc2_open', { name: d.attachment_name || '' })}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={s.rowText} numberOfLines={1}>{d.attachment_type === 'application/pdf' ? '📄' : '🖼'} {d.attachment_name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.muted}>
              {[new Date(d.sent_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' }), kb(d.attachment_size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.link}>{t('doc2_open_btn')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  title: { color: c.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 8, minHeight: 52 },
  rowText: { color: c.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  muted: { color: c.textSecond, fontSize: 13, lineHeight: 18 },
  link: { color: c.textBrand, fontSize: 14, fontWeight: '800' },
});
