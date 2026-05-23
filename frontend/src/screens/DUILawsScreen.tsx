import LegalNotice from '../components/LegalNotice';
import type { ScreenProps } from '../types/navigation';
import { useNavigation } from '@react-navigation/native';
import React, { useState, useEffect, useCallback } from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, StyleSheet} from 'react-native';
import { api, cachedGet } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

type DUILaw = {
  id: number; state: string;
  bac_limit: number; bac_limit_cdl: number; bac_limit_under21: number;
  first_jail_min: number; first_jail_max: number;
  first_fine_min: number; first_fine_max: number; first_license_days: number;
  second_jail_min: number; second_fine_min: number; second_license_days: number;
  felony_threshold: number; implied_consent: number;
  alr_days: number; dmv_hearing_deadline: number;
  ignition_interlock: string; notes: string;
};

const STATE_NAMES: Record<string,string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DC:'Washington D.C.',DE:'Delaware',FL:'Florida',
  GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
  WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

function fmtDays(d: number) {
  if (!d || d === 0) return 'None';
  if (d >= 365) return `${Math.round(d/365)} year${d>=730?'s':''}`;
  return `${d} day${d!==1?'s':''}`;
}
function fmtMoney(n: number) { return n ? '$'+n.toLocaleString() : 'None'; }
function fmtBAC(n: number) { return n ? `${n.toFixed(2)}%` : '0.00%'; }

