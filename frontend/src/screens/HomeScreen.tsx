import JTBLogo from '../components/JTBLogo';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon, ICONS, type IconName } from '../components/AppIcon';
import EmergencyStrip from '../components/EmergencyStrip';
import BailAgentCard from '../components/BailAgentCard';
import React, { useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, LayoutAnimation } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { consumerPlansFrom, featureLabel, type ConsumerPlan } from '../services/plans';
import { activeContacts, sendSos, reportSosResult } from '../services/sos';
import { getLocation } from '../services/location';
import FloatingSOSButton, { SOS_DOCK_MAX_WIDTH } from '../components/FloatingSOSButton';
import { t, initLang, useLang, perLang } from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, themeColors } from '../constants/theme';
import { getCoreProgress, consumePendingRoute, prefetchRights, type CourtDatesList } from '../services/corePath';
import { getUserState } from '../utils/userState';
import * as secureStorage from '../utils/secureStorage';
import { isScreenEnabled, tileScreen } from '../constants/features';

// Tiles ordered by most urgent / most used first
// Bail Bond Help and Find Lawyer are top-left -- zero ambiguity
// Labels use plain 3rd-grade functional language -- what the button DOES, not what it IS
// `label` is the English reference; the tile shows t(`home_tile_${key}`) (es/pt/vi in i18n/*.json).
// `roles`: shown only to those roles (the attorney dashboard sends everyone else straight back).
const ATTORNEY_ROLES = ['attorney', 'defender', 'admin'];
// `flag`: shown only when that server feature is on for this person (custody alerts; shared bonds when at least one is shared).
interface Tile { key: string; icon: IconName; label: string; nav: string; bg: string; color: string; primary: boolean; roles?: string[]; flag?: 'custody' | 'recovery' }
const TILES = perLang((): Tile[] => {
  const c = themeColors();
  return [
  { key: 'Emergency', label: t('home_tile_Emergency'), icon: ICONS.location, color: c.textBrand, bg: c.bgCard, nav: 'More:HelpNow',   primary: false },
  // ── Primary 4 -- the core path (Oct 26 2026): rights → help → court dates → clear my record ──
  { key: 'Rights',    label: t('home_tile_Rights'),     icon: ICONS.rights, color: c.textBrand,      bg: c.bgCard, nav: 'RightsTab',      primary: true },
  { key: 'GetHelp',   label: t('home_tile_GetHelp'),    icon: ICONS.lawyer, color: c.legal,     bg: c.legalBg, nav: 'HelpTab',        primary: true },
  { key: 'CourtDates',label: t('home_tile_CourtDates'), icon: ICONS.calendar, color: c.info,    bg: c.bgCard, nav: 'CourtTab',       primary: true },
  { key: 'Expunge',   label: t('home_tile_Expunge'),    icon: ICONS.clean, color: c.legal,     bg: c.legalBg, nav: 'More:Expungement', primary: true },
  { key: 'Bail',      label: t('home_tile_Bail'),    icon: ICONS.bail, color: c.bail,      bg: c.bgCard, nav: 'More:Bail',      primary: false },  // more-bail-search-link testID: 'more-bail-search-link',
  { key: 'Lawyers',   label: t('home_tile_Lawyers'),      icon: ICONS.lawyer, color: c.legal,     bg: c.legalBg, nav: 'LawyersTab',     primary: false },
  { key: 'Chat',      label: t('home_tile_Chat'),     icon: ICONS.message, color: c.info, bg: c.bgCard, nav: 'ChatTab',        primary: false },

  // ── Contextual -- shown below primary, relevant to most users ────────────────
  { key: 'WhatNext',  label: t('home_tile_WhatNext'), icon: ICONS.clipboard, color: c.textBrand,      bg: c.bgCard, nav: 'More:WhatHappensNext', primary: false },
  { key: 'Cases',     label: t('home_tile_Cases'),           icon: ICONS.cases, color: c.info, bg: c.bgCard, nav: 'More:Cases',     primary: false },
  { key: 'court_locator',  icon: ICONS.courthouse, label: t('home_tile_court_locator'),       nav: 'More:CourtLocator',    bg: c.bgCard, color: c.info, primary: false },
  { key: 'bail_calc',      icon: ICONS.calculator, label: t('home_tile_bail_calc'),        nav: 'More:BailCalculator',  bg: c.legalBg, color: c.legal, primary: false },
  { key: 'dui_laws',       icon: ICONS.car, label: t('home_tile_dui_laws'),          nav: 'More:DUILaws',         bg: c.bgCard, color: c.textBrand, primary: false },
  { key: 'specialty_courts',icon: ICONS.courthouse, label: t('home_tile_specialty_courts'),     nav: 'More:SpecialtyCourts', bg: c.bgCard, color: c.textBrand, primary: false },
  { key: 'drug_penalties', icon: ICONS.drug, label: t('home_tile_drug_penalties'),  nav: 'More:DrugPenalties',   bg: c.bgCard, color: c.textBrand, primary: false },
  // ── Extended features — professional / specialty ──────────────────────────
  { key: 'Advocacy',      icon: ICONS.speak, label: t('home_tile_Advocacy'),     nav: 'More:Advocacy',              bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'ArrestMonitor', icon: ICONS.notification, label: t('home_tile_ArrestMonitor'),          nav: 'More:ArrestMonitor',         bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'AttyDash',      icon: ICONS.lawyer, label: t('home_tile_AttyDash'),     nav: 'More:AttorneyDashboard',     bg: c.legalBg, color: c.legal, primary: false, roles: ATTORNEY_ROLES },
  { key: 'CheckIn',       icon: ICONS.checkOutline, label: t('home_tile_CheckIn'),       nav: 'More:CheckIn',               bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'Diversion',     icon: ICONS.diversion, label: t('home_tile_Diversion'),     nav: 'More:Diversion',             bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'FamilyConn',    icon: ICONS.family, label: t('home_tile_FamilyConn'),         nav: 'More:FamilyConnect',         bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'CustodyAlerts', icon: ICONS.notification, label: t('home_tile_CustodyAlerts'), nav: 'More:CustodyAlerts',       bg: c.bgCard, color: c.textBrand,   primary: false, flag: 'custody' },
  { key: 'RecoveryShares',icon: ICONS.briefcase, label: t('home_tile_RecoveryShares'),   nav: 'More:RecoveryShares',        bg: c.bgCard, color: c.textBrand,   primary: false, flag: 'recovery' },
  { key: 'FamilyCourt',   icon: ICONS.courthouse, label: t('home_tile_FamilyCourt'),           nav: 'More:FamilyCourt',           bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'FirmAcq',       icon: ICONS.firm, label: t('home_tile_FirmAcq'),       nav: 'More:FirmAcquisition',       bg: c.bgCard, color: c.textBrand,   primary: false, roles: ATTORNEY_ROLES },
  { key: 'HousingRts',    icon: ICONS.housing, label: t('home_tile_HousingRts'),         nav: 'More:HousingRights',         bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'Immigration',   icon: ICONS.immigration, label: t('home_tile_Immigration'),nav: 'More:ImmigrationConsequences',bg: c.bgCard, color: c.textBrand,  primary: false },
  { key: 'Interrogation', icon: ICONS.record, label: t('home_tile_Interrogation'),   nav: 'More:InterrogationRecorder', bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'JuvenileJ',     icon: ICONS.juvenile, label: t('home_tile_JuvenileJ'),       nav: 'More:JuvenileJustice',       bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'MentalHealth',  icon: ICONS.mentalHealth, label: t('home_tile_MentalHealth'), nav: 'More:MentalHealthDiversion', bg: c.bgCard, color: c.textBrand,  primary: false },
  { key: 'Resources',     icon: ICONS.library, label: t('home_tile_Resources'),        nav: 'More:Resources',             bg: c.bgCard, color: c.textBrand,   primary: false },
  { key: 'Search',        icon: ICONS.search, label: t('home_tile_Search'),      nav: 'More:Search',                bg: c.bgCard, color: c.textBrand,   primary: false },

  // ── Bar Exam Prep ─────────────────────────────────────────────────────────
  { key: 'BarPrep',       icon: ICONS.book, label: t('home_tile_BarPrep'),           nav: 'More:BarPrepHome',           bg: c.legalBg, color: c.legal, primary: false },
];
});

