declare var window: any;
declare var MediaRecorder: any;
declare var navigator: any;

/**
 * VoiceNoteScreen.web.tsx -- Web platform using MediaRecorder API
 *
 * Records audio in the browser, uploads for transcription,
 * and saves as a case note -- same flow as native.
 */
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { api } from '../services/api';

export default function VoiceNoteScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const { colors }  = useTheme();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError]   = useState('');
  const [seconds, setSeconds] = useState(0);
  const mediaRef  = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRef.current  = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError('Microphone access denied. Allow microphone in browser settings.');
    }
  };

  const stopAndTranscribe = async () => {
    if (!mediaRef.current) return;
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setUploading(true);
    // eslint-disable-next-line no-promise-executor-return
    // Wait for final chunk
    await new Promise(r => setTimeout(r, 400));
    try {
      const blob = new Blob(chunksRef.current as any, { type: 'audio/webm' } as any);
      const form = new FormData();
      (form as any).append('audio', blob, 'voice_note.webm');
      const res = await api.post('/transcribe/audio', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTranscript(res.data?.text || '');
    } catch {
      setError('Transcription failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <ScrollView style={{ flex:1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding:24, gap:20 }}>
      <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home')}
        accessibilityRole="button"
        >
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>← Back</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={{ fontSize:22, fontWeight:'700', color: colors.textPrimary }}>
        Voice Note
      </Text>

      <View style={{ alignItems:'center', paddingVertical:32, gap:20 }}>
        {recording && (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize:36, fontWeight:'700', color: colors.navy, fontVariant:['tabular-nums'] as any }}>
            {fmt(seconds)}
          </Text>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          onPress={recording ? stopAndTranscribe : startRecording}
          style={{
            width:80, height:80, borderRadius:40,
            backgroundColor: recording ? '#C62828' : colors.navy,
            alignItems:'center', justifyContent:'center',
          }}
        >
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize:32 }}>{recording ? '⏹' : '🎙️'}</Text>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize:13 }}>
          {recording ? 'Recording… tap to stop' : 'Tap to record a voice note'}
        </Text>
      </View>

      {uploading && (
        <View style={{ alignItems:'center', gap:10 }}>
          <ActivityIndicator color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted }}>Transcribing…</Text>
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor:'#FFEBEE', borderRadius:12, padding:16 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color:'#C62828', fontSize:14 }}>{error}</Text>
        </View>
      ) : null}

      {transcript ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius:14, padding:16, gap:10 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontWeight:'600', color: colors.textPrimary }}>Transcript:</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, lineHeight:22, fontSize:14 }}>{transcript}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
