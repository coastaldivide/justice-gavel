/**
 * InterrogationRecorderScreen.web.tsx — web version of the encounter recorder.
 *
 * Same job as the native screen: show the recording-consent law for the
 * person's state (and ask before recording in an all-party-consent state),
 * record with the browser's MediaRecorder, then upload for a transcript and a
 * PDF. When processing fails the recording is kept in memory: the person can
 * try the upload again or save the audio file — nothing is lost.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api } from '../services/api';
import { t, useLang } from '../i18n';
import { useConfirm } from '../hooks/useConfirm';
import EmergencyStrip from '../components/EmergencyStrip';
import { getUserState } from '../utils/userState';
import { IconLabel, ICONS, AppIcon } from '../components/AppIcon';

type Step = 'idle' | 'recording' | 'uploading' | 'done' | 'error';
interface RecordingLaw { state: string | null; consent: 'one-party' | 'two-party' | 'mixed' | 'unknown'; law: string | null; warn: boolean; note: string }
interface DialogueLine { timestamp?: string; speaker?: string; text?: string }

/** Give the browser a file to save (the recording, the PDF). */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function InterrogationRecorderScreen(): React.JSX.Element {
  useLang();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { confirm } = useConfirm();
  const [step, setStep] = useState<Step>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [dialogue, setDialogue] = useState<DialogueLine[]>([]);
  const [pdf, setPdf] = useState<string>('');
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [officerName, setOfficerName] = useState('');
  const [location, setLocation] = useState('');
  const [law, setLaw] = useState<RecordingLaw | null>(null);
  const [stateCode, setStateCode] = useState('');

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stream.getTracks().forEach(tr => tr.stop());
  }, []);

  // The consent law where the person is (their saved state; the browser has no geocoder).
  useEffect(() => {
    getUserState().then(st => {
      if (!st?.code || !mounted.current) return;
      setStateCode(st.code);
      api.get<RecordingLaw>(`/interrogation/recording-law?state=${encodeURIComponent(st.code)}`)
        .then(r => { if (mounted.current) setLaw(r.data || null); })
        .catch(() => { /* offline: the general warning at the bottom still shows */ });
    }).catch(() => {});
  }, []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const beginRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      mediaRef.current = mr;
      chunksRef.current = [];
      blobRef.current = null;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(500);
      setStep('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError(t('x_interrogation_recorder_microphone_access_required_allow'));
    }
  }, []);

  const startRecording = async () => {
    if (law?.warn || law?.consent === 'two-party') {
      const ok = await confirm(t('x_interrogation_recorder_two_party_consent_warning'),
        t('x_interrogation_recorder_custodial_interrogation_note_likely', { value: law.note }),
        { confirmLabel: t('x_interrogation_recorder_i_understand_start_recording') });
      if (!ok) return;
    }
    beginRecording();
  };

  const upload = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setStep('uploading'); setError(''); setNeedsSignIn(false);
    try {
      const form = new FormData();
      form.append('audio', blob, 'encounter.webm');
      if (stateCode) form.append('state', stateCode);
      if (officerName.trim()) form.append('officer_name', officerName.trim());
      if (location.trim()) form.append('location', location.trim());
      form.append('dateTime', new Date().toLocaleString('en-US', { timeZoneName: 'short' }));
      const res = await api.post('/interrogation/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 });
      if (!mounted.current) return;
      setTranscript(String(res.data?.transcript || ''));
      setDialogue(Array.isArray(res.data?.dialogue) ? res.data.dialogue : []);
      setPdf(String(res.data?.pdf_base64 || ''));
      setStep('done');
    } catch (e: any) {
      if (!mounted.current) return;
      const status = e?.response?.status;
      setNeedsSignIn(status === 401);
      setError(status === 401 ? t('ir_sign_in_to_transcribe')
        : status === 503 ? t('ir_transcription_unavailable')
          : !e?.response ? t('x_interrogation_recorder_could_not_process_recording')
            : t('x_interrogation_recorder_processing_failed_recording_was'));
      setStep('error');
    }
  }, [stateCode, officerName, location]);

  const stopAndProcess = useCallback(async () => {
    const mr = mediaRef.current;
    if (!mr) return;
    if (timerRef.current) clearInterval(timerRef.current);
    // Wait for the recorder's final chunk before building the file.
    await new Promise<void>(resolve => { mr.onstop = () => resolve(); mr.stop(); });
    mr.stream.getTracks().forEach(tr => tr.stop());
    blobRef.current = new Blob(chunksRef.current, { type: 'audio/webm' });
    await upload();
  }, [upload]);

  const saveRecording = () => {
    if (blobRef.current) download(blobRef.current, `encounter-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
  };
  const savePdf = () => {
    if (!pdf) return;
    const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
    download(new Blob([bytes], { type: 'application/pdf' }), `encounter-transcript-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const reset = () => {
    setStep('idle');
    setSeconds(0);
    setTranscript('');
    setDialogue([]);
    setPdf('');
    setError('');
    setNeedsSignIn(false);
    chunksRef.current = [];
    blobRef.current = null;
  };

  const speakerLabel = (sp?: string) =>
    sp === 'SUSPECT' ? t('x_interrogation_recorder_text') : sp === 'OFFICER' ? t('ir_officer') : t('ir_unknown_speaker');

  const card = { backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, gap: 6 } as const;
  const input = { backgroundColor: colors.bgCard, borderRadius: 10, padding: 12, color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border } as const;
  const btn = makeButtons(colors);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 16 }} testID="interrogation-recorder-screen">
      <EmergencyStrip compact />
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        {t('x_interrogation_recorder_encounter_recorder_2')}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textMuted, lineHeight: 20 }}>
        {t('x_interrogation_recorder_records_interaction_with_law')}
      </Text>

      {law && (
        <View testID="recorder-law" style={[card, { borderLeftWidth: 5, borderLeftColor: law.warn ? colors.warn : colors.legal, backgroundColor: law.warn ? colors.warnBg : colors.legalBg }]}>
          <IconLabel icon={law.warn ? ICONS.statusWarn : ICONS.statusOk} maxFontSizeMultiplier={1.3} textStyle={{ fontSize: 14, fontWeight: '800', color: law.warn ? colors.warnDark : colors.legalDark }}>
            {law.consent === 'two-party' ? t('x_interrogation_recorder_all_party_consent_state') : law.consent === 'mixed' ? t('x_interrogation_recorder_mixed_consent_state') : law.consent === 'one-party' ? t('x_interrogation_recorder_one_party_consent_state') : t('x_interrogation_recorder_state_may_require_all')}
          </IconLabel>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 19, color: colors.textPrimary }}>{law.note}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, fontStyle: 'italic', color: colors.textMuted }}>{law.law}</Text>
        </View>
      )}

      <View style={card}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '700', color: colors.textPrimary }}>{t('x_interrogation_recorder_before_record_say_these')}</Text>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '800', color: colors.textBrand, lineHeight: 22 }}>{t('x_interrogation_recorder_i_am_invoking_my')}</Text>
      </View>

      {step === 'idle' && (
        <View style={{ gap: 12 }}>
          <TextInput value={officerName} onChangeText={setOfficerName} testID="recorder-officer"
            placeholder={t('x_interrogation_recorder_officer_name_badge_number')} placeholderTextColor={colors.textMuted}
            style={input} accessibilityLabel={t('x_interrogation_recorder_officer_name_badge_number_2')}
            returnKeyType="done" blurOnSubmit maxLength={200} />
          <TextInput value={location} onChangeText={setLocation} testID="recorder-location"
            placeholder={t('x_interrogation_recorder_location_optional')} placeholderTextColor={colors.textMuted}
            style={input} accessibilityLabel={t('x_interrogation_recorder_location')}
            returnKeyType="done" blurOnSubmit maxLength={200} />
        </View>
      )}

      <View style={{ alignItems: 'center', paddingVertical: 16, gap: 16 }}>
        {step === 'recording' && (
          <Text maxFontSizeMultiplier={1.3} testID="recorder-timer" style={{ fontSize: 40, fontWeight: '700', color: colors.emergency, fontVariant: ['tabular-nums'] }}>
            {fmt(seconds)}
          </Text>
        )}
        {(step === 'idle' || step === 'recording') && (
          <TouchableOpacity
            accessibilityRole="button" testID="recorder-toggle"
            accessibilityLabel={step === 'idle' ? t('x_interrogation_recorder_start_recording_police_encounter') : t('x_interrogation_recorder_stop_transcribe')}
            onPress={step === 'idle' ? startRecording : stopAndProcess}
            style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: step === 'recording' ? colors.emergency : colors.navy,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <AppIcon name={step === 'recording' ? ICONS.stop : ICONS.record} size={40} color={colors.white} />
          </TouchableOpacity>
        )}
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
          {step === 'idle' ? t('x_interrogation_recorder_tap_begin_recording')
            : step === 'recording' ? t('x_interrogation_recorder_recording_tap_stop_transcribe')
              : step === 'uploading' ? t('x_interrogation_recorder_processing_recording')
                : step === 'done' ? t('x_interrogation_recorder_recording_complete') : ''}
        </Text>
      </View>

      {step === 'uploading' && (
        <View style={{ alignItems: 'center', gap: 10 }}>
          <ActivityIndicator size="large" color={colors.textBrand} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted }}>{t('x_interrogation_recorder_transcribing_with_whisper_ai')}</Text>
        </View>
      )}

      {!!error && (
        <View testID="recorder-error" style={{ backgroundColor: colors.emergencyBg, borderRadius: 12, padding: 16, gap: 10 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.emergency, fontSize: 14, fontWeight: '700' }}>{error}</Text>
          {step === 'error' && !!blobRef.current && (
            <>
              {needsSignIn ? (
                <TouchableOpacity accessibilityRole="button" testID="recorder-sign-in" style={btn.navy} onPress={() => navigation.navigate('Login')}>
                  <Text maxFontSizeMultiplier={1.3} style={btn.text}>{t('sign_in')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity accessibilityRole="button" testID="recorder-retry" style={btn.navy} onPress={upload}>
                  <Text maxFontSizeMultiplier={1.3} style={btn.text}>{t('x_interrogation_recorder_try_again')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity accessibilityRole="button" testID="recorder-save-audio" style={btn.green} onPress={saveRecording}>
                <IconLabel icon={ICONS.save} textStyle={btn.text} maxFontSizeMultiplier={1.3}>{t('ir_save_recording')}</IconLabel>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="recorder-discard" onPress={reset} style={{ padding: 8, alignItems: 'center' }}>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textSecond, fontWeight: '600' }}>{t('x_interrogation_recorder_record_another')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {step === 'done' && (
        <View testID="recorder-result" style={[card, { padding: 16, gap: 12 }]}>
          {!!pdf && (
            <TouchableOpacity accessibilityRole="button" testID="recorder-save-pdf" style={btn.green} onPress={savePdf}>
              <IconLabel icon={ICONS.document} textStyle={btn.text} maxFontSizeMultiplier={1.3}>{t('x_interrogation_recorder_save_share_pdf_2')}</IconLabel>
            </TouchableOpacity>
          )}
          <Text maxFontSizeMultiplier={1.3} style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 15 }}>{t('disc_doc_transcript')}</Text>
          {dialogue.length > 0 ? dialogue.map((line, i) => (
            <Text key={`line-${i}`} maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, lineHeight: 21, fontSize: 14 }}>
              <Text style={{ color: colors.textMuted }}>{line.timestamp ? `${line.timestamp}  ` : ''}</Text>
              <Text style={{ fontWeight: '800' }}>{speakerLabel(line.speaker)}: </Text>{line.text}
            </Text>
          )) : (
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, lineHeight: 22, fontSize: 14 }}>{transcript}</Text>
          )}
          <TouchableOpacity onPress={reset} style={btn.navy} accessibilityRole="button">
            <Text maxFontSizeMultiplier={1.3} style={btn.text}>{t('x_interrogation_recorder_record_another')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 8 }}>
        {t('x_interrogation_recorder_important_recording_laws_vary')}
      </Text>
    </ScrollView>
  );
}
const makeButtons = (c: any) => StyleSheet.create({
  navy:  { backgroundColor: c.navy, borderRadius: 10, padding: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  green: { backgroundColor: c.legalDark, borderRadius: 10, padding: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  text:  { color: c.white, fontWeight: '700' },
});

export default React.memo(InterrogationRecorderScreen);