/** Local calendar day 'YYYY-MM-DD'. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Whole days from one 'YYYY-MM-DD' to another (null when either is not a date). */
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from || ''); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to || '');
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}

function HomeScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang(); // re-render in the chosen language
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
  return () => { mountedRef.current = false; };
  }, []);

  // Plans card: the cheapest consumer plan from the server price list, hidden
  // when the signed-in person already has a paid plan (server says `paid`).
  const [isPro, setIsPro] = useState(false);
  const [cheapest, setCheapest] = useState<ConsumerPlan | null>(null);
  useEffect(() => {
    api.get('/billing/tiers', { params: { audience: 'consumer' } })
      .then(r => {
        const plans = consumerPlansFrom(r.data).sort((a, b) => a.monthlyCents - b.monthlyCents);
        if (mountedRef.current) setCheapest(plans[0] || null);
      }).catch(() => {});
    secureStorage.getToken().then(token => {
      if (!token) return;
      return api.get('/billing/subscription').then(r => {
        if (mountedRef.current) setIsPro(!!r.data?.subscription?.paid);
      });
    }).catch(() => {});
  }, []);

  const [refreshing, setRefreshing] = React.useState(false);
  const [bailCardKey, setBailCardKey] = useState(0);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [displayName, setDisplayName] = useState('');
  const [sosSending, setSosSending]   = useState(false);
  const [legalTip, setLegalTip]       = useState('');
  const [tipCategory, setTipCategory] = useState('');
  const [tipQuery, setTipQuery]       = useState('');
  const [visitCount, setVisitCount]   = useState(0);

  const [coreStep, setCoreStep] = useState(1);
  // Core path: resume where the person left off; open a screen queued before the
  // main tabs existed (first screen after install); keep the rights card offline-ready.
  useEffect(() => {
    const refresh = () => {
      getCoreProgress().then(p => { if (mountedRef.current) setCoreStep(p.done.rights || p.done.help || p.current > 1 ? p.current : 1); }).catch(() => {});
    };
    refresh();
    const unsub = (navigation as any)?.addListener?.('focus', () => { refresh(); setBailCardKey(k => k + 1); });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation]);
  useEffect(() => {
    consumePendingRoute().then(p => {
      if (p && mountedRef.current) (navigation as any).navigate('MoreTab', { screen: p.screen, params: p.params });
    }).catch(() => {});
    getUserState().then(st => prefetchRights(st?.code)).catch(() => {});
  }, [navigation]);

  const [nearbyCounts, setNearbyCounts] = useState<{bail?: number; lawyers?: number}>({});
  const [upcomingCase, setUpcomingCase] = useState<{ id: number; title: string; daysLeft: number } | null>(null);
  const [role, setRole] = useState('');
  // Server features behind settings (custody alerts ⚖, recovery sharing ⚖): their menu entries
  // show only when the server says the feature is on — and shared bonds only when one is shared.
  const [flags, setFlags] = useState<{ custody: boolean; recovery: boolean }>({ custody: false, recovery: false });

  // Pull-to-refresh and mount loader
  const loadAll = React.useCallback(async () => {
    // Load all home data; show skeleton until primary data arrives
    const primaryFetches: Promise<unknown>[] = [];

    // Court date countdown — the next hearing within 30 days. Days are counted
    // between calendar dates in the person's own time zone (the server's
    // `today`), never from a UTC-midnight timestamp.
    primaryFetches.push(
      secureStorage.getToken().then(token => {
        if (!token) { if (mountedRef.current) setUpcomingCase(null); return; }
        return api.get<CourtDatesList>('/court-dates').then(res => {
          const today = res.data?.today || localDay(new Date());
          const next = (res.data?.upcoming || [])
            .map(cd => ({ id: cd.id, title: cd.case_title || t('home_your_case'), daysLeft: daysBetween(today, cd.court_date) }))
            .filter(c => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 30)
            .sort((a, b) => Number(a.daysLeft) - Number(b.daysLeft))[0];
          if (mountedRef.current) setUpcomingCase(next ? { id: next.id, title: next.title, daysLeft: Number(next.daysLeft) } : null);
        });
      }).catch(() => {})
    );

    secureStorage.getToken().then(async token => {
      if (!token) { if (mountedRef.current) setFlags({ custody: false, recovery: false }); return; }
      const [cus, rec] = await Promise.all([
        api.get<{ enabled: boolean }>('/custody/status').then(r => r.data?.enabled === true).catch(() => false),
        api.get<{ shares: unknown[] }>('/recovery-shares').then(r => Array.isArray(r.data?.shares) && r.data.shares.length > 0).catch(() => false),
      ]);
      if (mountedRef.current) setFlags({ custody: cus, recovery: rec });
    }).catch(() => {});

    secureStorage.getItem('user').then(u => {
      const user = u ? (() => { try { return JSON.parse(u); } catch { return null; } })() : null;
      if (!mountedRef.current) return;
      setDisplayName(user?.displayName || user?.display_name || user?.name || '');
      setRole(String(user?.role || ''));
    }).catch(() => {});

    // Track visits for the personalised greeting (UI-only, non-critical)
    AsyncStorage.getItem('home_visit_count').then(v => {
      const n = parseInt(v || '0', 10) + 1;
      if (mountedRef.current) setVisitCount(n);
      return AsyncStorage.setItem('home_visit_count', String(n));
    }).catch(() => {});

    // Legal tip of the day
    api.get('/push/tip').then(r => {
      if (!mountedRef.current) return;
      setLegalTip(r.data?.tip || '');
      setTipCategory(r.data?.category || '');
      setTipQuery(r.data?.lesson_query || '');
    }).catch(() => {});

    // Nearby counts on the Bail / Lawyer tiles (non-blocking; skipped without a location)
    getLocation({ prompt: false }).then(({ lat, lng }) => {
      api.get('/providers/bail', { params: { lat, lng, radiusKm: 80 } })
        .then(r => { if (mountedRef.current) setNearbyCounts(prev => ({ ...prev, bail: Array.isArray(r.data) ? r.data.length : 0 })); })
        .catch(() => {});
      api.get('/providers/lawyers', { params: { lat, lng, limit: 20 } })
        .then(r => { if (mountedRef.current) setNearbyCounts(prev => ({ ...prev, lawyers: Array.isArray(r.data) ? r.data.length : 0 })); })
        .catch(() => {});
    }).catch(() => {});

    // Resolve loading state once primary data arrives
    Promise.allSettled(primaryFetches).finally(() => {
      if (mountedRef.current) setRefreshing(false);
    });
  }, []);

  // Loaded right away, not after interactions: the SOS pulse and skeletons are
  // endless animations, so "after interactions" could mean never.
  useEffect(() => {
    initLang();
    loadAll();
  }, [loadAll]);

  const sendQuickSOS = async () => {
    const active = await activeContacts();
    if (active.length === 0) {
      confirm(t('home_sos_none_title'), t('home_sos_none_body'),
        { confirmLabel: t('home_sos_add') }).then(ok => { if (ok) (navigation as any).navigate('MoreTab', { screen: 'Contacts' }); });
      return;
    }
    const ok = await confirm(t('home_sos_title'), t('home_sos_body', { n: active.length }), { confirmLabel: t('home_sos_send') });
    if (!ok) return;
    setSosSending(true);
    try {
      await reportSosResult(await sendSos(active, t('home_sos_reason')), confirm, showToast);
    } finally { if (mountedRef.current) setSosSending(false); }
  };

  const navigate = (nav: string) => {
    if (nav.startsWith('More:')) {
      (navigation as any).navigate('MoreTab', { screen: nav.slice(5) });
    } else {
      (navigation as any).navigate(nav);
    }
  };

  return (
    <View testID="home-screen" style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoMark}>
            <JTBLogo size={40} />
          </View>
          <View style={styles.headerText}>
            <Text maxFontSizeMultiplier={1.4} style={styles.brand} numberOfLines={1}>{t('app_name')}</Text>
            {!!displayName
              ? <Text maxFontSizeMultiplier={1.4} style={styles.welcome} numberOfLines={2}>{
                  visitCount <= 1
                    ? t('home_welcome_1', { name: displayName })
                    : visitCount <= 5
                    ? t('home_welcome_2', { name: displayName })
                    : t('home_welcome_3', { name: displayName })
                }</Text>
              : <Text maxFontSizeMultiplier={1.4} style={styles.welcome} numberOfLines={2}>{
                  visitCount <= 1
                    ? t('home_sub_1')
                    : visitCount <= 5
                    ? t('home_sub_2')
                    : t('home_sub_3')
                }</Text>
            }
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            accessibilityLabel={t('home_settings_a11y')} onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Settings' })}
            style={styles.settingsBtn}
          >
            <AppIcon name={ICONS.settings} size={22} color={COLORS.steel} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); setBailCardKey(k => k + 1); loadAll(); }}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
      >
        {/* ── "Just arrested?" core path — first thing on Home ───────────── */}
        <TouchableOpacity
          accessibilityRole="button"
          testID="home-just-arrested"
          accessibilityLabel={`${t('ja_title')} ${coreStep > 1 ? t('home_core_continue_a11y', { n: coreStep }) : t('home_core_start_a11y')}`}
          style={styles.coreCard}
          onPress={() => (navigation as any).navigate('MoreTab', { screen: 'JustArrested' })}
          activeOpacity={0.85}
        >
          <View style={styles.coreTitleRow}>
            <AppIcon name={ICONS.emergency} size={26} color={colors.white} />
            <Text maxFontSizeMultiplier={1.3} style={styles.coreTitle}>{t('ja_title')}</Text>
          </View>
          {[t('ja_s1'), t('ja_s2'), t('ja_s3')].map((label, i) => (
            <Text key={label} maxFontSizeMultiplier={1.3} style={styles.coreStep}>{i + 1}) {label}</Text>
          ))}
          <Text maxFontSizeMultiplier={1.3} style={styles.coreCta}>
            {coreStep > 1 ? `${t('home_core_continue')} — ${t('ja_step_of', { n: coreStep })} →` : `${t('home_core_start')} →`}
          </Text>
        </TouchableOpacity>

        {/* "Your bail agent" — only when a bail agent's check-in enrollment is linked to this account */}
        <BailAgentCard refreshKey={bailCardKey}
          onVerifyPhone={() => (navigation as any).navigate('MoreTab', { screen: 'VerifyPhone' })}
          onCheckIn={(enrollmentId) => (navigation as any).navigate('MoreTab', { screen: 'CheckIn', params: { enrollmentId } })} />

        {/* Emergency banner -- prominent, always first */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          testID="home-emergency-screen"
          style={styles.rowCard}
          onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Emergency' })}
          activeOpacity={0.85}
        >
          <View style={styles.rowIconWrap}>
            <AppIcon name={ICONS.notification} size={20} color={colors.textBrand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencyTitle}>{t('home_emergency_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencySub}>{t('home_emergency_sub')}</Text>
          </View>
          <AppIcon name={ICONS.chevronRight} size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Quick Connect -- prominent package banner */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          testID="home-quick-connect"
          style={styles.rowCard}
          onPress={() => (navigation as any).navigate('MoreTab', { screen: 'QuickConnect' })}
          activeOpacity={0.85}
        >
          <View style={styles.quickConnectLeft}>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectTag}>{t('home_qc_tag')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectTitle}>{t('x_nav_quick_connect')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectSub}>{t('home_qc_sub')}</Text>
          </View>
          <View style={styles.quickConnectRight}>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectPrice}>$20</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectPriceSub}>{t('home_qc_total')}</Text>
          </View>
        </TouchableOpacity>

        {/* Court date countdown -- high urgency, daily re-engagement */}
        {upcomingCase && (
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[
              styles.courtCountdown,
              upcomingCase.daysLeft <= 3
                ? { backgroundColor: colors.emergencyDark, borderColor: colors.emergencyDark }
                : upcomingCase.daysLeft <= 7
                ? { backgroundColor: colors.navyMid, borderColor: colors.gold }
                : { backgroundColor: COLORS.navy, borderColor: COLORS.steel },
            ]}
            testID="home-court-countdown"
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'CourtDateDetail', params: { id: upcomingCase.id } })}
            activeOpacity={0.88}
            accessibilityLabel={t('home_court_a11y', { n: upcomingCase.daysLeft })}
          >
            <View style={styles.courtCountdownLeft}>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownNum}>{upcomingCase.daysLeft}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownUnit}>
                {upcomingCase.daysLeft === 1 ? t('home_court_day') : t('home_court_days')}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownTitle}>
                {upcomingCase.daysLeft === 0 ? t('home_court_today')
                  : upcomingCase.daysLeft <= 3 ? t('home_court_soon')
                  : t('home_court_upcoming')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownCase} numberOfLines={1}>
                {upcomingCase.title}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownArrow}>›</Text>
          </TouchableOpacity>
        )}

          {/* Plans card for people without a paid plan (below the emergency cards, so
              an upsell never comes before help, and its late load can't push them down). Price and features come from
              GET /billing/tiers (the list the server charges from); nothing is hard-coded. */}
          {!isPro && cheapest && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={t('cp_double_tap')}
              testID="home-plans-card"
              onPress={() => (navigation as any).navigate('MoreTab', { screen: 'ConsumerSubscription' })}
              style={{
                backgroundColor: colors.bgCard,
                borderRadius: 16, padding: 16,
                borderWidth: 1, borderColor: colors.border,
                marginBottom: 12,
              }}
              accessibilityLabel={t('home_plans_a11y', { price: cheapest.price })}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 }}>
                {t('home_plans_title')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.textSecond, marginBottom: 8 }}>
                {cheapest.features.map(featureLabel).join(' · ')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.textBrand, fontWeight: '600' }}>
                {t('home_plans_from', { price: cheapest.price })}
              </Text>
            </TouchableOpacity>
          )}

        {/* Legal Tip of the Day */}
        {!!legalTip && (
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={styles.tipCard}
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Education', params: { category: tipCategory, query: tipQuery } })}
            activeOpacity={0.85}
          >
            <View style={styles.tipLeft}>
              <Text maxFontSizeMultiplier={1.4} style={styles.tipLabel}>{t('home_tip_label')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.tipText} numberOfLines={2}>{legalTip}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.tipArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Section label */}
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('home_quick_access')}</Text>

        {/* Tile grid */}
        <View style={styles.grid}>
          {TILES().filter(tile => (!tile.roles || tile.roles.includes(role)) && (!tile.flag || flags[tile.flag]) && isScreenEnabled(tileScreen(tile.nav), role))
            // the square primary tiles first, then the compact two-column rows
            .sort((a, b) => Number(b.primary) - Number(a.primary)).map(tile => (
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              accessibilityLabel={t(`home_tile_${tile.key}`).replace(/\n/g, ' ')}
              key={tile.key}
              testID={`tile-${tile.key}`}
              style={[styles.tile, { backgroundColor: tile.bg }, tile.primary ? styles.tileLg : styles.tileSm]}
              onPress={() => navigate(tile.nav)}
              activeOpacity={0.75}
            >
              <AppIcon name={tile.icon} size={tile.primary ? 28 : 22} color={tile.color} />
              <View style={styles.tileText}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.tileLabel, tile.primary ? styles.tileLabelLg : styles.tileLabelSm, { color: tile.color }]}>{t(`home_tile_${tile.key}`)}</Text>
                {tile.key === 'Bail' && nearbyCounts.bail != null && nearbyCounts.bail > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: tile.color }]}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.countBadgeText}>{t('home_near_you', { n: nearbyCounts.bail })}</Text>
                  </View>
                )}
                {tile.key === 'Lawyers' && nearbyCounts.lawyers != null && nearbyCounts.lawyers > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: tile.color }]}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.countBadgeText}>{t('home_near_you', { n: nearbyCounts.lawyers })}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign-in nudge -- shown to browsing (guest) users */}
        {visitCount > 1 && !!displayName && (
          <View style={styles.returningCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.returningText}>
              {visitCount === 2
                ? t('home_return_2')
                : visitCount <= 5
                ? t('home_return_5')
                : t('home_return_n')}
            </Text>
          </View>
        )}

        {!displayName && (
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={styles.nudgeCard}
            testID="home-create-account"
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Register' })}
            activeOpacity={0.85}
          >
            <AppIcon name={ICONS.user} size={20} color={colors.textBrand} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.nudgeTitle}>{t('ja_create')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.nudgeSub}>{t('home_nudge_sub')}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.nudgeArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Footer tagline */}
        <View style={styles.footerCard}>
          <JTBLogo size={32} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '800', color: colors.textOnNavy, marginBottom: 2 }}>
              {t('home_footer_innocent')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.footerTitle}>{t('home_footer_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.footerSub}>{t('home_footer_sub')}</Text>
          </View>
        </View>
      </ScrollView>

      <FloatingSOSButton onPress={sendQuickSOS} sending={sosSending}>
        <EmergencyStrip inset compact={false} />
      </FloatingSOSButton>
    </View>

  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  coreCard: { backgroundColor: colors.emergencyDark, borderRadius: 16, padding: 16, marginBottom: 14, minHeight: 56 },
  coreTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  coreTitle: { color: colors.white, fontSize: 24, fontWeight: '900', flexShrink: 1 },
  coreStep: { color: colors.white, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  coreCta: { color: colors.white, fontSize: 15, fontWeight: '900', marginTop: 8, textDecorationLine: 'underline' },
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: COLORS.steel },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  headerText: { flex: 1, minWidth: 0 },
  logoMark: { width: 42, height: 42, borderRadius: RADIUS.sm, overflow: 'hidden' },
  brand: { fontSize: 20, ...FONTS.black, color: colors.textOnNavy, letterSpacing: 0.3 },
  welcome: { fontSize: 12, ...FONTS.medium, color: COLORS.steel, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 },
  settingsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  settingsIcon: { fontSize: 20 },

  // The SOS dock sits below the ScrollView (its own lane), so the content needs
  // no extra room for it; the column is capped so desktop is not stretched.
  scroll: { padding: 16, paddingBottom: 24, width: '100%', maxWidth: SOS_DOCK_MAX_WIDTH, alignSelf: 'center' },

  rowCard: {
    backgroundColor: colors.bgCard,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border,
    padding: 14, minHeight: 64,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 12 },
  rowIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgSubtle,
    alignItems: 'center', justifyContent: 'center' },
  emergencyTitle: { color: colors.textPrimary, ...FONTS.heavy, fontSize: 15,
    lineHeight: 22 },
  emergencySub:   { color: colors.textSecond, fontSize: 12, lineHeight: 17, marginTop: 2 },

  sectionLabel: {
    fontSize: 11, ...FONTS.black, color: colors.textSecond,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  // Quick access: two columns of icon + label rows. The four primary tiles
  // (bail, lawyer, rights, AI help) come first and are taller with a larger
  // icon; the rest are compact rows — no big squares. All use the theme's
  // card surface with a hairline border so they read in dark mode.
  tile: {
    width: '48%', borderRadius: RADIUS.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border,
    ...SHADOW.sm },
  tileLg: { minHeight: 76 },
  tileText:  { flex: 1, minWidth: 0 },
  tileLabel: { ...FONTS.black, textAlign: 'left' },
  tileLabelLg: { fontSize: 15, lineHeight: 19 },
  tileLabelSm: { fontSize: 13, lineHeight: 17 },

  countBadge: {
    alignSelf: 'flex-start', marginTop: 3, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, backgroundColor: COLORS.navy },
  countBadgeText: { color: colors.bg, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  quickConnectLeft:  { flex: 1 },
  quickConnectTag:   { fontSize: 11, ...FONTS.bold, color: colors.textSecond, letterSpacing: 0.5, marginBottom: 2 },
  quickConnectTitle: { fontSize: 16, ...FONTS.heavy, color: colors.textPrimary, marginBottom: 2 },
  quickConnectSub:   { fontSize: 12, ...FONTS.medium, color: colors.textSecond },
  quickConnectRight: { alignItems: 'center', marginLeft: 12 },
  quickConnectPrice: { fontSize: 22, ...FONTS.black, color: colors.textPrimary, lineHeight: 26 },
  quickConnectPriceSub: { fontSize: 11, color: colors.textSecond, ...FONTS.medium },
  footerCard: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    ...SHADOW.sm },
  returningCard: {
    backgroundColor: COLORS.navy + '0D', borderRadius: 8, padding: 10,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: COLORS.steel },
  returningText: { fontSize: 12, color: colors.textSecond, lineHeight: 17 },
  tipCard: {
    backgroundColor: colors.bg,
    borderRadius: 12, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderLeftWidth: 3, borderLeftColor: COLORS.steel,
    shadowColor: COLORS.navy, shadowOpacity: 0.05,
    shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tipLeft:  { flex: 1 },
  tipLabel: { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.info, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 },
  tipText:  { fontSize: 12, color: colors.textBrand, lineHeight: 18, fontFamily: 'Inter_500Medium', fontWeight: '500' },
  tipArrow: { fontSize: 20, color: colors.info, fontWeight: '300' },
  nudgeCard: {
    backgroundColor: colors.bg,
    borderRadius: 14, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: colors.border,
    shadowColor: COLORS.navy, shadowOpacity: 0.06,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  nudgeIcon:  { fontSize: 22 },
  nudgeTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 2 },
  nudgeSub:   { fontSize: 11, color: colors.info },
  nudgeArrow: { fontSize: 22, color: colors.textBrand, fontWeight: '300' },
  footerTitle: { fontSize: 12, lineHeight: 20, ...FONTS.bold, color: colors.textOnNavy },
  footerSub:   { fontSize: 11, color: COLORS.steel, marginTop: 2 },
  courtCountdown: {
    borderRadius: RADIUS.xl, padding: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1.5, ...SHADOW.md },
  courtCountdownLeft: { alignItems: 'center', minWidth: 44 },
  courtCountdownNum:  { fontSize: 32, ...FONTS.black, color: colors.textOnNavy, lineHeight: 34 },
  courtCountdownUnit: { fontSize: 11, ...FONTS.bold, color: colors.textOnNavy, textTransform: 'uppercase' },
  courtCountdownTitle:{ fontSize: 12, lineHeight: 20, ...FONTS.black, color: colors.textOnNavy, marginBottom: 2 },
  courtCountdownCase: { fontSize: 11, color: colors.textOnNavy },
  courtCountdownArrow:{ fontSize: 28, color: colors.textOnNavy, ...FONTS.medium },
  tileUnreadBadge:     { position: 'absolute', top: -4, right: -4, backgroundColor: colors.emergency,
    borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3 },
  tileUnreadBadgeText: { color: colors.bg, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900' },
  tileSm: { minHeight: 56 },

});
export default React.memo(HomeScreen);