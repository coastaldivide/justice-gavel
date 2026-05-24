import ScreenHeader from '../components/ScreenHeader';
import React, { useState, useEffect, useCallback } from 'react';
import {View, Text, FlatList, TouchableOpacity, Linking, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView} from 'react-native';
import {api} from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

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


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function CourtLocatorScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
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
        : `/courthouses?q=${encodeURIComponent(q)}&limit=30`;
      const res = await api.get(endpoint);
      // Normalize federal courts to match courthouse schema
      const raw = res.data || [];
      const normalized = courtMode === 'federal' ? raw.map((fc: Record<string, unknown>) => ({
        ...fc,
        name: fc.name,
        address: fc.address,
        phone: fc.phone,
        hours: fc.hours || 'Mon-Fri 8:30am-4:30pm',
        county: fc.district,
        notes: `Federal district: ${fc.district}`,
        court_type: 'Federal',
      })) : raw;
      setResults(normalized);
    } catch {
      setError('Could not load courthouses. Check connection.');
    } finally { setLoading(false); }
  }, [courtMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await doSearch(search || 'Nashville').catch(() => {});
    setRefreshing(false);
  }, [search, doSearch]);


  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 350);
    return () => clearTimeout(t);
  }, [search, doSearch, courtMode]);

  // Load nearby / default on mount
  useEffect(() => { doSearch('Nashville'); }, [doSearch]);

  const openMaps = (address: string) => {
    const encoded = encodeURIComponent(address);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    Linking.openURL(url).catch(() => {});
  };

  const openPhone = (phone: string) =>
    Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {});

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: bg }}
      testID="court-locator-screen">
      {/* Mode toggle */}
      <View style={{ flexDirection:'row', margin:16, marginBottom:4, gap:8 }}>
        {(['state','federal'] as const).map(mode => (
          <TouchableOpacity key={mode}
            accessibilityRole="button"
            onPress={() => { setCourtMode(mode); doSearch(search || 'a'); }}
            style={{
              flex:1, paddingVertical:9, borderRadius:10, alignItems:'center',
              backgroundColor: courtMode===mode ? colors.primary : card,
              borderWidth:1.5, borderColor: courtMode===mode ? colors.primary : (colors.border),
            }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: courtMode===mode ? colors.bgCard : text,
              fontWeight:'700', fontSize:13 }}>
              {mode==='state' ? '🏛️ State Courts' : '⚖️ Federal Courts'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={courtMode==="federal" ? "Search by state or district…" : "Search by city, state, or county…"}
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius: 10,
            paddingHorizontal: 14, paddingVertical: 11,
            color: text, fontSize: 15,
            borderWidth: 1, borderColor: colors.border,
          }}
          autoCapitalize="words"
          clearButtonMode="while-editing"
        />
      </View>

      {loading && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}
      {error ? (<>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergencyDark, textAlign: 'center', margin: 20 }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => doSearch('Nashville')} style={{marginTop:8,padding:10,backgroundColor:COLORS.navy,borderRadius:8,alignItems:'center'}}><Text maxFontSizeMultiplier={1.4} style={{color:'#fff',fontWeight:'700'}}>Retry</Text></TouchableOpacity>
      </>) : null}
      <FlatList
          keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews={true}
        onRefresh={onRefresh}
        refreshing={refreshing}
        data={results}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={
          !loading ? (
            <Text maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginTop: 40 }}>
              📋 Search for a city or county to find the courthouse.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
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
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🏛️</Text>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '700', fontSize: 14, lineHeight: 20 }}>
                    {item.name}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, marginTop: 2 }}>
                    {item.city} · {item.county} County · {item.state}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub }}>{open ? '▲' : '▼'}</Text>
              </View>

              {/* Collapsed preview */}
              {!open && (
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, marginTop: 6 }} numberOfLines={1}>
                  📍 {item.address}
                </Text>
              )}

              {/* Expanded detail */}
              {open && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {/* Address */}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Tap for directions"
                    onPress={() => openMaps(item.address)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>📍</Text>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                        {item.address}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 11 }}>Tap for directions</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Phone */}
                  {item.phone ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => openPhone(item.phone)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>📞</Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                        {item.phone}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Hours */}
                  {item.hours ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>🕐</Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontSize: 13 }}>{item.hours}</Text>
                    </View>
                  ) : null}

                  {/* Notes */}
                  {item.notes ? (
                    <View style={{
                      backgroundColor: isDark ? colors.surface : colors.bgCard,
                      borderRadius: 8, padding: 10, marginTop: 4,
                    }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.gold : colors.warnDark, fontSize: 12 }}>
                        ℹ️  {item.notes}
                      </Text>
                    </View>
                  ) : null}

                  {/* Website */}
                  {item.url ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Court Website"
                      onPress={() => Linking.openURL(item.url!).catch(() => {})}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>🌐</Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontSize: 12 }} numberOfLines={1}>
                        Court Website
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
    </KeyboardAvoidingView>
  );
}
