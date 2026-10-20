/**
 * CourtDatesScreen — core path step 3: "Never miss a court date".
 *
 *  - Signed out: a clear "sign in to save your court date" prompt (court
 *    dates are personal); the court-day checklist and "I missed my court
 *    date" guidance still show.
 *  - Signed in: upcoming hearings (many per case) and an archive of past
 *    ones; "Add a court date" (case, day, optional time, hearing type,
 *    courthouse from the directory) → the server plans reminders 7 days,
 *    3 days, 1 day before and the morning of. Notifications are asked for
 *    in context right after saving.
 *  - Family: cases you follow (court dates only) and "Follow a family
 *    member" with the invite code they shared.
 *  - Offline: the court dates and followed cases saved on this phone.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage, unwrapList, deviceTimeZone } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang, getLang, locale } from '../i18n';
import { getToken } from '../utils/secureStorage';
import { getUserState } from '../utils/userState';
import { requestNotificationsInContext } from '../services/permissions';
import {
  cacheCourtDates, getCachedCourtDates, cacheFollowing, getCachedFollowing, isOfflineError, saveCoreProgress,
  formatCourtDay, formatCourtTime, hearingLabel, statusLabel, HEARING_TYPES, shouldShowDeliveryPrompt, dismissDeliveryPrompt,
  type CourtDate, type CourtDatesList, type FollowedCase, type ReminderDelivery,
} from '../services/corePath';

export interface GuidanceItem { id?: string; text: string; source: string }
export interface Guidance {
  checklist: { title?: string; bring: GuidanceItem[]; wear: GuidanceItem[]; note: string; language?: string };
  missed: { title: string; steps: GuidanceItem[]; note: string; language?: string };
  language?: string;
}
/**
 * Bundled copy of GET /api/court-dates/guidance in the app's language (same
 * text, same sources — the server's catalog is the source; a test checks
 * they match) so it shows offline and before the server answers.
 */
