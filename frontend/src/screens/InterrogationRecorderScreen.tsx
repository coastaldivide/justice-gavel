import { AIDisclaimer } from '../components/AIDisclaimer';
import { requestLocationInContext, locationGranted } from '../services/permissions';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
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
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Linking,
  RefreshControl,
  Platform,
  LayoutAnimation,
  InteractionManager,
} from 'react-native';
// Audio -- native only (web uses InterrogationRecorderScreen.web.tsx).
import {
  useAudioRecorder, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import * as Location from 'expo-location';
import { FileSystem, hapticImpact, hapticNotification, RNShare } from '../utils/webCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, API_BASE_URL } from '../services/api';
import { useTheme, COLORS } from '../constants/theme';
import { getToken, getItem as getSecureItem } from '../utils/secureStorage';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

type Phase = 'law_check' | 'ready' | 'recording' | 'processing' | 'done' | 'error';

// Two-party consent states — all-party consent required for recording
// Populated with both 2-letter codes (Android) and full names (iOS)
// because Location.reverseGeocodeAsync returns different formats per platform.
// Wrong warning in a two-party state = potential felony for the user.
const TWO_PARTY_STATE_CODES = new Set([
  'CA','CT','FL','IL','MD','MA','MI','MT','NH','OR','PA','WA','WI',
]);
// Region names as the device geocoder reports them (English) — matched, not shown.
const TWO_PARTY_STATE_NAMES = new Set([ // i18n-exempt: matched against geocoder output
  'California','Connecticut','Florida','Illinois','Maryland','Massachusetts', // i18n-exempt: geocoder names
  'Michigan','Montana','New Hampshire','Oregon','Pennsylvania','Washington','Wisconsin', // i18n-exempt: geocoder names
]);
// Normalize any region string to abbreviation for consistent checking
const normalizeStateCode = (region: string): string => {
  const upper = region?.trim().toUpperCase() ?? '';
  // Already a 2-letter code
  if (upper.length === 2) return upper;
  // Full name → abbreviation map for two-party states
  const NAME_TO_CODE: Record<string, string> = {
    'CALIFORNIA':'CA','CONNECTICUT':'CT','FLORIDA':'FL','ILLINOIS':'IL',
    'MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MONTANA':'MT',
    'NEW HAMPSHIRE':'NH','OREGON':'OR','PENNSYLVANIA':'PA',
    'WASHINGTON':'WA','WISCONSIN':'WI',
  };
  return NAME_TO_CODE[upper] || upper;
};
const TWO_PARTY_STATES = {
  has: (region: string) => {
    const code = normalizeStateCode(region);
    return TWO_PARTY_STATE_CODES.has(code) ||
           TWO_PARTY_STATE_NAMES.has(region?.trim() ?? '');
  },
};

function InterrogationRecorderScreen(): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLaw(userState);
    if (mountedRef.current) setRefreshing(false);
  };

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
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const recorder   = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timerRef   = useRef<any>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const _task = InteractionManager.runAfterInteractions(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    });
    return () => {
      _task.cancel();
      mountedRef.current = false;
      clearInterval(timerRef.current);
      // Any active recording is stopped and the microphone released by the
      // useAudioRecorder hook when this screen unmounts.
    };
  }, []);

  // Determine consent law from CURRENT LOCATION at mount time — not stored profile.
  // The governing two-party consent law is where the RECORDING HAPPENS, not where
  // the user lives. A user arrested across a state line gets the wrong warning
  // if we read from their profile. Wrong warning in a two-party state = felony exposure.
  useEffect(() => {
    (async () => {
      try {
        const answer = await requestLocationInContext(t('x_interrogation_recorder_recording_consent_law_depends'));
        if (answer === 'granted' && mountedRef.current) {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          const detectedState = geo?.region || geo?.isoCountryCode || '';
          if (detectedState && mountedRef.current) {
            setUserState(detectedState);
            fetchLaw(detectedState);
          }
        } else {
          // Fallback to stored profile state if location denied
          AsyncStorage.getItem('user_state').then(s => {
            if (s && mountedRef.current) {
              setUserState(s);
              fetchLaw(s);
            }
          }).catch(() => {});
        }
      } catch {
        // Fallback to stored state on any location error
        AsyncStorage.getItem('user_state').then(s => {
          if (s && mountedRef.current) { setUserState(s); fetchLaw(s); }
        }).catch(() => {});
      }
    })();
  }, []);

  const fetchLaw = async (state: string) => {
    if (!state) return;
    try {
      const res = await api.get(`/interrogation/recording-law?state=${encodeURIComponent(state)}`);
      if (mountedRef.current) setLaw(res.data || null);
    } catch { /* offline: the general warning below still shows */ }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getLocation = async () => {
    try {
      if (!(await locationGranted())) return '';   // asked (with a reason) on open
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      return geo ? `${geo.city || ''}, ${geo.region || ''} ${geo.postalCode || ''}`.trim() : '';
    } catch { return ''; }
  };

  const startRecording = async () => {
    // Two-party consent warning
    if (TWO_PARTY_STATES.has(userState) || recordingLaw?.consent === 'two-party') {
      confirm(t('x_interrogation_recorder_two_party_consent_warning'), t('x_interrogation_recorder_custodial_interrogation_note_likely', { value: (recordingLaw?.note || t('x_interrogation_recorder_state_may_require_all')) }),
      { confirmLabel: t('x_interrogation_recorder_i_understand_start_recording') }).then(ok => { if (ok) doStartRecording(); });
      return;
    }
    doStartRecording();
  };

  const doStartRecording = async () => {
    try {
      hapticImpact();
      const { status } = await requestRecordingPermissionsAsync();
      if (status !== 'granted') {
        showToast(t('x_interrogation_recorder_allow_microphone_access_settings'), 'warning');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();

      const loc = await getLocation();
      if (mountedRef.current) setLocation(loc);

      setElapsed(0);
      setPhase('recording');
      timerRef.current = setInterval(() => {
        if (mountedRef.current) setElapsed(n => n + 1);
      }, 1000);

    } catch (e: any) {
      showToast(e.message || t('x_interrogation_recorder_check_microphone_permissions'), 'error');
    }
  };

  const stopAndProcess = async () => {
    hapticNotification();
    clearInterval(timerRef.current);
    setPhase('processing');

    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording found');


      let userData: any = {}; try { const _u = await getSecureItem('user'); if (_u) userData = JSON.parse(_u); } catch {}

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
        API_BASE_URL + '/interrogation/transcribe',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await getToken() || ''}`,
          },
          body: formData,
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (mountedRef.current) {
          setFailedUri(uri);
          setError(res.status === 401 ? t('ir_sign_in_to_transcribe') : res.status === 503 ? t('ir_transcription_unavailable')
            : (data.error || t('x_interrogation_recorder_could_not_process_recording')));
          setPhase('error');
        }
        return;
      }

      if (!mountedRef.current) return;
      setTranscript(data.transcript || '');
      setDialogue(data.dialogue || []);
      setPdf(data.pdf_base64 || '');
      setDocId(data.doc_id || '');
      setPhase('done');

    } catch {
      if (!mountedRef.current) return;
      setFailedUri(recorder.uri || null);
      setError(t('x_interrogation_recorder_could_not_process_recording'));
      setPhase('error');
    }
  };

  // The audio stays on the phone when processing fails: let the person keep it.
  const saveRecording = async () => {
    if (!failedUri) return;
    try { await RNShare.share({ url: failedUri, title: t('x_interrogation_recorder_police_encounter_transcript') }); }
    catch { showToast(t('x_interrogation_recorder_could_not_save_pdf'), 'error'); }
  };

  const savePDF = async () => {
    if (!pdfBase64) return;
    try {
      const path = `${FileSystem.documentDirectory}encounter_${docId || Date.now()}.pdf`;
      Platform.OS !== 'web' ? (await FileSystem.writeAsStringAsync(path, pdfBase64, {
        encoding: FileSystem.EncodingType.Base64,
      })) : null;
      await RNShare.share({
        url: path,
        title: t('x_interrogation_recorder_police_encounter_transcript'),
        message: t('x_interrogation_recorder_my_police_encounter_transcript'),
      });
    } catch {
      showToast(t('x_interrogation_recorder_could_not_save_pdf'));
    }
  };

  const reset = () => {
    setFailedUri(null);
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
    speaker === 'SUSPECT' ? t('x_interrogation_recorder_text') : speaker === 'OFFICER' ? t('ir_officer') : t('ir_unknown_speaker');

  return (
    <ScrollView
      testID="interrogation-recorder-screen"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      keyboardShouldPersistTaps="handled"
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── Header ──────────────────────────────────── */}
      <View style={[styles.headerBox, { backgroundColor: colors.emergency }]}>
        <IconLabel icon={ICONS.record} textStyle={styles.headerTitle} maxFontSizeMultiplier={1.2}>{t('x_interrogation_recorder_encounter_recorder')}</IconLabel>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerSub}>
          {t('x_interrogation_recorder_records_transcribes_generates_pdf')}
        </Text>
      </View>

      {/* ── 911 Strip ───────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.emergencyBtn, { backgroundColor: colors.emergencyDark }]}
          accessibilityLabel={t('x_emergency_call_911')} onPress={() => Linking.openURL('tel:911').catch(() => showToast(t('x_interrogation_recorder_please_dial_911'), 'error'))}
        >
          <IconLabel icon={ICONS.emergency} textStyle={styles.emergencyBtnText} maxFontSizeMultiplier={1.2}>{t('x_interrogation_recorder_call_911')}</IconLabel>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.emergencyBtn, { backgroundColor: colors.blue }]}
          accessibilityLabel={t('x_interrogation_recorder_crisis_988')} onPress={() => Linking.openURL('tel:988').catch(() => showToast(t('action_failed'), 'error'))}
        >
          <IconLabel icon={ICONS.crisis} textStyle={styles.emergencyBtnText} maxFontSizeMultiplier={1.2}>{t('x_interrogation_recorder_crisis_988')}</IconLabel>
        </TouchableOpacity>
      </View>

      {/* ── Recording consent law ────────────────────── */}
      {recordingLaw && (
        <View style={[styles.lawBox, {
          backgroundColor: recordingLaw.warn ? colors.warnBg : colors.legalBg,
          borderLeftColor: recordingLaw.warn ? COLORS.steelMid : colors.legal,
        }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.lawTitle,
            { color: recordingLaw.warn ? colors.textMuted : colors.legal }]}>
            {recordingLaw.warn ? '⚠️ ' : '✅ '}{recordingLaw.consent === 'two-party' ? t('x_interrogation_recorder_all_party_consent_state') : t('x_interrogation_recorder_one_party_consent_state')}
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
          {t('x_interrogation_recorder_before_record_say_these')}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsScript, { color: colors.textBrand }]}>
          {t('x_interrogation_recorder_i_am_invoking_my')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rightsTitle, { color: colors.textPrimary, marginTop: 8 }]}>
          {t('x_interrogation_recorder_if_they_ask_search')}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsScript, { color: colors.textBrand }]}>
          {t('x_interrogation_recorder_i_do_not_consent')}
        </Text>
      </View>

      {/* ── Main recording control ───────────────────── */}
      {phase === 'ready' && (
        <TouchableOpacity accessibilityRole="button"
          style={styles.recordBtn}
          onPress={startRecording}
          activeOpacity={0.85}
          accessibilityLabel={t('x_interrogation_recorder_start_recording_police_encounter')}
          accessibilityHint={t('x_interrogation_recorder_records_audio_generates_timestamped')}>
          <IconLabel icon={ICONS.record} textStyle={styles.recordBtnIcon}></IconLabel>
          <Text maxFontSizeMultiplier={1.2} style={styles.recordBtnText}>{t('x_interrogation_recorder_start_recording')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.recordBtnSub}>{t('x_interrogation_recorder_tap_begin_tap_again')}</Text>
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
      accessibilityLabel={t('x_interrogation_recorder_stop_transcribe')} accessibilityRole="button"
            style={[styles.stopBtn, { backgroundColor: colors.bgCard, borderColor: colors.emergency }]}
            onPress={stopAndProcess}
            activeOpacity={0.85}
          >
            <IconLabel icon={ICONS.stop} textStyle={[styles.stopBtnText, { color: colors.emergency }]} maxFontSizeMultiplier={1.2}>{t('x_interrogation_recorder_stop_transcribe_2')}</IconLabel>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>
            {t('x_interrogation_recorder_keep_app_open_recording')}
          </Text>
        </>
      )}

      {phase === 'processing' && (
        <View style={[styles.processingBox, { backgroundColor: colors.bgCard }]}>
          <ActivityIndicator size="large" color={colors.blue} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.processingText, { color: colors.textPrimary }]}>
            {t('x_interrogation_recorder_transcribing_generating_pdf')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.processingNote, { color: colors.textMuted }]}>
            {t('x_interrogation_recorder_this_takes_30_90')}
          </Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={[styles.errorBox, { backgroundColor: colors.emergencyBg }]}>
          <Text maxFontSizeMultiplier={1.3} style={styles.errorTitle}>{t('x_interrogation_recorder_could_not_process')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.errorMsg}>{error}</Text>
          {!!failedUri && (
            <TouchableOpacity accessibilityRole="button" style={[styles.retryBtn, { marginBottom: 8 }]} onPress={saveRecording}
              accessibilityLabel={t('ir_save_recording')}>
              <IconLabel icon={ICONS.save} textStyle={styles.retryBtnText} maxFontSizeMultiplier={1.2}>{t('ir_save_recording')}</IconLabel>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button" style={styles.retryBtn} onPress={reset}
           accessibilityLabel={t('help_now_error_retry')}>
            <Text maxFontSizeMultiplier={1.2} style={styles.retryBtnText}>{t('help_now_error_retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'done' && (
        <>
          {/* Save PDF */}
          {pdfBase64 ? (
            <TouchableOpacity
      accessibilityLabel={t('x_interrogation_recorder_save_share_pdf')}
              accessibilityRole="button"
              style={[styles.saveBtn, { backgroundColor: colors.legalDark }]}
              onPress={savePDF}
              activeOpacity={0.85}
            >
              <IconLabel icon={ICONS.document} textStyle={styles.saveBtnText} maxFontSizeMultiplier={1.2}>{t('x_interrogation_recorder_save_share_pdf_2')}</IconLabel>
              <Text maxFontSizeMultiplier={1.3} style={styles.saveBtnSub}>
                {t('x_interrogation_recorder_send_attorney_immediately')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Transcript */}
          <View style={[styles.transcriptBox, { backgroundColor: colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.transcriptHeader, { color: colors.textPrimary }]}>
              {t('x_interrogation_recorder_transcript')}
            </Text>
            {dialogue.length > 0 ? (
              dialogue.map((line, i) => (
                <View key={`dialogue-${i}`} style={[styles.dialogueLine,
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
      accessibilityLabel={t('x_interrogation_recorder_record_another_encounter')} accessibilityRole="button"
            style={[styles.recordAgainBtn, { backgroundColor: colors.bgElevated }]}
            onPress={reset}
            activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.recordAgainText, { color: colors.textSecond }]}>
              {t('x_interrogation_recorder_record_another_encounter')}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── What this does ───────────────────────────── */}
      {phase === 'ready' && (
        <View style={[styles.infoBox, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.infoTitle, { color: colors.textPrimary }]}>
            {t('x_interrogation_recorder_what_this_does')}
          </Text>
          {[
            t('x_interrogation_recorder_records_audio_device'),
            t('x_interrogation_recorder_transcribes_every_word_with'),
            t('x_interrogation_recorder_identifies_who_said_what'),
            t('x_interrogation_recorder_generates_pdf_with_automated'),
            t('x_interrogation_recorder_lets_share_pdf_with'),
            t('x_interrogation_recorder_recording_stays_device_until'),
          ].map((item, i) => (
            <Text key={`item-${i}`} maxFontSizeMultiplier={1.3} style={[styles.infoItem, { color: colors.textSecond }]}>
              {item}
            </Text>
          ))}
        </View>
      )}

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <IconLabel icon={ICONS.lawyer} textStyle={{ fontSize: 11, lineHeight: 16,
          color: colors.textSecond, fontStyle: 'italic' }} maxFontSizeMultiplier={1.3}>{t('x_interrogation_recorder_general_legal_information_only')}</IconLabel>
      </View>
      <AIDisclaimer variant="banner" />

      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  headerBox:     { borderRadius: 16, padding: 20, marginBottom: 16 },
  headerTitle:   { color: colors.bg, fontSize: 20, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  headerSub:     { color: colors.textOnAccent, fontSize: 13, lineHeight: 19 },
  emergencyBtn:  { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  emergencyBtnText: { color: colors.white, fontWeight: '900', fontSize: 14 },
  lawBox:        { borderRadius: 12, padding: 14, borderLeftWidth: 5, marginBottom: 16 },
  lawTitle:      { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  lawNote:       { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  lawCite:       { fontSize: 10, fontStyle: 'italic' },
  rightsBox:     { borderRadius: 14, padding: 16, marginBottom: 20 },
  rightsTitle:   { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  rightsScript:  { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  recordBtn:     { backgroundColor: colors.emergency, borderRadius: 20, paddingVertical: 32, alignItems: 'center', marginBottom: 16, elevation: 4 },
  recordBtnIcon: { fontSize: 48, marginBottom: 8 },
  recordBtnText: { color: colors.bg, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  recordBtnSub:  { color: colors.textOnAccent, fontSize: 12, marginTop: 4 },
  recordingActive: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 18, marginBottom: 12 },
  recordingDot:  { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg },
  recordingTime: { color: colors.bg, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
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
  retryBtnText:  { color: colors.bg, fontWeight: '800', fontSize: 15 },
  saveBtn:       { borderRadius: 16, paddingVertical: 20, alignItems: 'center', marginBottom: 20, elevation: 3 },
  saveBtnText:   { color: colors.textOnNavy, fontSize: 18, fontWeight: '900' },
  saveBtnSub:    { color: colors.textOnNavy, fontSize: 11, marginTop: 4 },
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
export default React.memo(InterrogationRecorderScreen);