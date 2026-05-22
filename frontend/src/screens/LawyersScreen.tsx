import LawyerSkeletonCard from '../components/LawyerSkeletonCard';
import { t } from '../i18n';
import type { ScreenProps } from '../types/navigation';
import { hapticCall } from '../services/haptics';
/**
 * LawyersScreen -- GPS-first lawyer finder
 *
 * UX fixes:
 *  - Filters COLLAPSED by default -- results visible immediately
 *  - "Filters" pill button to expand/collapse
 *  - GPS fires automatically on mount, no button press needed
 *  - Active filter count shown on pill when filters applied
 *  - Sign-in nudge for unauthenticated users (non-blocking)
 */

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Alert, Animated, FlatList, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { api } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocationWithCity, formatDistance } from '../services/location';
import { cacheSearch, getCachedLawyers } from '../services/offlineCache';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import PracticeAreaSelector from '../components/PracticeAreaSelector';
import { getUserState } from '../utils/userState';
import * as secureStorage from '../utils/secureStorage';
import { useFocusEffect } from '@react-navigation/native';

declare var SkeletonLawyerList: any;
declare var filter: any;
declare var isPro: any;
declare var caseLoading: any; // hoisted from component scope
declare var language: any; // hoisted from component scope
declare var manualCity: any; // hoisted from component scope
declare var mountedRef: any; // hoisted from component scope
declare var proBonoOnly: any; // hoisted from component scope
declare var requireAuth: any; // hoisted from component scope
declare var setBadgeInfoType: any; // hoisted from component scope
declare var setCaseLoading: any; // hoisted from component scope
declare var setShowBadgeInfo: any; // hoisted from component scope
const CITIES = [
  '', 'Nashville, TN', 'Memphis, TN', 'Knoxville, TN', 'Chattanooga, TN',
  'Atlanta, GA', 'Houston, TX', 'Dallas, TX', 'Austin, TX',
  'Charlotte, NC', 'Phoenix, AZ', 'Denver, CO', 'Seattle, WA',
  'Detroit, MI', 'Baltimore, MD', 'Kansas City, MO', 'Milwaukee, WI',
  'Albuquerque, NM', 'Louisville, KY', 'Indianapolis, IN',
];

const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo'];

function callPhone(phone: string) { hapticCall(); Linking.openURL('tel:' + phone.replace(/\s/g, '')).catch(() => {}); }
function sendSMS(phone: string) { Linking.openURL('sms:' + phone.replace(/\s/g, '')).catch(() => {}); }
function openDirections(lat: number, lng: number, name: string) {
  const encoded = encodeURIComponent(name);
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => {});
}
function openWebsite(url: string) {
  Linking.openURL(url.startsWith('http') ? url : 'https://' + url).catch(() => {});
}

// ── Badges ────────────────────────────────────────────────────────────────────
function DistanceBadge({ distanceKm }: { distanceKm: number | null }) {
  if (distanceKm == null) return null;
  const label = formatDistance(distanceKm);
  const color = distanceKm < 50 ? COLORS.legal : distanceKm < 200 ? COLORS.warn : COLORS.textMuted;


  return (
    <View testID="lawyers-screen" style={[styles.badge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color }]}>📍 {label}</Text>
    </View>
  );
}

