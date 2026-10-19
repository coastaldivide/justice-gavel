/**
 * MessagesScreen — secure attorney–client case messaging
 *
 * The thread for one case: GET/POST /messages/:caseId (encrypted at rest on
 * the server). New messages arrive through useCaseMessages, which polls the
 * authenticated REST endpoint every few seconds while the app is foregrounded.
 *
 * Entry points:
 *   1. CaseScreen / AttorneyDashboard / AttorneyInbox → { caseId, caseTitle }
 *   2. LawyerProfile "Send Message"                  → { lawyerId, lawyerName }
 *      (finds an open case or creates a lightweight one, like LawyersScreen)
 *   3. Deep link justicegavel.app/messages/:caseId
 *   4. Search results                                → { caseId }
 *
 * With no params it lists the user's cases so a thread can be picked.
 */

import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import * as secureStorage from '../utils/secureStorage';
import { t, useLang, locale } from '../i18n';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { useCaseMessages, CaseMessage } from '../hooks/useCaseMessages';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now  = new Date();
  const diff = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff === 0) return t('x_attorney_inbox_today');
  if (diff === 1) return t('x_messages_yesterday');
  return d.toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: CaseMessage };

/** Interleave day-separator rows into the message list. */
function groupByDay(msgs: CaseMessage[]): Row[] {
  const out: Row[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const day = new Date(m.sent_at).toDateString();
    if (day !== lastDay) {
      out.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.sent_at) });
      lastDay = day;
    }
    out.push({ kind: 'msg', key: `msg-${m.id}`, msg: m });
  }
  return out;
}

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

interface CaseRow { id: number; title: string; status?: string }

