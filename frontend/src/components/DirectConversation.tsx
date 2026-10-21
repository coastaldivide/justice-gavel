/**
 * DirectConversation — a direct message conversation with one person
 * (bulk / profile messages to attorneys and their replies).
 *   GET  /messages/direct?with=<userId>      the messages (newest first from the server)
 *   POST /messages/direct { to, body }       reply (only to someone who wrote to you)
 *   POST /messages/direct/:userId/read       mark read when opened
 * Used by the attorney inbox and by Messages (?directWith=<userId>) for the person who wrote.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

type DM = { id: number; content: string; created_at: string; direction: 'sent' | 'received'; sender_name?: string | null; recipient_name?: string | null };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function DirectConversation({ who, onClose }: { who: { user_id: number; name: string | null }; onClose: () => void }): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [msgs, setMsgs] = useState<DM[] | null>(null);
  const [name, setName] = useState(who.name);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/messages/direct', { params: { with: who.user_id, limit: 100 } });
      const rows = ((r.data?.messages || []) as DM[]).slice().reverse();
      if (!mounted.current) return;
      setMsgs(rows);
      const other = rows.find(m => m.direction === 'received');
      if (!name && other?.sender_name) setName(other.sender_name);
      api.post(`/messages/direct/${who.user_id}/read`, {}).catch(() => {});
    } catch (e) {
      if (mounted.current) { setErr(apiErrorMessage(e, t('dm_load_error'))); setMsgs([]); }
    }
  }, [who.user_id, name]);
  useEffect(() => { load(); }, [load]);

  const canReply = !!msgs?.some(m => m.direction === 'received');
  const send = async () => {
    if (!text.trim()) return;
    setSending(true); setErr('');
    try { await api.post('/messages/direct', { to: who.user_id, body: text.trim() }); if (mounted.current) setText(''); load(); }
    catch (e) { if (mounted.current) setErr(apiErrorMessage(e, t('ai_send_error'))); }
    finally { if (mounted.current) setSending(false); }
  };

  return (
    <KeyboardAvoidingView testID="direct-conversation" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" testID="direct-conversation-back" style={s.backBtn} onPress={onClose} accessibilityLabel={t('ai_back')}>
          <Text maxFontSizeMultiplier={1.4} style={s.backText}>‹ {t('ai_back')}</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={s.title} numberOfLines={1}>{name || t('ai_someone')}</Text>
        <View style={{ width: 64 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        {msgs === null && <ActivityIndicator color={colors.textBrand} />}
        {msgs?.length === 0 && !err && <Text maxFontSizeMultiplier={1.4} style={s.meta}>{t('dm_empty')}</Text>}
        {msgs?.map(m => (
          <View key={m.id} testID={`dm-${m.direction}`} style={[s.bubble, m.direction === 'sent'
            ? { alignSelf: 'flex-end', backgroundColor: colors.navy }
            : { alignSelf: 'flex-start', backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: m.direction === 'sent' ? colors.textOnNavy : colors.textPrimary, fontSize: 14, lineHeight: 20 }}>{m.content}</Text>
            <Text maxFontSizeMultiplier={1.2} style={{ color: m.direction === 'sent' ? colors.textOnNavy : colors.textMuted, fontSize: 11, marginTop: 4 }}>{when(m.created_at)}</Text>
          </View>
        ))}
        <Text maxFontSizeMultiplier={1.3} style={[s.meta, { textAlign: 'center', marginTop: 12 }]}>{t('ai_privacy_note')}</Text>
      </ScrollView>
      {!!err && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger, marginHorizontal: 12 }}>{err}</Text>}
      {canReply && (
        <View style={s.composer}>
          <TextInput testID="direct-reply" style={s.input} value={text} onChangeText={setText} multiline maxLength={5000} placeholder={t('ai_reply_ph')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('ai_reply_ph')} />
          <TouchableOpacity accessibilityRole="button" testID="direct-send" style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]} disabled={!text.trim() || sending} onPress={send}>
            <Text maxFontSizeMultiplier={1.3} style={s.sendText}>{t('ai_send')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 4 },
  backBtn: { minHeight: 44, minWidth: 64, paddingHorizontal: 8, justifyContent: 'center' },
  backText: { fontSize: 15, ...FONTS.semi, color: colors.info },
  title: { flex: 1, textAlign: 'center', fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  bubble: { maxWidth: '85%', borderRadius: RADIUS.lg, padding: 10, marginTop: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgCard },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 10, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14 },
  sendBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy },
});
