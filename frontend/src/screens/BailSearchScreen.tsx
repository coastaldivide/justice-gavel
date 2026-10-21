/**
 * BailSearchScreen — bail-agent directory (real listings; read only).
 *
 * Nearest first from the phone's location; without permission the person's
 * state (or the whole directory) with a prompt to type a city, state, ZIP or
 * name. Filters: open 24/7 (from the listing's stored hours) and payment
 * plans — both narrow on the server. Infinite scroll to the end. Every card:
 * call (number shown formatted) / text / directions / website. If the network
 * fails, the last results are shown and labelled as saved.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { cacheBailAgents, getCachedBailAgents } from '../services/offlineCache';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { ContactActions } from '../components/ContactActions';
import { t, useLang } from '../i18n';
import { getLocationWithCity, formatDistance } from '../services/location';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { getUserState, stateName } from '../utils/userState';
import { useTheme } from '../constants/theme';

const PAGE_SIZE = 20;

type BailAgent = {
  id: number; name: string; company?: string | null; city?: string | null; state?: string | null;
  phone?: string | null; address?: string | null; lat?: number | null; lng?: number | null; website?: string | null;
  distanceKm?: number | null; rating?: number | null; reviews?: number | null;
  license_number?: string | null; payment_plans?: boolean; open_now?: boolean | null; open_24_7?: boolean;
};
type Place = { kind: 'gps'; lat: number; lng: number; label: string } | { kind: 'query'; q: string } | { kind: 'state'; state: string } | { kind: 'all' };

function SkeletonCard() {
  const { colors } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // isInteraction:false — an endless loop must not hold InteractionManager.
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
      <View style={{ height: 48, borderRadius: 12, backgroundColor: colors.bgSubtle }} />
    </Animated.View>
  );
}

const AgentCard = React.memo(function AgentCard({ item }: { item: BailAgent }) {
  useLang();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }]} testID="bail-agent-card">
      <View style={styles.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={[styles.cardName, { color: colors.textPrimary }]}>{item.name}</Text>
          {!!item.company && item.company !== item.name && <Text maxFontSizeMultiplier={1.3} style={[styles.cardSub, { color: colors.textSecond }]}>{item.company}</Text>}
          {!!item.address && <Text maxFontSizeMultiplier={1.3} style={[styles.cardSub, { color: colors.textMuted }]}>{item.address}</Text>}
        </View>
        {item.rating != null && (
          <View style={styles.ratingBlock} accessibilityLabel={t('lw_rating_a11y', { rating: item.rating.toFixed(1), count: item.reviews ?? 0 })}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.ratingNum, { color: colors.textPrimary }]}>{item.rating.toFixed(1)}</Text>
            <AppIcon name={ICONS.starFilled} size={20} color={colors.goldText} style={{ color: colors.goldText }} />
            <Text maxFontSizeMultiplier={1.3} style={[styles.reviewCount, { color: colors.textMuted }]}>({item.reviews ?? 0})</Text>
          </View>
        )}
      </View>
      <View style={styles.badgeRow}>
        {item.distanceKm != null && <View style={[styles.badge, { borderColor: colors.border }]}><IconLabel icon={ICONS.location} textStyle={[styles.badgeText, { color: colors.textSecond }]} maxFontSizeMultiplier={1.3}>{formatDistance(item.distanceKm)}</IconLabel></View>}
        {item.open_24_7 ? (
          <View style={[styles.badge, { borderColor: colors.legal, backgroundColor: colors.legalBg }]}><Text maxFontSizeMultiplier={1.3} style={[styles.badgeText, { color: colors.legal }]}>{t('lw_open_24_7')}</Text></View>
        ) : item.open_now != null && (
          <View style={[styles.badge, { borderColor: colors.border, backgroundColor: item.open_now ? colors.legalBg : colors.bgSubtle }]}><Text maxFontSizeMultiplier={1.3} style={[styles.badgeText, { color: item.open_now ? colors.legalDark : colors.textMuted }]}>{item.open_now ? t('lw_open_now') : t('lw_closed_now')}</Text></View>
        )}
        {item.payment_plans && <View style={[styles.badge, { borderColor: colors.border }]}><IconLabel icon={ICONS.card} textStyle={[styles.badgeText, { color: colors.textSecond }]} maxFontSizeMultiplier={1.3}>{t('x_bail_search_payment_plans')}</IconLabel></View>}
        {!!item.license_number && <View style={[styles.badge, { borderColor: colors.border }]}><IconLabel icon={ICONS.idCard} textStyle={[styles.badgeText, { color: colors.textSecond }]} maxFontSizeMultiplier={1.3}>{t('x_bail_search_lic', { value: '', license_number: item.license_number })}</IconLabel></View>}
      </View>
      <ContactActions listing={item} primaryColor={colors.legalDark} />
    </View>
  );
});

function BailSearchScreen(): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [items, setItems] = useState<BailAgent[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [open24, setOpen24] = useState(false);
  const [paymentPlans, setPaymentPlans] = useState(false);
  const reqSeq = useRef(0);

  const paramsFor = useCallback((p: Place, extra: Record<string, unknown> = {}) => {
    const params: Record<string, unknown> = { limit: PAGE_SIZE, ...extra };
    if (open24) params.open24 = true;
    if (paymentPlans) params.paymentPlans = true;
    if (p.kind === 'gps') { params.lat = p.lat; params.lng = p.lng; }
    if (p.kind === 'query') params.q = p.q;
    if (p.kind === 'state') params.state = p.state;
    return params;
  }, [open24, paymentPlans]);

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

  const search = useCallback(async (p: Place | null, isRefresh = false) => {
    const seq = ++reqSeq.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const where = p || await resolveDefaultPlace();
      if (seq !== reqSeq.current) return;
      setPlace(where);
      const res = await api.get('/providers/bail', { params: paramsFor(where) });
      if (seq !== reqSeq.current || !mountedRef.current) return;
      const rows = unwrapList<BailAgent>(res.data, 'agents');
      const tot = Number(res.headers?.['x-total-count']);
      setItems(rows);
      setTotal(Number.isFinite(tot) ? tot : rows.length);
      setPage(1);
      setHasMore(Number.isFinite(tot) ? rows.length < tot : rows.length >= PAGE_SIZE);
      setFromCache(false);
      cacheBailAgents(rows).catch(() => {});
    } catch (e) {
      if (seq !== reqSeq.current || !mountedRef.current) return;
      const cached = await getCachedBailAgents().catch(() => ({ agents: [] as unknown[] }));
      if (cached.agents.length) {
        setItems(cached.agents as BailAgent[]);
        setTotal(null); setHasMore(false); setFromCache(true);
      } else {
        setError(apiErrorMessage(e, t('x_bail_search_could_not_connect_check')));
      }
    } finally {
      if (seq === reqSeq.current && mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [paramsFor, resolveDefaultPlace]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !place || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = reqSeq.current;
    try {
      const res = await api.get('/providers/bail', { params: paramsFor(place, { page: page + 1 }) });
      if (seq !== reqSeq.current || !mountedRef.current) return;
      const rows = unwrapList<BailAgent>(res.data, 'agents');
      setItems(prev => {
        const seen = new Set(prev.map(a => a.id));
        const next = [...prev, ...rows.filter(a => !seen.has(a.id))];
        setHasMore(total != null ? next.length < total && rows.length > 0 : rows.length >= PAGE_SIZE);
        return next;
      });
      setPage(n => n + 1);
    } catch {
      if (mountedRef.current) setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasMore, place, loading, paramsFor, page, total]);

  const startedRef = useRef(false);
  useEffect(() => { if (!startedRef.current) { startedRef.current = true; search(null); } }, [search]);
  const filtersRef = useRef({ open24, paymentPlans });
  useEffect(() => {
    if (filtersRef.current.open24 === open24 && filtersRef.current.paymentPlans === paymentPlans) return;
    filtersRef.current = { open24, paymentPlans };
    search(place);
  }, [open24, paymentPlans, place, search]);

  const submitQuery = () => { const q = queryText.trim(); search(q ? { kind: 'query', q } : null); };
  const useMyLocation = () => { setQueryText(''); search(null); };

  const placeLabel = useMemo(() => {
    if (!place) return '';
    if (place.kind === 'gps') return place.label;
    if (place.kind === 'query') return t('lw_results_for', { q: place.q });
    if (place.kind === 'state') return t('lw_in_state', { state: stateName(place.state) });
    return t('lw_all_listings');
  }, [place]);

  const filterChip = (on: boolean, toggle: () => void, label: string, testID: string) => (
    <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: on }} testID={testID} onPress={toggle}
      style={[styles.chip, { borderColor: on ? colors.navy : colors.border, backgroundColor: on ? colors.navy : colors.bgCard }]}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.chipText, { color: on ? colors.textOnNavy : colors.textSecond }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View testID="bail-search-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { backgroundColor: colors.emergencyBg }]}>
        <View style={styles.headerRow}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.heading, { color: colors.textPrimary }]} numberOfLines={1}>{t('bail_heading')}</Text>
          {total != null && !loading && (
            <View style={[styles.countPill, { backgroundColor: colors.bgCard }]} testID="bail-total">
              <Text maxFontSizeMultiplier={1.3} style={[styles.countPillText, { color: colors.textPrimary }]}>{t('bs_count', { count: total })}</Text>
            </View>
          )}
        </View>
        {!!placeLabel && <IconLabel icon={ICONS.location} textStyle={[styles.sub, { color: colors.textSecond }]} maxFontSizeMultiplier={1.3} numberOfLines={1} testID="bail-place">{placeLabel}</IconLabel>}
        <View style={styles.searchRow}>
          <TextInput testID="bail-search-city-input"
            style={[styles.searchInput, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg, color: colors.inputText }]}
            placeholder={t('lw_search_placeholder')} placeholderTextColor={colors.placeholder}
            value={queryText} onChangeText={setQueryText} onSubmitEditing={submitQuery} returnKeyType="search" autoCorrect={false} maxLength={100}
            accessibilityLabel={t('lw_search_placeholder')} />
          <TouchableOpacity accessibilityRole="button" testID="bail-search-submit-button" style={[styles.searchBtn, { backgroundColor: colors.emergencyDark }]} onPress={submitQuery}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.searchBtnText, { color: colors.white }]}>{t('search')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipRow}>
          <TouchableOpacity accessibilityRole="button" testID="bail-use-location" style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.bgCard }]} onPress={useMyLocation}>
            <IconLabel icon={ICONS.location} textStyle={[styles.chipText, { color: colors.textSecond }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>{t('lw_use_location')}</IconLabel>
          </TouchableOpacity>
          {filterChip(open24, () => setOpen24(v => !v), t('lw_open_24_7'), 'bail-filter-24')}
          {filterChip(paymentPlans, () => setPaymentPlans(v => !v), t('x_bail_search_payment_plans'), 'bail-filter-plans')}
        </View>
        {locationOff && place?.kind !== 'query' && <Text testID="bail-location-off" maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>{t('lw_location_off')}</Text>}
        {fromCache && <Text testID="bail-from-cache" maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.warnDark }]}>{t('x_bail_search_showing_cached_results_check')}</Text>}
      </View>

      {loading ? (
        <View style={{ padding: 12 }}>{[0, 1, 2].map(i => <SkeletonCard key={i} />)}</View>
      ) : error ? (
        <View style={styles.empty} testID="bail-search-error">
          <Text maxFontSizeMultiplier={1.3} style={[styles.emptyText, { color: colors.textMuted }]}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" style={[styles.emptyBtn, { backgroundColor: colors.navy }]} onPress={() => search(place)}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textOnNavy, fontWeight: '700' }}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList testID="bail-agent-list"
          data={items}
          keyExtractor={item => String(item.id)}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onRefresh={() => search(place, true)}
          refreshing={refreshing}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          ListEmptyComponent={
            <View testID="bail-search-empty" style={styles.empty}>
              <AppIcon name="search-outline" size={24} color={colors.textBrand} />
              <Text maxFontSizeMultiplier={1.3} style={[styles.emptyText, { color: colors.textMuted }]}>
                {open24 || paymentPlans ? t('bs_empty_filtered') : place?.kind === 'query' ? t('lw_empty_query', { q: place.q }) : t('bail_no_results')}
              </Text>
            </View>
          }
          ListFooterComponent={items.length > 0 ? (loadingMore ? <ActivityIndicator color={colors.textBrand} style={{ padding: 16 }} />
            : !hasMore && !fromCache ? <Text testID="bail-end" maxFontSizeMultiplier={1.3} style={[styles.end, { color: colors.textMuted }]}>{t('bs_count', { count: items.length })} · {t('lw_end')}</Text> : null) : null}
          renderItem={({ item }) => <AgentCard item={item} />}
        />
      )}
      <View style={[styles.footerNote, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, color: colors.textSecond, lineHeight: 16, textAlign: 'center' }}>{t('bc_fee_note')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 16, paddingTop: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 22, lineHeight: 28, fontFamily: 'Inter_900Black', fontWeight: '900', flexShrink: 1 },
  countPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  countPillText: { fontSize: 12, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 3 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  searchInput: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  searchBtn: { borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', minHeight: 44 },
  searchBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, minHeight: 44, justifyContent: 'center', maxWidth: '100%' },
  chipText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  card: { borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  cardSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  ratingBlock: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  ratingNum: { fontSize: 15, fontWeight: '800' },
  reviewCount: { fontSize: 11, marginLeft: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 28, gap: 12 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyBtn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, minHeight: 44 },
  end: { textAlign: 'center', fontSize: 12, padding: 16 },
  footerNote: { paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1 },
});

export default React.memo(BailSearchScreen);
