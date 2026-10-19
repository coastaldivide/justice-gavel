
/**
 * InterrogationRecorderScreen.web.tsx -- Web version
 *
 * Records the interaction with law enforcement using the browser's
 * MediaRecorder API, then uploads for transcription and AI structuring.
 * Functionally identical to the native version.
 */
import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api } from '../services/api';
import { t, useLang } from '../i18n';

type Step = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

function InterrogationRecorderScreen(): React.JSX.Element {
  useLang();
  const navigation = useNavigation<any>();
  const { colors }  = useTheme();
  const [step,       setStep]       = useState<Step>('idle');
  const [seconds,    setSeconds]    = useState(0);
  const [transcript, setTranscript] = useState('');
  const [notes,      setNotes]      = useState('');
  const [error,      setError]      = useState('');
  const [officerName, setOfficerName] = useState('');
  const [location,   setLocation]   = useState('');

  const mediaRef  = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const startRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRef.current  = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(500);
      setStep('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError(
        t('x_interrogation_recorder_microphone_access_required_allow')
      );
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    if (!mediaRef.current) return;
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach((tItem: MediaStreamTrack) => tItem.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('uploading');

    // Wait for final data chunk
    await new Promise<void>(r => { setTimeout(r, 600); });

    try {
      const blob = new Blob(chunksRef.current as any, { type: 'audio/webm' } as any);
      const form = new FormData();
      (form as any).append('audio', blob, 'encounter.webm');
      if (officerName) form.append('officer_name', officerName);
      if (location)    form.append('location', location);

      const res = await api.post('/interrogation/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTranscript(res.data?.transcript || res.data.text || '');
      setStep('done');
    } catch {
      setError(t('x_interrogation_recorder_processing_failed_recording_was'));
      setStep('error');
    }
  }, [officerName, location]);

  const reset = () => {
    setStep('idle');
    setSeconds(0);
    setTranscript('');
    setError('');
    chunksRef.current = [];
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 16 }}>
      <TouchableOpacity
        onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>{t('ja_back')}</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        {t('x_interrogation_recorder_encounter_recorder_2')}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textMuted, lineHeight: 20 }}>
        {t('x_interrogation_recorder_records_interaction_with_law')}
      </Text>

      {/* Context fields */}
      {step === 'idle' && (
        <View style={{ gap: 12 }}>
          <TextInput
            value={officerName}
            onChangeText={setOfficerName}
            placeholder={t('x_interrogation_recorder_officer_name_badge_number')}
            placeholderTextColor={colors.textMuted}
            style={{ backgroundColor: colors.bgCard, borderRadius: 10, padding: 12,
              color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
            accessibilityLabel={t('x_interrogation_recorder_officer_name_badge_number_2')}
          returnKeyType="done" blurOnSubmit={true}
          keyboardType="numeric" maxLength={200}
          />
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder={t('x_interrogation_recorder_location_optional')}
            placeholderTextColor={colors.textMuted}
            style={{ backgroundColor: colors.bgCard, borderRadius: 10, padding: 12,
              color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
            accessibilityLabel={t('x_interrogation_recorder_location')}
          returnKeyType="done" blurOnSubmit={true}
          />
        </View>
      )}

      {/* Record button */}
      <View style={{ alignItems: 'center', paddingVertical: 24, gap: 16 }}>
        {step === 'recording' && (
          <Text maxFontSizeMultiplier={1.3} style={{
            fontSize: 40, fontWeight: '700', color: colors.emergency,
            fontVariant: ['tabular-nums'] as any,
          }}>
            {fmt(seconds)}
          </Text>
        )}

        {(step === 'idle' || step === 'recording') && (
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            onPress={step === 'idle' ? startRecording : stopAndProcess}
            style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: step === 'recording' ? colors.emergency : colors.navy,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: step === 'recording' ? 3 : 0,
              borderColor: colors.emergency,
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 36 }}>
              {step === 'recording' ? '⏹' : '🎙️'}
            </Text>
          </TouchableOpacity>
        )}
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
          {step === 'idle'      ? t('x_interrogation_recorder_tap_begin_recording') :
           step === 'recording' ? t('x_interrogation_recorder_recording_tap_stop_transcribe') :
           step === 'uploading' ? t('x_interrogation_recorder_processing_recording') :
           step === 'done'      ? t('x_interrogation_recorder_recording_complete') : t('x_use_network_error_error_occurred')}
        </Text>
      </View>

      {step === 'uploading' && (
        <View style={{ alignItems: 'center', gap: 10 }}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted }}>{t('x_interrogation_recorder_transcribing_with_whisper_ai')}</Text>
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor: colors.emergencyBg, borderRadius: 12, padding: 16, gap: 8 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.emergency, fontSize: 14, fontWeight: '600' }}>{t('error')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.emergency, fontSize: 13 }}>{error}</Text>
          <TouchableOpacity onPress={reset} accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} accessibilityLabel={t('try_again')}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textBrand, fontSize: 13, fontWeight: '600' }}>{t('x_interrogation_recorder_try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step === 'done' && transcript ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, gap: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 15 }}>
            {t('disc_doc_transcript')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, lineHeight: 22, fontSize: 14 }}>
            {transcript}
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t('x_interrogation_recorder_add_own_notes')}
            placeholderTextColor={colors.textMuted}
            multiline
              maxLength={4000}
            style={{ backgroundColor: colors.bg, borderRadius: 8, padding: 12,
              color: colors.textPrimary, fontSize: 13, borderWidth: 1, borderColor: colors.border,
              minHeight: 80 }}
            accessibilityLabel={t('x_interrogation_recorder_additional_notes')}
          returnKeyType="done" blurOnSubmit={true}
          />
          <TouchableOpacity
            onPress={reset}
            style={{ backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center' }}
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textOnNavy, fontWeight: '600' }}>{t('x_interrogation_recorder_record_another')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{
        fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 8,
      }}>
        {t('x_interrogation_recorder_important_recording_laws_vary')}
      </Text>
    </ScrollView>
  );
}
export default React.memo(InterrogationRecorderScreen);
