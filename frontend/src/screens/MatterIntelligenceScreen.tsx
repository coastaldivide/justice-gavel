import UPLDisclaimer from '../components/UPLDisclaimer';
/**
 * MatterIntelligenceScreen — All 40 simulation signals surfaced as live matter intelligence
 *
 * Accessed from any matter card via the 🧠 intelligence button.
 * Four tabs:
 *   1. Outcome    — prediction indicators, settlement probability, reversal score
 *   2. Motions    — recommended motions based on charge × evidence × vulnerability
 *   3. Diversion  — diversion tracks with eligibility scores
 *   4. Escalation — emergency level, SLA timer, escalation triggers
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, RefreshControl,
} from 'react-native';
import {  useTheme, RADIUS, FONT, TYPE, COLORS } from '../constants/theme';
import { api } from '../services/api';
import type {} from '../types/navigation';

type Tab = 'outcome' | 'motions' | 'diversion' | 'escalation' | 'analytics';

// Module-level constants — not recreated on render
const NEGATIVE_INDICATOR_TYPES = new Set([
  'asylum_barred', 'asylum_bar_risk', 'discharge_risk', 'sol_3yr', 'policy_exhausted',
]);
// Always-on advisory signals shown in the Motions tab — not in Active Signals panel
// Signals excluded from the 'Active signals' panel — shown elsewhere or always advisory
// batsonApplicable: always true for criminal/PD — shown in Motions tab
// likeleDisch: raw military discharge prediction — shown as label in escalation/outcome
const ADVISORY_ALWAYS_ON = new Set(['batsonApplicable', 'likeleDisch']);

const ESCALATION_COLORS: Record<string, string> = {
  critical: COLORS.emergency, high: COLORS.warn, elevated: COLORS.blue, normal: COLORS.legal,
};

const PRIORITY_COLORS: Record<string, string> = {
  high: COLORS.emergency, normal: COLORS.blue, low: COLORS.textMuted,
};

export default function MatterIntelligenceScreen({ route, navigation }: any) {
  const { matterId, matterTitle } = route.params || {};
  const { colors } = useTheme();
  const s = styles(colors);

  const isMounted = React.useRef(true);
  const [tab, setTab]             = useState<Tab>('outcome');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [partialLoad, setPartialLoad] = useState(false);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [outcome, setOutcome]     = useState<any>(null);
  const [signals, setSignals]     = useState<any>(null);
  const [motions, setMotions]     = useState<any[]>([]);
  const [diversion, setDiversion] = useState<any[]>([]);
  const [escalation, setEscalation] = useState<any>(null);
  const [analytics, setAnalytics]   = useState<any>(null);

  const load = useCallback(async () => {
    if (!matterId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setPartialLoad(false);
    try {
      // Promise.allSettled — a single endpoint failure (e.g. escalation 403 for
      // an associate) does not wipe out successfully-loaded tabs.
      const [outRes, sigRes, motRes, divRes, escRes, anlRes] = await Promise.allSettled([
        api.get(`/matter-intelligence/${matterId}/outcome`),
        api.get(`/matter-intelligence/${matterId}/signals`),
        api.get(`/matter-intelligence/${matterId}/motions`),
        api.get(`/matter-intelligence/${matterId}/diversion`),
        api.get(`/matter-intelligence/${matterId}/escalation`),
        api.get(`/matter-intelligence/${matterId}/analytics`),
      ]);
      if (!isMounted.current) return;
      setErrorMsg(null);  // clear any prior error on successful load
      if (outRes.status === 'fulfilled') setOutcome(outRes.value.data);
      if (sigRes.status === 'fulfilled') setSignals(sigRes.value.data);
      if (motRes.status === 'fulfilled') setMotions(motRes.value.data.motions || []);
      if (divRes.status === 'fulfilled') setDiversion(divRes.value.data.diversion_tracks || []);
      if (escRes.status === 'fulfilled') setEscalation(escRes.value.data);
      if (anlRes.status === 'fulfilled') setAnalytics((anlRes as any)?.value?.data);
      // Show feedback if any endpoint failed
      const failures = [outRes,sigRes,motRes,divRes,escRes,anlRes].filter(r => r.status === 'rejected');
      if (failures.length > 0 && failures.length < 6) {
        // Partial load — update header to indicate incomplete data
        __DEV__ && console.warn('[MatterIntelligence] partial load:', failures.length, 'endpoint(s) failed');
        // Non-blocking: let the user see what loaded, surface incomplete state in header
        setPartialLoad(true);
      } else if (failures.length === 6) {
        Alert.alert('Load Failed', 'Could not load matter intelligence.');
      }
    } catch (e: any) {
      if (isMounted.current) setErrorMsg('Could not load data. Pull to retry.');
    } finally { if (isMounted.current) setLoading(false); }
  }, [matterId]);

  useEffect(() => {
    isMounted.current = true;
    load();
    return () => { isMounted.current = false; };
  }, [load]);

  const confPct = (v: number | undefined | null) => v == null ? 'n/a' : `${Math.round(v * 100)}%`;

  // confColor: high confidence on NEGATIVE signals is urgent, not green
  const confColor = (v: number, type?: string) => {
    if (type && NEGATIVE_INDICATOR_TYPES.has(type)) {
      // For urgent negative signals: high confidence = emergency (red), not green
      return v >= 0.7 ? colors.emergency : v >= 0.45 ? colors.warn : colors.steel;
    }
    // For positive/opportunity signals: high confidence = good (green)
    return v >= 0.7 ? colors.legal : v >= 0.45 ? colors.warn : colors.steel;
  };

  // Guard: screen must receive a valid matterId
  if (!matterId) return (
    <View style={s.center}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: TYPE.base }}>No matter selected.</Text>
    </View>
  );

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={colors.gold} size="large" /></View>
  );

  return (
    <View style={s.root}
      testID="matter-intelligence-screen">
      {/* Header */}
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.4} style={s.headerTitle} numberOfLines={1}>{matterTitle || 'Matter Intelligence'}</Text>
        {partialLoad && (
          <TouchableOpacity
  accessibilityRole="button"
            onPress={() => { setErrorMsg(null); load(); }}
            style={[s.metaPill, { backgroundColor: colors.errorBg }]}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: TYPE.xs }}>
              ⚠️ Partial data — tap to retry
            </Text>
          </TouchableOpacity>
        )}
        {signals && (
          <View style={s.headerMeta}>
            <Text maxFontSizeMultiplier={1.4} style={s.metaPill}>{signals.vertical?.replace(/_/g, ' ')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.metaPill}>{signals.taxonomy?.replace(/_/g, ' ')}</Text>
            <View style={[s.escalBadge, { backgroundColor: (ESCALATION_COLORS[escalation?.level] || colors.steel) + '22' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.escalBadgeText, { color: ESCALATION_COLORS[escalation?.level] || colors.steel }]}>
                {escalation?.level || 'normal'}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['outcome','motions','diversion','escalation','analytics'] as Tab[]).map(t => (
          <TouchableOpacity
            accessibilityRole="tab"
            key={t}
            style={[s.tabBtn, tab===t && s.tabActive]}
            onPress={() => setTab(t as Tab)}
            accessibilityState={{ selected: tab === t }}
            accessibilityLabel={`${t.charAt(0).toUpperCase() + t.slice(1)} tab`}>
            <Text maxFontSizeMultiplier={1.4} style={[s.tabLabel, tab===t && s.tabLabelActive]}>
              {t === 'outcome' ? '📊' : t === 'motions' ? '⚖️' : t === 'diversion' ? '🔄' : t === 'analytics' ? '🧠' : t === 'escalation' ? '🚨' : '📋'}
              {' '}{t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() =>
      { setRefreshing(true); setErrorMsg(null); load().finally(() => setRefreshing(false)); }}
            tintColor={colors.gold}
          />
        }
      >

        {/* ── OUTCOME TAB ──────────────────────────────────────────────────── */}
        {tab === 'outcome' && (
          <>
            {/* Evidence + Vulnerability summary */}
            {signals && (
              <View style={s.summaryRow}>
                <View style={s.summaryCard}>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>Evidence</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryVal}>{signals.evidence?.score}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryBucket}>{signals.evidence?.bucket}</Text>
                </View>
                <View style={s.summaryCard}>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>Vulnerability</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[s.summaryVal, { color: signals.vulnerability === 'crisis' ? colors.emergency : colors.text }]}>
                    {signals.vulnerability}
                  </Text>
                </View>
                <View style={s.summaryCard}>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>Pressure</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[s.summaryVal, { color: signals.time_pressure === 'emergency' ? colors.emergency : colors.text }]}>
                    {signals.time_pressure}
                  </Text>
                </View>
              </View>
            )}

            {/* Outcome indicators */}
            {outcome?.outcome_indicators?.length > 0 ? (
              <>
                <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Outcome indicators</Text>
                {outcome.outcome_indicators.map((ind: any, i: number) => (
                  <View key={`${ind.type}-${i}`} style={s.indicatorCard}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {NEGATIVE_INDICATOR_TYPES.has(ind.type) && (
                          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12 }}>⚠️</Text>
                        )}
                        <Text maxFontSizeMultiplier={1.4} style={s.indLabel}>{ind.label}</Text>
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.indSource}>{ind.source}</Text>
                      {ind.advisory && (
                        <Text maxFontSizeMultiplier={1.4} style={[s.indSource, { color: colors.warn, marginTop: 2 }]}>
                          Advisory — verify with attorney
                        </Text>
                      )}
                    </View>
                    <View style={s.confBox}>
                      <Text maxFontSizeMultiplier={1.4} style={[s.confPct, { color: confColor(ind.confidence, ind.type) }]}>
                        {confPct(ind.confidence)}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.confLabel}>confidence</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>No outcome indicators computed. Add evidence score and vulnerability to see predictions.</Text>
            )}

            {/* Vertical signals summary */}
            {signals?.vertical_signals && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 20 }]}>Active signals</Text>
                {Object.entries(signals.vertical_signals)
                  .filter(([k, v]) =>
                    !ADVISORY_ALWAYS_ON.has(k) &&
                    (v === true ||
                    (typeof v === 'number' && v > 0 && isFinite(v)) ||
                    (typeof v === 'string' && v.length > 0))
                  )
                  .map(([k, v]) => (
                    <View key={k} style={s.signalRow}>
                      <Text maxFontSizeMultiplier={1.4} style={[s.signalDot, { color: colors.legal }]}>●</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.signalKey}>
                        {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                        {typeof v === 'number' ? `: ${Number.isInteger(v) ? v : v.toFixed(2)}` : ''}
                      </Text>
                    </View>
                  ))}
                {Object.entries(signals.vertical_signals).every(([_, v]) =>
                    v === false || v === null || v === undefined ||
                    (typeof v === 'string' && v.length === 0) ||
                    (typeof v === 'number' && !isFinite(v))
                  ) && (
                  <Text maxFontSizeMultiplier={1.4} style={s.empty}>No active signals. Update matter fields to compute vertical intelligence.</Text>
                )}
              </>
            )}
          </>
        )}

        {/* ── MOTIONS TAB ──────────────────────────────────────────────────── */}
        {tab === 'motions' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Motion recommendations</Text>
            {motions.length > 0 ? motions.map((m: any, i: number) => (
              <View key={`${m.type ?? 'motion'}-${i}`} style={[s.motionCard, { borderLeftColor: PRIORITY_COLORS[m.priority] || colors.steel }]}>
                <View style={s.motionHeader}>
                  <Text maxFontSizeMultiplier={1.4} style={s.motionLabel}>{m.label}</Text>
                  <View style={[s.prioBadge, { backgroundColor: (PRIORITY_COLORS[m.priority] || colors.steel) + '22' }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.prioBadgeText, { color: PRIORITY_COLORS[m.priority] || colors.steel }]}>{m.priority}</Text>
                  </View>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={s.motionReason}>{m.reason}</Text>
              </View>
            )) : (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>No motions recommended based on current matter signals. Update charge, evidence score, or jurisdiction to generate recommendations.</Text>
            )}
          </>
        )}

        {/* ── DIVERSION TAB ────────────────────────────────────────────────── */}
        {tab === 'diversion' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Diversion tracks</Text>
            {diversion.length > 0 ? diversion.map((d: any, i: number) => {
              const elig = Math.round(d.eligibility_score * 100);
              const eligColor = elig >= 75 ? colors.legal : elig >= 50 ? colors.warn : colors.steel;
              return (
                <View key={d.track ?? i} style={s.diversionCard}>
                  <View style={s.diversionHeader}>
                    <Text maxFontSizeMultiplier={1.4} style={s.diversionLabel}>{d.label}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[s.diversionElig, { color: eligColor }]}>{elig}% eligible</Text>
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={s.diversionReason}>{d.reason}</Text>
                  <View style={s.eligBar}>
                    <View style={[s.eligFill, { width: `${elig}%` as any, backgroundColor: eligColor }]} />
                  </View>
                </View>
              );
            }) : (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>No diversion tracks available. Client may have prior adjudications or be charged with an excluded offense.</Text>
            )}
          </>
        )}

        {/* ── ESCALATION TAB ───────────────────────────────────────────────── */}
        {tab === 'escalation' && !escalation && (
          <Text maxFontSizeMultiplier={1.4} style={s.empty}>Escalation data unavailable. This may require paralegal+ access.</Text>
        )}
        {tab === 'escalation' && escalation && (
          <>
            <View style={[s.escalCard, { borderColor: ESCALATION_COLORS[escalation.level] || colors.steel }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.escalLevel, { color: ESCALATION_COLORS[escalation.level] || colors.steel }]}>
                {escalation.level?.toUpperCase() || 'NORMAL'}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.escalSLA}>{escalation.recommended_sla}</Text>
            </View>

            {escalation.triggers?.length > 0 && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Escalation triggers</Text>
                {escalation.triggers.map((t: string, i: number) => (
                  <View key={`trigger-${t}`} style={s.triggerRow}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: ESCALATION_COLORS[escalation.level], marginRight: 8 }}>⚡</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.triggerText}>{t.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={s.escalFlags}>
              <View style={[s.escalFlag, escalation.notify_partner && { ...s.escalFlagActive, borderColor: colors.emergency }]}>
                <Text maxFontSizeMultiplier={1.4} style={s.escalFlagLabel}>Notify partner</Text>
                <Text maxFontSizeMultiplier={1.4} style={[s.escalFlagVal, escalation.notify_partner && { color: colors.emergency }]}>
                  {escalation.notify_partner ? 'YES' : 'no'}
                </Text>
              </View>
              <View style={[s.escalFlag, escalation.recommended_match_boost && { ...s.escalFlagActive, borderColor: colors.emergency }]}>
                <Text maxFontSizeMultiplier={1.4} style={s.escalFlagLabel}>Match boost</Text>
                <Text maxFontSizeMultiplier={1.4} style={[s.escalFlagVal, escalation.recommended_match_boost && { color: colors.emergency }]}>
                  {escalation.recommended_match_boost ? 'YES' : 'no'}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ── ANALYTICS TAB ─────────────────────────────────────────────── */}
        {tab === 'analytics' && (
          <>
            {!analytics ? (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>Analytics not available for this matter. Ensure the matter vertical and jurisdiction are set.</Text>
            ) : (
              <>
                {analytics.disclaimer && (
                  <View style={s.analyticsDisclaimer}>
                    <Text maxFontSizeMultiplier={1.4} style={s.analyticsDTitle}>⚖️ {analytics.disclaimer.title || 'Statistical Analysis'}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.analyticsDText}>{analytics.disclaimer.text}</Text>
                  </View>
                )}
                {(analytics.analyses || []).map((a: any, i: number) => (
                  <View key={`analysis-${i}`} style={s.analysisCard}>
                    <View style={s.analysisTierRow}>
                      <Text maxFontSizeMultiplier={1.4} style={[s.analysisTier, { color: colors.gold }]}>{a.signal_tier}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.analysisRange}>
                        {a.range?.low != null ? `${Math.round(a.range.low * 100)}–${Math.round(a.range.high * 100)}%` : ''}
                      </Text>
                    </View>
                    <Text maxFontSizeMultiplier={1.4} style={s.analysisTitle}>{a.title}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.analysisInterp}>{a.interpretation}</Text>
                    {a.circuit_split_warning && (
                      <Text maxFontSizeMultiplier={1.4} style={s.circuitSplitWarn}>⚠ {a.circuit_split_warning}</Text>
                    )}
                    {(a.factors_applied || []).length === 0 && (
                      <Text maxFontSizeMultiplier={1.4} style={s.analysisSource}>Base rate estimate — no specific factors matched.</Text>
                    )}
                    {(a.factors_applied || []).map((f: string, fi: number) => (
                      <Text maxFontSizeMultiplier={1.4} key={fi} style={s.factorItem}>• {f}</Text>
                    ))}
                    {a.source_url ? (
                      <Text maxFontSizeMultiplier={1.4} style={s.analysisSource}>Source: {a.source_label || a.source_url}</Text>
                    ) : null}
                  </View>
                ))}
                {(analytics.analyses || []).length === 0 && (
                  <Text maxFontSizeMultiplier={1.4} style={s.empty}>No analyses available for this vertical.
Update the matter's vertical, jurisdiction, and evidence score to generate analysis.</Text>
                )}
              </>
            )}
          </>
        )}

      </ScrollView>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  root:             { flex: 1, backgroundColor: c.background },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  header:           { backgroundColor: c.card, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle, padding: 14 },
  headerTitle:      { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text, marginBottom: 6 },
  headerMeta:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill:         { fontSize: TYPE.xs, backgroundColor: c.bgElevated, color: c.textMuted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, fontFamily: FONT.medium },
  escalBadge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  escalBadgeText:   { fontSize: TYPE.xs, fontFamily: FONT.bold },
  tabBar:           { flexDirection: 'row', backgroundColor: c.card, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle },
  tabBtn:           { flex: 1, paddingVertical: 11, alignItems: 'center' },
  tabActive:        { borderBottomWidth: 2, borderBottomColor: c.gold },
  tabLabel:         { fontSize: TYPE.xs, fontFamily: FONT.medium, color: c.textMuted },
  tabLabelActive:   { color: c.gold },
  scroll:           { padding: 16, paddingBottom: 60 },
  sectionTitle:     { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 10 },
  empty:            { textAlign: 'center', color: c.textMuted, fontSize: TYPE.base, marginTop: 32, lineHeight: 22, paddingHorizontal: 16 },
  // Summary
  summaryRow:       { flexDirection: 'row', gap: 8, marginBottom: 20 },
  summaryCard:      { flex: 1, backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 10, alignItems: 'center' },
  summaryLabel:     { fontSize: TYPE.xs, color: c.textMuted, marginBottom: 2 },
  summaryVal:       { fontSize: TYPE.lg, fontFamily: FONT.bold, color: c.text, marginBottom: 2 },
  summaryBucket:    { fontSize: TYPE.xs, color: c.textMuted },
  // Indicators
  indicatorCard:    { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  indLabel:         { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 2 },
  indSource:        { fontSize: TYPE.xs, color: c.textMuted, lineHeight: 15 },
  confBox:          { alignItems: 'center', flex: 0 },
  confPct:          { fontSize: TYPE.lg, fontFamily: FONT.bold },
  confLabel:        { fontSize: 10, color: c.textMuted },
  // Error banner
  errorBanner:      { backgroundColor: COLORS.warn, borderRadius: 8, padding: 12, margin: 8 },
  errorBannerText:  { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  // Analytics tab
  analyticsDisclaimer: { backgroundColor: c.surface, borderRadius: 10, padding: 14, margin: 8, borderLeftWidth: 3, borderLeftColor: c.gold },
  analyticsDTitle:  { fontSize: TYPE.lg, fontFamily: FONT.bold, color: c.gold, marginBottom: 6 },
  analyticsDText:   { fontSize: TYPE.xs, color: c.textMuted, lineHeight: 18 },
  analysisCard:     { backgroundColor: c.surface, borderRadius: 10, padding: 14, margin: 8 },
  analysisTierRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  analysisTier:     { fontSize: TYPE.sm, fontFamily: FONT.bold },
  analysisRange:    { fontSize: TYPE.sm, fontFamily: FONT.bold, color: c.gold },
  analysisTitle:    { fontSize: TYPE.sm, fontFamily: FONT.bold, color: c.text, marginBottom: 4 },
  analysisInterp:   { fontSize: TYPE.xs, color: c.textMuted, lineHeight: 18, marginBottom: 4 },
  factorItem:       { fontSize: 11, color: c.textMuted, marginBottom: 2 },
  analysisSource:   { fontSize: 10, color: c.textMuted, fontStyle: 'italic', marginTop: 4 },
  circuitSplitWarn: { fontSize: 11, color: COLORS.warn, marginTop: 4, fontFamily: FONT.bold },
  precedentCard:    { backgroundColor: c.surface, borderRadius: 8, padding: 12, margin: 8, borderLeftWidth: 2, borderLeftColor: c.textMuted },
  precedentTitle:   { fontSize: TYPE.xs, fontFamily: FONT.bold, color: c.text, marginBottom: 4 },
  precedentHolding: { fontSize: 11, color: c.textMuted, lineHeight: 16 },
  warnItem:         { fontSize: TYPE.xs, color: COLORS.warn, marginBottom: 4, marginHorizontal: 8 },
  // Signals
  signalRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  signalDot:        { fontSize: 10, marginTop: 1 },  // color set inline
  signalKey:        { fontSize: TYPE.sm, color: c.text, flex: 1 },
  // Motions
  motionCard:       { backgroundColor: c.card, borderRadius: RADIUS.md, borderLeftWidth: 2, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 12, marginBottom: 8 },
  motionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  motionLabel:      { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, flex: 1, marginRight: 8 },
  motionReason:     { fontSize: TYPE.sm, color: c.textMuted, lineHeight: 18 },
  prioBadge:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  prioBadgeText:    { fontSize: TYPE.xs, fontFamily: FONT.semiBold },
  // Diversion
  diversionCard:    { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 12, marginBottom: 8 },
  diversionHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  diversionLabel:   { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, flex: 1 },
  diversionElig:    { fontSize: TYPE.sm, fontFamily: FONT.bold },
  diversionReason:  { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 8, lineHeight: 18 },
  eligBar:          { height: 4, backgroundColor: c.bgElevated, borderRadius: 2, overflow: 'hidden' },
  eligFill:         { height: 4, borderRadius: 2 },
  // Escalation
  escalCard:        { backgroundColor: c.card, borderRadius: RADIUS.lg, borderWidth: 2, padding: 20, marginBottom: 20, alignItems: 'center' },
  escalLevel:       { fontSize: 28, fontFamily: FONT.bold, marginBottom: 4 },
  escalSLA:         { fontSize: TYPE.base, color: c.text, marginBottom: 4 },
  triggerRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle },
  triggerText:      { fontSize: TYPE.base, color: c.text, textTransform: 'capitalize', flex: 1 },
  escalFlags:       { flexDirection: 'row', gap: 10, marginTop: 20 },
  escalFlag:        { flex: 1, backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, alignItems: 'center' },
  escalFlagActive:  { borderWidth: 1 },  // borderColor set inline
  escalFlagLabel:   { fontSize: TYPE.xs, color: c.textMuted, marginBottom: 4 },
  escalFlagVal:     { fontSize: TYPE.md, fontFamily: FONT.bold, color: c.textMuted },
});
