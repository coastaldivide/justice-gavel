import { useConfirm } from '../hooks/useConfirm';
import { requestNotificationsInContext } from '../services/permissions';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS, type IconName } from '../components/AppIcon';
/**
 * SettingsScreen -- User preferences
 *
 * Sections:
 *   1. Account -- name, email, phone
 *   2. Appearance -- dark mode toggle
 *   3. Language -- English / Español
 *   4. Notifications -- this phone's push on/off (native) + per-category
 *                       switches saved on the account (court reminders,
 *                       arrest alerts, check-in reminders, marketing)
 *   6. About -- ToS, Privacy, Feedback, version
 *   7. testID="settings-logout-button" Sign out
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, themeColors } from '../constants/theme';
import type {} from '../types/navigation';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator, RefreshControl, LayoutAnimation, Modal, FlatList, Platform, TextInput, Linking } from 'react-native';
import AsyncStorage          from '@react-native-async-storage/async-storage';
import { ScreenCapture, StoreReview, hapticImpact } from '../utils/webCompat';
import Constants   from 'expo-constants';
import { api, apiErrorMessage } from '../services/api';
import { setLang, t, useLang } from '../i18n'  // t() already available;
import { getUserState, setUserState, STATE_NAMES, STATE_LIST } from '../utils/userState';
import { getToken, getItem as getSecureItem } from '../utils/secureStorage';
import { useInFlight } from '../hooks/useInFlight';
import { signOut, unsyncedCaseCount } from '../services/session';
import { registerForPush, unregisterPush } from '../services/push';
import { saveAccountExport } from '../utils/dataExport';
import { isScreenEnabled } from '../constants/features';

interface User { id?: number; displayName?: string; name?: string; email?: string; phone?: string; role?: string; accountType?: string; is_admin?: boolean }

/** Attorney / firm tools in "My Tools" (the screens send everyone else back). */
const PRO_ROLES = new Set(['attorney', 'defender', 'admin']);
const isProfessional = (u: User) => u.accountType === 'attorney' || PRO_ROLES.has(String(u.role || ''));
const PRO_TOOLS = new Set(['FirmVertical', 'FirmAcquisition', 'AttorneyDashboard', 'AttorneyInbox', 'ConflictCheck']);
const AGENT_TOOLS = new Set(['BondsmanDashboard']);
const IS_WEB = Platform.OS === 'web';

interface NotifPrefs {
  notif_court_reminders:   boolean;
  notif_arrest_alerts:     boolean;
  notif_checkin_reminders: boolean;
  notif_marketing:         boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  notif_court_reminders:   true,
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
  shareBtnText:{ color: colors.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

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
  menuHint: { fontSize: 11, marginTop: 1, color: colors.textMuted } });

