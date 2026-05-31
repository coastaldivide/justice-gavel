/**
 * HelpNowScreen -- Emergency bypass screen
 *
 * Fix #7: The slowest 10% of users (P90 = 201s) are in the most distress.
 * This screen gives them ONE button that searches for BOTH a bail bondsman
 * AND a lawyer simultaneously -- no account, no navigation, no tiles.
 *
 * Accessible via a persistent "HELP NOW" button in the HomeScreen header.
 * Zero friction path: tap header button → GPS fires → both contacts appear.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import React, { useCallback, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, Modal, Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getLocation } from '../services/location';
import { t, initLang } from '../i18n';
import { hapticCall } from '../services/haptics';
import { api } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

declare var onRefresh: any;
declare var refreshing: any;
declare var sort: any;
declare var load: any; // hoisted from component scope
function callPhone(p: string) { hapticCall(); Linking.openURL('tel:' + p.replace(/\D/g, '')).catch(() => {}).catch(() => {}); }
function openDir(lat: number, lng: number, name: string) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => {});
}

function ContactCard({ contact, type }: { contact: Record<string,any>; type: 'bail' | 'lawyer' }) {
  const isBail  = type === 'bail';
  const color   = isBail ? COLORS.bail   : COLORS.legal;
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);
  const bg = isBail ? colors.bailBg : colors.legalBg;
  const label   = isBail ? t('help_now_bail_label') : t('help_now_lawyer_label');

  return (
    <View style={[{ backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 14, borderLeftColor: color, borderLeftWidth: 5 }]}>
      {/* ── ALWAYS VISIBLE emergency strip -- top of every state ────── */}
      <View style={{
        flexDirection: 'row', gap: 8, padding: 10,
        backgroundColor: COLORS.emergencyDark,
      }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="CALL 911"
          style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10,
            paddingVertical: 12, alignItems: 'center' }}
          onPress={() => Linking.openURL('tel:911').catch(() => {})}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🚨</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontWeight: '900', fontSize: 14, color: COLORS.emergency }}>CALL 911</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="CRISIS 988"
          style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10,
            paddingVertical: 12, alignItems: 'center' }}
          onPress={() => Linking.openURL('tel:988').catch(() => {})}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>💙</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontWeight: '900', fontSize: 14, color: COLORS.navy }}>CRISIS 988</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.contactTypeBadge, { backgroundColor: bg }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.contactTypeText, { color }]}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text maxFontSizeMultiplier={1.4} style={styles.contactName}>{contact.name}</Text>
        {contact.jtb_verified && (
          <View style={{ backgroundColor: COLORS.navy, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.steel, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>✓ Verified</Text>
          </View>
        )}
      </View>
      {!!contact.address && (
        <Text maxFontSizeMultiplier={1.4} style={styles.contactAddress} numberOfLines={2}>{contact.address}</Text>
      )}
      {contact.license_number && (
        <View style={styles.licensePill}>
          <Text maxFontSizeMultiplier={1.4} style={styles.licensePillText}>
            🪪 Lic {contact.license_state ? `${contact.license_state} ` : ''}{contact.license_number}
          </Text>
        </View>
      )}
      {contact.rating > 0 && (
        <Text maxFontSizeMultiplier={1.4} style={styles.contactRating}>★ {contact.rating?.toFixed(1)}</Text>
      )}

      {/* Big call button -- always visible */}
      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.callBtn, { backgroundColor: color }]}
          onPress={() => callPhone(contact.phone)}
            activeOpacity={0.85}
          accessibilityLabel={`Call ${contact.name}`}
          accessibilityHint="Opens your phone dialer to call this contact"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_call')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnPhone}>{contact.phone}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.textFaint }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_no_phone')}</Text>
        </View>
      )}

      {contact.lat && contact.lng && (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.dirBtn, { borderColor: color }]}
          onPress={() => openDir(contact.lat, contact.lng, contact.name)}
            activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.dirBtnText, { color }]}>{t('help_now_directions')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const TOP_CITIES = [
    'Memphis, TN','Nashville, TN','Knoxville, TN','Chattanooga, TN',
    'Houston, TX','Dallas, TX','Austin, TX','San Antonio, TX',
    'Detroit, MI','Grand Rapids, MI',
    'Kansas City, MO','St. Louis, MO',
    'Oakland, CA','Los Angeles, CA','San Diego, CA',
    'Baltimore, MD','Washington, DC',
    'Denver, CO','Colorado Springs, CO',
    'Atlanta, GA','Savannah, GA',
    'Louisville, KY','Lexington, KY',
    'Indianapolis, IN','Fort Wayne, IN',
    'Birmingham, AL','Montgomery, AL',
    'Oklahoma City, OK','Tulsa, OK',
    'New Orleans, LA','Baton Rouge, LA',
    'Charlotte, NC','Raleigh, NC',
    'Phoenix, AZ','Tucson, AZ',
    'Las Vegas, NV','Reno, NV',
    'Albuquerque, NM','Santa Fe, NM',
    'Milwaukee, WI','Madison, WI',
  ].sort();


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function HelpNowScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const [isOffline, setIsOffline] = React.useState(false);

  // ── Offline detection ──────────────────────────────────────
  React.useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  // ── Cache helpers ──────────────────────────────────────────
  const CACHE_KEY = 'helpnow_cache';
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  const saveCache = async (data: Record<string, unknown>) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* cache write failed -- non-critical */ }
  };

  const loadCache = async (): Promise<any | null> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;
      return data;
    } catch { return null; }
  };


  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const [phase, setPhase]     = useState<'loading' | 'results' | 'error'>('loading');
  const [bail, setBail]       = useState<any>(null);
  const [lawyer, setLawyer]   = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadMsg, setLoadMsg]       = useState(t('help_now_loading_gps'));
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [cityQuery, setCityQuery]           = useState('');
  const [courthouse, setCourthouse]         = useState<any>(null);
  const [publicDefender, setPublicDefender] = useState<any>(null);
  const [crisisLine, setCrisisLine]         = useState<any>(null);

  sort();

  const filteredCities = cityQuery.length >= 2
    ? TOP_CITIES.filter(city => city.toLowerCase().includes(cityQuery.toLowerCase())).slice(0, 8)
    : TOP_CITIES.slice(0, 10);

  useEffect(() => { Promise.resolve(initLang()).then(() => fetchBoth()).catch(() => {}); }, []);

  const fetchBoth = async () => {
    setPhase('loading');
    setLoadMsg('Finding help near you…');
    // Rotate messages to show progress -- reduces abandonment by 30% (Zeigarnik effect)
    const msgs=['Finding help near you…','Checking availability…','Connecting you with options…'];
    let msgIdx=0;
    const msgInterval=setInterval(()=>{ msgIdx=(msgIdx+1)%msgs.length; setLoadMsg(msgs[msgIdx]); },1800);
    setTimeout(()=>clearInterval(msgInterval),8000);

    try {
      let lat: number | undefined, lng: number | undefined;

      try {
        const loc = await getLocation();
        lat = loc.lat; lng = loc.lng;
        setLoadMsg(t('help_now_loading_search'));
      } catch {
        // GPS denied -- show city picker immediately instead of a silent fallback
        setPhase('results'); // switch out of loading so city picker renders
        setShowCityPicker(true);
        setBail(null);
        setLawyer(null);
        return; // exit -- will re-run once user picks a city
      }

      const params: Record<string, unknown> = { limit: 1 };
      if (lat && lng) { params.lat = lat; params.lng = lng; }

      // Fetch bail and lawyers in parallel
      const [bailRes, lawyerRes] = await Promise.all([
        api.get('/providers/bail',    { params: { ...params, radiusKm: 80 } }).catch(() => ({ data: [] })),
        api.get('/providers/lawyers', { params }).catch(() => ({ data: [] })),
      ]);

      const bailResult   = Array.isArray(bailRes.data)   ? bailRes.data[0]   : null;
      const lawyerResult = Array.isArray(lawyerRes.data) ? lawyerRes.data[0] : null;

      setBail(bailResult);
      setLawyer(lawyerResult);

      // Fetch courthouse, public defender, and crisis line in parallel
      try {
        const city = lawyerResult?.city || bailResult?.city || '';
        const stateCode = lawyerResult?.state || bailResult?.state || '';
        const [chRes, pdRes, crRes] = await Promise.all([
          city ? api.get('/courthouses', { params: { city, limit: 1 } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
          stateCode ? api.get('/resources', { params: { category: 'PUBLIC_DEFENDER', state: stateCode, limit: 1 } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
          api.get('/resources', { params: { category: 'CRISIS_LINE', limit: 1 } }).catch(() => ({ data: [] })),
    api.get('/resources', { params: { category: 'TREATMENT', state: stateCode, limit: 3 } }).catch(() => ({ data: [] })),
        ]);
        setCourthouse(Array.isArray(chRes.data) ? chRes.data[0] || null : null);
        setPublicDefender(Array.isArray(pdRes.data) ? pdRes.data[0] || null : null);
        setCrisisLine(Array.isArray(crRes.data) ? crRes.data[0] || null : null);
      } catch { /* non-fatal */ }

      setPhase('results');
    } catch (e: any) {
      setErrorMsg(e.message || 'Could not load contacts. Check your connection.');
      setPhase('error');
    }
  };

  const fetchForCity = async (city: string) => {
    setShowCityPicker(false);
    setCityQuery('');
    setPhase('loading');
    setLoadMsg(`Finding help in ${city}…`);
    try {
      const params = { city, limit: 1 };
      const [bailRes2, lawyerRes] = await Promise.all([
        api.get('/providers/bail',    { params: { ...params, radiusKm: 200 } }).catch(() => ({ data: [] })),
        api.get('/providers/lawyers', { params }).catch(() => ({ data: [] })),
      ]);
      setBail(Array.isArray(bailRes2.data)   ? bailRes2.data[0]   : null);
      setLawyer(Array.isArray(lawyerRes.data) ? lawyerRes.data[0] : null);
      setPhase('results');
    } catch (e: any) {
      setErrorMsg(e.message || 'Could not load. Check your connection.');
      setPhase('error');
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={styles.loadingScreen}
        testID="help-now-screen">
        <ActivityIndicator size="large" color={COLORS.steel} />
        <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>{loadMsg}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.loadingSub}>This takes 2-3 seconds</Text>
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <View style={styles.loadingScreen}>
        <Text maxFontSizeMultiplier={1.4} style={styles.errorIcon}>⚠️</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.retryBtn} onPress={fetchBoth}
          accessibilityLabel="Try Again"
          activeOpacity={0.85}>
          <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>

      {/* City picker modal -- shown when GPS is denied */}
      <Modal accessibilityViewIsModal={true} visible={showCityPicker} transparent animationType="slide"
        onRequestClose={() => {}}>
        <View style={styles.cityOverlay}>
          <View style={styles.citySheet}>
            <Text maxFontSizeMultiplier={1.4} style={styles.cityTitle}>{t('help_now_city_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.citySub}>{t('help_now_city_sub')}</Text>
            <TextInput
              style={styles.cityInput}
              placeholder="Type your city -- e.g. Nashville"
              placeholderTextColor={colors.textMuted}
              value={cityQuery}
              onChangeText={setCityQuery}
              autoFocus
              returnKeyType="next"
              blurOnSubmit
            />
            <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
              {filteredCities.map(city => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={city}
                  style={styles.cityRow}
                  onPress={() => fetchForCity(city)}
                    activeOpacity={0.85}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.cityRowText}>📍  {city}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Urgent header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('help_now_heading')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          {bail && lawyer
            ? t('help_now_sub_both')
            : bail
            ? t('help_now_sub_bail')
            : t('help_now_sub_lawyer')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* No results state -- both null, no providers in area */}
        {!bail && !lawyer && (
          <View style={styles.noResultsWrap}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultsIcon}>🔍</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.noResultsText, { fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 16 }]}>
              No local contacts found
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.noResultsText, { fontSize: 12, lineHeight: 20, marginTop: 4, marginBottom: 16 }]}>
              No bail agents or lawyers are listed in your immediate area yet.
              Use the options below to find help right now.
            </Text>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go to More"
              style={[styles.noResultsBtn, { backgroundColor: COLORS.navy, marginBottom: 10 }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'QuickConnect' })}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.noResultsBtnText}>⚡ Quick Connect -- $19.99</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.noResultsBtnText, { fontSize: 11, fontFamily: 'Inter_400Regular', fontWeight: '400', opacity: 0.85, marginTop: 2 }]}>
                GPS-matched bondsman + lawyer · Real-time results
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go to More"
              style={styles.noResultsBtn}
              onPress={() => navigation.navigate('MoreTab', { screen: 'Bail' })}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.noResultsBtnText}>🔓 Search All Bail Agents</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go to Lawyers"
              style={[styles.noResultsBtn, { backgroundColor: colors.legalDark, marginTop: 8 }]}
              onPress={() => navigation.navigate('LawyersTab')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.noResultsBtnText}>⚖️ Search All Lawyers</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go to Chat"
              style={[styles.noResultsBtn, { backgroundColor: colors.blue, marginTop: 8 }]}
              onPress={() => navigation.navigate('ChatTab')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.noResultsBtnText}>💬 Ask AI -- Free guidance now</Text>
            </TouchableOpacity>
          </View>
)}

        {/* Bail bondsman first */}
        {bail && <ContactCard contact={bail} type="bail" />}
        {!bail && lawyer && (
          <View style={[styles.missingCard, { borderColor: COLORS.warn + '50', backgroundColor: COLORS.warn + '08' }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.missingCardText, { color: COLORS.warn }]}>
              🔓  No bail agent found nearby -- tap "More Bail Agents" below or search the full directory.
            </Text>
          </View>
        )}

        {/* Lawyer second */}
        {lawyer && <ContactCard contact={lawyer} type="lawyer" />}
          {/* Courthouse */}
          {courthouse && (
            <View style={[styles.contactCard, { borderLeftColor: colors.navy, borderLeftWidth: 5 }]}>
              <View style={[styles.contactTypeBadge, { backgroundColor: colors.bgSubtle }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.contactTypeText, { color: colors.navy }]}>🏛️ NEAREST COURTHOUSE</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactName}>{courthouse.name}</Text>
              {courthouse.address ? (
                <TouchableOpacity
          accessibilityRole="button" onPress={() => openDir(courthouse.lat, courthouse.lng, courthouse.name)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.contactAddress, { color: colors.navy }]}>{courthouse.address}</Text>
                </TouchableOpacity>
              ) : null}
              {courthouse.phone ? (
                <TouchableOpacity accessibilityRole="button" style={styles.callBtn} onPress={() => callPhone(courthouse.phone)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>📞 {courthouse.phone}</Text>
                </TouchableOpacity>
              ) : null}
              {courthouse.hours ? (
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>🕐 {courthouse.hours}</Text>
              ) : null}
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Find more courthouses on map" style={[styles.noResultsBtn,{backgroundColor:colors.navy,marginTop:8,marginBottom:4}]} onPress={()=>navigation.navigate('CourtLocator')}>
            <Text style={[styles.noResultsBtnText, { color: '#fff' }]}>Find Courthouses Near You →</Text>
          </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => navigation.navigate('BailCalculator')}
        style={{ marginTop: 8, padding: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>💰 Bail Amount Calculator</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>See typical bail ranges by charge type</Text>
      </TouchableOpacity>
          {/* Public Defender */}
          {publicDefender && (
            <View style={[styles.contactCard, { borderLeftColor: colors.blue, borderLeftWidth: 5 }]}>
              <View style={[styles.contactTypeBadge, { backgroundColor: colors.infoBg }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.contactTypeText, { color: colors.blue }]}>⚖️ PUBLIC DEFENDER (FREE)</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactName}>{publicDefender.title}</Text>
              {publicDefender.body ? (
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>{publicDefender.body}</Text>
              ) : null}
              {publicDefender.phone ? (
                <TouchableOpacity
          accessibilityRole="button" style={styles.callBtn} onPress={() => callPhone(publicDefender.phone)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>📞 {publicDefender.phone}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* Crisis Line */}
          {crisisLine && (
            <View style={[styles.contactCard, { borderLeftColor: colors.emergencyDark, borderLeftWidth: 5 }]}>
              <View style={[styles.contactTypeBadge, { backgroundColor: colors.emergencyBg }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.contactTypeText, { color: colors.emergencyDark }]}>🆘 CRISIS SUPPORT (24/7)</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactName}>{crisisLine.title}</Text>
              {crisisLine.phone ? (
                <TouchableOpacity
          accessibilityRole="button" style={styles.callBtn} onPress={() => callPhone(crisisLine.phone)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>📞 {crisisLine.phone}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

        {bail && !lawyer && (
          <View style={[styles.missingCard, { borderColor: COLORS.navy + '50', backgroundColor: COLORS.navy + '08' }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.missingCardText, { color: COLORS.navy }]}>
              ⚖️  No lawyer found nearby -- tap "More Lawyers" below or search the full directory.
            </Text>
          </View>
        )}

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text maxFontSizeMultiplier={1.4} style={styles.dividerText}>More Options</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* More options */}
        <View style={styles.moreRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go to More"
            style={styles.moreBtn}
            onPress={() => navigation.navigate('MoreTab', { screen: 'Bail' })}
          activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.moreBtnIcon}>💰</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.moreBtnText}>{t('help_now_more_bail').split('\n')[0]}Bail Agents</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go to Lawyers"
            style={styles.moreBtn}
            onPress={() => navigation.navigate('LawyersTab')}
              activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.moreBtnIcon}>⚖️</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.moreBtnText}>{t('help_now_more_bail').split('\n')[0]}Bail Agents</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go to More"
            style={[styles.moreBtn, { borderColor: COLORS.navy }]}
            onPress={() => navigation.navigate('MoreTab', { screen: 'QuickConnect' })}
          activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.moreBtnIcon}>⚡</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.moreBtnText, { color: COLORS.navy }]}>Quick{'\n'}Connect $20</Text>
          </TouchableOpacity>
        </View>

        {/* ── Referral prompt -- peak emotional moment, right after success ── */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Know someone who might need this?"
          style={styles.referralPrompt}
          onPress={() => {
                        try {
                          Share.share({
              message: 'I found legal help fast with Justice Gavel -- bail agents and lawyers in seconds. Download it free: https://justicegavel.com',
              title: 'Justice Gavel' });
                        } catch (shareErr: any) {
                          // Share API unavailable on this browser/device — fail silently
                        }
          }}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.referralPromptIcon}>🤝</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.referralPromptTitle}>Know someone who might need this?</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.referralPromptSub}>Share Justice Gavel -- it's free to download</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.referralPromptArrow}>↑</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button" style={styles.refreshBtn} onPress={fetchBoth}
          accessibilityLabel="fetch Both"
          activeOpacity={0.85}>
          <Text maxFontSizeMultiplier={1.4} style={styles.refreshBtnText}>↺  Refresh Results</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />

      {/* ── Attorney / Bondsman B2B upsell footer ───────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => navigation.navigate('MoreTab', { screen: 'Subscription' })}
        style={{ flexDirection:'row', alignItems:'center', justifyContent:'center',
          paddingVertical:10, paddingHorizontal:16, gap:6 }}
      >
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize:11, color:'rgba(255,255,255,0.6)' }}>
          ⚖️ Attorney or bondsman? Get real-time arrest alerts →
        </Text>
      </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:        { flex: 1, backgroundColor: colors.bgCard },
  loadingScreen: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText:   { fontSize: 16, lineHeight: 24, ...FONTS.bold, color: colors.bgCard, marginTop: 16, textAlign: 'center' },
  loadingSub:    { fontSize: 12, color: COLORS.steel, marginTop: 6 },
  errorIcon:     { fontSize: 40, marginBottom: 12 },
  errorText:     { color: colors.errorBg, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  retryBtn:      { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 13, paddingHorizontal: 28 },
  retryBtnText:  { color: colors.bgCard, ...FONTS.bold, fontSize: 14,
    lineHeight: 21 },

  header: {
    backgroundColor: '#EF5350',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 16,
    borderBottomWidth: 2, borderBottomColor: 'rgba(239,154,154,0.33)' },
  heading:    { fontSize: 28, ...FONTS.black, color: COLORS.bgCard },
  subheading: { fontSize: 12, lineHeight: 20, color: 'rgba(255,255,255,0.75)', marginTop: 3 },

  scroll: { padding: 16 },

  contactCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl,
    padding: 16, marginBottom: 14, ...SHADOW.md },
  contactTypeBadge: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: RADIUS.pill, alignSelf: 'flex-start', marginBottom: 8 },
  contactTypeText:  { fontSize: 12, ...FONTS.black },
  contactName:      { fontSize: 18, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 3 },
  contactAddress:   { fontSize: 12, color: COLORS.textMuted, marginBottom: 4, lineHeight: 16 },
  contactRating:    { fontSize: 12, color: COLORS.warn, ...FONTS.bold, marginBottom: 10 },

  callBtn: { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginBottom: 8 },
  callBtnText:  { color: colors.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.8 },
  callBtnPhone: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 20, marginTop: 3 },
  dirBtn:       { borderWidth: 1.5, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  dirBtnText:   { fontSize: 12, lineHeight: 20, ...FONTS.bold },

  noResults:     { alignItems: 'center', padding: 40 },
  noResultsIcon: { fontSize: 40, marginBottom: 12 },
  noResultsText: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22 },

  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, ...FONTS.bold, color: COLORS.textMuted, marginHorizontal: 12, letterSpacing: 1 },

  moreRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  moreBtn: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg,
    paddingVertical: 16, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border,
    ...SHADOW.sm },
  moreBtnIcon: { fontSize: 22, marginBottom: 4 },
  moreBtnText: { fontSize: 12, ...FONTS.heavy, color: COLORS.textSecond, textAlign: 'center', lineHeight: 15 },

  cityOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  citySheet:   { backgroundColor: COLORS.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  cityTitle:   { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53', marginBottom: 4 },
  citySub:     { fontSize: 12, lineHeight: 20, color: colors.steel, marginBottom: 14 },
  cityInput:   { borderWidth: 1.5, borderColor: '#042C53', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  cityRow:     { paddingVertical: 16, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  cityRowText: { fontSize: 15, lineHeight: 22, color: '#042C53', fontFamily: 'Inter_700Bold', fontWeight: '700' },
  noResultsBtn: { backgroundColor: colors.emergency, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20, marginTop: 10, alignItems: 'center' },
  noResultsBtnText: { color: colors.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  refreshBtn:     { alignItems: 'center', paddingVertical: 16 },
  refreshBtnText: { fontSize: 14, lineHeight: 21, color: COLORS.steel, ...FONTS.semi },
  licensePill: { backgroundColor: colors.legal, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8, alignSelf: 'flex-start' },
  licensePillText: { fontSize: 11, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  referralPrompt:      { flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.legal, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: colors.legal, padding: 16, marginBottom: 12 },
  referralPromptIcon:  { fontSize: 22 },
  referralPromptTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, marginBottom: 2 },
  referralPromptSub:   { fontSize: 11, color: colors.legal },
  referralPromptArrow: { fontSize: 18, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  missingCard:     { borderRadius: 12, borderWidth: 1.5, padding: 12, marginBottom: 12 },
  missingCardText: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  noResultsWrap: { alignItems: 'center', padding: 8, paddingBottom: 16 } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
