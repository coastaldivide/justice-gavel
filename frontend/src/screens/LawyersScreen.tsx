import { useToast } from '../components/ToastProvider';
import type { NavigationProp } from '@react-navigation/native';
import { AppIcon } from '../components/AppIcon';
import { useAuthGate } from '../components/AuthGate';
import { t, useLang, perLang } from '../i18n';
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
import { unwrapList, api, apiErrorMessage } from '../services/api';
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

// Language values as lawyer profiles store them (English); the picker shows langLabel().
const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo']; // i18n-exempt: stored values
const langLabel = (l: string): string => t(`lang_name_${l.toLowerCase()}`);
const LANGUAGES_FILTERED = LANGUAGES.filter(Boolean);

/** Page size for /providers/lawyers (the backend default); a full page means more may follow. */
const PAGE_SIZE = 20;

/** Justice Gavel's own client-review summary for one lawyer (GET /reviews/summary). */
type ReviewSummary = { avg_rating: number; count: number; top_reviews: { rating: number; comment: string }[] };

// ── Badges ────────────────────────────────────────────────────────────────────
function DistanceBadge({ distanceKm }: { distanceKm: number | null }) {
  useLang();
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
  useLang();
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
            title:  t('x_lawyers_message', { name: item?.name }),
            status: 'Open',
            notes:  '' });
          caseId    = created.data.id;
          caseTitle = created.data.title;
        }
        navigation.navigate('MoreTab', {
          screen: 'Messages',
          params: { caseId, caseTitle } });
      } catch {
        showToast(t('home_sos_failed'));
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

  const savingRef = React.useRef(false);
  const toggleSave = async () => {
    // Ref guard: a second tap before the re-render must not post twice.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const token = await secureStorage.getToken();
      if (!token) {
        // Preserve save intent -- complete after login
        await AsyncStorage.setItem('pending_save_lawyer', JSON.stringify({
          provider_id: item.id, name: item?.name, phone: item?.phone,
          address: item?.address, specialties: item.specialties || [], rating: item?.rating })).catch(() => {}); // non-fatal(() => {}); // non-fatal
        navigation.navigate('MoreTab', { screen: 'Login' });
        return;
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
    } catch (e) {
      // Keep the real state — never show "Saved" for a save that failed.
      if (__DEV__) console.warn('[LawyersScreen] save failed:', e);
      showToast(apiErrorMessage(e, t('x_lawyers_could_not_update_saved')), 'error');
    }
    finally { savingRef.current = false; setSaving(false); }
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
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'700', color:COLORS.legalDark }}>{t('x_lawyers_accepting')}</Text>

                {item.avg_response_hrs != null && item.avg_response_hrs <= 2 && (
                  <View style={{ backgroundColor:COLORS.legalBg, borderRadius:10,
                    paddingHorizontal:7, paddingVertical:3, marginRight:6 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                      color:COLORS.legalDark, fontWeight:'700' }}>
                      {t('x_lawyers_lt_2h_reply')}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {item.availability === 'limited' && (
              <View style={{ backgroundColor:COLORS.warnBg, borderRadius:10, paddingHorizontal:7, paddingVertical:2 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'700', color:COLORS.warnDark }}>{t('x_lawyers_limited')}</Text>
              </View>
            )}
            {item.availability === 'unavailable' && (
              <View style={{ backgroundColor:COLORS.bgSubtle, borderRadius:10, paddingHorizontal:7, paddingVertical:2 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight:'600', color:COLORS.textMuted }}>{t('x_lawyers_not_accepting')}</Text>
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
        {item.free_consultation && <View style={[styles.badge, styles.greenBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.legal }]}>{t('x_lawyers_free_consult')}</Text></View>}
        {item.pro_bono         && <View style={[styles.badge, styles.purpleBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.blue }]}>{t('x_lawyers_pro_bono')}</Text></View>}
        {item.sliding_scale    && <View style={[styles.badge, styles.tealBadge]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.legal }]}>{t('x_lawyers_sliding_scale')}</Text></View>}
        {item.jtb_verified && (
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} testID="lawyer-card"
            style={{ flexDirection:'row', alignItems:'center', gap:4 }}
            onPress={() => onBadgeInfo
              ? onBadgeInfo('jtb')
              : showToast(t('x_lawyers_justice_gavel_verified_bar'), 'info')}
            accessibilityLabel={t('x_lawyers_what_does_justice_gavel')}
          >
          <View style={[styles.badge, {
              backgroundColor: COLORS.navy, borderColor: COLORS.gold,
              borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 4 }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, {
              color: COLORS.gold, fontFamily: 'Inter_700Bold', fontSize: 12 }]}>
              {t('x_lawyers_jtb_verified')}
            </Text>
          </View>
          </TouchableOpacity>
        )}
        {!item.jtb_verified && item.bar_verified && (
          <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              accessibilityLabel={t('x_lawyers_view_full_profile', { name: item.name })}
              style={styles.verifiedBadge}
              onPress={() => navigation.navigate('MoreTab', { screen: 'LawyerProfile', params: { id: item.id, lawyerId: item.id } })}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                color:COLORS.navy, fontWeight:'600' }}>
                {t('x_lawyers_view_full_profile_2')}
              </Text>
              {item.data_verified === 0 && (
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 10,
                  color: COLORS.info, fontStyle: 'italic' }}>
                  {t('x_lawyers_unverified_listing')}
                </Text>
              )}
            </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.secondaryBtn, styles.bookBtn]}
          onPress={() => navigation.navigate('MoreTab', {
            screen: 'Booking',
            params: {
              lawyerName:  item?.name,
              lawyerPhone: item?.phone ?? '',
              lawyerId:    item.id } })}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, styles.bookBtnText]}>{t('x_lawyers_book_consult')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.secondaryBtn, styles.secureBtn]}
          onPress={openSecureMessage}
          disabled={caseLoading}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, styles.secureBtnText]}>
            {caseLoading ? '…' : t('x_lawyers_message_2')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.secondaryBtn} onPress={() => setExpanded(e => !e)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.secondaryBtnText}>{expanded ? t('lawyers_less') : t('lawyers_more')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          accessibilityLabel={saved ? t('x_lawyers_unsave', { name: item?.name }) : t('x_lawyers_save_saved_list', { name: item?.name })}
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
              ? t('x_lawyers_remove_from_attorneys_contact', { name: item?.name })
              : t('x_lawyers_select_contact_several_attorneys', { name: item?.name })}
            style={[styles.secondaryBtn, isSelected && { borderColor: COLORS.navy }]}
            onPress={() => onToggleSelect(item.id)}
            activeOpacity={0.75}
            testID="lawyer-card-select"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, isSelected && { color: COLORS.navy }]}>
              {isSelected ? t('x_lawyers_selected') : t('x_lawyers_select')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Expandable: bio, experience */}
      {expanded && (
        <View style={styles.expandedSection}>
          {!!item.years_experience && (
            <Text maxFontSizeMultiplier={1.4} style={styles.exp}>
              {t(item.years_experience === 1 ? 'x_lawyers_year_experience_one' : 'x_lawyers_year_experience_other', { years_experience: item.years_experience })}
            </Text>
          )}
          {item.hourly_rate != null && item.hourly_rate > 0 && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.exp, { color: COLORS.legal }]}>
              {t('x_lawyers_hr', { hourly_rate: item.hourly_rate })}
            </Text>
          )}
          {item.hourly_rate === 0 && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.exp, { color: COLORS.legalDark }]}>
              {t('x_lawyers_pro_bono_free')}
            </Text>
          )}
          {!!item?.bio && (
            <Text maxFontSizeMultiplier={1.4} style={styles.bio}>{item?.bio}</Text>
          )}
          {!!reviewSummary && reviewSummary.count > 0 && (
            <View testID="lawyer-review-summary">
              <Text maxFontSizeMultiplier={1.4} style={styles.exp}>
                {t(reviewSummary.count === 1 ? 'x_lawyers_from_justice_gavel_client_one' : 'x_lawyers_from_justice_gavel_client_other', { value: Number(reviewSummary.avg_rating).toFixed(1), count: reviewSummary.count })}
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
  useLang();
  return (
    <Modal accessibilityViewIsModal={true} visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => {}}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{t('x_lawyers_filter_lawyers')}</Text>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={onClose} style={styles.modalCloseBtn}
            accessibilityLabel={t('x_lawyers_language')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' style={styles.modalBody}>
          <Text maxFontSizeMultiplier={1.4} style={styles.filterLabel}>{t('x_lawyers_case_type')}</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={caseType} onValueChange={v => setCaseType(String(v))} style={styles.picker}>
              <Picker.Item label={t('x_lawyers_any_case_type')} value="" />
              {CASE_TYPE_OPTIONS().map(o => <Picker.Item key={o.key} label={o.label} value={o.key} />)}
            </Picker>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { marginTop: 16 }]}>{t('x_lawyers_language')}</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={language} onValueChange={v => setLanguage(String(v))} style={styles.picker}>
              <Picker.Item label={t('x_lawyers_any_language')} value="" />
              {LANGUAGES_FILTERED.map(l => <Picker.Item key={l} label={langLabel(l)} value={l} />)}
            </Picker>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { marginTop: 16 }]}>{t('x_lawyers_override_city')}</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={manualCity} onValueChange={v => setManualCity(String(v))} style={styles.picker}>
              <Picker.Item label={t('x_lawyers_use_my_gps_location')} value="" />
              {CITIES_FILTERED.map(c => <Picker.Item key={c} label={c} value={c} />)}
            </Picker>
          </View>

          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.toggleRow} onPress={() => setProBonoOnly((v: boolean) => !v)}
            accessibilityLabel={t('x_lawyers_pro_bono_free_representation')}
          >
            <View style={[styles.toggle, proBonoOnly && styles.toggleOn]} />
            <Text maxFontSizeMultiplier={1.4} style={styles.toggleLabel}>{t('x_lawyers_pro_bono_free_representation')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
 style={styles.applyBtn} onPress={onApply}
            accessibilityLabel={t('x_lawyers_apply_filters')}
          accessibilityHint={t('x_lawyers_filters_list_by_selected')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.applyBtnText}>{t('x_lawyers_apply_filters')}</Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.clearBtn}
            accessibilityLabel={t('x_lawyers_clear_all_filters')}
            onPress={() => { setCaseType(''); setLanguage(''); setManualCity(''); setProBonoOnly(false); }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>{t('x_lawyers_clear_all_filters')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const QUICK_NEEDS = perLang(() => [
    { key: 'DUI',            label: t('whn_charge_dui'),   icon: '🚗', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
    { key: 'Drug Offenses',  label: t('x_practice_area_selector_drug_charges'),           icon: '💊', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: 'Assault',        label: t('x_lawyers_fight_assault'),        icon: '⚠️', color: COLORS.warnDark, bg: COLORS.warnBg },
    { key: 'Family Law',     label: t('x_lawyers_family_divorce'),       icon: '👨‍👩‍👧', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: 'Immigration',    label: t('chat_cat_immigration'),             icon: '✈️', color: COLORS.blue, bg: COLORS.bgSubtle },
    { key: '',               label: t('x_lawyers_something_else'),         icon: '⚖️', color: COLORS.navy, bg: COLORS.bgSubtle },
    { key: 'Appeals',        label: t('x_lawyers_appeal_post_conviction') },
  ]);
/** Case types the lawyer search filters on (the quick-need keys, minus "Something Else"). */
const CASE_TYPE_OPTIONS = perLang(() => QUICK_NEEDS().filter(n => !!n.key));



// ── Skeleton placeholder card ─────────────────────────────────────────────
function SkeletonCard({ colors }: { colors: Record<string, any> }) {
  useLang();
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
  useLang();
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
    setStatusMsg(t('bail_searching'));
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
        setStatusMsg(t('qc_loc_getting'));
        const loc = await getLocationWithCity();
        setCoords({ lat: loc.lat, lng: loc.lng });
        params.lat = loc.lat;
        params.lng = loc.lng;
        if (loc.city) {
          setLocationLabel(loc.source === 'gps'
            ? t('x_lawyers_near', { city: loc.city })
            : loc.city);
        } else {
          setLocationLabel(loc.permissionGranted ? t('x_lawyers_location') : t('x_lawyers_default_location'));
        }
      }

      setStatusMsg(t('x_lawyers_finding_lawyers_near'));
      var res = await api.get('/providers/lawyers', { params });
      const found = unwrapList<Record<string, unknown>>(res.data, 'lawyers');
      setLawyers(found as any[]);
      lastParamsRef.current = params;
      setPage(1);
      setHasMore(found.length >= PAGE_SIZE);
    // Fetch review summaries for first 10 lawyers (non-blocking)
    try {
      const lawyerIds = found.slice(0, 10).map(l => Number(l.id)).filter(Number.isFinite);
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
      setStatusMsg(found.length === 0 ? t('x_lawyers_no_lawyers_found_try') : '');
    } catch {
      setStatusMsg(t('x_lawyers_could_not_load_lawyers'));
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
        ? t(sent === 1 ? 'x_lawyers_sent_attorney_one' : 'x_lawyers_sent_attorney_other', { sent })
        : t('x_lawyers_no_app_messages_were');
      if (noAccount.length) {
        text += '\n' + t(noAccount.length === 1 ? 'x_lawyers_not_app_messaging_one' : 'x_lawyers_not_app_messaging_other', { count: noAccount.length, list: noAccount.map(s => (s.phone ? `${s.name} (${s.phone})` : s.name)).join(', ') });
      }
      setBulkResult(text);
      if (sent > 0) { setSelected([]); setBulkMsg(''); }
      if (sent > 0 && skipped.length === 0) {
        setTimeout(() => { setShowBulk(false); setBulkResult(null); }, 2500);
      }
    } catch (e) {
      setBulkResult('❌ ' + apiErrorMessage(e, t('x_lawyers_send_failed_check_connection')));
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
            <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('lawyers_heading')}</Text>
            {lawyers.length > 0 && !loading && (
              <View style={styles.resultBadge}>
                <Text maxFontSizeMultiplier={1.4} style={styles.resultBadgeText}>{t('x_lawyers_found', { length: lawyers.length })}</Text>
              </View>
            )}
          </View>
          {!!locationLabel && (
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={() => { if (searchDebounce.current) clearTimeout(searchDebounce.current); searchDebounce.current = setTimeout(() => { setCoords(null); setManualCity(''); fetchLawyers(); }, 300); }}
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.locationLabel}>📍 {locationLabel}  <Text maxFontSizeMultiplier={1.4} style={styles.refreshGps}>{t('x_lawyers_refresh')}</Text></Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ⭐ Saved lawyers shortcut */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          accessibilityLabel={t('x_lawyers_go_more')}
          style={[styles.savedHeaderBtn]}
          testID="lawyer-save-button" onPress={() => navigation.navigate('MoreTab', { screen: 'SavedLawyers' })}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.savedHeaderBtnText}>{t('x_lawyers_saved')}</Text>
        </TouchableOpacity>

        {/* Filters pill */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.filterPill, activeFilters > 0 && styles.filterPillActive]}
          onPress={() => setShowFilters(true)}
          activeOpacity={0.8}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.filterPillText, activeFilters > 0 && styles.filterPillTextActive]}>
            {t('x_lawyers_filters', { value: activeFilters > 0 ? ` (${activeFilters})` : '' })}
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
          accessibilityHint={t('cp_double_tap')}
              onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: colors.bgCard, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 10,
                marginBottom: 10, borderWidth: 1,
                borderColor: colors.navy + '40',
              }}
              accessibilityLabel={t('x_lawyers_upgrade_legal_pro_verified')}>
              <Text maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, color: colors.textBrand, flex: 1 }}>
                {t('x_lawyers_pro_verified_credentials_response')}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textBrand, fontWeight: '600' }}>
                {t('x_lawyers_upgrade')}
              </Text>
            </TouchableOpacity>
          )}
                <FlashList testID="lawyer-list"
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
          accessibilityHint={t('cp_double_tap')}
                  style={styles.walkthroughBanner}
                  onPress={() => navigation.navigate('MoreTab', {
                    screen: 'WhatHappensNext', params: { chargeType: caseType }
                  })}
                  activeOpacity={0.85}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.walkthroughBannerText}>
                    {t('x_lawyers_know_what_expect_with', { caseType })}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          }
          ListFooterComponent={lawyers.length > 0
            ? <Text maxFontSizeMultiplier={1.4} style={styles.resultCount}>{t(lawyers.length === 1 ? 'x_lawyers_lawyer_found_one' : 'x_lawyers_lawyer_found_other', { length: lawyers.length })}</Text>
            : null
          }

          ListEmptyComponent={
            !statusMsg ? (
              <View style={styles.emptyBlock}>
                <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>{t('x_lawyers_no_lawyers_found_area')}</Text>
                <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.emptyBtn} accessibilityLabel={t('x_lawyers_adjust_filters')} onPress={() => setShowFilters(true)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>{t('x_lawyers_adjust_filters')}</Text>
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
            <Text maxFontSizeMultiplier={1.4} style={styles.needTitle}>{t('lawyers_need_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.needSub}>{t('lawyers_need_sub')}</Text>
            <View style={styles.needGrid}>
              {QUICK_NEEDS().map(n => (
                <TouchableOpacity
                  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
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
          accessibilityHint={t('cp_double_tap')} style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)',
          justifyContent:'center', padding:24 }}
          onPress={() => setShowBadgeInfo(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={1}>
          <View style={{ backgroundColor:colors.bgCard, borderRadius:16, padding:20,
            borderWidth:1, borderColor:colors.border }}>
            {badgeInfoType === 'bar' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                {t('x_expungement_bar_verified')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                {t('x_lawyers_this_attorney_s_bar')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
                color:colors.textMuted, marginBottom:12 }}>
                {t('x_lawyers_re_verified_quarterly_can')}
              </Text>
            </>)}
            {badgeInfoType === 'jtb' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                {t('x_lawyers_justice_gavel_verified')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                {t('x_lawyers_this_attorney_has_been')}
              </Text>
            </>)}
            {badgeInfoType === 'golden' && (<>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:18, lineHeight:27,
                fontWeight:'700', color:colors.textPrimary, marginBottom:10 }}>
                {t('x_nav_golden_gavel')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                color:colors.textPrimary, marginBottom:12 }}>
                {t('x_lawyers_golden_gavel_attorneys_top')}
              </Text>
            </>)}
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              accessibilityLabel={t('x_lawyers_got_it')}
              style={{ backgroundColor:colors.navy, borderRadius:10,
                paddingVertical:12, alignItems:'center' }}
              onPress={() => setShowBadgeInfo(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textOnNavy, fontWeight:'700',
                fontSize:14, lineHeight:21 }}>{t('x_lawyers_got_it')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Contact multiple attorneys FAB */}
      {selected.length > 0 && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={{ position:'absolute', bottom:24, left:16, right:16,
            backgroundColor:colors.navy, borderRadius:14, paddingVertical:16,
            flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10 }}
          accessibilityLabel={"\u2696\ufe0f"} onPress={() => setShowBulk(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textOnNavy, fontWeight:'700',
            fontSize:15, lineHeight:22 }}>
            {t(selected.length === 1 ? 'x_lawyers_contact_attorney_one' : 'x_lawyers_contact_attorney_other', { length: selected.length })}
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
              {t(selected.length === 1 ? 'x_lawyers_contact_attorney_one' : 'x_lawyers_contact_attorney_other', { length: selected.length })}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
              color:colors.textMuted, marginBottom:12 }}>
              {t('x_lawyers_message_will_be_sent')}
            </Text>
            <TextInput
              style={{ borderWidth:1, borderColor:colors.inputBorder, borderRadius:10,
                padding:12, fontSize:14, lineHeight:21, color:colors.inputText,
                backgroundColor:colors.inputBg, minHeight:100, textAlignVertical:'top',
                marginBottom:12 }}
              placeholder={t('x_lawyers_briefly_describe_situation_what')}
              placeholderTextColor={colors.placeholder}
              value={bulkMsg}
              onChangeText={setBulkMsg}
              multiline
              maxLength={500}
              accessibilityLabel={t('x_lawyers_message_send_selected_attorneys')}
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

                accessibilityLabel={t('case_cancel')}
          accessibilityHint={t('x_arrest_monitor_cancels_returns_previous_screen')}
                style={{ flex:1, borderWidth:1, borderColor:colors.border,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={() => setShowBulk(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textMuted,
                  fontWeight:'700', fontSize:14, lineHeight:21 }}>{t('case_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                style={{ flex:2, backgroundColor:bulkSending ? colors.bgSubtle : colors.navy,
                  borderRadius:10, paddingVertical:14, alignItems:'center' }}
                onPress={sendBulk} disabled={bulkSending || !bulkMsg.trim()}
              
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text maxFontSizeMultiplier={1.4} style={{
                  color: bulkSending || !bulkMsg.trim() ? colors.textMuted : colors.bgCard,
                  fontWeight:'700', fontSize:14, lineHeight:21 }}>
                  {bulkSending ? t('booking_sending') : t('x_lawyers_send_all')}
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
  locationLabel: { fontSize: 12, color: COLORS.info, marginTop: 2 },
  refreshGps:    { color: COLORS.info, fontSize: 11 },

  headingRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultBadge:  { backgroundColor: colors.legal, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  resultBadgeText: { color: colors.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
  statusMsg:    { padding: 16, color: colors.textMuted, textAlign: 'center', fontSize: 14,
    lineHeight: 21 },
  listContent:  { padding: 12, paddingBottom: 40 },
  resultCount:  { textAlign: 'center', color: colors.textMuted, fontSize: 12, padding: 16 },

  emptyBlock:  { alignItems: 'center', padding: 40 },
  emptyIcon:   { fontSize: 40, marginBottom: 12 },
  emptyText:   { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginBottom: 16, textAlign: 'center' },
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
  ratingNum:    { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: colors.textOnGold },
  ratingStar:   { fontSize: 14, lineHeight: 21, color: colors.textOnGold, marginLeft: 1 },
  reviewCount:  { fontSize: 11, color: COLORS.textSecond, marginLeft: 2 },
  metaRow:      { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:    { fontSize: 11, ...FONTS.semi },
  greenBadge:   { backgroundColor: COLORS.legalBg, borderColor: colors.legal },
  purpleBadge:  { backgroundColor: COLORS.bgSubtle, borderColor: COLORS.steel },
  tealBadge:    { backgroundColor: colors.legalBg, borderColor: colors.legal },
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
    backgroundColor: colors.bgCard, borderRadius: 24,
    padding: 24, width: '100%', maxWidth: 400 },
  needTitle: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textBrand, textAlign: 'center', marginBottom: 4 },
  needSub:   { fontSize: 14, lineHeight: 21, color: colors.info, textAlign: 'center', marginBottom: 20 },
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
  savedHeaderBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.warnDark },
  conflictNote: { fontSize: 11, lineHeight: 16, paddingHorizontal: 2, marginBottom: 10, fontStyle: 'italic' },
  needBtnLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  conflictNoteBox: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 10 } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(LawyersScreen);