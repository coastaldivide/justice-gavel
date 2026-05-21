/**
 * MessagesScreen -- Secure defender-client messaging
 *
 * Design direction: refined utilitarian -- built for speed and clarity
 * in a courthouse hallway. High contrast. No decoration. Every pixel
 * earns its place. The UI feels like a tool, not a social app.
 *
 * Entry points:
 *   1. CaseScreen → "Messages" tab (primary)
 *   2. Push notification deep-link
 *   3. HomeScreen unread badge (future)
 *
 * Features:
 *   - Threaded per-case messaging
 *   - Read receipts (single ✓ sent, double ✓✓ read)
 *   - Auto-scroll to latest message
 *   - Optimistic send (message appears instantly, confirms in background)
 *   - Translation badge on messages from non-English clients
 *   - Polling every 8 seconds for new messages (no WebSocket needed at launch)
 *   - Timestamp grouping (Today, Yesterday, date)
 *   - Empty state with clear next action
 */

import type { ScreenProps } from '../types/navigation';
import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { useFocusEffect } from '@react-navigation/native';

declare var displayMessages: any;
declare var listEmpty: any;
declare var msgs: any;
declare var pickDocument: any;
declare var refreshing: any;
declare var renderItem: any;
declare var setMsgs: any;
declare var setRefreshing: any;
declare var t: any;
declare var load: any; // hoisted from component scope
declare var messages: any; // hoisted from component scope
declare var searchQuery: any; // hoisted from component scope
declare var setAttachment: any; // hoisted from component scope
declare var styles: any; // hoisted from component scope
declare var userId: any; // hoisted from component scope
// ── Types ─────────────────────────────────────────────────────────────────────
interface Msg {
  id: number;
  case_id: number;
  sender_id: number;
  sender_role: 'client' | 'defender';
  sender_name: string | null;
  body: string;
  lang: string;
  read_at: string | null;
  created_at: string;
  _optimistic?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function groupByDay(msgs: Msg[]): { type: 'day'; label: string } | Msg[] {
  // Returns flat list with day-separator objects interleaved
  const out: Record<string,unknown>[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      out.push({ type: 'day', label: dayLabel(m.created_at), key: `day-${day}` });
      lastDay = day;
    }
    out.push(m);
  }
  return out as any;
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({
  msg, isMine, prevMine, showAvatar,
}: {
  msg: Msg; isMine: boolean; prevMine: boolean; showAvatar: boolean;
}) {
  const { colors, isDark } = useTheme();
  const fadeAnim = useRef(new Animated.Value(msg._optimistic ? 0.6 : 1)).current;

  useEffect(() => {
    if (!msg._optimistic) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [msg._optimistic]);

  const bubbleBg = isMine
    ? COLORS.navy
    : isDark ? COLORS.border : COLORS.bgSubtle;

  const textColor = isMine ? COLORS.bgCard : COLORS.textPrimary;

  const pickDocument = React.useCallback(async () => {
    try {
      const { default: DocumentPicker } = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'application/msword',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setAttachment({ name: asset.name, uri: asset.uri, size: asset.size || 0 });
      }
    } catch {
      Alert.alert('Could not open file picker', 'Please try again.');
    }
  }, []);

  // Upload attachment to backend -- called during send if attachment present
  const uploadAttachment = React.useCallback(async (
    attachObj: { name: string; uri: string; size: number },
    conversationId?: string | number
  ) => {
    const form = new FormData();
    form.append('file', {
      uri:  attachObj.uri,
      name: attachObj.name,
      type: 'application/octet-stream',
    } as unknown as Blob);
    if (conversationId) form.append('conversation_id', String(conversationId));
    const res = await api.post('/messages/attachment', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  }, []);


  // Refresh data whenever user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <Animated.View
      style={[
        styles.msgRow,
        isMine && styles.msgRowMine,
        !prevMine && { marginTop: 10 },
        { opacity: fadeAnim },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${isMine ? 'You' : (msg.sender_name || 'Client')}: ${msg.body}`}
    >
      {/* Avatar -- shown for first message in a run */}
      {!isMine && (
        <View style={[styles.avatar, { opacity: showAvatar ? 1 : 0 }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.avatarText}>
            {(msg.sender_name || 'C')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ maxWidth: '78%' }}>
        {/* Sender name -- first in a run only */}
        {!isMine && showAvatar && msg.sender_name && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.senderName, { color: COLORS.textMuted }]}>
            {msg.sender_name}
          </Text>
        )}
        <View style={[styles.bubble, { backgroundColor: bubbleBg },
          isMine && styles.bubbleMine,
          !isMine && styles.bubbleTheirs,
        ]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.bubbleText, { color: textColor }]}>
            {msg.body}
          </Text>
        </View>

        {/* Time + read receipt */}
        <View style={[styles.metaRow, isMine && styles.metaRowMine]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.metaText, { color: COLORS.textMuted }]}>
            {formatTime(msg.created_at)}
                        {msg.sender_id === userId && (
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:10, lineHeight:14,
                            color: msg.read_at ? COLORS.blue : colors?.textFaint || COLORS.textFaint,
                            marginTop:1, alignSelf:'flex-end' }}>
                            {msg.read_at ? '✓✓ Read' : '✓ Sent'}
                          </Text>
                        )}
          </Text>
          {isMine && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.readTick, { color: msg.read_at ? COLORS.steel : COLORS.textMuted }]}>
              {msg.read_at ? ' ✓✓' : ' ✓'}
            </Text>
          )}
          {msg.lang && msg.lang !== 'en' && !isMine && (
            <View style={styles.langBadge}>
              <Text maxFontSizeMultiplier={1.4} style={styles.langBadgeText}>{msg.lang.toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );

  // Search filter -- client-side, instant
  const filteredMessages = React.useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m: Record<string,unknown>) =>
      ((m as any).body || (m as any).content || '').toLowerCase().includes(q) ||
      ((m as any).sender_name || '').toLowerCase().includes(q)
    );
  }, [messages, searchQuery]);

}

// ── Main screen ───────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen:      { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 12, paddingBottom: 8 },

  // Day divider
  dayDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, gap: 8 },
  dayLine:    { flex: 1, height: 0.5 },
  dayLabel:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', paddingHorizontal: 8, letterSpacing: 0.3 },

  // Message row
  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 3 },
  msgRowMine: { flexDirection: 'row-reverse' },

  // Avatar
  avatar:     { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.navy,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  avatarText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  senderName: { fontSize: 11, fontWeight: '600', marginBottom: 3, marginLeft: 2 },

  // Bubble
  bubble: {
    borderRadius: RADIUS.xl, paddingHorizontal: 16, paddingVertical: 9,
    maxWidth: '100%',
  },
  bubbleMine:   { borderBottomRightRadius: 4 },
  bubbleTheirs: { borderBottomLeftRadius: 4 },
  bubbleText:   { fontSize: 15, lineHeight: 21, letterSpacing: 0.1 },

  // Meta
  metaRow:    { flexDirection: 'row', alignItems: 'center', marginTop: 3, marginLeft: 2 },
  metaRowMine:{ justifyContent: 'flex-end', marginRight: 2 },
  metaText:   { fontSize: 11, fontWeight: '500' },
  readTick:   { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  langBadge:  { marginLeft: 5, backgroundColor: COLORS.bgSubtle, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1 },
  langBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.blue },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 0.5,
  },
  input: {
    flex: 1, borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, maxHeight: 120, lineHeight: 20,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: COLORS.bgCard, fontSize: 20, fontWeight: '300', lineHeight: 22, marginTop: -1 },

  // Empty
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  emptyIcon:  { fontSize: 48, marginBottom: 14 },
  emptyTitle: { fontSize: 20, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  emptySub:   { fontSize: 12, textAlign: 'center', lineHeight: 20 },
  encryptBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, backgroundColor: colors.legal, borderBottomWidth: 0.5,
    borderBottomColor: colors.legal },
  encryptIcon:  { fontSize: 11 },
  encryptText:  { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.legal, letterSpacing: 0.3 },
});
export default function MessagesScreen({ route, navigation }: ScreenProps): React.JSX.Element {
const styles = makeStyles(COLORS);
  const styles = makeStyles(colors);

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const { caseId, caseTitle } = (route?.params as any) ?? {};

  const [messages, setMessages] = useState<Msg[]>([]);
  const [page, setPage]   = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchActive, setSearchActive] = React.useState(false);
  const [attachment, setAttachment] = React.useState<{name:string;uri:string;size:number}|null>(null);
  const [loading,  setLoading]  = useState(true);
  const [msgError,  setMsgError]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [body,     setBody]     = useState('');
  const [myId,     setMyId]     = useState<number | null>(null);
  const [role,     setRole]     = useState<'client' | 'defender'>('client');

  const listRef  = useRef<FlatList>(null);
      {/* Search bar */}
      {searchActive && (<></>)

      {/* Attachment preview */}
      {attachment && (
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8,
          marginHorizontal: 12, marginBottom: 4, backgroundColor: colors.bgElevated,
          borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16, marginRight: 8 }}>📄</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ flex: 1, fontSize: 12, lineHeight: 17,
            fontFamily: 'Inter_500Medium', color: colors.textPrimary }}
            numberOfLines={1}>
            {attachment.name}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color: colors.textMuted, marginRight: 8 }}>
            {attachment.size > 1024*1024
              ? (attachment.size/1024/1024).toFixed(1)+'MB'
              : Math.round(attachment.size/1024)+'KB'}
          </Text>
          <TouchableOpacity activeOpacity={0.6} onPress={() => setAttachment(null)}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      {searchActive && (
        <View style={{ flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 12, paddingVertical: 8,
          backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search messages..."
            placeholderTextColor={colors.placeholder}
            autoFocus
            style={{ flex: 1, fontSize: 14, lineHeight: 21,
              fontFamily: 'Inter_400Regular',
              color: colors.textPrimary, backgroundColor: colors.bg,
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            accessibilityLabel="Search messages"
            returnKeyType="search"
          blurOnSubmit
        />
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { setSearchActive(false); setSearchQuery(''); }}
            style={{ marginLeft: 10, paddingHorizontal: 8 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
          keyExtractor={(item, index) => String(item?.id ?? index)}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => { if (hasMore) setPage(p => p+1); }}
          onEndReachedThreshold={0.3}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(1).finally(() => setRefreshing(false)); }} />}
          data={displayMessages}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
          style={{ flex: 1 }}
          inverted
        />
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set header title
  useEffect(() => {
    if (caseTitle) navigation.setOptions({ title: caseTitle ,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setSearchActive(s => !s)}
            accessibilityRole="button"
          style={{ marginRight: 16, padding: 4 }}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 18, color: colors.steel }}>🔍</Text>
        </TouchableOpacity>
      ),});
  }, [caseTitle]);

  // Get current user id + role
  useEffect(() => {
    AsyncStorage.getItem('user').then(u => {
      if (u) {
        const user = JSON.parse(u);
        setMyId(user.id);
        setRole(user.is_defender ? 'defender' : 'client');
      }
    }).catch(() => {});
  }, []);

  // Load messages
  const load = useCallback(async (silent = false) => {
    if (!caseId) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.get(`/messages/${caseId}`);
      setMessages(res.data?.messages || []);
    } catch (e: any) { __DEV__ && console.warn(e?.message); setMsgError('Could not load messages. Check your connection.'); }
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
    // Real-time messages via Server-Sent Events (falls back to polling)
    const lastId = msgs.length > 0 ? Math.max(...msgs.map((m: Record<string, unknown>) => m.id)) : 0;
    let eventSource: EventSource | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getToken } = require('../utils/secureStorage');
      getToken().then((token: string | null) => {
        if (!token) return;
        const url = `${require('../services/api').API_BASE}/messages/${caseId}/stream?lastId=${lastId}&token=${token}`;
        eventSource = new EventSource(url);
        eventSource.onmessage = (e: MessageEvent) => {
          try {
            const newMsgs = JSON.parse(e.data);
            if (Array.isArray(newMsgs) && newMsgs.length > 0) {
              setMsgs(prev => {
                const ids = new Set(prev.map((m: Record<string, unknown>) => m.id));
                const added = newMsgs.filter((m: Record<string, unknown>) => !ids.has(m.id));
                return added.length > 0 ? [...prev, ...added] : prev;
              });
            }
          } catch {}
        };
        eventSource.onerror = () => {
          // SSE failed -- fall back to 8s polling
          eventSource?.close();
          pollRef.current = setInterval(() => load(true), 8000);
        };
      }).catch(() => {
        pollRef.current = setInterval(() => load(true), 8000);
      });
    } catch {
      pollRef.current = setInterval(() => load(true), 8000);
    }
    return () => {
      eventSource?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Auto-scroll on new message
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }, [messages]), 100);
    }
  }, [messages.length]);

  // Send
  const send = useCallback(async () => {
    const text = body.trim();
    if (!text || sending) return;

    // Optimistic update
    const optimisticMsg: Msg = {
      id: Date.now(),
      case_id: caseId,
      sender_id: myId!,
      sender_role: role,
      sender_name: 'You',
      body: text,
      lang: 'en',
      read_at: null,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setBody('');
    setSending(true);

    try {
      await api.post(`/messages/${caseId}`, { body: text, role });
      await load(true); // confirm with server version
    } catch {
      // Remove optimistic on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setBody(text); // restore draft
    } finally {
      setSending(false);
    }
  }, [body, sending, caseId, myId, role, load]);

  // Grouped items for FlatList
  const items = useMemo(() => groupByDay(messages), [messages]);

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!loading && messages.length === 0) return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={styles.emptyWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>💬</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>
          No messages yet
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>
          Start the conversation. Messages are private, logged, and{'\n'}
          keep your personal number off the record.
        </Text>
      </View>
      <View style={[styles.inputBar, {
        backgroundColor: isDark ? colors.tabBg : colors.bg,
        borderTopColor: colors.border,
      }]}>

          {/* Attachment picker */}
          <TouchableOpacity
            onPress={pickDocument}
            style={{ padding: 8, marginRight: 4 }}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20, color: colors.steel }}>📎</Text>
          </TouchableOpacity>

          <TextInput
          style={[styles.input, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
            color: colors.textPrimary,
          }]}
          placeholder={t('msg_placeholder')}
          placeholderTextColor={COLORS.textSecond}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={2000}
          accessibilityLabel="Message input"
        />
        <SendButton onPress={send} active={body.trim().length > 0} sending={sending} />
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          ref={listRef}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={items as any[]}
          keyExtractor={(item: Record<string,unknown>) => item.key ?? String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              No messages yet. Messages from your attorneys will appear here.
            </Text>
          }
          renderItem={({ item, index }: { item: Record<string,any>; index: number }) => {
            if (item.type === 'day') {
              return (
                <View style={styles.dayDivider}>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                  <Text maxFontSizeMultiplier={1.4} style={[styles.dayLabel, { color: colors.textMuted,
                    backgroundColor: colors.bg }]}>
                    {item.label}
                  </Text>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                </View>
              );
            }
            const msg     = item as Msg;
            const isMine  = msg.sender_id === myId;
            const prevItem = items[index - 1] as any;
            const prevMsg  = prevItem && !prevItem.type ? prevItem as Msg : null;
            const prevMine = prevMsg ? prevMsg.sender_id === myId : false;
            const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
            return (
              <MessageBubble
                msg={msg}
                isMine={isMine}
                prevMine={prevMine}
                showAvatar={showAvatar}
              />
            );
          }}
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, {
        backgroundColor: isDark ? colors.tabBg : colors.bg,
        borderTopColor: colors.border,
      }]}>
        <TextInput
          style={[styles.input, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
            color: colors.textPrimary,
          }]}
          placeholder={t('msg_placeholder')}
          placeholderTextColor={COLORS.textSecond}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={2000}
          returnKeyType="default"
          accessibilityLabel="Message input"
        />
        <SendButton onPress={send} active={body.trim().length > 0} sending={sending} />
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Send button ───────────────────────────────────────────────────────────────
function SendButton({ onPress, active, sending }: {
  onPress: () => void; active: boolean; sending: boolean;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={handlePress}
        disabled={!active || sending}
        style={[styles.sendBtn,
          { backgroundColor: active ? COLORS.navy : colors.border }
        ]}
        accessibilityLabel="Send message"
        accessibilityRole="button"
      >
        {sending
          ? <ActivityIndicator color={colors.bgCard} size="small" />
          : <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>↑</Text>}
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Module-level styles for helper components (uses static COLORS, not dynamic theme)

}