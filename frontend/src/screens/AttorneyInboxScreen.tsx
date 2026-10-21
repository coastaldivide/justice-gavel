/**
 * AttorneyInboxScreen — everything waiting for the attorney (GET /attorney/inbox):
 *   • Direct messages — people who wrote from the Lawyers list or a profile ("message
 *     attorneys"); open one to read the whole conversation and reply (POST /messages/direct)
 *   • Case invites to accept, today's hearings, upcoming consultations
 *   • Unread client messages in case threads, recent cases
 * Refreshes every 60 s while open. Times are shown in the phone's zone (the server
 * works out "today" from X-Timezone).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { DirectConversation } from '../components/DirectConversation';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

type Direct = { user_id: number; name: string | null; last_message: string; last_from_me: boolean; last_at: string; unread: number };
type Unread = { id: number; case_id: number; body: string; sent_at: string; client_name: string | null; case_title: string | null };
type Invite = { assignment_id: number; case_id: number; title: string | null; state: string | null; client_name: string | null; referral_notes: string | null };
type Consult = { id: number; starts_at: string | null; time_zone: string | null; date_slot: string | null; time_slot: string | null; duration_min: number | null; client_name: string | null };
type Hearing = { court_date_id: number; case_id: number; court_time: string | null; hearing_type: string | null; location: string | null; title: string | null; client_name: string | null };
type Recent = { case_id: number; title: string | null; status: string | null; unread_count: number; client_name: string | null };
type Inbox = { summary: { unread_direct: number; unread_messages: number; pending_assignments: number; today_events: number };
  direct_messages: Direct[]; unread_messages: Unread[]; pending_assignments: Invite[]; upcoming_consultations: Consult[]; today_hearings: Hearing[]; recent_cases: Recent[] };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function AttorneyInboxScreen() {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const { showToast } = useToast();
  const { hasSession, recheck } = useHasSession();
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [openWith, setOpenWith] = useState<Direct | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const r = await api.get<Inbox>('/attorney/inbox');   // services/api.ts sends X-Timezone
      if (mounted.current) { setData(r.data); setError(''); }
    } catch (e) {
      if (mounted.current && !quiet) setError(apiErrorMessage(e, t('x_attorney_inbox_could_not_load_inbox')));
    } finally { if (mounted.current) setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!hasSession) return undefined;
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [hasSession, load]));

  const accept = async (inv: Invite) => {
    setAccepting(inv.assignment_id);
    try { await api.post(`/attorney/inbox/accept/${inv.assignment_id}`, {}); showToast(t('x_attorney_inbox_case_accepted_client_has'), 'success'); load(true); }
    catch (e) { showToast(apiErrorMessage(e, t('x_attorney_inbox_could_not_accept_assignment')), 'error'); }
    finally { if (mounted.current) setAccepting(null); }
  };
  const openCase = (caseId: number, title: string | null) => {
    api.post(`/attorney/inbox/mark-read/${caseId}`, {}).catch(() => {});
    navigation.navigate('Messages', { caseId, caseTitle: title || undefined });
  };

  if (hasSession === false) return <View style={{ flex: 1, backgroundColor: colors.bg }}><SignInNeeded navigation={navigation as never} title={t('x_nav_attorney_inbox')} body={t('ai_signin_body')} onSignedIn={recheck} /></View>;
  if (openWith) return <DirectConversation who={{ user_id: openWith.user_id, name: openWith.name }} onClose={() => { setOpenWith(null); load(true); }} />;
  if (!data && !error) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;

  const sm = data?.summary;
  const empty = data && !data.direct_messages.length && !data.unread_messages.length && !data.pending_assignments.length && !data.upcoming_consultations.length && !data.today_hearings.length;
  return (
    <ScrollView testID="attorney-inbox-screen" style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {!!error && <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{error}</Text></View>}
      {sm && (
        <View style={s.summary} testID="inbox-summary">
          {[[sm.unread_direct, t('ai_sum_direct')], [sm.unread_messages, t('ai_sum_case')], [sm.pending_assignments, t('ai_sum_invites')], [sm.today_events, t('x_attorney_inbox_today')]].map(([n, l]) => (
            <View key={String(l)} style={s.sumCell}><Text maxFontSizeMultiplier={1.2} style={s.sumVal}>{String(n)}</Text><Text maxFontSizeMultiplier={1.2} style={s.sumLabel}>{String(l)}</Text></View>
          ))}
        </View>
      )}
      {empty && <View style={s.card} testID="inbox-empty"><Text maxFontSizeMultiplier={1.4} style={s.title}>{t('x_attorney_inbox_all_caught_up')}</Text><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ai_empty_body')}</Text></View>}

      {!!data?.direct_messages.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_direct')}</Text>}
      {data?.direct_messages.map(d => (
        <TouchableOpacity key={d.user_id} accessibilityRole="button" testID="inbox-direct" style={[s.card, d.unread > 0 && { borderColor: colors.navy }]} onPress={() => setOpenWith(d)}>
          <View style={s.rowBetween}>
            <Text maxFontSizeMultiplier={1.4} style={[s.title, { flex: 1 }]}>{d.name || t('ai_someone')}</Text>
            {d.unread > 0 && <View style={s.pill}><Text maxFontSizeMultiplier={1.2} style={s.pillText}>{d.unread}</Text></View>}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.line} numberOfLines={2}>{d.last_from_me ? `${t('ai_you')}: ` : ''}{d.last_message}</Text>
          <Text maxFontSizeMultiplier={1.2} style={s.meta}>{when(d.last_at)}</Text>
        </TouchableOpacity>
      ))}

      {!!data?.pending_assignments.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_invites')}</Text>}
      {data?.pending_assignments.map(a => (
        <View key={a.assignment_id} style={s.card} testID="inbox-invite">
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{a.title || t('x_attorney_dashboard_case', { id: a.case_id })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{a.client_name}</Text>
          {!!a.referral_notes && <Text maxFontSizeMultiplier={1.4} style={s.line}>{a.referral_notes}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="inbox-accept" style={[s.primaryBtn, accepting === a.assignment_id && { opacity: 0.6 }]} disabled={accepting === a.assignment_id} onPress={() => accept(a)}>
            <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_attorney_inbox_accept_case')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!!data?.today_hearings.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_hearings_today')}</Text>}
      {data?.today_hearings.map(h => (
        <TouchableOpacity key={h.court_date_id} accessibilityRole="button" style={s.card} onPress={() => navigation.navigate('CourtDateDetail', { id: h.court_date_id })}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{h.title || t('x_attorney_dashboard_case', { id: h.case_id })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{[h.court_time, h.location, h.client_name].filter(Boolean).join(' · ')}</Text>
        </TouchableOpacity>
      ))}

      {!!data?.upcoming_consultations.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_consults')}</Text>}
      {data?.upcoming_consultations.map(c => (
        <View key={c.id} style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{c.client_name || t('ai_someone')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{c.starts_at ? when(c.starts_at) : [c.date_slot, c.time_slot].filter(Boolean).join(' ')}{c.duration_min ? ` · ${t('ai_minutes', { n: c.duration_min })}` : ''}</Text>
        </View>
      ))}

      {!!data?.unread_messages.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_case_messages')}</Text>}
      {data?.unread_messages.map(m => (
        <TouchableOpacity key={m.id} accessibilityRole="button" style={s.card} onPress={() => openCase(m.case_id, m.case_title)}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{m.client_name} · {m.case_title}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line} numberOfLines={2}>{m.body}</Text>
          <Text maxFontSizeMultiplier={1.2} style={s.meta}>{when(m.sent_at)}</Text>
        </TouchableOpacity>
      ))}

      {!!data?.recent_cases.length && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ai_recent_cases')}</Text>}
      {data?.recent_cases.map(c => (
        <TouchableOpacity key={c.case_id} accessibilityRole="button" style={s.card} onPress={() => openCase(c.case_id, c.title)}>
          <View style={s.rowBetween}>
            <Text maxFontSizeMultiplier={1.4} style={[s.title, { flex: 1 }]}>{c.title || t('x_attorney_dashboard_case', { id: c.case_id })}</Text>
            {c.unread_count > 0 && <View style={s.pill}><Text maxFontSizeMultiplier={1.2} style={s.pillText}>{c.unread_count}</Text></View>}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{c.client_name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', gap: 6, marginHorizontal: 12, marginTop: 12 },
  sumCell: { flex: 1, backgroundColor: colors.navy, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center', paddingHorizontal: 2 },
  sumVal: { fontSize: 20, ...FONTS.black, color: colors.textOnNavy },
  sumLabel: { fontSize: 11, color: colors.textOnNavy, opacity: 0.9, textAlign: 'center' },
  section: { fontSize: 12, ...FONTS.black, color: colors.textMuted, letterSpacing: 1, marginTop: 18, marginHorizontal: 16, textTransform: 'uppercase' },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 8, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  pill: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pillText: { color: colors.textOnNavy, fontSize: 12, ...FONTS.heavy },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
});
