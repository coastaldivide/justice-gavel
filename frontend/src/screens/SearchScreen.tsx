/**
 * SearchScreen -- Global search across all user data
 *
 * Searches: Cases, Messages, Saved Lawyers, Lessons.
 * Results are grouped by type with icons and navigation.
 * Uses /api/search with 300ms debounce.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform} from 'react-native';
import { api } from '../services/api';
import {  useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { getUserState } from '../utils/userState';
import {
  cacheSearch, getCachedSearch,
  saveRecentSearch, getRecentSearches, clearRecentSearches } from '../services/offlineCache';

interface SearchResult {
  id: number;
  type: 'case' | 'message' | 'lawyer' | 'lesson';
  title: string;
  subtitle: string;
  screen: string;
  params: Record<string, unknown>;
}

const TYPE_ICONS: Record<string, string> = {
  case:    '📁',
  message: '💬',
  lawyer:  '⚖️',
  lesson:  '📚' };

const TYPE_LABELS: Record<string, string> = {
  case:    'Cases',
  message: 'Messages',
  lawyer:  'Saved Attorneys',
  lesson:  'Legal Lessons' };

const SECTION_ORDER = ['case', 'message', 'lawyer', 'lesson'];


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function SearchScreen({ navigation }: ScreenProps): React.JSX.Element {

  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    getUserState().then(s => { if (s?.code) userStateRef.current = s.code; }).catch(() => {});
  }, []);

  // Load recent searches on mount
  React.useEffect(() => {
    getRecentSearches().then(setRecentSearches).catch(() => {});
    // Restore last cached search if any
    getCachedSearch().then(cached => {
      if (cached?.query && cached.results) {
        setQuery(cached.query);
        const { cases=[], messages=[], lawyers=[], lessons=[] } = cached.results as any /* SearchResults — raw API, transformed to SearchResult[] below */;
        const allResults = [...cases, ...messages, ...lawyers, ...lessons];
        setResults(allResults);
        cacheSearch(cached.query, { cases, messages, lawyers, lessons }).catch(() => {});
        saveRecentSearch(cached.query).then(() =>
          getRecentSearches().then(setRecentSearches).catch(() => {})
        ).catch(() => {});
        setSearched(true);
      }
    }).catch(() => {});
  }, []);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  

  const { colors } = useTheme();
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [fetchError, setFetchError] = useState<string>('');
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onRefresh = useCallback(async () => {
    if (!query.trim()) return;
    setRefreshing(true);
    await doSearch(query).catch(() => {});
    setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]); setSearched(false); return;
    }
    setLoading(true);
    try {
      const res = await api.get('/search', { params: { q: q.trim(), limit: 8, user_state: userStateRef.current || undefined } });
      if (!mountedRef.current) return;
      const { cases=[], messages=[], lawyers=[], lessons=[] } = res.data || {};
      const allResults = [...cases, ...messages, ...lawyers, ...lessons];
        setResults(allResults);
        cacheSearch(q, { cases, messages, lawyers, lessons }).catch(() => {});
        saveRecentSearch(q).then(() =>
          getRecentSearches().then(setRecentSearches).catch(() => {})
        ).catch(() => {});
      setSearched(true);
    } catch {
      if (mountedRef.current) { setResults([]); setSearched(true); }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => doSearch(text), 300);
  };

  // Group results by type
  const grouped = SECTION_ORDER.reduce((acc, type) => {
    const items = results.filter(r => r.type === type);
    if (items.length) acc.push({ type, items });
    return acc;
  }, [] as { type: string; items: SearchResult[] }[]);

  const handleTap = (item: SearchResult) => {
    navigation?.navigate('MoreTab', {
      screen: item.screen,
      params: item.params });
  };

  const s = styles(colors as any);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View style={[s.screen, { backgroundColor: colors.bg }]}>
      {/* Search input */}
      <View style={[s.searchBar, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={s.searchIcon}>🔍</Text>
        <TextInput
          style={[s.input, { color: colors.textPrimary }]}
          placeholder="Search cases, messages, attorneys, lessons…"
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={handleChange}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => doSearch(query)}
          maxLength={120}
          clearButtonMode="while-editing"
          accessibilityLabel="Search"
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.navy} style={{ marginRight: 8 }} />
        )}
      </View>

      <FlatList
        data={grouped}
        keyExtractor={item => item.type}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews={true}
        onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={
          searched && !loading ? (
            <View style={s.empty}>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptyTitle, { color: colors.textPrimary }]}>
                No results for "{query}"
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptySub, { color: colors.textMuted }]}>
                Try different words or check the spelling.
              </Text>
            </View>
          ) : !searched ? (
            <View>
              {recentSearches.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between',
                    alignItems:'center', marginBottom:8 }}>
                    <Text maxFontSizeMultiplier={1.4}
                      style={[s.sectionLabel, { color: colors.textMuted }]}>
                      🕐 Recent Searches
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        clearRecentSearches().catch(() => {});
                        setRecentSearches([]);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Clear recent searches"
                    >
                      <Text maxFontSizeMultiplier={1.4}
                        style={{ fontSize:12, lineHeight:18, color: colors.textMuted }}>
                        Clear
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {recentSearches.map((q, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[s.resultRow, { backgroundColor: colors.bgCard,
                        borderColor: colors.border }]}
                      onPress={() => { setQuery(q); doSearch(q); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${q}`}
                      activeOpacity={0.75}
                    >
                      <Text maxFontSizeMultiplier={1.4}
                        style={{ fontSize:14, lineHeight:21, color: colors.textPrimary, flex:1 }}>
                        {q}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, fontSize:18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Suggested searches */}
              <View style={{ marginBottom: 16 }}>
                <Text maxFontSizeMultiplier={1.4}
                  style={[s.sectionLabel, { color: colors.textMuted, marginBottom: 10 }]}>
                  💡 Common Searches
                </Text>
                <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
                  {['DUI attorney','bail bondsman','expungement','drug charge','know my rights',
                    'public defender','court date','probation violation','assault charge'].map(q => (
                    <TouchableOpacity key={q}
                      style={{ backgroundColor: colors.bgCard, borderRadius: 20,
                        paddingHorizontal:14, paddingVertical:8,
                        borderWidth:1, borderColor: colors.border }}
                      onPress={() => { setQuery(q); doSearch(q); }}
                      accessibilityRole="button"
                    >
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, color: colors.textSecond }}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.empty}>
                <Text maxFontSizeMultiplier={1.4} style={s.emptyIcon}>🔍</Text>
                <Text maxFontSizeMultiplier={1.4}
                  style={[s.emptySub, { color: colors.textMuted }]}>
                  Search across your cases, messages,{'\n'}saved attorneys, and legal lessons.
                </Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: section }) => (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4}
              style={[s.sectionLabel, { color: colors.textMuted }]}>
              {TYPE_ICONS[section.type]} {TYPE_LABELS[section.type]}
            </Text>
            {section.items.map((result, i) => (
              <TouchableOpacity
                key={result.id}
                style={[s.resultRow, { backgroundColor: colors.bgCard, borderColor: colors.border },
                  i < section.items.length-1 && { borderBottomWidth:0, borderBottomLeftRadius:0, borderBottomRightRadius:0 }]}
                onPress={() => handleTap(result)}
                accessibilityRole="button"
                accessibilityLabel={result.title}
                activeOpacity={0.75}
              >
                <View style={{ flex:1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.resultTitle, { color: colors.textPrimary }]}
                    numberOfLines={1}>
                    {result.title}
                  </Text>
                  {!!result.subtitle && (
                    <Text maxFontSizeMultiplier={1.4} style={[s.resultSub, { color: colors.textMuted }]}
                      numberOfLines={2}>
                      {result.subtitle}
                    </Text>
                  )}
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, fontSize:18 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
    </View>
    </KeyboardAvoidingView>
  )}


const styles = (C: Record<string, string>) => StyleSheet.create({
  screen:       { flex:1 },
  searchBar:    { flexDirection:'row', alignItems:'center', margin:16,
                  borderRadius:RADIUS.lg, borderWidth:1, paddingHorizontal:12, gap:8 },
  searchIcon:   { fontSize:16 },
  input:        { flex:1, fontSize:TYPE.base, lineHeight:21, paddingVertical:14 },
  list:         { paddingHorizontal:16, paddingBottom:40 },
  section:      { marginBottom:20 },
  sectionLabel: { fontSize:TYPE.xs, lineHeight:16, ...FONTS.extraBold,
                  letterSpacing:0.8, textTransform:'uppercase', marginBottom:8 },
  resultRow:    { borderRadius:RADIUS.md, borderWidth:1, paddingHorizontal:14,
                  paddingVertical:12, marginBottom:1, flexDirection:'row',
                  alignItems:'center', gap:12 },
  resultTitle:  { fontSize:TYPE.base, lineHeight:21, ...FONTS.semiBold, marginBottom:2 },
  resultSub:    { fontSize:TYPE.sm, lineHeight:18 },
  empty:        { alignItems:'center', paddingTop:60, paddingHorizontal:32 },
  emptyIcon:    { fontSize:48, marginBottom:16 },
  emptyTitle:   { fontSize:TYPE.lg, lineHeight:27, ...FONTS.semiBold, marginBottom:8, textAlign:'center' },
  emptySub:     { fontSize:TYPE.base, lineHeight:21, textAlign:'center' } });
