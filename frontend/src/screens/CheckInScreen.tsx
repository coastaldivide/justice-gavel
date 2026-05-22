import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
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
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Animated, KeyboardAvoidingView, Platform, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { hapticSuccess } from '../services/haptics';
import { getLocation } from '../services/location';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import * as Location from 'expo-location';
import { t } from '../i18n';

declare var defNameRef: any;
declare var defName_val: any;
declare var load: any;
declare var locationData: any;
declare var setError: any;
type CheckInPhase = 'loading' | 'ready' | 'gps' | 'submitting' | 'done' | 'already_done' | 'error' | 'no_enrollment';


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View testID="checkin-already-done" style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function CheckInScreen({ route, navigation }: ScreenProps): React.JSX.Element | null {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);

  const enrollmentId = (route?.params as import('../types/api').RouteParams)?.enrollmentId;

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [phase, setPhase]         = useState<CheckInPhase>('loading');
  const [enrollment, setEnrollment] = useState<any>(null);
  const [todayStatus, setTodayStatus] = useState<any>(null);
  const [notes, setNotes]         = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [gpsReady, setGpsReady]   = useState(false);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [streak, setStreak]       = useState(0);
  const [gpsVerify, setGpsVerify]   = React.useState(false);
  const [gpsCoords, setGpsCoords]   = React.useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus]   = React.useState('');

  // Pulse animation for the big check-in button
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.00, duration: 900, useNativeDriver: true }),
      ])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    ).start();
    return () => { pulse.stopAnimation(); };
  }, []);

  useEffect(() => {
    if (!enrollmentId) {
      setPhase('no_enrollment');
      return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }
    loadStatus();
  }, [enrollmentId]);

  const loadStatus = async () => {
    setPhase('loading');
    try {
      const res = await api.get(`/checkins/status/${enrollmentId}`);
      setEnrollment(res.data?.enrollment);
      setTodayStatus(res.data || null);
      setStreak(res.data?.total_checkins || 0);
      if (res.data?.checked_in_today) {
        setPhase('already_done');
      } else {
        setPhase('ready');
        // Pre-fetch GPS in background
        getLocation()
          .then(loc => { setCoords(loc); setGpsReady(true); })
          .catch(() => { setGpsReady(false); });
      }
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e.response?.data?.error || 'Could not load your check-in. Check your internet.');
    }
  };

  const doCheckIn = async () => {
    setPhase('gps');
    let lat: number | undefined, lng: number | undefined, locLabel = locationLabel;

    try {
      if (!coords) {
        const loc = await getLocation();
        lat = loc.lat; lng = loc.lng;
      } else {
        lat = coords.lat; lng = coords.lng;
      }
      locLabel = locLabel || `${lat?.toFixed(4)}, ${lng?.toFixed(4)}`;
    } catch {
      // GPS unavailable -- still allow check-in without location
    }

    setPhase('submitting');
    try {
    // Client-side validation
    const defName = defNameRef || defName_val;
    if (!defName || !defName.trim()) {
      setError('Enter the defendant\'s name to check in.');
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
      hapticSuccess();
    } catch (e: any) {
      if (e.response?.data?.already_done) {
        setPhase('already_done');
      } else {
        setPhase('error');
        setErrorMsg(e.response?.data?.error || 'Check-in failed. Try again.');
      }
    }
  };

  // ── No enrollment ID ─────────────────────────────────────────────────────
  if (phase === 'no_enrollment') return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center', paddingTop: 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 48, marginBottom: 12 }}>📋</Text>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20, ...FONTS.black, color: COLORS.navy, textAlign: 'center', marginBottom: 8 }}>
        Check-In Link Required
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, color: COLORS.textSecond, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 24 }}>
        Your bail bondsman needs to enroll you in the check-in system and send you a personalized link.
      </Text>
      <View style={{ backgroundColor: COLORS.legalBg, borderRadius: RADIUS.lg, padding: 16, alignSelf: 'stretch', marginBottom: 24, borderWidth: 1, borderColor: colors.legal }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.legal, marginBottom: 8 }}>How to get enrolled:</Text>
        {[
          '1. Contact your bail bondsman',
          '2. Ask them to enroll you in digital check-in',
          "3. They'll send you a link via SMS",
          '4. Tap the link to open your check-in',
        ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={{ fontSize: 12, color: colors.legalDark, lineHeight: 20 }}>{s}</Text>)}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        testID="checkin-enroll-button" accessibilityLabel="Find a Bail Bondsman"
        style={{ backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 32, ...SHADOW.md }}
        onPress={() => navigation.navigate('BailTab')}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.bgCard, ...FONTS.heavy, fontSize: 14 }}>{t('checkin_find_bondsman')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <View style={styles.center}>
      <SkeletonLoader rows={4} label="Check-In" />
      <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>Loading your check-in…</Text>
    </View>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <View style={styles.center}>
      <Text testID="checkin-error-message" maxFontSizeMultiplier={1.4} style={styles.errorIcon}>⚠️</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorTitle}>Check-in unavailable</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorBody}>{errorMsg}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={loadStatus}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Already checked in today ───────────────────────────────────────────────
  if (phase === 'already_done') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center' }]}>
      <View style={styles.doneHero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneCheck}>✓</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>Already checked in today</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>Come back tomorrow</Text>
      </View>
      {enrollment && (
        <View style={styles.enrollmentCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.enrollmentName}>{enrollment.defendant_name}</Text>
          {enrollment.court_date && (
            <Text maxFontSizeMultiplier={1.4} style={styles.enrollmentDetail}>
              📅 Court date: {new Date(enrollment.court_date).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}
            </Text>
          )}
        </View>
      )}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text testID="checkin-streak-count" maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Total check-ins</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: COLORS.legal }]}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Today done</Text>
        </View>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={styles.nextDue}>Next check-in due tomorrow by 11:59 PM</Text>
    </ScrollView>
  );

  // ── Submitting / GPS ───────────────────────────────────────────────────────
  if (phase === 'gps' || phase === 'submitting') return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.navy} />
      <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>
        {(phase as string) === 'gps' ? 'Getting your location…' : 'Submitting your check-in…'}
      </Text>
    </View>
  );

  // ── Confirmed ─────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={[styles.scroll, { alignItems: 'center' }]}>
      <View testID="checkin-success-screen" style={styles.doneHero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneCheck}>✓</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>Check-in Complete!</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>Your bondsman has been notified</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Total check-ins</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: COLORS.legal }]}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Today done</Text>
        </View>
      </View>

      {!!coords && (
        <View style={styles.locationConfirm}>
          <Text maxFontSizeMultiplier={1.4} style={styles.locationConfirmText}>
            📍 Location recorded: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
          </Text>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.nextDue}>Next check-in due tomorrow by 11:59 PM</Text>

      <View style={styles.helpBlock}>
        <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockTitle}>Need legal help?</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockSub}>Find a lawyer or bail bondsman instantly.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Find a Lawyer →"
          style={styles.helpBlockBtn}
          onPress={() => navigation.navigate('LawyersTab')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.helpBlockBtnText}>Find a Lawyer →</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ── Ready to check in ─────────────────────────────────────────────────────
  return (
    <ScrollView testID="checkin-screen" style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>Daily Check-In</Text>
        {enrollment && (
          <Text maxFontSizeMultiplier={1.4} style={styles.headerName}>{enrollment.defendant_name}</Text>
        )}
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          Required by your bail bondsman · Takes 10 seconds
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.statNum}>{streak}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Check-ins done</Text>
        </View>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: gpsReady ? COLORS.legal : COLORS.textMuted }]}>
            {gpsReady ? '📍' : '…'}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{gpsReady ? 'GPS ready' : 'Getting GPS'}</Text>
        </View>
        {enrollment?.court_date && (
          <View style={styles.statBlock}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { fontSize: 14 }]}>
              {Math.ceil((new Date(enrollment.court_date).getTime() - Date.now()) / 86400000)}d
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Until court</Text>
          </View>
        )}
      </View>

      {/* Court date reminder */}
      {enrollment?.court_date && (() => {
        const d = new Date(enrollment.court_date);
        const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
        return days <= 7 && days >= 0 ? (
          <View style={styles.courtWarning}>
            <Text maxFontSizeMultiplier={1.4} style={styles.courtWarningText}>
              {'⚠️  Court date '}{days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `in ${days} days`}{' -- '}
              {d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </Text>
          </View>
        ) : null;
      })()}

      {/* Location */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Where are you? <Text maxFontSizeMultiplier={1.4} style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Home -- Nashville, TN"
          placeholderTextColor={COLORS.textSecond}
          value={locationLabel}
          onChangeText={setLocationLabel}
          returnKeyType="next"
          blurOnSubmit
        />
        {gpsReady && coords && (
          <Text maxFontSizeMultiplier={1.4} style={styles.gpsStatus}>
            ✓ GPS location captured automatically
          </Text>
        )}
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Any notes? <Text maxFontSizeMultiplier={1.4} style={styles.optional}>(optional)</Text></Text>
        <TextInput
              testID="checkin-notes-input"
          style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
          placeholder="e.g. At home -- waiting for attorney callback"
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
        style={{ flexDirection:'row', alignItems:'center', paddingVertical:12,
          borderTopWidth:1, borderTopColor:colors.border, marginBottom:16, gap:12 }}
        onPress={() => setGpsVerify(v => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: gpsVerify }}
        accessibilityLabel="Include GPS location in this check-in"
        activeOpacity={0.8}
      >
        <View style={{ flex:1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
            fontWeight:'600', color:colors.textPrimary }}>
            📍 Include my location
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
            color:colors.textMuted }}>
            Optional -- records GPS with your check-in
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
        accessibilityLabel="Check In Now"
        style={styles.checkInBtn}
        testID="checkin-submit-button" disabled={(phase as string) === 'submitting' || (phase as string) === 'gps'} onPress={doCheckIn}
        activeOpacity={0.88}
      >
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnIcon}>✓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnText}>Check In Now</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.checkInBtnSub}>GPS captured · Takes 3 seconds</Text>
        </TouchableOpacity>
      </Animated.View>

      <Text maxFontSizeMultiplier={1.4} style={styles.legalNote}>
        Your location and check-in time are recorded and shared with your bail bondsman only.
      </Text>

      <View style={{ height: 40 }} />

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: '#555', fontStyle: 'italic' }}>
          ⚖️ Check-in requirements are set by your specific court, probation officer, or bail conditions. This app cannot replace those official requirements. Always follow your official conditions of release.
        </Text>
      </View>
      </ScrollView>
      </KeyboardAvoidingView>
  );
  return null;
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { padding: 16 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  loadingText: { marginTop: 16, fontSize: 14, lineHeight: 21, color: COLORS.textMuted },

  errorIcon:  { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, ...FONTS.heavy, color: COLORS.navy, marginBottom: 8, textAlign: 'center' },
  errorBody:  { fontSize: 14, color: COLORS.textSecond, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, paddingHorizontal: 28 },
  retryBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  header: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 16, ...SHADOW.md,
  },
  headerTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 2 },
  headerName:  { fontSize: 15, lineHeight: 22, color: COLORS.steel, marginBottom: 4, ...FONTS.semi },
  headerSub:   { fontSize: 12, color: COLORS.textMuted },

  statsRow:  { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, marginBottom: 14, ...SHADOW.sm, overflow: 'hidden' },
  statBlock: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statNum:   { fontSize: 28, ...FONTS.black, color: COLORS.navy },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },

  courtWarning: {
    backgroundColor: '#FFA726', borderRadius: RADIUS.md, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: '#FFA726',
  },
  courtWarningText: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.warn, textAlign: 'center' },

  section:       { marginBottom: 14 },
  sectionLabel:  { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  optional:      { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', fontWeight: '400' },
  input: {
    backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, lineHeight: 21, color: COLORS.textPrimary,
  },
  gpsStatus: { fontSize: 11, color: COLORS.legal, marginTop: 4, ...FONTS.semi },

  checkInBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    paddingVertical: 22, alignItems: 'center', ...SHADOW.lg,
  },
  checkInBtnIcon: { fontSize: 36, marginBottom: 4 },
  checkInBtnText: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard },
  checkInBtnSub:  { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 },

  legalNote: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: 16, lineHeight: 16 },

  // Done / Already done
  doneHero:  { alignItems: 'center', paddingVertical: 28 },
  doneCheck: { fontSize: 72, marginBottom: 8 },
  doneTitle: { fontSize: 22, ...FONTS.black, color: COLORS.legal, marginBottom: 4 },
  doneSub:   { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },

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
  nextDue: { fontSize: 12, lineHeight: 20, color: COLORS.textMuted, textAlign: 'center', marginBottom: 20 },

  helpBlock: {
    backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: 16,
    alignSelf: 'stretch', borderWidth: 1, borderColor: COLORS.border,
  },
  helpBlockTitle: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy, marginBottom: 4 },
  helpBlockSub:   { fontSize: 12, color: COLORS.textSecond, marginBottom: 10 },
  helpBlockBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  helpBlockBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 12 },
});