function TagRow({ items, color = COLORS.steel }: { items: string[]; color?: string }) {
  if (!items?.length) return null;
  return (
    <View style={styles.tagRow}>
      {items.map(t => (
        <View key={t} style={[styles.tag, { backgroundColor: color + '18', borderColor: color + '55' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Lawyer card ───────────────────────────────────────────────────────────────
const LawyerCard = React.memo(function LawyerCard({ item, navigation }: { item: Record<string,any>; navigation: any }) {

  // ── Subscription tier check for soft upsell ────────────────────────────────
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('user_subscription')
      .then(tier => setIsPro(!!tier && tier !== 'free'))
      .catch(() => {});
  }, []);
  const [msgModal, setMsgModal]   = React.useState(false);
  const [msgName,  setMsgName]    = React.useState('');
  const [msgPhone, setMsgPhone]   = React.useState('');
  const [msgNote,  setMsgNote]    = React.useState('');
  const [msgSent,  setMsgSent]    = React.useState(false);
  const [msgSending, setMsgSending] = React.useState(false);
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Navigate to encrypted in-app messaging -- create case if needed
  const openSecureMessage = React.useCallback(() => {
    requireAuth(async () => {
      setCaseLoading(true);
      try {
        // Find an existing open case or create a quick one for this lawyer
        var res = await api.get('/cases');
        const openCase = res.data?.find?.((c: any) =>
          ['Open','Active'].includes(String(c.status))
        );
        let caseId: number;
        let caseTitle: string;
        if (openCase) {
          caseId    = openCase.id;
          caseTitle = openCase.title;
        } else {
          // Create a lightweight case so the message thread has a home
          const created = await api.post('/cases', {
            title:  `Message -- ${item?.name}`,
            status: 'Open',
            notes:  '' });
          caseId    = created.data.id;
          caseTitle = created.data.title;
        }
        navigation.navigate('MoreTab', {
          screen: 'Messages',
          params: { caseId, caseTitle } });
      } catch {
        Alert.alert('Could not open messages', 'Check your connection and try again.');
      } finally {
        setCaseLoading(false);
      }
    });
  }, [item?.name, navigation]);

  const [expanded, setExpanded] = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving,  setSaving]  = useState(false);

  // Complete any pending save from before login
  useEffect(() => {
    AsyncStorage.getItem('pending_save_lawyer').then(async pending => {
      if (!pending) return;
      const token = await secureStorage.getToken();
      if (!token) return;
      try {
        const data = JSON.parse(pending);
        await api.post('/saved/lawyers', data);
        await AsyncStorage.removeItem('pending_save_lawyer');
        if (mountedRef.current) setSaved(true);
      } catch (e: any) { __DEV__ && console.warn(e?.message); }
    }).catch(() => {});
  }, []);

  const toggleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await secureStorage.getToken();
      if (!token) {
        // Preserve save intent -- complete after login
        await AsyncStorage.setItem('pending_save_lawyer', JSON.stringify({
          provider_id: item.id, name: item?.name, phone: item?.phone,
          address: item?.address, specialties: item.specialties || [], rating: item?.rating }));
        navigation.navigate('MoreTab', { screen: 'Login' });
        setSaving(false); return;
      }
      if (saved) {
        // Call DELETE to actually remove from saved list
        if (savedId) {
          await api.delete(`/saved/lawyers/${savedId}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        }
        setSaved(false);
        setSavedId(null);
      } else {
        const saveRes = await api.post('/saved/lawyers', {
          provider_id: item.id,
          name: item?.name,
          phone: item?.phone,
          address: item?.address,
          specialties: item.specialties || [],
          rating: item?.rating });
        setSaved(true);
        setSavedId(saveRes?.data?.id ?? null);
      }
    } catch { setSaved(true); } // optimistic
    finally { setSaving(false); }
  };
  return (
    <View style={styles.card}>
      {/* Header -- name, address, rating, availability */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <Text testID="lawyer-name" numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.4} style={styles.cardName}>{item?.name}</Text>
            {item.availability === 'accepting' && (
              <View style={{ backgroundColor:COLORS.legalBg, borderRadius:10, paddingHorizontal:7, paddingVertical:2 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'700', color:COLORS.legalDark }}>✓ Accepting</Text>

                {item.avg_response_hrs != null && item.avg_response_hrs <= 2 && (
                  <View style={{ backgroundColor:COLORS.legalBg, borderRadius:10,
                    paddingHorizontal:7, paddingVertical:3, marginRight:6 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                      color:COLORS.legalDark, fontWeight:'700' }}>
                      ⚡ &lt;2h reply
                    </Text>
                  </View>
                )}
              </View>
            )}
            {item.availability === 'limited' && (
              <View style={{ backgroundColor:COLORS.warnBg, borderRadius:10, paddingHorizontal:7, paddingVertical:2 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'700', color:COLORS.warnDark }}>⚡ Limited</Text>
              </View>
            )}
            {item.availability === 'unavailable' && (
              <View style={{ backgroundColor:COLORS.bgSubtle, borderRadius:10, paddingHorizontal:7, paddingVertical:2 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'600', color:COLORS.textMuted }}>Not accepting</Text>
              </View>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.cardAddress} numberOfLines={1}>{item?.address}</Text>
        </View>
        {item?.rating != null && (
          <View style={styles.ratingBlock}>
            <Text testID="lawyer-rating" maxFontSizeMultiplier={1.4} style={styles.ratingNum}>{item?.rating.toFixed(1)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.ratingStar}>★</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.reviewCount}>({item.reviews ?? 0})</Text>
          </View>
        )}
      </View>

      {/* Badges */}
      <View style={styles.metaRow}>
        <DistanceBadge distanceKm={item.distanceKm} />
        {item.free_consultation && <View style={[styles.badge, styles.greenBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.legal }]}>Free Consult</Text></View>}
        {item.pro_bono         && <View style={[styles.badge, styles.purpleBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.blue }]}>Pro Bono</Text></View>}
        {item.sliding_scale    && <View style={[styles.badge, styles.tealBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.legalDark }]}>Sliding Scale</Text></View>}
        {item.jtb_verified && (
          <TouchableOpacity testID="lawyer-card"
            style={{ flexDirection:'row', alignItems:'center', gap:4 }}
            onPress={() => { setBadgeInfoType('jtb'); setShowBadgeInfo(true); }}
            accessibilityRole="button"
            accessibilityLabel="What does Justice Gavel Verified mean?"
          >
          <View style={[styles.badge, {
              backgroundColor: COLORS.navy, borderColor: COLORS.gold,
              borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 4 }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, {
              color: COLORS.gold, fontFamily: 'Inter_700Bold', fontSize: 12 }]}>
              ✓ JTB Verified
            </Text>
          </View>
          </TouchableOpacity>
        )}
        {!item.jtb_verified && item.bar_verified && (
          <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`View full profile for ${item.name}`}
              style={styles.verifiedBadge}
              onPress={() => navigation.navigate('MoreTab', { screen: 'LawyerProfile', params: { id: item.id, lawyerId: item.id } })}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                color:COLORS.navy, fontWeight:'600' }}>
                View Full Profile →
              </Text>
              {item.data_verified === 0 && (
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 10,
                  color: COLORS.steel, fontStyle: 'italic' }}>
                  Unverified listing
                </Text>
              )}
            </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.secondaryBtn, styles.bookBtn]}
          onPress={() => navigation.navigate('MoreTab', {
            screen: 'Booking',
            params: {
              lawyerName:  item?.name,
              lawyerPhone: item?.phone ?? '',
              lawyerId:    item.id } })}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, styles.bookBtnText]}>📅 Book Consult</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, styles.secureBtn]}
          onPress={openSecureMessage}
          disabled={caseLoading}
          activeOpacity={0.85}
          accessibilityLabel={`Send encrypted message to ${item?.name}`}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, styles.secureBtnText]}>
            {caseLoading ? '…' : '🔒 Message'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setExpanded(e => !e)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.secondaryBtnText}>{expanded ? t('lawyers_less') : t('lawyers_more')}</Text>
        </TouchableOpacity>
      </View>

      {/* Expandable: bio, experience */}
      {expanded && (
        <View style={styles.expandedSection}>
          {!!item.years_experience && (
            <Text maxFontSizeMultiplier={1.4} style={styles.exp}>
              {item.years_experience} year{item.years_experience !== 1 ? 's' : ''} experience
            </Text>
          )}
          {item.hourly_rate != null && item.hourly_rate > 0 && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.exp, { color: COLORS.legal }]}>
              💰 ${item.hourly_rate}/hr
            </Text>
          )}
          {item.hourly_rate === 0 && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.exp, { color: COLORS.legalDark }]}>
              💚 Pro bono -- free
            </Text>
          )}
          {!!item?.bio && (
            <Text maxFontSizeMultiplier={1.4} style={styles.bio}>{item?.bio}</Text>
          )}
        </View>
      )}
    </View>
  );
});

// ── Filter modal ──────────────────────────────────────────────────────────────
function FilterModal({
  visible, onClose,
  caseType, setCaseType,
  language, setLanguage,
  manualCity, setManualCity,
  proBonoOnly, setProBonoOnly,
  onApply }: any) {
  return (
    <Modal accessibilityViewIsModal={true} visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => {}}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>Filter Lawyers</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}
            accessibilityRole="button"
            accessibilityLabel="Language"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' style={styles.modalBody}>
          <Text maxFontSizeMultiplier={1.4} style={styles.filterLabel}>Language</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={language} onValueChange={v => setLanguage(String(v))} style={styles.picker}>
              <Picker.Item label="Any language" value="" />
              {LANGUAGES.filter(Boolean).map(l => <Picker.Item key={l} label={l} value={l} />)}
            </Picker>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { marginTop: 16 }]}>Override city</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={manualCity} onValueChange={v => setManualCity(String(v))} style={styles.picker}>
              <Picker.Item label="Use my GPS location" value="" />
              {CITIES.filter(Boolean).map(c => <Picker.Item key={c} label={c} value={c} />)}
            </Picker>
          </View>

          <TouchableOpacity style={styles.toggleRow} onPress={() => setProBonoOnly((v: boolean) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Pro bono / free representation only"
          >
            <View style={[styles.toggle, proBonoOnly && styles.toggleOn]} />
            <Text maxFontSizeMultiplier={1.4} style={styles.toggleLabel}>Pro bono / free representation only</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.applyBtn} onPress={onApply}
            accessibilityLabel="Apply Filters"
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.applyBtnText}>Apply Filters</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={() => { setCaseType(''); setLanguage(''); setManualCity(''); setProBonoOnly(false); }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>Clear all filters</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const QUICK_NEEDS = [
    { key: 'DUI',            label: "DUI / Drunk Driving",   icon: '🚗', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
    { key: 'Drug Offenses',  label: 'Drug Charges',           icon: '💊', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: 'Assault',        label: 'Fight / Assault',        icon: '⚠️', color: COLORS.warnDark, bg: COLORS.warnBg },
    { key: 'Family Law',     label: 'Family / Divorce',       icon: '👨‍👩‍👧', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: 'Immigration',    label: 'Immigration',             icon: '✈️', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: '',               label: 'Something Else',         icon: '⚖️', color: COLORS.navy, bg: COLORS.bgSubtle },
    { key: 'Appeals',        label: 'Appeal / Post-Conviction' },
  ];

const activeFilters = [language, manualCity, proBonoOnly].filter(Boolean).length;


// ── Skeleton placeholder card ─────────────────────────────────────────────
function SkeletonCard({ colors }: { colors: Record<string, any> }) {
  const shimmer = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => shimmer.stopAnimation();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  const bg = colors?.bgSubtle || COLORS.bgSubtle;
  return (
    <Animated.View style={{ opacity, backgroundColor: colors?.bgCard || '#fff',
      borderRadius: 14, padding: 16, marginBottom: 10,
      borderWidth: 1, borderColor: colors?.border || COLORS.border }}>
      {/* Avatar + name row */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 14, width: '65%', borderRadius: 6, backgroundColor: bg }} />
          <View style={{ height: 11, width: '45%', borderRadius: 6, backgroundColor: bg }} />
        </View>
      </View>
      {/* Detail rows */}
      <View style={{ height: 11, width: '80%', borderRadius: 6, backgroundColor: bg, marginBottom: 8 }} />
      <View style={{ height: 11, width: '55%', borderRadius: 6, backgroundColor: bg }} />
    </Animated.View>
  );
}

export default function LawyersScreen({ navigation }: ScreenProps): React.JSX.Element {
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);


  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    getUserState().then(s => { if (s?.code) userStateRef.current = s.code; }).catch(()=>{});
  }, []);

  const searchDebounce = React.useRef<ReturnType<typeof setTimeout>|null>(null);
  const { colors, isDark } = useTheme();
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [lawyers, setLawyers]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMsg, setStatusMsg]   = useState('Locating you…');
  const [locationLabel, setLocationLabel] = useState('');
  const [showFilters, setShowFilters]   = useState(false);
  const [showNeedModal, setShowNeedModal] = useState(false);

  // 6 primary need categories shown in first-load modal
    // Filters
  const [manualCity, setManualCity]   = useState('');
  const [caseType, setCaseType]       = useState('');
  const [language, setLanguage]       = useState('');
  const [proBonoOnly, setProBonoOnly] = useState(false);
  const [coords, setCoords]           = useState<{ lat: number; lng: number } | null>(null);

  // Count active filters for pill badge
  filter(Boolean).length;


  // Memoize sorted + filtered lawyers -- avoids recomputing on every render
  const sortedLawyers = useMemo(() => {
    if (!lawyers.length) return lawyers;
    return [...lawyers].sort((a, b) => {
      // JTB verified first
      if ((b.jtb_verified ? 1:0) !== (a.jtb_verified ? 1:0))
        return (b.jtb_verified ? 1:0) - (a.jtb_verified ? 1:0);
      // Then by rating descending
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
  }, [lawyers]);

const fetchLawyers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setStatusMsg('Searching…');

    try {
      // ── Stale-while-revalidate: show cached data immediately ─────────────
      if (!isRefresh) {
        const cached = await getCachedLawyers();
        if ((cached as any).isCache && (cached as any).data?.length > 0) {
          setLawyers((cached as any).data);
        // Write-through cache for offline access
        cacheSearch('lawyers_list', { cases:[], messages:[], lawyers: [], lessons:[] }).catch(() => {});
          setLoading(false);
          if (!cached.stale) return; // fresh cache -- skip network call
          // Stale: continue fetch in background without showing spinner
        }
      }

      const params: Record<string, unknown> = { limit: 20, caseType, language, proBonoOnly, user_state: userStateRef.current || undefined };

      if (manualCity) {
        params.city = manualCity;
        setLocationLabel(manualCity);
      } else if (coords) {
        params.lat = coords.lat;
        params.lng = coords.lng;
      } else {
        setStatusMsg('Getting your location…');
        const loc = await getLocationWithCity();
        setCoords({ lat: loc.lat, lng: loc.lng });
        params.lat = loc.lat;
        params.lng = loc.lng;
        if (loc.city) {
          setLocationLabel(loc.source === 'gps'
            ? `Near ${loc.city}`
            : loc.city);
        } else {
          setLocationLabel(loc.permissionGranted ? 'Your location' : 'Default location');
        }
      }

      setStatusMsg('Finding lawyers near you…');
      var res = await api.get('/providers/lawyers', { params });
      setLawyers(res.data || []);
    // Fetch review summaries for first 10 lawyers (non-blocking)
    try {
      const lawyerIds = res.data?.slice(0, 10).map((l: Record<string, unknown>) => l.id);
      const reviews = await Promise.allSettled(
        lawyerIds.map((id: number) =>
          api.get('/reviews/summary', { params: { entity_type:'lawyer', entity_id:id } })
            .then(r => [id, r.data] as [number, any])
        )
      );
      const summaryMap: Record<number, any> = {};
      reviews.forEach(r => {
        if (r.status === 'fulfilled' && r.value) summaryMap[r.value[0]] = r.value[1];
      });
      if (mountedRef.current) setReviewSummaries(summaryMap);
    } catch {}
    // (remove the extra ); we added above -- the original setLawyers call needs its own);
      setStatusMsg(res.data?.length === 0 ? 'No lawyers found. Try adjusting filters.' : '');
    } catch (e: any) {
      setStatusMsg('Could not load lawyers. Check your connection or try a different city.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [manualCity, caseType, language, proBonoOnly, coords]);

  // Show "what do you need?" modal on very first visit, then auto-fetch
  useEffect(() => {
    AsyncStorage.getItem('lawyers_need_shown').then(shown => {
      if (!shown) {
        setShowNeedModal(true);
      } else {
        fetchLawyers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
      }
    }).catch(() => fetchLawyers());
  }, []);

  // Re-fetch when filters change
  const [mounted, setMounted] = useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [availableNow, setAvailableNow] = React.useState(false);
  const [fastOnly, setFastOnly] = React.useState(false);
  const [selected, setSelected]       = React.useState<number[]>([]);
  const [showBulk, setShowBulk]       = React.useState(false);
  const [bulkMsg, setBulkMsg]         = React.useState('');
  const [bulkSending, setBulkSending] = React.useState(false);
  const [bulkResult, setBulkResult]   = React.useState<string | null>(null);
  const [reviewSummaries, setReviewSummaries] = React.useState<    Record<number, { avg_rating: number; count: number; top_reviews: { rating: number; comment: string }[] }>>({});
  const [showBadgeInfo, setShowBadgeInfo] = React.useState(false);
  const [badgeInfoType, setBadgeInfoType] = React.useState<'bar'|'jtb'|'golden'>('bar');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mounted) { setMounted(true); return; }
    fetchLawyers();
  }, [manualCity, caseType, language, proBonoOnly]);

  const applyFilters = () => {
    setShowFilters(false);
    fetchLawyers();
  };

  // Parallel attorney outreach
  const toggleSelect = React.useCallback((id: number) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id)
        : prev.length < 3 ? [...prev, id] : prev  // max 3
    );
  }, []);

  const sendBulk = React.useCallback(async () => {
    if (!bulkMsg.trim() || selected.length === 0) return;
    setBulkSending(true);
    try {
      var res = await api.post('/messages/bulk', {
        lawyer_ids: selected,
        message:    bulkMsg.trim() });
      setBulkResult(`✅ Sent to ${res.data?.sent} attorney${res.data?.sent !== 1 ? 's' : ''}.`);
      setSelected([]);
      setBulkMsg('');
      setTimeout(() => { setShowBulk(false); setBulkResult(null); }, 2500);
    } catch {
      setBulkResult('❌ Send failed. Check your connection and try again.');
    } finally {
      setBulkSending(false);
    }
  }, [bulkMsg, selected]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Compact header bar -- always visible */}
      <View style={styles.headerBar}>
        <View style={{ flex: 1 }}>
          <View style={styles.headingRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Find a Lawyer</Text>
            {lawyers.length > 0 && !loading && (
              <View style={styles.resultBadge}>
                <Text maxFontSizeMultiplier={1.4} style={styles.resultBadgeText}>{lawyers.length} found</Text>
              </View>
            )}
          </View>
          {!!locationLabel && (
            <TouchableOpacity onPress={() => { if (searchDebounce.current) clearTimeout(searchDebounce.current); searchDebounce.current = setTimeout(() => { setCoords(null); setManualCity(''); fetchLawyers(); }, 300); }}
              accessibilityRole="button"
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.locationLabel}>📍 {locationLabel}  <Text maxFontSizeMultiplier={1.4} style={styles.refreshGps}>↺ refresh</Text></Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ⭐ Saved lawyers shortcut */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go to More"
          style={[styles.savedHeaderBtn]}
          testID="lawyer-save-button" onPress={() => navigation.navigate('MoreTab', { screen: 'SavedLawyers' })}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.savedHeaderBtnText}>⭐ Saved</Text>
        </TouchableOpacity>

        {/* Filters pill */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.filterPill, activeFilters > 0 && styles.filterPillActive]}
          onPress={() => setShowFilters(true)}
          activeOpacity={0.8}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.filterPillText, activeFilters > 0 && styles.filterPillTextActive]}>
            ⚙ Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results -- skeleton while loading */}
      {loading ? (
        <SkeletonLawyerList count={4} />
      ) : (
        <>
          {/* Soft upsell for free users — shown above results */}
          {!isPro && lawyers.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: colors.bgCard, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 10,
                marginBottom: 10, borderWidth: 1,
                borderColor: colors.navy + '40',
              }}
              accessibilityLabel="Upgrade to Pro for verified credentials and response times">
              <Text maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, color: colors.navy, flex: 1 }}>
                ⭐ Pro: verified credentials, response time, and client reviews
              </Text>
              <Text style={{ fontSize: 11, color: colors.navy, fontWeight: '600' }}>
                Upgrade →
              </Text>
            </TouchableOpacity>
          )}
                <FlatList testID="lawyer-list"
          getItemLayout={(_, index) => ({ length: 200, offset: 200 * index, index })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={sortedLawyers}
          keyExtractor={i => String(i.id)}
          onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLawyers(true)} tintColor={COLORS.navy} />}
          ListHeaderComponent={
            <>
              {statusMsg ? <Text testID="lawyers-offline-message" maxFontSizeMultiplier={1.4} style={styles.statusMsg}>{statusMsg}</Text> : null}
              {caseType && ['DUI','Drug Offenses','Assault'].includes(caseType) && !loading && lawyers.length > 0 && (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.walkthroughBanner}
                  onPress={() => navigation.navigate('MoreTab', {
                    screen: 'WhatHappensNext', params: { chargeType: caseType }
                  })}
                  activeOpacity={0.85}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.walkthroughBannerText}>
                    📖 Know what to expect with a {caseType} charge →
                  </Text>
                </TouchableOpacity>
              )}
            </>
          }
          ListFooterComponent={lawyers.length > 0
            ? <Text maxFontSizeMultiplier={1.4} style={styles.resultCount}>{lawyers.length} lawyer{lawyers.length !== 1 ? 's' : ''} found</Text>
            : null
          }

          ListEmptyComponent={
            !statusMsg ? (
              <View style={styles.emptyBlock}>
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>⚖️</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>No lawyers found in your area.</Text>
                <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowFilters(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Adjust filters"
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>Adjust filters</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => <LawyerCard item={item} navigation={navigation} />}
        />
        {loadError ? (
          <View style={{ padding:24, alignItems:'center' }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
              color:colors.emergency, textAlign:'center', marginBottom:12 }}>
              {loadError}
            </Text>
          </View>
        ) : null}
        </>
      )
    }

      {/* First-load "What do you need?" modal */}
      <Modal accessibilityViewIsModal={true} visible={showNeedModal} transparent animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.needOverlay}>
          <View style={styles.needSheet}>
            <Text maxFontSizeMultiplier={1.4} style={styles.needTitle}>What do you need help with?</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.needSub}>We'll find the right lawyer for you</Text>
            <View style={styles.needGrid}>
              {QUICK_NEEDS.map(n => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={n.key}
                  style={[styles.needBtn, { backgroundColor: n.bg, borderColor: n.color + '55' }]}
                  onPress={async () => { try {
                    await AsyncStorage.setItem('lawyers_need_shown', 'true');
                    setShowNeedModal(false);
                    // Route specialty needs to dedicated screens first
                    if (n.key === 'Real Estate') {
                      navigation.navigate('MoreTab', { screen: 'TenantRights' }); return;
                    }
                    if (n.key === 'Personal Injury' || n.key === 'Civil Rights') {
                      navigation.navigate('MoreTab', { screen: 'PILead', params: { caseType: n.key } }); return;
                    }
                    if (n.key === 'Immigration') {
                      navigation.navigate('MoreTab', { screen: 'IceDetention' }); return;
                    }
                    setCaseType(n.key);
                    fetchLawyers();
                    // Offer walkthrough for criminal charge types -- user taps to open
                    // (removed automatic navigation -- it was blocking search results)
                  } catch { /* AsyncStorage failure -- non-critical */ }
                  }}
                  activeOpacity={0.8}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.needBtnIcon}>{n.icon}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.needBtnLabel, { color: n.color }]}>{n.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Filter modal */}
      <FilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        caseType={caseType} setCaseType={setCaseType}
        language={language} setLanguage={setLanguage}
        manualCity={manualCity} setManualCity={setManualCity}
        proBonoOnly={proBonoOnly} setProBonoOnly={setProBonoOnly}
        availableNow={availableNow} setAvailableNow={setAvailableNow}
        onApply={applyFilters}
      />

      {/* Verified badge explainer modal */}
      <Modal accessibilityViewIsModal={true} visible={showBadgeInfo} transparent animationType="fade"
        onRequestClose={() => setShowBadgeInfo(false)}>
        <TouchableOpacity style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)',
          justifyContent:'center', padding:24 }}
          accessibilityRole="button"
          onPress={() => setShowBadgeInfo(false)} activeOpacity={1}>
          <View style={{ backgroundColor:colors.bgCard, borderRadius:16, padding:20,
            borderWidth:1, borderColor:colors.border }}>
            {badgeInfoType === 'bar' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                ✓ Bar Verified
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                This attorney's bar license has been verified against their state bar's
                official records. Justice Gavel confirmed the license was active and in
                good standing at the time of verification.
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
                color:colors.textMuted, marginBottom:12 }}>
                Re-verified quarterly. You can independently verify any attorney at your
                state bar's website.
              </Text>
            </>)}
            {badgeInfoType === 'jtb' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                ⚖️ Justice Gavel Verified
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                This attorney has been reviewed by the Justice Gavel team. We have
                confirmed their credentials, verified client reviews, and confirmed
                they are actively accepting new clients through our platform.
              </Text>
            </>)}
            {badgeInfoType === 'golden' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                🏆 Golden Gavel
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                Golden Gavel attorneys are the top-rated, most responsive, and most
                trusted attorneys on Justice Gavel. This distinction is earned through
                consistently high client ratings, fast response times, and verified
                track record.
              </Text>
            </>)}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Got it"
              style={{ backgroundColor:colors.navy, borderRadius:10,
                paddingVertical:12, alignItems:'center' }}
              onPress={() => setShowBadgeInfo(false)}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'700',
                fontSize:14, lineHeight:21 }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Contact multiple attorneys FAB */}
      {selected.length > 0 && (
        <TouchableOpacity
          style={{ position:'absolute', bottom:24, left:16, right:16,
            backgroundColor:colors.navy, borderRadius:14, paddingVertical:16,
            flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10 }}
          onPress={() => setShowBulk(true)}
          accessibilityRole="button"
          accessibilityLabel={`Contact ${selected.length} selected attorneys`}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>⚖️</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'700',
            fontSize:15, lineHeight:22 }}>
            Contact {selected.length} Attorney{selected.length !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Bulk message modal */}
      <Modal accessibilityViewIsModal={true} visible={showBulk} transparent animationType="slide"
        onRequestClose={() => setShowBulk(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)',
          justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:colors.bgCard, borderTopLeftRadius:20,
            borderTopRightRadius:20, padding:20 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
              fontWeight:'700', color:colors.textPrimary, marginBottom:4 }}>
              Contact {selected.length} Attorney{selected.length !== 1 ? 's' : ''}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
              color:colors.textMuted, marginBottom:12 }}>
              Your message will be sent to all selected attorneys. The first to respond wins.
            </Text>
            <TextInput testID="lawyers-search-input"
              style={{ borderWidth:1, borderColor:colors.inputBorder, borderRadius:10,
                padding:12, fontSize:14, lineHeight:21, color:colors.inputText,
                backgroundColor:colors.inputBg, minHeight:100, textAlignVertical:'top',
                marginBottom:12 }}
              placeholder="Briefly describe your situation and what you need help with…"
              placeholderTextColor={colors.placeholder}
              value={bulkMsg}
              onChangeText={setBulkMsg}
              multiline
              maxLength={500}
              accessibilityLabel="Message to send to selected attorneys"
            />
            {bulkResult && (
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                textAlign:'center', marginBottom:10,
                color: bulkResult.startsWith('✅') ? colors.legalDark : colors.emergencyDark }}>
                {bulkResult}
              </Text>
            )}
            <View style={{ flexDirection:'row', gap:12 }}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={{ flex:1, borderWidth:1, borderColor:colors.border,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={() => setShowBulk(false)}
              >
                <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textMuted,
                  fontWeight:'700', fontSize:14, lineHeight:21 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:2, backgroundColor:bulkSending ? colors.bgSubtle : colors.navy,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={sendBulk} disabled={bulkSending || !bulkMsg.trim()}
                accessibilityRole="button"
              >
                <Text maxFontSizeMultiplier={1.4} style={{
                  color: bulkSending || !bulkMsg.trim() ? colors.textMuted : colors.bgCard,
                  fontWeight:'700', fontSize:14, lineHeight:21 }}>
                  {bulkSending ? 'Sending…' : 'Send to All'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
</View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  // Badge styles -- static, extracted from inline for perf
  badgeGreen:   { backgroundColor:colors.legal, borderRadius:10,
                  paddingHorizontal:7, paddingVertical:3 },
  badgeAmber:   { backgroundColor:'#FFA726', borderRadius:10,
                  paddingHorizontal:7, paddingVertical:3 },
  badgeFastReply:{ backgroundColor:colors.legal, borderRadius:10,
                   paddingHorizontal:7, paddingVertical:3, marginRight:6 },
  badgeTextGreen: { fontSize:11, lineHeight:16, color:colors.legal, fontWeight:'700' },
  badgeTextAmber: { fontSize:11, lineHeight:16, color:'#FFA726', fontWeight:'700' },

  screen: { flex: 1 },

  headerBar: {
    backgroundColor: COLORS.bgCard,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: COLORS.navy,
    ...SHADOW.sm },
  heading:       { fontSize: 22, ...FONTS.black, color: COLORS.navy },
  locationLabel: { fontSize: 12, color: COLORS.steel, marginTop: 2 },
  refreshGps:    { color: COLORS.warn, fontSize: 11 },

  headingRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultBadge:  { backgroundColor: colors.legal, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  resultBadgeText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  filterPill: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.bg, marginLeft: 10 },
  filterPillActive: { borderColor: COLORS.navy, backgroundColor: COLORS.navy + '12' },
  filterPillText:   { fontSize: 12, lineHeight: 20, ...FONTS.semi, color: COLORS.textSecond },
  filterPillTextActive: { color: COLORS.navy },

  centerBlock:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText:  { marginTop: 14, color: COLORS.textMuted, fontSize: 14, lineHeight: 21, ...FONTS.medium },
  statusMsg:    { padding: 16, color: COLORS.textMuted, textAlign: 'center', fontSize: 14,
    lineHeight: 21 },
  listContent:  { padding: 12, paddingBottom: 40 },
  resultCount:  { textAlign: 'center', color: COLORS.textSecond, fontSize: 12, padding: 16 },

  emptyBlock:  { alignItems: 'center', padding: 40 },
  emptyIcon:   { fontSize: 40, marginBottom: 12 },
  emptyText:   { fontSize: 15, lineHeight: 22, color: COLORS.textMuted, marginBottom: 16, textAlign: 'center' },
  emptyBtn:    { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyBtnText:{ color: COLORS.bgCard, ...FONTS.bold },

  // Card
  card: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg,
    padding: 16, marginBottom: 10,
    ...SHADOW.sm },
  cardHeader:   { flexDirection: 'row', alignItems: 'flex-start' },
  cardName:     { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, flex: 1 },
  cardAddress:  { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  ratingBlock:  { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  ratingNum:    { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.warn },
  ratingStar:   { fontSize: 14, lineHeight: 21, color: COLORS.warn, marginLeft: 1 },
  reviewCount:  { fontSize: 11, color: COLORS.textSecond, marginLeft: 2 },
  metaRow:      { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:    { fontSize: 11, ...FONTS.semi },
  greenBadge:   { backgroundColor: COLORS.legalBg, borderColor: colors.legal },
  purpleBadge:  { backgroundColor: COLORS.bgSubtle, borderColor: '#85B7EB' },
  tealBadge:    { backgroundColor: colors.legal, borderColor: colors.legal },
  verifiedBadge:{ backgroundColor: COLORS.bgSubtle, borderColor: '#85B7EB' },
  goldenGavelBadge: { backgroundColor: '#FFA726', borderColor: '#F9A825' },
  tagRow:       { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 4 },
  tag:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  tagText:      { fontSize: 11, ...FONTS.medium },
  expandedSection:{ marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  exp:          { fontSize: 12, color: COLORS.textSecond, marginBottom: 4, fontStyle: 'italic' },
  bio:          { fontSize: 12, color: COLORS.textSecond, lineHeight: 19, marginBottom: 10 },
  actionRow:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn:    { flex: 1, paddingVertical: 16, borderRadius: RADIUS.md, alignItems: 'center' },
  callBtn:      { backgroundColor: COLORS.legal },
  dirBtn:       { backgroundColor: COLORS.warn },
  webBtn:       { backgroundColor: COLORS.steel },
  actionBtnText:{ color: COLORS.bgCard, ...FONTS.heavy, fontSize: 12 },
  phoneText:    { fontSize: 12, lineHeight: 20, color: COLORS.textSecond, textAlign: 'center', marginTop: 2 },
  callBtnBig: {
    backgroundColor: COLORS.legal,
    borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 10, marginBottom: 6,
    shadowColor: COLORS.legal, shadowOpacity: 0.25,
    shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  callBtnBigText: { color: COLORS.bgCard, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 14, lineHeight: 21, letterSpacing: 0.3 },
  noPhoneBox: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 10, marginTop: 10, marginBottom: 4, alignItems: 'center' },
  noPhoneText: { color: colors.steel, fontSize: 12 },
  secondaryRow: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 2, flexWrap: 'wrap' },
  secondaryBtn: {
    flex: 1, minWidth: 80,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', backgroundColor: COLORS.bg },
  secondaryBtnText: { fontSize: 12, color: COLORS.textSecond, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  secondaryBtnSaved: { borderColor: COLORS.warn, backgroundColor: COLORS.warn + '12' },
  bookBtn:     { borderColor: COLORS.navy, backgroundColor: COLORS.navy + '12' },
  bookBtnText: { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  secondaryBtnTextSaved: { color: COLORS.warn },
  expandHint:   { fontSize: 12, color: COLORS.textSecond, textAlign: 'right', marginTop: 8 },
  smsBtn: {
    backgroundColor: colors.blue,
    borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', marginBottom: 6 },
  smsBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 14, lineHeight: 21, letterSpacing: 0.3 },
  leaveMessageBtn: {
    borderRadius: 12, paddingVertical: 11,
    alignItems: 'center', marginBottom: 6,
    borderWidth: 1.5, borderColor: COLORS.navy + '55',
    backgroundColor: COLORS.navy + '08' },
  leaveMessageBtnText: { color: COLORS.navy, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  msgSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    shadowColor: COLORS.bg, shadowOpacity: 0.15, shadowRadius: 12 },
  msgSheetTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 4 },
  msgSheetSub:   { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  msgInput: {
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 16,
    paddingVertical: 11, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  msgInputTall: { height: 90, paddingTop: 11 },
  msgSendBtn: {
    backgroundColor: COLORS.navy, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center' },
  msgSendBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22 },
  secureBtn:     { borderColor: colors.legal, backgroundColor: colors.legal + '12' },
  secureBtnText: { color: colors.legal, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  // Filter modal
  needOverlay: {
    flex: 1, backgroundColor: 'rgba(2,14,28,0.82)',
    justifyContent: 'center', alignItems: 'center', padding: 20 },
  needSheet: {
    backgroundColor: COLORS.bgCard, borderRadius: 24,
    padding: 24, width: '100%', maxWidth: 400 },
  needTitle: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53', textAlign: 'center', marginBottom: 4 },
  needSub:   { fontSize: 14, lineHeight: 21, color: colors.steel, textAlign: 'center', marginBottom: 20 },
  needGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  needBtn: {
    width: '47%', paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: 14, alignItems: 'center', borderWidth: 1.5 },
  needBtnIcon:  { fontSize: 28, marginBottom: 6 },
  modalContainer: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    backgroundColor: COLORS.navy, padding: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle:     { fontSize: 20, ...FONTS.black, color: COLORS.bgCard },
  modalCloseBtn:  { padding: 6 },
  modalCloseText: { fontSize: 20, color: COLORS.bgCard, ...FONTS.semi },
  modalBody:      { padding: 20 },
  filterLabel:    { fontSize: 12, ...FONTS.bold, color: COLORS.textSecond, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  pickerWrap:     { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: COLORS.bgCard },
  picker:         { height: 48 },
  toggleRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 20, paddingVertical: 4 },
  toggle:         { width: 40, height: 22, borderRadius: 12, backgroundColor: COLORS.border, marginRight: 12 },
  toggleOn:       { backgroundColor: COLORS.navy },
  toggleLabel:    { fontSize: 14, lineHeight: 21, color: COLORS.textPrimary, flex: 1 },
  applyBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.lg,
    paddingVertical: 15, alignItems: 'center', marginTop: 24, ...SHADOW.sm },
  applyBtnText:   { color: COLORS.bgCard, ...FONTS.black, fontSize: 15,
    lineHeight: 22 },
  clearBtn:       { alignItems: 'center', paddingVertical: 16 },
  clearBtnText:   { fontSize: 14, lineHeight: 21, color: COLORS.textMuted, ...FONTS.semi },
  walkthroughBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.bgSubtle, borderRadius: RADIUS.md, padding: 12, marginHorizontal: 12, marginTop: 8 },
  walkthroughBannerText: { fontSize: 12, color: colors.blue, flex: 1, lineHeight: 18 },
  savedHeaderBtn:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.warn + '60',
    backgroundColor: COLORS.warn + '10' },
  savedHeaderBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.warn },
  conflictNote: { fontSize: 11, lineHeight: 16, paddingHorizontal: 2, marginBottom: 10, fontStyle: 'italic' },
  needBtnLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  conflictNoteBox: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 10 } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
