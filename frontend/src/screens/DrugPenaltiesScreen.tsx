import LegalNotice from '../components/LegalNotice';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect } from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { api, cachedGet } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

type Penalty = {
  id: number; state: string; drug_schedule: string; offense_type: string;
  amount_threshold: string; charge_level: string;
  min_days: number; max_days: number; min_fine: number; max_fine: number; notes: string;
};

const STATES = [
  'ALL','AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA',
  'WA','WV','WI','WY','FED',
];

const OFFENSE_COLORS: Record<string, { bg:string; border:string; text:string }> = {
  possession:   { bg:COLORS.legalBg, border:COLORS.legalDark, text:COLORS.legalDark },
  delivery:     { bg:COLORS.warnBg, border:COLORS.warnDark, text:COLORS.warnDark },
  trafficking:  { bg:COLORS.emergencyBg, border:COLORS.emergencyDark, text:COLORS.emergencyDark },
  manufacture:  { bg:COLORS.emergencyBg, border:COLORS.emergencyDark, text:COLORS.emergencyDark },
  distribution: { bg:COLORS.warnBg, border:COLORS.warnDark, text:COLORS.warnDark },
};

function fmtTime(min:number, max:number) {
  if (!min && !max) return 'No mandatory minimum';
  const fmt = (d:number) => {
    if (!d) return '0';
    if (d >= 365*10) return `${Math.round(d/365)}yr`;
    if (d >= 365) return `${+(d/365).toFixed(1)}yr`;
    if (d >= 30) return `${Math.round(d/30)}mo`;
    return `${d}d`;
  };
  if (!max || max === min) return fmt(min);
  return `${fmt(min)} - ${fmt(max)}`;
}
function fmtFine(min:number, max:number) {
  if (!min && !max) return 'No mandatory fine';
  const f = (n:number) => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n}`;
  if (!max || max === min) return f(min);
  return `${f(min)} - ${f(max)}`;
}

export default function DrugPenaltiesScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
  const onRefresh = () => { setRefreshing(true); setRefreshTick(t => t + 1); };
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [fetchError, setFetchError] = useState(false);
  const [state, setState]   = useState('TN');
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [offenseFilter, setOffenseFilter] = useState('ALL');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;
  const border = colors.border;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    const params = state === 'ALL' ? '?limit=200' : `?state=${state}&limit=50`;
    cachedGet(`/legaldata/drugs${params}`)
      .then(r => { if (!cancel) { setPenalties(r.data || []); setExpanded(null); }})
      .catch(() => { if (!cancel) setFetchError(true); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [state, refreshTick]);

  const offenseTypes = ['ALL', ...Array.from(new Set(penalties.map(p => p.offense_type)))];
  const filtered = offenseFilter === 'ALL' ? penalties
    : penalties.filter(p => p.offense_type === offenseFilter);

  return (
    <ScrollView style={{ flex:1, backgroundColor:bg }} keyboardShouldPersistTaps="handled"
      testID="drug-penalties-screen">
      {/* Hero */}
      <View style={{ backgroundColor:colors.navy, padding:16 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'800', fontSize:17 }}>💊 Drug Charge Penalties</Text>
        <Text maxFontSizeMultiplier={1.4} style={{ color:'rgba(255,255,255,0.85)', fontSize:12, marginTop:4 }}>
          State and federal drug penalties by offense type, charge level, and sentencing range.
          Includes 2023-2024 fentanyl enhancements and decriminalization laws.
        </Text>
      </View>

      <View style={{ padding:16, gap:10 }}>
        {/* State picker */}
        <View style={{ backgroundColor:card, borderRadius:10, borderWidth:1,
          borderColor:border, overflow:'hidden' }}>
          <Picker selectedValue={state} onValueChange={v => setState(v as string)}
            style={{ color:text, height:48 }} dropdownIconColor={sub}>
            {STATES.map(s => (
              <Picker.Item key={s} label={s === 'ALL' ? 'All States' : s === 'FED' ? 'Federal' : s} value={s} />
            ))}
          </Picker>
        </View>

        {/* Offense type chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap:8, paddingVertical:2 }}>
          {offenseTypes.map(ot => {
            const sel = offenseFilter === ot;
            const cc = OFFENSE_COLORS[ot] || { bg:card, border:colors.textFaint, text:text };
            return (
              <TouchableOpacity key={ot} onPress={() => setOffenseFilter(ot)}
                accessibilityRole="button"
                style={{ paddingHorizontal:12, paddingVertical:7, borderRadius:20,
                  backgroundColor: sel ? cc.border : card,
                  borderWidth:1.5, borderColor:cc.border }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sel ? colors.bgCard : cc.text, fontWeight:'600', fontSize:12 }}>
                  {ot === 'ALL' ? 'All Types' : ot.charAt(0).toUpperCase()+ot.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Count */}
        <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:12 }}>
          {filtered.length} charge{filtered.length!==1?'s':''} · {state === 'ALL' ? 'All states' : state === 'FED' ? 'Federal' : state}
        </Text>

        {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical:20 }} /> : null}

        {/* Important notice */}
        <View style={{ backgroundColor:isDark?colors.surface:colors.emergencyBg, borderRadius:10,
          padding:12, borderLeftWidth:3, borderLeftColor:colors.emergencyDark }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color:isDark?colors.emergency:colors.emergencyDark, fontWeight:'700', fontSize:11,
            marginBottom:4 }}>⚠️ IMPORTANT NOTICE</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color:isDark?colors.errorBg:colors.emergency, fontSize:11, lineHeight:17 }}>
            These are statutory maximums and minimums. Actual sentences depend on criminal
            history, aggravating factors, plea agreements, and judicial discretion. Many states
            have mandatory minimums that judges cannot reduce. Drug laws change frequently --
            verify with a licensed criminal defense attorney in your state.
          </Text>
        </View>

        {/* Penalty cards */}
        {filtered.map(p => {
          const open = expanded === p.id;
          const cc = OFFENSE_COLORS[p.offense_type] || OFFENSE_COLORS.emergencyDark;
          const isFelony = p.charge_level?.toLowerCase().includes('felony');
          return (
            <TouchableOpacity key={p.id}
              accessibilityRole="button"
              onPress={() => setExpanded(open ? null : p.id)}
              style={{ backgroundColor:card, borderRadius:12, padding:13,
                borderWidth:1.5, borderColor: open ? cc.border : border,
                shadowColor:colors.textPrimary, shadowOpacity:0.05, shadowRadius:3,
                shadowOffset:{width:0,height:1} }}>
              {/* Header */}
              <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <View style={{ backgroundColor:cc.bg, borderRadius:6,
                  paddingHorizontal:8, paddingVertical:3 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:cc.text, fontWeight:'700', fontSize:10 }}>
                    {(p.offense_type || "").toUpperCase()}
                  </Text>
                </View>
                <View style={{ backgroundColor:isFelony?colors.emergencyBg:colors.legalBg, borderRadius:6,
                  paddingHorizontal:8, paddingVertical:3 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:isFelony?colors.emergencyDark:colors.legalDark, fontWeight:'700', fontSize:10 }}>
                    {isFelony?'FELONY':'MISDEMEANOR'}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:11, marginLeft:'auto' }}>
                  {(p.drug_schedule || "").toUpperCase()}
                </Text>
              </View>

              {/* Charge level and amount */}
              <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontWeight:'700', fontSize:14, marginTop:8 }}>
                {p.charge_level}
              </Text>
              {p.amount_threshold && p.amount_threshold !== 'any' ? (
                <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:12, marginTop:2 }}>
                  Amount: {p.amount_threshold}
                </Text>
              ) : null}

              {/* Quick stats */}
              <View style={{ flexDirection:'row', gap:12, marginTop:8 }}>
                <View style={{ flex:1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:10 }}>PRISON TIME</Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: p.min_days || p.max_days ? cc.text : sub,
                    fontWeight:'700', fontSize:13 }}>
                    {fmtTime(p.min_days, p.max_days)}
                  </Text>
                </View>
                <View style={{ flex:1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:10 }}>FINE RANGE</Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontWeight:'700', fontSize:13 }}>
                    {fmtFine(p.min_fine, p.max_fine)}
                  </Text>
                </View>
              </View>

              {/* Expanded notes */}
              {open && p.notes ? (
                <View style={{ marginTop:10, backgroundColor:isDark?colors.surface:colors.bgSubtle,
                  borderRadius:8, padding:10 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:isDark?colors.border:'#333', fontSize:12, lineHeight:18 }}>
                    {p.notes}
                  </Text>
                </View>
              ) : null}
              <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:11, marginTop:6, textAlign:'right' }}>
                {open ? '▲ less' : '▼ statute notes'}
              </Text>
            </TouchableOpacity>
          );
        })}

        {!loading && filtered.length === 0 && (
          <Text maxFontSizeMultiplier={1.4} style={{ color:sub, textAlign:'center', marginTop:30 }}>
            No drug penalties found for {state}.
          </Text>
        )}
        {/* Attorney CTA */}
        <View style={{
          backgroundColor: colors.emergencyDark, borderRadius:12,
          padding:14, alignItems:'center', marginTop:8,
        }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'700', fontSize:14 }}>
              ⚖️ Find a Criminal Defense Attorney
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ color:'rgba(255,255,255,0.75)', fontSize:11,
              textAlign:'center', marginTop:4 }}>
              These are statutory ranges. An attorney can often negotiate better outcomes.
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ height:30 }} />
      </View>

      <TouchableOpacity
        onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
        style={{ backgroundColor: colors.emergencyDark, paddingVertical: 16,
          paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
          ⚖️ Find a Defense Attorney
        </Text>
      </TouchableOpacity>

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
  );
}

const styles = StyleSheet.create({});
