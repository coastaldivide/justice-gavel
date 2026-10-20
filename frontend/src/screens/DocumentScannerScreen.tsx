import { useToast } from '../components/ToastProvider';
/**
 * DocumentScannerScreen -- In-app document camera and attachment
 *
 * Allows users to photograph a document (arrest record, court notice,
 * bail paperwork) and attach it directly to a case or send it in a message.
 *
 * Flow:
 *   1. The case the document belongs to (route caseId, else pick one)
 *   2. Camera viewfinder with capture button — or "Choose a file" (a photo or a
 *      PDF from the phone), which also works when camera access is refused
 *   3. Preview captured photo with retake / use options
 *   4. On "Use" -- upload (POST /messages/attachment, stored encrypted with the
 *      case; it shows in the case's thread for the owner and the attorney)
 *
 * Navigation params: caseId?, caseTitle?
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TouchableOpacity, View, AppState, LayoutAnimation } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { CasePicker, checkUpload } from '../components/CaseDocuments';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
// Camera -- native only (web uses DocumentScannerScreen.web.tsx).
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import {  useTheme, RADIUS, FONTS, TYPE, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { hapticImpact, hapticNotification } from '../utils/webCompat';
import { t, useLang } from '../i18n';

function DocumentScannerScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const params = (route?.params ?? {}) as { caseId?: number | string; caseTitle?: string };
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(Number(params.caseId) ? { id: Number(params.caseId), title: params.caseTitle || '' } : null);
  const caseId = picked?.id;
  const { hasSession, recheck } = useHasSession();

  const { colors }                      = useTheme();
  const [isCameraActive, setIsCameraActive] = React.useState(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
      showToast(t('x_document_scanner_could_not_take_photo'));
    }
  }, [showToast]);

  // ── Upload ────────────────────────────────────────────────────────────────
  const send = useCallback(async (file: { uri: string; name: string; type: string; size?: number | null }) => {
    if (!caseId) return;
    const bad = checkUpload(file.size ?? null, file.type);
    if (bad) { showToast(bad, 'error'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
      form.append('case_id', String(caseId));
      await api.post('/messages/attachment', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      await hapticNotification();
      showToast(t('x_document_scanner_document_attached_case'), 'success');
      if (mountedRef.current) setCaptured(null);
      navigation.navigate('Messages', { caseId, caseTitle: picked?.title });
    } catch (err) {
      showToast(apiErrorMessage(err, t('x_document_scanner_could_not_upload_document')), 'error');
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }, [caseId, picked?.title, navigation, showToast]);
  const usePhoto = useCallback(() => {
    if (captured) send({ uri: captured, name: `document_${Date.now()}.jpg`, type: 'image/jpeg' });
  }, [captured, send]);
  const chooseFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    send({ uri: a.uri, name: a.name || 'document', type: a.mimeType || 'application/octet-stream', size: a.size ?? null });
  }, [send]);

  const s = styles(colors as any);

  // ── Signed out: documents belong to a case in the person's account ────────
  if (hasSession === false) {
    return (
      <View style={[s.screen, { backgroundColor: colors.bg }]} testID="document-scanner-screen">
        <SignInNeeded navigation={navigation} testID="doc-sign-in" body={t('sin_docs_body')} onSignedIn={recheck} />
      </View>
    );
  }
  if (hasSession === null) return <View style={[s.screen, { backgroundColor: colors.bg }]} />;

  // ── Which case ────────────────────────────────────────────────────────────
  if (!picked) {
    return (
      <View style={[s.screen, { backgroundColor: colors.bg, padding: 16 }]} testID="document-scanner-screen">
        <CasePicker onPick={setPicked} />
      </View>
    );
  }

  // ── Permission denied ─────────────────────────────────────────────────────
  if (!permission) return <View style={s.screen} />;

  if (!permission.granted) {
    return (
      <View style={[s.screen, s.centered]}
        testID="document-scanner-screen">
    {scanError && (
      <View style={{margin:16,padding:14,backgroundColor:colors.surface,
        borderRadius:10,borderWidth:1,borderColor:colors.border}}>
        <Text style={{color:colors.textPrimary,fontWeight:'700',fontSize:14}}>⚠ {scanError}</Text>
      </View>
    )}
        <Text maxFontSizeMultiplier={1.4} style={s.permIcon}>📷</Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.permTitle, { color: colors.textPrimary }]}>
          {t('x_cs_camera_access_needed')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.permSub, { color: colors.textMuted }]}>
          {t('x_document_scanner_allow_camera_access_scan')}
        </Text>
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[s.btn, { backgroundColor: colors.navy }]}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}>
          <Text maxFontSizeMultiplier={1.4} style={s.btnText}>{permission.canAskAgain ? t('x_document_scanner_allow_camera') : t('x_cs_open_settings')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={[s.btn, { marginTop: 12, borderWidth: 1.5, borderColor: colors.border }]} onPress={chooseFile} disabled={uploading}>
          {uploading ? <ActivityIndicator color={colors.textBrand} /> : <Text maxFontSizeMultiplier={1.4} style={[s.btnText, { color: colors.textPrimary }]}>{t('doc2_choose_file')}</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  // ── Preview captured photo ────────────────────────────────────────────────
  if (captured) {
    return (
      <View style={[s.screen, { backgroundColor: colors.navy }]}>
        <Image source={{ uri: captured }} style={s.preview} resizeMode="contain" accessibilityLabel={t('x_document_scanner_scanned_document_preview')} onError={() => setScanError(t('x_document_scanner_could_not_display_scanned'))} />

        <View style={s.previewActions}>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[s.previewBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
            accessibilityLabel={t('x_document_scanner_retake')} onPress={() => setCaptured(null)}
          >
            <Text maxFontSizeMultiplier={1.4} style={s.previewBtnText}>{t('x_document_scanner_retake')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[s.previewBtn, { backgroundColor: colors.navy }]}
            onPress={usePhoto}
            disabled={uploading}
            accessibilityLabel={t('x_document_scanner_attach_case')}
          >
            {uploading
              ? <ActivityIndicator color={colors.white} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={s.previewBtnText}>{t('x_document_scanner_attach_case_2')}</Text>
            }
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={s.previewHint}>{t('x_document_scanner_this_document_will_be')}</Text>
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
          {t('x_document_scanner_position_document_within_frame')}
        </Text>

        {/* Shutter button */}
        <View style={s.shutterRow}>
          <TouchableOpacity accessibilityRole="button" style={s.fileBtn} onPress={chooseFile} disabled={uploading}>
            <Text maxFontSizeMultiplier={1.3} style={s.previewBtnText}>{t('doc2_choose_file')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={s.shutter}
            onPress={capture}
            accessibilityLabel={t('x_document_scanner_take_photo')}
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
  guideText: { position: 'absolute', top: '12%', alignSelf: 'center', color: COLORS.textOnGold,
               fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center',
               backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6,
               borderRadius: 8 },

  // Shutter
  shutterRow:  { position: 'absolute', bottom: 48, left: 0, right: 0,
                 alignItems: 'center', justifyContent: 'center' },
  shutter:     { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.3)',
                 alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.bgCard },
  shutterInner:{ width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.bgCard },
  fileBtn:     { position: 'absolute', left: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: RADIUS.md, backgroundColor: 'rgba(0,0,0,0.75)' },

  // Preview
  preview:      { flex: 1 },
  previewActions:{ position: 'absolute', bottom: 0, left: 0, right: 0,
                  flexDirection: 'row', gap: 12, padding: 24, paddingBottom: 40,
                  backgroundColor: 'rgba(0,0,0,0.7)' },
  previewBtn:   { flex: 1, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  previewBtnText:{ color: COLORS.white, fontSize: TYPE.base, lineHeight: 21, ...FONTS.bold },
  previewHint:  { position: 'absolute', top: 20, alignSelf: 'center',
                  color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18 } });
export default React.memo(DocumentScannerScreen);