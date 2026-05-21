import EmergencyStrip from '../components/EmergencyStrip';
import React, { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { getContacts } from '../services/storage';
import { getLocation } from '../services/location';
import FloatingSOSButton from '../components/FloatingSOSButton';
import { t, initLang } from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import NetInfo from '@react-native-community/netinfo';
import * as secureStorage from '../utils/secureStorage';

declare var JusticeGavelLogo: any;
// Tiles ordered by most urgent / most used first
// Bail Bond Help and Find Lawyer are top-left -- zero ambiguity
// Labels use plain 3rd-grade functional language -- what the button DOES, not what it IS
const TILES = [
  { key: 'just_arrested', icon: '🚨', label: 'Just Arrested?\nTap Here Now', nav: 'More:JustArrested', bg: COLORS.emergency, color: COLORS.surface, primary: true },
  { key: 'Emergency', label: 'Emergency\nHelp Now', icon: '🆘', color: COLORS.emergency, bg: COLORS.errorBg, nav: 'More:HelpNow',   primary: false },
  // ── Primary 4 -- always visible -- answer: "what do you need right now?" ──────
  // Ordered by urgency. Most people arriving at this app need these in order.
  { key: 'Bail',      label: 'Get Out\nOf Jail',    icon: '🔓', color: COLORS.bail,      bg: COLORS.bgCard, nav: 'More:Bail',      primary: true },
  { key: 'Lawyers',   label: 'Find a\nLawyer',      icon: '⚖️', color: COLORS.legal,     bg: COLORS.legalBg, nav: 'LawyersTab',     primary: true },
  { key: 'Rights',    label: 'Know My\nRights',     icon: '✊', color: COLORS.navy,      bg: COLORS.bgCard, nav: 'More:Education', primary: true },
  { key: 'Chat',      label: 'Ask a\nQuestion',     icon: '💬', color: COLORS.steel, bg: COLORS.bgCard, nav: 'ChatTab',        primary: true },

  // ── Contextual -- shown below primary, relevant to most users ────────────────
  { key: 'WhatNext',  label: 'What Happens\nNext?', icon: '📋', color: COLORS.navy,      bg: COLORS.bgCard, nav: 'More:WhatHappensNext', primary: false },
  { key: 'Cases',     label: 'My\nCases',           icon: '📁', color: COLORS.steel, bg: COLORS.bgCard, nav: 'HomeTab',        primary: false },
  { key: 'Expunge',   label: 'Clear My\nRecord',    icon: '🗂️', color: COLORS.legal,     bg: COLORS.legalBg, nav: 'More:Expungement', primary: false },
  { key: 'court_locator',  icon: '🏛️', label: 'Find\nCourthouse',       nav: 'More:CourtLocator',    bg: COLORS.bgCard, color: COLORS.blue, primary: false },
  { key: 'bail_calc',      icon: '💰', label: 'Bail\nCalculator',        nav: 'More:BailCalculator',  bg: COLORS.legalBg, color: COLORS.legal, primary: false },
  { key: 'dui_laws',       icon: '🚗', label: 'DUI\nLaw Guide',          nav: 'More:DUILaws',         bg: COLORS.errorBg, color: COLORS.emergency, primary: false },
  { key: 'specialty_courts',icon: '⚖️', label: 'Specialty\nCourts',     nav: 'More:SpecialtyCourts', bg: COLORS.bgCard, color: COLORS.navy, primary: false },
  { key: 'drug_penalties', icon: '💊', label: 'Drug Charge\nPenalties',  nav: 'More:DrugPenalties',   bg: COLORS.bgCard, color: COLORS.navy, primary: false },
  // ── Extended features — professional / specialty ──────────────────────────
  { key: 'Advocacy',      icon: '📢', label: 'Policy\n& Advocacy',     nav: 'More:Advocacy',              bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'ArrestMonitor', icon: '🔔', label: 'Arrest\nAlerts',          nav: 'More:ArrestMonitor',         bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'AttyDash',      icon: '⚖️', label: 'Attorney\nDashboard',     nav: 'More:AttorneyDashboard',     bg: COLORS.legalBg, color: COLORS.legal, primary: false },
  { key: 'CheckIn',       icon: '✅', label: 'Check-In\nManager',       nav: 'More:CheckIn',               bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'Diversion',     icon: '🔄', label: 'Diversion\nPrograms',     nav: 'More:Diversion',             bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'FamilyConn',    icon: '👨‍👩‍👧', label: 'Family\nConnect',         nav: 'More:FamilyConnect',         bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'FamilyCourt',   icon: '🏛️', label: 'Family\nCourt',           nav: 'More:FamilyCourt',           bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'FirmAcq',       icon: '🏢', label: 'Firm\nAcquisition',       nav: 'More:FirmAcquisition',       bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'HousingRts',    icon: '🏠', label: 'Housing\nRights',         nav: 'More:HousingRights',         bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'Immigration',   icon: '🛂', label: 'Immigration\nConsequences',nav: 'More:ImmigrationConsequences',bg: COLORS.bgCard, color: COLORS.navy,  primary: false },
  { key: 'Insurance',     icon: '🛡️', label: 'Legal\nInsurance',        nav: 'More:Insurance',             bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'Interrogation', icon: '🎙️', label: 'Record\nInterrogation',   nav: 'More:InterrogationRecorder', bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'JuvenileJ',     icon: '🧒', label: 'Juvenile\nJustice',       nav: 'More:JuvenileJustice',       bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'MentalHealth',  icon: '🧠', label: 'Mental Health\nDiversion', nav: 'More:MentalHealthDiversion', bg: COLORS.bgCard, color: COLORS.navy,  primary: false },
  { key: 'Resources',     icon: '📚', label: 'Legal\nResources',        nav: 'More:Resources',             bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
  { key: 'Search',        icon: '🔍', label: 'Search\nEverything',      nav: 'More:Search',                bg: COLORS.bgCard, color: COLORS.navy,   primary: false },
];

export default function HomeScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Network status -- passive detection, no permissions needed

  // Subscription tier for analytics preview
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('user_subscription')
      .then(tier => setIsPro(!!tier && tier !== 'free'))
      .catch(() => {});
  }, []);
  const [isOffline, setIsOffline] = React.useState(false);
  React.useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
    });
    return unsub;  // cleanup on unmount
  }, []);

  const [refreshing, setRefreshing] = React.useState(false);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [recentCases, setRecentCases] = React.useState<Record<string, unknown>[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [sosSending, setSosSending]   = useState(false);
  const [legalTip, setLegalTip]       = useState('');
  const [tipCategory, setTipCategory] = useState('');
  const [tipQuery, setTipQuery]       = useState('');
  const [visitCount, setVisitCount]   = useState(0);

  const [nearbyCounts, setNearbyCounts] = useState<{bail?: number; lawyers?: number}>({});
  const [upcomingCase, setUpcomingCase] = useState<{title:string; date:string; daysLeft:number} | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initLang();
    loadAll();
  }, []);

  // Pull-to-refresh and mount loader
  const loadAll = React.useCallback(async () => {
    // Load all home data; show skeleton until primary data arrives
    const primaryFetches: Promise<unknown>[] = [];

    // Load recent cases for quick re-entry
    primaryFetches.push(
      api.get('/cases').then(res => {
        if (Array.isArray(res.data)) setRecentCases((res.data || []).slice(0, 2));
      }).catch(() => {})
    );
    AsyncStorage.getItem('user').then(u => {
      if (u) { const user = JSON.parse(u); setDisplayName(user.displayName || user.name || ''); }
    }).catch(() => {});
    // Unread message badge
    secureStorage.getToken().then(t => {
      if (!t) return;
      api.get('/messages/unread/count')
        .then(r => setUnreadMessages(r.data?.count || 0))
        .catch(() => {});
    }).catch(() => {});

    // Court date countdown -- fetch soonest upcoming case
    secureStorage.getToken().then(token => {
      if (!token) return;
      api.get('/cases').then(res => {
        const open = (res.data || []).filter((ca: Record<string,unknown>) => ca.next_court_date);
        if (!open.length) return;
        const sorted = open.sort((a: Record<string,unknown>, b: Record<string,unknown>) =>
          new Date(String(a.next_court_date ?? 0)).getTime() - new Date(String(b.next_court_date ?? 0)).getTime());
        const next = sorted[0];
        const diff = Math.ceil((new Date(next.next_court_date).getTime() - Date.now()) / 86400000);
        if (diff >= 0 && diff <= 30) setUpcomingCase({ title: next.title, date: next.next_court_date, daysLeft: diff });
      }).catch(() => {});
    }).catch(() => {});

    // Track visits for personalised greeting
    (async () => {
      try {
        const v = await AsyncStorage.getItem('home_visit_count');
        const n = parseInt(v || '0') + 1;
        setVisitCount(n);
        await AsyncStorage.setItem('home_visit_count', String(n));
      } catch {} // Non-critical — visit count is UI-only
    })();
    // Fetch legal tip of the day
    api.get('/push/tip').then(r => {
      setLegalTip(r.data?.tip || '');
      setTipCategory(r.data?.category || '');
      setTipQuery(r.data?.lesson_query || '');
    }).catch((e) => { __DEV__ && console.warn(e?.message); });
    // Fetch nearby counts to show on tiles (non-blocking — doesn't gate loading)
    import('../services/location').then(({ getLocation }) => {
      getLocation().then(({ lat, lng }) => {
        api.get('/providers/bail', { params: { lat, lng, radiusKm: 80 } })
          .then(r => setNearbyCounts(prev => ({ ...prev, bail: r.data?.length ?? 0 })))
          .catch(() => {});
        api.get('/providers/lawyers', { params: { lat, lng, limit: 20 } })
          .then(r => setNearbyCounts(prev => ({ ...prev, lawyers: r.data?.length ?? 0 })))
          .catch(() => {});
      }).catch(() => {});
    });

    // Resolve loading state once primary data arrives
    Promise.allSettled(primaryFetches).finally(() => {
      if (mountedRef.current) { setIsLoading(false); setRefreshing(false); }
    });
  }, []);

  const sendQuickSOS = async () => {
    const contacts = await getContacts();
    const active = (contacts as string[]).filter((c: string) => c?.trim());
    if (active.length === 0) {
      Alert.alert(
        'No emergency contacts',
        'Add contacts so they can be alerted when you need help.',
        [
          { text: 'Add Now', onPress: () => (navigation as any).navigate('MoreTab', { screen: 'Contacts' }) },
          { text: 'Later', style: 'cancel' },
        ]
      );
      return;
    }
    Alert.alert('Send SOS?', `This will alert ${active.length} contact(s) with your location.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send now', style: 'destructive', onPress: async () => {
        setSosSending(true);
        try {
          const { lat, lng } = await getLocation();
          const userData = await AsyncStorage.getItem('user');
          const user = userData ? JSON.parse(userData) : {};
          await api.post('/alerts', { userName: user.displayName || user.name || 'User', contacts: active, lat, lng });
          Alert.alert('Alert sent!', 'Your emergency contacts have been notified.');
        } catch (e: any) {
          Alert.alert('Could not send', e.message || 'Check your connection and try again.');
        } finally { setSosSending(false); }
      }}
    ]);
  };

  const navigate = (nav: string) => {
    if (nav.startsWith('More:')) {
      (navigation as any).navigate('MoreTab', { screen: nav.slice(5) });
    } else {
      (navigation as any).navigate(nav);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoMark}>
            <JusticeGavelLogo size={40} />
          </View>
          <View>
            <Text maxFontSizeMultiplier={1.4} style={styles.brand}>Justice Gavel</Text>
            {!!displayName
              ? <Text maxFontSizeMultiplier={1.4} style={styles.welcome}>{
                  visitCount <= 1
                    ? `Welcome, ${displayName}`
                    : visitCount <= 5
                    ? `Good to see you, ${displayName}`
                    : `Welcome back, ${displayName}`
                }</Text>
              : <Text maxFontSizeMultiplier={1.4} style={styles.welcome}>{
                  visitCount <= 1
                    ? 'Find bail & legal help fast'
                    : visitCount <= 5
                    ? 'Your legal companion'
                    : 'Welcome back'
                }</Text>
            }
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.helpNowBtn}
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'HelpNow' })}
            accessibilityRole="button"
            accessibilityLabel="Get help now"
            activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.helpNowBtnText}>{t('help_now')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Settings' })}
            style={styles.settingsBtn}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAll(); }}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
      >
      <EmergencyStrip compact={false} />

          {/* County analytics preview for non-Pro users — drives Intel tier subscriptions */}
          {!isPro && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => (navigation as any).navigate('MoreTab', { screen: 'ConsumerSubscription' })}
              style={{
                backgroundColor: colors.navy + '08',
                borderRadius: 16, padding: 16,
                borderWidth: 1, borderColor: colors.navy + '20',
                marginBottom: 12,
              }}
              accessibilityLabel="Unlock county arrest analytics">
              {/* Blurred stat row */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
                {[
                  { label: 'Arrests this month', value: '847' },
                  { label: 'Top charge', value: 'DUI' },
                  { label: 'Avg bail', value: '$2,400' },
                ].map(stat => (
                  <View key={stat.label}
                    style={{ flex: 1, backgroundColor: colors.bgCard, borderRadius: 10,
                      padding: 10, alignItems: 'center', opacity: 0.4 }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: colors.navy }}>
                      {stat.value}
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }}>
                      {stat.label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.navy, flex: 1 }}>
                  🔒 Unlock county arrest analytics — Intel tier
                </Text>
                <Text style={{ fontSize: 11, color: colors.navy, fontWeight: '600' }}>
                  $19.99/mo →
                </Text>
              </View>
            </TouchableOpacity>
          )}

        {/* Emergency banner -- prominent, always first */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.emergencyBanner}
          onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Emergency' })}
          activeOpacity={0.85}
        >
          <View style={styles.emergencyIconWrap}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencyIcon}>🚨</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencyTitle}>Emergency Screen</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencySub}>Alert contacts · Find help · Know your rights</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.emergencyArrow}>›</Text>
        </TouchableOpacity>

        {/* Quick Connect -- prominent package banner */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.quickConnectBanner}
          onPress={() => (navigation as any).navigate('MoreTab', { screen: 'QuickConnect' })}
          activeOpacity={0.85}
        >
          <View style={styles.quickConnectLeft}>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectTag}>ONE-TIME PACKAGE</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectTitle}>Get Help Now</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectSub}>1 Bail Bondsman  +  1 Lawyer</Text>
          </View>
          <View style={styles.quickConnectRight}>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectPrice}>$20</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.quickConnectPriceSub}>total</Text>
          </View>
        </TouchableOpacity>

        {/* Court date countdown -- high urgency, daily re-engagement */}
        {upcomingCase && (
          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.courtCountdown,
              upcomingCase.daysLeft <= 3
                ? { backgroundColor: COLORS.emergency, borderColor: COLORS.emergency }
                : upcomingCase.daysLeft <= 7
                ? { backgroundColor: COLORS.bail, borderColor: COLORS.bail }
                : { backgroundColor: COLORS.navy, borderColor: COLORS.steel },
            ]}
            onPress={() => (navigation as any).navigate('HomeTab')}
            activeOpacity={0.88}
            accessibilityLabel={`Court date in ${upcomingCase.daysLeft} days -- tap to review case`}
          >
            <View style={styles.courtCountdownLeft}>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownNum}>{upcomingCase.daysLeft}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownUnit}>
                {upcomingCase.daysLeft === 1 ? 'day' : 'days'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownTitle}>
                {upcomingCase.daysLeft === 0 ? '🚨 Court date TODAY'
                  : upcomingCase.daysLeft <= 3 ? '⚠️ Court date soon'
                  : '📅 Upcoming court date'}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownCase} numberOfLines={1}>
                {upcomingCase.title}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.courtCountdownArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Legal Tip of the Day */}
        {!!legalTip && (
          <TouchableOpacity
            style={styles.tipCard}
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Education', params: { category: tipCategory, query: tipQuery } })}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <View style={styles.tipLeft}>
              <Text maxFontSizeMultiplier={1.4} style={styles.tipLabel}>LEGAL TIP</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.tipText} numberOfLines={2}>{legalTip}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.tipArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Section label */}
        <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Quick Access</Text>

        {/* Tile grid */}
        <View style={styles.grid}>
          {TILES.map((t: any) => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t.label.replace(/\n/g, ' ')}
              key={t.key}
              style={[styles.tile, { backgroundColor: t.bg }, !t.primary && styles.tileSm]}
              onPress={() => navigate(t.nav)}
              activeOpacity={0.75}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.tileIcon}>{t.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tileLabel, { color: t.color }]}>{t.label}</Text>
              {t.key === 'Bail' && nearbyCounts.bail != null && nearbyCounts.bail > 0 && (
                <View style={[styles.countBadge, { backgroundColor: t.color }]}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.countBadgeText}>{nearbyCounts.bail} near you</Text>
                </View>
              )}
              {t.key === 'Lawyers' && nearbyCounts.lawyers != null && nearbyCounts.lawyers > 0 && (
                <View style={[styles.countBadge, { backgroundColor: t.color }]}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.countBadgeText}>{nearbyCounts.lawyers} near you</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign-in nudge -- shown to browsing (guest) users */}
        {visitCount > 1 && !!displayName && (
          <View style={styles.returningCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.returningText}>
              {visitCount === 2
                ? '👋  Glad you came back. Your legal rights are always here.'
                : visitCount <= 5
                ? '📌  Did you save a lawyer from your last search? Check My Cases.'
                : "⭐  You're a regular. Refer a friend for $5 off your next Quick Connect."}
            </Text>
          </View>
        )}

        {!displayName && (
          <TouchableOpacity
            style={styles.nudgeCard}
            onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Settings' })}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.nudgeIcon}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.nudgeTitle}>Create a free account</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.nudgeSub}>Save cases, send SOS alerts, get notifications</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.nudgeArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Footer tagline */}
        <View style={styles.footerCard}>
          <JusticeGavelLogo size={32} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '800', color: colors.navy, marginBottom: 2 }}>
              ⚖️ Innocent until proven guilty.
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.footerTitle}>Your Legal Connection</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.footerSub}>Available 24/7 · 97 cities nationwide</Text>
          </View>
        </View>
      </ScrollView>

      <FloatingSOSButton onPress={sendQuickSOS} sending={sosSending} />
      {/* Offline banner -- shown when device has no connection */}
      {isOffline && (
        <TouchableOpacity
          style={{ backgroundColor: '#FFA726', borderBottomWidth: 1, borderBottomColor: '#FFA726',
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
          onPress={() => (navigation as any).navigate('OfflineStatus')}
          accessibilityRole="button"
          accessibilityLabel="No internet connection -- tap to see what works offline"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14 }}>📡</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#FFA726' }}>
              No internet connection
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color: colors.textMuted, lineHeight: 16 }}>
              Rights card, deadline calculator, and guides still work offline
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={{ color: '#FFA726', fontSize: 12 }}>See what works →</Text>
        </TouchableOpacity>
      )}
    </View>

  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },

  header: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: COLORS.steel },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoMark: { width: 42, height: 42, borderRadius: RADIUS.sm, overflow: 'hidden' },
  brand: { fontSize: 20, ...FONTS.black, color: colors.bg, letterSpacing: 0.3 },
  welcome: { fontSize: 12, ...FONTS.medium, color: COLORS.steel, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpNowBtn: {
    backgroundColor: COLORS.emergency,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)' },
  helpNowBtnText: { color: colors.bg, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.5 },
  settingsBtn: { padding: 6 },
  settingsIcon: { fontSize: 20 },

  scroll: { padding: 16, paddingBottom: 110 },

  emergencyBanner: {
    backgroundColor: COLORS.emergency,
    borderRadius: RADIUS.xl,
    padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 20,
    ...SHADOW.md,
    shadowColor: COLORS.emergency },
  emergencyIconWrap: {
    width: 44, height: 44, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center' },
  emergencyIcon: { fontSize: 22 },
  emergencyTitle: { color: colors.bg, ...FONTS.heavy, fontSize: 15,
    lineHeight: 22 },
  emergencySub:   { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  emergencyArrow: { color: colors.bg, fontSize: 28, ...FONTS.medium },

  sectionLabel: {
    fontSize: 11, ...FONTS.black, color: COLORS.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  tile: {
    width: '31%', aspectRatio: 1, borderRadius: RADIUS.lg,
    alignItems: 'center', justifyContent: 'center', padding: 8,
    ...SHADOW.sm },
  tileIcon:  { fontSize: 22, marginBottom: 6 },
  tileLabel: { fontSize: 11, ...FONTS.black, textAlign: 'center', lineHeight: 13 },

  countBadge: {
    marginTop: 3, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, backgroundColor: COLORS.navy },
  countBadgeText: { color: colors.bg, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  quickConnectBanner: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.xl,
    padding: 16, marginBottom: 16,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.steel + '50',
    shadowColor: COLORS.navy, shadowOpacity: 0.28,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  quickConnectLeft:  { flex: 1 },
  quickConnectTag:   { fontSize: 11, ...FONTS.black, color: COLORS.steel, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  quickConnectTitle: { fontSize: 20, ...FONTS.black, color: colors.bg, marginBottom: 2 },
  quickConnectSub:   { fontSize: 12, ...FONTS.medium, color: COLORS.steel },
  quickConnectRight: { alignItems: 'center', marginLeft: 16 },
  quickConnectPrice: { fontSize: 36, ...FONTS.black, color: colors.bg, lineHeight: 40 },
  quickConnectPriceSub: { fontSize: 11, color: COLORS.steel, ...FONTS.medium },
  footerCard: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    ...SHADOW.sm },
  returningCard: {
    backgroundColor: COLORS.navy + '0D', borderRadius: 8, padding: 10,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: COLORS.steel },
  returningText: { fontSize: 12, color: COLORS.textSecond, lineHeight: 17 },
  tipCard: {
    backgroundColor: colors.bg,
    borderRadius: 12, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderLeftWidth: 3, borderLeftColor: COLORS.steel,
    shadowColor: COLORS.navy, shadowOpacity: 0.05,
    shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tipLeft:  { flex: 1 },
  tipLabel: { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.steel, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 },
  tipText:  { fontSize: 12, color: COLORS.textPrimary, lineHeight: 18, fontFamily: 'Inter_500Medium', fontWeight: '500' },
  tipArrow: { fontSize: 20, color: COLORS.steel, fontWeight: '300' },
  nudgeCard: {
    backgroundColor: colors.bg,
    borderRadius: 14, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: '#042C53' + '22',
    shadowColor: '#042C53', shadowOpacity: 0.06,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  nudgeIcon:  { fontSize: 22 },
  nudgeTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 2 },
  nudgeSub:   { fontSize: 11, color: colors.steel },
  nudgeArrow: { fontSize: 22, color: '#042C53', fontWeight: '300' },
  footerTitle: { fontSize: 12, lineHeight: 20, ...FONTS.bold, color: colors.bg },
  footerSub:   { fontSize: 11, color: COLORS.steel, marginTop: 2 },
  courtCountdown: {
    borderRadius: RADIUS.xl, padding: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1.5, ...SHADOW.md },
  courtCountdownLeft: { alignItems: 'center', minWidth: 44 },
  courtCountdownNum:  { fontSize: 32, ...FONTS.black, color: colors.bg, lineHeight: 34 },
  courtCountdownUnit: { fontSize: 11, ...FONTS.bold, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase' },
  courtCountdownTitle:{ fontSize: 12, lineHeight: 20, ...FONTS.black, color: colors.bg, marginBottom: 2 },
  courtCountdownCase: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  courtCountdownArrow:{ fontSize: 28, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },
  tileUnreadBadge:     { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF5350',
    borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3 },
  tileUnreadBadgeText: { color: colors.bg, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900' },
  tileSm: {
    width: '47%',
    paddingVertical: 16,
    minHeight: 72 },

});
