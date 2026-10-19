import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
import type {} from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, RefreshControl, Linking, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, LayoutAnimation } from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import { unwrapList, cachedGet } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';

type SpecialtyCourt = {
  id: number; name: string; court_type: string;
  city: string; state: string; county: string;
  address: string; phone: string; url?: string;
  eligibility: string; notes?: string; lat?: number; lng?: number;
};

const COURT_TYPES = perLang(() => [
  { key: 'ALL',                label: t('x_specialty_courts_all_specialty_courts'), icon: '⚖️',  color: COLORS.blue, bg: COLORS.infoBg },
  { key: 'Veterans',           label: t('x_specialty_courts_veterans_courts'),      icon: '🎖️',  color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Drug Court',         label: t('x_specialty_courts_drug_courts'),          icon: '💊',  color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Mental Health Court',label: t('x_specialty_courts_mental_health_courts'), icon: '🧠',  color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
]);

function SpecialtyCourtsScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors, isDark } = useTheme();
  const [all, setAll]         = useState<SpecialtyCourt[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [type, setType]       = useState('ALL');
  const [state, setState]     = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError]     = useState('');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (state) params.set('state', state.toUpperCase());
      const res = await cachedGet(`/legaldata/specialty-courts?${params}`);
      if (!mountedRef.current) return;
      setAll(unwrapList(res.data));
    } catch { setError(t('x_specialty_courts_could_not_load_specialty')); }
    finally { setLoading(false); }
  }, [state]);

  useEffect(() => { load(); }, [load]);

  const filtered = type === 'ALL' ? all : all.filter(c => c.court_type === type);

  const openMaps = (addr: string, lat?: number, lng?: number) => {
    const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr);
    Linking.openURL(`https://maps.apple.com/?q=${q}`).catch(() => showToast(t('action_failed'), 'error'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="specialty-courts-screen">
      {/* Hero */}
      <View style={{ backgroundColor: colors.blue, padding: 16 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textOnNavy, fontWeight: '800', fontSize: 17 }}>
          {t('x_nav_specialty_courts')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 }}>
          {t('x_specialty_courts_veterans_treatment_courts_drug')}
        </Text>
      </View>

      {/* State filter */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <TextInput
          accessibilityLabel={t('x_specialty_courts_filter_by_state_e')}
          accessibilityHint={t('x_lawyers_filters_list_by_selected')}
          value={state}
          onChangeText={v => setState(v.toUpperCase().slice(0, 2))}
          placeholder={t('x_specialty_courts_filter_by_state_e')}
          placeholderTextColor={sub}
          maxLength={2}
          autoCapitalize="characters"
          style={{
            backgroundColor: card, borderRadius: 10, paddingHorizontal: 14,
            paddingVertical: 10, color: text, fontSize: 14,
            borderWidth: 1, borderColor: colors.border,
          }}
        />
      </View>

      {/* Type chips */}
      <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled"
          horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}>
        {COURT_TYPES().map(tItem => (
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} key={tItem.key}
            onPress={() => setType(tItem.key)}
            style={{
              backgroundColor: type === tItem.key ? tItem.color : card,
              borderWidth: 1.5, borderColor: tItem.color, borderRadius: 20,
              paddingHorizontal: 12, paddingVertical: 7, marginRight: 8,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13 }}>{tItem.icon}</Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight: '600',
              color: type === tItem.key ? colors.bgCard : tItem.color }}>
              {tItem.label.replace(' Courts','').replace(' Court','')}
            </Text>
          </TouchableOpacity>
        ))}

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: colors.textSecond, fontStyle: 'italic' }}>
          {t('x_interrogation_recorder_general_legal_information_only')}
        </Text>
      </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <Text maxFontSizeMultiplier={1.4} style={{ paddingHorizontal: 16, paddingBottom: 6, color: sub, fontSize: 12 }}>
        {t(filtered.length === 1 ? 'x_specialty_courts_court_one' : 'x_specialty_courts_court_other', { length: filtered.length, value2: type !== 'ALL' ? ` · ${type}` : '', value3: state ? ` · ${state}` : '' })}
      </Text>

      {loading && <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />}
      {error ? (
        <><Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergencyDark, textAlign:"center", margin:16 }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={load} style={{marginTop:8,padding:10,backgroundColor:(colors.navy || COLORS.navy),borderRadius:8,alignItems:'center'}} accessibilityLabel={t('retry')}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Text maxFontSizeMultiplier={1.4} style={{color:colors.bg,fontWeight:'700'}}>{t('retry')}</Text></TouchableOpacity></> 
      ) : null}
      {!loading && !error && <FlashList
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} />}
          data={filtered}
          keyExtractor={(i: SpecialtyCourt) => String(i.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          initialNumToRender={10}
          renderItem={({ item }: { item: SpecialtyCourt }) => {
            const open = expanded === item.id;
            const ct = COURT_TYPES().find(tItem => tItem.key === item.court_type) || COURT_TYPES()[0];
            return (
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                onPress={() => setExpanded(open ? null : item.id)}
                style={{
                  backgroundColor: card, borderRadius: 12, marginBottom: 10,
                  padding: 14, borderWidth: 1,
                  borderColor: open ? ct.color : (colors.border),
                  shadowColor: colors.textPrimary, shadowOpacity: 0.05, shadowRadius: 3,
                  shadowOffset: { width: 0, height: 1 },
                }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ backgroundColor: ct.bg, borderRadius: 8,
                    paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: ct.color, fontWeight: '700', fontSize: 10 }}>
                      {ct.icon} {(item.court_type || "").toUpperCase()}
                    </Text>
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 11, paddingTop: 2 }}>
                    {item.state}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sub, marginLeft: 'auto', fontSize: 16 }}>
                    {open ? '▲' : '▼'}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '700', fontSize: 14,
                  marginTop: 6, lineHeight: 20 }}>{item.name}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, marginTop: 2 }}>
                  {t('x_specialty_courts_county', { city: item.city, state: item.state, county: item.county })}
                </Text>

                {open && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    {/* Eligibility */}
                    <View style={{ backgroundColor: ct.bg, borderRadius: 8, padding: 10 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: ct.color, fontWeight: '700', fontSize: 11,
                        marginBottom: 4 }}>{t('mh_who')}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? text : colors.textSecond, fontSize: 12,
                        lineHeight: 18 }}>{item.eligibility}</Text>
                    </View>

                    {item.notes ? (
                      <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, fontStyle: 'italic' }}>
                        ℹ️ {item.notes}
                      </Text>
                    ) : null}

                    {item.address ? (
                      <TouchableOpacity
                        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                        onPress={() => openMaps(item.address, item.lat, item.lng)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>📍</Text>
                        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontSize: 13,
                          fontWeight: '600', flex: 1 }}>{item.address}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {item.phone ? (
                      <TouchableOpacity
                        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                        accessibilityLabel={t('x_specialty_courts_how_get')}
                        onPress={() => Linking.openURL(`tel:${item.phone.replace(/[^\d+]/g,'')}`).catch(() => showToast(t('action_failed'), 'error'))}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <AppIcon name="call-outline" size={20} color={colors.legal} />
                        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontSize: 13,
                          fontWeight: '600' }}>{item.phone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <View style={{ backgroundColor: isDark ? colors.legal : colors.legalBg,
                      borderRadius: 8, padding: 10 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12,
                        fontWeight: '700', marginBottom: 4 }}>
                        {t('x_specialty_courts_how_get')}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12 }}>
                        {t('x_specialty_courts_tell_attorney_interested_this')}
                      </Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginTop: 40 }}>
              {t('x_specialty_courts_no_specialty_courts_found', { value: state ? ' ' + t('x_specialty_courts_text', { state }) : '' })}
            </Text>
          }
        />
      }

    </View>
  );
}

export default React.memo(SpecialtyCourtsScreen);
