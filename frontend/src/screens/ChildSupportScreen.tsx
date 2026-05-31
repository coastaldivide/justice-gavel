import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, Switch,
} from 'react-native';
import { COLORS } from '../constants/theme';

// Income shares model — the majority US approach
// Guideline figures approximate mean combined obligation tables (simplified)
function calculateSupport(
  parent1Income: number,
  parent2Income: number,
  numChildren: number,
  custodySplit: number,     // 0–100: parent1 custody percentage
  state: string,
  monthsAlimony: number,
  alimonyAmount: number,
) {
  const combined = parent1Income + parent2Income;
  if (combined <= 0 || numChildren <= 0) return null;

  // Basic child support obligation table ($/month, simplified national average)
  const OBLIGATION_TABLE: Record<number, number[]> = {
    //          1 child   2 ch    3 ch    4 ch    5 ch
    1000:  [134, 214, 271, 314, 351],
    2000:  [254, 407, 514, 596, 666],
    3000:  [357, 571, 721, 836, 934],
    4000:  [453, 725, 916, 1062, 1187],
    5000:  [541, 866, 1094, 1268, 1419],
    6000:  [624, 999, 1262, 1464, 1636],
    7000:  [702, 1124, 1420, 1646, 1840],
    8000:  [776, 1242, 1570, 1820, 2034],
    9000:  [847, 1356, 1713, 1987, 2220],
    10000: [913, 1462, 1847, 2142, 2394],
  };

  // Find nearest income bracket
  const bracket = Math.min(10000, Math.max(1000, Math.round(combined / 1000) * 1000));
  const obligations = OBLIGATION_TABLE[bracket] || OBLIGATION_TABLE[5000];
  const childIdx = Math.min(numChildren, 5) - 1;
  let baseObligation = obligations[childIdx];

  // Prorate by income share
  const parent1Share = parent1Income / combined;
  const parent2Share = parent2Income / combined;

  let parent1Obligation = baseObligation * parent1Share;
  let parent2Obligation = baseObligation * parent2Share;

  // Shared custody adjustment (when custody approaches 50/50, obligation decreases)
  const p1Custody = custodySplit / 100;
  const p2Custody = 1 - p1Custody;
  if (p1Custody >= 0.35 && p1Custody <= 0.65) {
    // Offset model for near-shared custody
    const reduction = 1 - Math.abs(0.5 - p1Custody) * 2;
    parent1Obligation *= (1 - reduction * 0.3);
    parent2Obligation *= (1 - reduction * 0.3);
  }

  // Who pays whom: the non-custodial parent (less custody) pays
  const p1IsPayor = p1Custody < 0.5;
  const netPayment = Math.abs(parent1Obligation - parent2Obligation);

  return {
    combined:          Math.round(combined),
    baseObligation:    Math.round(baseObligation),
    parent1Obligation: Math.round(parent1Obligation),
    parent2Obligation: Math.round(parent2Obligation),
    payor:             p1IsPayor ? 'Parent 1' : 'Parent 2',
    payee:             p1IsPayor ? 'Parent 2' : 'Parent 1',
    netMonthly:        Math.round(netPayment),
    netAnnual:         Math.round(netPayment * 12),
    model:             'Income Shares (simplified)',
    disclaimer:        true,
  };
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US');
}

