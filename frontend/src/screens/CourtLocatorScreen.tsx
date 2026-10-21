import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import React, { useState, useEffect, useCallback } from 'react';
import {View, Text, TouchableOpacity, Linking, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView, LayoutAnimation} from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import { unwrapList,api} from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { t, useLang } from '../i18n';
import { getUserState } from '../utils/userState';

type Courthouse = {
  id: number;
  city: string;
  state: string;
  name: string;
  address: string;
  phone: string;
  hours: string;
  county: string;
  url?: string;
  notes?: string;
  lat?: number;
  lng?: number;
  court_type: string;
};



function CourtLocatorScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const [search, setSearch] = useState('');
  const [courtMode, setCourtMode] = useState<'state'|'federal'>('state');
  const [results, setResults] = useState<Courthouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [home, setHome] = useState('');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;

  // Forward declaration — doSearch is defined below via useCallback
  var doSearch: (q: string) => Promise<void>;
  var doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true); setError('');
    try {
      const endpoint = courtMode === 'federal'
        ? `/legaldata/federal-courts?q=${encodeURIComponent(q)}&limit=30`
        : /^[A-Z]{2}$/.test(q) ? `/courthouses?state=${q}&limit=100` : `/courthouses?q=${encodeURIComponent(q)}&limit=30`;
      const res = await api.get(endpoint);
      // Normalize federal courts to match courthouse schema
      // /courthouses answers with an array, /legaldata/* with { data: [...] }.
      const raw = unwrapList<Record<string, unknown>>(res.data, 'courthouses');
      const normalized = courtMode === 'federal' ? raw.map((fc: Record<string, unknown>) => ({
        ...fc,
        name: fc.name,
        address: fc.address,
        phone: fc.phone,
        hours: fc.hours || null,
        county: fc.district,
        notes: t('x_court_locator_federal_district', { district: String(fc.district ?? '') }),
        court_type: 'Federal',
      })) : raw;
      setResults(normalized as unknown as Courthouse[]);
    } catch {
      setError(t('x_court_locator_could_not_load_courthouses'));
    } finally { setLoading(false); }
  }, [courtMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await doSearch(search.trim().length >= 2 ? search : home).catch(() => {});
    setRefreshing(false);
  }, [search, home, doSearch]);


  useEffect(() => {
    const tItem = setTimeout(() => doSearch(search.trim().length >= 2 ? search : home), 350);
    return () => clearTimeout(tItem);
  }, [search, home, doSearch, courtMode]);

  // Start with the person's state (Settings / location); nothing is assumed when it is unknown.
  useEffect(() => {
    getUserState().then(st => { if (mountedRef.current && st?.code) setHome(st.code); }).catch(() => {});
  }, []);


  const openMaps = (address: string) => {
    const encoded = encodeURIComponent(address);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    Linking.openURL(url).catch(() => showToast(t('action_failed'), 'error'));
  };

  const openPhone = (phone: string) =>
    Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => showToast(t('action_failed'), 'error'));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: bg }}
      testID="court-locator-screen">
      {/* Mode toggle */}
      <View style={{ flexDirection:'row', margin:16, marginBottom:4, gap:8 }}>
        {(['state','federal'] as const).map(mode => (
          <TouchableOpacity accessibilityRole="button" key={mode}
            onPress={() => { setCourtMode(mode); doSearch(search || 'a'); }}
            style={{
              flex:1, paddingVertical:9, borderRadius:10, alignItems:'center',
              backgroundColor: courtMode===mode ? colors.primary : card,
              borderWidth:1.5, borderColor: courtMode===mode ? colors.primary : (colors.border),
            }}>
            <IconLabel icon={ICONS.courthouse} textStyle={{ color: courtMode===mode ? colors.bgCard : text,
              fontWeight:'700', fontSize:13 }} maxFontSizeMultiplier={1.4}>{mode==='state' ? t('x_court_locator_state_courts') : t('x_court_locator_federal_courts')}</IconLabel>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={courtMode==="federal" ? t('x_court_locator_search_by_state_district') : t('x_court_locator_search_by_city_state')}
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius: 10,
            paddingHorizontal: 14, paddingVertical: 11,
            color: text, fontSize: 15,
            borderWidth: 1, borderColor: colors.border,
          }}
          autoCapitalize="words"
          clearButtonMode="while-editing"
          returnKeyType="search" blurOnSubmit={true}
        />
      </View>

      {loading && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}
      {error ? (<>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergencyDark, textAlign: 'center', margin: 20 }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => doSearch(search.trim().length >= 2 ? search : home)} style={{marginTop:8,padding:10,backgroundColor:COLORS.navy,borderRadius:8,alignItems:'center'}}><Text maxFontSizeMultiplier={1.4} style={{color:colors.textOnNavy,fontWeight:'700'}}>{t('retry')}</Text></TouchableOpacity>
      </>) : null}
      {/* FlashList only supports padding/background in contentContainerStyle,
          so the centered max-width column lives on a wrapper View instead. */}
      <View style={{ flex: 1, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%' }}>
      <FlashList
          onRefresh={onRefresh}
        refreshing={refreshing}
          data={results}
        keyExtractor={(i: Courthouse) => String(i.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={
          !loading && !error ? (
            <IconLabel icon={ICONS.clipboard} textStyle={{ color: sub, textAlign: 'center', marginTop: 40 }} maxFontSizeMultiplier={1.4} testID="court-locator-empty">{search.trim().length >= 2
                ? t('x_court_locator_no_courthouses_found_try', { search: search.trim() })
                : t('x_court_locator_search_city_county_find')}</IconLabel>
          ) : null
        }
        renderItem={({ item }: { item: Courthouse }) => {
          const open = expanded === item.id;
          return (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setExpanded(open ? null : item.id)}
              style={{
                backgroundColor: card, borderRadius: 12, marginBottom: 12,
                padding: 14, borderWidth: 1,
                borderColor: open ? colors.primary : (colors.border),
                shadowColor: colors.textPrimary, shadowOpacity: 0.06,
                shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
              }}
              accessibilityLabel={item.name}
            >
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <AppIcon name="business-outline" size={20} color={COLORS.navy} />
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '700', fontSize: 14, lineHeight: 20 }}>
                    {item.name}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, marginTop: 2 }}>
                    {t('x_court_locator_county', { city: item.city, county: item.county, state: item.state })}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub }}>{open ? '▲' : '▼'}</Text>
              </View>

              {/* Collapsed preview */}
              {!open && (
                <IconLabel icon={ICONS.location} textStyle={{ color: sub, fontSize: 12, marginTop: 6 }} maxFontSizeMultiplier={1.4} numberOfLines={1}>{item.address}</IconLabel>
              )}

              {/* Expanded detail */}
              {open && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {/* Address */}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('x_court_locator_tap_directions')}
                    onPress={() => openMaps(item.address)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <IconLabel icon={ICONS.location} textStyle={{ fontSize: 16 }} maxFontSizeMultiplier={1.4}></IconLabel>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                        {item.address}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 11 }}>{t('x_court_locator_tap_directions')}</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Phone */}
                  {item.phone ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => openPhone(item.phone)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <AppIcon name="call-outline" size={20} color={colors.legal} />
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                        {item.phone}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Hours */}
                  {item.hours ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <IconLabel icon={ICONS.clock} textStyle={{ fontSize: 16 }} maxFontSizeMultiplier={1.4}></IconLabel>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontSize: 13 }}>{item.hours}</Text>
                    </View>
                  ) : null}

                  {/* Notes */}
                  {item.notes ? (
                    <View style={{
                      backgroundColor: isDark ? colors.surface : colors.bgCard,
                      borderRadius: 8, padding: 10, marginTop: 4,
                    }}>
                      <IconLabel icon={ICONS.alertNormal} textStyle={{ color: isDark ? colors.gold : colors.warnDark, fontSize: 12 }} maxFontSizeMultiplier={1.4}>{item.notes}</IconLabel>
                    </View>
                  ) : null}

                  {/* Website */}
                  {item.url ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={t('x_court_locator_court_website')}
                      onPress={() => Linking.openURL(item.url ?? '').catch(() => showToast(t('action_failed'), 'error'))}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <IconLabel icon={ICONS.globe} textStyle={{ fontSize: 16 }} maxFontSizeMultiplier={1.4}></IconLabel>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontSize: 12 }} numberOfLines={1}>
                        {t('x_court_locator_court_website')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
      </View>
    </View>
    </KeyboardAvoidingView>
  );
}
export default React.memo(CourtLocatorScreen);
