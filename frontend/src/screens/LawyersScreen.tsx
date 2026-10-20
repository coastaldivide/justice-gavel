/**
 * LawyersScreen — the lawyer directory (real listings; read only).
 *
 *  - Nearest first from the phone's location; without location permission the
 *    list shows the person's state (or the whole directory) and asks for a
 *    city, state, ZIP or name — typing one searches the same way.
 *  - Infinite scroll to the end of the result (GET /providers/lawyers pages;
 *    X-Total-Count says how many there are).
 *  - Filters (case type, language, pro bono) always narrow; an empty result says so.
 *  - Every card: call / text / directions / website (well-formed links, phone
 *    formatted), profile, save (synced with the saved list). Booking and in-app
 *    messages only for lawyers who are on Justice Gavel (`on_app`) — anyone
 *    else would never see them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
import { ContactActions } from '../components/ContactActions';
import { t, useLang, perLang } from '../i18n';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { getLocationWithCity, formatDistance } from '../services/location';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { getUserState, stateName } from '../utils/userState';
import * as secureStorage from '../utils/secureStorage';

/** Page size for /providers/lawyers; a full page means more may follow. */
const PAGE_SIZE = 20;
const PENDING_SAVE_KEY = 'pending_save_lawyer';

// Language values as lawyer profiles store them (English); the picker shows langLabel().
const LANGUAGES = ['Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo']; // i18n-exempt: stored values
const langLabel = (l: string): string => t(`lang_name_${l.toLowerCase()}`);

export interface DirectoryLawyer {
  id: number; name: string; firm?: string | null; phone?: string | null; address?: string | null;
  city?: string | null; state?: string | null; lat?: number | null; lng?: number | null; website?: string | null;
  rating?: number | null; reviews?: number | null; distanceKm?: number | null;
  free_consultation?: boolean; pro_bono?: boolean; sliding_scale?: boolean;
  bar_verified?: boolean; jtb_verified?: boolean; on_app?: boolean;
  open_now?: boolean | null; open_24_7?: boolean; availability?: string;
}

/** Justice Gavel's own client-review summary for one lawyer (GET /reviews/summary). */
type ReviewSummary = { avg_rating: number | null; count: number };

