/**
 * DraftDownloads.tsx — "Download as Word (.docx)" / "Download as PDF" for a draft (AI step 5).
 * The files are made on the server (backend services/draftDocs): the notice "Prepared by you with
 * Justice Gavel — general legal information, not legal advice …" on every page, parts that name a
 * law without a checked source left out, the person's own words as typed, a blank signature line.
 *   path: the document route without the format, e.g. /expungement/petition/12/document
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { fetchFile } from '../services/fileDownload';
import { apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { useToast } from './ToastProvider';
import { t } from '../i18n';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

export default function DraftDownloads({ path, fileBase, testID = 'draft-download' }: { path: string; fileBase: string; testID?: string }) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null);
  const get = async (format: 'docx' | 'pdf') => {
    setBusy(format);
    try {
      await fetchFile(`${path}?format=${format}`, `${fileBase}.${format}`, MIME[format]);
    } catch (e) {
      showToast(apiErrorMessage(e, t('doc_download_failed')), 'error');
    } finally {
      setBusy(null);
    }
  };
  const button = (format: 'docx' | 'pdf', label: string) => (
    <TouchableOpacity accessibilityRole="button" testID={`${testID}-${format}`} disabled={busy != null} onPress={() => get(format)}
      style={[styles.btn, { borderColor: colors.border }, busy != null && { opacity: 0.6 }]} accessibilityLabel={label}>
      {busy === format ? <ActivityIndicator /> : <Text maxFontSizeMultiplier={1.4} style={[styles.text, { color: colors.textPrimary }]}>{label}</Text>}
    </TouchableOpacity>
  );
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={styles.row}>
        {button('docx', t('doc_download_word'))}
        {button('pdf', t('doc_download_pdf'))}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[styles.note, { color: colors.textMuted }]}>{t('doc_download_note')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center', flexGrow: 1 },
  text: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  note: { fontSize: 12, marginTop: 6, lineHeight: 17 },
});
