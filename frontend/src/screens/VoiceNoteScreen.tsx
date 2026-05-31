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
 * Fallback: if no audio permission or Expo AV unavailable,
 *   shows a text input with the same Claude structuring.
 */
import type { ScreenProps } from '../types/navigation';
import React, {
  useState, useEffect, useRef, useCallback
} from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, ActivityIndicator, Alert, TextInput, Platform, KeyboardAvoidingView, Share, RefreshControl} from 'react-native';
import { FileSystem } from '../utils/webCompat';
import { api } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

declare var data: any;
declare var load: any;
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
  const scale  = useRef(new Animated.Value(1)).current;
  const opac   = useRef(new Animated.Value(0)).current;
  const anim   = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => anim.current?.stop();
  }, [active]);

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
export default function VoiceNoteScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop any active recording on unmount to release microphone
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);

  const { caseId, caseTitle, existingNotes = '', onSave } = (route?.params as import('../types/api').RouteParams) ?? {};

  const [phase,    setPhase]    = useState<Phase>('idle');
  const [note,     setNote]     = useState<StructuredNote | null>(null);
  const [editText, setEditText] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [textIn,   setTextIn]   = useState('');

  // Recording state (without expo-av -- using fetch + base64)
  const recordingRef = useRef<any>(null);
  const timer        = useTimer(phase === 'recording');

  // Try to load expo-av dynamically (graceful if not installed)
  const [avReady, setAvReady] = useState(false);
  const AudioRef = useRef<any>(null);

  useEffect(() => {
    try {
      const { Audio } = require('expo-av');
      AudioRef.current = Audio;
      setAvReady(true);
    } catch {
      setAvReady(false);
    }
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!avReady || !AudioRef.current) {
      setPhase('text_input');
      return;
    }
    const Audio = AudioRef.current;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone needed',
          'Allow microphone access to record voice notes, or type your note instead.',
          [
            { text: 'Type instead', onPress: () => setPhase('text_input') },
            { text: 'OK' },
          ]
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setPhase('recording');
    } catch (e: any) {
      Alert.alert('Could not start recording', e.message || 'Try typing your note instead.');
      setPhase('text_input');
    }
  }, [avReady]);

  // ── Stop + process ───────────────────────────────────────────────────────────
  const stopAndProcess = useCallback(async () => {
    if (!recordingRef.current) return;
    setPhase('processing');

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri  = recordingRef.current.getURI();
      recordingRef.current = null;

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
      const msg = e.response?.data?.error || e.message || 'Could not process audio.';
      Alert.alert('Processing error', msg + '\n\nWould you like to type your note instead?', [
        { text: 'Type instead', onPress: () => setPhase('text_input') },
        { text: 'Try again',    onPress: () => setPhase('idle') },
      ]);
    }
  }, []);

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
      Alert.alert('Recording Error', 'Could not structure your note. Try again.');
      setPhase('text_input');
    }
  }, [textIn]);

  // ── Save to case ─────────────────────────────────────────────────────────────
  const saveToCase = useCallback(async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      const combined = existingNotes
        ? existingNotes + '\n\n' + editText.trim()
        : editText.trim();

      if (caseId) {
        await api.put(`/cases/${caseId}`, { notes: combined });
      }
      if (onSave) onSave(combined);
      navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [editText, existingNotes, caseId, onSave, navigation]);

  // ── Format note for case notes field ─────────────────────────────────────────
  function formatNoteForCase(n: StructuredNote): string {
    let out = `📝 ${n.date}\n\n`;
    out += `${n.summary}\n`;
    if (n.next_steps?.length) {
      out += `\nNext steps:\n`;
      n.next_steps.forEach(s => { out += `• ${s}\n`; });
    }
    if (n.flags?.length) {
      out += `\n⚑ Flagged:\n`;
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
            <Text maxFontSizeMultiplier={1.4} style={[styles.casePillText, { color: COLORS.navy }]} numberOfLines={1}>
              📁  {caseTitle}
            </Text>
          </View>
        )}
        <Text maxFontSizeMultiplier={1.4} style={[styles.headline, { color: colors.textPrimary }]}>
          Voice note
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          Speak for up to 5 minutes.{'\n'}
          We'll transcribe and structure it for you.
        </Text>

        {/* Big mic button */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.micBtnWrap}
          onPress={startRecording}
          activeOpacity={0.85}
          accessibilityLabel="Start recording voice note"
        >
          <View style={[styles.micBtn, { backgroundColor: COLORS.navy }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.micIcon}>🎙</Text>
          </View>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.4} style={[styles.tapHint, { color: colors.textMuted }]}>Tap to start recording</Text>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.typeLink}
          accessibilityLabel="\u270f\ufe0f  Type instead" onPress={() => setPhase('text_input')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.typeLinkText, { color: COLORS.steel }]}>
            ✏️  Type instead
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── RENDER: Recording ────────────────────────────────────────────────────────
  if (phase === 'recording') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.timer, { color: COLORS.emergency }]}>{timer}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.recordingLabel, { color: colors.textMuted }]}>Recording…</Text>

        {/* Pulsing stop button */}
        <View style={styles.micBtnWrap}>
          <PulseRing active />
          <TouchableOpacity accessibilityRole="button"
            style={[styles.micBtn, { backgroundColor: COLORS.emergency }]}
            onPress={stopAndProcess}
            activeOpacity={0.85}
            accessibilityLabel="Stop recording and process note"
          >
            <View style={styles.stopSquare} />
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={[styles.tapHint, { color: colors.textMuted }]}>Tap to stop</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.recordingTip, { color: colors.textMuted }]}>
          Speak naturally -- mention client name, key facts, next steps, any deadlines
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
          Structuring your note…
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          Transcribing audio then extracting{'\n'}summary, next steps, and flags
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
      <ScrollView contentContainerStyle={styles.textInputScroll} keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {caseTitle && (
          <View style={[styles.casePill, { backgroundColor: COLORS.navy + '18', borderColor: COLORS.navy + '33' }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.casePillText, { color: COLORS.navy }]} numberOfLines={1}>
              📁  {caseTitle}
            </Text>
          </View>
        )}
        <Text maxFontSizeMultiplier={1.4} style={[styles.headline, { color: colors.textPrimary }]}>Type your note</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.subline, { color: colors.textMuted }]}>
          Describe the meeting, key facts, next steps -- we'll structure it automatically.
        </Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: colors.bgCard,
            borderColor: colors.border, color: colors.textPrimary }]}
          multiline
              maxLength={2000}
          numberOfLines={10}
          placeholder={"e.g. Met with Johnson today in the jail lobby. He claims he was home all evening. Alibi is his girlfriend Maria Santos, needs to be interviewed. Police report lists wrong address. Motion to suppress may be viable. Next hearing is March 22 at 9am courtroom 4. Need to file discovery request by March 15."}
          placeholderTextColor={COLORS.textSecond}
          value={textIn}
          onChangeText={setTextIn}
          textAlignVertical="top"
          accessibilityLabel="Type your case note"

          returnKeyType="next"
          blurOnSubmit
        />
        <TouchableOpacity
          accessibilityRole="button" activeOpacity={0.6}
          style={[styles.processBtn, { backgroundColor: COLORS.navy },
            !textIn.trim() && { opacity: 0.45 }]}
          onPress={processText}
          disabled={!textIn.trim()}
          accessibilityLabel="Structure this note"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.processBtnText}>Structure This Note →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.typeLink}
          accessibilityLabel="\u2190 Use voice instead" onPress={() => setPhase('idle')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.typeLinkText, { color: COLORS.steel }]}>← Use voice instead</Text>
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
                <Text maxFontSizeMultiplier={1.4} style={[styles.resultSectionTitle, { color: COLORS.legal }]}>Next steps</Text>
                {note.next_steps.map((s, i) => (
                  <View key={i} style={styles.resultBulletRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBullet, { color: COLORS.legal }]}>›</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.resultBulletText, { color: colors.textSecond }]}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {note.flags?.length > 0 && (
              <View style={[styles.resultSection, { backgroundColor: isDark ? colors.bailBg : colors.warnBg, borderColor: colors.warn }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.resultSectionTitle, { color: COLORS.bail }]}>⚑ Flagged</Text>
                {note.flags.map((f, i) => (
                  <View key={i} style={styles.resultBulletRow}>
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
          Edit before saving
        </Text>
        <TextInput
          style={[styles.textArea, styles.editArea,
            { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
          multiline
              maxLength={2000}
          value={editText}
          onChangeText={setEditText}
          textAlignVertical="top"
          accessibilityLabel="Edit structured note before saving"
        />

        <TouchableOpacity
          accessibilityRole="button" activeOpacity={0.6}
          style={[styles.saveBtn, { backgroundColor: COLORS.navy }, saving && { opacity: 0.6 }]}
          onPress={saveToCase}
          disabled={saving}
          accessibilityLabel="Save note to case"
        >
          {saving
            ? <ActivityIndicator color={colors.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>
                {caseId ? '💾  Save to Case' : '💾  Copy Note'}
              </Text>}
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.shareNoteBtn, { borderColor: COLORS.navy + '55' }]}
          onPress={async () => { try {
            await Share.share({ message: editText, title: 'Case Note' });
          } catch (shareErr: any) { /* ignore */ }
          }}
          accessibilityLabel="Share note"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.shareNoteBtnText, { color: COLORS.navy }]}>↑  Share Note</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.typeLink}
          accessibilityLabel="\ud83c\udf99  Record another note" onPress={() => { setPhase('idle'); setNote(null); setEditText(''); }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.typeLinkText, { color: COLORS.steel }]}>🎙  Record another note</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
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
const styles = makeStyles(COLORS);