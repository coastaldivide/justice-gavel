import { useConfirm } from '../hooks/useConfirm';
import { requestNotificationsInContext } from '../services/permissions';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
/**
 * SettingsScreen -- User preferences
 *
 * Sections:
 *   1. Account -- name, email, phone
 *   2. Appearance -- dark mode toggle
 *   3. Language -- English / Español
 *   4. Notifications -- per-category toggles (court reminders, legal tips,
 *                       arrest alerts, check-in reminders, marketing)
 *   6. About -- ToS, Privacy, Feedback, version
 *   7. testID="settings-logout-button" Sign out
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import type {} from '../types/navigation';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator, RefreshControl, LayoutAnimation, Modal, FlatList, Platform, TextInput } from 'react-native';
import AsyncStorage          from '@react-native-async-storage/async-storage';
import { ScreenCapture, StoreReview, hapticImpact, RNShare } from '../utils/webCompat';
import Constants   from 'expo-constants';
import { api, apiErrorMessage } from '../services/api';
import { setLang, t } from '../i18n'  // t() already available;
import { getUserState, setUserState, STATE_NAMES, STATE_LIST } from '../utils/userState';
import { clearAuth, getToken } from '../utils/secureStorage';
import { useInFlight } from '../hooks/useInFlight';
import { setAppAuth } from '../services/auth';
import { clearAllCaches } from '../services/offlineCache';

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
  logoutBtn:  { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: colors.emergency },
  logoutText: { color: colors.textSecond, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  rowLeft:      { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowIcon:      { fontSize: 18, marginRight: 12, width: 24, textAlign: 'center' },
  rowLabel:     { fontSize: 15, color: colors.textPrimary, fontFamily: 'Inter_500Medium' },
  rowSub:       { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowArrow:     { fontSize: 16, color: colors.textMuted, marginLeft: 8 },
  navRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  navRowLabel:  { flex: 1, fontSize: 15, color: colors.textPrimary },
  navRowArrow:  { fontSize: 16, color: colors.textFaint },
  testPushBtn:  { backgroundColor: colors.navy, borderRadius: 8, padding: 12, margin: 16, alignItems: 'center' },
  testPushText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
  menuHint: { fontSize: 11, marginTop: 1, color: COLORS.textMuted } });

// Module-level fallback for helper components
function SettingsScreen({ navigation }: any) {
  const { confirm } = useConfirm();
  const { showToast } = useToast();

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/auth/me')
      .then(r => { if (mountedRef.current && r.data?.user) setUser(r.data.user); })
      .catch(() => showToast('Could not refresh. Check your connection.', 'error'))
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [showToast]);

  const [user, setUser]                   = useState<User>({});
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [goldenGavel, setGoldenGavel] = useState(false);
  const [isAdmin,          setIsAdmin]          = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [language, setLanguage]           = useState('en');
  const [notifMaster, setNotifMaster]     = useState(true);
  const [prefs, setPrefs]                 = useState<NotifPrefs>(DEFAULT_PREFS);
  const [prefsLoading, setPrefsLoading]   = useState(false);
  const [prefsSaving, setPrefsSaving]     = useState(false);
  const [userState, setUserStatePref] = React.useState('');
  const [showStatePicker, setShowStatePickerSettings] = React.useState(false);
  const { toggleDark } = useTheme();

  // Biometric lock availability + saved preference
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!mountedRef.current) return;
        setBiometricAvailable(hw && enrolled);
        const on = await AsyncStorage.getItem('biometric_enabled');
        if (mountedRef.current) setBiometricEnabled(on === 'true');
      } catch { /* biometrics unavailable */ }
    })();
  }, []);

  const toggleBiometric = useCallback(async (val: boolean) => {
    if (val) {
      // Confirm the user can authenticate before enabling the lock
      try {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Enable biometric lock' });
        if (!res.success) return;
      } catch { return; }
    }
    setBiometricEnabled(val);
    await AsyncStorage.setItem('biometric_enabled', String(val)).catch(() => {});
  }, []);

  const chooseState = useCallback(async (code: string) => {
    setShowStatePickerSettings(false);
    setUserStatePref(code);
    await setUserState(code).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const u = await AsyncStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          // Shows the Admin section; the server still enforces admin on every admin endpoint.
          setIsAdmin(!!(parsed?.is_admin || parsed?.role === 'admin'));
        } catch {}
      }
      const lang = await AsyncStorage.getItem('lang');
      if (lang) setLanguage(lang);
      const n = await AsyncStorage.getItem('notifs');
      if (n !== null) setNotifMaster(n === 'true');


      // Per-category notification prefs
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
    await AsyncStorage.setItem('lang', l).catch(() => {}); // non-fatal storage write
  };

  const toggleMaster = async (val: boolean) => {
    if (val && Platform.OS !== 'web') {
      // Turning reminders on is the moment to ask the OS (with the reason).
      const answer = await requestNotificationsInContext();
      if (answer !== 'granted') { showToast('Notifications stay off. You can turn them on any time here.', 'info'); return; }
    }
    setNotifMaster(val);
    await AsyncStorage.setItem('notifs', String(val)).catch(() => {}); // non-fatal storage write
  };

  const togglePref = async (key: keyof NotifPrefs, val: boolean) => {
    const prev = prefs;
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    setPrefsSaving(true);
    api.post('/push/preferences', {
      notif_court_reminders:   next.notif_court_reminders   ? 1 : 0,
      notif_legal_tips:        next.notif_legal_tips        ? 1 : 0,
      notif_arrest_alerts:     next.notif_arrest_alerts     ? 1 : 0,
      notif_checkin_reminders: next.notif_checkin_reminders ? 1 : 0,
      notif_marketing:         next.notif_marketing         ? 1 : 0 })
      .catch((e) => {
        // Not saved: put the switch back and say so (never a silent failure).
        setPrefs(prev);
        showToast(apiErrorMessage(e, 'Could not save your notification setting. Try again.'), 'error');
      })
      .finally(() => setPrefsSaving(false));
  };

  // ── Account deletion (in-app, App Store 5.1.1(v)) / data export ──────────
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { getToken().then(tk => setSignedIn(!!tk)).catch(() => setSignedIn(false)); }, []);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [runDelete, deleting] = useInFlight();
  const [runExport, exporting] = useInFlight();

  const deleteAccount = () => runDelete(async () => {
    if (!deletePassword) { setDeleteError('Enter your password to confirm.'); return; }
    setDeleteError('');
    try {
      await api.delete('/auth/account', { data: { password: deletePassword } });
    } catch (e) {
      setDeleteError(apiErrorMessage(e, 'Could not delete your account. Check your connection and try again.'));
      return;
    }
    // The account is gone on the server: remove everything on this device too.
    setDeleteOpen(false);
    setDeletePassword('');
    await clearAuth().catch(() => undefined);
    await clearAllCaches().catch(() => undefined);
    await AsyncStorage.multiRemove(['user', 'chat_session_id', 'has_browsed', 'last_push_token']).catch(() => undefined);
    import('../services/analytics').then(m => m.reset()).catch(() => undefined);
    showToast('Your account and data were permanently deleted.', 'success');
    setAppAuth('guest');
  });

  const exportData = () => runExport(async () => {
    try {
      const res = await api.get('/auth/export');
      await RNShare.share({ message: JSON.stringify(res.data, null, 2), title: 'My Justice Gavel Data Export' });
    } catch (e) {
      showToast(apiErrorMessage(e, 'Could not export your data. Please try again.'), 'error');
    }
  });

  const logout = async () => {
    const ok = await confirm('Sign out?', 'You can sign back in any time. Your data is saved.',
      { confirmLabel: 'Sign out', destructive: true });
    if (!ok) return;
    await clearAuth();
    await clearAllCaches().catch(() => {});
    await AsyncStorage.multiRemove(['user', 'chat_session_id', 'has_browsed']).catch(() => {});
    import('../services/analytics').then(m => m.reset()).catch(() => {});
    // Switching the root auth state swaps the navigator tree to the guest flow
    // (Login), so no manual navigation reset is needed.
    setAppAuth('guest');
  };


  // ── Reusable row components ──────────────────────────────────────────────
  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value?: string }) => (
    <View style={[styles.infoRow, { borderBottomColor: colors.surface }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.infoLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.infoValue, { color: colors.textPrimary }]}>{value || '--'}</Text>
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
        <Text maxFontSizeMultiplier={1.4} style={[styles.switchLabel, { color: colors.textPrimary }]}>{label}</Text>
        {hint && <Text maxFontSizeMultiplier={1.4} style={[styles.switchHint, { color: colors.textMuted }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: trackOn, false: colors.surface }}
        thumbColor={value ? colors.bg : colors.bg}
        accessibilityLabel={label}
      />
    </View>
  );

  const card = [styles.card, { backgroundColor: colors.bg, borderColor: colors.surface }] as any;
  const sectionTitle = [styles.sectionTitle, { color: colors.textMuted }] as any;

  return (
    <ScrollView
      testID="settings-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── Account ──────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Account</Text>
      <View style={card}>
        <InfoRow icon="👤" label={t("settings.display_name")} value={user.displayName || user.name} />
        {!!user.email && <InfoRow icon="✉️" label="Email" value={user.email} />}
        {goldenGavel
          ? <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.navigate('MoreTab', { screen: 'GoldenGavel' })}
            >
              <InfoRow icon="🏆" label={t("settings.account_status")} value="Golden Gavel  ›" />
            </TouchableOpacity>
          : <InfoRow icon="⚖️" label="Golden Gavel" value="Check eligibility  ›" />
        }
        {!!user.phone && <InfoRow icon="📱" label="Phone" value={user.phone} />}
        {/* State preference -- controls rights card, AI jurisdiction, and provider search */}
        <TouchableOpacity accessibilityRole="button"
          style={styles.row}
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
        {/* Official Court Forms -- all 50 states */}
        <TouchableOpacity accessibilityRole="button"
        onPress={goToCourtForms}
        style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:4, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:COLORS.border }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
        <View style={{ flex:1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, ...FONTS.semiBold, color:colors.textBrand }}>Official Court Forms</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, ...FONTS.regular, color:colors.textMuted }}>Government forms -- all 50 states</Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, color:colors.textMuted }}>›</Text>
      </TouchableOpacity>
      </View>

      {/* State picker */}
      <Modal visible={showStatePicker} animationType="slide" transparent onRequestClose={() => setShowStatePickerSettings(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: '75%', backgroundColor: colors.bgCard, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>Select your state</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setShowStatePickerSettings(false)}>
                <Text style={{ fontSize: 18, color: colors.textMuted }}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={STATE_LIST}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.code === userState }}
                  style={{ paddingVertical: 12, paddingHorizontal: 16 }}
                  onPress={() => chooseState(item.code)}
                >
                  <Text style={{ fontSize: 15, color: item.code === userState ? COLORS.navy : colors.textPrimary, fontWeight: item.code === userState ? '700' : '400' }}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>Appearance</Text>
      <View style={card}>

        {/* Dark / Light Mode Toggle */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.switchLabel, { color: colors.textPrimary }]}>
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
            thumbColor={isDark ? COLORS.steel : colors.bg}
            ios_backgroundColor={colors.surface}
            accessibilityLabel="Toggle dark or light mode"
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
            <TouchableOpacity accessibilityRole="button"
              key={l.code}
              style={[
                styles.langChip,
                { borderColor: colors.border, backgroundColor: colors.bgSubtle },
                language === l.code && { borderColor: colors.borderFocus, backgroundColor: colors.bgElevated },
              ]}
              onPress={() => toggleLang(l.code)}
              accessibilityLabel={`Switch language to ${l.label}`}
              accessibilityState={{ selected: language === l.code }}>
              <Text maxFontSizeMultiplier={1.4} style={[
                styles.langChipText,
                { color: colors.textSecond },
                language === l.code && { color: colors.textBrand, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
              trackOn={colors.legal}/>
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
          onChange={toggleMaster}/>

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
            showToast('Check your device notifications.');
          } catch (e: any) {
            showToast(apiErrorMessage(e), 'error');
          }
        }}
        accessibilityLabel="Send a test push notification"
          accessibilityHint="Double-tap to activate"
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.testPushText, { color: colors.textOnNavy }]}>Send test notification →</Text>
      </TouchableOpacity>

      {/* Referral program removed (empty placeholder card) */}

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
  accessibilityRole="button"
            key={item.screen}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => navigation.navigate('MoreTab', { screen: item.screen })}
            accessibilityLabel={item.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.menuIcon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuLabel, { color: colors.textPrimary }]}>{item.label}</Text>
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
  accessibilityRole="button"
              style={[styles.navRow, { borderBottomWidth: 0 }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'AdminVerification' })}
              accessibilityLabel="Bar verification queue"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.navRowLabel, { color: colors.textPrimary }]}>⚖️  Bar Verification Queue</Text>
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
  accessibilityRole="button"
            key={item.label}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => { hapticImpact(); if (item.nav) navigation.navigate('MoreTab', { screen: item.nav }); }}
            accessibilityLabel={item.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.menuIcon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuLabel, { color: colors.textPrimary }]}>{item.label}</Text>
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
      <TouchableOpacity accessibilityRole="button"
        style={[styles.logoutBtn, { backgroundColor: colors.bg }]}
        onPress={logout}
        accessibilityLabel="Sign out"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />

      {/* ── Danger Zone -- Account Deletion ──────────────────────────────── */}
      <View style={{ marginTop: 32, marginHorizontal: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8,
          textTransform: 'uppercase', color: colors.emergency,
          fontFamily: 'Inter_800ExtraBold', marginBottom: 12 }}>
          Danger Zone
        </Text>
        <View style={[{ borderRadius: 12, borderWidth: 1, padding: 16 },
          { backgroundColor: colors.emergencyBg, borderColor: colors.emergency + '44' }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontFamily: 'Inter_700Bold', color: colors.emergency, marginBottom: 6 }}>
            Delete Account
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted, marginBottom: 16 }}>
            Permanently deletes your account, all cases, messages, and data.
            This cannot be undone.
          </Text>
          {!signedIn ? (
            <Text testID="account-delete-signed-out" maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted }}>
              Sign in to export or delete your account data. Nothing is stored for guests beyond this device.
            </Text>
          ) : (<>
          <TouchableOpacity accessibilityRole="button" testID="account-delete-open"
            style={{ backgroundColor: colors.emergencyDark, borderRadius: 8,
              paddingVertical: 12, alignItems: 'center' }}
            accessibilityLabel="Delete account permanently"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => { setDeleteError(''); setDeletePassword(''); setDeleteOpen(true); }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.white }}>
              Delete My Account
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="account-export"
            style={{ marginTop: 12, alignItems: 'center', padding: 8 }}
            accessibilityLabel="Export my data"
            accessibilityState={{ disabled: exporting, busy: exporting }}
            disabled={exporting}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={exportData}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textBrand,
              textDecorationLine: 'underline' }}>
              {exporting ? 'Preparing your export…' : 'Export My Data (GDPR)'}
            </Text>
          </TouchableOpacity>
          </>)}
        </View>
      </View>


          {/* ── Rate the App ─────────────────────────────────────────── */}
          <TouchableOpacity
            accessibilityRole="button"
            style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
              backgroundColor:colors.bgCard, borderRadius:10, padding:14,
              marginBottom:8, borderWidth:1, borderColor:colors.border }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={async () => {
              let isAvailable = false;
              try { isAvailable = await StoreReview.isAvailableAsync(); } catch {}
              if (isAvailable) {
                await StoreReview.requestReview();
              }
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color:colors.textPrimary, fontSize: 14, fontWeight:"600" }}>
              ⭐ Rate Justice Gavel
            </Text>
            <Text style={{ color:colors.textMuted, fontSize:12 }}>Tell us what you think →</Text>
          </TouchableOpacity>

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.overlay }}>
          <View testID="account-delete-dialog" style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 20 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 }}>
              Delete your account?
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 20, color: colors.textMuted, marginBottom: 14 }}>
              This permanently deletes your account, cases, notes, messages, reminders and saved lawyers. It cannot be undone. Enter your password to confirm.
            </Text>
            <TextInput
              secureTextEntry
              testID="account-delete-password"
              accessibilityLabel="Password"
              value={deletePassword}
              onChangeText={(v) => { setDeletePassword(v); if (deleteError) setDeleteError(''); }}
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              editable={!deleting}
              onSubmitEditing={deleteAccount}
              style={{ borderWidth: 1, borderColor: deleteError ? colors.emergencyDark : colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, color: colors.textPrimary, backgroundColor: colors.bg }}
            />
            {!!deleteError && (
              <Text testID="account-delete-error" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4}
                style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{deleteError}</Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel" disabled={deleting}
                onPress={() => setDeleteOpen(false)} style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="account-delete-confirm" accessibilityLabel="Delete account permanently"
                accessibilityState={{ disabled: deleting, busy: deleting }} disabled={deleting} onPress={deleteAccount}
                style={{ backgroundColor: colors.emergencyDark, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
                {deleting
                  ? <ActivityIndicator color={colors.white} />
                  : <Text maxFontSizeMultiplier={1.4} style={{ color: colors.white, fontWeight: '700' }}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
  );
}
export default React.memo(SettingsScreen);