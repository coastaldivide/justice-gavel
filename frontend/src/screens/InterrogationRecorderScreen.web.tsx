/**
 * InterrogationRecorderScreen.web.tsx -- Web version
 *
 * Records the interaction with law enforcement using the browser's
 * MediaRecorder API, then uploads for transcription and AI structuring.
 * Functionally identical to the native version.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api } from '../services/api';

type Step = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

export default function InterrogationRecorderScreen(): JSX.Element {
  const navigation = useNavigation<any>();
  const { colors }  = useTheme();
  const [step,       setStep]       = useState<Step>('idle');
  const [seconds,    setSeconds]    = useState(0);
  const [transcript, setTranscript] = useState('');
  const [notes,      setNotes]      = useState('');
  const [error,      setError]      = useState('');
  const [officerName, setOfficerName] = useState('');
  const [location,   setLocation]   = useState('');

  const mediaRef  = useRef<MediaRecorder | null>(null);
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
        'Microphone access is required. Allow microphone access in your browser settings, ' +
        'then refresh the page.'
      );
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    if (!mediaRef.current) return;
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('uploading');

    // Wait for final data chunk
    await new Promise(r => setTimeout(r, 600));

    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'encounter.webm');
      if (officerName) form.append('officer_name', officerName);
      if (location)    form.append('location', location);

      const res = await api.post('/interrogation/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTranscript(res.data.transcript || res.data.text || '');
      setStep('done');
    } catch {
      setError('Processing failed. Your recording was not lost -- try again.');
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
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>← Back</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        Encounter Recorder
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors.textMuted, lineHeight: 20 }}>
        Records your interaction with law enforcement and creates a time-stamped
        transcript for your case file.
      </Text>

      {/* Context fields */}
      {step === 'idle' && (
        <View style={{ gap: 12 }}>
          <Text maxFontSizeMultiplier={1.3}Input
            value={officerName}
            onChangeText={setOfficerName}
            placeholder="Officer name / badge number (optional)"
            placeholderTextColor={colors.textMuted}
            style={{ backgroundColor: colors.bgCard, borderRadius: 10, padding: 12,
              color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
            accessibilityLabel="Officer name or badge number"
          />
          <Text maxFontSizeMultiplier={1.3}Input
            value={location}
            onChangeText={setLocation}
            placeholder="Location (optional)"
            placeholderTextColor={colors.textMuted}
            style={{ backgroundColor: colors.bgCard, borderRadius: 10, padding: 12,
              color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
            accessibilityLabel="Location"
          />
        </View>
      )}

      {/* Record button */}
      <View style={{ alignItems: 'center', paddingVertical: 24, gap: 16 }}>
        {step === 'recording' && (
          <Text maxFontSizeMultiplier={1.3} style={{
            fontSize: 40, fontWeight: '700', color: '#C62828',
            fontVariant: ['tabular-nums'] as any,
          }}>
            {fmt(seconds)}
          </Text>
        )}

        {(step === 'idle' || step === 'recording') && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={step === 'idle' ? startRecording : stopAndProcess}
            style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: step === 'recording' ? '#C62828' : colors.navy,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: step === 'recording' ? 3 : 0,
              borderColor: '#FF5252',
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 36 }}>
              {step === 'recording' ? '⏹' : '🎙️'}
            </Text>
          </TouchableOpacity>
        )}
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
          {step === 'idle'      ? 'Tap to begin recording' :
           step === 'recording' ? 'Recording -- tap to stop and transcribe' :
           step === 'uploading' ? 'Processing your recording…' :
           step === 'done'      ? 'Recording complete' : 'An error occurred'}
        </Text>
      </View>

      {step === 'uploading' && (
        <View style={{ alignItems: 'center', gap: 10 }}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted }}>Transcribing with Whisper AI…</Text>
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor: '#FFEBEE', borderRadius: 12, padding: 16, gap: 8 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: '#C62828', fontSize: 14, fontWeight: '600' }}>Error</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: '#B71C1C', fontSize: 13 }}>{error}</Text>
          <TouchableOpacity onPress={reset} accessibilityRole="button" accessibilityLabel="Try again">
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.navy, fontSize: 13, fontWeight: '600' }}>Try again →</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step === 'done' && transcript ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, gap: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 15 }}>
            Transcript
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, lineHeight: 22, fontSize: 14 }}>
            {transcript}
          </Text>
          <Text maxFontSizeMultiplier={1.3}Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Add your own notes…"
            placeholderTextColor={colors.textMuted}
            multiline
            style={{ backgroundColor: colors.bg, borderRadius: 8, padding: 12,
              color: colors.textPrimary, fontSize: 13, borderWidth: 1, borderColor: colors.border,
              minHeight: 80 }}
            accessibilityLabel="Additional notes"
          />
          <TouchableOpacity
            onPress={reset}
            style={{ backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center' }}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color: '#fff', fontWeight: '600' }}>Record another</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{
        fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 8,
      }}>
        Important: Recording laws vary by state. In some states all parties must
        consent to being recorded. Consult a local attorney if unsure.
      </Text>
    </ScrollView>
  );
}
