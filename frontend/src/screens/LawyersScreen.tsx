import { useToast } from '../components/ToastProvider';
import type { NavigationProp } from '@react-navigation/native';
import { AppIcon } from '../components/AppIcon';
import { useAuthGate } from '../components/AuthGate';
import { t } from '../i18n';
import type { ScreenProps } from '../types/navigation';
import { useLatestRef } from '../hooks/useLatestRef';
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
import {Animated, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, LayoutAnimation, InteractionManager} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Picker } from '@react-native-picker/picker';
import { api, apiErrorMessage } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocationWithCity, formatDistance } from '../services/location';
import { cacheSearch, getCachedLawyers } from '../services/offlineCache';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { getUserState } from '../utils/userState';
import * as secureStorage from '../utils/secureStorage';
import {} from '@react-navigation/native';

const CITIES = [
  '', 'Nashville, TN', 'Memphis, TN', 'Knoxville, TN', 'Chattanooga, TN',
  'Atlanta, GA', 'Houston, TX', 'Dallas, TX', 'Austin, TX',
  'Charlotte, NC', 'Phoenix, AZ', 'Denver, CO', 'Seattle, WA',
  'Detroit, MI', 'Baltimore, MD', 'Kansas City, MO', 'Milwaukee, WI',
  'Albuquerque, NM', 'Louisville, KY', 'Indianapolis, IN',
];
const CITIES_FILTERED = CITIES.filter(Boolean);

const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo'];
const LANGUAGES_FILTERED = LANGUAGES.filter(Boolean);

/** Page size for /providers/lawyers (the backend default); a full page means more may follow. */
const PAGE_SIZE = 20;

/** Justice Gavel's own client-review summary for one lawyer (GET /reviews/summary). */
type ReviewSummary = { avg_rating: number; count: number; top_reviews: { rating: number; comment: string }[] };

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

