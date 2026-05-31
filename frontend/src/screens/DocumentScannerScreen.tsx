/**
 * DocumentScannerScreen -- In-app document camera and attachment
 *
 * Allows users to photograph a document (arrest record, court notice,
 * bail paperwork) and attach it directly to a case or send it in a message.
 *
 * Flow:
 *   1. Request camera permission
 *   2. Show camera viewfinder with capture button
 *   3. Preview captured photo with retake / use options
 *   4. On "Use" -- upload to messages attachment endpoint or return URI
 *
 * Navigation params:
 *   caseId?    -- if set, photo is attached to this case
 *   onCapture? -- callback with the captured image URI
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, Image, Platform, StyleSheet, Text, TouchableOpacity, View, AppState } from 'react-native';
// Camera -- native only. Web uses <input type="file" accept="image/*"> fallback
const CameraView = Platform.OS === 'web'
  ? null
  : require('expo-camera').CameraView;
const useCameraPermissions = Platform.OS === 'web'
  ? () => [{ granted: false }, async () => ({ granted: false })]
  : require('expo-camera').useCameraPermissions;
import * as ImageManipulator from 'expo-image-manipulator';
import {  useTheme, RADIUS, FONTS, TYPE, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { api } from '../services/api';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var CameraType: any;
export default function DocumentScannerScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const { caseId, onCapture } = (route?.params ?? {}) as {
    caseId?: number;
    onCapture?: (uri: string) => void;
  };

  const { colors }                      = useTheme();
  const [isCameraActive, setIsCameraActive] = React.useState(true);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setIsCameraActive(state === 'active');
    });
    return () => sub.remove();
  }, []);
  const [scanError, setScanError] = React.useState<string|null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing]                        = useState<'back' | 'front'>('back');
  const [captured, setCaptured]         = useState<string | null>(null);
  const [uploading, setUploading]       = useState(false);
  const cameraRef                       = useRef<any>(null);
  const mountedRef                      = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // ── Capture ───────────────────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      await hapticImpact();
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false });
      if (!photo?.uri) return;

      // Enhance for document readability: slight contrast boost
      const processed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      if (mountedRef.current) setCaptured(processed.uri);
    } catch {
      Alert.alert('Capture failed', 'Could not take photo. Please try again.');
    }
  }, []);

  // ── Upload ────────────────────────────────────────────────────────────────
  const usePhoto = useCallback(async () => {
    if (!captured) return;

    // If a callback was provided, return the URI directly (e.g. for case notes)
    if (onCapture) {
      onCapture(captured);
      navigation.canGoBack() ? navigation.goBack() : null;
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', {
        uri: captured,
        name: `doc_${Date.now()}.jpg`,
        type: 'image/jpeg' } as any);
      if (caseId) form.append('case_id', String(caseId));

      await api.post('/messages/attachment', form, {
        headers: { 'Content-Type': 'multipart/form-data' } });
      await hapticNotification();
      Alert.alert('Document attached ✓',
        caseId
          ? 'Your document has been attached to this case.'
          : 'Your document has been uploaded.',
        [{ text: 'OK', onPress: () => navigation.canGoBack() ? navigation.goBack() : null }]
      );
    } catch {
      Alert.alert('Upload failed',
        'Could not upload the document. Check your connection and try again.');
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }, [captured, caseId, onCapture, navigation]);

  const s = styles(colors as any);

  // ── Permission denied ─────────────────────────────────────────────────────
  if (!permission) return <View style={s.screen} />;

  if (!permission.granted) {
    return (
      <View style={[s.screen, s.centered]}
        testID="document-scanner-screen">
    {scanError && (
      <View style={{margin:16,padding:14,backgroundColor:colors.surface,
        borderRadius:10,borderWidth:1,borderColor:colors.border}}>
        <Text style={{color:colors.danger,fontWeight:'700',fontSize:14}}>⚠ {scanError}</Text>
      </View>
    )}
        <Text maxFontSizeMultiplier={1.4} style={s.permIcon}>📷</Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.permTitle, { color: colors.textPrimary }]}>
          Camera Access Needed
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.permSub, { color: colors.textMuted }]}>
          Allow camera access to scan and attach documents.
        </Text>
        <TouchableOpacity accessibilityRole="button"
          style={[s.btn, { backgroundColor: colors.navy }]}
          onPress={requestPermission}
        >
          <Text maxFontSizeMultiplier={1.4} style={s.btnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Preview captured photo ────────────────────────────────────────────────
  if (captured) {
    return (
      <View style={[s.screen, { backgroundColor: colors.textPrimary }]}>
        <Image source={{ uri: captured }} style={s.preview} resizeMode="contain" accessibilityLabel="Scanned document preview" onError={() => setScanError("Could not display scanned image.")} />

        <View style={s.previewActions}>
          <TouchableOpacity
            accessibilityRole="button"
            style={[s.previewBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
            onPress={() => setCaptured(null)}
            accessibilityLabel="Retake photo"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.previewBtnText}>↩ Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            style={[s.previewBtn, { backgroundColor: colors.navy }]}
            onPress={usePhoto}
            disabled={uploading}
            accessibilityLabel={caseId ? 'Attach to case' : 'Use this photo'}
          >
            {uploading
              ? <ActivityIndicator color={colors.bgCard} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={s.previewBtnText}>
                  {caseId ? '📎 Attach to Case' : '✓ Use Photo'}
                </Text>
            }
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={s.previewHint}>
          {caseId
            ? 'This document will be attached to your case.'
            : 'Tap "Use Photo" to continue.'}
        </Text>
      </View>
    );
  }

  // ── Camera viewfinder ─────────────────────────────────────────────────────
  return (
    <View style={s.screen}>
      <CameraView ref={cameraRef} style={s.camera} facing={facing} active={isCameraActive}>
        {/* Document frame guide */}
        <View style={s.frameGuide}>
          <View style={[s.corner, s.cornerTL]} />
          <View style={[s.corner, s.cornerTR]} />
          <View style={[s.corner, s.cornerBL]} />
          <View style={[s.corner, s.cornerBR]} />
        </View>

        <Text maxFontSizeMultiplier={1.4} style={s.guideText}>
          Position the document within the frame
        </Text>

        {/* Shutter button */}
        <View style={s.shutterRow}>
          <TouchableOpacity accessibilityRole="button"
            style={s.shutter}
            onPress={capture}
            accessibilityLabel="Take photo"
            activeOpacity={0.8}
          >
            <View style={s.shutterInner} />
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = (C: Record<string, string>) => StyleSheet.create({
  screen:    { flex: 1, backgroundColor: COLORS.bgCard },
  camera:    { flex: 1 },
  centered:  { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 32 },

  // Permission screen
  permIcon:  { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  permTitle: { fontSize: TYPE.xl, lineHeight: 33, ...FONTS.bold, marginBottom: 8, textAlign: 'center' },
  permSub:   { fontSize: TYPE.base, lineHeight: 21, textAlign: 'center', marginBottom: 32 },
  btn:       { borderRadius: RADIUS.md, paddingHorizontal: 32, paddingVertical: 14, alignItems: 'center' },
  btnText:   { color: COLORS.bgCard, fontSize: TYPE.base, lineHeight: 21, ...FONTS.bold },

  // Frame guide
  frameGuide:{ position: 'absolute', top: '15%', left: '5%', right: '5%', bottom: '25%',
               borderRadius: 8 },
  corner:    { position: 'absolute', width: 28, height: 28, borderColor: COLORS.bgCard, borderWidth: 3 },
  cornerTL:  { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cornerTR:  { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  cornerBL:  { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  cornerBR:  { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  guideText: { position: 'absolute', top: '12%', alignSelf: 'center', color: 'rgba(255,255,255,0.85)',
               fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center',
               backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6,
               borderRadius: 8 },

  // Shutter
  shutterRow:  { position: 'absolute', bottom: 48, left: 0, right: 0,
                 alignItems: 'center', justifyContent: 'center' },
  shutter:     { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.3)',
                 alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.bgCard },
  shutterInner:{ width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.bgCard },

  // Preview
  preview:      { flex: 1 },
  previewActions:{ position: 'absolute', bottom: 0, left: 0, right: 0,
                  flexDirection: 'row', gap: 12, padding: 24, paddingBottom: 40,
                  backgroundColor: 'rgba(0,0,0,0.7)' },
  previewBtn:   { flex: 1, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  previewBtnText:{ color: COLORS.bgCard, fontSize: TYPE.base, lineHeight: 21, ...FONTS.bold },
  previewHint:  { position: 'absolute', top: 20, alignSelf: 'center',
                  color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18 } });
