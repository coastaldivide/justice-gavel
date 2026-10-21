import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * MatterIntelligenceScreen — All 40 simulation signals surfaced as live matter intelligence
 *
 * Opened with { matterId } — or without one (Attorney dashboard, Firm tools):
 * then it lists the matters the person can open (GET /matters) to pick one.
 * Four tabs:
 *   1. Outcome    — prediction indicators, settlement probability, reversal score
 *   2. Motions    — recommended motions based on charge × evidence × vulnerability
 *   3. Diversion  — diversion tracks with eligibility scores
 *   4. Escalation — emergency level, SLA timer, escalation triggers
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, LayoutAnimation} from 'react-native';
import {  useTheme, RADIUS, FONT, TYPE, COLORS } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import type {} from '../types/navigation';
import { t, useLang } from '../i18n';

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

interface MatterRow { id: number; title: string; client_name?: string | null; status?: string | null }

function MatterIntelligenceScreen({ route, navigation }: any) {
  useLang();
  const { showToast } = useToast();
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(null);
  const matterId = route.params?.matterId ?? picked?.id;
  const matterTitle = route.params?.matterTitle ?? picked?.title;
  const [matters, setMatters] = useState<MatterRow[] | null>(null);
  const [mattersError, setMattersError] = useState('');
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
      try {
        const r = await api.get<{ matters: MatterRow[] }>('/matters');
        if (isMounted.current) { setMatters(r.data?.matters || []); setMattersError(''); }
      } catch (e) {
        if (isMounted.current) setMattersError(apiErrorMessage(e, t('x_matter_intelligence_could_not_load_data')));
      } finally { if (isMounted.current) setLoading(false); }
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
        showToast(t('x_matter_intelligence_could_not_load_matter'));
      }
    } catch {
      if (isMounted.current) setErrorMsg(t('x_matter_intelligence_could_not_load_data'));
    } finally { if (isMounted.current) setLoading(false); }
  }, [matterId, showToast]);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

  // No matter given: pick one of the matters this person can open
  if (!matterId) return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll} testID="matter-intelligence-picker">
      <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('mi2_pick')}</Text>
      {loading && <ActivityIndicator color={colors.gold} />}
      {!!mattersError && (
        <TouchableOpacity accessibilityRole="button" onPress={() => { setLoading(true); load(); }}>
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={s.empty} maxFontSizeMultiplier={1.4}>{mattersError}· {t('try_again')}</IconLabel>
        </TouchableOpacity>
      )}
      {matters?.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('mi2_none')}</Text>}
      {(matters || []).map(m => (
        <View key={m.id} style={s.motionCard}>
          <TouchableOpacity accessibilityRole="button" testID="matter-intelligence-pick" onPress={() => { setLoading(true); setPicked({ id: Number(m.id), title: m.title }); }}>
            <Text maxFontSizeMultiplier={1.4} style={s.motionLabel}>{m.title}</Text>
            {!!m.client_name && <Text maxFontSizeMultiplier={1.4} style={s.motionReason}>{m.client_name}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => navigation.navigate('Matter', { matterId: m.id })}>
            <Text maxFontSizeMultiplier={1.4} style={[s.motionReason, { color: colors.gold }]}>{t('mi2_open_matter')} ›</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={colors.gold} size="large" /></View>
  );

  return (
    <View style={s.root}
      testID="matter-intelligence-screen">
      {/* Header */}
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.4} style={s.headerTitle} numberOfLines={1}>{matterTitle || t('x_matter_intelligence_matter_intelligence')}</Text>
        {!!errorMsg && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={errorMsg}
            onPress={() => { setErrorMsg(null); load(); }}
            style={[s.metaPill, { backgroundColor: colors.errorBg }]}
          >
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={{ color: colors.emergency, fontSize: TYPE.xs }} maxFontSizeMultiplier={1.4}>{errorMsg}</IconLabel>
          </TouchableOpacity>
        )}
        {partialLoad && (
          <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            onPress={() => { setErrorMsg(null); load(); }}
            style={[s.metaPill, { backgroundColor: colors.errorBg }]}
          >
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={{ color: colors.emergency, fontSize: TYPE.xs }} maxFontSizeMultiplier={1.4}>{t('x_matter_intelligence_partial_data_tap_retry')}</IconLabel>
          </TouchableOpacity>
        )}
        {signals && (
          <View style={s.headerMeta}>
            <Text maxFontSizeMultiplier={1.4} style={s.metaPill}>{signals.vertical?.replace(/_/g, ' ')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.metaPill}>{signals.taxonomy?.replace(/_/g, ' ')}</Text>
            <View style={[s.escalBadge, { backgroundColor: (ESCALATION_COLORS[escalation?.level] || colors.steel) + '22' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.escalBadgeText, { color: ESCALATION_COLORS[escalation?.level] || colors.steel }]}>
                {escalation?.level && ESCALATION_COLORS[escalation.level] ? t(`x_mi_level_${escalation.level}`) : (escalation?.level || t('x_mi_level_normal'))}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['outcome','motions','diversion','escalation','analytics'] as Tab[]).map(tItem => (
          <TouchableOpacity
            accessibilityRole="tab"
            key={tItem}
            style={[s.tabBtn, tab===tItem && s.tabActive]}
            onPress={() => setTab(tItem as Tab)}

            accessibilityState={{ selected: tab === tItem }}
            accessibilityLabel={t(`mi2_tab_${tItem}`)}>
            <Text maxFontSizeMultiplier={1.4} style={[s.tabLabel, tab===tItem && s.tabLabelActive]}>
              {tItem === 'outcome' ? '📊' : tItem === 'motions' ? '⚖️' : tItem === 'diversion' ? '🔄' : tItem === 'analytics' ? '🧠' : tItem === 'escalation' ? '🚨' : '📋'}
              {' '}{t(`mi2_tab_${tItem}`)}
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
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>{t('x_matter_intelligence_evidence')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryVal}>{signals.evidence?.score}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryBucket}>{signals.evidence?.bucket}</Text>
                </View>
                <View style={s.summaryCard}>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>{t('x_matter_intelligence_vulnerability')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[s.summaryVal, { color: signals.vulnerability === 'crisis' ? colors.emergency : colors.text }]}>
                    {signals.vulnerability}
                  </Text>
                </View>
                <View style={s.summaryCard}>
                  <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>{t('x_matter_intelligence_pressure')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[s.summaryVal, { color: signals.time_pressure === 'emergency' ? colors.emergency : colors.text }]}>
                    {signals.time_pressure}
                  </Text>
                </View>
              </View>
            )}

            {/* Outcome indicators */}
            {outcome?.outcome_indicators?.length > 0 ? (
              <>
                <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_matter_intelligence_outcome_indicators')}</Text>
                {outcome.outcome_indicators.map((ind: any, i: number) => (
                  <View key={`${ind.type}-${i}`} style={s.indicatorCard}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {NEGATIVE_INDICATOR_TYPES.has(ind.type) && (
                          <AppIcon name="warning-outline" size={20} color={colors.warn} />
                        )}
                        <Text maxFontSizeMultiplier={1.4} style={s.indLabel}>{ind.label}</Text>
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.indSource}>{ind.source}</Text>
                      {ind.advisory && (
                        <Text maxFontSizeMultiplier={1.4} style={[s.indSource, { color: colors.warn, marginTop: 2 }]}>
                          {t('x_matter_intelligence_advisory_verify_with_attorney')}
                        </Text>
                      )}
                    </View>
                    <View style={s.confBox}>
                      <Text maxFontSizeMultiplier={1.4} style={[s.confPct, { color: confColor(ind.confidence, ind.type) }]}>
                        {confPct(ind.confidence)}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.confLabel}>{t('x_matter_intelligence_confidence')}</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_no_outcome_indicators_computed')}</Text>
            )}

            {/* Vertical signals summary */}
            {signals?.vertical_signals && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 20 }]}>{t('x_matter_intelligence_active_signals')}</Text>
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
                  <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_no_active_signals_update')}</Text>
                )}
              </>
            )}
          </>
        )}

        {/* ── MOTIONS TAB ──────────────────────────────────────────────────── */}
        {tab === 'motions' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_matter_intelligence_motion_recommendations')}</Text>
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
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_no_motions_recommended_based')}</Text>
            )}
          </>
        )}

        {/* ── DIVERSION TAB ────────────────────────────────────────────────── */}
        {tab === 'diversion' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_matter_intelligence_diversion_tracks')}</Text>
            {diversion.length > 0 ? diversion.map((d: any, i: number) => {
              const elig = Math.round(d.eligibility_score * 100);
              const eligColor = elig >= 75 ? colors.legal : elig >= 50 ? colors.warn : colors.steel;
              return (
                <View key={d.track ?? i} style={s.diversionCard}>
                  <View style={s.diversionHeader}>
                    <Text maxFontSizeMultiplier={1.4} style={s.diversionLabel}>{d.label}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[s.diversionElig, { color: eligColor }]}>{t('x_matter_intelligence_eligible', { elig })}</Text>
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={s.diversionReason}>{d.reason}</Text>
                  <View style={s.eligBar}>
                    <View style={[s.eligFill, { width: `${elig}%` as any, backgroundColor: eligColor }]} />
                  </View>
                </View>
              );
            }) : (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_no_diversion_tracks_available')}</Text>
            )}
          </>
        )}

        {/* ── ESCALATION TAB ───────────────────────────────────────────────── */}
        {tab === 'escalation' && !escalation && (
          <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_escalation_data_unavailable_this')}</Text>
        )}
        {tab === 'escalation' && escalation && (
          <>
            <View style={[s.escalCard, { borderColor: ESCALATION_COLORS[escalation.level] || colors.steel }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.escalLevel, { color: ESCALATION_COLORS[escalation.level] || colors.steel }]}>
                {escalation.level && ESCALATION_COLORS[escalation.level] ? t(`x_mi_level_${escalation.level}`) : (escalation.level?.toUpperCase() || t('x_mi_level_normal'))}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.escalSLA}>{escalation.recommended_sla}</Text>
            </View>

            {escalation.triggers?.length > 0 && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_matter_intelligence_escalation_triggers')}</Text>
                {escalation.triggers.map((tItem: string) => (
                  <View key={`trigger-${tItem}`} style={s.triggerRow}>
                    <IconLabel icon={ICONS.flash} textStyle={{ color: ESCALATION_COLORS[escalation.level], marginRight: 8 }} maxFontSizeMultiplier={1.4}></IconLabel>
                    <Text maxFontSizeMultiplier={1.4} style={s.triggerText}>{tItem.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={s.escalFlags}>
              <View style={[s.escalFlag, escalation.notify_partner && { ...s.escalFlagActive, borderColor: colors.emergency }]}>
                <Text maxFontSizeMultiplier={1.4} style={s.escalFlagLabel}>{t('x_matter_intelligence_notify_partner')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[s.escalFlagVal, escalation.notify_partner && { color: colors.emergency }]}>
                  {escalation.notify_partner ? t('x_mi_yes') : t('x_mi_no')}
                </Text>
              </View>
              <View style={[s.escalFlag, escalation.recommended_match_boost && { ...s.escalFlagActive, borderColor: colors.emergency }]}>
                <Text maxFontSizeMultiplier={1.4} style={s.escalFlagLabel}>{t('x_matter_intelligence_match_boost')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[s.escalFlagVal, escalation.recommended_match_boost && { color: colors.emergency }]}>
                  {escalation.recommended_match_boost ? t('x_mi_yes') : t('x_mi_no')}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ── ANALYTICS TAB ─────────────────────────────────────────────── */}
        {tab === 'analytics' && (
          <>
            {!analytics ? (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_matter_intelligence_analytics_not_available_this')}</Text>
            ) : (
              <View testID="matter-intelligence-analytics">
                <View style={s.summaryRow}>
                  <View style={s.summaryCard}>
                    <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>{t('mi2_events')}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.summaryVal}>{analytics.event_count}</Text>
                  </View>
                  <View style={s.summaryCard}>
                    <Text maxFontSizeMultiplier={1.4} style={s.summaryLabel}>{t('mi2_docket')}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.summaryVal}>{analytics.docket_count}</Text>
                  </View>
                </View>
                {(analytics.recent_docket || []).length === 0
                  ? <EmptyState icon="📋" title={t('mi2_no_docket')} />
                  : (analytics.recent_docket || []).map((r: { entry_date: string; filing_type: string }, i: number) => (
                    <Text key={`d-${i}`} maxFontSizeMultiplier={1.4} style={s.factorItem}>• {String(r.entry_date).slice(0, 10)} — {r.filing_type}</Text>
                  ))}
              </View>
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
  errorBannerText:  { color: c.bg, fontSize: 13, fontWeight: '600', textAlign: 'center' },
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
export default React.memo(MatterIntelligenceScreen);