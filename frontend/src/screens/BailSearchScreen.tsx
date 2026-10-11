import { useToast } from '../components/ToastProvider';
import { cacheBailAgents, getCachedBailAgents } from '../services/offlineCache';
import { AppIcon } from '../components/AppIcon';
import { t, initLang } from '../i18n';
import { hapticCall } from '../services/haptics';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLatestRef } from '../hooks/useLatestRef';
import {ActivityIndicator, Animated, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, LayoutAnimation} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { getLocation, formatDistance } from '../services/location';
import { api }             from '../services/api';
import { getUserState } from '../utils/userState';
import { COLORS, useTheme } from '../constants/theme';

// RULES OF HOOKS FIX: `callPhone` is a plain helper, not a component, but
// called Haptics, Toast hooks in its body -- React throws
// "Invalid hook call" the instant this screen mounts. Converted to a
// custom hook (`useCallPhone`) that returns the helper, so the
// hooks run in a legal position and callers get the same function.
function useCallPhone() {
  const { showToast } = useToast();
  return function callPhone(phone: string) {
    hapticCall();
    Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => showToast('Calling is unavailable on this device.', 'error'));
  };
}
function openDirections(lat: number, lng: number, name: string, onError?: () => void) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => onError?.());
}


/** Cities offered in the GPS-denied fallback box. */
const CITY_SUGGESTIONS = [
  'Nashville, TN', 'Memphis, TN', 'Knoxville, TN', 'Chattanooga, TN',
  'Atlanta, GA', 'Houston, TX', 'Dallas, TX', 'Austin, TX',
  'Charlotte, NC', 'Phoenix, AZ', 'Denver, CO', 'Seattle, WA',
  'Detroit, MI', 'Baltimore, MD', 'Kansas City, MO', 'Milwaukee, WI',
  'Albuquerque, NM', 'Louisville, KY', 'Indianapolis, IN',
];

