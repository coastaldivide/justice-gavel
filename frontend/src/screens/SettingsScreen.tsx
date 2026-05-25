/**
 * SettingsScreen -- User preferences
 *
 * Sections:
 *   1. Account -- name, email, phone
 *   2. Appearance -- dark mode toggle
 *   3. Language -- English / Español
 *   4. Notifications -- per-category toggles (court reminders, legal tips,
 *                       arrest alerts, check-in reminders, marketing)
 *   5. Invite a Friend -- referral code + share
 *   6. About -- ToS, Privacy, Feedback, version
 *   7. testID="settings-logout-button" Sign out
 */
import React, { useRef, useEffect, useState } from 'react';
import { COLORS, FONTS, RADIUS, SHADOW, ThemeColors, useTheme } from '../constants/theme';
import type {} from '../types/navigation';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, Share, ActivityIndicator, RefreshControl} from 'react-native';
import AsyncStorage          from '@react-native-async-storage/async-storage';
import { ScreenCapture, StoreReview, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import Constants   from 'expo-constants';
import { api } from '../services/api';
import { setLang } from '../i18n';
import { getUserState, STATE_NAMES } from '../utils/userState';
import { clearAuth } from '../utils/secureStorage';
import { setAppAuth } from '../services/auth';
import { clearAllCaches } from '../services/offlineCache';

declare var data: any;
declare var goldenGavel: any;
declare var setGoldenGavel: any;
declare var setProfile: any;
declare var toggleBiometric: any;
declare var toggleDark: any;
declare var AppNavigation: any; // hoisted from component scope
declare var goToCourtForms: any; // hoisted from component scope
declare var setShowStatePickerSettings: any; // hoisted from component scope
declare var userState: any; // hoisted from component scope
interface User { displayName?: string; name?: string; email?: string; phone?: string; }

interface NotifPrefs {
  notif_court_reminders:   boolean;
  notif_legal_tips:        boolean;
  notif_arrest_alerts:     boolean;
  notif_checkin_reminders: boolean;
  notif_marketing:         boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  notif_court_reminders:   true,
  notif_legal_tips:        true,
  notif_arrest_alerts:     true,
  notif_checkin_reminders: true,
  notif_marketing:         true };

// ── Tier-gated notification row ──────────────────────────────────────────────
const STARTER_TIERS = ['advisor','pro','consumer_intel','starter_annual','pro_annual','consumer_intel_annual','attorney_basic','attorney_alert','attorney_featured'];
const PRO_TIERS     = ['pro','consumer_intel','pro_annual','consumer_intel_annual','attorney_alert','attorney_featured'];

function TierGatedRow({
  label, hint, requiredTier, requiredKey, currentTier,
  value, onChange, navigation, colors, isDark }: {
  label: string; hint: string; requiredTier: string; requiredKey: string;
  currentTier: string; value: boolean; onChange: (v: boolean) => void;
  navigation: any; colors: ThemeColors; isDark: boolean;
}) {
  const tiers = requiredKey === 'pro' ? PRO_TIERS : STARTER_TIERS;
  const hasAccess = tiers.includes(currentTier);

  if (hasAccess) {
    return (
      <View style={[gStyles.row, { opacity: 1 }]}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[gStyles.label, { color: COLORS.textPrimary }]}>{label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[gStyles.hint,  { color: COLORS.textMuted   }]}>{hint}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: COLORS.steel, false: COLORS.border }}
          thumbColor={COLORS.bgCard}
          accessibilityLabel={label}
          accessibilityRole="switch"
          accessibilityState={{ checked: value }}
        />

        {/* State preference -- controls rights card, AI jurisdiction, and provider search */}
        <TouchableOpacity
          style={styles.row}
          accessibilityRole="button"
          onPress={() => setShowStatePickerSettings(true)}
          accessibilityLabel="Change your state preference"
        >
          <View style={styles.rowLeft}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowIcon}>🗺️</Text>
            <View>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowLabel}>Your State</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
                {userState ? STATE_NAMES[userState] || userState : 'Not set -- tap to select'}
              </Text>
            </View>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.rowArrow}>›</Text>
        </TouchableOpacity>

      </View>
    );
  }

  // Locked -- show tier badge + upgrade CTA
  return (
    <>
      {/* Official Court Forms -- all 50 states */}
      <TouchableOpacity
        onPress={goToCourtForms}
        accessibilityRole="button"
        accessibilityLabel="Official Court Forms"
        style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:4, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:COLORS.border }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:20, width:32 }}>📋</Text>
        <View style={{ flex:1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, ...FONTS.semiBold, color:COLORS.textPrimary }}>Official Court Forms</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, ...FONTS.regular, color:COLORS.textMuted }}>Government forms -- all 50 states</Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, color:COLORS.textMuted }}>›</Text>
      </TouchableOpacity>