export function bundledGuidance(): Guidance {
  const src = { reminder: t('cg_src_reminder'), lesson: t('cg_src_bail_lesson'), faq: t('cg_src_faq'), calc: t('cg_src_bail_calc') };
  return {
    checklist: {
      title: t('cg_checklist_title'),
      bring: [
        { id: 'bring_1', text: t('cg_bring_1'), source: src.reminder },
        { id: 'bring_2', text: t('cg_bring_2'), source: src.reminder },
        { id: 'bring_3', text: t('cg_bring_3'), source: src.lesson },
      ],
      wear: [{ id: 'wear_1', text: t('cg_wear_1'), source: src.lesson }],
      note: t('cg_checklist_note'),
      language: getLang(),
    },
    missed: {
      title: t('cg_missed_title'),
      steps: [
        { id: 'missed_1', text: t('cg_missed_1'), source: `${src.reminder}; ${src.faq}` },
        { id: 'missed_2', text: t('cg_missed_2'), source: src.faq },
        { id: 'missed_3', text: t('cg_missed_3'), source: src.calc },
        { id: 'missed_4', text: t('cg_missed_4'), source: src.reminder },
      ],
      note: t('cg_missed_note'),
      language: getLang(),
    },
    language: getLang(),
  };
}
/** The server's guidance when it is in the app's language, else the bundled copy. */
export function pickGuidance(server: Guidance | null | undefined): Guidance {
  return server?.missed && (server.language || 'en') === getLang() ? server : bundledGuidance();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function GuidanceView({ g, which, styles }: { g: Guidance; which: 'missed' | 'checklist' | 'both'; styles: any }) {
  useLang();
  return (
    <View>
      {(which === 'missed' || which === 'both') && (
        <View style={styles.box} testID="missed-guidance">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>{g.missed.title}</Text>
          {g.missed.steps.map((s, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text maxFontSizeMultiplier={1.5} style={i === g.missed.steps.length - 1 ? styles.boxStrong : styles.boxText}>{i + 1}. {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{g.missed.note} {t('rc_lawyer_pending')}.</Text>
        </View>
      )}
      {(which === 'checklist' || which === 'both') && (
        <View style={styles.box} testID="court-checklist">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>✅ {t('cd_what_to_bring')}</Text>
          {g.checklist.bring.map((s, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>• {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>👔 {t('cd_what_to_wear')}</Text>
          {g.checklist.wear.map((s, i) => (
            <View key={i}>
              <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>• {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{g.checklist.note}</Text>
        </View>
      )}
    </View>
  );
}

function CourtDatesScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const lang = useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const params = (route?.params || {}) as { add?: boolean; guidance?: 'missed'; caseId?: number | string };
  // Opened from one case ("Court dates & reminders" on its card): show that case's hearings, with "Show all".
  const [onlyCase, setOnlyCase] = useState<number | null>(params.caseId != null && Number(params.caseId) > 0 ? Number(params.caseId) : null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [list, setList] = useState<CourtDatesList | null>(null);
  const [following, setFollowing] = useState<FollowedCase[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [serverGuidance, setServerGuidance] = useState<Guidance | null>(null);
  const guidance = pickGuidance(serverGuidance);
  const [showMissed, setShowMissed] = useState(params.guidance === 'missed');
  const [showPast, setShowPast] = useState(false);
  const [delivery, setDelivery] = useState<ReminderDelivery | null>(null);

  // add form
  const [adding, setAdding] = useState(false);
  const [cases, setCases] = useState<{ id: number; title: string; state: string | null }[]>([]);
  const [caseId, setCaseId] = useState<number | null>(params.caseId != null && Number(params.caseId) > 0 ? Number(params.caseId) : null);
  const [caseTitle, setCaseTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [hearing, setHearing] = useState('');
  const [chQuery, setChQuery] = useState('');
  const [chResults, setChResults] = useState<{ id: number; name: string; address: string; city: string; state: string }[]>([]);
  const [courthouse, setCourthouse] = useState<{ id: number; name: string } | null>(null);
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // follow
  const [code, setCode] = useState('');
  const [following_, setFollowingBusy] = useState(false);

  const load = useCallback(async () => {
    const tok = await getToken().catch(() => null);
    if (!mounted.current) return;
    setSignedIn(!!tok);
    api.get<Guidance>('/court-dates/guidance').then(r => { if (mounted.current && r.data?.missed) setServerGuidance(r.data); }).catch(() => {});
    if (!tok) { setPhase('ok'); return; }
    try {
      const [cd, fol] = await Promise.all([
        api.get<CourtDatesList>('/court-dates'),
        api.get<{ following: FollowedCase[] }>('/following').catch(() => null),
      ]);
      if (!mounted.current) return;
      setList(cd.data); setPhase('ok'); setSavedAt(null);
      cacheCourtDates(cd.data).catch(() => {});
      const rd = cd.data?.reminder_delivery || null;
      shouldShowDeliveryPrompt(rd).then(show => { if (mounted.current) setDelivery(show ? rd : null); }).catch(() => {});
      if (fol?.data?.following) { setFollowing(fol.data.following); cacheFollowing(fol.data.following).catch(() => {}); }
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const [c, f] = await Promise.all([getCachedCourtDates(), getCachedFollowing()]);
        if (c || f) {
          if (c) { setList(c.list); setSavedAt(c.at); }
          if (f) setFollowing(f.list);
          setPhase('offline'); return;
        }
      }
      setErrorMsg(isOfflineError(e) ? t('cd_offline_none') : apiErrorMessage(e, t('cd_load_failed')));
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Language switched: guidance and server messages in the new language.
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    load();
  }, [lang, load]);

  const openAdd = useCallback(async () => {
    setFormError(''); setAdding(true);
    try {
      const r = await api.get('/cases');
      const rows = unwrapList<{ id: number; title: string; state: string | null }>(r.data);
      if (mounted.current) { setCases(rows); if (!caseId && rows.length === 1) setCaseId(rows[0].id); }
    } catch { /* new case only */ }
  }, [caseId]);
  useEffect(() => { if (params.add && signedIn) openAdd(); }, [params.add, signedIn, openAdd]);

  const searchCourthouses = async () => {
    const q = chQuery.trim();
    if (q.length < 2) return;
    const st = (await getUserState())?.code;
    try {
      const r = await api.get('/courthouses', { params: { q, ...(st ? { state: st } : {}), limit: 10 } });
      if (mounted.current) setChResults(unwrapList(r.data));
    } catch (e) { showToast(apiErrorMessage(e, t('cd_courthouse_search_failed')), 'error'); }
  };

  const save = async () => {
    if (savingRef.current) return;
    const d = date.trim(); const tm = time.trim();
    if (!DATE_RE.test(d)) { setFormError(t('cd_err_date')); return; }
    if (tm && !TIME_RE.test(tm)) { setFormError(t('cd_err_time')); return; }
    if (!caseId && !caseTitle.trim()) { setFormError(t('cd_err_case')); return; }
    savingRef.current = true; setSaving(true); setFormError('');
    try {
      const st = (await getUserState())?.code;
      const body: Record<string, unknown> = {
        court_date: d, court_time: tm || undefined, hearing_type: hearing || undefined,
        courthouse_id: courthouse?.id, location: location.trim() || undefined,
      };
      if (caseId) body.case_id = caseId; else { body.case_title = caseTitle.trim(); if (st) body.state = st; }
      const tz = deviceTimeZone();
      const r = await api.post<CourtDate & { reminders: { deliver_at: string; days_before: number }[] }>('/court-dates', body, tz ? { headers: { 'X-Timezone': tz } } : undefined);
      const n = r.data.reminders?.length || 0;
      showToast(n ? (n === 4 ? t('cd_saved_all') : n === 1 ? t('cd_saved_one') : t('cd_saved_n', { n })) : t('cd_saved_past'), 'success');
      saveCoreProgress({ mark: 'court' }).catch(() => {});
      setAdding(false);
      setDate(''); setTime(''); setHearing(''); setCourthouse(null); setLocation(''); setCaseTitle(''); setChResults([]); setChQuery('');
      requestNotificationsInContext().catch(() => {});
      await load();
      (navigation as any).navigate('CourtDateDetail', { id: r.data.id });
    } catch (e: any) {
      setFormError(e?.response?.status === 409 ? t('cd_err_duplicate') : apiErrorMessage(e, t('cd_save_failed')));
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  const follow = async () => {
    const c = code.trim();
    if (c.replace(/[^A-Za-z0-9]/g, '').length < 10) { showToast(t('cd_code_hint'), 'warning'); return; }
    setFollowingBusy(true);
    try {
      await api.post('/following/accept', { code: c });
      showToast(t('cd_follow_ok'), 'success');
      setCode('');
      load();
    } catch (e) { showToast(apiErrorMessage(e, t('cd_code_failed')), 'error'); }
    finally { if (mounted.current) setFollowingBusy(false); }
  };

  const unfollow = async (f: FollowedCase) => {
    const ok = await confirm(t('cd_unfollow_q', { title: f.case_title }), t('cd_unfollow_body'), { confirmLabel: t('cd_unfollow'), destructive: true });
    if (!ok) return;
    try {
      await api.delete(`/following/${f.follow_id}`);
      setFollowing(list => list.filter(x => x.follow_id !== f.follow_id));
      showToast(t('cd_unfollowed'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cd_unfollow_failed')), 'error'); }
  };

  const onRefresh = async () => { setRefreshing(true); await load(); if (mounted.current) setRefreshing(false); };

  const Row = ({ d }: { d: CourtDate }) => (
    <TouchableOpacity accessibilityRole="button" testID="court-date-row" style={[styles.row, d.archived && styles.rowPast]}
      accessibilityLabel={d.court_time ? t('cd_row_a11y_time', { title: d.case_title, day: formatCourtDay(d.court_date), time: formatCourtTime(d.court_time) }) : t('cd_row_a11y', { title: d.case_title, day: formatCourtDay(d.court_date) })}
      onPress={() => (navigation as any).navigate('CourtDateDetail', { id: d.id })}>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowDate}>📅 {formatCourtDay(d.court_date)}{d.court_time ? ` · ${formatCourtTime(d.court_time)}` : ''}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{d.case_title}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
        {[d.hearing_type ? hearingLabel(d.hearing_type) : null, d.courthouse?.name, d.archived ? (d.status === 'scheduled' ? t('cd_past') : statusLabel(d.status)) : null].filter(Boolean).join(' · ')}
      </Text>
    </TouchableOpacity>
  );

  if (signedIn === false) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="court-dates-screen">
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('ja_s3')}</Text>
        <View style={styles.box} testID="court-dates-sign-in">
          <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>🔐 {t('ja_court_signin')}</Text>
          <TouchableOpacity accessibilityRole="button" testID="court-dates-register" style={styles.primaryBtn} onPress={() => (navigation as any).navigate('Register')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ja_create')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="court-dates-login" style={styles.secondaryBtn} onPress={() => (navigation as any).navigate('Login')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('ja_sign_in')}</Text>
          </TouchableOpacity>
        </View>
        <GuidanceView g={guidance} which={showMissed ? 'both' : 'checklist'} styles={styles} />
        {!showMissed && (
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setShowMissed(true)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ {t('ja_missed')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen} testID="court-dates-screen">
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('ja_my_court_dates')}</Text>
        {phase === 'offline' && (
          <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="court-dates-offline">
            📴 {savedAt ? t('cd_offline_saved_at', { when: new Date(savedAt).toLocaleString(locale()) }) : t('cd_offline_saved')}
          </Text>
        )}
        <TouchableOpacity accessibilityRole="button" testID="court-date-add" style={[styles.primaryBtn, phase === 'offline' && { opacity: 0.5 }]} onPress={openAdd} disabled={phase === 'offline'}>
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>＋ {t('cd_add')}</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cd_remind_note')}</Text>
        {!!delivery && phase === 'ok' && (
          <View style={styles.box} testID="reminder-delivery-prompt">
            <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>
              ⚠️ {delivery.message || t('cd_delivery_problem')}
            </Text>
            <TouchableOpacity accessibilityRole="button" testID="reminder-delivery-notifications" style={styles.secondaryBtn}
              onPress={async () => {
                const answer = await requestNotificationsInContext().catch(() => 'declined');
                if (answer === 'granted') { await dismissDeliveryPrompt(delivery); setDelivery(null); showToast(t('cd_notif_on'), 'success'); }
              }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>🔔 {t('cd_turn_on_notif')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="reminder-delivery-email" style={styles.secondaryBtn}
              onPress={() => { dismissDeliveryPrompt(delivery).catch(() => {}); setDelivery(null); (navigation as any).navigate('Settings'); }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>✉️ {t('cd_add_email')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="reminder-delivery-dismiss" style={styles.secondaryBtn}
              onPress={() => { dismissDeliveryPrompt(delivery).catch(() => {}); setDelivery(null); }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cd_not_now')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'loading' && <ActivityIndicator style={{ marginVertical: 20 }} color={colors.textBrand} accessibilityLabel={t('cd_loading_a11y')} />}
        {phase === 'error' && (
          <View style={styles.box} testID="court-dates-error">
            <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{errorMsg}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={load}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('try_again')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {(phase === 'ok' || phase === 'offline') && list && (() => {
          const upcoming = onlyCase ? list.upcoming.filter(d => d.case_id === onlyCase) : list.upcoming;
          const past = onlyCase ? list.past.filter(d => d.case_id === onlyCase) : list.past;
          const caseName = onlyCase ? [...list.upcoming, ...list.past].find(d => d.case_id === onlyCase)?.case_title : null;
          return (
          <>
            {!!onlyCase && (
              <View style={styles.followRow} testID="court-dates-case-filter">
                <Text maxFontSizeMultiplier={1.4} style={[styles.muted, { flex: 1 }]}>{caseName ? t('cd_only_case', { title: caseName }) : t('cd_only_case_none')}</Text>
                <TouchableOpacity accessibilityRole="button" style={styles.goBtn} onPress={() => setOnlyCase(null)} testID="court-dates-show-all">
                  <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('cd_show_all')}</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text maxFontSizeMultiplier={1.4} style={styles.group}>{t('cd_upcoming', { n: upcoming.length })}</Text>
            {upcoming.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="court-dates-empty">{t('cd_none_upcoming')}</Text>}
            {upcoming.map(d => <Row key={d.id} d={d} />)}
            {past.length > 0 && (
              <TouchableOpacity accessibilityRole="button" testID="court-dates-past-toggle" style={styles.secondaryBtn} onPress={() => setShowPast(v => !v)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t(showPast ? 'cd_hide_past' : 'cd_show_past', { n: past.length })}</Text>
              </TouchableOpacity>
            )}
            {showPast && past.map(d => <Row key={d.id} d={d} />)}
          </>
          );
        })()}

        {(phase === 'ok' || phase === 'offline') && (
          <View testID="following-section">
            <Text maxFontSizeMultiplier={1.4} style={styles.group}>👨‍👩‍👧 {t('cd_family_title')}</Text>
            {following.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cd_family_empty')}</Text>}
            {following.map(f => (
              <View key={f.follow_id} style={styles.row} testID="following-case">
                <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{f.owner_first_name ? `${f.owner_first_name}: ` : ''}{f.case_title}</Text>
                {f.court_dates.filter(d => !d.is_past).map(d => (
                  <Text key={d.id} maxFontSizeMultiplier={1.4} style={styles.rowDate} testID="following-court-date">
                    📅 {formatCourtDay(d.court_date)}{d.court_time ? ` · ${formatCourtTime(d.court_time)}` : ''}{d.courthouse ? ` · ${d.courthouse.name}` : ''}
                  </Text>
                ))}
                {f.court_dates.filter(d => !d.is_past).length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{t('cd_follow_no_dates')}</Text>}
                {phase === 'ok' && (
                  <TouchableOpacity accessibilityRole="button" testID="following-stop" style={[styles.secondaryBtn, { minHeight: 44, paddingVertical: 8 }]} onPress={() => unfollow(f)}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cd_unfollow')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {phase === 'ok' && (
              <View style={styles.followRow}>
                <TextInput accessibilityLabel={t('cd_code_a11y')} testID="follow-code-input" style={styles.input}
                  placeholder={t('cd_code_placeholder')} placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={code} onChangeText={setCode} />
                <TouchableOpacity accessibilityRole="button" testID="follow-code-submit" style={styles.goBtn} onPress={follow} disabled={following_}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{following_ ? '…' : t('cd_follow')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <GuidanceView g={guidance} which={showMissed ? 'both' : 'checklist'} styles={styles} />
        {!showMissed && (
          <TouchableOpacity accessibilityRole="button" testID="court-dates-missed" style={styles.secondaryBtn} onPress={() => setShowMissed(true)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ {t('ja_missed')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)} accessibilityViewIsModal>
        <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="court-date-form">
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('cd_add')}</Text>
          {cases.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_case')}</Text>
              <View style={styles.chipsWrap}>
                {cases.slice(0, 8).map(c => (
                  <TouchableOpacity key={c.id} accessibilityRole="radio" accessibilityState={{ selected: caseId === c.id }} testID="court-form-case"
                    style={[styles.chip, caseId === c.id && styles.chipOn]} onPress={() => setCaseId(caseId === c.id ? null : c.id)}>
                    <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, caseId === c.id && styles.chipTextOn]}>{c.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {!caseId && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_name_case')}</Text>
              <TextInput accessibilityLabel={t('cd_case_name_a11y')} testID="court-form-title" style={styles.inputFull} value={caseTitle} onChangeText={setCaseTitle}
                placeholder={t('cd_case_placeholder')} placeholderTextColor={colors.textMuted} maxLength={300} />
            </>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_court_date')}</Text>
          <TextInput accessibilityLabel={t('cd_date_a11y')} testID="court-form-date" style={styles.inputFull} value={date} onChangeText={setDate}
            placeholder={t('cd_date_placeholder')} placeholderTextColor={colors.textMuted} maxLength={10} />
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_time_optional')}</Text>
          <TextInput accessibilityLabel={t('cd_time_a11y')} testID="court-form-time" style={styles.inputFull} value={time} onChangeText={setTime}
            placeholder={t('cd_time_placeholder')} placeholderTextColor={colors.textMuted} maxLength={5} />
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_hearing_optional')}</Text>
          <View style={styles.chipsWrap}>
            {HEARING_TYPES.map(h => (
              <TouchableOpacity key={h} accessibilityRole="radio" accessibilityState={{ selected: hearing === h }} testID={`court-form-hearing-${h}`}
                style={[styles.chip, hearing === h && styles.chipOn]} onPress={() => setHearing(hearing === h ? '' : h)}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, hearing === h && styles.chipTextOn]}>{hearingLabel(h)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_courthouse_optional')}</Text>
          {courthouse ? (
            <TouchableOpacity accessibilityRole="button" testID="court-form-courthouse-selected" style={styles.row} onPress={() => setCourthouse(null)}>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>🏛️ {courthouse.name}  ✕</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.followRow}>
                <TextInput accessibilityLabel={t('cd_courthouse_q_a11y')} testID="court-form-courthouse-q" style={styles.input} value={chQuery}
                  onChangeText={setChQuery} onSubmitEditing={searchCourthouses} placeholder={t('cd_courthouse_q')} placeholderTextColor={colors.textMuted} />
                <TouchableOpacity accessibilityRole="button" testID="court-form-courthouse-search" style={styles.goBtn} onPress={searchCourthouses}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('cd_find')}</Text>
                </TouchableOpacity>
              </View>
              {chResults.map(c => (
                <TouchableOpacity key={c.id} accessibilityRole="button" testID="court-form-courthouse-option" style={styles.row} onPress={() => { setCourthouse({ id: c.id, name: c.name }); setChResults([]); }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{c.name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{c.address}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_room_optional')}</Text>
          <TextInput accessibilityLabel={t('cd_room_a11y')} testID="court-form-location" style={styles.inputFull} value={location} onChangeText={setLocation}
            placeholder={t('cd_room_placeholder')} placeholderTextColor={colors.textMuted} maxLength={200} />
          {!!formError && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="court-form-error">{formError}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="court-form-save" style={styles.primaryBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('cd_save_reminders')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setAdding(false)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

export const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { color: c.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 10 },
  group: { color: c.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  muted: { color: c.textSecond, fontSize: 14, lineHeight: 20, marginVertical: 6 },
  label: { color: c.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  offline: { color: c.warnDark, backgroundColor: c.warnBg, borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 8 },
  row: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border, minHeight: 48 },
  rowPast: { opacity: 0.8 },
  rowDate: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  rowTitle: { color: c.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 },
  rowSub: { color: c.textSecond, fontSize: 13, marginTop: 2 },
  box: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginVertical: 10, borderWidth: 1, borderColor: c.border },
  boxTitle: { color: c.textPrimary, fontSize: 17, fontWeight: '900', marginBottom: 6, marginTop: 4 },
  boxText: { color: c.textPrimary, fontSize: 16, lineHeight: 23 },
  boxStrong: { color: c.textPrimary, fontSize: 17, lineHeight: 24, fontWeight: '900' },
  source: { color: c.textMuted, fontSize: 11, lineHeight: 15 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center', minHeight: 52, marginTop: 8 },
  primaryBtnText: { color: c.white, fontSize: 17, fontWeight: '900' },
  secondaryBtn: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingVertical: 14, alignItems: 'center', minHeight: 48, marginTop: 8 },
  secondaryBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  followRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  inputFull: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  goBtn: { backgroundColor: c.navy, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', minHeight: 48 },
  goBtnText: { color: c.white, fontSize: 15, fontWeight: '800' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: c.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipText: { color: c.textPrimary, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.white },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginTop: 10 },
});

export default React.memo(CourtDatesScreen);