// ── Main screen ───────────────────────────────────────────────────────────────
function MessagesScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const params = (route?.params as import('../types/api').RouteParams) ?? {};
  const paramCaseId = params.caseId != null && /^\d+$/.test(String(params.caseId))
    ? Number(params.caseId) : null;
  const { lawyerId, lawyerName } = params;

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [isGuest, setIsGuest]       = useState<boolean | null>(null);
  const [myId, setMyId]             = useState<number | null>(null);
  const [activeCase, setActiveCase] = useState<{ id: number; title?: string } | null>(
    paramCaseId ? { id: paramCaseId, title: params.caseTitle as string | undefined } : null
  );
  const [cases, setCases]           = useState<CaseRow[]>([]);
  const [resolving, setResolving]   = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [body, setBody]             = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { messages, loading, sending, error, sendMessage, refresh, clearError } =
    useCaseMessages(isGuest === false ? activeCase?.id : null);

  // ── Who am I (for own-bubble alignment) ────────────────────────────────────
  useEffect(() => {
    secureStorage.getItem('user').then(u => {
      if (!u || !mountedRef.current) return;
      try {
        const id = JSON.parse(u)?.id;
        if (typeof id === 'number') setMyId(id);
      } catch { /* corrupt stored user — alignment falls back to sender_type */ }
    }).catch(() => {});
  }, []);

  // ── Auth check ─────────────────────────────────────────────────────────────
  const checkAuth = useCallback(() => {
    secureStorage.getToken()
      .then(token => { if (mountedRef.current) setIsGuest(!token); })
      .catch(() => { if (mountedRef.current) setIsGuest(true); });
  }, []);
  useEffect(() => { checkAuth(); }, [checkAuth]);

  // ── No caseId: resolve one (lawyer flow) or list the user's cases ──────────
  useEffect(() => {
    if (isGuest !== false || activeCase) return;
    let stale = false;
    setResolving(true);
    setResolveError('');
    (async () => {
      try {
        const res = await api.get('/cases');
        const list: CaseRow[] = Array.isArray(res.data) ? res.data : (res.data?.cases ?? []);
        if (stale || !mountedRef.current) return;
        if (lawyerId || lawyerName) {
          // Same behavior as LawyersScreen.openSecureMessage: reuse an open
          // case, otherwise create a lightweight one to hold the thread.
          const open = list.find(c => ['Open', 'Active'].includes(String(c.status)));
          if (open) { setActiveCase({ id: open.id, title: open.title }); return; }
          const created = await api.post('/cases', {
            title: t('x_messages_message', { value: lawyerName || t('x_attorney_dashboard_attorney') }), status: 'Open', notes: '',
          });
          if (stale || !mountedRef.current) return;
          setActiveCase({ id: created.data.id, title: created.data.title });
        } else {
          setCases(list);
        }
      } catch (e) {
        if (!stale && mountedRef.current) {
          setResolveError(apiErrorMessage(e, t('x_messages_could_not_load_cases')));
        }
      } finally {
        if (!stale && mountedRef.current) setResolving(false);
      }
    })();
    return () => { stale = true; };
  }, [isGuest, activeCase, lawyerId, lawyerName]);

  // ── Header title ───────────────────────────────────────────────────────────
  useEffect(() => {
    const title = activeCase?.title || (params.caseTitle as string | undefined);
    if (title) navigation.setOptions({ title: `💬 ${title}` });
  }, [activeCase?.title, params.caseTitle, navigation]);

  const listRef = useRef<FlatList<Row>>(null);
  const rows = useMemo(() => groupByDay(messages), [messages]);

  const isMine = useCallback((msg: CaseMessage) => {
    if (myId != null) return msg.sender_id === myId;
    return msg.sender_type === 'user';   // fallback: clients are the common case
  }, [myId]);

  const send = useCallback(async () => {
    const draft = body;
    if (!draft.trim() || sending) return;
    setBody('');
    const ok = await sendMessage(draft);
    if (!ok && mountedRef.current) setBody(draft);   // keep the draft on failure
  }, [body, sending, sendMessage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [refresh]);

  // ── Render: auth states ────────────────────────────────────────────────────
  if (isGuest === null) return (
    <View testID="messages-screen" style={[styles.screen, styles.center, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.navy} />
    </View>
  );

  if (isGuest) return (
    <View testID="messages-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AuthGateModal />
      <View style={styles.emptyWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>💬</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>
          {t('x_messages_sign_send_messages')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>
          {t('x_messages_case_messages_private_between')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('ja_sign_in')}
          style={[styles.primaryBtn, { backgroundColor: colors.navy }]}
          onPress={() => requireAuth(() => checkAuth())}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.primaryBtnText, { color: colors.textOnNavy }]}>{t('sign_in')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render: no thread selected yet ─────────────────────────────────────────
  if (!activeCase) {
    if (resolving) return (
      <View testID="messages-screen" style={[styles.screen, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
    return (
      <View testID="messages-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
        {resolveError ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.emergencyBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.errorText, { color: colors.emergency }]}>{resolveError}</Text>
          </View>
        ) : null}
        {cases.length === 0 && !resolveError ? (
          <View style={styles.emptyWrap}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>💬</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>
              {t('msg_empty')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>
              {t('x_messages_messages_live_inside_case')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('x_messages_go_my_cases')}
              style={[styles.primaryBtn, { backgroundColor: colors.navy }]}
              onPress={() => navigation.navigate('Cases')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.primaryBtnText, { color: colors.textOnNavy }]}>{t('x_messages_go_my_cases')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={cases}
            keyExtractor={(c: CaseRow) => String(c.id)}
            contentContainerStyle={styles.pickerContent}
            ListHeaderComponent={
              <Text maxFontSizeMultiplier={1.4} style={[styles.pickerHeader, { color: colors.textMuted }]}>
                {t('x_messages_pick_case_open_its')}
              </Text>
            }
            renderItem={({ item }: { item: CaseRow }) => (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('x_messages_open_messages', { title: item.title })}
                style={[styles.caseRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                onPress={() => setActiveCase({ id: item.id, title: item.title })}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.caseRowTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.status ? (
                  <Text maxFontSizeMultiplier={1.4} style={[styles.caseRowStatus, { color: colors.textMuted }]}>{item.status}</Text>
                ) : null}
                <Text maxFontSizeMultiplier={1.4} style={[styles.caseRowChevron, { color: colors.textMuted }]}>›</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // ── Render: message thread ─────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      testID="messages-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Privacy note — factual: bodies are encrypted at rest server-side */}
      <View style={[styles.privacyNote, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.privacyNoteText, { color: colors.textMuted }]}>
          🔒 {t('msg_e2e_note')}
        </Text>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.emergencyBg }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.errorText, { color: colors.emergency }]}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('x_messages_dismiss_error')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={clearError}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.errorDismiss, { color: colors.emergency }]}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && messages.length === 0 ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(item: Row) => item.key}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>💬</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                {t('msg_empty')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>
                {t('x_messages_start_conversation_below_messages')}
              </Text>
            </View>
          }
          renderItem={({ item }: { item: Row }) => {
            if (item.kind === 'day') {
              return (
                <View style={styles.dayDivider}>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                  <Text maxFontSizeMultiplier={1.4} style={[styles.dayLabel, { color: colors.textMuted }]}>{item.label}</Text>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                </View>
              );
            }
            const msg  = item.msg;
            const mine = isMine(msg);
            return (
              <View
                style={[styles.msgRow, mine && styles.msgRowMine]}
                accessibilityRole="text"
                accessibilityLabel={`${mine ? t('x_messages_text') : msg.sender_name || t('x_messages_legal_team')}: ${msg.body}`}
              >
                <View style={styles.msgCol}>
                  {!mine && msg.sender_name ? (
                    <Text maxFontSizeMultiplier={1.4} style={[styles.senderName, { color: colors.textMuted }]}>
                      {msg.sender_name}
                    </Text>
                  ) : null}
                  <View style={[
                    styles.bubble,
                    mine
                      ? [styles.bubbleMine,   { backgroundColor: colors.navy }]
                      : [styles.bubbleTheirs, { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }],
                  ]}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.bubbleText, { color: mine ? colors.textOnNavy : colors.textPrimary }]}>
                      {msg.body}
                    </Text>
                    {msg.attachment_id ? (
                      <Text maxFontSizeMultiplier={1.4} style={[styles.attachmentText, { color: mine ? colors.textOnNavy : colors.textMuted }]}>
                        📎 {msg.attachment_name || t('x_messages_attachment')}
                        {msg.attachment_size ? `  ·  ${formatBytes(msg.attachment_size)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.metaText, mine && styles.metaTextMine, { color: colors.textMuted }]}>
                    {formatTime(msg.sent_at)}
                    {mine ? (msg.read_at ? '  ' + t('x_messages_read') : '  ' + t('x_messages_sent')) : ''}
                  </Text>
                </View>
              </View>
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
          maxLength={10_000}
          accessibilityLabel={t('x_messages_message_input')}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('msg_send')}
          style={[styles.sendBtn, {
            backgroundColor: body.trim() && !sending ? COLORS.navy : colors.border,
          }]}
          onPress={send}
          disabled={!body.trim() || sending}
        >
          {sending
            ? <ActivityIndicator color={colors.bgCard} size="small" />
            : <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>↑</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen:       { flex: 1 },
  center:       { alignItems: 'center', justifyContent: 'center' },
  listContent:  { padding: 12, paddingBottom: 8, flexGrow: 1, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%' },

  privacyNote:     { paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 0.5, alignItems: 'center' },
  privacyNoteText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', letterSpacing: 0.3 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    paddingHorizontal: 14, gap: 10 },
  errorText:    { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  errorDismiss: { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700', padding: 4 },

  // Day divider
  dayDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, gap: 8 },
  dayLine:    { flex: 1, height: 0.5 },
  dayLabel:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', paddingHorizontal: 8, letterSpacing: 0.3 },

  // Message rows
  msgRow:     { flexDirection: 'row', marginTop: 8 },
  msgRowMine: { justifyContent: 'flex-end' },
  msgCol:     { maxWidth: '82%' },
  senderName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 3, marginLeft: 2 },
  bubble:        { borderRadius: RADIUS.xl, paddingHorizontal: 15, paddingVertical: 9 },
  bubbleMine:    { borderBottomRightRadius: 4 },
  bubbleTheirs:  { borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, lineHeight: 21, letterSpacing: 0.1 },
  attachmentText:{ fontSize: 12, lineHeight: 18, marginTop: 6, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  metaText:      { fontSize: 11, fontWeight: '500', marginTop: 3, marginLeft: 2 },
  metaTextMine:  { textAlign: 'right', marginRight: 2 },

  // Case picker
  pickerContent:  { padding: 16, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%' },
  pickerHeader:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 10 },
  caseRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.lg,
    borderWidth: 1, paddingHorizontal: 16, paddingVertical: 15, marginBottom: 8, minHeight: 52 },
  caseRowTitle:   { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  caseRowStatus:  { fontSize: 11 },
  caseRowChevron: { fontSize: 20 },

  // Empty / auth states
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  emptyIcon:  { fontSize: 44, marginBottom: 14 },
  emptyTitle: { fontSize: 19, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  emptySub:   { fontSize: 12, textAlign: 'center', lineHeight: 20, marginBottom: 18 },
  primaryBtn:     { borderRadius: RADIUS.lg, paddingVertical: 13, paddingHorizontal: 28,
    alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  primaryBtnText: { fontSize: 14, lineHeight: 21, ...FONTS.black },

  // Input bar
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 0.5 },
  input: { flex: 1, borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, maxHeight: 120, lineHeight: 20 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: colors.bgCard, fontSize: 20, fontWeight: '300', lineHeight: 22, marginTop: -1 },
});

export default React.memo(MessagesScreen);
