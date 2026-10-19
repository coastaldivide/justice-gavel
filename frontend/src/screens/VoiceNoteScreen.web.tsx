/**
 * VoiceNoteScreen.web.tsx — web version of the voice note (MediaRecorder).
 *
 * Same flow as native: record → POST /transcribe/note (transcribed and
 * structured) → edit → "Save to case" (appended to the case's notes on the
 * server) or "Copy note". Typing is always possible (POST /transcribe/text),
 * and is offered when transcription is unavailable or fails.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, StyleSheet } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import { appendCaseNote } from '../services/caseNotes';
import { useToast } from '../components/ToastProvider';
import { Clipboard } from '../utils/webCompat';
import { t, useLang } from '../i18n';

type Phase = 'idle' | 'recording' | 'processing' | 'text_input' | 'result';
interface StructuredNote { date: string; summary: string; next_steps: string[]; flags: string[]; raw: string }

function formatNote(n: StructuredNote | undefined): string {
  if (!n) return '';
  let out = `📝 ${n.date}\n\n${n.summary}\n`;
  if (n.next_steps?.length) out += `\n${t('x_voice_note_next_steps')}\n${n.next_steps.map(x => `• ${x}`).join('\n')}\n`;
  if (n.flags?.length) out += `\n${t('x_voice_note_flagged_2')}\n${n.flags.map(x => `• ${x}`).join('\n')}\n`;
  return out.trim();
}

function VoiceNoteScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { caseId, caseTitle, onSave } = (route?.params as import('../types/api').RouteParams) ?? {};
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [textIn, setTextIn] = useState('');
  const [note, setNote] = useState<StructuredNote | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stream.getTracks().forEach(tr => tr.stop());
  }, []);

  const showResult = (n: StructuredNote | undefined) => {
    if (!mounted.current) return;
    if (!n) { setError(t('x_voice_note_could_not_structure_note')); setPhase('text_input'); return; }
    setNote(n); setEditText(formatNote(n)); setPhase('result');
  };

  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      setPhase('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError(t('x_voice_note_microphone_access_denied_allow'));
    }
  };

  const stopAndTranscribe = async () => {
    const mr = mediaRef.current;
    if (!mr) return;
    if (timerRef.current) clearInterval(timerRef.current);
    await new Promise<void>(resolve => { mr.onstop = () => resolve(); mr.stop(); });
    mr.stream.getTracks().forEach(tr => tr.stop());
    setPhase('processing');
    try {
      const form = new FormData();
      form.append('audio', new Blob(chunksRef.current, { type: 'audio/webm' }), 'voice_note.webm');
      const res = await api.post<{ note: StructuredNote }>('/transcribe/note', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      showResult(res.data?.note);
    } catch (e) {
      if (!mounted.current) return;
      // No transcription (not configured, signed out, offline…): type it instead.
      setError(apiErrorMessage(e, t('x_voice_note_transcription_failed_please_try')));
      setPhase('text_input');
    }
  };

  const processText = async () => {
    if (!textIn.trim()) return;
    setPhase('processing'); setError('');
    try {
      const res = await api.post<{ note: StructuredNote }>('/transcribe/text', { text: textIn.trim() });
      showResult(res.data?.note);
    } catch (e) {
      if (!mounted.current) return;
      setError(apiErrorMessage(e, t('x_voice_note_could_not_structure_note')));
      setPhase('text_input');
    }
  };

  const save = async () => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try {
      if (caseId) {
        const combined = await appendCaseNote(caseId, editText);
        if (onSave) onSave(combined);
        showToast(t('vn_saved_to_case'), 'success');
        if (navigation.canGoBack()) navigation.goBack();
      } else {
        await Clipboard.setString(editText.trim());
        showToast(t('vn_copied'), 'success');
      }
    } catch (e) {
      showToast(apiErrorMessage(e, t('vn_save_failed')), 'error');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const input = { backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, color: colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: colors.border, minHeight: 160, textAlignVertical: 'top' as const };
  const btn = makeButtons(colors);
  const link = { padding: 10, alignItems: 'center' as const };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24, gap: 18 }} testID="voice-note-screen" keyboardShouldPersistTaps="handled">
      {!!caseTitle && (
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textBrand, fontWeight: '700' }} numberOfLines={1}>📁  {caseTitle}</Text>
      )}
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary }}>
        {phase === 'text_input' ? t('x_voice_note_type_note') : t('x_cs_voice_note_2')}
      </Text>

      {!!error && (
        <View testID="voice-note-error" style={{ backgroundColor: colors.emergencyBg, borderRadius: 12, padding: 14 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.emergency, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {(phase === 'idle' || phase === 'recording') && (
        <View style={{ alignItems: 'center', paddingVertical: 24, gap: 18 }}>
          {phase === 'idle' && (
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>{t('x_voice_note_speak_up_5_minutes')}</Text>
          )}
          {phase === 'recording' && (
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 36, fontWeight: '700', color: colors.textBrand, fontVariant: ['tabular-nums'] }}>{fmt(seconds)}</Text>
          )}
          <TouchableOpacity
            accessibilityRole="button" testID="voice-note-toggle"
            accessibilityLabel={phase === 'recording' ? t('x_voice_note_stop_recording_process_note') : t('x_voice_note_tap_record_voice_note')}
            onPress={phase === 'recording' ? stopAndTranscribe : startRecording}
            style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: phase === 'recording' ? colors.emergency : colors.navy, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 32 }}>{phase === 'recording' ? '⏹' : '🎙️'}</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 13 }}>
            {phase === 'recording' ? t('x_voice_note_recording_tap_stop') : t('x_voice_note_tap_record_voice_note')}
          </Text>
          {phase === 'idle' && (
            <TouchableOpacity accessibilityRole="button" testID="voice-note-type-instead" style={link} onPress={() => { setError(''); setPhase('text_input'); }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.info, fontWeight: '600' }}>{t('x_voice_note_type_instead_2')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {phase === 'processing' && (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
          <ActivityIndicator color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted }}>{t('x_voice_note_structuring_note')}</Text>
        </View>
      )}

      {phase === 'text_input' && (
        <View style={{ gap: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 14 }}>{t('x_voice_note_describe_meeting_key_facts')}</Text>
          <TextInput testID="voice-note-text" multiline maxLength={2000} value={textIn} onChangeText={setTextIn}
            placeholder={t('x_voice_note_e_g_met_with')} placeholderTextColor={colors.textMuted} style={input}
            accessibilityLabel={t('x_voice_note_type_note')} />
          <TouchableOpacity accessibilityRole="button" testID="voice-note-structure" disabled={!textIn.trim()}
            style={[btn.primary, !textIn.trim() && { opacity: 0.45 }]} onPress={processText}>
            <Text maxFontSizeMultiplier={1.3} style={btn.text}>{t('x_voice_note_structure_this_note')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={link} onPress={() => { setError(''); setPhase('idle'); }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.info, fontWeight: '600' }}>{t('x_voice_note_use_voice_instead')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'result' && (
        <View style={{ gap: 12 }} testID="voice-note-result">
          {!!note?.summary && (
            <View style={{ backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>{note.date}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 22 }}>{note.summary}</Text>
            </View>
          )}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>{t('x_voice_note_edit_before_saving')}</Text>
          <TextInput testID="voice-note-edit" multiline maxLength={2000} value={editText} onChangeText={setEditText} style={[input, { minHeight: 200 }]}
            accessibilityLabel={t('x_voice_note_edit_before_saving')} />
          <TouchableOpacity accessibilityRole="button" testID="voice-note-save" disabled={saving} style={[btn.primary, saving && { opacity: 0.6 }]} onPress={save}>
            {saving ? <ActivityIndicator color={colors.white} />
              : <Text maxFontSizeMultiplier={1.3} style={btn.text}>{caseId ? t('x_voice_note_save_case') : t('x_voice_note_copy_note')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={link} onPress={() => { setNote(null); setEditText(''); setTextIn(''); setPhase('idle'); }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.info, fontWeight: '600' }}>{t('x_voice_note_record_another_note')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
const makeButtons = (c: any) => StyleSheet.create({
  primary: { backgroundColor: c.navy, borderRadius: 12, padding: 15, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  text:    { color: c.white, fontWeight: '800' },
});

export default React.memo(VoiceNoteScreen);
