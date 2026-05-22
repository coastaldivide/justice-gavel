/**
 * InterrogationRecorderScreen
 *
 * Police encounter stenographer.
 * Records audio → transcribes via Whisper → Claude tags speakers →
 * generates PDF with timestamps, speaker labels, rights analysis.
 *
 * One large red button. Plain language. No distractions.
 * Built for use during or immediately after a police encounter.
 */
import React, { useState, useRef, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import {
  View, Text, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, Linking, Share, RefreshControl, Platform} from 'react-native';
// Audio -- native only. Web uses MediaRecorder API (see handleWebRecord below)
const Audio = Platform.OS === 'web' ? null : require('expo-av').Audio;
import * as Location from 'expo-location';
import { FileSystem, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api} from '../services/api';
import { useTheme } from '../constants/theme';
import { getToken } from '../utils/secureStorage';

type Phase = 'law_check' | 'ready' | 'recording' | 'processing' | 'done' | 'error';

const TWO_PARTY_STATES = new Set([
  'CA','CT','FL','IL','MD','MA','MI','MT','NH','OR','PA','WA','WI'
]);

export default function InterrogationRecorderScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await fetchLaw(''); } catch {}
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 800);
  }, []);

  const [phase, setPhase]         = useState<Phase>('ready');
  const [elapsed, setElapsed]     = useState(0);
  const [userState, setUserState] = useState('');
  const [recordingLaw, setLaw]    = useState<any>(null);
  const [transcript, setTranscript] = useState('');
  const [dialogue, setDialogue]   = useState<any[]>([]);
  const [pdfBase64, setPdf]       = useState('');
  const [docId, setDocId]         = useState('');
  const [error, setError]         = useState('');
  const [location, setLocation]   = useState('');

  const recordingRef = useRef<any>(null);
  const timerRef     = useRef<any>(null);
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  // Load user state for consent law check
  useEffect(() => {
    AsyncStorage.getItem('user_state').then(s => {
      if (s && mountedRef.current) {
        setUserState(s);
        fetchLaw(s);
      }
    }).catch(() => {});
  }, []);

  const fetchLaw = async (state: string) => {
    try {
      const res = await api.get(`/interrogation/recording-law?state=${state}`);
      if (mountedRef.current) setLaw(res.data || null);
    } catch { /* use default */ }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return '';
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      return geo ? `${geo.city || ''}, ${geo.region || ''} ${geo.postalCode || ''}`.trim() : '';
    } catch { return ''; }
  };

  const startRecording = async () => {
    // Two-party consent warning
    if (TWO_PARTY_STATES.has(userState) && !recordingLaw?.acknowledged) {
      Alert.alert(
        '⚠️ Recording Law -- ' + userState,
        (recordingLaw?.note || 'Your state may require all parties to consent to recording.') +
        '\n\nRecording police in PUBLIC spaces is generally protected by the First Amendment.',
        [
          { text: 'I Understand -- Start Recording', style: 'default', onPress: () => doStartRecording() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    doStartRecording();
  };

  const doStartRecording = async () => {
    try {
      hapticImpact();
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Microphone access needed', 'Go to Settings → Justice Gavel → Microphone and enable access.', [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }]);
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

      const loc = await getLocation();
      if (mountedRef.current) setLocation(loc);

      setElapsed(0);
      setPhase('recording');
      timerRef.current = setInterval(() => {
        if (mountedRef.current) setElapsed(n => n + 1);
      }, 1000);

    } catch (e: any) {
      Alert.alert('Could not start recording', e.message || 'Check microphone permissions.');
    }
  };

  const stopAndProcess = async () => {
    hapticNotification();
    clearInterval(timerRef.current);
    setPhase('processing');

    try {
      await recordingRef.current?.stopAndUnloadAsync();
      const uri = recordingRef.current?.getURI();
      if (!uri) throw new Error('No recording found');

      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      let userData: any = {}; try { const _u = await AsyncStorage.getItem('user'); if (_u) userData = JSON.parse(_u); } catch {}

      // Build FormData
      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: `encounter_${Date.now()}.m4a`,
      } as any);
      formData.append('state', userState || '');
      formData.append('userName', userData.displayName || userData.name || '');
      formData.append('location', location);
      formData.append('dateTime', new Date().toLocaleString('en-US', { timeZoneName: 'short' }));

      const res = await fetch(
        (process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000/api') + '/interrogation/transcribe',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await getToken() || ''}`,
          },
          body: formData,
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Processing failed');

      if (!mountedRef.current) return;
      setTranscript(data.transcript || '');
      setDialogue(data.dialogue || []);
      setPdf(data.pdf_base64 || '');
      setDocId(data.doc_id || '');
      setPhase('done');

    } catch (e: any) {
      if (!mountedRef.current) return;
      setError('Could not process recording. Make sure you have internet access and try again.');
      setPhase('error');
    }
  };

  const savePDF = async () => {
    if (!pdfBase64) return;
    try {
      const path = `${FileSystem.documentDirectory}encounter_${docId || Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(path, pdfBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Share.share({
        url: path,
        title: 'Police Encounter Transcript',
        message: 'My police encounter transcript from Justice Gavel',
      });
    } catch {
      Alert.alert('Save failed', 'Could not save PDF. Please try again.');
    }
  };

  const reset = () => {
    setPhase('ready');
    setElapsed(0);
    setTranscript('');
    setDialogue([]);
    setPdf('');
    setError('');
  };

  const speakerColor = (speaker: string) => {
    if (speaker === 'OFFICER') return colors.emergencyDark;
    if (speaker === 'SUSPECT') return colors.blue;
    return colors.textMuted;
  };
  const speakerLabel = (speaker: string) =>
    speaker === 'SUSPECT' ? 'YOU' : speaker;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── Header ──────────────────────────────────── */}
      <View style={[styles.headerBox, { backgroundColor: colors.emergency }]}>
        <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>
          🎙 ENCOUNTER RECORDER
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerSub}>
          Records, transcribes, and generates a PDF of your interaction with police.
          You are innocent until proven guilty.
        </Text>
      </View>

      {/* ── 911 Strip ───────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.emergencyBtn, { backgroundColor: colors.emergency }]}
          onPress={() => Linking.openURL('tel:911').catch(() => {})}
        >
          <Text maxFontSizeMultiplier={1.2} style={styles.emergencyBtnText}>🚨 CALL 911</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.emergencyBtn, { backgroundColor: colors.blue }]}
          accessibilityRole="button"
          onPress={() => Linking.openURL('tel:988').catch(() => {})}
        >
          <Text maxFontSizeMultiplier={1.2} style={styles.emergencyBtnText}>💙 CRISIS 988</Text>
        </TouchableOpacity>
      </View>

      {/* ── Recording consent law ────────────────────── */}
      {recordingLaw && (
        <View style={[styles.lawBox, {
          backgroundColor: recordingLaw.warn ? colors.warnBg : colors.legalBg,
          borderLeftColor: recordingLaw.warn ? '#F9A825' : colors.legal,
        }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.lawTitle,
            { color: recordingLaw.warn ? colors.textMuted : colors.legal }]}>
            {recordingLaw.warn ? '⚠️ ' : '✅ '}{recordingLaw.consent === 'two-party' ? 'All-party consent state' : 'One-party consent state -- recording is legal'}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.lawNote, { color: recordingLaw.warn ? colors.textMuted : colors.legal }]}>
            {recordingLaw.note}
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={[styles.lawCite, { color: colors.textMuted }]}>
            {recordingLaw.law}
          </Text>
        </View>
      )}

      {/* ── Rights reminder ──────────────────────────── */}
      <View style={[styles.rightsBox, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rightsTitle, { color: colors.textPrimary }]}>
          Before you record -- say these words:
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsScript, { color: colors.blue }]}>
          "I am invoking my right to remain silent. I want a lawyer."
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rightsTitle, { color: colors.textPrimary, marginTop: 8 }]}>
          If they ask to search:
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsScript, { color: colors.blue }]}>
          "I do not consent to any searches."
        </Text>
      </View>

      {/* ── Main recording control ───────────────────── */}
      {phase === 'ready' && (
        <TouchableOpacity
          style={styles.recordBtn}
          onPress={startRecording}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Start recording police encounter"
          accessibilityHint="Records audio and generates a timestamped transcript PDF">
          <Text style={styles.recordBtnIcon}>🎙</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.recordBtnText}>START RECORDING</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.recordBtnSub}>Tap to begin -- tap again to stop</Text>
        </TouchableOpacity>
      )}

      {phase === 'recording' && (
        <>
          <View style={[styles.recordingActive, { backgroundColor: colors.emergency }]}>
            <View style={styles.recordingDot} />
            <Text maxFontSizeMultiplier={1.2} style={styles.recordingTime}>
              REC  {formatTime(elapsed)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.stopBtn, { backgroundColor: colors.bgCard, borderColor: colors.emergency }]}
            onPress={stopAndProcess}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.stopBtnText, { color: colors.emergency }]}>
              ⏹  STOP & TRANSCRIBE
            </Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>
            Keep the app open. Your recording is saved on device.
          </Text>
        </>
      )}

      {phase === 'processing' && (
        <View style={[styles.processingBox, { backgroundColor: colors.bgCard }]}>
          <ActivityIndicator size="large" color={colors.blue} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.processingText, { color: colors.textPrimary }]}>
            Transcribing and generating PDF…
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.processingNote, { color: colors.textMuted }]}>
            This takes 30-90 seconds depending on length.
          </Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={[styles.errorBox, { backgroundColor: colors.emergencyBg }]}>
          <Text maxFontSizeMultiplier={1.3} style={styles.errorTitle}>Could not process</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.errorMsg}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reset}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'done' && (
        <>
          {/* Save PDF */}
          {pdfBase64 ? (
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.legalDark }]}
              onPress={savePDF}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.2} style={styles.saveBtnText}>
                📄  Save & Share PDF
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.saveBtnSub}>
                Send to your attorney immediately
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Transcript */}
          <View style={[styles.transcriptBox, { backgroundColor: colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.transcriptHeader, { color: colors.textPrimary }]}>
              TRANSCRIPT
            </Text>
            {dialogue.length > 0 ? (
              dialogue.map((line, i) => (
                <View key={i} style={[styles.dialogueLine,
                  { backgroundColor: i % 2 === 0 ? colors.bgSubtle : colors.bgCard }]}>
                  <Text maxFontSizeMultiplier={1.2} style={[styles.dialogueTs, { color: colors.textFaint }]}>
                    {line.timestamp}
                  </Text>
                  <Text maxFontSizeMultiplier={1.2} style={[styles.dialogueSpk, { color: speakerColor(line.speaker) }]}>
                    {speakerLabel(line.speaker)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.dialogueTxt, { color: colors.textPrimary }]}>
                    {line.text}
                  </Text>
                </View>
              ))
            ) : (
              <Text maxFontSizeMultiplier={1.3} style={[styles.rawTranscript, { color: colors.textSecond }]}>
                {transcript}
              </Text>
            )}
          </View>

          {/* Record again */}
          <TouchableOpacity
            style={[styles.recordAgainBtn, { backgroundColor: colors.bgElevated }]}
            onPress={reset}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.recordAgainText, { color: colors.textSecond }]}>
              + Record Another Encounter
            </Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── What this does ───────────────────────────── */}
      {phase === 'ready' && (
        <View style={[styles.infoBox, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.infoTitle, { color: colors.textPrimary }]}>
            What this does:
          </Text>
          {[
            '🎙 Records audio on your device',
            '📝 Transcribes every word with timestamps',
            '🏷 Identifies who said what (Officer vs. You)',
            '📄 Generates a PDF with automated rights analysis',
            '📤 Lets you share the PDF with your attorney instantly',
            '🔒 Recording stays on your device until you share it',
          ].map((item, i) => (
            <Text key={i} maxFontSizeMultiplier={1.3} style={[styles.infoItem, { color: colors.textSecond }]}>
              {item}
            </Text>
          ))}
        </View>
      )}

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: '#555', fontStyle: 'italic' }}>
          ⚖️ General legal information only -- not legal advice. Laws vary by
          jurisdiction and change frequently. Consult a licensed attorney for
          advice specific to your situation.
        </Text>
      </View>
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  headerBox:     { borderRadius: 16, padding: 20, marginBottom: 16 },
  headerTitle:   { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  headerSub:     { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19 },
  emergencyBtn:  { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  emergencyBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  lawBox:        { borderRadius: 12, padding: 14, borderLeftWidth: 5, marginBottom: 16 },
  lawTitle:      { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  lawNote:       { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  lawCite:       { fontSize: 10, fontStyle: 'italic' },
  rightsBox:     { borderRadius: 14, padding: 16, marginBottom: 20 },
  rightsTitle:   { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  rightsScript:  { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  recordBtn:     { backgroundColor: colors.emergency, borderRadius: 20, paddingVertical: 32, alignItems: 'center', marginBottom: 16, elevation: 4 },
  recordBtnIcon: { fontSize: 48, marginBottom: 8 },
  recordBtnText: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  recordBtnSub:  { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
  recordingActive: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 18, marginBottom: 12 },
  recordingDot:  { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
  recordingTime: { color: '#fff', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stopBtn:       { borderRadius: 14, paddingVertical: 20, alignItems: 'center', borderWidth: 2, marginBottom: 12 },
  stopBtnText:   { fontSize: 18, fontWeight: '900' },
  hint:          { fontSize: 12, textAlign: 'center', marginBottom: 16 },
  processingBox: { borderRadius: 16, padding: 32, alignItems: 'center', gap: 16, marginBottom: 16 },
  processingText:{ fontSize: 16, fontWeight: '700', textAlign: 'center' },
  processingNote:{ fontSize: 12, textAlign: 'center' },
  errorBox:      { borderRadius: 14, padding: 20, marginBottom: 16 },
  errorTitle:    { color: colors.emergency, fontSize: 18, fontWeight: '900', marginBottom: 8 },
  errorMsg:      { color: colors.emergency, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  retryBtn:      { backgroundColor: colors.emergency, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  retryBtnText:  { color: '#fff', fontWeight: '800', fontSize: 15 },
  saveBtn:       { borderRadius: 16, paddingVertical: 20, alignItems: 'center', marginBottom: 20, elevation: 3 },
  saveBtnText:   { color: '#fff', fontSize: 18, fontWeight: '900' },
  saveBtnSub:    { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4 },
  transcriptBox: { borderRadius: 14, padding: 16, marginBottom: 16 },
  transcriptHeader: { fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  dialogueLine:  { flexDirection: 'row', gap: 8, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 6, marginBottom: 4 },
  dialogueTs:    { fontSize: 10, width: 36, marginTop: 2, fontVariant: ['tabular-nums'] },
  dialogueSpk:   { fontSize: 10, fontWeight: '900', width: 52, marginTop: 2, letterSpacing: 0.5 },
  dialogueTxt:   { flex: 1, fontSize: 13, lineHeight: 18 },
  rawTranscript: { fontSize: 13, lineHeight: 20 },
  recordAgainBtn:{ borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  recordAgainText:{ fontSize: 14, fontWeight: '700' },
  infoBox:       { borderRadius: 14, padding: 16 },
  infoTitle:     { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  infoItem:      { fontSize: 12, lineHeight: 22 },
});