// ── Lawyer card ───────────────────────────────────────────────────────────────
const LawyerCard = React.memo(function LawyerCard({ item, navigation, isSelected = false, onToggleSelect, reviewSummary, onBadgeInfo }: {
  item: Record<string,any>;
  navigation: NavigationProp<any>;
  /** Selected for "Contact multiple attorneys" (max 3). */
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  reviewSummary?: ReviewSummary;
  /** Opens the screen's verified-badge explainer. */
  onBadgeInfo?: (type: 'bar' | 'jtb' | 'golden') => void;
}) {
  const { showToast } = useToast();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const [caseLoading, setCaseLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
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
        showToast('Check your connection and try again.');
      } finally {
        if (mountedRef.current) setCaseLoading(false);
      }
    });
  }, [item?.name, navigation, requireAuth, showToast]);

  const [expanded, setExpanded] = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving,  setSaving]  = useState(false);

  // Complete any pending save from before login
  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
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
    });
    return () => _task.cancel();
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
          address: item?.address, specialties: item.specialties || [], rating: item?.rating })).catch(() => {}); // non-fatal(() => {}); // non-fatal
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
    } catch (e) { setSaved(true); if (__DEV__) console.warn('[LawyersScreen] save failed:', e); } // optimistic UI
    finally { setSaving(false); }
  };
  return (
    <View style={styles.card}>
      <AuthGateModal />
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
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" testID="lawyer-card"
            style={{ flexDirection:'row', alignItems:'center', gap:4 }}
            onPress={() => onBadgeInfo
              ? onBadgeInfo('jtb')
              : showToast('Justice Gavel Verified: bar license and identity confirmed by our team.', 'info')}
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
          accessibilityHint="Double-tap to activate"
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
          accessibilityHint="Double-tap to activate"
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
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          style={[styles.secondaryBtn, styles.secureBtn]}
          onPress={openSecureMessage}
          disabled={caseLoading}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, styles.secureBtnText]}>
            {caseLoading ? '…' : '🔒 Message'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.secondaryBtn} onPress={() => setExpanded(e => !e)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.secondaryBtnText}>{expanded ? t('lawyers_less') : t('lawyers_more')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          accessibilityLabel={saved ? `Unsave ${item?.name}` : `Save ${item?.name} to saved list`}
          style={[styles.secondaryBtn, { minWidth: 44 }]}
          onPress={toggleSave}
          disabled={saving}
          activeOpacity={0.75}
          testID="lawyer-card-save"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: saved ? COLORS.gold : undefined }]}>
            {saving ? '…' : saved ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
        {onToggleSelect && (
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={isSelected
              ? `Remove ${item?.name} from the attorneys to contact`
              : `Select ${item?.name} to contact several attorneys at once (up to 3)`}
            style={[styles.secondaryBtn, isSelected && { borderColor: COLORS.navy }]}
            onPress={() => onToggleSelect(item.id)}
            activeOpacity={0.75}
            testID="lawyer-card-select"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, isSelected && { color: COLORS.navy }]}>
              {isSelected ? '☑ Selected' : '☐ Select'}
            </Text>
          </TouchableOpacity>
        )}
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
          {!!reviewSummary && reviewSummary.count > 0 && (
            <View testID="lawyer-review-summary">
              <Text maxFontSizeMultiplier={1.4} style={styles.exp}>
                ★ {Number(reviewSummary.avg_rating).toFixed(1)} from {reviewSummary.count} Justice Gavel client review{reviewSummary.count !== 1 ? 's' : ''}
              </Text>
              {(reviewSummary.top_reviews || []).filter(r => !!r?.comment).slice(0, 2).map((r, i) => (
                <Text key={i} maxFontSizeMultiplier={1.4} style={styles.bio} numberOfLines={3}>
                  “{r.comment}”
                </Text>
              ))}
            </View>
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
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint="Double-tap to activate" onPress={onClose} style={styles.modalCloseBtn}
            accessibilityLabel="Language"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' style={styles.modalBody}>
          <Text maxFontSizeMultiplier={1.4} style={styles.filterLabel}>Case type</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={caseType} onValueChange={v => setCaseType(String(v))} style={styles.picker}>
              <Picker.Item label="Any case type" value="" />
              {CASE_TYPE_OPTIONS.map(o => <Picker.Item key={o.key} label={o.label} value={o.key} />)}
            </Picker>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { marginTop: 16 }]}>Language</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={language} onValueChange={v => setLanguage(String(v))} style={styles.picker}>
              <Picker.Item label="Any language" value="" />
              {LANGUAGES_FILTERED.map(l => <Picker.Item key={l} label={l} value={l} />)}
            </Picker>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { marginTop: 16 }]}>Override city</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={manualCity} onValueChange={v => setManualCity(String(v))} style={styles.picker}>
              <Picker.Item label="Use my GPS location" value="" />
              {CITIES_FILTERED.map(c => <Picker.Item key={c} label={c} value={c} />)}
            </Picker>
          </View>

          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.toggleRow} onPress={() => setProBonoOnly((v: boolean) => !v)}
            accessibilityLabel="Pro bono / free representation only"
          >
            <View style={[styles.toggle, proBonoOnly && styles.toggleOn]} />
            <Text maxFontSizeMultiplier={1.4} style={styles.toggleLabel}>Pro bono / free representation only</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
 style={styles.applyBtn} onPress={onApply}
            accessibilityLabel="Apply Filters"
          accessibilityHint="Filters the list by selected criteria"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.applyBtnText}>Apply Filters</Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.clearBtn}
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
/** Case types the lawyer search filters on (the quick-need keys, minus "Something Else"). */
const CASE_TYPE_OPTIONS = QUICK_NEEDS.filter(n => !!n.key);



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
    return () => shimmer.stopAnimation();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  const bg = colors?.bgSubtle || COLORS.bgSubtle;
  return (
    <Animated.View style={{ opacity, backgroundColor: colors?.bgCard || colors.bg,
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

function LawyersScreen({ navigation }: ScreenProps): React.JSX.Element {
  // Pagination: fetchLawyers loads page 1, loadMore appends the next page.
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const lastParamsRef = React.useRef<Record<string, unknown> | null>(null);
  const loadingMoreRef = React.useRef(false);


  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    getUserState().then(s => { if (s?.code) userStateRef.current = s.code; }).catch(()=>{});
  }, []);

  const searchDebounce = React.useRef<ReturnType<typeof setTimeout>|null>(null);
  const { colors } = useTheme();
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
  const activeFilters = [caseType, language, manualCity, proBonoOnly].filter(Boolean).length;

  // ── Subscription tier check for soft upsell ────────────────────────────────
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    AsyncStorage.getItem('user_subscription')
      .then(tier => setIsPro(!!tier && tier !== 'free'))
      .catch(() => {});
  }, []);


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
    setStatusMsg('');
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setStatusMsg('Searching…');
    setHasMore(false);

    try {
      // ── Stale-while-revalidate: show cached data immediately ─────────────
      if (!isRefresh) {
        const cached = await getCachedLawyers();
        if ((cached as any).isCache && (cached as any).data?.length > 0) {
          setLawyers((cached as any).data);
        // Write-through cache for offline access
        cacheSearch('lawyers_list', { cases:[], messages:[], lawyers: [], lessons:[] }).catch(() => {});
          setLoading(false);
          if (!(cached as any).stale) return; // fresh cache -- skip network call
          // Stale: continue fetch in background without showing spinner
        }
      }

      const params: Record<string, unknown> = { limit: PAGE_SIZE, caseType, language, proBonoOnly, user_state: userStateRef.current || undefined };

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
      lastParamsRef.current = params;
      setPage(1);
      setHasMore(Array.isArray(res.data) && res.data.length >= PAGE_SIZE);
    // Fetch review summaries for first 10 lawyers (non-blocking)
    try {
      const lawyerIds = res.data?.slice(0, 10).map((l: Record<string, unknown>) => l.id);
      const reviews = await Promise.allSettled(
        (lawyerIds ?? []).map((id: number) =>
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
    } catch {
      setStatusMsg('Could not load lawyers. Check your connection or try a different city.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [manualCity, caseType, language, proBonoOnly, coords]);
  // Effects below fire on their own triggers (mount / filter change), not every
  // time fetchLawyers is re-created (e.g. when coords arrive), so they call it via a ref.
  const fetchLawyersRef = useLatestRef(fetchLawyers);

  // Next page for infinite scroll (same query as the last full fetch).
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !lastParamsRef.current) return;
    loadingMoreRef.current = true;
    const next = page + 1;
    try {
      const res = await api.get('/providers/lawyers', { params: { ...lastParamsRef.current, page: next } });
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      if (!mountedRef.current) return;
      setLawyers(prev => {
        const seen = new Set(prev.map(l => l.id));
        return [...prev, ...rows.filter(l => !seen.has(l.id))];
      });
      setPage(next);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      // Keep the current list; pull-to-refresh retries from page 1.
      if (mountedRef.current) setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, page]);

  // Show "what do you need?" modal on very first visit, then auto-fetch
  useEffect(() => {
    AsyncStorage.getItem('lawyers_need_shown').then(shown => {
      if (!shown) {
        setShowNeedModal(true);
      } else {
        fetchLawyersRef.current();
      }
    }).catch(() => fetchLawyersRef.current());
  }, [fetchLawyersRef]);

  // Re-fetch when filters change (skipping the initial values: the mount effect fetches)
  const filtersInitialisedRef = useRef(false);
  const [availableNow, setAvailableNow] = React.useState(false);
  const [selected, setSelected]       = React.useState<number[]>([]);
  const [showBulk, setShowBulk]       = React.useState(false);
  const [bulkMsg, setBulkMsg]         = React.useState('');
  const [bulkSending, setBulkSending] = React.useState(false);
  const [bulkResult, setBulkResult]   = React.useState<string | null>(null);
  const [reviewSummaries, setReviewSummaries] = React.useState<Record<number, ReviewSummary>>({});
  const [showBadgeInfo, setShowBadgeInfo] = React.useState(false);
  const [badgeInfoType, setBadgeInfoType] = React.useState<'bar'|'jtb'|'golden'>('bar');
  const showBadgeExplainer = React.useCallback((type: 'bar'|'jtb'|'golden') => {
    setBadgeInfoType(type);
    setShowBadgeInfo(true);
  }, []);

  useEffect(() => {
    if (!filtersInitialisedRef.current) { filtersInitialisedRef.current = true; return; }
    fetchLawyersRef.current();
  }, [manualCity, caseType, language, proBonoOnly, fetchLawyersRef]);

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
      const res = await api.post('/messages/bulk', {
        lawyer_ids: selected,
        message:    bulkMsg.trim() });
      const sent = Number(res.data?.sent) || 0;
      const skipped: { name?: string; phone?: string | null; reason?: string }[] =
        Array.isArray(res.data?.skipped) ? res.data.skipped : [];
      const noAccount = skipped.filter(s => s.reason === 'no_account');
      let text = sent > 0
        ? `✅ Sent to ${sent} attorney${sent !== 1 ? 's' : ''}.`
        : 'ℹ️ No in-app messages were sent.';
      if (noAccount.length) {
        text += `\n${noAccount.length === 1 ? 'This attorney is' : `${noAccount.length} attorneys are`} not on in-app messaging yet. Contact directly: `
          + noAccount.map(s => (s.phone ? `${s.name} (${s.phone})` : s.name)).join(', ');
      }
      setBulkResult(text);
      if (sent > 0) { setSelected([]); setBulkMsg(''); }
      if (sent > 0 && skipped.length === 0) {
        setTimeout(() => { setShowBulk(false); setBulkResult(null); }, 2500);
      }
    } catch (e) {
      setBulkResult('❌ ' + apiErrorMessage(e, 'Send failed. Check your connection and try again.'));
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
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" onPress={() => { if (searchDebounce.current) clearTimeout(searchDebounce.current); searchDebounce.current = setTimeout(() => { setCoords(null); setManualCity(''); fetchLawyers(); }, 300); }}
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.locationLabel}>📍 {locationLabel}  <Text maxFontSizeMultiplier={1.4} style={styles.refreshGps}>↺ refresh</Text></Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ⭐ Saved lawyers shortcut */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          accessibilityLabel="Go to More"
          style={[styles.savedHeaderBtn]}
          testID="lawyer-save-button" onPress={() => navigation.navigate('MoreTab', { screen: 'SavedLawyers' })}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.savedHeaderBtnText}>⭐ Saved</Text>
        </TouchableOpacity>

        {/* Filters pill */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
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
        <View style={{ paddingHorizontal: 16 }}>
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} colors={colors} />)}
        </View>
      ) : (
        <>
          {/* Soft upsell for free users — shown above results */}
          {!isPro && lawyers.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
              onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: colors.bgCard, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 10,
                marginBottom: 10, borderWidth: 1,
                borderColor: colors.navy + '40',
              }}
              accessibilityLabel="Upgrade to Legal Pro for verified credentials and response times">
              <Text maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, color: colors.navy, flex: 1 }}>
                ⭐ Pro: verified credentials, response time, and client reviews
              </Text>
              <Text style={{ fontSize: 11, color: colors.navy, fontWeight: '600' }}>
                Upgrade →
              </Text>
            </TouchableOpacity>
          )}
                <FlashList testID="lawyer-list"
          estimatedItemSize={80}
          data={sortedLawyers}
          keyExtractor={i => String(i.id)}
          onEndReached={loadMore}
          extraData={{ selected, reviewSummaries }}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLawyers(true)} tintColor={COLORS.navy} />}
          ListHeaderComponent={
            <>
              {statusMsg ? <Text testID="lawyers-offline-message" maxFontSizeMultiplier={1.4} style={styles.statusMsg}>{statusMsg}</Text> : null}
              {caseType && ['DUI','Drug Offenses','Assault'].includes(caseType) && !loading && lawyers.length > 0 && (
                <TouchableOpacity
                  accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
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
                <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>No lawyers found in your area.</Text>
                <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.emptyBtn} accessibilityLabel="Adjust filters" onPress={() => setShowFilters(true)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>Adjust filters</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <LawyerCard
              item={item}
              navigation={navigation}
              isSelected={selected.includes(item.id)}
              onToggleSelect={toggleSelect}
              reviewSummary={reviewSummaries[item.id]}
              onBadgeInfo={showBadgeExplainer}
            />
          )}
        />
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
          accessibilityHint="Double-tap to activate"
                  key={n.key}
                  style={[styles.needBtn, { backgroundColor: n.bg, borderColor: n.color + '55' }]}
                  onPress={async () => { try {
                    await AsyncStorage.setItem('lawyers_need_shown', 'true').catch(() => {});
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
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)',
          justifyContent:'center', padding:24 }}
          onPress={() => setShowBadgeInfo(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={1}>
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
          accessibilityHint="Double-tap to activate"
              accessibilityLabel="Got it"
              style={{ backgroundColor:colors.navy, borderRadius:10,
                paddingVertical:12, alignItems:'center' }}
              onPress={() => setShowBadgeInfo(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          style={{ position:'absolute', bottom:24, left:16, right:16,
            backgroundColor:colors.navy, borderRadius:14, paddingVertical:16,
            flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10 }}
          accessibilityLabel={"\u2696\ufe0f"} onPress={() => setShowBulk(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
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
            <TextInput
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
          returnKeyType="search" blurOnSubmit={true}
            />
            {bulkResult && (
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                textAlign:'center', marginBottom:10,
                color: bulkResult.startsWith('❌') ? colors.emergencyDark : colors.legalDark }}>
                {bulkResult}
              </Text>
            )}
            <View style={{ flexDirection:'row', gap:12 }}>
              <TouchableOpacity
                accessibilityRole="button"

                accessibilityLabel="Cancel"
          accessibilityHint="Cancels and returns to previous screen"
                style={{ flex:1, borderWidth:1, borderColor:colors.border,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={() => setShowBulk(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textMuted,
                  fontWeight:'700', fontSize:14, lineHeight:21 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
                style={{ flex:2, backgroundColor:bulkSending ? colors.bgSubtle : colors.navy,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={sendBulk} disabled={bulkSending || !bulkMsg.trim()}
              
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
  badgeAmber:   { backgroundColor:COLORS.steelMid, borderRadius:10,
                  paddingHorizontal:7, paddingVertical:3 },
  badgeFastReply:{ backgroundColor:colors.legal, borderRadius:10,
                   paddingHorizontal:7, paddingVertical:3, marginRight:6 },
  badgeTextGreen: { fontSize:11, lineHeight:16, color:colors.legal, fontWeight:'700' },
  badgeTextAmber: { fontSize:11, lineHeight:16, color:COLORS.steelMid, fontWeight:'700' },

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
  purpleBadge:  { backgroundColor: COLORS.bgSubtle, borderColor: COLORS.steel },
  tealBadge:    { backgroundColor: colors.legal, borderColor: colors.legal },
  verifiedBadge:{ backgroundColor: COLORS.bgSubtle, borderColor: COLORS.steel },
  goldenGavelBadge: { backgroundColor: COLORS.steelMid, borderColor: COLORS.steelMid },
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
  needTitle: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.navy, textAlign: 'center', marginBottom: 4 },
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
export default React.memo(LawyersScreen);