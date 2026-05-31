import ScreenHeader from '../components/ScreenHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {View, Text, FlatList, RefreshControl, TouchableOpacity, TextInput, Linking, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StyleSheet} from 'react-native';
import { api, cachedGet }           from '../services/api';
import { cacheResources, getCachedResources } from '../services/offlineCache';
import {  useTheme, COLORS }      from '../constants/theme';


const CATEGORIES = [
  { key: 'ALL',                label: 'All',              icon: '📚' },
  { key: 'PUBLIC_DEFENDER',   label: 'Public Defender',  icon: '⚖️'  },
  { key: 'LEGAL_AID',         label: 'Free Legal Aid',   icon: '🆘' },
  { key: 'CRISIS_LINE',       label: 'Crisis Lines',     icon: '📞' },
  { key: 'DV_SHELTER',        label: 'DV Help',          icon: '🏠' },
  { key: 'INMATE_LOOKUP',     label: 'Find Inmate',      icon: '🔍' },
  { key: 'TREATMENT',         label: 'Treatment',        icon: '💊' },
  { key: 'EXPUNGEMENT',       label: 'Clear Record',     icon: '🗂️'  },
  { key: 'IMMIGRATION_COURT', label: 'Immigration',      icon: '🌎' },
  { key: 'COURT_PAYMENT',     label: 'Pay Fees',         icon: '💳' },
  { key: 'VICTIM_COMPENSATION',label: 'Victim Help',     icon: '🛡️'  },
  { key: 'LAW_CLINIC',        label: 'Free Clinics',     icon: '🎓' },
  { key: 'PROBATION',         label: 'Probation',        icon: '📋' },
  { key: 'ATTORNEY_COMPLAINT',label: 'Report Attorney',  icon: '⚠️'  },
];

const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  ALL:                { bg: COLORS.infoBg, border: COLORS.blue, text: COLORS.navy },
  PUBLIC_DEFENDER:    { bg: COLORS.bgSubtle, border: COLORS.navy, text: COLORS.navy },
  LEGAL_AID:          { bg: COLORS.legalBg, border: COLORS.legalDark, text: COLORS.legalDark },
  CRISIS_LINE:        { bg: COLORS.emergencyBg, border: COLORS.emergencyDark, text: COLORS.emergencyDark },
  DV_SHELTER:         { bg: COLORS.warnBg, border: COLORS.warnDark, text: COLORS.warnDark },
  INMATE_LOOKUP:      { bg: COLORS.bgSubtle, border: COLORS.navy, text: COLORS.navy },
  TREATMENT:          { bg: COLORS.bgSubtle, border: COLORS.navy, text: COLORS.navy },
  EXPUNGEMENT:        { bg: COLORS.bgCard, border: COLORS.legalDark, text: COLORS.legalDark },
  IMMIGRATION_COURT:  { bg: COLORS.infoBg, border: COLORS.blue, text: COLORS.blue },
  COURT_PAYMENT:      { bg: COLORS.legalBg, border: COLORS.legalDark, text: COLORS.legalDark },
  VICTIM_COMPENSATION:{ bg: COLORS.bgCard, border: COLORS.warn, text: COLORS.warnDark },
  LAW_CLINIC:         { bg: COLORS.legalBg, border: COLORS.legalDark, text: COLORS.legalDark },
  PROBATION:          { bg: COLORS.bgSubtle, border: COLORS.textSecond, text: COLORS.textSecond },
  ATTORNEY_COMPLAINT: { bg: COLORS.emergencyBg, border: COLORS.emergencyDark, text: COLORS.emergencyDark },
};