const QUICK_NEEDS = perLang(() => [
  { key: 'DUI',           label: t('whn_charge_dui'),                          icon: '🚗', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
  { key: 'Drug Offenses', label: t('x_practice_area_selector_drug_charges'),  icon: '💊', color: COLORS.blue,          bg: COLORS.bgSubtle },
  { key: 'Assault',       label: t('x_lawyers_fight_assault'),                 icon: '⚠️', color: COLORS.warnDark,      bg: COLORS.warnBg },
  { key: 'Family Law',    label: t('x_lawyers_family_divorce'),                icon: '👨‍👩‍👧', color: COLORS.blue,          bg: COLORS.bgSubtle },
  { key: 'Immigration',   label: t('chat_cat_immigration'),                    icon: '✈️', color: COLORS.blue,          bg: COLORS.bgSubtle },
  { key: 'Appeals',       label: t('x_lawyers_appeal_post_conviction'),        icon: '📜', color: COLORS.navy,          bg: COLORS.bgSubtle },
  { key: '',              label: t('x_lawyers_something_else'),                icon: '⚖️', color: COLORS.navy,          bg: COLORS.bgSubtle },
]);
/** Case types the search filters on (the quick-need keys with a value). */
const CASE_TYPE_OPTIONS = perLang(() => QUICK_NEEDS().filter(n => !!n.key));
const caseTypeLabel = (key: string) => CASE_TYPE_OPTIONS().find(o => o.key === key)?.label || key;

// ── Lawyer card ───────────────────────────────────────────────────────────────
const LawyerCard = React.memo(function LawyerCard({ item, navigation, savedId, onToggleSave, saving, isSelected, onToggleSelect, onMessage, reviewSummary, onBadgeInfo }: {
  item: DirectoryLawyer;
  navigation: NavigationProp<any>;
  savedId: number | null;
  onToggleSave: (l: DirectoryLawyer) => void;
  saving: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onMessage: (l: DirectoryLawyer) => void;
  reviewSummary?: ReviewSummary;
  onBadgeInfo: (type: 'bar' | 'jtb') => void;
}) {
  useLang();
  const { colors } = useTheme();
  const openProfile = () => navigation.navigate('MoreTab', { screen: 'LawyerProfile', params: { lawyerId: item.id } });
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }]} testID="lawyer-card">
      <View style={styles.cardHeader}>
        <TouchableOpacity accessibilityRole="link" style={{ flex: 1, minWidth: 44, minHeight: 44 }} onPress={openProfile}
          accessibilityLabel={t('x_lawyers_view_full_profile', { name: item.name })}>
          <Text testID="lawyer-name" numberOfLines={2} maxFontSizeMultiplier={1.4} style={[styles.cardName, { color: colors.textBrand }]}>{item.name}</Text>
          {!!item.address && <Text maxFontSizeMultiplier={1.4} style={[styles.cardAddress, { color: colors.textMuted }]} numberOfLines={2}>{item.address}</Text>}
        </TouchableOpacity>
        {item.rating != null && (
          <View style={styles.ratingBlock} accessibilityLabel={t('lw_rating_a11y', { rating: item.rating.toFixed(1), count: item.reviews ?? 0 })}>
            <Text testID="lawyer-rating" maxFontSizeMultiplier={1.4} style={[styles.ratingNum, { color: colors.textPrimary }]}>{item.rating.toFixed(1)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.ratingStar, { color: colors.goldText }]}>★</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.reviewCount, { color: colors.textMuted }]}>({item.reviews ?? 0})</Text>
          </View>
        )}
      </View>

      <View style={styles.metaRow}>
        {item.distanceKm != null && (
          <View style={[styles.badge, { borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.textSecond }]}>📍 {formatDistance(item.distanceKm)}</Text>
          </View>
        )}
        {item.open_24_7 ? (
          <View style={[styles.badge, { borderColor: colors.legal, backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.legal }]}>{t('lw_open_24_7')}</Text>
          </View>
        ) : item.open_now != null && (
          <View style={[styles.badge, { borderColor: item.open_now ? colors.legal : colors.border, backgroundColor: item.open_now ? colors.legalBg : colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: item.open_now ? colors.legalDark : colors.textMuted }]}>{item.open_now ? t('lw_open_now') : t('lw_closed_now')}</Text>
          </View>
        )}
        {item.free_consultation && <View style={[styles.badge, { borderColor: colors.legal, backgroundColor: colors.legalBg }]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.legal }]}>{t('x_lawyers_free_consult')}</Text></View>}
        {item.pro_bono && <View style={[styles.badge, { borderColor: colors.border }]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.textSecond }]}>{t('x_lawyers_pro_bono')}</Text></View>}
        {item.sliding_scale && <View style={[styles.badge, { borderColor: colors.border }]}><Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.textSecond }]}>{t('x_lawyers_sliding_scale')}</Text></View>}
        {item.jtb_verified && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_lawyers_what_does_justice_gavel')} onPress={() => onBadgeInfo('jtb')}
            style={[styles.badge, { borderColor: COLORS.gold, backgroundColor: COLORS.navy }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.gold }]}>{t('x_lawyers_jtb_verified')}</Text>
          </TouchableOpacity>
        )}
        {!item.jtb_verified && item.bar_verified && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_expungement_bar_verified')} onPress={() => onBadgeInfo('bar')}
            style={[styles.badge, { borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: colors.textSecond }]}>{t('x_expungement_bar_verified')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!reviewSummary && reviewSummary.count > 0 && reviewSummary.avg_rating != null && (
        <Text testID="lawyer-review-summary" maxFontSizeMultiplier={1.4} style={[styles.reviewSummary, { color: colors.textSecond }]}>
          {t(reviewSummary.count === 1 ? 'x_lawyers_from_justice_gavel_client_one' : 'x_lawyers_from_justice_gavel_client_other', { value: Number(reviewSummary.avg_rating).toFixed(1), count: reviewSummary.count })}
        </Text>
      )}

      <ContactActions listing={item} />

      <View style={styles.secondaryRow}>
        <TouchableOpacity accessibilityRole="button" testID="lawyer-card-profile" style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.bg }]} onPress={openProfile}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: colors.textBrand }]} numberOfLines={1}>{t('lw_profile')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="lawyer-card-save"
          accessibilityLabel={savedId ? t('x_lawyers_unsave', { name: item.name }) : t('x_lawyers_save_saved_list', { name: item.name })}
          accessibilityState={{ selected: !!savedId, busy: saving }}
          style={[styles.secondaryBtn, { borderColor: savedId ? COLORS.gold : colors.border, backgroundColor: colors.bg }]}
          onPress={() => onToggleSave(item)} disabled={saving}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: savedId ? colors.goldText : colors.textSecond }]} numberOfLines={1}>
            {saving ? '…' : savedId ? t('lw_saved') : t('lw_save')}
          </Text>
        </TouchableOpacity>
        {item.on_app && (
          <TouchableOpacity accessibilityRole="button" testID="lawyer-card-book" style={[styles.secondaryBtn, { borderColor: colors.navy, backgroundColor: colors.bg }]}
            onPress={() => navigation.navigate('MoreTab', { screen: 'Booking', params: { lawyerId: item.id, lawyerName: item.name } })}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: colors.textBrand }]} numberOfLines={1}>{t('x_lawyers_book_consult')}</Text>
          </TouchableOpacity>
        )}
        {item.on_app && (
          <TouchableOpacity accessibilityRole="button" testID="lawyer-card-message" style={[styles.secondaryBtn, { borderColor: colors.legal, backgroundColor: colors.bg }]} onPress={() => onMessage(item)}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: colors.legal }]} numberOfLines={1}>{t('x_lawyers_message_2')}</Text>
          </TouchableOpacity>
        )}
        {item.on_app && (
          <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }} testID="lawyer-card-select"
            accessibilityLabel={isSelected ? t('x_lawyers_remove_from_attorneys_contact', { name: item.name }) : t('x_lawyers_select_contact_several_attorneys', { name: item.name })}
            style={[styles.secondaryBtn, { borderColor: isSelected ? colors.navy : colors.border, backgroundColor: colors.bg }]} onPress={() => onToggleSelect(item.id)}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.secondaryBtnText, { color: colors.textSecond }]} numberOfLines={1}>{isSelected ? t('x_lawyers_selected') : t('x_lawyers_select')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

// ── Filter modal ──────────────────────────────────────────────────────────────
function FilterModal({ visible, onClose, caseType, language, proBonoOnly, onApply }: {
  visible: boolean; onClose: () => void; caseType: string; language: string; proBonoOnly: boolean;
  onApply: (f: { caseType: string; language: string; proBonoOnly: boolean }) => void;
}) {
  useLang();
  const { colors } = useTheme();
  const [ct, setCt] = useState(caseType);
  const [lg, setLg] = useState(language);
  const [pb, setPb] = useState(proBonoOnly);
  useEffect(() => { if (visible) { setCt(caseType); setLg(language); setPb(proBonoOnly); } }, [visible, caseType, language, proBonoOnly]);
  return (
    <Modal accessibilityViewIsModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: colors.bg }]} testID="lawyers-filter-modal">
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{t('x_lawyers_filter_lawyers')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('lw_close')} onPress={onClose} style={styles.modalCloseBtn}>
            <Text maxFontSizeMultiplier={1.4} style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { color: colors.textSecond }]}>{t('x_lawyers_case_type')}</Text>
          <View style={[styles.pickerWrap, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
            <Picker testID="filter-case-type" selectedValue={ct} onValueChange={v => setCt(String(v))} style={[styles.picker, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}>
              <Picker.Item label={t('x_lawyers_any_case_type')} value="" />
              {CASE_TYPE_OPTIONS().map(o => <Picker.Item key={o.key} label={o.label} value={o.key} />)}
            </Picker>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={[styles.filterLabel, { color: colors.textSecond, marginTop: 16 }]}>{t('x_lawyers_language')}</Text>
          <View style={[styles.pickerWrap, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
            <Picker testID="filter-language" selectedValue={lg} onValueChange={v => setLg(String(v))} style={[styles.picker, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}>
              <Picker.Item label={t('x_lawyers_any_language')} value="" />
              {LANGUAGES.map(l => <Picker.Item key={l} label={langLabel(l)} value={l} />)}
            </Picker>
          </View>
          <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: pb }} style={styles.toggleRow} onPress={() => setPb(v => !v)}
            accessibilityLabel={t('x_lawyers_pro_bono_free_representation')} testID="filter-pro-bono">
            <View style={[styles.toggle, { backgroundColor: pb ? colors.navy : colors.border }]}><View style={[styles.knob, pb && styles.knobOn]} /></View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toggleLabel, { color: colors.textPrimary }]}>{t('x_lawyers_pro_bono_free_representation')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="filter-apply" style={styles.applyBtn} onPress={() => onApply({ caseType: ct, language: lg, proBonoOnly: pb })}
            accessibilityHint={t('x_lawyers_filters_list_by_selected')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.applyBtnText}>{t('x_lawyers_apply_filters')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.clearBtn} testID="filter-clear"
            onPress={() => onApply({ caseType: '', language: '', proBonoOnly: false })}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.clearBtnText, { color: colors.textMuted }]}>{t('x_lawyers_clear_all_filters')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Skeleton placeholder card ─────────────────────────────────────────────────
function SkeletonCard() {
  const { colors } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // isInteraction:false — an endless loop must not hold InteractionManager
    // (it would block every runAfterInteractions task on web).
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  return (
    <Animated.View style={[styles.card, { opacity, backgroundColor: colors.bgCard }]}>
      <View style={{ height: 14, width: '65%', borderRadius: 6, backgroundColor: colors.bgSubtle, marginBottom: 8 }} />
      <View style={{ height: 11, width: '80%', borderRadius: 6, backgroundColor: colors.bgSubtle, marginBottom: 14 }} />
      <View style={{ height: 44, borderRadius: 10, backgroundColor: colors.bgSubtle }} />
    </Animated.View>
  );
}

type Place = { kind: 'gps'; lat: number; lng: number; label: string } | { kind: 'query'; q: string } | { kind: 'state'; state: string } | { kind: 'all' };

function LawyersScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [lawyers, setLawyers] = useState<DirectoryLawyer[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [caseType, setCaseType] = useState('');
  const [language, setLanguage] = useState('');
  const [proBonoOnly, setProBonoOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showNeedModal, setShowNeedModal] = useState(false);
  const [reviewSummaries, setReviewSummaries] = useState<Record<number, ReviewSummary>>({});
  const [savedMap, setSavedMap] = useState<Record<number, number>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [badgeInfo, setBadgeInfo] = useState<'bar' | 'jtb' | null>(null);
  const reqSeq = useRef(0);

  const activeFilters = [caseType, language, proBonoOnly].filter(Boolean).length;

  const paramsFor = useCallback((p: Place, extra: Record<string, unknown> = {}) => {
    const params: Record<string, unknown> = { limit: PAGE_SIZE, ...extra };
    if (caseType) params.caseType = caseType;
    if (language) params.language = language;
    if (proBonoOnly) params.proBonoOnly = true;
    if (p.kind === 'gps') { params.lat = p.lat; params.lng = p.lng; }
    if (p.kind === 'query') params.q = p.q;
    if (p.kind === 'state') params.state = p.state;
    return params;
  }, [caseType, language, proBonoOnly]);

  /** Where to search when the person has not typed anything: GPS, else their state, else everything. */
  const resolveDefaultPlace = useCallback(async (): Promise<Place> => {
    const loc = await getLocationWithCity({ reason: t('lw_location_reason') });
    if (loc.permissionGranted && loc.source === 'gps') {
      setLocationOff(false);
      return { kind: 'gps', lat: loc.lat, lng: loc.lng, label: loc.city ? t('x_lawyers_near', { city: loc.city }) : t('x_lawyers_location') };
    }
    setLocationOff(true);
    const st = await getUserState().catch(() => null);
    return st?.code ? { kind: 'state', state: st.code } : { kind: 'all' };
  }, []);

  const loadReviewSummaries = useCallback((rows: DirectoryLawyer[]) => {
    Promise.allSettled(rows.slice(0, 10).map(l =>
      api.get('/reviews/summary', { params: { entity_type: 'lawyer', entity_id: l.id } }).then(r => [l.id, r.data] as [number, ReviewSummary])))
      .then(results => {
        if (!mountedRef.current) return;
        const map: Record<number, ReviewSummary> = {};
        for (const r of results) if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
        setReviewSummaries(prev => ({ ...prev, ...map }));
      });
  }, []);

  const search = useCallback(async (p: Place | null, isRefresh = false) => {
    const seq = ++reqSeq.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const where = p || await resolveDefaultPlace();
      if (seq !== reqSeq.current) return;
      setPlace(where);
      const res = await api.get('/providers/lawyers', { params: paramsFor(where) });
      if (seq !== reqSeq.current || !mountedRef.current) return;
      const rows = unwrapList<DirectoryLawyer>(res.data, 'lawyers');
      const tot = Number(res.headers?.['x-total-count']);
      setLawyers(rows);
      setTotal(Number.isFinite(tot) ? tot : rows.length);
      setPage(1);
      setHasMore(Number.isFinite(tot) ? rows.length < tot : rows.length >= PAGE_SIZE);
      loadReviewSummaries(rows);
    } catch (e) {
      if (seq === reqSeq.current && mountedRef.current) setError(apiErrorMessage(e, t('x_lawyers_could_not_load_lawyers')));
    } finally {
      if (seq === reqSeq.current && mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [paramsFor, resolveDefaultPlace, loadReviewSummaries]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !place || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = reqSeq.current;
    try {
      const res = await api.get('/providers/lawyers', { params: paramsFor(place, { page: page + 1 }) });
      if (seq !== reqSeq.current || !mountedRef.current) return;
      const rows = unwrapList<DirectoryLawyer>(res.data, 'lawyers');
      setLawyers(prev => {
        const seen = new Set(prev.map(l => l.id));
        const next = [...prev, ...rows.filter(l => !seen.has(l.id))];
        setHasMore(total != null ? next.length < total && rows.length > 0 : rows.length >= PAGE_SIZE);
        return next;
      });
      setPage(n => n + 1);
    } catch (e) {
      if (mountedRef.current) showToast(apiErrorMessage(e, t('x_lawyers_could_not_load_lawyers')), 'error');
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasMore, place, loading, paramsFor, page, total, showToast]);

  // First visit: ask what kind of help; afterwards search right away.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    AsyncStorage.getItem('lawyers_need_shown')
      .then(shown => { if (shown) search(null); else { setShowNeedModal(true); setLoading(false); } })
      .catch(() => search(null));
  }, [search]);

  // Filters changed → same place, new filters.
  const filtersRef = useRef({ caseType, language, proBonoOnly });
  useEffect(() => {
    const prev = filtersRef.current;
    if (prev.caseType === caseType && prev.language === language && prev.proBonoOnly === proBonoOnly) return;
    filtersRef.current = { caseType, language, proBonoOnly };
    search(place);
  }, [caseType, language, proBonoOnly, place, search]);

  // Saved lawyers: which cards show as saved; finish a save started before signing in.
  const loadSaved = useCallback(async () => {
    const token = await secureStorage.getToken().catch(() => null);
    if (!token) { setSavedMap({}); return; }
    try {
      const pending = await AsyncStorage.getItem(PENDING_SAVE_KEY).catch(() => null);
      if (pending) {
        await AsyncStorage.removeItem(PENDING_SAVE_KEY).catch(() => {});
        const id = Number(JSON.parse(pending)?.provider_id);
        if (Number.isFinite(id) && id > 0) {
          await api.post('/saved/lawyers', { provider_id: id });
          showToast(t('lw_saved_toast'), 'success');
        }
      }
      const res = await api.get('/saved/lawyers');
      const map: Record<number, number> = {};
      for (const s of unwrapList<{ id: number; provider_id: number | null }>(res.data, 'lawyers')) if (s.provider_id) map[s.provider_id] = s.id;
      if (mountedRef.current) setSavedMap(map);
    } catch { /* saved state is a convenience; the list still works */ }
  }, [showToast]);
  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved]));

  const toggleSave = useCallback(async (l: DirectoryLawyer) => {
    const token = await secureStorage.getToken().catch(() => null);
    if (!token) {
      await AsyncStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ provider_id: l.id })).catch(() => {});
      showToast(t('lw_sign_in_to_save'), 'info');
      navigation.navigate('MoreTab', { screen: 'Login' });
      return;
    }
    setSavingId(l.id);
    try {
      const sid = savedMap[l.id];
      if (sid) {
        await api.delete(`/saved/lawyers/${sid}`).catch((e) => { if (e?.response?.status !== 404) throw e; });
        setSavedMap(m => { const n = { ...m }; delete n[l.id]; return n; });
        showToast(t('lw_unsaved_toast'), 'info');
      } else {
        const r = await api.post('/saved/lawyers', { provider_id: l.id });
        if (r.data?.id) setSavedMap(m => ({ ...m, [l.id]: Number(r.data.id) }));
        showToast(t('lw_saved_toast'), 'success');
      }
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_lawyers_could_not_update_saved')), 'error');
    } finally {
      if (mountedRef.current) setSavingId(null);
    }
  }, [savedMap, navigation, showToast]);

  const toggleSelect = useCallback((id: number) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev));
  }, []);
  const messageOne = useCallback((l: DirectoryLawyer) => { setSelected([l.id]); setBulkResult(null); setShowBulk(true); }, []);

  const sendBulk = useCallback(async () => {
    if (!bulkMsg.trim() || selected.length === 0) return;
    setBulkSending(true);
    try {
      const res = await api.post('/messages/bulk', { lawyer_ids: selected, message: bulkMsg.trim() });
      const sent = Number(res.data?.sent) || 0;
      const skipped: { name?: string; phone?: string | null; reason?: string }[] = Array.isArray(res.data?.skipped) ? res.data.skipped : [];
      const noAccount = skipped.filter(s => s.reason === 'no_account');
      let text = sent > 0 ? t(sent === 1 ? 'x_lawyers_sent_attorney_one' : 'x_lawyers_sent_attorney_other', { sent }) : t('x_lawyers_no_app_messages_were');
      if (noAccount.length) {
        text += '\n' + t(noAccount.length === 1 ? 'x_lawyers_not_app_messaging_one' : 'x_lawyers_not_app_messaging_other', { count: noAccount.length, list: noAccount.map(s => (s.phone ? `${s.name} (${s.phone})` : s.name)).join(', ') });
      }
      setBulkResult(text);
      if (sent > 0) { setSelected([]); setBulkMsg(''); }
    } catch (e) {
      setBulkResult('❌ ' + apiErrorMessage(e, t('x_lawyers_send_failed_check_connection')));
    } finally {
      setBulkSending(false);
    }
  }, [bulkMsg, selected]);

  const submitQuery = () => {
    const q = queryText.trim();
    if (!q) { search(null); return; }
    search({ kind: 'query', q });
  };
  const useMyLocation = () => { setQueryText(''); search(null); };

  const placeLabel = useMemo(() => {
    if (!place) return '';
    if (place.kind === 'gps') return place.label;
    if (place.kind === 'query') return t('lw_results_for', { q: place.q });
    if (place.kind === 'state') return t('lw_in_state', { state: stateName(place.state) });
    return t('lw_all_listings');
  }, [place]);

  const pickNeed = async (key: string) => {
    await AsyncStorage.setItem('lawyers_need_shown', 'true').catch(() => {});
    setShowNeedModal(false);
    if (key === 'Immigration') { navigation.navigate('MoreTab', { screen: 'IceDetention' }); search(null); return; }
    // A new case type re-runs the search through the filters effect; otherwise search now.
    if (key !== caseType) setCaseType(key); else search(null);
  };

  const emptyText = activeFilters > 0
    ? t('lw_empty_filtered', { filters: [caseType && caseTypeLabel(caseType), language && langLabel(language), proBonoOnly && t('x_lawyers_pro_bono')].filter(Boolean).join(' · ') })
    : place?.kind === 'query' ? t('lw_empty_query', { q: place.q }) : t('x_lawyers_no_lawyers_found_area');

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]} testID="lawyers-screen">
      <View style={[styles.headerBar, { backgroundColor: colors.bgCard, borderBottomColor: colors.navy }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.headingRow}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.heading, { color: colors.textBrand }]} numberOfLines={1}>{t('lawyers_heading')}</Text>
              {total != null && !loading && (
                <View style={[styles.resultBadge, { backgroundColor: colors.legal }]} testID="lawyers-total">
                  <Text maxFontSizeMultiplier={1.3} style={[styles.resultBadgeText, { color: colors.textOnAccent }]}>{t('x_lawyers_found', { length: total })}</Text>
                </View>
              )}
            </View>
            {!!placeLabel && <Text testID="lawyers-place" maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.locationLabel, { color: colors.info }]}>📍 {placeLabel}</Text>}
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('saved_title')} style={styles.savedHeaderBtn}
            testID="lawyer-save-button" onPress={() => navigation.navigate('MoreTab', { screen: 'SavedLawyers' })}>
            <Text maxFontSizeMultiplier={1.3} style={styles.savedHeaderBtnText}>{t('x_lawyers_saved')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.searchRow}>
          <TextInput testID="lawyers-search-input"
            style={[styles.searchInput, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg, color: colors.inputText }]}
            placeholder={t('lw_search_placeholder')} placeholderTextColor={colors.placeholder}
            value={queryText} onChangeText={setQueryText} onSubmitEditing={submitQuery}
            returnKeyType="search" autoCorrect={false} maxLength={100} accessibilityLabel={t('lw_search_placeholder')} />
          <TouchableOpacity accessibilityRole="button" testID="lawyers-search-submit" style={[styles.searchBtn, { backgroundColor: colors.navy }]} onPress={submitQuery}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.searchBtnText, { color: colors.textOnNavy }]}>{t('search')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipRow}>
          <TouchableOpacity accessibilityRole="button" testID="lawyers-use-location" style={[styles.chip, { borderColor: colors.border }]} onPress={useMyLocation}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, { color: colors.textSecond }]} numberOfLines={1}>{t('lw_use_location')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="lawyers-filters" style={[styles.chip, { borderColor: activeFilters ? colors.navy : colors.border }]} onPress={() => setShowFilters(true)}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, { color: activeFilters ? colors.textBrand : colors.textSecond }]} numberOfLines={1}>
              {t('x_lawyers_filters', { value: activeFilters > 0 ? ` (${activeFilters})` : '' })}
            </Text>
          </TouchableOpacity>
        </View>
        {locationOff && !queryText && place?.kind !== 'query' && (
          <Text testID="lawyers-location-off" maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>{t('lw_location_off')}</Text>
        )}
      </View>

      {loading ? (
        <View style={{ padding: 12 }}>{[0, 1, 2].map(i => <SkeletonCard key={i} />)}</View>
      ) : error ? (
        <View style={styles.emptyBlock} testID="lawyers-error">
          <Text maxFontSizeMultiplier={1.4} style={[styles.emptyText, { color: colors.textMuted }]}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" style={[styles.emptyBtn, { backgroundColor: colors.navy }]} onPress={() => search(place)}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBtnText, { color: colors.textOnNavy }]}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList testID="lawyer-list"
          data={lawyers}
          keyExtractor={i => String(i.id)}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          extraData={{ selected, reviewSummaries, savedMap, savingId }}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => search(place, true)} tintColor={colors.navy} />}
          ListHeaderComponent={caseType && ['DUI', 'Drug Offenses', 'Assault'].includes(caseType) && lawyers.length > 0 ? (
            <TouchableOpacity accessibilityRole="button" style={[styles.walkthroughBanner, { backgroundColor: colors.bgSubtle }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'WhatHappensNext', params: { chargeType: caseType } })}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.walkthroughBannerText, { color: colors.textBrand }]}>{t('x_lawyers_know_what_expect_with', { caseType: caseTypeLabel(caseType) })}</Text>
            </TouchableOpacity>
          ) : null}
          ListFooterComponent={lawyers.length > 0 ? (
            loadingMore ? <ActivityIndicator color={colors.navy} style={{ padding: 16 }} />
              : !hasMore ? <Text testID="lawyers-end" maxFontSizeMultiplier={1.4} style={[styles.resultCount, { color: colors.textMuted }]}>{t(lawyers.length === 1 ? 'x_lawyers_lawyer_found_one' : 'x_lawyers_lawyer_found_other', { length: lawyers.length })} · {t('lw_end')}</Text>
                : null
          ) : null}
          ListEmptyComponent={
            <View style={styles.emptyBlock} testID="lawyers-empty">
              <AppIcon name="scale-outline" size={24} color={colors.textBrand} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.emptyText, { color: colors.textMuted }]}>{emptyText}</Text>
              {activeFilters > 0 ? (
                <TouchableOpacity accessibilityRole="button" testID="lawyers-clear-filters" style={[styles.emptyBtn, { backgroundColor: colors.navy }]}
                  onPress={() => { setCaseType(''); setLanguage(''); setProBonoOnly(false); }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBtnText, { color: colors.textOnNavy }]}>{t('x_lawyers_clear_all_filters')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity accessibilityRole="button" style={[styles.emptyBtn, { backgroundColor: colors.navy }]} onPress={useMyLocation}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBtnText, { color: colors.textOnNavy }]}>{t('lw_use_location')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <LawyerCard item={item} navigation={navigation}
              savedId={savedMap[item.id] ?? null} onToggleSave={toggleSave} saving={savingId === item.id}
              isSelected={selected.includes(item.id)} onToggleSelect={toggleSelect} onMessage={messageOne}
              reviewSummary={reviewSummaries[item.id]} onBadgeInfo={setBadgeInfo} />
          )}
        />
      )}

      {/* First visit: "What do you need help with?" */}
      <Modal accessibilityViewIsModal visible={showNeedModal} transparent animationType="fade" onRequestClose={() => pickNeed('')}>
        <View style={styles.needOverlay}>
          <View style={[styles.needSheet, { backgroundColor: colors.bgCard }]} testID="lawyers-need-modal">
            <Text maxFontSizeMultiplier={1.3} style={[styles.needTitle, { color: colors.textBrand }]}>{t('lawyers_need_title')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.needSub, { color: colors.textSecond }]}>{t('lawyers_need_sub')}</Text>
            <View style={styles.needGrid}>
              {QUICK_NEEDS().map(n => (
                <TouchableOpacity accessibilityRole="button" key={n.key || 'other'} testID={`need-${n.key || 'other'}`}
                  style={[styles.needBtn, { backgroundColor: n.bg, borderColor: n.color + '55' }]} onPress={() => pickNeed(n.key)}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.needBtnIcon}>{n.icon}</Text>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.needBtnLabel, { color: n.color }]}>{n.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <FilterModal visible={showFilters} onClose={() => setShowFilters(false)} caseType={caseType} language={language} proBonoOnly={proBonoOnly}
        onApply={(f) => { setShowFilters(false); setCaseType(f.caseType); setLanguage(f.language); setProBonoOnly(f.proBonoOnly); }} />

      {/* Verified badge explainer */}
      <Modal accessibilityViewIsModal visible={!!badgeInfo} transparent animationType="fade" onRequestClose={() => setBadgeInfo(null)}>
        <View style={styles.badgeOverlay}>
          <View style={[styles.badgeSheet, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeSheetTitle, { color: colors.textPrimary }]}>
              {badgeInfo === 'jtb' ? t('x_lawyers_justice_gavel_verified') : t('x_expungement_bar_verified')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeSheetBody, { color: colors.textPrimary }]}>
              {badgeInfo === 'jtb' ? t('x_lawyers_this_attorney_has_been') : t('x_lawyers_this_attorney_s_bar')}
            </Text>
            {badgeInfo === 'bar' && <Text maxFontSizeMultiplier={1.4} style={[styles.badgeSheetBody, { color: colors.textMuted }]}>{t('x_lawyers_re_verified_quarterly_can')}</Text>}
            <TouchableOpacity accessibilityRole="button" style={[styles.applyBtn, { marginTop: 8 }]} onPress={() => setBadgeInfo(null)}>
              <Text maxFontSizeMultiplier={1.4} style={styles.applyBtnText}>{t('x_lawyers_got_it')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Contact several attorneys (on the app) */}
      {selected.length > 0 && !showBulk && (
        <TouchableOpacity accessibilityRole="button" testID="lawyers-contact-selected" style={[styles.fab, { backgroundColor: colors.navy }]} onPress={() => { setBulkResult(null); setShowBulk(true); }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.fabText, { color: colors.textOnNavy }]}>
            {t(selected.length === 1 ? 'x_lawyers_contact_attorney_one' : 'x_lawyers_contact_attorney_other', { length: selected.length })}
          </Text>
        </TouchableOpacity>
      )}
      <Modal accessibilityViewIsModal visible={showBulk} transparent animationType="slide" onRequestClose={() => setShowBulk(false)}>
        <View style={styles.bulkOverlay}>
          <View style={[styles.bulkSheet, { backgroundColor: colors.bgCard }]} testID="lawyers-bulk-sheet">
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeSheetTitle, { color: colors.textPrimary }]}>
              {t(selected.length === 1 ? 'x_lawyers_contact_attorney_one' : 'x_lawyers_contact_attorney_other', { length: Math.max(selected.length, 1) })}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeSheetBody, { color: colors.textMuted }]}>{t('x_lawyers_message_will_be_sent')}</Text>
            <TextInput
              style={[styles.bulkInput, { borderColor: colors.inputBorder, color: colors.inputText, backgroundColor: colors.inputBg }]}
              placeholder={t('x_lawyers_briefly_describe_situation_what')} placeholderTextColor={colors.placeholder}
              value={bulkMsg} onChangeText={setBulkMsg} multiline maxLength={500} accessibilityLabel={t('x_lawyers_message_send_selected_attorneys')} />
            {!!bulkResult && (
              <Text testID="lawyers-bulk-result" maxFontSizeMultiplier={1.4} style={[styles.bulkResult, { color: bulkResult.startsWith('❌') ? colors.emergencyDark : colors.legalDark }]}>{bulkResult}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity accessibilityRole="button" style={[styles.bulkCancel, { borderColor: colors.border }]} onPress={() => setShowBulk(false)}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontWeight: '700' }}>{bulkResult ? t('booking_done') : t('case_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.bulkSend, { backgroundColor: bulkSending || !bulkMsg.trim() || !selected.length ? colors.bgSubtle : colors.navy }]}
                onPress={sendBulk} disabled={bulkSending || !bulkMsg.trim() || !selected.length}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: bulkSending || !bulkMsg.trim() || !selected.length ? colors.textMuted : colors.textOnNavy, fontWeight: '700' }}>
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 2, ...SHADOW.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  heading: { fontSize: 22, ...FONTS.black, flexShrink: 1 },
  resultBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  resultBadgeText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  locationLabel: { fontSize: 12, marginTop: 2 },
  savedHeaderBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.warn + '60', backgroundColor: COLORS.warn + '10' },
  savedHeaderBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.warnDark },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  searchInput: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  searchBtn: { borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', minHeight: 44 },
  searchBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { flexShrink: 1, borderWidth: 1.5, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 7, minHeight: 44, justifyContent: 'center' },
  chipText: { fontSize: 12, lineHeight: 18, ...FONTS.semi },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  listContent: { padding: 12, paddingBottom: 96 },
  resultCount: { textAlign: 'center', fontSize: 12, padding: 16 },
  emptyBlock: { alignItems: 'center', padding: 32, gap: 12 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  emptyBtn: { borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 20, minHeight: 44 },
  emptyBtnText: { ...FONTS.bold },
  card: { borderRadius: RADIUS.lg, padding: 14, marginBottom: 10, ...SHADOW.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardName: { fontSize: 16, lineHeight: 22, ...FONTS.heavy },
  cardAddress: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  ratingBlock: { flexDirection: 'row', alignItems: 'center' },
  ratingNum: { fontSize: 15, lineHeight: 22, ...FONTS.heavy },
  ratingStar: { fontSize: 14, marginLeft: 1 },
  reviewCount: { fontSize: 11, marginLeft: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 11, lineHeight: 16, ...FONTS.semi },
  reviewSummary: { fontSize: 12, lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  secondaryBtn: { flexGrow: 1, flexBasis: '30%', minHeight: 44, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  walkthroughBanner: { borderRadius: RADIUS.md, padding: 12, marginBottom: 8 },
  walkthroughBannerText: { fontSize: 12, lineHeight: 18 },
  modalContainer: { flex: 1 },
  modalHeader: { backgroundColor: COLORS.navy, padding: 20, paddingTop: Platform.OS === 'ios' ? 52 : 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, ...FONTS.black, color: COLORS.white, flexShrink: 1 },
  modalCloseBtn: { padding: 10 },
  modalCloseText: { fontSize: 20, color: COLORS.white, ...FONTS.semi },
  modalBody: { padding: 20, paddingBottom: 40 },
  filterLabel: { fontSize: 12, ...FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  pickerWrap: { borderWidth: 1.5, borderRadius: RADIUS.md, overflow: 'hidden' },
  picker: { height: 48, borderWidth: 0, paddingHorizontal: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, paddingVertical: 6, gap: 12 },
  toggle: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.white },
  knobOn: { transform: [{ translateX: 20 }] },
  toggleLabel: { fontSize: 14, lineHeight: 21, flex: 1 },
  applyBtn: { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  applyBtnText: { color: COLORS.white, ...FONTS.black, fontSize: 15, lineHeight: 22 },
  clearBtn: { alignItems: 'center', paddingVertical: 16 },
  clearBtnText: { fontSize: 14, lineHeight: 21, ...FONTS.semi },
  needOverlay: { flex: 1, backgroundColor: 'rgba(2,14,28,0.82)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  needSheet: { borderRadius: 24, padding: 20, width: '100%', maxWidth: 420 },
  needTitle: { fontSize: 20, lineHeight: 26, fontFamily: 'Inter_900Black', fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  needSub: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 16 },
  needGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  needBtn: { width: '47%', paddingVertical: 14, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', borderWidth: 1.5 },
  needBtnIcon: { fontSize: 26, marginBottom: 6 },
  needBtnLabel: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textAlign: 'center' },
  badgeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  badgeSheet: { borderRadius: 16, padding: 20, borderWidth: 1 },
  badgeSheetTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700', marginBottom: 8 },
  badgeSheetBody: { fontSize: 14, lineHeight: 21, marginBottom: 10 },
  fab: { position: 'absolute', bottom: 24, left: 16, right: 16, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  fabText: { fontWeight: '700', fontSize: 15, lineHeight: 22 },
  bulkOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  bulkSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  bulkInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 21, minHeight: 100, textAlignVertical: 'top', marginBottom: 12 },
  bulkResult: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 10 },
  bulkCancel: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  bulkSend: { flex: 2, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
});

export default React.memo(LawyersScreen);
