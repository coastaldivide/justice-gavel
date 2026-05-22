import ScreenHeader from '../components/ScreenHeader';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Linking, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StyleSheet} from 'react-native';
import { api, cachedGet } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

type SpecialtyCourt = {
  id: number; name: string; court_type: string;
  city: string; state: string; county: string;
  address: string; phone: string; url?: string;
  eligibility: string; notes?: string; lat?: number; lng?: number;
};

const COURT_TYPES = [
  { key: 'ALL',                label: 'All Specialty Courts', icon: '⚖️',  color: COLORS.blue, bg: COLORS.infoBg },
  { key: 'Veterans',           label: 'Veterans Courts',      icon: '🎖️',  color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Drug Court',         label: 'Drug Courts',          icon: '💊',  color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Mental Health Court',label: 'Mental Health Courts', icon: '🧠',  color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
];

export default function SpecialtyCourtsScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
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
      setAll(res.data || []);
    } catch { setError('Could not load specialty courts. Check connection.'); }
    finally { setLoading(false); }
  }, [state]);

  useEffect(() => { load(); }, [load]);

  const filtered = type === 'ALL' ? all : all.filter(c => c.court_type === type);
  const typeConfig = COURT_TYPES.find(t => t.key === type) || COURT_TYPES[0];

  const openMaps = (addr: string, lat?: number, lng?: number) => {
    const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr);
    Linking.openURL(`https://maps.apple.com/?q=${q}`).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* Hero */}
      <View style={{ backgroundColor: colors.blue, padding: 16 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.bgCard, fontWeight: '800', fontSize: 17 }}>
          ⚖️ Specialty Courts
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 }}>
          Veterans Treatment Courts, Drug Courts, and Mental Health Courts
          offer treatment-based alternatives to traditional prosecution.
        </Text>
      </View>

      {/* State filter */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <TextInput
          value={state}
          onChangeText={v => setState(v.toUpperCase().slice(0, 2))}
          placeholder="Filter by state (e.g. TN, CA, TX)…"
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
        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        {COURT_TYPES.map(t => (
          <TouchableOpacity key={t.key}
            onPress={() => setType(t.key)}
              accessibilityRole="button"
            style={{
              backgroundColor: type === t.key ? t.color : card,
              borderWidth: 1.5, borderColor: t.color, borderRadius: 20,
              paddingHorizontal: 12, paddingVertical: 7, marginRight: 8,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13 }}>{t.icon}</Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight: '600',
              color: type === t.key ? colors.bgCard : t.color }}>
              {t.label.replace(' Courts','').replace(' Court','')}
            </Text>
          </TouchableOpacity>
        ))}

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: '#555', fontStyle: 'italic' }}>
          ⚖️ General legal information only -- not legal advice. Laws vary by
          jurisdiction and change frequently. Consult a licensed attorney for
          advice specific to your situation.
        </Text>
      </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <Text maxFontSizeMultiplier={1.4} style={{ paddingHorizontal: 16, paddingBottom: 6, color: sub, fontSize: 12 }}>
        {filtered.length} court{filtered.length !== 1 ? 's' : ''}
        {type !== 'ALL' ? ` · ${type}` : ''}
        {state ? ` · ${state}` : ''}
      </Text>

      {loading && <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />}
      {error ? (
        <><Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergencyDark, textAlign:"center", margin:16 }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={load} style={{marginTop:8,padding:10,backgroundColor:'#1A237E',borderRadius:8,alignItems:'center'}}><Text maxFontSizeMultiplier={1.4} style={{color:'#fff',fontWeight:'700'}}>Retry</Text></TouchableOpacity></> 
      ) : null}
      {!loading && !error && <FlatList
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} />}
          keyboardShouldPersistTaps="handled"
          data={filtered}
          keyExtractor={i => String(i.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={true}
          renderItem={({ item }) => {
            const open = expanded === item.id;
            const ct = COURT_TYPES.find(t => t.key === item.court_type) || COURT_TYPES[0];
            return (
              <TouchableOpacity
                accessibilityRole="button"
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
                  {item.city}, {item.state} · {item.county} County
                </Text>

                {open && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    {/* Eligibility */}
                    <View style={{ backgroundColor: ct.bg, borderRadius: 8, padding: 10 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: ct.color, fontWeight: '700', fontSize: 11,
                        marginBottom: 4 }}>WHO QUALIFIES</Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? text : '#333', fontSize: 12,
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
                        accessibilityLabel="HOW TO GET IN"
                        onPress={() => Linking.openURL(`tel:${item.phone.replace(/[^\d+]/g,'')}`).catch(() => {})}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>📞</Text>
                        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontSize: 13,
                          fontWeight: '600' }}>{item.phone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <View style={{ backgroundColor: isDark ? colors.legal : colors.legalBg,
                      borderRadius: 8, padding: 10 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12,
                        fontWeight: '700', marginBottom: 4 }}>
                        HOW TO GET IN
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12 }}>
                        Tell your attorney you are interested in this court at your first
                        meeting. Request referral at arraignment. Bring documentation of your
                        eligibility (DD-214 for veterans, mental health diagnosis records,
                        or substance use disorder assessment).
                      </Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginTop: 40 }}>
              No specialty courts found{state ? ` in ${state}` : ''}.
              {'\n'}Try a different state or clear the filter.
            </Text>
          }
        />
      }

    </View>
  );
}

const styles = StyleSheet.create({});