const CAT_PRIORITY: Record<string, number> = {
  CRISIS_LINE: 10, PUBLIC_DEFENDER: 9, LEGAL_AID: 8,
  DV_SHELTER: 7, INMATE_LOOKUP: 6,
};


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function ResourcesScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [allItems,  setAllItems]  = useState<any[]>([]);
  const [filtered,  setFiltered]  = useState<any[]>([]);
  const [category,  setCategory]  = useState('ALL');
  const [q,         setQ]         = useState('');
  const [expanded,  setExpanded]  = useState<number | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await cachedGet('/resources?limit=500');
      const items = res.data || [];
      if (mountedRef.current) { setAllItems(items); cacheResources(items); }
    } catch (e: unknown) {
      const cached = await getCachedResources().catch(() => []);
      if (mountedRef.current && cached?.length) setAllItems(cached);
      else if (mountedRef.current) setError('Could not load resources');
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter whenever category or search changes
  useEffect(() => {
    let list = allItems;
    if (category !== 'ALL') list = list.filter(i => i.category === category);
    if (q.trim()) {
      const lower = q.toLowerCase();
      list = list.filter(i =>
        i.title?.toLowerCase().includes(lower) ||
        i.body?.toLowerCase().includes(lower)  ||
        i.state?.toLowerCase().includes(lower)
      );
    }
    setFiltered(list);
  }, [allItems, category, q]);

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;
  const catColors = CAT_COLORS[category] || CAT_COLORS.textMuted;

  if (loading && !allItems.length) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:bg }}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text maxFontSizeMultiplier={1.4} style={{ color:sub, marginTop:12 }}>Loading resources…</Text>
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:bg }}
      testID="resources-screen">
      {/* Search bar */}
      <View style={{ paddingHorizontal:16, paddingTop:12, paddingBottom:8 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search resources…"
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius:10, paddingHorizontal:14,
            paddingVertical:10, color:text, fontSize:15,
            borderWidth:1, borderColor: colors.border,
          }}
        />
      </View>

      {/* Category chips */}
      <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow:0 }} contentContainerStyle={{ paddingHorizontal:12, paddingBottom:10 }}>
        {CATEGORIES.map(cat => {
          const active = category === cat.key;
          const cc = CAT_COLORS[cat.key] || CAT_COLORS.textMuted;
          return (
            <TouchableOpacity
  accessibilityRole="button"
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              style={{
                backgroundColor: active ? cc.border : card,
                borderWidth:1.5, borderColor: cc.border,
                borderRadius:20, paddingHorizontal:12, paddingVertical:7,
                marginRight:8, flexDirection:'row', alignItems:'center', gap:5,
              }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13 }}>{cat.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={{
                fontSize:12, fontWeight:'600',
                color: active ? colors.bgCard : cc.text,
              }}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Count */}
      <Text maxFontSizeMultiplier={1.4} style={{ paddingHorizontal:16, paddingBottom:6, color:sub, fontSize:12 }}>
        {filtered.length} resource{filtered.length !== 1 ? 's' : ''}
        {category !== 'ALL' ? ` · ${CATEGORIES.find(c=>c.key===category)?.label}` : ''}
      </Text>

      {error ? (
        <View>
        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.emergencyDark, textAlign:'center', margin:20 }}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Try again" onPress={() => load()}
            style={{ marginTop: 12, alignItems: 'center', padding: 8 }}
          >
            <Text style={{ color: ('\x23' + '1d4ed8') as string, fontSize: 14 }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={filtered}
          keyExtractor={i => String(i.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
          contentContainerStyle={{ paddingHorizontal:16, paddingBottom:24 }}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color:sub, textAlign:'center', marginTop:40 }}>
              🔍 No resources found{q ? ` for "${q}"` : ''}.
            </Text>
          }
          renderItem={({ item }) => {
            const isOpen = expanded === item.id;
            const cc = CAT_COLORS[item.category] || CAT_COLORS.textMuted;
            const cat = CATEGORIES.find(c => c.key === item.category);
            return (
              <TouchableOpacity
  accessibilityRole="button"
                onPress={() => setExpanded(isOpen ? null : item.id)}
                style={{
                  backgroundColor:card, borderRadius:12, marginBottom:12,
                  padding:14, borderWidth:1,
                  borderColor: isOpen ? cc.border : (colors.border),
                  shadowColor:colors.textPrimary, shadowOpacity:0.06, shadowRadius:4,
                  shadowOffset:{ width:0, height:2 },
                }}
                accessibilityLabel={item.title}
              >
                {/* Header row */}
                <View style={{ flexDirection:'row', alignItems:'flex-start', gap:8 }}>
                  <View style={{
                    backgroundColor: cc.bg, borderRadius:8,
                    paddingHorizontal:8, paddingVertical:4, flexShrink:0,
                  }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, fontWeight:'700', color:cc.text }}>
                      {cat?.icon} {item.state || 'NAT'}
                    </Text>
                  </View>
                  <View style={{ flex:1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontWeight:'700', fontSize:14, lineHeight:20 }}>
                      {item.title}
                    </Text>
                    {item.free === 1 && (
                      <View style={{
                        backgroundColor:colors.legalBg, borderRadius:6,
                        paddingHorizontal:6, paddingVertical:2,
                        alignSelf:'flex-start', marginTop:4,
                      }}>
                        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.legalDark, fontSize:10, fontWeight:'700' }}>FREE</Text>
                      </View>
                    )}
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:16 }}>{isOpen ? '▲' : '▼'}</Text>
                </View>

                {/* Expanded */}
                {isOpen && (
                  <View style={{ marginTop:12 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontSize:13, lineHeight:20 }}>{item.body}</Text>

                    {/* Contact info grid */}
                    <View style={{ marginTop:12, gap:6 }}>
                      {item.phone ? (
                        <TouchableOpacity accessibilityRole="button"
                          onPress={() => Linking.openURL(`tel:${item.phone.replace(/[^\d+]/g,'')}`).catch(() => {})}
                          style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>📞</Text>
                          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.primary, fontWeight:'600', fontSize:14 }}>
                            {item.phone}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.url ? (
                        <TouchableOpacity accessibilityRole="button"
                          onPress={() => Linking.openURL(item.url).catch(() => {})}
                          style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>🌐</Text>
                          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.primary, fontWeight:'600', fontSize:14 }}
                            numberOfLines={1}>
                            {item.url.replace(/^https?:\/\//, '').slice(0,40)}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.address ? (
                        <TouchableOpacity accessibilityRole="button"
                          onPress={() => Linking.openURL(`https://maps.apple.com/?address=${encodeURIComponent(item.address)}`).catch(() => {})}
                          style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>📍</Text>
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>{item.address}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.hours ? (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>🕐</Text>
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>{item.hours}</Text>
                        </View>
                      ) : null}
                      {item.income_limit ? (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>💰</Text>
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>Eligibility: {item.income_limit}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({});
