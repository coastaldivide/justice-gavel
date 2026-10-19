/**
 * DocumentScannerScreen.web.tsx -- Web platform replacement
 *
 * On web, camera scanning is replaced with a file input
 * (drag-and-drop or "Browse"). The user selects a photo of
 * the document from their file system.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import { t, useLang } from '../i18n';

function DocumentScannerScreen(): React.JSX.Element {
  useLang();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const caseId: number | undefined = route?.params?.caseId;
  const { colors }  = useTheme();
  const [scanning,  setScanning]  = useState(false);
  const [result,    setResult]    = useState<string>('');
  const [error,     setError]     = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target as any).files?.[0];
    if (!file) return;
    setScanning(true);
    setError('');
    try {
          const formData = new FormData();
      formData.append('document', file);
      if (caseId) formData.append('case_id', String(caseId));
      const res = await api.post('/messages/attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data?.attachment?.name
        ? t('x_document_scanner_uploaded_name', { name: res.data.attachment.name })
        : t('x_document_scanner_file_uploaded_successfully'));
    } catch (err) {
      setError(apiErrorMessage(err, t('x_document_scanner_could_not_upload_document_2')));
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 24, gap: 20 }}>
      <TouchableOpacity
        onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{ marginBottom: 8 }}
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>{t('ja_back')}</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        {t('x_cs_scan_document_2')}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, color: colors.textMuted, lineHeight: 22 }}>
        {t('x_document_scanner_select_photo_court_document')}
      </Text>

      {/* File input styled as a drop zone */}
      <label htmlFor="doc-upload" style={{
        display: 'block',
        border: `2px dashed ${colors.border}`,
        borderRadius: 16,
        padding: '40px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: colors.bgCard,
      } as any}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 40, marginBottom: 12 }}>📄</Text>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary, display: 'block' as any }}>
          {t('x_document_scanner_click_select_document_photo')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, display: 'block' as any }}>
          {t('x_document_scanner_jpeg_png_pdf_max')}
        </Text>
        <input
          id="doc-upload"
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileSelect as any}
          style={{ display: 'none' }}
        />
      </label>

      {scanning && (
        <View style={{ alignItems: 'center', paddingVertical: 24, gap: 12 }}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>
            {t('x_document_scanner_extracting_text_from_document')}
          </Text>
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor: colors.emergencyBg, borderRadius: 12, padding: 16 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.emergency, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, gap: 10 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
            {t('x_document_scanner_extracted_text')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 22 }}>
            {result}
          </Text>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 18 }}>
        {t('x_document_scanner_best_results_photograph_document')}
      </Text>
    </ScrollView>
  );
}
export default React.memo(DocumentScannerScreen);