// Module-level fallback for helper components
function SettingsScreen({ navigation }: any) {
  useLang();
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
    if (!signedInRef.current) { setRefreshing(false); return; }
    // GET /auth/me answers the user itself (not { user })
    api.get<User>('/auth/me')
      .then(r => { if (mountedRef.current && r.data?.id) setUser(r.data); })
      .catch(() => showToast(t('x_consumer_subscription_could_not_refresh_check'), 'error'))
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [showToast]);

  const [user, setUser]                   = useState<User>({});
  const signedInRef = useRef(false);
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
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('x_st_enable_biometric_lock') });
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

  // Re-read on every focus: signing in from here (Sign in → back) or out elsewhere changes it.
  const loadAccount = useCallback(() => {
    (async () => {
      const u = await getSecureItem('user').catch(() => null);
      setUser({});
      setIsAdmin(false);
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          // Shows the Admin section; the server still enforces admin on every admin endpoint.
          setIsAdmin(['admin', 'super_admin'].includes(String(parsed?.role)));
        } catch { /* corrupt stored user: the account rows stay empty */ }
      }
      const lang = await AsyncStorage.getItem('lang').catch(() => null);
      if (lang) setLanguage(lang);
      const n = await AsyncStorage.getItem('notifs').catch(() => null);
      if (n !== null) setNotifMaster(n === 'true');

      // Account-only data: guests have none (and must not get 401s).
      const tk = await getToken().catch(() => null);
      signedInRef.current = !!tk;
      setSignedIn(!!tk);
      if (!tk) return;
      api.get('/golden-gavel/status').then(r => {
        if (mountedRef.current) setGoldenGavel(r.data?.golden_gavel === true);
      }).catch(() => { /* status stays "check eligibility" */ });

      setPrefsLoading(true);
      api.get('/push/preferences')
        .then(r => { if (mountedRef.current) setPrefs({
          notif_court_reminders:   !!r.data?.notif_court_reminders,
          notif_arrest_alerts:     !!r.data?.notif_arrest_alerts,
          notif_checkin_reminders: !!r.data?.notif_checkin_reminders,
          notif_marketing:         !!r.data?.notif_marketing }); })
        .catch(e => showToast(apiErrorMessage(e, t('x_st_could_not_save_notification')), 'error'))
        .finally(() => { if (mountedRef.current) setPrefsLoading(false); });
    })();
  }, [showToast]);
  useEffect(() => {
    loadAccount();
    const unsub = navigation?.addListener?.('focus', loadAccount);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation, loadAccount]);

  const toggleLang = async (l: string) => {
    setLanguage(l);
    setLang(l);
    await AsyncStorage.setItem('lang', l).catch(() => {}); // non-fatal storage write
    // Signed in: court reminders and e-mails follow the new language (re-planned server-side).
    if ((user as { id?: unknown })?.id) api.post('/push/language', { language: l }).catch(() => { /* offline: sent with the next court-date save */ });
  };

  // This phone's push notifications (native only): on = permission + token sent
  // to the server, off = the token is removed, so nothing is pushed here.
  const toggleMaster = async (val: boolean) => {
    if (val) {
      // Turning reminders on is the moment to ask the OS (with the reason).
      const answer = await requestNotificationsInContext();
      if (answer !== 'granted') { showToast(t('x_st_notifications_stay_off_can'), 'info'); return; }
      if (signedIn) await registerForPush().catch(() => null);
    } else if (signedIn) {
      try { await unregisterPush(); }
      catch (e) { showToast(apiErrorMessage(e, t('st_push_off_failed')), 'error'); return; }
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
      notif_arrest_alerts:     next.notif_arrest_alerts     ? 1 : 0,
      notif_checkin_reminders: next.notif_checkin_reminders ? 1 : 0,
      notif_marketing:         next.notif_marketing         ? 1 : 0 })
      .catch((e) => {
        // Not saved: put the switch back and say so (never a silent failure).
        setPrefs(prev);
        showToast(apiErrorMessage(e, t('x_st_could_not_save_notification')), 'error');
      })
      .finally(() => setPrefsSaving(false));
  };

  // ── Account deletion (in-app, App Store 5.1.1(v)) / data export ──────────
  const [signedIn, setSignedIn] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [runDelete, deleting] = useInFlight();
  const [runExport, exporting] = useInFlight();

  const deleteAccount = () => runDelete(async () => {
    if (!deletePassword) { setDeleteError(t('x_st_enter_password_confirm')); return; }
    setDeleteError('');
    try {
      await api.delete('/auth/account', { data: { password: deletePassword } });
    } catch (e) {
      setDeleteError(apiErrorMessage(e, t('x_st_could_not_delete_account')));
      return;
    }
    // The account is gone on the server: remove everything on this device too.
    setDeleteOpen(false);
    setDeletePassword('');
    showToast(t('x_st_account_data_were_permanently'), 'success');
    await signOut({ serverDone: true });
  });

  const exportData = () => runExport(async () => {
    try {
      const res = await api.get('/auth/export');
      if (await saveAccountExport(res.data) === 'download') showToast(t('st_export_downloaded'), 'success');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_st_could_not_export_data')), 'error');
    }
  });

  const logout = async () => {
    // Cases saved offline that never reached the server are lost on sign-out: say so.
    const pending = await unsyncedCaseCount();
    const ok = await confirm(t('x_st_sign_out'),
      pending ? t('st_sign_out_unsynced', { count: pending }) : t('x_st_can_sign_back_any'),
      { confirmLabel: t('x_st_sign_out_2'), destructive: true });
    if (!ok) return;
    // Switching the root auth state swaps the navigator tree to the guest flow
    // (Login), so no manual navigation reset is needed.
    await signOut();
  };

  const openAbout = (item: { nav?: string; url?: string }) => {
    hapticImpact();
    if (item.nav) navigation.navigate('MoreTab', { screen: item.nav });
    else if (item.url) Linking.openURL(item.url).catch(() => showToast(t('action_failed'), 'error'));
  };


  // ── Reusable row components ──────────────────────────────────────────────
  const InfoRow = ({ icon, label, value }: { icon: IconName; label: string; value?: string }) => (
    <View style={[styles.infoRow, { borderBottomColor: colors.surface }]}>
      <AppIcon name={icon} size={20} color={colors.textBrand} style={styles.infoIcon} />
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
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_account')}</Text>
      <View style={card}>
        <InfoRow icon={ICONS.user} label={t("settings.display_name")} value={user.displayName || user.name} />
        {!!user.email && <InfoRow icon={ICONS.mail} label={t('email')} value={user.email} />}
        {isScreenEnabled('GoldenGavel') && <TouchableOpacity
          accessibilityRole="button"
          testID="settings-golden-gavel"
          onPress={() => navigation.navigate('MoreTab', { screen: 'GoldenGavel' })}
        >
          {goldenGavel
            ? <InfoRow icon={ICONS.trophy} label={t("settings.account_status")} value={t('x_st_golden_gavel_value')} />
            : <InfoRow icon={ICONS.lawyer} label={t('gg_title')} value={t('x_st_check_eligibility')} />}
        </TouchableOpacity>}
        {!!user.phone && <InfoRow icon={ICONS.mobile} label={t('phone')} value={user.phone} />}
        {/* State preference -- controls rights card, AI jurisdiction, and provider search */}
        <TouchableOpacity accessibilityRole="button"
          style={styles.row}
          onPress={() => setShowStatePickerSettings(true)}
          accessibilityLabel={t('x_st_change_state_preference')}
        >
          <View style={styles.rowLeft}>
            <AppIcon name={ICONS.directions} size={20} color={colors.textBrand} style={styles.rowIcon} />
            <View>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowLabel}>{t('x_st_state')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
                {userState ? STATE_NAMES[userState] || userState : t('x_st_not_set_tap_select')}
              </Text>
            </View>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.rowArrow}>›</Text>
        </TouchableOpacity>
        {/* Official Court Forms -- all 50 states */}
        <TouchableOpacity accessibilityRole="button"
        onPress={goToCourtForms}
        style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:4, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:colors.border }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <AppIcon name="document-text-outline" size={20} color={themeColors().textBrand} />
        <View style={{ flex:1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, ...FONTS.semiBold, color:colors.textBrand }}>{t('x_court_forms_official_court_forms')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, ...FONTS.regular, color:colors.textMuted }}>{t('x_st_government_forms_all_50')}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, color:colors.textMuted }}>›</Text>
      </TouchableOpacity>
      </View>

      {/* State picker */}
      <Modal visible={showStatePicker} animationType="slide" transparent onRequestClose={() => setShowStatePickerSettings(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: '75%', backgroundColor: colors.bgCard, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>{t('x_st_select_state')}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setShowStatePickerSettings(false)}>
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
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_appearance')}</Text>
      <View style={card}>

        {/* Dark / Light Mode Toggle */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.switchLabel, { color: colors.textPrimary }]}>
              {isDark ? t('x_st_dark_mode') : t('x_st_light_mode')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.switchHint, { color: colors.textMuted }]}>
              {isDark
                ? t('x_st_default_easier_eyes_low')
                : t('x_st_high_contrast_white_better')}
            </Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleDark}
            trackColor={{ false: colors.surface, true: colors.blue }}
            thumbColor={isDark ? COLORS.steel : colors.bg}
            ios_backgroundColor={colors.surface}
            accessibilityLabel={t('x_st_toggle_dark_light_mode')}
          />
        </View>

      </View>

      {/* ── Language ─────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_language_idioma')}</Text>
      <View style={card}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.cardHint, { color: colors.textMuted }]}>
          {t('x_st_changes_take_effect_immediately')}
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
              accessibilityLabel={t('x_st_switch_language', { label: l.label })}
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
          <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_security')}</Text>
          <View style={card}>
            <SwitchRow
              label={t('x_st_biometric_lock')}
              hint={t('x_st_require_face_id_fingerprint')}
              value={biometricEnabled}
              onChange={toggleBiometric}
              trackOn={colors.legal}/>
          </View>
        </>
      )}

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_notifications')}</Text>
      <View style={card}>

        {/* Master toggle: this phone's push notifications (there is no push on the web) */}
        {!IS_WEB && (
          <SwitchRow
            label={t('x_st_push_notifications')}
            hint={t('x_st_turn_off_all_notifications')}
            value={notifMaster}
            onChange={toggleMaster}/>
        )}

        {!signedIn && (
          <Text testID="settings-notifs-signed-out" maxFontSizeMultiplier={1.4} style={[styles.cardHint, { color: colors.textMuted, marginBottom: 0 }]}>
            {t('st_notifs_sign_in')}
          </Text>
        )}

        {/* Per-category (saved on the account) -- only visible when master is on */}
        {signedIn && (notifMaster || IS_WEB) && (
          <View style={[styles.subPrefs, { borderTopColor: colors.surface }, IS_WEB && { marginTop: 0, paddingTop: 0, borderTopWidth: 0 }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.subPrefsLabel, { color: colors.textMuted }]}>
              {t('x_st_choose_what_receive')}
              {prefsSaving && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted }}>{' '}{t('x_st_saving')}</Text>}
            </Text>

            {prefsLoading ? (
              <ActivityIndicator size="small" color={themeColors().textBrand} style={{ marginVertical: 12 }} />
            ) : (
              <>
                <SwitchRow
                  label={t('x_st_court_date_reminders')}
                  hint={t('x_st_7_days_3_days')}
                  value={prefs.notif_court_reminders}
                  onChange={v => togglePref('notif_court_reminders', v)}
                />
                <SwitchRow
                  label={t('x_st_arrest_alerts')}
                  hint={t('x_st_when_someone_monitor_list')}
                  value={prefs.notif_arrest_alerts}
                  onChange={v => togglePref('notif_arrest_alerts', v)}
                />
                <SwitchRow
                  label={t('x_st_check_reminders')}
                  hint={t('x_st_daily_reminder_if_re')}
                  value={prefs.notif_checkin_reminders}
                  onChange={v => togglePref('notif_checkin_reminders', v)}
                />
                <SwitchRow
                  label={t('x_st_promotions_offers')}
                  hint={t('x_st_occasional_discounts_new_features')}
                  value={prefs.notif_marketing}
                  onChange={v => togglePref('notif_marketing', v)}
                  trackOn={COLORS.steel}
                />
              </>
            )}
          </View>
        )}
      </View>

      {/* ── Test push notification (debug / support; phones only) ──────── */}
      {!IS_WEB && signedIn && <TouchableOpacity
  accessibilityRole="button"
        style={[styles.testPushBtn, { borderColor: colors.surface }]}
        onPress={async () => {
    await hapticImpact();

          try {
            await api.post('/push/test', { message: t('x_st_justice_gavel_push_notifications') });
            showToast(t('x_st_check_device_notifications'));
          } catch (e: any) {
            showToast(apiErrorMessage(e), 'error');
          }
        }}
        accessibilityLabel={t('x_st_send_test_push_notification')}
          accessibilityHint={t('cp_double_tap')}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.testPushText, { color: colors.textOnNavy }]}>{t('x_st_send_test_notification')}</Text>
      </TouchableOpacity>}

      {/* Referral program removed (empty placeholder card) */}

      {/* ── My Tools -- quick access to all features ──────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_my_tools')}</Text>
      <View style={card}>
        {[
          { icon: ICONS.card, label: t('bill_title'),               hint: t('st_billing_hint'),                       screen: 'Payments' },
          { icon: ICONS.mail, label: t('x_nav_attorney_inbox'),     hint: t('st_inbox_hint'),                         screen: 'AttorneyInbox' },
          { icon: ICONS.search, label: t('x_nav_conflict_check'),     hint: t('st_conflicts_hint'),                     screen: 'ConflictCheck' },
          { icon: ICONS.clipboard, label: t('x_nav_lead_dashboard'),     hint: t('st_leads_hint'),                         screen: 'BondsmanDashboard' },
          { icon: ICONS.firm, label: t('x_st_firm_vertical_setup'),   hint: t('x_st_configure_practice_area_pricing'), screen: 'FirmVertical' },
          { icon: ICONS.rocket, label: t('x_st_start_firm_trial'),       hint: t('x_st_self_serve_onboarding_activate'),  screen: 'FirmAcquisition' },
          { icon: ICONS.starFilled, label: t('saved_title'),         hint: t('x_st_personal_attorney_contact_list'),        screen: 'SavedLawyers' },
          { icon: ICONS.alarm, label: t('x_cs_deadline_calculator'),   hint: t('x_st_arraignment_appeal_aedpa_all'), screen: 'DeadlineCalculator' },
          { icon: ICONS.notification, label: t('x_st_arrest_monitor'),        hint: t('x_st_get_alerted_when_someone'),         screen: 'ArrestMonitor' },
          { icon: ICONS.checkOutline, label: t('x_check_in_daily_check'),        hint: t('x_st_court_ordered_check_compliance'),          screen: 'CheckIn' },
          { icon: ICONS.handshake, label: t('x_st_diversion_checker'),     hint: t('div_title'),                  screen: 'Diversion' },
          { icon: ICONS.trophy, label: t('gg_title'),           hint: t('x_st_path_elite_status'),                  screen: 'GoldenGavel' },
          { icon: ICONS.shield, label: t('x_insurance_legal_insurance'),       hint: t('x_st_monthly_coverage_plans'),                    screen: 'Insurance' },
          { icon: ICONS.juvenile, label: t('juv_title'),       hint: t('x_st_rights_process_record_sealing'),        screen: 'JuvenileJustice' },
          { icon: ICONS.mentalHealth, label: t('x_st_mental_health_law'),    hint: t('x_st_mh_courts_competency_diversion'),           screen: 'MentalHealthDiversion' },
          { icon: ICONS.family, label: t('civil_family_title'),        hint: t('x_st_custody_protective_orders_child'),   screen: 'FamilyCourt' },
          { icon: ICONS.globe, label: t('civil_imm_title'), hint: t('x_st_how_record_affects_immigration'),    screen: 'ImmigrationConsequences' },
          { icon: ICONS.housing, label: t('civil_housing_title'),           hint: t('x_st_criminal_record_housing_eviction'), screen: 'HousingRights' },
          { icon: ICONS.lawyer, label: t('atty_title'),     hint: t('x_st_cases_templates_cle_credits'),    screen: 'AttorneyDashboard' },
          { icon: ICONS.ban, label: t('offline_title'),           hint: t('x_st_what_works_without_connection'),            screen: 'OfflineStatus' },
          { icon: ICONS.stats, label: t('x_st_advocacy'),              hint: t('x_st_criminal_justice_data_reform'),     screen: 'Advocacy' },
        ].filter(item => (!PRO_TOOLS.has(item.screen) || isProfessional(user)) && (!AGENT_TOOLS.has(item.screen) || user?.accountType === 'bail_agent')
          && isScreenEnabled(item.screen, user?.accountType === 'bail_agent' ? 'bail_agent' : user?.role)).map((item, i, arr) => (
          <TouchableOpacity
  accessibilityRole="button"
            key={item.screen}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => navigation.navigate('MoreTab', { screen: item.screen })}
            accessibilityLabel={item.label}
          >
            <AppIcon name={item.icon} size={22} color={colors.textBrand} style={styles.menuIcon} />
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
          <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_st_admin')}</Text>
          <View style={card}>
            <TouchableOpacity
  accessibilityRole="button"
              style={[styles.navRow, { borderBottomWidth: 0 }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'AdminVerification' })}
              accessibilityLabel={t('adm_title')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.navRowLabel, { color: colors.textPrimary }]}>{t('adm_title')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.navRowArrow, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={sectionTitle}>{t('x_firm_public_profile_about')}</Text>
      <View style={card}>
        {[
          { icon: ICONS.document, label: t('onb_terms_tos'),  nav: 'TermsOfService' },
          { icon: ICONS.lock, label: t('onb_terms_pp'),    nav: 'PrivacyPolicy' },
          { icon: ICONS.message, label: t('x_feedback_button_send_feedback'),     url: 'mailto:support@justicegavel.app' },
          { icon: ICONS.camera, label: 'Instagram',         url: 'https://instagram.com/yourjusticegavel', hint: '@yourjusticegavel' },
          { icon: ICONS.globe, label: t('hn_website'),           url: 'https://justicegavel.app' },
        ].map((item, i, arr) => (
          <TouchableOpacity
  accessibilityRole="button"
            key={item.label}
            style={[styles.menuRow, { borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.surface }]}
            onPress={() => openAbout(item)}
            accessibilityLabel={item.label}
          >
            <AppIcon name={item.icon} size={22} color={colors.textBrand} style={styles.menuIcon} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.menuLabel, { color: colors.textPrimary }]}>{item.label}</Text>
              {item.hint && <Text maxFontSizeMultiplier={1.4} style={[styles.menuHint, { color: colors.textMuted }]}>{item.hint}</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.menuArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.versionRow}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.version, { color: colors.textMuted }]}>{t('x_st_justice_gavel_v', { value: Constants.expoConfig?.version || '1.8.25' })}</Text>
        </View>
      </View>

      {/* ── Sign out (signed in) / Sign in (guest) ───────────────────────── */}
      {signedIn ? (
        <TouchableOpacity accessibilityRole="button" testID="settings-logout-button"
          style={[styles.logoutBtn, { backgroundColor: colors.bg }]}
          onPress={logout}
          accessibilityLabel={t('x_st_sign_out_2')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.logoutText}>{t('x_st_sign_out_2')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity accessibilityRole="button" testID="settings-sign-in-button"
          style={[styles.logoutBtn, { backgroundColor: colors.navy, borderColor: colors.navy }]}
          onPress={() => navigation.navigate('MoreTab', { screen: 'Login' })}
          accessibilityLabel={t('st_sign_in_or_create')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.logoutText, { color: colors.textOnNavy }]}>{t('st_sign_in_or_create')}</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />

      {/* ── Danger Zone -- Account Deletion ──────────────────────────────── */}
      <View style={{ marginTop: 32, marginHorizontal: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8,
          textTransform: 'uppercase', color: colors.emergency,
          fontFamily: 'Inter_800ExtraBold', marginBottom: 12 }}>
          {t('x_st_danger_zone')}
        </Text>
        <View style={[{ borderRadius: 12, borderWidth: 1, padding: 16 },
          { backgroundColor: colors.emergencyBg, borderColor: colors.emergency + '44' }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontFamily: 'Inter_700Bold', color: colors.emergency, marginBottom: 6 }}>
            {t('x_st_delete_account')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted, marginBottom: 16 }}>
            {t('x_st_permanently_deletes_account_all')}
          </Text>
          {!signedIn ? (
            <Text testID="account-delete-signed-out" maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textMuted }}>
              {t('x_st_sign_export_delete_account')}
            </Text>
          ) : (<>
          <TouchableOpacity accessibilityRole="button" testID="account-delete-open"
            style={{ backgroundColor: colors.emergencyDark, borderRadius: 8,
              paddingVertical: 12, alignItems: 'center' }}
            accessibilityLabel={t('x_st_delete_account_permanently')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => { setDeleteError(''); setDeletePassword(''); setDeleteOpen(true); }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.white }}>
              {t('x_st_delete_my_account')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="account-export"
            style={{ marginTop: 12, alignItems: 'center', padding: 8 }}
            accessibilityLabel={t('x_st_export_my_data')}
            accessibilityState={{ disabled: exporting, busy: exporting }}
            disabled={exporting}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={exportData}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 20, color: colors.textBrand,
              textDecorationLine: 'underline' }}>
              {exporting ? t('x_st_preparing_export') : t('x_st_export_my_data_gdpr')}
            </Text>
          </TouchableOpacity>
          </>)}
        </View>
      </View>


          {/* ── Rate the App (app stores only; nothing to rate on the web) ── */}
          {!IS_WEB && <TouchableOpacity
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
            <IconLabel icon={ICONS.starFilled} textStyle={{ color:colors.textPrimary, fontSize: 14, fontWeight:"600" }} maxFontSizeMultiplier={1.3}>{t('x_st_rate_justice_gavel')}</IconLabel>
            <Text style={{ color:colors.textMuted, fontSize:12 }}>{t('x_st_tell_us_what_think')}</Text>
          </TouchableOpacity>}

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.overlay }}>
          <View testID="account-delete-dialog" style={{ backgroundColor: colors.bgCard, borderRadius: 14, padding: 20 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 }}>
              {t('x_st_delete_account_2')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 20, color: colors.textMuted, marginBottom: 14 }}>
              {t('x_st_this_permanently_deletes_account')}
            </Text>
            <TextInput
              secureTextEntry
              testID="account-delete-password"
              accessibilityLabel={t('password')}
              value={deletePassword}
              onChangeText={(v) => { setDeletePassword(v); if (deleteError) setDeleteError(''); }}
              autoCapitalize="none"
              autoComplete="password"
              placeholder={t('password')}
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
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('case_cancel')} disabled={deleting}
                onPress={() => setDeleteOpen(false)} style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontWeight: '600' }}>{t('case_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="account-delete-confirm" accessibilityLabel={t('x_st_delete_account_permanently')}
                accessibilityState={{ disabled: deleting, busy: deleting }} disabled={deleting} onPress={deleteAccount}
                style={{ backgroundColor: colors.emergencyDark, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
                {deleting
                  ? <ActivityIndicator color={colors.white} />
                  : <Text maxFontSizeMultiplier={1.4} style={{ color: colors.white, fontWeight: '700' }}>{t('x_st_delete_forever')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
  );
}
export default React.memo(SettingsScreen);