// ── Skeleton placeholder card ─────────────────────────────────────────────
function SkeletonCard({ colors }: { colors: ThemeColors }) {
  const shimmer = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

function BailSearchScreen(): React.JSX.Element {
  // These helpers are now custom hooks (they call useToast/useHaptics/
  // useConfirm internally). Invoke them here, in the component body,
  // where hooks are legal; the returned function behaves as before.
  const callPhone = useCallPhone();
  const { showToast } = useToast();

  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    getUserState().then(s => { if (s?.code) userStateRef.current = s.code; }).catch(()=>{});
  }, []);

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [_fetchError, _setFetchError] = useState<string|null>(null);


  const [cityQuery, setCityQuery] = useState('');
  // Suggestions for the GPS-denied city box: matching known cities, plus the
  // typed text itself so any city can be searched.
  const filteredCities = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (!q) return CITY_SUGGESTIONS;
    const matches = CITY_SUGGESTIONS.filter(c => c.toLowerCase().includes(q));
    return matches.some(c => c.toLowerCase() === q) ? matches : [cityQuery.trim(), ...matches];
  }, [cityQuery]);

  const [locationDenied, setLocationDenied] = useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [sortBy, setSortBy] = React.useState('rating');
  const [items, setItems]   = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Auto-search on mount -- no button tap required
  useEffect(() => { return () => { if (timerRef.current) clearTimeout(timerRef.current); }; }, []);

  // Mount-only auto-search; called through a ref so the effect does not
  // re-run each render (search is re-created every render).
  const searchRef = useLatestRef((cityOverride?: string) => search(cityOverride));
  useEffect(() => { Promise.resolve(initLang()).then(() => searchRef.current()).catch(() => {}); }, [searchRef]);

  const [retryCount, setRetryCount] = useState(0);
  const [filterAvailNow, setFilterAvailNow] = React.useState(false);
  const [filterVerified, setFilterVerified] = React.useState(false);
  const [filterPaymentPlan, setFilterPaymentPlan] = React.useState(false);

  const search = async (cityOverride?: string) => {
    setLoading(true);
    setLocationDenied(false);
    setStatus(cityOverride ? `Searching in ${cityOverride}…` : 'Getting your location…');

    try {
      let params: Record<string, unknown> = { radiusKm: 100, user_state: userStateRef.current || undefined };

      if (cityOverride) {
        // City provided directly -- no GPS needed
        params.city = cityOverride;
      } else {
        try {
          const { lat, lng } = await getLocation();
          params.lat = lat;
          params.lng = lng;
          setStatus('Finding nearby bail agents…');
        } catch {
          setLoading(false);
          // GPS denied -- show city picker instantly
          setLoading(false);
          setLocationDenied(true);
          setStatus('');
          return;
        }
      }

      // Retry with exponential backoff (up to 3 attempts)
      let res;
      let attempt = 0;
      while (attempt < 3) {
        try {
          res = await api.get('/providers/bail', { params });
          break;
        } catch (apiErr: any) {
          // CATCH BINDING MISMATCH. The catch bound `_`/`apiErr`/`shareErr` but the
          // body referenced `e`, which is not in scope -- a ReferenceError thrown
          // from inside an error handler, i.e. exactly when something has already
          // gone wrong. TS2304 flagged it; nothing at runtime would until it fired.
          console.warn('[BailSearch]', (apiErr as any)?.message ?? apiErr);
          attempt++;
          if (attempt >= 3) throw apiErr;
          setStatus(`Connection issue -- retrying (${attempt}/3)…`);
          await new Promise<void>(r => { timerRef.current = setTimeout(r, attempt * 800); });
        }
      }

      setItems(res.data || []);
      cacheBailAgents(res.data).catch(() => {});
      setSearched(true);
      setRetryCount(0);
      setStatus(res.data?.length === 0 ? 'No bail agents found in this area. Try a nearby city.' : '');
    } catch {
      // Try offline cache on failure
      const { agents: cached } = (await getCachedBailAgents().catch(() => ({ agents: [] }))) as any;
      if (cached.length > 0) {
        setItems(cached);
        setStatus('Showing cached results -- check your connection for live data.');
        setSearched(true);
        setLoading(false);
        return;
      }
      setStatus('');
      setRetryCount(n => n + 1);
      // After 2 failed attempts, offer city fallback
      if (retryCount >= 1) {
        setLocationDenied(true);
      } else {
        showToast('Could not connect. Check your internet connection.');
      }
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View testID="bail-search-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text testID="bail-agent-bail-amount" maxFontSizeMultiplier={1.4} style={styles.heading}>Bail Bond Help</Text>
          {items.length > 0 && !loading && (
            <View style={styles.countPill}>
              <Text maxFontSizeMultiplier={1.4} style={styles.countPillText}>{items.length} agents nearby</Text>
            </View>
          )}
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.sub}>
          {loading ? t('bail_sub_loading') : items.length > 0 ? t('bail_sub_results') : t('bail_sub_idle')}
        </Text>
      </View>

      <TouchableOpacity
          accessibilityRole="button" activeOpacity={0.6} style={styles.searchBtn} testID="bail-search-submit-button" onPress={() => search()} disabled={loading}
        accessibilityLabel="Searching…"
      >
        {loading
          ? <><ActivityIndicator color={colors.bgCard} style={{ marginRight: 8 }} /><Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>Searching…</Text></>
          : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>📍  Search Again</Text>
        }
      </TouchableOpacity>

      {loading && items.length === 0 && <>{/* SkeletonBailList never existed; SkeletonCard is the real component */}
        {[0,1,2,3].map(i => <SkeletonCard key={i} colors={colors as any} />)}</>}
      {!loading && !!status && <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>{status}</Text>}
      {items.length > 0 && (

      <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 8 }}>
        {(['rating','distance','rate']).map(s => (
          <TouchableOpacity
      accessibilityLabel={`Sort by ${s}`}
          accessibilityRole="button" key={s} onPress={() => setSortBy(s)}
            style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20,
              backgroundColor: sortBy === s ? colors.blue : colors.bgCard,
              borderWidth: 1, borderColor: sortBy === s ? colors.blue : colors.border }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: sortBy === s ? colors.bgCard : colors.textSecond, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>
              {s === 'rating' ? 'Rating' : s === 'distance' ? 'Nearest' : 'Low Rate'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      )}

      {/* Filter bar -- bail bondsman search */}
      <View style={{ flexDirection:'row', paddingHorizontal:12, paddingVertical:8, gap:8,
        borderBottomWidth:1, borderBottomColor:colors.border, backgroundColor:colors.bgSubtle }}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setFilterVerified(v => !v)}
          style={{ flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:12,
            paddingVertical:6, borderRadius:16, borderWidth:1,
            borderColor:filterVerified?colors.navy:colors.border,
            backgroundColor:filterVerified?colors.navy:colors.bgCard }}
          accessibilityLabel="Filter: JTB Verified only"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, fontWeight:'600',
            color:filterVerified?colors.bgCard:colors.textSecond }}>
            ✓ Verified Only
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setFilterAvailNow(v => !v)}
          style={{ flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:12,
            paddingVertical:6, borderRadius:16, borderWidth:1,
            borderColor:filterAvailNow?colors.legalDark:colors.border,
            backgroundColor:filterAvailNow?colors.legalBg:colors.bgCard }}
          accessibilityLabel="Filter: Available now"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, fontWeight:'600',
            color:filterAvailNow?colors.legalDark:colors.textSecond }}>
            🕐 Available Now
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setFilterPaymentPlan(v => !v)}
          style={{ flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:12,
            paddingVertical:7, borderRadius:16, borderWidth:1,
            borderColor:filterPaymentPlan?colors.gold:colors.border,
            backgroundColor:filterPaymentPlan?colors.warnBg:colors.bgCard }}
          accessibilityLabel="Filter: Payment plans available"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, fontWeight:'600',
            color:filterPaymentPlan?colors.warnDark:colors.textSecond }}>
            💳 Payment Plans
          </Text>
        </TouchableOpacity>
      </View>


          {_fetchError && (
            <View testID="bail-search-error" style={{ backgroundColor: colors.errorBg, padding: 12, margin: 8, borderRadius: 8 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: colors.emergency, fontSize: 13 }}>
                {_fetchError}
              </Text>
            </View>
          )}
      <FlashList testID="bail-agent-list"
          focusable
          keyExtractor={(item, index) => String(item?.id ?? item?.booking_number ?? index)}
          estimatedItemSize={80}
          keyboardShouldPersistTaps="handled"
          onRefresh={() => { setRefreshing(true); search().finally(() => setRefreshing(false)); }}
          refreshing={refreshing}
          data={(() => {
                let result = [...items];
                if (filterVerified)  result = (result ?? []).filter((b: BailAgent) => b.jtb_verified);
                if (filterAvailNow)  result = (result ?? []).filter((b: BailAgent) => b.available_24h || b.hours?.toLowerCase?.().includes('24'));
                if (filterPaymentPlan) result = (result ?? []).filter((b: BailAgent) => b.payment_plans || b.notes?.toLowerCase?.().includes('payment') || b.notes?.toLowerCase?.().includes('plan'));
                if (sortBy === 'rating') result.sort((a: BailAgent, b: BailAgent) => (b.rating||0)-(a.rating||0));
                if (sortBy === 'rate')   result.sort((a: BailAgent, b: BailAgent) => (a.rate||0)-(b.rate||0));
                if (sortBy === 'distance') result.sort((a: BailAgent, b: BailAgent) => (a.distanceKm||999)-(b.distanceKm||999));
                return result;
              })()
          }
          contentContainerStyle={{ padding: 12, paddingBottom: 40}}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              No bail agents found nearby. Try expanding your search area or call 911 for immediate help.
            </Text>
          }
          renderItem={({ item }) => (
          <View style={styles.card}>
          <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} ellipsizeMode="tail" style={styles.cardName}>{item?.name}</Text>
          {item.jtb_verified && (
          <View style={styles.verifiedBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.verifiedBadgeText}>✓ Verified</Text>
          </View>
          )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.cardAddress}>{item?.address}</Text>
          {item.hours && (
          <View style={styles.hoursBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.hoursText}>
          🕐 {item.hours === '24/7' ? '✓ Open 24/7' : item.hours}
          </Text>
          </View>
          )}
          {item.license_number && (
          <View style={styles.licensePill}>
          <Text maxFontSizeMultiplier={1.4} style={styles.licensePillText}>
          🪪 Lic {item.license_state ? `${item.license_state} ` : ''}{item.license_number}
          </Text>
          </View>
          )}
          {item.distanceKm != null && (
          <View style={styles.distBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.distText}>📍 {formatDistance(item.distanceKm)}</Text>
          </View>
          )}
          </View>
          <View style={styles.ratingBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.ratingNum}>{item?.rating?.toFixed(1) ?? '--'}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ratingStar}>★</Text>
          </View>
          </View>

          {/* ALWAYS-VISIBLE call button -- primary action */}
          {item?.phone ? (
          <TouchableOpacity accessibilityRole="button" testID="bail-agent-card"
          accessibilityLabel="Call bail agent"
          style={styles.callBtnBig}
          onPress={() => callPhone(item?.phone)}
          activeOpacity={0.85}
          accessibilityHint="Opens your phone dialer"
          >
          <Text testID="bail-agent-phone" maxFontSizeMultiplier={1.4} style={styles.callBtnBigText}>📞  CALL NOW  --  {item?.phone}</Text>
          </TouchableOpacity>
          ) : (
          <View style={styles.noPhoneBox}>
          <Text maxFontSizeMultiplier={1.4} style={styles.noPhoneText}>No phone number on file</Text>
          </View>
          )}

          {/* Secondary: directions */}
          {item.lat && item.lng && (
          <TouchableOpacity
          accessibilityRole="button"
          style={styles.dirBtn}
          accessibilityLabel={"\ud83d\uddfa  Get Directions"} onPress={() => openDirections(item.lat, item.lng, item?.name, () => showToast('Maps unavailable on this device.', 'error'))}
          >
          <Text maxFontSizeMultiplier={1.4} style={styles.dirBtnText}>🗺  Get Directions</Text>
          </TouchableOpacity>
          )}
          {item.hours && <Text maxFontSizeMultiplier={1.4} style={styles.hoursText}>🕐 {item.hours}</Text>}
          </View>
            
          )}
        />

      {/* City search box when GPS denied */}
      {locationDenied && (
        <View style={styles.cityFallback}>
          <Text maxFontSizeMultiplier={1.4} style={styles.cityFallbackTitle}>📍 What city are you in?</Text>
          <TextInput testID="bail-search-city-input"
            style={styles.citySearchInput}
            placeholder={t('bail_city_placeholder')}
            placeholderTextColor={colors.textMuted}
            value={cityQuery}
            onChangeText={setCityQuery}
            onSubmitEditing={() => {
              const q = cityQuery.trim();
              if (q) { setLocationDenied(false); setCityQuery(''); search(q); }
            }}
            autoFocus
            returnKeyType="search"
          blurOnSubmit
        />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Use My Location"
            onPress={() => { search(); }}
            style={{ flexDirection:'row', alignItems:'center', gap:6,
              paddingVertical:8, paddingHorizontal:12,
              backgroundColor:colors.infoBg, borderRadius:20, marginTop:6 }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14 }}>📍</Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, color:colors.textBrand, fontWeight:'600' }}>Use My Location</Text>
          </TouchableOpacity>
          <View style={styles.cityList}>
            {filteredCities.map(city => (
              <TouchableOpacity
      accessibilityLabel="Search" accessibilityRole="button"
                key={city}
                style={styles.cityRow}
                onPress={() => { setLocationDenied(false); setCityQuery(''); search(city); }}
                activeOpacity={0.75}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.cityRowIcon}>📍</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.cityRowText}>{city}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {searched && items.length === 0 && !loading && !locationDenied && (
        <View testID="bail-search-empty" style={styles.emptyState}>
          <AppIcon name="search-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>No bail agents found here.</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyHint}>Try a nearby city:</Text>
          <View style={styles.nearbyCities}>
            {['Memphis, TN','Nashville, TN','Atlanta, GA','Houston, TX','Detroit, MI'].map(city => (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Try wider search"
                key={city}
                style={styles.nearbyCityBtn}
                onPress={() => search(city)}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.nearbyCityText}>{city}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
          accessibilityRole="button" style={styles.pickCityBtn} accessibilityLabel={"\ud83d\udccd Pick a Different City"} onPress={() => setLocationDenied(true)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.pickCityBtnText}>📍 Pick a Different City</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
      {/* Legal accuracy disclaimer — required on all bail search results */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, paddingTop: 6, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 11, color: colors.textSecond, lineHeight: 16, textAlign: 'center' }}>
          Bail amounts are typical ranges only. Actual bail is set by a judge based on charge, 
          criminal history, and other factors. This is general information, not legal advice.
          Consult a licensed attorney before making any legal decisions.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

type ThemeColors = Record<string, string>;

type BailAgent = {
  id: number;
  name: string;
  city: string;
  state: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  rating?: number;
  reviews?: number;
  rate?: number;
  payment_plans?: boolean;
  available_24h?: boolean;
  hours?: string;
  license_number?: string;
  jtb_verified?: boolean | number;
  bar_verified?: boolean | number;
  notes?: string;
  website?: string;
};

const makeStyles = (colors: any) => StyleSheet.create({


  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { backgroundColor: colors.emergencyBg, padding: 20, paddingTop: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  countPill: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  countPillText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  heading: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textPrimary },
  sub: { color: colors.emergency, fontSize: 12, marginTop: 3 },
  searchBtn: { flexDirection: 'row', backgroundColor: colors.emergencyDark, margin: 12, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: colors.white, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  statusText: { textAlign: 'center', color: colors.textMuted, fontSize: 12, lineHeight: 20, paddingHorizontal: 16, marginBottom: 8 },
  card: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.emergency, marginBottom: 4 },
  cardAddress: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  distBadge: { backgroundColor: COLORS.infoBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.steelMid },
  distText: { fontSize: 11, color: COLORS.info, fontWeight: '700' },
  ratingBlock: { flexDirection: 'row', alignItems: 'center' },
  ratingNum: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info },
  ratingStar: { fontSize: 14, lineHeight: 21, color: colors.info, marginLeft: 1 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn: { flex: 1, paddingVertical: 16, borderRadius: 8, alignItems: 'center' },
  callBtn: { backgroundColor: colors.emergency },
  actionBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  phoneText: { fontSize: 12, color: colors.steel, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  retryBtn: { backgroundColor: COLORS.steelMid, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 },
  callBtnBig: {
    backgroundColor: colors.legal,
    borderRadius: 12, paddingVertical: 18,
    alignItems: 'center', marginBottom: 8,
    shadowColor: colors.legal, shadowOpacity: 0.3,
    shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4},
  callBtnBigText: { color: colors.bgCard, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 15, lineHeight: 22, letterSpacing: 0.3 },
  noPhoneBox: { backgroundColor: colors.bg, borderRadius: 8, padding: 12, marginBottom: 8, alignItems: 'center' },
  noPhoneText: { color: colors.textMuted, fontSize: 12 },
  dirBtn: { backgroundColor: COLORS.steelDark, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 6 },
  dirBtnText: { color: COLORS.white, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  cityFallback: { padding: 16, backgroundColor: colors.bgCard, marginBottom: 2 },
  cityFallbackTitle: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.emergency, marginBottom: 10 },
  citySearchInput: {
    borderWidth: 1.5, borderColor: colors.emergency, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, lineHeight: 22, color: colors.inputText, backgroundColor: colors.inputBg, marginBottom: 8},
  cityList: { gap: 2 },
  cityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 8, backgroundColor: colors.emergencyBg, marginBottom: 4,
    borderWidth: 1, borderColor: 'rgba(191,54,12,0.13)'},
  cityRowIcon: { fontSize: 14 },
  cityRowText: { fontSize: 14, lineHeight: 21, color: colors.emergency, fontFamily: 'Inter_700Bold', fontWeight: '700', flex: 1 },
  retryBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  verifiedBadge: {
    backgroundColor: COLORS.navy, borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2},
  verifiedBadgeText: { color: COLORS.steel, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  emptyState:    { alignItems: 'center', padding: 24 },
  emptyIcon:     { fontSize: 36, marginBottom: 8 },
  emptyTitle:    { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 4 },
  emptyHint:     { fontSize: 12, lineHeight: 20, color: colors.textMuted, marginBottom: 12 },
  nearbyCities:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 },
  nearbyCityBtn: { backgroundColor: COLORS.bgSubtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.bgSubtle },
  nearbyCityText:{ fontSize: 12, lineHeight: 20, color: COLORS.navy, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  pickCityBtn:   { backgroundColor: COLORS.navy, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  pickCityBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  hoursBadge: { backgroundColor: colors.legalBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 3, alignSelf: 'flex-start' },
  hoursText: { fontSize: 11, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  licensePill: { backgroundColor: colors.legalBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6, alignSelf: 'flex-start' },
  licensePillText: { fontSize: 11, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' }});
export default React.memo(BailSearchScreen);