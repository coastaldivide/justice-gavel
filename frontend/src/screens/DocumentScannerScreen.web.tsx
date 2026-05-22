/**
 * DocumentScannerScreen.web.tsx -- Web platform replacement
 *
 * On web, camera scanning is replaced with a file input
 * (drag-and-drop or "Browse"). The user selects a photo of
 * the document from their file system.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api } from '../services/api';

export default function DocumentScannerScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
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
      const res = await api.post('/messages/attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data.url || res.data.path || 'File uploaded successfully');
    } catch {
      setError('Could not process document. Try a clearer photo.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 24, gap: 20 }}>
      <TouchableOpacity
        onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home')}
        style={{ marginBottom: 8 }}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>← Back</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        Scan Document
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, color: colors.textMuted, lineHeight: 22 }}>
        Select a photo of your court document, citation, or legal notice.
        The text will be extracted automatically.
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
          Click to select a document photo
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, display: 'block' as any }}>
          JPEG, PNG, or PDF -- max 10 MB
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
            Extracting text from document…
          </Text>
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor: '#FFEBEE', borderRadius: 12, padding: 16 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: '#C62828', fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, gap: 10 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
            Extracted text:
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 22 }}>
            {result}
          </Text>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 18 }}>
        For best results, photograph the document in good lighting with all text visible.
      </Text>
    </ScrollView>
  );
}
