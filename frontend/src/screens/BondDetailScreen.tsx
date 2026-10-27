/**
 * BondDetailScreen — one bond in the Bond Desk: case file and status,
 * indemnitors, paperwork (send to sign, follow signatures), money (charges,
 * payments with receipts, payment plan, reminders), collateral and court dates (hearings,
 * attended / missed / rescheduled, the reminder texts and their delivery), alerts (re-arrest watch
 * and the bond timeline) and recovery (share a forfeited bond with a recovery agent) — those two tabs
 * only when the server's ⚖ settings are on (GET /bond-desk/access → features).
 * Data: GET /api/bond-desk/bonds/:id (docs/BOND_DESK.md); every change reloads it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice } from '../components/bondDesk/ui';
import { OverviewSection } from '../components/bondDesk/OverviewSection';
import { IndemnitorsSection } from '../components/bondDesk/IndemnitorsSection';
import { PaperworkSection } from '../components/bondDesk/PaperworkSection';
import { MoneySection } from '../components/bondDesk/MoneySection';
import { CollateralSection } from '../components/bondDesk/CollateralSection';
import { CourtSection } from '../components/bondDesk/CourtSection';
import { AlertsSection } from '../components/bondDesk/AlertsSection';
import { RecoverySection } from '../components/bondDesk/RecoverySection';
import { AccessGate } from './BondDeskScreen';
import { type Access, type BondDetail, money } from '../services/bondDesk';

export const BOND_TABS = ['overview', 'court', 'people', 'paperwork', 'money', 'collateral', 'alerts', 'recovery'] as const;
export type BondTab = typeof BOND_TABS[number];

function BondDetailScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const params = (route?.params || {}) as { bondId?: number | string; tab?: BondTab };
  const bondId = Number(params.bondId);
  const [tab, setTab] = useState<BondTab>(BOND_TABS.includes(params.tab as BondTab) ? (params.tab as BondTab) : 'overview');
  const [detail, setDetail] = useState<BondDetail | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [denied, setDenied] = useState<Access | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (!Number.isSafeInteger(bondId) || bondId <= 0) { setError(t('bdk_not_found')); return; }
    try {
      const r = await api.get<BondDetail>(`/bond-desk/bonds/${bondId}`);
      if (mounted.current) { setDetail(r.data); setError(''); }
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { code?: string } } };
      const code = err?.response?.data?.code;
      if (err?.response?.status === 403 && (code === 'no_plan' || code === 'not_agent')) {
        if (mounted.current) setDenied({ allowed: false, reason: code, plan: null, texts_live: false, email_live: false, storage_live: false, text_cents: 5 });
        return;
      }
      if (mounted.current) setError(err?.response?.status === 404 ? t('bdk_not_found') : apiErrorMessage(e, t('bdk_load_failed')));
    }
  }, [bondId]);

  useEffect(() => {
    reload();
    api.get<Access>('/bond-desk/access').then(r => { if (mounted.current) setAccess(r.data); }).catch(() => { /* texts/email flags only */ });
  }, [reload]);

  const onRefresh = () => { setRefreshing(true); reload().finally(() => { if (mounted.current) setRefreshing(false); }); };

  if (denied) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="bond-detail-screen"><AccessGate access={denied} onPlans={() => navigation.navigate('Subscription' as never)} /></ScrollView>;
  }
  if (!detail) {
    return (
      <View style={[s.center, { backgroundColor: colors.bg }]} testID="bond-detail-screen">
        {error ? <Card><Line tone="danger" testID="bond-detail-error">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={reload} /></Card>
          : <ActivityIndicator size="large" color={colors.textBrand} />}
      </View>
    );
  }

  const b = detail.bond;
  // ⚖ tabs: only when the server has the feature on (absent on older servers = hidden)
  const tabs = BOND_TABS.filter(k => (k === 'alerts' ? !!(access?.features?.rearrest_alerts || access?.features?.recovery_sharing)
    : k === 'recovery' ? !!access?.features?.recovery_sharing : true));
  return (
    <ScrollView testID="bond-detail-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{b.defendant_name}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_header_line', { amount: money(b.bond_amount_cents), status: t(`bdk_st_${b.status}`), balance: money(detail.money.balance_cents) })}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" />}
      <View style={s.tabs} accessibilityRole="tablist">
        {tabs.map(k => (
          <TouchableOpacity key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} testID={`bond-tab-${k}`}
            onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
            <Text maxFontSizeMultiplier={1.3} style={[s.tabText, tab === k && s.tabTextOn]}>{t(`bdk_tab_${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'overview' && <OverviewSection detail={detail} reload={reload} onCheckins={() => navigation.navigate('CheckInManager' as never)} />}
      {tab === 'people' && <IndemnitorsSection detail={detail} reload={reload} />}
      {tab === 'paperwork' && <PaperworkSection detail={detail} reload={reload} access={access} />}
      {tab === 'money' && <MoneySection detail={detail} reload={reload} access={access} onSettings={() => navigation.navigate('BondDeskSettings' as never)} />}
      {tab === 'collateral' && <CollateralSection detail={detail} reload={reload} />}
      {tab === 'court' && <CourtSection detail={detail} reload={reload} access={access} />}
      {tab === 'alerts' && tabs.includes('alerts') && <AlertsSection detail={detail} access={access} />}
      {tab === 'recovery' && tabs.includes('recovery') && <RecoverySection detail={detail} reload={reload} staff={access?.role === 'staff'} />}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, marginTop: 12 },
  tab: { minHeight: 44, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontSize: 13, ...FONTS.bold, color: colors.textSecond },
  tabTextOn: { color: colors.textOnNavy },
});

export default React.memo(BondDetailScreen);
