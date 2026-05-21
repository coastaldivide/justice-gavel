import ScreenHeader from '../components/ScreenHeader';
import EmergencyStrip from '../components/EmergencyStrip';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect } from 'react';
import {View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { api, cachedGet } from '../services/api';
import { useTheme } from '../constants/theme';

declare var bondAmount: any;
const STATES = [
  'ALL','AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI',
  'ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
  'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

type Schedule = {
  id: number; state: string; charge: string; charge_type: string;
  severity: string; bail_min: number; bail_max: number | null; bail_note?: string;
};

export default function BailCalculatorScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const [state, setState] = useState('TN');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [bondPct] = useState(10);
  const [filter, setFilter] = useState('');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    cachedGet(`/legaldata/bail?state=${state}&limit=200`)
      .then(r => { if (!cancel) setSchedules(r.data || []); })
      .catch(() => {})
      .catch(() => {
        if (!cancel) {
          setSchedules([]);
        }
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [state]);

  const filtered = schedules.filter(s =>
    !filter || s.charge.toLowerCase().includes(filter.toLowerCase())
  );

  const bondCost = (bail: number) => Math.round(bail * bondPct / 100);
  const fmt = (n: number) => '$' + n.toLocaleString();

  return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1, backgroundColor: bg }} keyboardShouldPersistTaps="handled">
      <View style={{ padding: 16 }}>
        {/* Header card */}
        <View style={{
          backgroundColor: colors.primary, borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.bgCard, fontWeight: '800', fontSize: 18 }}>
            💰 Bail Amount Estimator
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 }}>
            Select a state and charge type to see typical bail ranges and bondsman costs.
            These are estimates -- actual bail is set by a judge.
          </Text>
        </View>

        {/* State selector */}
        <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontWeight: '600', fontSize: 12, marginBottom: 6, letterSpacing: 0.8 }}>
          STATE
        </Text>
        <View style={{
          backgroundColor: card, borderRadius: 10, borderWidth: 1,
          borderColor: colors.border, marginBottom: 12, overflow: 'hidden',
        }}>
          <Picker
            selectedValue={state}
            onValueChange={v => { setState(v as string); setSelected(null); }}
            style={{ color: text, height: 48 }}
            dropdownIconColor={sub}
          >
            {STATES.map(s => <Picker.Item key={s} label={s === 'ALL' ? 'National Baseline' : s} value={s} />)}
          </Picker>
        </View>

        {/* Charge search */}
        <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontWeight: '600', fontSize: 12, marginBottom: 6, letterSpacing: 0.8 }}>
          SEARCH CHARGE TYPE
        </Text>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="e.g. DUI, assault, theft…"
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius: 10, paddingHorizontal: 14,
            paddingVertical: 10, color: text, fontSize: 14, marginBottom: 12,
            borderWidth: 1, borderColor: colors.border,
          }}
        />

        {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />}
        {/* Charge list */}
        {filtered.map(s => {
          const isSel = selected?.id === s.id;
          const typeColor = s.charge_type === 'felony'
            ? { bg: colors.emergencyBg, border: colors.emergencyDark, text: colors.emergencyDark }
            : { bg: colors.legalBg, border: colors.legalDark, text: colors.legalDark };

          return (
            <TouchableOpacity
              accessibilityRole="button"
              key={s.id}
              onPress={() => setSelected(isSel ? null : s)}
              style={{
                backgroundColor: isSel ? (isDark ? colors.bgSubtle : colors.infoBg) : card,
                borderRadius: 12, padding: 13, marginBottom: 8,
                borderWidth: 1.5,
                borderColor: isSel ? colors.primary : (colors.border),
              }}
              accessibilityLabel={s.charge}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  backgroundColor: typeColor.bg, borderRadius: 6,
                  paddingHorizontal: 7, paddingVertical: 3,
                }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: typeColor.text, fontWeight: '700', fontSize: 10 }}>
                    {s.charge_type.toUpperCase()}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '600', fontSize: 13, flex: 1 }}>
                  {s.charge}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12 }}>{s.severity}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                  {s.bail_min === 0 && !s.bail_max ? 'No bail / ROR'
                    : s.bail_max === null ? `${fmt(s.bail_min)}+`
                    : `${fmt(s.bail_min)} - ${fmt(s.bail_max)}`}
                </Text>
              </View>

              {/* Expanded breakdown */}
              {isSel && (
                <View style={{
                  marginTop: 12, borderTopWidth: 1,
                  borderTopColor: colors.border, paddingTop: 12, gap: 8,
                }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '700', fontSize: 14 }}>
                    💡 Bail Breakdown
                  </Text>

                  {s.bail_min > 0 && (
                    <>
                      <Row label="Typical bail range" value={
                        s.bail_max ? `${fmt(s.bail_min)} - ${fmt(s.bail_max)}` : `${fmt(s.bail_min)}+`
                      } text={text} sub={sub} />
                      <Row label="Cash bail (pay full)" value={`${fmt(s.bail_min)} - ${s.bail_max ? fmt(s.bail_max) : '???'}`} text={text} sub={sub} />
                      <Row label={`Bondsman cost (${bondPct}% non-refundable)`}
                        value={s.bail_max
                          ? `${fmt(bondCost(s.bail_min))} - ${fmt(bondCost(s.bail_max))}`
                          : `${fmt(bondCost(s.bail_min))}+`}
                        text={text} sub={sub} highlight={colors.primary} />
                    </>
                  )}

                  {s.bail_note ? (
                    <View style={{
                      backgroundColor: isDark ? colors.surface : colors.bgCard,
                      borderRadius: 8, padding: 10,
                    }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.gold : colors.warnDark, fontSize: 12 }}>
                        ℹ️  {s.bail_note}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{
                    backgroundColor: isDark ? colors.legal : colors.legalBg,
                    borderRadius: 8, padding: 10, marginTop: 4,
                  }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12, fontWeight: '600' }}>
                      How bail bondsmen work
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12, marginTop: 4 }}>
                      You pay the bondsman 10% of the bail amount. This fee is non-refundable
                      regardless of the case outcome. The bondsman then posts the full bail with
                      the court. If you miss a court date, the bondsman must pay the full amount
                      and will pursue you to recover it.
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {!loading && filtered.length === 0 && (
          <Text maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginTop: 30 }}>
            No charges found for "{filter}" in {state}.
          </Text>
        )}

        {/* Innocent until proven guilty context */}
        {!!bondAmount && (
          <View style={{ backgroundColor: colors.bgCard, borderRadius: 12,
            padding: 14, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: colors.gold }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '700',
              color: colors.textPrimary, marginBottom: 4 }}>
              ⚖️ You have not been convicted of anything.
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textSecond, lineHeight: 18 }}>
              Bail is not a fine or punishment. It is a deposit to guarantee your appearance
              in court. You are innocent until the state proves otherwise.
            </Text>
          </View>
        )}
        {/* Bondsman CTA */}
        <View style={{
          backgroundColor: colors.bail, borderRadius:12,
          padding:14, alignItems:'center', marginTop:8,
        }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('BailTab')}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'700', fontSize:14 }}>
              🔓 Find a Bail Bondsman Near You
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ color:'rgba(255,255,255,0.8)', fontSize:11,
              textAlign:'center', marginTop:4 }}>
              Bondsmen charge 10% (non-refundable). Find licensed agents in your city.
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </View>

        {/* Real attorney CTA -- now powered by live data */}
        <View style={{ marginHorizontal: 16, marginBottom: 20 }}>
          <TouchableOpacity
            style={{ backgroundColor: colors.navy, borderRadius: 14,
              paddingVertical: 16, alignItems: 'center' }}
            onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.2}
              style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
              ⚖️ Find Attorneys Near You
            </Text>
            <Text maxFontSizeMultiplier={1.3}
              style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 3 }}>
              1,459 verified attorneys across 40 states
            </Text>
          </TouchableOpacity>
        </View>

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
  );
}

function Row({ label, value, text, sub, highlight }:
  { label:string; value:string; text:string; sub:string; highlight?:string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <EmergencyStrip compact={true} />
      <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, flex: 1 }}>{label}</Text>
      <Text maxFontSizeMultiplier={1.4} style={{ color: highlight || text, fontWeight: '600', fontSize: 13 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({});