<TouchableOpacity
      style={[gStyles.row, gStyles.lockedRow, {
        backgroundColor: isDark ? COLORS.bgCard : COLORS.bg,
        borderColor: COLORS.border }]}
      onPress={() => navigation.navigate('ConsumerSubscription')}
            accessibilityRole="button"
      activeOpacity={0.8}
      accessibilityLabel={`${label} -- requires ${requiredTier} plan`}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <Text maxFontSizeMultiplier={1.4} style={[gStyles.label, { color: COLORS.textMuted }]}>{label}</Text>
          <View style={[gStyles.tierPill, {
            backgroundColor: requiredKey === 'pro'
              ? (isDark ? COLORS.bgElevated : COLORS.bgSubtle)
              : (isDark ? COLORS.legalBg : COLORS.legalBg) }]}>
            <Text maxFontSizeMultiplier={1.4} style={[gStyles.tierPillText, {
              color: requiredKey === 'pro' ? COLORS.blue : COLORS.legal }]}>
              {requiredTier}+
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[gStyles.hint, { color: COLORS.textMuted }]}>{hint}</Text>
      </View>
      <View style={gStyles.lockWrap}>
        <Text maxFontSizeMultiplier={1.4} style={gStyles.lockIcon}>🔒</Text>
      </View>
    </TouchableOpacity>
    </>
  );
}

const gStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  label:{ fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  hint: { fontSize: 11, marginTop: 1 },
  lockedRow: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, marginVertical: 2 },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  tierPillText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.5 },
  lockWrap: { marginLeft: 8 },
  lockIcon: { fontSize: 16,
    lineHeight: 24 } });

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },

  sectionTitle: {
    fontSize: 11, ...FONTS.black, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8, marginTop: 8 },
  card: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    borderWidth: 1, ...SHADOW.sm },
  cardHint: { fontSize: 12, marginBottom: 10, lineHeight: 17 },

  // Info rows
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, gap: 8 },
  infoIcon:  { fontSize: 18, width: 24, textAlign: 'center' },
  infoLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 14, lineHeight: 21, marginTop: 2 },

  // Language
  langRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip:        { width: '48%', paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
  langChipText:    { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Switches
  switchRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  switchLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  switchHint:  { fontSize: 11, marginTop: 1 },

  // Sub-preferences panel
  subPrefs: { marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  subPrefsLabel: {
    fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 6 },

  // Referral
  referralRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  codeBox:     { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  creditBox:   { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  codeLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  codeText:    { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 3 },
  shareBtn:    { borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  shareBtnText:{ color: COLORS.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  // Menu
  menuRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  menuIcon:   { fontSize: 18, width: 24, textAlign: 'center' },
  menuLabel:  { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  menuArrow:  { fontSize: 18 },
  versionRow: { paddingTop: 10, alignItems: 'center' },
  version:    { fontSize: 12 },

  // Sign out
  logoutBtn:  { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: '#EF5350' },
  logoutText: { color: '#EF5350', fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  rowLeft:      { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowIcon:      { fontSize: 18, marginRight: 12, width: 24, textAlign: 'center' },
  rowLabel:     { fontSize: 15, color: colors.textPrimary, fontFamily: 'Inter_500Medium' },
  rowSub:       { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowArrow:     { fontSize: 16, color: colors.textFaint, marginLeft: 8 },
  navRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  navRowLabel:  { flex: 1, fontSize: 15, color: colors.textPrimary },
  navRowArrow:  { fontSize: 16, color: colors.textFaint },
  testPushBtn:  { backgroundColor: colors.navy, borderRadius: 8, padding: 12, margin: 16, alignItems: 'center' },
  testPushText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  menuHint: { fontSize: 11, marginTop: 1, color: COLORS.textMuted } });

// Module-level fallback for helper components
const styles = makeStyles(COLORS);
export default function SettingsScreen({ route, navigation }: any) {

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  // Load user's state preference
  React.useEffect(() => {
    getUserState().then(s => { if (s?.code) setUserStatePref(s.code); }).catch(() => {});
  }, []);

  // Navigate to Court Forms
  const goToCourtForms = React.useCallback(() => {
    (navigation as any).navigate('CourtForms');
  }, [navigation]);


  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/auth/me').then(r => { if (r.data?.user) setProfile(r.data?.user); }).catch(()=>{})
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 600);
  }, []);


  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [user, setUser]                   = useState<User>({});
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isAdmin,          setIsAdmin]          = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [language, setLanguage]           = useState('en');
  const [notifMaster, setNotifMaster]     = useState(true);
  const [prefs, setPrefs]                 = useState<NotifPrefs>(DEFAULT_PREFS);
  const [prefsLoading, setPrefsLoading]   = useState(false);
  const [prefsSaving, setPrefsSaving]     = useState(false);
  const [subTier, setSubTier]             = useState<string>('free');
  const [userState, setUserStatePref] = React.useState('');
  const [showStatePicker, setShowStatePickerSettings] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  useEffect(() => {
    (async () => {
      const u = await AsyncStorage.getItem('user');
      if (u) { try { setUser(JSON.parse(u)); } catch {} }
      const lang = await AsyncStorage.getItem('lang');
      if (lang) setLanguage(lang);
      const n = await AsyncStorage.getItem('notifs');
      if (n !== null) setNotifMaster(n === 'true');


      // Load subscription tier + per-category prefs
      api.get('/billing/consumer/subscription').then(r => {
        setSubTier(r.data?.subscription?.tier || 'free');
      }).catch((e) => { __DEV__ && console.warn(e?.message); });
      api.get('/golden-gavel/status').then(r => {
        setGoldenGavel(r.data?.golden_gavel === true);
      }).catch((e) => { __DEV__ && console.warn(e?.message); });

      setPrefsLoading(true);
      api.get('/push/preferences')
        .then(r => setPrefs({
          notif_court_reminders:   !!r.data?.notif_court_reminders,
          notif_legal_tips:        !!r.data?.notif_legal_tips,
          notif_arrest_alerts:     !!r.data?.notif_arrest_alerts,
          notif_checkin_reminders: !!r.data?.notif_checkin_reminders,
          notif_marketing:         !!r.data?.notif_marketing }))
        .catch((e) => { __DEV__ && console.warn(e?.message); })
        .finally(() => setPrefsLoading(false));
    })();
  }, []);

  const toggleLang = async (l: string) => {
    setLanguage(l);
    setLang(l);
    await AsyncStorage.setItem('lang', l);
  };

  const toggleMaster = async (val: boolean) => {
    setNotifMaster(val);
    await AsyncStorage.setItem('notifs', String(val));
  };

  const togglePref = async (key: keyof NotifPrefs, val: boolean) => {
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    setPrefsSaving(true);
    api.post('/push/preferences', {
      notif_court_reminders:   next.notif_court_reminders   ? 1 : 0,
      notif_legal_tips:        next.notif_legal_tips        ? 1 : 0,
      notif_arrest_alerts:     next.notif_arrest_alerts     ? 1 : 0,
      notif_checkin_reminders: next.notif_checkin_reminders ? 1 : 0,
      notif_marketing:         next.notif_marketing         ? 1 : 0 }).catch((e) => { __DEV__ && console.warn(e?.message); }).finally(() => setPrefsSaving(false));
  };

  const logout = () => {
    Alert.alert('Sign out', 'You can sign back in any time. Your data is saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          await clearAuth();
          setAppAuth('guest');
          await clearAllCaches().catch(() => {});
          import('../services/analytics').then(m => m.reset?.()).catch(() => {});
          await AsyncStorage.multiRemove(['user', 'chat_session_id']);
          navigation.getParent()?.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] }, [])
            ?? navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } },
    ]);
  };

  const shareReferral = () => {
    try {
          Share.share({ title: 'Justice Gavel -- $5 off', url: 'https://justicegavel.com' });
        } catch (shareErr: any) {
          // Share failed (unsupported browser) — silently ignore
        };
  };

  // ── Reusable row components ──────────────────────────────────────────────
  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value?: string }) => (
    <View style={[styles.infoRow, { borderBottomColor: colors.surface }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.infoLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.infoValue, { color: colors.bgCard }]}>{value || '--'}</Text>
      </View>
    </View>
  );

  const SwitchRow = ({
    label, hint, value, onChange, disabled = false,
    trackOn = COLORS.steel }: {
    label: string; hint?: string; value: boolean;
    onChange: (v: boolean) => void; disabled?: boolean; trackOn?: string;
  }) => (
    <View style={[styles.switchRow, { opacity: disabled ? 0.45 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.switchLabel, { color: colors.bgCard }]}>{label}</Text>
        {hint && <Text maxFontSizeMultiplier={1.4} style={[styles.switchHint, { color: colors.textMuted }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: trackOn, false: colors.surface }}
        thumbColor={value ? colors.bg : colors.bg}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      />
    </View>
  );

  const card = [styles.card, { backgroundColor: colors.bg, borderColor: colors.surface }] as any;
  const sectionTitle = [styles.sectionTitle, { color: colors.textMuted }] as any;

  return (
    <ScrollView
      testID="settings-screen"
      style={[styles.screen, { backgroundColor: COLORS.bg }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── Account ──────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Account</Text>
      <View style={card}>
        <InfoRow icon="👤" label="Display name" value={user.displayName || user.name} />
        {!!user.email && <InfoRow icon="✉️" label="Email" value={user.email} />}
        {goldenGavel
          ? <TouchableOpacity onPress={() => navigation.navigate('MoreTab', { screen: 'GoldenGavel' })} activeOpacity={0.8} accessibilityRole="button">
              <InfoRow icon="🏆" label="Account status" value="Golden Gavel  ›" />
            </TouchableOpacity>
          : <InfoRow icon="⚖️" label="Golden Gavel" value="Check eligibility  ›" />
        }
        {!!user.phone && <InfoRow icon="📱" label="Phone" value={user.phone} />}
      </View>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Appearance</Text>
      <View style={card}>

        {/* Dark / Light Mode Toggle */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.switchLabel, { color: colors.bgCard }]}>
              {isDark ? 'Dark Mode' : 'Light Mode'}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.switchHint, { color: colors.textMuted }]}>
              {isDark
                ? 'Default. Easier on the eyes in low light.'
                : 'High-contrast white -- better for document review.'}
            </Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleDark}
            trackColor={{ false: colors.surface, true: colors.blue }}
            thumbColor={isDark ? '#85B7EB' : colors.bg}
            ios_backgroundColor={colors.surface}
            accessibilityLabel="Toggle dark or light mode"
            accessibilityRole="switch"
          />
        </View>

      </View>

      {/* ── Language ─────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Language / Idioma</Text>
      <View style={card}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.cardHint, { color: colors.textMuted }]}>
          Changes take effect immediately
        </Text>
        <View style={styles.langRow}>
          {[{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }, { code: 'pt', label: 'Português' }, { code: 'vi', label: 'Tiếng Việt' }].map(l => (
            <TouchableOpacity
              accessibilityRole="button"
              key={l.code}
              style={[
                styles.langChip,
                { borderColor: colors.surface, backgroundColor: COLORS.bg },
                language === l.code && { borderColor: COLORS.navy, backgroundColor: isDark ? COLORS.bgElevated : COLORS.bgSubtle },
              ]}
              onPress={() => toggleLang(l.code)}
              accessibilityLabel={`Switch language to ${l.label}`}
              accessibilityState={{ selected: language === l.code }}>
              <Text maxFontSizeMultiplier={1.4} style={[
                styles.langChipText,
                { color: colors.steel },
                language === l.code && { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
              ]}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Security ─────────────────────────────────────────────────────── */}
      {biometricAvailable && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Security</Text>
          <View style={card}>
            <SwitchRow
              label="🔒  Biometric Lock"
              hint="Require Face ID or fingerprint to open Justice Gavel"
              value={biometricEnabled}
              onChange={toggleBiometric}
              trackOn={colors.legal}
            />
          </View>
        </>
      )}

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Notifications</Text>
      <View style={card}>

        {/* Master toggle */}
        <SwitchRow
          label="Push notifications"
          hint="Turn off all notifications at once"
          value={notifMaster}
          onChange={toggleMaster}
        />

        {/* Per-category -- only visible when master is on */}
        {notifMaster && (
          <View style={[styles.subPrefs, { borderTopColor: colors.surface }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.subPrefsLabel, { color: colors.textMuted }]}>
              Choose what to receive
              {prefsSaving && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted }}> · saving…</Text>}
            </Text>

            {prefsLoading ? (
              <ActivityIndicator size="small" color={COLORS.navy} style={{ marginVertical: 12 }} />
            ) : (
              <>
                <SwitchRow
                  label="📅  Court date reminders"
                  hint="7 days, 3 days, and day-of reminders"
                  value={prefs.notif_court_reminders}
                  onChange={v => togglePref('notif_court_reminders', v)}
                />
                <SwitchRow
                  label="💡  Daily legal tip"
                  hint="One practical legal fact each day"
                  value={prefs.notif_legal_tips}
                  onChange={v => togglePref('notif_legal_tips', v)}
                />
                <SwitchRow
                  label="🔔  Arrest alerts"
                  hint="When someone on your monitor list is booked"
                  value={prefs.notif_arrest_alerts}
                  onChange={v => togglePref('notif_arrest_alerts', v)}
                />
                <SwitchRow
                  label="✓  Check-in reminders"
                  hint="Daily reminder if you're enrolled in check-in"
                  value={prefs.notif_checkin_reminders}
                  onChange={v => togglePref('notif_checkin_reminders', v)}
                />
                <SwitchRow
                  label="📣  Promotions & offers"
                  hint="Occasional discounts and new features"
                  value={prefs.notif_marketing}
                  onChange={v => togglePref('notif_marketing', v)}
                  trackOn={COLORS.steel}
                />
              </>
            )}
          </View>
        )}
      </View>

      {/* ── Test push notification (debug / support) ──────────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.testPushBtn, { borderColor: colors.surface }]}
        onPress={async () => {
    await hapticImpact();

          try {
            await api.post('/push/test', { message: 'Justice Gavel push notifications are working ✓' });
            Alert.alert('Test sent', 'Check your device notifications.');
          } catch (e: any) {
            Alert.alert('Push test failed', e.response?.data?.error || e.message);
          }
        }}
        accessibilityLabel="Send a test push notification"
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.testPushText, { color: colors.textMuted }]}>Send test notification →</Text>
      </TouchableOpacity>

      {/* ── Invite a Friend ──────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Invite a Friend</Text>
      <View style={card}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.cardHint, { color: colors.textMuted }]}>
          Your friend gets $5 off Quick Connect. You earn 50 reward points.
        </Text>
        <View style={styles.referralRow}>
          <View style={[styles.codeBox, { backgroundColor: isDark ? COLORS.bgElevated : COLORS.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.codeLabel, { color: colors.textMuted }]}>Your Code</Text>
          </View>
            <View style={[styles.creditBox, { backgroundColor: isDark ? colors.legal : colors.legal }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.codeLabel, { color: colors.textMuted }]}>Your Credit</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.codeText, { color: COLORS.legal }]}>
              </Text>
            </View>
        </View>
        <TouchableOpacity activeOpacity={0.6}
          style={[styles.shareBtn, { backgroundColor: COLORS.navy }]}
          onPress={shareReferral}
          accessibilityLabel="Share referral code"
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>Share My Code →</Text>
        </TouchableOpacity>
      </View>

      {/* ── My Tools -- quick access to all features ──────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>My Tools</Text>
      <View style={card}>
        {[
          { icon: '🏢', label: 'Firm Vertical Setup',   hint: 'Configure practice area, pricing tier, trackers', screen: 'FirmVertical' },
          { icon: '🚀', label: 'Start Firm Trial',       hint: 'Self-serve onboarding — activate your 14-day trial',  screen: 'FirmAcquisition' },
          { icon: '⭐', label: 'Saved Lawyers',         hint: 'Your personal attorney contact list',        screen: 'SavedLawyers' },
          { icon: '⏰', label: 'Deadline Calculator',   hint: 'Arraignment, appeal, AEDPA -- all deadlines', screen: 'DeadlineCalculator' },
          { icon: '🔔', label: 'Arrest Monitor',        hint: 'Get alerted when someone is booked',         screen: 'ArrestMonitor' },
          { icon: '✓',  label: 'Daily Check-In',        hint: 'Court-ordered check-in compliance',          screen: 'CheckIn' },
          { icon: '🤝', label: 'Diversion Checker',     hint: 'Could charges be dropped?',                  screen: 'Diversion' },
          { icon: '🏆', label: 'Golden Gavel',           hint: 'Your path to elite status',                  screen: 'GoldenGavel' },
          { icon: '⭐', label: 'Rewards',               hint: 'Your points and referral credits',           screen: 'Rewards' },
          { icon: '🛡️', label: 'Legal Insurance',       hint: 'Monthly coverage plans',                    screen: 'Insurance' },
          { icon: '🧒', label: 'Juvenile Justice',       hint: 'Rights, process, and record sealing',        screen: 'JuvenileJustice' },
          { icon: '🧠', label: 'Mental Health & Law',    hint: 'MH courts, competency, diversion',           screen: 'MentalHealthDiversion' },
          { icon: '👨\u200d👩\u200d👧', label: 'Family Court',        hint: 'Custody, protective orders, child support',   screen: 'FamilyCourt' },
          { icon: '🌎', label: 'Immigration Consequences', hint: 'How a record affects immigration status',    screen: 'ImmigrationConsequences' },
          { icon: '🏘️', label: 'Housing Rights',           hint: 'Criminal record & housing, eviction defense', screen: 'HousingRights' },
          { icon: '⚖️', label: 'Attorney Dashboard',     hint: 'Cases, templates, CLE credits, profile',    screen: 'AttorneyDashboard' },
          { icon: '📵', label: 'Offline Mode',           hint: 'What works without a connection',            screen: 'OfflineStatus' },
          { icon: '📊', label: 'Advocacy',              hint: 'Criminal justice data and reform tools',     screen: 'Advocacy' },
        ].map((item, i, arr) => (
          <TouchableOpacity
            key={item.screen}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => navigation.navigate('MoreTab', { screen: item.screen })}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.menuIcon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuLabel, { color: colors.bgCard }]}>{item.label}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuHint, { color: colors.textMuted }]}>{item.hint}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.menuArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Admin tools (only shown to admin users) ───────────────────── */}
      {isAdmin && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Admin</Text>
          <View style={card}>
            <TouchableOpacity
              style={[styles.navRow, { borderBottomWidth: 0 }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'AdminVerification' })}
              accessibilityRole="button"
              accessibilityLabel="Bar verification queue"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.navRowLabel, { color: colors.bgCard }]}>⚖️  Bar Verification Queue</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.navRowArrow, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>About</Text>
      <View style={card}>
        {[
          { icon: '📄', label: 'Terms of Service',  nav: 'TermsOfService' },
          { icon: '🔒', label: 'Privacy Policy',    nav: 'PrivacyPolicy' },
          { icon: '💬', label: 'Send Feedback',     url: 'mailto:support@justicegavel.app' },
          { icon: '📸', label: 'Instagram',         url: 'https://instagram.com/yourjusticegavel', hint: '@yourjusticegavel' },
          { icon: '🌐', label: 'Website',           url: 'https://justicegavel.app' },
        ].map((item, i, arr) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => { hapticImpact(); if (item.nav) navigation.navigate('MoreTab', { screen: item.nav }); }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.menuIcon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuLabel, { color: colors.bgCard }]}>{item.label}</Text>
              {item.hint && <Text maxFontSizeMultiplier={1.4} style={[styles.menuHint, { color: colors.textMuted }]}>{item.hint}</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.menuArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.versionRow}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.version, { color: colors.textMuted }]}>Justice Gavel v{Constants.expoConfig?.version || '1.8.25'}</Text>
        </View>
      </View>

      {/* ── Sign out ──────────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.logoutBtn, { backgroundColor: colors.bg }]}
        onPress={logout}
        accessibilityLabel="Sign out"
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />

      {/* ── Danger Zone -- Account Deletion ──────────────────────────────── */}
      <View style={{ marginTop: 32, marginHorizontal: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8,
          textTransform: 'uppercase', color: '#EF5350',
          fontFamily: 'Inter_800ExtraBold', marginBottom: 12 }}>
          Danger Zone
        </Text>
        <View style={[{ borderRadius: 12, borderWidth: 1, padding: 16 },
          { backgroundColor: '#EF5350', borderColor: '#EF5350' + '44' }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontFamily: 'Inter_700Bold', color: '#EF5350', marginBottom: 6 }}>
            Delete Account
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted, marginBottom: 16 }}>
            Permanently deletes your account, all cases, messages, and data.
            This cannot be undone.
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: '#EF5350', borderRadius: 8,
              paddingVertical: 12, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Delete account permanently"
            onPress={() => {
              Alert.alert(
                'Delete Account',
                'This will permanently delete your account and all your data. This cannot be undone.\n\nEnter your password to confirm.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      Alert.prompt(
                        'Confirm Password',
                        'Enter your password to permanently delete your account.',
                        async (password: string) => {
                          if (!password) return;
                          try {
                            await api.delete('/auth/account', { data: { password } });
                            hapticNotification('Warning'); Alert.alert('Account Deleted',
                              'Your account has been permanently deleted.',
                              [{ text: 'OK', onPress: () => navigation.reset({
                                index: 0, routes: [{ name: 'Login' }]
                              }) }]);
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : 'Could not delete account.';
                            Alert.alert('Settings Error', msg);
                          }
                        },
                        'secure-text'
                      );
                    }
                  }
                ]
              );
            }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontFamily: 'Inter_700Bold', color: colors.bg }}>
              Delete My Account
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: 12, alignItems: 'center', padding: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Export my data"
            onPress={async () => {
              try {
                const res = await api.get('/auth/export');
                const data = JSON.stringify(res.data, null, 2);
                const { default: Share } = await import('react-native').then(m => ({ default: m.Share }));
                await Share.share({ message: data, title: 'My Justice Gavel Data Export' });
              } catch {
                Alert.alert('Export failed', 'Could not export your data. Please try again.');
              }
            }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted,
              textDecorationLine: 'underline' }}>
              Export My Data (GDPR)
            </Text>
          </TouchableOpacity>
        </View>
      </View>


          {/* ── Rate the App ─────────────────────────────────────────── */}
          <TouchableOpacity
            accessibilityRole="button"
            style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
              backgroundColor:colors.bgCard, borderRadius:10, padding:14,
              marginBottom:8, borderWidth:1, borderColor:colors.border }}
            onPress={async () => {
              const isAvailable = await StoreReview.isAvailableAsync();
              if (isAvailable) {
                await StoreReview.requestReview();
              }
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color:colors.textPrimary, fontSize:14 }}>
              ⭐ Rate Justice Gavel
            </Text>
            <Text style={{ color:colors.textMuted, fontSize:12 }}>Tell us what you think →</Text>
          </TouchableOpacity>

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.textMuted, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
  );
}