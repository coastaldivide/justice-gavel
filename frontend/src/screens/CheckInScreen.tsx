import { parseLocalDate, formatDate, daysUntil } from '../utils/dateUtils';
import { AppIcon } from '../components/AppIcon';
import { hapticNotification } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
import { SkeletonLoader } from '../components/SkeletonLoader';
/**
 * CheckInScreen -- Daily defendant check-in
 *
 * Defendant taps "Check In Now" → GPS fires → confirmation submitted.
 * Used by defendants to fulfill post-release check-in requirements.
 * Free for defendants. Bondsman pays $9.99/month per enrolled defendant.
 *
 * Accessed two ways:
 *   1. Deep link from bondsman's SMS (enrollment_id in URL params)
 *   2. Direct navigation if defendant has the app
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Animated, KeyboardAvoidingView, Platform, RefreshControl, LayoutAnimation, InteractionManager} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { hapticSuccess } from '../services/haptics';
import { getLocation } from '../services/location';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { t, useLang, locale } from '../i18n';

type CheckInPhase = 'loading' | 'ready' | 'gps' | 'submitting' | 'done' | 'already_done' | 'error' | 'no_enrollment';



function CheckInScreen({ route, navigation }: ScreenProps): React.JSX.Element | null {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  // Loader is declared further down; reach it through a ref updated each render.
  const reloadRef = React.useRef<() => unknown>(() => undefined);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    Promise.resolve(reloadRef.current()).catch(() => {}).finally(() => setRefreshing(false));
  }, []);

  const enrollmentId = (route?.params as import('../types/api').RouteParams)?.enrollmentId;

  const mountedRef = useRef(true);
  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; };
    });
    return () => _task.cancel();
  }, []);

  const [phase, setPhase]         = useState<CheckInPhase>('loading');
  const [enrollment, setEnrollment] = useState<any>(null);
  const [notes, setNotes]         = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [gpsReady, setGpsReady]   = useState(false);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [streak, setStreak]       = useState(0);
  const [gpsVerify, setGpsVerify]   = React.useState(false);
  const [gpsStatus, setGpsStatus]   = React.useState('');

  // Pulse animation for the big check-in button
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.00, duration: 900, useNativeDriver: true }),
      ])
    ).start();
    return () => { pulse.stopAnimation(); };
  }, [pulse]);

  const loadStatus = useCallback(async () => {
    setPhase('loading');
    try {
      const res = await api.get(`/checkins/status/${enrollmentId}`);
      setEnrollment(res.data?.enrollment);
      setStreak(res.data?.total_checkins || 0);
      setPhase(res.data?.checked_in_today ? 'already_done' : 'ready');
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(apiErrorMessage(e, t('x_check_in_could_not_load_check')));
    }
  }, [enrollmentId]);

  useEffect(() => {
    if (!enrollmentId) {
      setPhase('no_enrollment');
      return;
    }
    loadStatus();
  }, [enrollmentId, loadStatus]);

  // Location is opt-in ("Include my location"): GPS is only requested, and
  // coordinates only sent, while the toggle is on.
  const toggleGps = () => {
    const next = !gpsVerify;
    setGpsVerify(next);
    if (!next) { setGpsStatus(''); setGpsReady(false); setCoords(null); return; }
    setGpsStatus(t('qc_loc_getting'));
    getLocation()
      .then(loc => { setCoords(loc); setGpsReady(true); setGpsStatus(t('x_check_in_location_ready')); })
      .catch(() => { setGpsReady(false); setGpsStatus(t('x_check_in_location_unavailable_can_still')); });
  };

  const doCheckIn = async () => {
    setPhase('gps');
    let lat: number | undefined, lng: number | undefined, locLabel = locationLabel;

    try {
      if (!gpsVerify) {
        // Location not opted in -- check in without coordinates.
      } else if (!coords) {
        const loc = await getLocation();
        lat = loc.lat; lng = loc.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) throw new Error('GPS coordinates unavailable');
      } else {
        lat = coords.lat; lng = coords.lng;
      }
      if (typeof lat === 'number' && typeof lng === 'number') locLabel = locLabel || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      // GPS unavailable -- still allow check-in without location
    }

    setPhase('submitting');
    try {
    if (!enrollmentId) {
      setPhase('no_enrollment');
      return;
    }
      await api.post('/checkins/submit', {
        enrollment_id: enrollmentId,
        lat, lng,
        location_label: locLabel,
        notes,
        device_info: `ReactNative/${new Date().toISOString()}`,
      });
      hapticNotification().catch(()=>{});
      setStreak(s => s + 1);
      setPhase('done');
      setNotes('');
      setLocationLabel('');
      hapticSuccess();
    } catch (e: any) {
      if (e.response?.data?.already_done) {
        setPhase('already_done');
      } else {
        setPhase('error');
        setErrorMsg(apiErrorMessage(e, t('x_check_in_check_failed_try_again')));
      }
    }
  };

  // ── No enrollment ID ─────────────────────────────────────────────────────
  reloadRef.current = () => loadStatus();
  if (phase === 'no_enrollment') return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center', paddingTop: 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20, ...FONTS.black, color: colors.textBrand, textAlign: 'center', marginBottom: 8 }}>
        {t('x_check_in_check_link_required')}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 24 }}>
        {t('x_check_in_bail_bondsman_needs_enroll')}
      </Text>
      <View style={{ backgroundColor: COLORS.legalBg, borderRadius: RADIUS.lg, padding: 16, alignSelf: 'stretch', marginBottom: 24, borderWidth: 1, borderColor: colors.legal }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.legal, marginBottom: 8 }}>{t('checkin_how_to_enroll')}</Text>
        {[
          t('x_check_in_1_contact_bail_bondsman'),
          t('x_check_in_2_ask_them_enroll'),
          t('x_check_in_3_they_ll_send'),
          t('x_check_in_4_tap_link_open'),
        ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={{ fontSize: 12, color: colors.legalDark, lineHeight: 20 }}>{s}</Text>)}
      </View>
      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        testID="checkin-enroll-button" accessibilityLabel={t('x_check_in_find_bail_bondsman')}
        style={{ backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 32, ...SHADOW.md }}
        onPress={() => navigation.navigate('BailTab')}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textOnNavy, ...FONTS.heavy, fontSize: 14 }}>{t('checkin_find_bondsman')}</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <View style={styles.center}>
      <SkeletonLoader count={4} label={t('x_check_in_check')} />
      <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>{t('checkin_loading')}</Text>
    </View>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <View style={styles.center}>
      <AppIcon name="warning-outline" size={20} color={colors.warn} />
      <Text maxFontSizeMultiplier={1.4} style={styles.errorTitle}>{t('checkin_unavailable')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorBody}>{errorMsg}</Text>
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.retryBtn} onPress={loadStatus}
       accessibilityLabel={t('help_now_error_retry')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>{t('help_now_error_retry')}</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Already checked in today ───────────────────────────────────────────────
  if (phase === 'already_done') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center' }]}>
      <View style={styles.doneHero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneCheck}>✓</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>{t('checkin_already_done')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>{t('checkin_come_back')}</Text>
      </View>
      {enrollment && (
        <View style={styles.enrollmentCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.enrollmentName}>{enrollment.defendant_name}</Text>
          {enrollment.court_date && (
            <Text maxFontSizeMultiplier={1.4} style={styles.enrollmentDetail}>
              {t('x_check_in_court_date', { court_date: formatDate(enrollment.court_date, { month:'long', day:'numeric', year:'numeric' }) })}
            </Text>
          )}
        </View>
      )}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text testID="checkin-streak-count" maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_total_check_ins')}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: COLORS.legal }]}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_today_done')}</Text>
        </View>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={styles.nextDue}>{t('checkin_next_due')}</Text>
    </ScrollView>
  );

  // ── Submitting / GPS ───────────────────────────────────────────────────────
  if (phase === 'gps' || phase === 'submitting') return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.navy} />
      <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>
        {(phase as string) === 'gps' ? t('qc_loc_getting') : t('x_check_in_submitting_check')}
      </Text>
    </View>
  );

  // ── Confirmed ─────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center' }]}>
      <View testID="checkin-success-screen" style={styles.doneHero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneCheck}>✓</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>{t('checkin_complete')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>{t('checkin_bondsman_notified')}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_total_check_ins')}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: COLORS.legal }]}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_today_done')}</Text>
        </View>
      </View>

      {!!coords && (
        <View style={styles.locationConfirm}>
          <Text maxFontSizeMultiplier={1.4} style={styles.locationConfirmText}>
            {t('x_check_in_location_recorded', { value: (coords.lat ?? 0).toFixed(4), value2: (coords.lng ?? 0).toFixed(4) })}
          </Text>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.nextDue}>{t('checkin_next_due')}</Text>

      <View style={styles.helpBlock}>
        <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockTitle}>{t('checkin_need_help')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockSub}>{t('x_check_in_find_lawyer_bail_bondsman')}</Text>
        <TouchableOpacity
  accessibilityRole="button"

          accessibilityLabel={t('x_check_in_find_lawyer')}
          accessibilityHint={t('x_check_in_searches_attorneys_area')}
          style={styles.helpBlockBtn}
          onPress={() => navigation.navigate('LawyersTab')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockBtnText}>{t('x_check_in_find_lawyer')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ── Ready to check in ─────────────────────────────────────────────────────
  return (
    <ScrollView testID="checkin-screen" style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>{t('x_check_in_daily_check')}</Text>
        {enrollment && (
          <Text maxFontSizeMultiplier={1.4} style={styles.headerName}>{enrollment.defendant_name}</Text>
        )}
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          {t('x_check_in_required_by_bail_bondsman')}
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_check_ins_done')}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: gpsReady ? COLORS.legal : COLORS.textMuted }]}>
            {gpsReady ? '📍' : gpsVerify ? '…' : '—'}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{gpsReady ? t('x_check_in_gps_ready') : gpsVerify ? t('x_check_in_getting_gps') : t('x_check_in_gps_off')}</Text>
        </View>
        {enrollment?.court_date && (
          <View style={styles.statBlock}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { fontSize: 14 }]}>
              {daysUntil(enrollment.court_date) ?? '--'}d
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{t('x_check_in_until_court')}</Text>
          </View>
        )}
      </View>

      {/* Court date reminder */}
      {enrollment?.court_date && (() => {
        const d = parseLocalDate(enrollment.court_date) ?? new Date(NaN);
        const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
        return days <= 7 && days >= 0 ? (
          <View style={styles.courtWarning}>
            <Text maxFontSizeMultiplier={1.4} style={styles.courtWarningText}>
              {t('x_check_in_court_date_2') + ' '}{days === 0 ? t('x_check_in_today_caps') : days === 1 ? t('x_check_in_tomorrow_caps') : t('x_check_in_days', { days })}{' -- '}
              {d.toLocaleDateString(locale(), { month: 'long', day: 'numeric' })}
            </Text>
          </View>
        ) : null;
      })()}

      {/* Location */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('x_check_in_where')}{' '}<Text maxFontSizeMultiplier={1.4} style={styles.optional}>{t('x_check_in_optional')}</Text></Text>
        <TextInput
          style={styles.input}
          placeholderTextColor={COLORS.textSecond}
          value={locationLabel}
          onChangeText={setLocationLabel}
          returnKeyType="next"
          blurOnSubmit
        />
        {gpsVerify && gpsReady && coords && (
          <Text maxFontSizeMultiplier={1.4} style={styles.gpsStatus}>
            {t('x_check_in_gps_location_will_be')}
          </Text>
        )}
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('x_check_in_any_notes')}{' '}<Text maxFontSizeMultiplier={1.4} style={styles.optional}>{t('x_check_in_optional')}</Text></Text>
        <TextInput
              testID="checkin-notes-input" accessibilityLabel={t('x_check_in_optional_check_notes')}
          style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
          placeholder={t('x_check_in_e_g_at_home')}
          placeholderTextColor={COLORS.textSecond}
          value={notes}
          onChangeText={setNotes}
          multiline
              maxLength={2000}
        />
      </View>

      {/* THE BIG BUTTON */}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
      {/* GPS opt-in toggle */}
      <TouchableOpacity
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={{ flexDirection:'row', alignItems:'center', paddingVertical:12,
          borderTopWidth:1, borderTopColor:colors.border, marginBottom:16, gap:12 }}
        onPress={toggleGps}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
        accessibilityState={{ checked: gpsVerify }}
        accessibilityLabel={t('x_check_in_include_gps_location_this')}
        activeOpacity={0.8}
      >
        <View style={{ flex:1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
            fontWeight:'600', color:colors.textPrimary }}>
            {t('x_check_in_include_my_location')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
            color:colors.textMuted }}>
            {t('x_check_in_optional_records_gps_with')}
          </Text>
          {!!gpsStatus && (
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
              color:gpsStatus.includes('✓') ? colors.legalDark : colors.textMuted, marginTop:3 }}>
              {gpsStatus}
            </Text>
          )}
        </View>
        <View style={{ width:48, height:26, borderRadius:13,
          backgroundColor:gpsVerify ? colors.navy : colors.border,
          justifyContent:'center', paddingHorizontal:2 }}>
          <View style={{ width:22, height:22, borderRadius:11, backgroundColor:colors.bgCard,
            alignSelf:gpsVerify ? 'flex-end' : 'flex-start', elevation:2 }} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        accessibilityLabel={t('x_check_in_check_now')}
        style={styles.checkInBtn}
        testID="checkin-submit-button" disabled={(phase as string) === 'submitting' || (phase as string) === 'gps'} onPress={doCheckIn}
        activeOpacity={0.88}
      >
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnIcon}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnText}>{t('x_check_in_check_now')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnSub}>{t('checkin_gps_note')}</Text>
        </TouchableOpacity>
      </Animated.View>

      <Text maxFontSizeMultiplier={1.4} style={styles.legalNote}>
        {t('x_check_in_location_check_time_recorded')}
      </Text>

      <View style={{ height: 40 }} />

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: colors.textSecond, fontStyle: 'italic' }}>
          {t('x_check_in_check_requirements_set_by')}
        </Text>
      </View>
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { padding: 16 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  loadingText: { marginTop: 16, fontSize: 14, lineHeight: 21, color: colors.textMuted },

  errorIcon:  { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, ...FONTS.heavy, color: colors.textBrand, marginBottom: 8, textAlign: 'center' },
  errorBody:  { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, paddingHorizontal: 28 },
  retryBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  header: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 16, ...SHADOW.md,
  },
  headerTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 2 },
  headerName:  { fontSize: 15, lineHeight: 22, color: COLORS.steel, marginBottom: 4, ...FONTS.semi },
  headerSub:   { fontSize: 12, color: colors.textOnNavy },

  statsRow:  { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, marginBottom: 14, ...SHADOW.sm, overflow: 'hidden' },
  statBlock: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statNum:   { fontSize: 28, ...FONTS.black, color: COLORS.navy },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },

  courtWarning: {
    backgroundColor: colors.warnBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: colors.warnDark,
  },
  courtWarningText: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: colors.warnDark, textAlign: 'center' },

  section:       { marginBottom: 14 },
  sectionLabel:  { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: colors.textBrand, marginBottom: 6 },
  optional:      { fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', fontWeight: '400' },
  input: {
    backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, lineHeight: 21, color: COLORS.textPrimary,
  },
  gpsStatus: { fontSize: 11, color: colors.legal, marginTop: 4, ...FONTS.semi },

  checkInBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    paddingVertical: 22, alignItems: 'center', ...SHADOW.lg,
  },
  checkInBtnIcon: { fontSize: 36, marginBottom: 4 },
  checkInBtnText: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard },
  checkInBtnSub:  { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 },

  legalNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 16, lineHeight: 16 },

  // Done / Already done
  doneHero:  { alignItems: 'center', paddingVertical: 28 },
  doneCheck: { fontSize: 72, marginBottom: 8 },
  doneTitle: { fontSize: 22, ...FONTS.black, color: colors.legal, marginBottom: 4 },
  doneSub:   { fontSize: 14, lineHeight: 21, color: colors.textMuted },

  enrollmentCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    alignSelf: 'stretch', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  enrollmentName:   { fontSize: 16, ...FONTS.heavy, color: COLORS.navy, marginBottom: 4 },
  enrollmentDetail: { fontSize: 12, lineHeight: 20, color: COLORS.textSecond },

  locationConfirm: {
    backgroundColor: COLORS.legalBg, borderRadius: RADIUS.md, padding: 10,
    marginBottom: 14, borderWidth: 1, borderColor: colors.legal, alignSelf: 'stretch',
  },
  locationConfirmText: { fontSize: 12, color: COLORS.legal, textAlign: 'center' },
  nextDue: { fontSize: 12, lineHeight: 20, color: colors.textMuted, textAlign: 'center', marginBottom: 20 },

  helpBlock: {
    backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: 16,
    alignSelf: 'stretch', borderWidth: 1, borderColor: COLORS.border,
  },
  helpBlockTitle: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy, marginBottom: 4 },
  helpBlockSub:   { fontSize: 12, color: COLORS.textSecond, marginBottom: 10 },
  helpBlockBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  helpBlockBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 12 },
});
export default React.memo(CheckInScreen);