export default function DUILawsScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const [laws, setLaws]     = useState<DUILaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DUILaw | null>(null);
  const [tab, setTab]       = useState<'first'|'second'|'rules'>('first');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;
  const border = colors.border;

  useEffect(() => {
    cachedGet('/legaldata/dui?limit=60')
      .then(r => { setLaws(r.data || []); if (r.data?.length) setSelected(r.data[0]); })
      .catch(() => { setLaws([]); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = laws.filter(l =>
    !search || l.state.includes(search.toUpperCase()) ||
    (STATE_NAMES[l.state]||'').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:bg }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:bg }}>
      {/* Hero */}
      <View style={{ backgroundColor:colors.emergencyDark, padding:16 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'800', fontSize:17 }}>🚗 DUI / DWI Laws by State</Text>
        <Text maxFontSizeMultiplier={1.4} style={{ color:'rgba(255,255,255,0.85)', fontSize:12, marginTop:4 }}>
          BAC limits, penalties, license suspension, and DMV deadlines for all 51 jurisdictions.
        </Text>
      </View>

      <View style={{ flexDirection:'row', flex:1 }}>
        {/* Left: state list */}
        <View style={{ width:90, borderRightWidth:1, borderRightColor:border }}>
          <TextInput
            value={search} onChangeText={setSearch}
            accessibilityLabel="Filter DUI laws" placeholder="Filter" placeholderTextColor={sub}
            style={{ margin:6, padding:6, backgroundColor:card, borderRadius:8,
              color:text, fontSize:12, borderWidth:1, borderColor:border }}
            autoCapitalize="characters" maxLength={2}
          />
          <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView>
            {filtered.map(l => {
              const sel = selected?.state === l.state;
              return (
                <TouchableOpacity key={l.state}
                  accessibilityRole="button"
                  onPress={() => { setSelected(l); setTab('first'); }}
                  style={{
                    paddingVertical:10, paddingHorizontal:8,
                    backgroundColor: sel ? colors.emergencyDark : 'transparent',
                    borderBottomWidth:1, borderBottomColor:border,
                  }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sel ? colors.bgCard : text, fontWeight:'700', fontSize:14,
                    textAlign:'center' }}>{l.state}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: sel ? 'rgba(255,255,255,0.8)' : sub,
                    fontSize:9, textAlign:'center' }} numberOfLines={1}>
                    {(STATE_NAMES[l.state]||'').split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          </KeyboardAvoidingView>
        </View>

        {/* Right: detail */}
        {selected ? (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex:1 }} contentContainerStyle={{ padding:14, paddingBottom:30 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontWeight:'800', fontSize:18, marginBottom:2 }}>
              {STATE_NAMES[selected.state] || selected.state}
            </Text>

            {/* BAC limits row */}
            <View style={{ flexDirection:'row', gap:8, marginBottom:12 }}>
              {[
                { label:'Standard', val:fmtBAC(selected.bac_limit), color:colors.emergencyDark },
                { label:'CDL', val:fmtBAC(selected.bac_limit_cdl), color:colors.warnDark },
                { label:'Under 21', val:fmtBAC(selected.bac_limit_under21), color:colors.navy },
              ].map(({label,val,color}) => (
                <View key={label} style={{ flex:1, backgroundColor:card, borderRadius:10,
                  padding:10, borderTopWidth:3, borderTopColor:color }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:10, fontWeight:'600' }}>{label}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:color, fontWeight:'800', fontSize:18 }}>{val}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:9 }}>BAC limit</Text>
                </View>
              ))}
            </View>

            {/* Tabs */}
            <View style={{ flexDirection:'row', gap:6, marginBottom:12 }}>
              {(['first','second','rules'] as const).map(t => (
                <TouchableOpacity key={t} onPress={() => setTab(t)}
                  accessibilityRole="button"
                  style={{ flex:1, paddingVertical:8, borderRadius:8, alignItems:'center',
                    backgroundColor: tab===t ? colors.emergencyDark : card,
                    borderWidth:1, borderColor: tab===t ? colors.emergencyDark : border }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: tab===t ? colors.bgCard : text, fontWeight:'600', fontSize:11 }}>
                    {t==='first'?'1st Offense':t==='second'?'2nd Offense':'Rules'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab content */}
            {tab === 'first' && (
              <View style={{ gap:8 }}>
                <Row label="Jail time" value={`${fmtDays(selected.first_jail_min)} - ${fmtDays(selected.first_jail_max)}`} text={text} sub={sub} card={card} />
                <Row label="Fine" value={`${fmtMoney(selected.first_fine_min)} - ${fmtMoney(selected.first_fine_max)}`} text={text} sub={sub} card={card} />
                <Row label="License suspension" value={fmtDays(selected.first_license_days)} text={text} sub={sub} card={card} />
                <Row label="Ignition interlock" value={selected.ignition_interlock || 'Varies'} text={text} sub={sub} card={card} />
                <Row label="Felony at BAC" value={selected.felony_threshold ? fmtBAC(selected.felony_threshold) : 'No threshold'} text={text} sub={sub} card={card} />
              </View>
            )}

            {tab === 'second' && (
              <View style={{ gap:8 }}>
                <Row label="Jail time (min)" value={fmtDays(selected.second_jail_min)} text={text} sub={sub} card={card} />
                <Row label="Fine (min)" value={fmtMoney(selected.second_fine_min)} text={text} sub={sub} card={card} />
                <Row label="License suspension" value={fmtDays(selected.second_license_days)} text={text} sub={sub} card={card} />
                <InfoBox text={`Second offense penalties are significantly higher. Third offense is typically a felony in most states regardless of BAC.`} isDark={isDark} color={colors.emergencyDark} />
              </View>
            )}

            {tab === 'rules' && (
              <View style={{ gap:8 }}>
                <Row label="Implied consent" value={selected.implied_consent ? 'Yes -- refusal triggers auto suspension' : 'No implied consent law'} text={text} sub={sub} card={card} />
                <Row label="ALR suspension period" value={fmtDays(selected.alr_days)} text={text} sub={sub} card={card} />
                <Row label="DMV hearing deadline" value={selected.dmv_hearing_deadline ? `${selected.dmv_hearing_deadline} days from arrest` : 'See state DMV'} text={text} sub={sub} card={card} />
                {selected.notes ? (
                  <InfoBox text={selected.notes} isDark={isDark} color={colors.blue} />
                ) : null}
                <InfoBox
                  text={`Critical: After a DUI arrest where your license is taken, you typically have ${selected.dmv_hearing_deadline || 10} days to request a DMV hearing. Missing this deadline = automatic license suspension regardless of criminal case outcome.`}
                  isDark={isDark} color={colors.warnDark}
                />
              </View>
            )}


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
            {/* Attorney CTA */}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Select a state"
              style={{ backgroundColor:colors.emergencyDark, borderRadius:12, padding:14,
                alignItems:'center', marginTop:16 }}
              onPress={() => navigation.navigate('LawyersTab')}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ color:colors.bgCard, fontWeight:'700', fontSize:14 }}>
                Find a DUI Attorney in {STATE_NAMES[selected.state] || selected.state}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color:sub }}>Select a state</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Row({label,value,text,sub,card}:{label:string;value:string;text:string;sub:string;card:string}) {
  return (
    <View style={{ backgroundColor:card, borderRadius:10, padding:12,
      flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color:sub, fontSize:12, flex:1 }}>{label}</Text>
      <Text maxFontSizeMultiplier={1.4} style={{ color:text, fontWeight:'700', fontSize:13, textAlign:'right',
        flex:1 }}>{value}</Text>
    </View>
  );
}
function InfoBox({text:t,isDark,color}:{text:string;isDark:boolean;color:string}) {
  return (
    <View style={{ backgroundColor:isDark?COLORS.surface:COLORS.bgCard, borderRadius:10,
      padding:12, borderLeftWidth:3, borderLeftColor:color }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color:isDark?COLORS.bgCard:'#333', fontSize:12, lineHeight:18 }}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({});
