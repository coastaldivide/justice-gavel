import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, RefreshControl, LayoutAnimation } from 'react-native';
import type { ScreenProps } from '../types/navigation';
/**
 * ArrestMonitorScreen -- Pro tier feature
 * Lets users watch for arrest records on up to 5 names/counties.
 * When the nightly scraper finds a match, they get a push notification.
 * Accessible from: HomeScreen tile "My Plan" → upsell, or direct nav from Pro plan
 */
import React, { useState, useEffect, useCallback } from 'react';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { stateName } from '../utils/userState';
import { getToken } from '../utils/secureStorage';

const MAX_WATCHES = 5;
// Plans that include arrest monitoring (billing TIERS keys) and the statuses that count as paid.

interface Watch {
  id: number;
  watch_name: string;
  county: string;
  state: string | null;
  last_checked: string | null;
  last_result: string | null;
  active: number;
}

function ArrestMonitorScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);



  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);

  const [watches,   setWatches]   = useState<Watch[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isPro,     setIsPro]     = useState(false);
  const [proPrice,  setProPrice]  = useState('');
  const [name,      setName]      = useState('');
  const [county,    setCounty]    = useState('');
  const [state,     setState]     = useState('');
  const [adding,    setAdding]    = useState(false);
  const [showForm,  setShowForm]  = useState(false);

  // The Legal Pro price as the server lists it, in the app's language.
  const showProPrice = (tiers?: { key: string; monthly_cents?: number }[]) => {
    const cents = Number((tiers || []).find(x => x.key === 'legal_pro')?.monthly_cents);
    setProPrice(cents > 0 ? t('am_per_month', { price: (cents / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' }) }) : '');
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Signed out: the plan description (nothing to load — the API needs an account).
    if (!(await getToken().catch(() => null))) {
      const tiers = await api.get<{ tiers: { key: string; monthly_cents?: number }[] }>('/billing/tiers?audience=consumer').catch(() => null);
      showProPrice(tiers?.data?.tiers);
      setIsPro(false); setLoading(false); return;
    }
    try {
      // The server's plan says what it includes: GET /billing/subscription →
      // { subscription: { paid, features[] } | null, tiers } (same matrix that gates POST /arrests/monitors).
      const subRes = await api.get<{ subscription: { paid?: boolean; features?: string[] } | null; tiers?: { key: string; monthly_cents?: number }[] }>('/billing/subscription')
        .catch(() => ({ data: { subscription: null, tiers: [] } }));
      const sub = subRes.data?.subscription;
      setIsPro(!!sub?.paid && Array.isArray(sub.features) && sub.features.includes('arrest_monitor'));
      showProPrice(subRes.data?.tiers);

      // Load existing watches
      const res = await api.get('/arrests/monitors').catch(() => ({ data: [] }));
      setWatches(unwrapList(res.data, 'monitors'));
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pull-to-refresh: one reload (the old handler called load() twice).
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const addWatch = async () => {
    if (!name.trim()) { showToast(t('x_arrest_monitor_enter_full_name_start'), 'error'); return; }
    if (watches.length >= MAX_WATCHES) {
      showToast(t('x_arrest_monitor_pro_plan_supports_up', { MAX_WATCHES }), 'warning');
      return;
    }
    setAdding(true);
    try {
      const st = state.trim().toUpperCase().slice(0, 2);
      await api.post('/arrests/monitors', {
        watch_name: name.trim(),
        county:     county.trim() || 'All',
        ...(st.length === 2 ? { state: st } : {}),   // no state = every state
      });
      setName(''); setCounty(''); setState(''); setShowForm(false);
      await load();
    } catch (e: any) {
      setLoading(false);
      showToast(apiErrorMessage(e, t('x_arrest_monitor_could_not_add_monitor')), 'error');
    }
    setAdding(false);
  };

  const removeWatch = (id: number) => {
confirm(t('x_arrest_monitor_stop_monitoring'),t('x_arrest_monitor_we_ll_stop_alerts'),
      { confirmLabel:t('saved_remove'), destructive:true }).then(async ok=>{ if(!ok) return;
      await api.delete(`/arrests/monitors/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setWatches(prev => prev.filter(w => w.id !== id));
    })
  };

  // ── Not Pro -- upsell wall ────────────────────────────────────────────────
  if (!loading && !isPro) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}
        testID="arrest-monitor-screen">
        <View style={styles.upsellCard}>
          <AppIcon name="notifications-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellTitle}>{t('x_arrest_monitor_arrest_monitoring')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellBody}>
            {t('x_arrest_monitor_get_push_alert_when')}
          </Text>
          <View style={styles.upsellFeatures}>
            {[
              t('x_arrest_monitor_nightly_check_ingested_arrest'),
              t('x_arrest_monitor_push_notification_new_match'),
              t('x_arrest_monitor_up_5_names_monitored'),
              t('x_arrest_monitor_covers_connected_public_booking'),
              t('x_arrest_monitor_includes_full_pro_plan'),
            ].map(f => (
              <View key={f} style={styles.upsellFeatureRow}>
                <Text maxFontSizeMultiplier={1.4} style={styles.upsellCheck}>✓</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.upsellFeatureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={styles.upsellBtn}
            testID="arrest-monitor-upgrade"
            onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.upsellBtnText}>{proPrice ? t('am_upgrade_price', { price: proPrice }) : t('am_upgrade')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.upsellSkip}
          accessibilityLabel={t('chat_limit_dismiss')}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.upsellSkipText}>{t('chat_limit_dismiss')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Pro -- monitoring list ────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.navy} /></View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView testID="arrest-monitor-list" keyboardShouldPersistTaps='handled' contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>

          {/* Status bar */}
          <View style={styles.statusBar}>
            <View style={styles.statusBadge}>
              <Text maxFontSizeMultiplier={1.4} style={styles.statusDot}>●</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>{t('case_status_active')}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.statusCount}>{t('x_arrest_monitor_monitors', { length: watches.length, MAX_WATCHES })}</Text>
          </View>

          {/* Active watches */}
          {watches.length === 0 ? (
            <View style={styles.emptyCard}>
              <AppIcon name={ICONS.eye} size={36} color={colors.textBrand} style={styles.emptyIcon} />
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('x_arrest_monitor_no_monitors_yet')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>
                {t('x_arrest_monitor_add_name_below_we')}
              </Text>
            </View>
          ) : (
            watches.map(w => (
              <View key={w.id} style={styles.watchCard}>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchName}>{w.watch_name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchLocation}>
                    {[w.county && w.county !== 'All' ? w.county : t('am_all_counties'), w.state ? stateName(w.state) : t('am_all_states')].join(' · ')}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchStatus}>
                    {w.last_checked
                      ? t('x_arrest_monitor_last_checked', { value: new Date(w.last_checked).toLocaleDateString() })
                      : t('x_arrest_monitor_checking_tonight')}
                  </Text>
                  {w.last_result === 'found' && (
                    <View style={styles.matchBadge}>
                      <IconLabel icon={ICONS.alertHigh} textStyle={styles.matchText} maxFontSizeMultiplier={1.4}>{t('x_arrest_monitor_match_found_check_arrest')}</IconLabel>
                    </View>
                  )}
                </View>
                <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.removeBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} onPress={() => removeWatch(w.id)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          {/* Add form */}
          {watches.length < MAX_WATCHES && (
            showForm ? (
              <View style={styles.addForm}>
                <Text maxFontSizeMultiplier={1.4} style={styles.addFormTitle}>{t('x_arrest_monitor_add_monitor')}</Text>
                <TextInput
                  style={styles.formInput}
                  accessibilityLabel={t('x_arrest_monitor_full_name_monitor')} placeholder={t('x_arrest_monitor_full_name_e_g')}
                  placeholderTextColor={COLORS.textSecond}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  returnKeyType="next"
          blurOnSubmit
        maxLength={200}
        />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.formInput, { flex: 1 }]}
                    accessibilityLabel={t('x_arrest_monitor_county_optional')} placeholder={t('x_arrest_monitor_county_optional')}
                    placeholderTextColor={COLORS.textSecond}
                    value={county}
                    onChangeText={setCounty}
          returnKeyType="next"
          blurOnSubmit
        />
                  <TextInput
          accessibilityLabel={t('state')}
                    style={[styles.formInput, { width: 70 }]}
                    placeholder={t('state')}
                    placeholderTextColor={COLORS.textSecond}
                    value={state}
                    onChangeText={v => setState(v.toUpperCase().slice(0, 2))}
                    autoCapitalize="characters"
                    maxLength={2}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
                    style={[styles.addBtn, { flex: 1 }]}
                    onPress={addWatch}
                    disabled={adding}
                  >
                    {adding
                      ? <ActivityIndicator color={colors.bgCard} size="small" />
                      : <Text maxFontSizeMultiplier={1.4} style={styles.addBtnText}>{t('x_arrest_monitor_start_monitoring')}</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"

                    style={styles.cancelFormBtn}
                    accessibilityLabel={t('case_cancel')}
          accessibilityHint={t('x_arrest_monitor_cancels_returns_previous_screen')} onPress={() => { setShowForm(false); setName(''); setCounty(''); }}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.cancelFormText}>{t('case_cancel')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.addTrigger} accessibilityLabel={t('x_arrest_monitor_add_name_monitor')} onPress={() => setShowForm(true)}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.addTriggerText}>{t('x_arrest_monitor_add_name_monitor')}</Text>
              </TouchableOpacity>
            )
          )}

          {/* Explanation */}
          <View style={styles.infoCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoTitle}>{t('qc_how_it_works')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoText}>
              {t('x_arrest_monitor_every_night_we_check')}
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { padding: 16 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Upsell
  upsellCard:        { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center' },
  upsellIcon:        { fontSize: 48, marginBottom: 16 },
  upsellTitle:       { fontSize: 22, ...FONTS.heavy, color: colors.textBrand, marginBottom: 10, textAlign: 'center' },
  upsellBody:        { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  upsellFeatures:    { width: '100%', gap: 8, marginBottom: 24 },
  upsellFeatureRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upsellCheck:       { color: colors.legal, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', width: 18 },
  upsellFeatureText: { fontSize: 14, lineHeight: 21, color: colors.textBrand, flex: 1 },
  upsellBtn:         { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, paddingHorizontal: 24, width: '100%', alignItems: 'center', ...SHADOW.md },
  upsellBtnText:     { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.heavy },
  upsellSkip:        { marginTop: 14 },
  upsellSkipText:    { color: colors.textMuted, fontSize: 12 },

  // Status
  statusBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.legalBg, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20 },
  statusDot:    { color: colors.legal, fontSize: 11 },
  statusText:   { fontSize: 12, ...FONTS.heavy, color: colors.legal },
  statusCount:  { fontSize: 12, color: colors.textMuted, ...FONTS.semi },

  // Empty
  emptyCard:  { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl, padding: 32, alignItems: 'center', marginBottom: 12, ...SHADOW.sm },
  emptyIcon:  { marginBottom: 10 },
  emptyTitle: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  emptySub:   { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  // Watch cards
  watchCard:    { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', ...SHADOW.sm, borderLeftWidth: 3, borderLeftColor: COLORS.navy },
  watchName:    { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 2 },
  watchLocation:{ fontSize: 12, color: COLORS.textMuted },
  watchStatus:  { fontSize: 11, color: COLORS.info, marginTop: 2 },
  matchBadge:   { backgroundColor: COLORS.infoBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: COLORS.steelMid },
  matchText:    { fontSize: 12, color: COLORS.info, ...FONTS.bold },
  removeBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  removeBtnText:{ fontSize: 12, lineHeight: 20, color: COLORS.textMuted, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  // Add form
  addForm:       { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12, ...SHADOW.sm },
  addFormTitle:  { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 12 },
  formInput:     { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, lineHeight: 22, color: COLORS.textPrimary, backgroundColor: COLORS.bg, marginBottom: 8 },
  addBtn:        { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  addBtnText:    { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21},
  cancelFormBtn: { paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  cancelFormText:{ color: COLORS.textMuted, fontSize: 12, lineHeight: 20, ...FONTS.semi },
  addTrigger:    { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: COLORS.navy, borderStyle: 'dashed' },
  addTriggerText:{ color: COLORS.navy, fontSize: 14, lineHeight: 21, ...FONTS.heavy },

  // Info
  infoCard:  { backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  infoTitle: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  infoText:  { fontSize: 12, color: COLORS.textMuted, lineHeight: 17 }});
export default React.memo(ArrestMonitorScreen);