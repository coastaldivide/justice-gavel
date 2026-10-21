/**
 * CheckInScreen — the defendant's post-release check-in.
 *
 * Opens from the bail agent's link (CheckIn?enrollmentId=…) or directly: the
 * app then looks for the enrollments that match this account's phone / e-mail
 * (GET /checkins/mine) — one opens straight away, several can be picked.
 * "Today" is the defendant's own day (the server works it out in their zone).
 * Location is sent only when the person turns it on for this check-in.
 * The bail agent is told by push; the screen says so only when it really went out.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { getLocation } from '../services/location';
import { hapticSuccess } from '../services/haptics';
import { formatCourtDay } from '../services/corePath';
import { daysUntil } from '../utils/dateUtils';
import { getToken } from '../utils/secureStorage';
import { useAuthGate } from '../components/AuthGate';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

export interface Enrollment {
  id: number; defendant_name: string; case_number: string | null; court_date: string | null; check_in_freq: 'daily' | 'weekly';
  agent_name: string | null; checked_in_today: boolean; done_for_period: boolean; next_due: string; streak: number;
  total_checkins: number; today: string; time_zone: string;
}
type Phase = 'loading' | 'guest' | 'none' | 'pick' | 'ready' | 'submitting' | 'error';

/** "Today" / "Tomorrow" / the day, relative to the defendant's today. */
export function dueLabel(nextDue: string, today: string): string {
  if (nextDue === today) return t('ck2_due_today');
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return nextDue === tomorrow ? t('ck2_due_tomorrow') : t('ck2_due_on', { day: formatCourtDay(nextDue) });
}

function CheckInScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const paramId = Number((route?.params as { enrollmentId?: string | number } | undefined)?.enrollmentId) || null;
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [phase, setPhase] = useState<Phase>('loading');
  const [list, setList] = useState<Enrollment[]>([]);
  const [current, setCurrent] = useState<Enrollment | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [notes, setNotes] = useState('');
  const [place, setPlace] = useState('');
  const [withLocation, setWithLocation] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'' | 'getting' | 'ready' | 'unavailable'>('');
  const [result, setResult] = useState<{ notified: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!(await getToken().catch(() => null))) { if (mounted.current) setPhase('guest'); return; }
    try {
      if (paramId) {
        const r = await api.get<{ enrollment: Enrollment }>(`/checkins/status/${paramId}`);
        if (!mounted.current) return;
        setCurrent(r.data.enrollment); setPhase('ready');
        return;
      }
      const r = await api.get<{ enrollments: Enrollment[] }>('/checkins/mine');
      if (!mounted.current) return;
      const rows = r.data?.enrollments || [];
      setList(rows);
      setCurrent(prev => (prev ? rows.find(e => e.id === prev.id) || null : rows.length === 1 ? rows[0] : null));
      setPhase(rows.length === 0 ? 'none' : rows.length === 1 ? 'ready' : 'pick');
    } catch (e: any) {
      if (!mounted.current) return;
      if (e?.response?.status === 404) { setPhase('none'); return; }
      setErrorMsg(apiErrorMessage(e, t('x_check_in_could_not_load_check')));
      setPhase('error');
    }
  }, [paramId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (phase === 'pick' && current) setPhase('ready'); }, [phase, current]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => { if (mounted.current) setRefreshing(false); }); };

  const toggleLocation = () => {
    const next = !withLocation;
    setWithLocation(next);
    setCoords(null);
    if (!next) { setLocStatus(''); return; }
    setLocStatus('getting');
    getLocation()
      .then(loc => { if (mounted.current) { setCoords({ lat: loc.lat, lng: loc.lng }); setLocStatus('ready'); } })
      .catch(() => { if (mounted.current) setLocStatus('unavailable'); });
  };

  const submit = async () => {
    if (!current || phase === 'submitting') return;
    setPhase('submitting'); setErrorMsg('');
    try {
      const r = await api.post<{ agent_notified: boolean; next_due: string; streak: number; total_checkins: number; today: string }>('/checkins/submit', {
        enrollment_id: current.id, notes: notes.trim() || undefined, location_label: place.trim() || undefined,
        ...(withLocation && coords ? { lat: coords.lat, lng: coords.lng } : {}),
      });
      if (!mounted.current) return;
      hapticSuccess();
      setResult({ notified: !!r.data.agent_notified });
      setCurrent(c => (c ? { ...c, checked_in_today: true, done_for_period: true, next_due: r.data.next_due, streak: r.data.streak, total_checkins: r.data.total_checkins, today: r.data.today } : c));
      setNotes(''); setPlace('');
      setPhase('ready');
    } catch (e: any) {
      if (!mounted.current) return;
      if (e?.response?.status === 409) { await load(); return; }
      setErrorMsg(apiErrorMessage(e, t('x_check_in_check_failed_try_again')));
      setPhase('ready');
    }
  };

  const Center = ({ children }: { children: React.ReactNode }) => (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.scroll, { alignItems: 'stretch' }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {children}
      <AuthGateModal />
    </ScrollView>
  );

  if (phase === 'loading') return <View style={[styles.screen, styles.centerBox]}><ActivityIndicator color={colors.textBrand} accessibilityLabel={t('checkin_loading')} /></View>;
  if (phase === 'guest') return (
    <Center>
      <View style={styles.box} testID="checkin-guest">
        <Text maxFontSizeMultiplier={1.4} style={styles.title}>{t('x_check_in_daily_check')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('ck2_sign_in')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => requireAuth(() => load())}>
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('sign_in')}</Text>
        </TouchableOpacity>
      </View>
    </Center>
  );
  if (phase === 'error') return (
    <Center>
      <View style={styles.box} testID="checkin-error">
        <Text maxFontSizeMultiplier={1.4} style={styles.title}>{t('checkin_unavailable')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.body}>{errorMsg}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => { setPhase('loading'); load(); }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    </Center>
  );
  if (phase === 'none') return (
    <Center>
      <View style={styles.box} testID="checkin-none">
        <Text maxFontSizeMultiplier={1.4} style={styles.title}>{t('ck2_none_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('ck2_none_body')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ck2_none_steps')}</Text>
        <TouchableOpacity accessibilityRole="button" testID="checkin-enroll-button" style={styles.secondaryBtn} onPress={() => navigation.navigate('BailTab' as never)}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('x_check_in_find_bail_bondsman')}</Text>
        </TouchableOpacity>
      </View>
    </Center>
  );
  if (phase === 'pick' && !current) return (
    <Center>
      <Text maxFontSizeMultiplier={1.4} style={styles.title}>{t('ck2_pick')}</Text>
      {list.map(e => (
        <TouchableOpacity key={e.id} accessibilityRole="button" testID="checkin-pick" style={styles.box} onPress={() => setCurrent(e)}>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{e.agent_name || t('ck2_your_agent')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.small}>{e.done_for_period ? t('ck2_done_short') : dueLabel(e.next_due, e.today)}</Text>
        </TouchableOpacity>
      ))}
    </Center>
  );

  const e = current as Enrollment;
  const courtDays = e.court_date ? daysUntil(e.court_date) : null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView testID="checkin-screen" style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle}>{t(e.check_in_freq === 'weekly' ? 'ck2_weekly_title' : 'x_check_in_daily_check')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>{t('ck2_for_agent', { agent: e.agent_name || t('ck2_your_agent') })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>{e.defendant_name}{e.case_number ? ` · ${e.case_number}` : ''}</Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}><Text maxFontSizeMultiplier={1.3} style={styles.statNum} testID="checkin-streak-count">{e.streak}</Text><Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>{t('ck2_streak')}</Text></View>
          <View style={styles.stat}><Text maxFontSizeMultiplier={1.3} style={styles.statNum}>{e.total_checkins}</Text><Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>{t('x_check_in_total_check_ins')}</Text></View>
          {courtDays !== null && courtDays >= 0 && (
            <View style={styles.stat}><Text maxFontSizeMultiplier={1.3} style={styles.statNum}>{courtDays}</Text><Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>{t('ck2_days_to_court')}</Text></View>
          )}
        </View>
        {!!e.court_date && courtDays !== null && courtDays >= 0 && courtDays <= 7 && (
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.warn} maxFontSizeMultiplier={1.4}>{t('ck2_court_soon', { day: formatCourtDay(e.court_date) })}</IconLabel>
        )}

        {e.done_for_period ? (
          <View style={styles.doneBox} testID={result ? 'checkin-success-screen' : 'checkin-done'}>
            <Text maxFontSizeMultiplier={1.2} style={styles.doneCheck}>✓</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.doneTitle}>{result ? t('checkin_complete') : e.check_in_freq === 'weekly' ? t('ck2_done_week') : t('checkin_already_done')}</Text>
            {!!result && <Text maxFontSizeMultiplier={1.4} style={styles.body}>{result.notified ? t('ck2_agent_notified') : t('ck2_agent_will_see')}</Text>}
            <Text maxFontSizeMultiplier={1.4} style={styles.body} testID="checkin-next-due">{t('ck2_next', { when: dueLabel(e.next_due, e.today) })}</Text>
          </View>
        ) : (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.due} testID="checkin-due">{t('ck2_due_now', { when: dueLabel(e.next_due, e.today) })}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_check_in_where')} <Text style={styles.small}>{t('x_check_in_optional')}</Text></Text>
            <TextInput accessibilityLabel={t('x_check_in_where')} testID="checkin-place-input" style={styles.input} value={place} onChangeText={setPlace}
              placeholder={t('ck2_place_placeholder')} placeholderTextColor={colors.textMuted} maxLength={200} />
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_check_in_any_notes')} <Text style={styles.small}>{t('x_check_in_optional')}</Text></Text>
            <TextInput testID="checkin-notes-input" accessibilityLabel={t('x_check_in_optional_check_notes')} style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={notes} onChangeText={setNotes} placeholder={t('x_check_in_e_g_at_home')} placeholderTextColor={colors.textMuted} multiline maxLength={2000} />
            <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: withLocation }} testID="checkin-location-toggle" style={styles.toggleRow}
              onPress={toggleLocation} accessibilityLabel={t('x_check_in_include_gps_location_this')}>
              <View style={{ flex: 1 }}>
                <IconLabel icon={ICONS.location} textStyle={styles.label} maxFontSizeMultiplier={1.4}>{t('x_check_in_include_my_location')}</IconLabel>
                <Text maxFontSizeMultiplier={1.4} style={styles.small}>
                  {locStatus === 'getting' ? t('qc_loc_getting') : locStatus === 'ready' ? t('x_check_in_location_ready')
                    : locStatus === 'unavailable' ? t('x_check_in_location_unavailable_can_still') : t('ck2_location_off')}
                </Text>
              </View>
              <View style={[styles.switch, withLocation && styles.switchOn]}><View style={[styles.knob, withLocation && { alignSelf: 'flex-end' }]} /></View>
            </TouchableOpacity>
            {!!errorMsg && <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.error} maxFontSizeMultiplier={1.4} testID="checkin-error-msg">{errorMsg}</IconLabel>}
            <TouchableOpacity accessibilityRole="button" testID="checkin-submit-button" style={[styles.checkBtn, phase === 'submitting' && { opacity: 0.6 }]}
              disabled={phase === 'submitting' || locStatus === 'getting'} onPress={submit} accessibilityLabel={t('x_check_in_check_now')}>
              {phase === 'submitting' ? <ActivityIndicator color={colors.textOnNavy} /> : (
                <>
                  <Text maxFontSizeMultiplier={1.2} style={styles.checkBtnIcon}>✓</Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.checkBtnText}>{t('x_check_in_check_now')}</Text>
                </>
              )}
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={styles.small}>{withLocation ? t('ck2_shared_with_location') : t('ck2_shared_without_location')}</Text>
          </>
        )}
        {list.length > 1 && (
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => { setCurrent(null); setResult(null); setPhase('pick'); }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('ck2_other_enrollment')}</Text>
          </TouchableOpacity>
        )}
        <IconLabel icon={ICONS.lawyer} textStyle={[styles.small, { marginTop: 16 }]} maxFontSizeMultiplier={1.3}>{t('x_check_in_check_requirements_set_by')}</IconLabel>
        <AuthGateModal />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 12 },
  title: { color: c.textBrand, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  body: { color: c.textPrimary, fontSize: 15, lineHeight: 22, marginBottom: 8, textAlign: 'center' },
  small: { color: c.textSecond, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { color: c.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  header: { backgroundColor: c.navy, borderRadius: 16, padding: 18, marginBottom: 14 },
  headerTitle: { color: c.textOnNavy, fontSize: 22, fontWeight: '900', marginBottom: 4 },
  headerSub: { color: c.textOnNavy, fontSize: 14, opacity: 0.9 },
  stats: { flexDirection: 'row', backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statNum: { color: c.textBrand, fontSize: 24, fontWeight: '900' },
  statLabel: { color: c.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
  warn: { color: c.textPrimary, backgroundColor: c.warnBg, borderColor: c.warnDark, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14, fontWeight: '700', marginBottom: 12 },
  due: { color: c.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  input: { backgroundColor: c.inputBg || c.bgCard, color: c.inputText || c.textPrimary, borderColor: c.inputBorder || c.border, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, fontSize: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 8, minHeight: 56 },
  switch: { width: 50, height: 28, borderRadius: 14, backgroundColor: c.border, justifyContent: 'center', paddingHorizontal: 3 },
  switchOn: { backgroundColor: c.legalDark },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.white },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginVertical: 8 },
  checkBtn: { backgroundColor: c.navy, borderRadius: 18, paddingVertical: 20, alignItems: 'center', marginVertical: 12, minHeight: 64 },
  checkBtnIcon: { color: c.textOnNavy, fontSize: 30 },
  checkBtnText: { color: c.textOnNavy, fontSize: 21, fontWeight: '900' },
  doneBox: { alignItems: 'center', backgroundColor: c.legalBg, borderRadius: 16, padding: 20, marginBottom: 12 },
  doneCheck: { fontSize: 56, color: c.legalDark },
  doneTitle: { color: c.textPrimary, fontSize: 21, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 8 },
  primaryBtnText: { color: c.textOnNavy, fontSize: 16, fontWeight: '800' },
  secondaryBtn: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 10 },
  secondaryBtnText: { color: c.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'center' },
});

export default React.memo(CheckInScreen);
