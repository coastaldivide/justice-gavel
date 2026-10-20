import { AppIcon } from '../components/AppIcon';
/**
 * SearchScreen -- Global search across all user data
 *
 * Searches: Cases, Messages, Saved Lawyers, Lessons.
 * Results are grouped by type with icons and navigation.
 * Uses /api/search with 300ms debounce.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, LayoutAnimation} from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import { api } from '../services/api';
import {  useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { getUserState } from '../utils/userState';
import {
  cacheSearch, getCachedSearch,
  saveRecentSearch, getRecentSearches, clearRecentSearches } from '../services/offlineCache';
import { t, perLang, useLang } from '../i18n';
import * as secureStorage from '../utils/secureStorage';

interface SearchResult {
  id: number;
  type: 'case' | 'message' | 'lawyer' | 'lesson';
  title: string;
  subtitle: string;
  screen: string;
  params: Record<string, unknown>;
}

type SearchSection = { type: string; items: SearchResult[] };

const TYPE_ICONS: Record<string, string> = {
  case:    '📁',
  message: '💬',
  lawyer:  '⚖️',
  lesson:  '📚' };

const TYPE_LABELS = perLang((): Record<string, string> => ({
  case:    t('nav_cases'),
  message: t('messages_title'),
  lawyer:  t('x_search_saved_attorneys'),
  lesson:  t('x_search_legal_lessons') }));

const SECTION_ORDER = ['case', 'message', 'lawyer', 'lesson'];



function SearchScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();

  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
        saveRecentSearch(cached.query).then(() => {
          getRecentSearches().then(setRecentSearches).catch(() => {});
        }).catch(() => {});
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
  const [searchError, setSearchError] = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);

  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  React.useEffect(() => { secureStorage.getToken().then(tk => setSignedOut(!tk)).catch(() => setSignedOut(true)); }, []);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]); setSearched(false); return;
    }
    if (!(await secureStorage.getToken().catch(() => null))) { setSignedOut(true); return; }
    setLoading(true);
    setSearchError('');
    try {
      const res = await api.get('/search', { params: { q: q.trim(), limit: 8, user_state: userStateRef.current || undefined } });
      if (!mountedRef.current) return;
      const { cases=[], messages=[], lawyers=[], lessons=[] } = res.data || {};
      const allResults = [...cases, ...messages, ...lawyers, ...lessons];
        setResults(allResults);
        cacheSearch(q, { cases, messages, lawyers, lessons }).catch(() => {});
        saveRecentSearch(q).then(() => {
          getRecentSearches().then(setRecentSearches).catch(() => {});
        }).catch(() => {});
      setSearched(true);
    } catch {
      if (mountedRef.current) { setResults([]); setSearched(true); setSearchError(t('x_search_search_failed_check_connection')); }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    if (!query.trim()) return;
    setRefreshing(true);
    await doSearch(query).catch(() => {});
    setRefreshing(false);
  }, [query, doSearch]);

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
  }, [] as SearchSection[]);

  const handleTap = (item: SearchResult) => {
    navigation?.navigate('MoreTab', {
      screen: item.screen,
      params: item.params });
  };

  const s = styles();

  if (signedOut) return (
    <View style={[s.screen, s.empty, { backgroundColor: colors.bg }]} testID="search-signed-out">
      <AppIcon name="search-outline" size={28} color={colors.textBrand} />
      <Text maxFontSizeMultiplier={1.4} style={[s.emptyTitle, { color: colors.textPrimary }]}>{t('srch_sign_in_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[s.emptySub, { color: colors.textMuted }]}>{t('srch_sign_in_sub')}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation?.navigate('MoreTab', { screen: 'Login' })}
        style={{ marginTop: 16, backgroundColor: colors.navy, borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 24 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textOnNavy, fontWeight: '700' }}>{t('saved_sign_in_button')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation?.navigate('LawyersTab')} style={{ marginTop: 12, padding: 8 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontWeight: '700' }}>{t('saved_find_lawyers')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View style={[s.screen, { backgroundColor: colors.bg }]}
      testID="search-screen">
      {/* Search input */}
      <View style={[s.searchBar, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <AppIcon name="search-outline" size={20} color={COLORS.navy} />
        <TextInput
          style={[s.input, { color: colors.textPrimary }]}
          placeholder={t('x_search_search_cases_messages_attorneys')}
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={handleChange}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => doSearch(query)}
          keyboardType="default"
          maxLength={120}
          clearButtonMode="while-editing"
          accessibilityLabel={t('search')}
          accessibilityHint={t('cp_double_tap')}
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.navy} style={{ marginRight: 8 }} />
        )}
      </View>

      <FlashList
          data={grouped ?? []}
        keyExtractor={(item: SearchSection) => item.type}
        contentContainerStyle={s.list}
          onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={
          searched && !loading ? (
            <View style={s.empty}>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptyTitle, { color: colors.textPrimary }]}>
{searchError
                  ? searchError
                  : t('x_search_no_results', { query })}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptySub, { color: colors.textMuted }]}>
                {t('x_search_try_different_words_check')}
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
                      {t('x_search_recent_searches')}
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => {
                        clearRecentSearches().catch(() => {});
                        setRecentSearches([]);
                      }}
                      accessibilityLabel={t('x_search_clear_recent_searches')}
                    >
                      <Text maxFontSizeMultiplier={1.4}
                        style={{ fontSize:12, lineHeight:18, color: colors.textMuted }}>
                        {t('x_ch_clear')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {recentSearches.map((q, i) => (
                    <TouchableOpacity
                      accessibilityRole="button"
                      key={`recentSe-${i}`}
                      style={[s.resultRow, { backgroundColor: colors.bgCard,
                        borderColor: colors.border }]}
                      onPress={() => { setQuery(q); doSearch(q); }}
                      accessibilityLabel={t('x_search_search', { q })}
                      activeOpacity={0.75}
                    >
                      <Text maxFontSizeMultiplier={1.4}
                        style={{ fontSize:14, lineHeight:21, color: colors.textPrimary, flex:1 }}>
                        {q}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize:18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={s.empty}>
                <AppIcon name="search-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4}
                  style={[s.emptySub, { color: colors.textMuted }]}>
                  {t('x_search_search_across_cases_messages')}
                </Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: section }: { item: SearchSection }) => (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4}
              style={[s.sectionLabel, { color: colors.textMuted }]}>
              {TYPE_ICONS[section.type]} {TYPE_LABELS()[section.type]}
            </Text>
            {(section.items || []).map((result, i) => (
              <TouchableOpacity
                accessibilityRole="button"
                key={result.id}
                style={[s.resultRow, { backgroundColor: colors.bgCard, borderColor: colors.border },
                  i < (section.items || []).length-1 && { borderBottomWidth:0, borderBottomLeftRadius:0, borderBottomRightRadius:0 }]}
                onPress={() => handleTap(result)}
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
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize:18 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = () => StyleSheet.create({
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

export default React.memo(SearchScreen);