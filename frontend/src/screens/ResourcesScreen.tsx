import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, RefreshControl, TouchableOpacity, TextInput, Linking, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, LayoutAnimation } from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import { cachedGet }           from '../services/api';
import { cacheResources, getCachedResources } from '../services/offlineCache';
import { useTheme, COLORS, themed } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';
import { helpLine, websiteUrl, websiteLabel, directionsUrl } from '../utils/contact';
import { stateName } from '../utils/userState';


const CATEGORIES = perLang(() => [
  { key: 'ALL',                label: t('x_practice_area_selector_all'),              icon: ICONS.book },
  { key: 'PUBLIC_DEFENDER',   label: t('x_resources_public_defender'),  icon: ICONS.lawyer  },
  { key: 'LEGAL_AID',         label: t('x_resources_free_legal_aid'),   icon: ICONS.emergency },
  { key: 'CRISIS_LINE',       label: t('x_resources_crisis_lines'),     icon: ICONS.phone },
  { key: 'DV_SHELTER',        label: t('x_resources_dv_help'),          icon: ICONS.housing },
  { key: 'INMATE_LOOKUP',     label: t('x_resources_find_inmate'),      icon: ICONS.search },
  { key: 'TREATMENT',         label: t('x_resources_treatment'),        icon: ICONS.drug },
  { key: 'EXPUNGEMENT',       label: t('x_resources_clear_record'),     icon: ICONS.cases  },
  { key: 'IMMIGRATION_COURT', label: t('chat_cat_immigration'),      icon: ICONS.globe },
  { key: 'COURT_PAYMENT',     label: t('x_resources_pay_fees'),         icon: ICONS.card },
  { key: 'VICTIM_COMPENSATION',label: t('x_resources_victim_help'),     icon: ICONS.shield  },
  { key: 'LAW_CLINIC',        label: t('x_resources_free_clinics'),     icon: ICONS.graduation },
  { key: 'PROBATION',         label: t('x_resources_probation'),        icon: ICONS.clipboard },
  { key: 'ATTORNEY_COMPLAINT',label: t('x_resources_report_attorney'),  icon: ICONS.statusWarn  },
]);

const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = themed(colors => ({
  ALL:                { bg: colors.infoBg, border: colors.blue, text: colors.textBrand },
  PUBLIC_DEFENDER:    { bg: colors.bgSubtle, border: colors.navy, text: colors.textBrand },
  LEGAL_AID:          { bg: colors.legalBg, border: colors.legalDark, text: colors.legalDark },
  CRISIS_LINE:        { bg: colors.emergencyBg, border: colors.emergencyDark, text: colors.emergencyDark },
  DV_SHELTER:         { bg: colors.warnBg, border: colors.warnDark, text: colors.warnDark },
  INMATE_LOOKUP:      { bg: colors.bgSubtle, border: colors.navy, text: colors.textBrand },
  TREATMENT:          { bg: colors.bgSubtle, border: colors.navy, text: colors.textBrand },
  EXPUNGEMENT:        { bg: colors.bgCard, border: colors.legalDark, text: colors.legalDark },
  IMMIGRATION_COURT:  { bg: colors.infoBg, border: colors.blue, text: colors.info },
  COURT_PAYMENT:      { bg: colors.legalBg, border: colors.legalDark, text: colors.legalDark },
  VICTIM_COMPENSATION:{ bg: colors.bgCard, border: colors.warnDark, text: colors.warnDark },
  LAW_CLINIC:         { bg: colors.legalBg, border: colors.legalDark, text: colors.legalDark },
  PROBATION:          { bg: colors.bgSubtle, border: colors.textSecond, text: colors.textSecond },
  ATTORNEY_COMPLAINT: { bg: colors.emergencyBg, border: colors.emergencyDark, text: colors.emergencyDark },
}));




function ResourcesScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const { colors, isDark } = useTheme();
  const mountedRef = useRef(true);
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);

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
      const res = await cachedGet('/resources?limit=1000');
      // Rows carry either title/body/url or name/description/website; normalise once.
      const items = (Array.isArray(res.data) ? res.data : []).map((r: any) => ({
        ...r,
        title: r.title || r.name || '',
        body:  r.body  || r.description || '',
        url:   r.url   || r.website || '',
      }));
      if (mountedRef.current) { setAllItems(items); cacheResources(items); }
    } catch {
      const cached = await getCachedResources().catch(() => []);
      if (mountedRef.current && cached?.length) setAllItems(cached);
      else if (mountedRef.current) setError(t('x_resources_could_not_load_resources'));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter whenever category or search changes
  useEffect(() => {
    let list = allItems;
    if (category !== 'ALL') list = (list ?? []).filter(i => i.category === category);
    if (q.trim()) {
      const lower = q.toLowerCase();
      list = (list ?? []).filter(i =>
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

  if (loading && !allItems.length) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:bg }}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text maxFontSizeMultiplier={1.4} style={{ color:sub, marginTop:12 }}>{t('x_resources_loading_resources')}</Text>
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:bg }}
      testID="resources-screen">
      {/* Search bar */}
      <View style={{ paddingHorizontal:16, paddingTop:12, paddingBottom:8 }}>
        <TextInput
          accessibilityLabel={t('x_resources_search_resources')}
          accessibilityHint={t('cp_double_tap')}
          value={q}
          onChangeText={setQ}
          placeholder={t('x_resources_search_resources')}
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius:10, paddingHorizontal:14,
            paddingVertical:10, color:text, fontSize:15,
            borderWidth:1, borderColor: colors.border,
          }}
          returnKeyType="search" blurOnSubmit={true}
        />
      </View>

      {/* Category chips */}
      <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flexGrow: 0 }}>
        <ScrollView keyboardShouldPersistTaps="handled"
        horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow:0 }} contentContainerStyle={{ paddingHorizontal:12, paddingBottom:10, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}>
        {CATEGORIES().map(cat => {
          const active = category === cat.key;
          const cc = CAT_COLORS[cat.key] || CAT_COLORS.ALL;
          return (
            <TouchableOpacity
  accessibilityRole="button"
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              style={{
                backgroundColor: active ? cc.border : cc.bg,
                borderWidth:1.5, borderColor: cc.border,
                borderRadius:20, paddingHorizontal:12, paddingVertical:7,
                marginRight:8, flexDirection:'row', alignItems:'center', gap:5,
              }}>
              <AppIcon name={cat.icon} size={13} color={colors.textBrand} style={{ fontSize:13 }} />
              <Text maxFontSizeMultiplier={1.4} style={{
                fontSize:12, fontWeight:'600',
                color: active ? COLORS.white : cc.text,
              }}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Count */}
      <Text maxFontSizeMultiplier={1.4} style={{ paddingHorizontal:16, paddingBottom:6, color:sub, fontSize:12 }}>
        {t(filtered.length === 1 ? 'x_resources_resource_one' : 'x_resources_resource_other', { length: filtered.length, value2: category !== 'ALL' ? ` · ${CATEGORIES().find(c=>c.key===category)?.label}` : '' })}
      </Text>

      {error ? (
        <View>
        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.emergencyDark, textAlign:'center', margin:20 }}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('try_again')} onPress={() => load()}
            style={{ marginTop: 12, alignItems: 'center', padding: 8 }}
          >
            <Text style={{ color: colors.info, fontSize: 14 }}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList
          data={filtered ?? []}
          keyExtractor={(i: { id: number | string }) => String(i.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
          contentContainerStyle={{ paddingHorizontal:16, paddingBottom:24 }}
          initialNumToRender={15}
          ListEmptyComponent={
            <IconLabel icon={ICONS.search} textStyle={{ color:sub, textAlign:'center', marginTop:40 }} maxFontSizeMultiplier={1.4}>{t('x_resources_no_resources_found', { value: q ? ' ' + t('x_resources_text', { q }) : '' })}</IconLabel>
          }
          renderItem={({ item }: { item: any }) => {
            const isOpen = expanded === item.id;
            const cc = CAT_COLORS[item.category] || CAT_COLORS.ALL;
            const line = helpLine(item.phone);
            const site = websiteUrl(item.url);
            const directions = directionsUrl({ address: [item.address, item.city, item.state].filter(Boolean).join(', '), name: item.title });
            const cat = CATEGORIES().find(c => c.key === item.category);
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
                    <IconLabel icon={cat?.icon ?? ICONS.library} maxFontSizeMultiplier={1.4} textStyle={{ fontSize:11, fontWeight:'700', color:cc.text }}>
                      {item.state ? stateName(item.state) : t('x_resources_national')}
                    </IconLabel>
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
                        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.legal, fontSize:10, fontWeight:'700' }}>{t('x_resources_free')}</Text>
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
                      {line ? (
                        <TouchableOpacity accessibilityRole="button" testID="resource-call"
                          accessibilityLabel={line.kind === 'sms' ? t('crisis_text_a11y', { name: item.title }) : t('hn_call_a11y', { name: item.title })}
                          onPress={() => Linking.openURL(line.url).catch(() => showToast(t('x_crisis_resources_please_dial_manually', { number: line.label }), 'warning'))}
                          style={{ flexDirection:'row', alignItems:'center', gap:8, minHeight:44 }}>
                          <AppIcon name={line.kind === 'sms' ? 'chatbubble-outline' : 'call-outline'} size={20} color={colors.legal} />
                          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textBrand, fontWeight:'600', fontSize:14, flexShrink:1 }}>
                            {line.label}{line.after ? ` — ${/press (\d)/i.test(line.after) ? t('res_then_press', { n: (/press (\d)/i.exec(line.after) as RegExpExecArray)[1] }) : line.after}` : ''}
                          </Text>
                        </TouchableOpacity>
                      ) : item.phone ? (
                        <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:14 }}>{item.phone}</Text>
                      ) : null}
                      {site ? (
                        <TouchableOpacity accessibilityRole="link" testID="resource-website"
                          onPress={() => Linking.openURL(site).catch(() => showToast(t('action_failed'), 'error'))}
                          style={{ flexDirection:'row', alignItems:'center', gap:8, minHeight:44 }}>
                          <AppIcon name={ICONS.globe} size={16} color={colors.textBrand} style={{ fontSize:16 }} />
                          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textBrand, fontWeight:'600', fontSize:14, flexShrink:1 }}
                            numberOfLines={1}>
                            {websiteLabel(site)}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.address && directions ? (
                        <TouchableOpacity accessibilityRole="button"
                          onPress={() => Linking.openURL(directions).catch(() => showToast(t('action_failed'), 'error'))}
                          style={{ flexDirection:'row', alignItems:'center', gap:8, minHeight:44 }}>
                          <AppIcon name={ICONS.location} size={16} color={colors.textBrand} style={{ fontSize:16 }} />
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>{item.address}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.hours ? (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <AppIcon name={ICONS.clock} size={16} color={colors.textBrand} style={{ fontSize:16 }} />
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>{item.hours}</Text>
                        </View>
                      ) : null}
                      {item.income_limit ? (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                          <AppIcon name="cash-outline" size={20} color={colors.legal} />
                          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:13 }}>{t('x_resources_eligibility', { income_limit: item.income_limit })}</Text>
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

export default React.memo(ResourcesScreen);