export default function ChildSupportScreen({ navigation }: any) {
  const colors = COLORS;
  const [p1Income, setP1Income] = useState('');
  const [p2Income, setP2Income] = useState('');
  const [children, setChildren] = useState('1');
  const [custody, setCustody] = useState('70');  // parent1 custody %
  const [alimony, setAlimony] = useState(false);
  const [alimonyAmt, setAlimonyAmt] = useState('');
  const [result, setResult] = useState<any>(null);

  const calculate = useCallback(() => {
    const p1 = parseFloat(p1Income.replace(/[^0-9.]/g, '')) || 0;
    const p2 = parseFloat(p2Income.replace(/[^0-9.]/g, '')) || 0;
    const n  = parseInt(children) || 1;
    const c  = parseFloat(custody) || 70;
    const aa = parseFloat(alimonyAmt) || 0;
    setResult(calculateSupport(p1, p2, n, c, '', 0, aa));
  }, [p1Income, p2Income, children, custody, alimonyAmt]);

  const inputStyle = [s.input, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }];
  const labelStyle = [s.label, { color: COLORS.textSecond }];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={s.container}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: COLORS.navy }]}>
        <Text style={s.headerTitle}>Child & Spousal Support</Text>
        <Text style={s.headerSub}>
          Estimate based on Income Shares Model (majority US standard).{'\n'}
          Actual orders vary by state — consult your attorney.
        </Text>
      </View>

      <View style={s.form}>
        {/* Incomes */}
        <Text style={[s.sectionLabel, { color: COLORS.textMuted }]}>MONTHLY GROSS INCOME</Text>
        <View style={s.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={labelStyle}>Parent 1</Text>
            <TextInput
              style={inputStyle}
              placeholder="e.g. 4500"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              value={p1Income}
              onChangeText={setP1Income}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={labelStyle}>Parent 2</Text>
            <TextInput
              style={inputStyle}
              placeholder="e.g. 3000"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              value={p2Income}
              onChangeText={setP2Income}
            />
          </View>
        </View>

        {/* Children */}
        <Text style={labelStyle}>Number of children</Text>
        <View style={s.row}>
          {['1','2','3','4','5'].map(n => (
            <TouchableOpacity
              key={n}
              accessibilityRole="button"
              style={[s.childBtn, { borderColor: COLORS.border, backgroundColor: children === n ? COLORS.navy : COLORS.bgCard }]}
              accessibilityLabel="{n}" onPress={() => setChildren(n)}
            >
              <Text style={{ color: children === n ? '#fff' : COLORS.textPrimary, fontWeight: '700' }}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custody split */}
        <Text style={labelStyle}>Parent 1 physical custody (%)</Text>
        <TextInput
          style={inputStyle}
          placeholder="e.g. 70 (parent 1 has 70%)"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={custody}
          onChangeText={setCustody}
        />
        <Text style={[s.hint, { color: COLORS.textMuted }]}>50 = equal shared custody</Text>

        {/* Spousal support toggle */}
        <View style={[s.switchRow, { borderColor: COLORS.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.switchLabel, { color: COLORS.textPrimary }]}>Include spousal support?</Text>
            <Text style={[s.hint, { color: COLORS.textMuted }]}>Alimony paid by higher earner</Text>
          </View>
          <Switch
            value={alimony}
            onValueChange={setAlimony}
            trackColor={{ true: COLORS.navy }}
          />
        </View>
        {alimony && (
          <>
            <Text style={labelStyle}>Monthly spousal support amount ($)</Text>
            <TextInput
              style={inputStyle}
              placeholder="e.g. 800"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              value={alimonyAmt}
              onChangeText={setAlimonyAmt}
            />
          </>
        )}

        {/* Calculate */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[s.calcBtn, { backgroundColor: COLORS.navy }]}
          onPress={calculate}
         accessibilityLabel="Calculate Estimate">
          <Text style={s.calcBtnText}>Calculate Estimate</Text>
        </TouchableOpacity>
      </View>

      {/* Result */}
      {result && (
        <View style={[s.result, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
          <Text style={[s.resultTitle, { color: COLORS.textPrimary }]}>Estimated Support Order</Text>

          <View style={[s.resultRow, { borderBottomColor: COLORS.border }]}>
            <Text style={[s.resultLabel, { color: COLORS.textSecond }]}>Combined monthly income</Text>
            <Text style={[s.resultValue, { color: COLORS.textPrimary }]}>{fmt(result.combined)}</Text>
          </View>
          <View style={[s.resultRow, { borderBottomColor: COLORS.border }]}>
            <Text style={[s.resultLabel, { color: COLORS.textSecond }]}>Base obligation ({children} child{parseInt(children) > 1 ? 'ren' : ''})</Text>
            <Text style={[s.resultValue, { color: COLORS.textPrimary }]}>{fmt(result.baseObligation)}/mo</Text>
          </View>
          <View style={[s.resultRow, { borderBottomColor: COLORS.border }]}>
            <Text style={[s.resultLabel, { color: COLORS.textSecond }]}>Parent 1 share ({Math.round(parseFloat(custody || '70'))}% custody)</Text>
            <Text style={[s.resultValue, { color: COLORS.textPrimary }]}>{fmt(result.parent1Obligation)}/mo</Text>
          </View>
          <View style={[s.resultRow, { borderBottomColor: COLORS.border }]}>
            <Text style={[s.resultLabel, { color: COLORS.textSecond }]}>Parent 2 share ({100 - Math.round(parseFloat(custody || '70'))}% custody)</Text>
            <Text style={[s.resultValue, { color: COLORS.textPrimary }]}>{fmt(result.parent2Obligation)}/mo</Text>
          </View>

          {/* Net payment */}
          <View style={[s.netBlock, { backgroundColor: COLORS.navy + '15' }]}>
            <Text style={[s.netLabel, { color: COLORS.navy }]}>{result.payor} pays {result.payee}</Text>
            <Text style={[s.netAmount, { color: COLORS.navy }]}>{fmt(result.netMonthly)}<Text style={{ fontSize: 14 }}>/month</Text></Text>
            <Text style={[s.netAnnual, { color: COLORS.navy }]}>{fmt(result.netAnnual)} per year</Text>
          </View>

          {alimony && parseFloat(alimonyAmt) > 0 && (
            <View style={[s.alimonyBlock, { borderColor: COLORS.border }]}>
              <Text style={[s.alimonyLabel, { color: COLORS.textSecond }]}>
                + Spousal support: {fmt(parseFloat(alimonyAmt))}/mo ({fmt(parseFloat(alimonyAmt) * 12)}/yr)
              </Text>
            </View>
          )}

          <Text style={[s.disclaimer, { color: COLORS.textMuted }]}>
            ⚠️ This is an estimate using a simplified income shares table. Actual orders are
            set by the court based on your state's guidelines, which may differ significantly.
            This does not constitute legal advice. Always consult a licensed family law attorney.
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:    { paddingBottom: 24 },
  header:       { padding: 28, paddingTop: 52 },
  headerTitle:  { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  headerSub:    { fontSize: 13, color: 'rgba(255,255,255,0.82)', lineHeight: 19 },
  form:         { padding: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 8 },
  label:        { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:        { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  hint:         { fontSize: 12, marginTop: 4 },
  row:          { flexDirection: 'row' },
  childBtn:     { flex: 1, marginHorizontal: 3, paddingVertical: 10, borderWidth: 1, borderRadius: 8, alignItems: 'center' },
  switchRow:    { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 12, borderBottomWidth: 1 },
  switchLabel:  { fontSize: 15, fontWeight: '600' },
  calcBtn:      { marginTop: 24, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  calcBtnText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  result:       { margin: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  resultTitle:  { fontSize: 16, fontWeight: '700', padding: 16, paddingBottom: 12 },
  resultRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  resultLabel:  { fontSize: 13, flex: 1, marginRight: 8 },
  resultValue:  { fontSize: 13, fontWeight: '700' },
  netBlock:     { padding: 20, alignItems: 'center' },
  netLabel:     { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  netAmount:    { fontSize: 32, fontWeight: '900', marginBottom: 2 },
  netAnnual:    { fontSize: 14, fontWeight: '600' },
  alimonyBlock: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  alimonyLabel: { fontSize: 13 },
  disclaimer:   { fontSize: 11, lineHeight: 16, padding: 16, paddingTop: 12 },
});
