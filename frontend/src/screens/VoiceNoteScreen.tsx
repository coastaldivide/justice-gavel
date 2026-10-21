import { AIDisclaimer } from '../components/AIDisclaimer';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
/**
 * VoiceNoteScreen -- Voice-to-structured case note
 *
 * Design direction: calm + focused -- a single action.
 * No visual noise. The entire screen centres on the mic.
 * Breathing animation during recording. Clear progression.
 * The note that comes back feels like magic.
 *
 * Flow:
 *   Idle → Record (pulse animation, live timer) → Processing
 *   → Result (structured note: date, summary, next steps, flags)
 *   → Confirm (appended to case notes or saved standalone)
 *
 * Entry points:
 *   1. CaseScreen notes modal mic button
 *   2. New case creation mic button
 *
 * Fallback: if no audio permission or recording unavailable,
 *   shows a text input with the same Claude structuring.
 */
import type { ScreenProps } from '../types/navigation';
import {
  useAudioRecorder, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import React, {
  useState, useEffect, useRef, useCallback
} from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, ActivityIndicator, TextInput, Platform, KeyboardAvoidingView, LayoutAnimation } from 'react-native';
import { FileSystem, RNShare, Clipboard } from '../utils/webCompat';
import { appendCaseNote } from '../services/caseNotes';
import { api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'recording' | 'processing' | 'result' | 'text_input';

interface StructuredNote {
  date: string;
  summary: string;
  next_steps: string[];
  flags: string[];
  raw: string;
}

// ── Animated pulse ring ───────────────────────────────────────────────────────
function PulseRing({ active }: { active: boolean }) {
  useLang();
  const scale  = useRef(new Animated.Value(1)).current;
  const opac   = useRef(new Animated.Value(0)).current;
  const anim   = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (active) {
      anim.current = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.55, duration: 900, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1,    duration: 900, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(opac, { toValue: 0.35, duration: 900, useNativeDriver: true }),
            Animated.timing(opac, { toValue: 0,    duration: 900, useNativeDriver: true }),
          ]),
        ])
      );
      anim.current.start();
    } else {
      anim.current?.stop();
      scale.setValue(1);
      opac.setValue(0);
    }
  return () => anim.current?.stop();
  }, [active, opac, scale]);

  return (
    <Animated.View style={[styles.pulseRing, {
      transform: [{ scale }],
      opacity: opac,
      backgroundColor: COLORS.emergency,
    }]} />
  );
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function useTimer(running: boolean) {
  const [secs, setSecs] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (running) {
      setSecs(0);
      ref.current = setInterval(() => setSecs(s => s + 1), 1000);
    } else {
      if (ref.current) clearInterval(ref.current);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// ── Main screen ───────────────────────────────────────────────────────────────
function VoiceNoteScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();

  // Any active recording is stopped and the microphone released by the
  // useAudioRecorder hook when this screen unmounts.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors, isDark } = useTheme();
  const styles = makeStyles();

  const { caseId, caseTitle, onSave } = (route?.params as import('../types/api').RouteParams) ?? {};

  const [phase,    setPhase]    = useState<Phase>('idle');
  const [note,     setNote]     = useState<StructuredNote | null>(null);
  const [editText, setEditText] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [textIn,   setTextIn]   = useState('');

  // Recording state — expo-audio recorder (native only; web uses VoiceNoteScreen.web.tsx)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer    = useTimer(phase === 'recording');

  // ── Start recording ──────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        confirm(t('x_voice_note_microphone_needed'), t('x_voice_note_allow_microphone_access_record'),
      { confirmLabel: t('x_voice_note_type_instead'), cancelLabel: t('home_offline_ok') }).then(ok => { if (ok) setPhase('text_input'); });
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch (e: any) {
      showToast(e.message || t('x_voice_note_try_typing_note_instead'), 'error');
      setPhase('text_input');
    }
  }, [recorder, confirm, showToast]);

  // ── Stop + process ───────────────────────────────────────────────────────────
  const stopAndProcess = useCallback(async () => {
    setPhase('processing');

    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) throw new Error('No recording URI');

      // Build multipart form data using URI directly (React Native handles the rest)
      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'note.m4a',
      } as any);

      const res = await api.post('/transcribe/note', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      if (!mountedRef.current) return;

      setNote(res.data?.note);
      setEditText(formatNoteForCase(res.data?.note));
      setPhase('result');

      // Clean up temp file
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e: any) {
      const msg = apiErrorMessage(e, t('x_voice_note_could_not_process_audio'));
      confirm(t('x_voice_note_processing_error'), t('x_voice_note_would_like_type_note', { msg }),
      { confirmLabel: t('x_voice_note_type_instead'), cancelLabel: t('try_again') }).then(ok => { if (ok) setPhase('text_input'); else setPhase('idle'); });
    }
  }, [recorder, confirm]);

  // ── Process typed text ───────────────────────────────────────────────────────
  const processText = useCallback(async () => {
    if (!textIn.trim()) return;
    setPhase('processing');
    try {
          const res = await api.post('/transcribe/text', { text: textIn.trim() });
      if (!mountedRef.current) return;
      setNote(res.data?.note);
      setEditText(formatNoteForCase(res.data?.note));
      setPhase('result');
    } catch {
      showToast(t('x_voice_note_could_not_structure_note'));
      setPhase('text_input');
    }
  }, [textIn, showToast]);

  // ── Save to case (appended to the notes on the server) / copy ───────────────
  const saveToCase = useCallback(async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      if (caseId) {
        const combined = await appendCaseNote(caseId, editText);
        if (onSave) onSave(combined);
        showToast(t('vn_saved_to_case'), 'success');
        navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab');
      } else {
        await Clipboard.setString(editText.trim());
        showToast(t('vn_copied'), 'success');
      }
    } catch (e) {
      showToast(apiErrorMessage(e, t('vn_save_failed')), 'error');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [editText, caseId, onSave, navigation, showToast]);

  // ── Format note for case notes field ─────────────────────────────────────────
  function formatNoteForCase(n: StructuredNote | undefined): string {
    if (!n) return '';
    let out = `📝 ${n.date}\n\n`;
    out += `${n.summary}\n`;
    if (n.next_steps?.length) {
      out += '\n' + t('x_voice_note_next_steps') + '\n';
      n.next_steps.forEach(s => { out += `• ${s}\n`; });
    }
    if (n.flags?.length) {
      out += '\n' + t('x_voice_note_flagged_2') + '\n';
      n.flags.forEach(f => { out += `• ${f}\n`; });
    }
    return out.trim();
  }

  // ── RENDER: Idle ─────────────────────────────────────────────────────────────
  if (phase === 'idle') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>

        {caseTitle && (
          <View style={[styles.casePill, { backgroundColor: COLORS.navy + '18', borderColor: COLORS.navy + '33' }]}>
            <IconLabel icon={ICONS.cases} textStyle={[styles.casePillText, { color: COLORS.navy }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>{caseTitle}</IconLabel>
          </View>
        )}
        <Text maxFontSizeMultiplier={1.4} style={[styles.headline, { color: colors.textPrimary }]}>
          {t('x_cs_voice_note_2')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          {t('x_voice_note_speak_up_5_minutes')}
        </Text>

        {/* Big mic button */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.micBtnWrap}
          onPress={startRecording}
          activeOpacity={0.85}
        >
          <View style={[styles.micBtn, { backgroundColor: COLORS.navy }]}>
            <IconLabel icon={ICONS.record} textStyle={styles.micIcon} maxFontSizeMultiplier={1.4}></IconLabel>
          </View>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.4} style={[styles.tapHint, { color: colors.textMuted }]}>{t('x_voice_note_tap_start_recording')}</Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.typeLink}
          accessibilityLabel={t('x_voice_note_type_instead_2')} onPress={() => setPhase('text_input')}
        >
          <IconLabel icon={ICONS.edit} textStyle={[styles.typeLinkText, { color: colors.info }]} maxFontSizeMultiplier={1.4}>{t('x_voice_note_type_instead_2')}</IconLabel>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── RENDER: Recording ────────────────────────────────────────────────────────
  if (phase === 'recording') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.timer, { color: COLORS.emergency }]}>{timer}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.recordingLabel, { color: colors.textMuted }]}>{t('x_voice_note_recording')}</Text>

        {/* Pulsing stop button */}
        <View style={styles.micBtnWrap}>
          <PulseRing active />
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[styles.micBtn, { backgroundColor: COLORS.emergency }]}
            onPress={stopAndProcess}
            activeOpacity={0.85}
            accessibilityLabel={t('x_voice_note_stop_recording_process_note')}
          >
            <View style={styles.stopSquare} />
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={[styles.tapHint, { color: colors.textMuted }]}>{t('x_voice_note_tap_stop')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.recordingTip, { color: colors.textMuted }]}>
          {t('x_voice_note_speak_naturally_mention_client')}
        </Text>
      </View>
    </View>
  );

  // ── RENDER: Processing ───────────────────────────────────────────────────────
  if (phase === 'processing') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>
        <ActivityIndicator size="large" color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.processingLabel, { color: colors.textPrimary }]}>
          {t('x_voice_note_structuring_note')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          {t('x_voice_note_transcribing_audio_then_extracting')}
        </Text>
      </View>
    </View>
  );

  // ── RENDER: Text input fallback ───────────────────────────────────────────────
  if (phase === 'text_input') return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.textInputScroll} keyboardShouldPersistTaps="handled">
        {caseTitle && (
          <View style={[styles.casePill, { backgroundColor: COLORS.navy + '18', borderColor: COLORS.navy + '33' }]}>
            <IconLabel icon={ICONS.cases} textStyle={[styles.casePillText, { color: COLORS.navy }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>{caseTitle}</IconLabel>
          </View>
        )}
        <Text maxFontSizeMultiplier={1.4} style={[styles.headline, { color: colors.textPrimary }]}>{t('x_voice_note_type_note')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          {t('x_voice_note_describe_meeting_key_facts')}
        </Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: colors.bgCard,
            borderColor: colors.border, color: colors.textPrimary }]}
          multiline
              maxLength={2000}
          numberOfLines={10}
          placeholder={t('x_voice_note_e_g_met_with')}
          placeholderTextColor={COLORS.textSecond}
          value={textIn}
          onChangeText={setTextIn}
          textAlignVertical="top"

          returnKeyType="next"
          blurOnSubmit
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
          style={[styles.processBtn, { backgroundColor: COLORS.navy },
            !textIn.trim() && { opacity: 0.45 }]}
          onPress={processText}
          disabled={!textIn.trim()}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.processBtnText}>{t('x_voice_note_structure_this_note')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.typeLink}
          accessibilityLabel={t('x_voice_note_use_voice_instead')} onPress={() => setPhase('idle')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.typeLinkText, { color: colors.info }]}>{t('x_voice_note_use_voice_instead')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── RENDER: Result ───────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      testID="voice-note-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.resultScroll} keyboardShouldPersistTaps="handled">

        {/* Structured preview */}
        {note && (
          <>
            <View style={[styles.resultCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.resultDate, { color: colors.textMuted }]}>{note.date}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.resultSummary, { color: colors.textPrimary }]}>{note.summary}</Text>
            </View>

            {note.next_steps?.length > 0 && (
              <View style={[styles.resultSection, { backgroundColor: isDark ? colors.legalBg : colors.legalBg, borderColor: colors.legal }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.resultSectionTitle, { color: COLORS.legal }]}>{t('x_voice_note_next_steps_2')}</Text>
                {note.next_steps.map((s, i) => (
                  <View key={`next_ste-${i}`} style={styles.resultBulletRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBullet, { color: COLORS.legal }]}>›</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBulletText, { color: colors.textSecond }]}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {note.flags?.length > 0 && (
              <View style={[styles.resultSection, { backgroundColor: isDark ? colors.bailBg : colors.warnBg, borderColor: colors.warn }]}>
                <IconLabel icon={ICONS.flag} textStyle={[styles.resultSectionTitle, { color: COLORS.bail }]} maxFontSizeMultiplier={1.4}>{t('x_voice_note_flagged')}</IconLabel>
                {note.flags.map((f, i) => (
                  <View key={`flags-${i}`} style={styles.resultBulletRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBullet, { color: COLORS.bail }]}>!</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBulletText, { color: colors.textSecond }]}>{f}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Editable export */}
        <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>
          {t('x_voice_note_edit_before_saving')}
        </Text>
        <TextInput
          style={[styles.textArea, styles.editArea,
            { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
          multiline
              maxLength={2000}
          value={editText}
          onChangeText={setEditText}
          textAlignVertical="top"
        />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
          style={[styles.saveBtn, { backgroundColor: COLORS.navy }, saving && { opacity: 0.6 }]}
          onPress={saveToCase}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={colors.bgCard} />
            : <IconLabel icon={ICONS.save} textStyle={styles.saveBtnText} maxFontSizeMultiplier={1.4}>{caseId ? t('x_voice_note_save_case') : t('x_voice_note_copy_note')}</IconLabel>}
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.shareNoteBtn, { borderColor: COLORS.navy + '55' }]}
          onPress={async () => { try {
            await RNShare.share({ message: editText, title: t('x_voice_note_case_note') });
          } catch { /* ignore */ }
          }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.shareNoteBtnText, { color: colors.textBrand }]}>{t('x_voice_note_share_note')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.typeLink}
          accessibilityLabel={t('x_voice_note_record_another_note')} onPress={() => { setPhase('idle'); setNote(null); setEditText(''); }}
        >
          <IconLabel icon={ICONS.record} textStyle={[styles.typeLinkText, { color: colors.info }]} maxFontSizeMultiplier={1.4}>{t('x_voice_note_record_another_note')}</IconLabel>
        </TouchableOpacity>

        <View style={{ height: 40 }} />

      </ScrollView>
      <AIDisclaimer variant="banner" />

    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = () => StyleSheet.create({
  screen:    { flex: 1 },
  centreWrap:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  casePill:  { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10,
    marginBottom: 24, maxWidth: 260 },
  casePillText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  headline:  { fontSize: 28, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  subline:   { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 40 },

  // Mic button
  micBtnWrap:{ position: 'relative', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20 },
  pulseRing: { position: 'absolute', width: 120, height: 120, borderRadius: 80 },
  micBtn:    { width: 100, height: 100, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.md },
  micIcon:   { fontSize: 44 },
  stopSquare:{ width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.bgCard },

  tapHint:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 20 },

  // Recording
  timer:          { fontSize: 48, ...FONTS.black, marginBottom: 6, letterSpacing: 2 },
  recordingLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 32 },
  recordingTip:   { fontSize: 12, textAlign: 'center', lineHeight: 18, maxWidth: 260, marginTop: 12 },

  // Processing
  processingLabel: { fontSize: 16, ...FONTS.heavy, marginTop: 16, marginBottom: 8 },

  // Type input
  textInputScroll: { padding: 20 },
  textArea: {
    borderWidth: 1.5, borderRadius: RADIUS.lg,
    padding: 16, fontSize: 14, minHeight: 160, lineHeight: 21,
    marginBottom: 14,
  },
  editArea:  { minHeight: 200, marginBottom: 16 },
  processBtn:{ borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center',
    marginBottom: 12, ...SHADOW.sm },
  processBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },

  typeLink:  { paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  typeLinkText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Result
  resultScroll:  { padding: 16 },
  resultCard:    { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  resultDate:    { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  resultSummary: { fontSize: 15, lineHeight: 22 },
  resultSection: { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 10 },
  resultSectionTitle: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  resultBulletRow: { flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'flex-start' },
  resultBullet:    { fontSize: 16,
    fontFamily: 'Inter_700Bold', fontWeight: '700', flexShrink: 0, lineHeight: 20 },
  resultBulletText:{ flex: 1, fontSize: 12, lineHeight: 19 },

  fieldLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8 },

  saveBtn:     { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center',
    marginBottom: 12, ...SHADOW.md },
  saveBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },
  shareNoteBtn:     { borderRadius: RADIUS.md, borderWidth: 1.5, paddingVertical: 11,
    alignItems: 'center', marginBottom: 10 },
  shareNoteBtnText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});

// Module-level fallback for helper components
const styles = makeStyles();
export default React.memo(VoiceNoteScreen);