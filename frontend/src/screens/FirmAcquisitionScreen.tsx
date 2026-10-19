import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
/**
 * FirmAcquisitionScreen — Self-serve firm onboarding funnel
 *
 * Three flows:
 *   1. Browse    — vertical picker + pitch + pricing calculator
 *   2. Activate  — firm name + trial activation
 *   3. Status    — trial countdown + onboarding checklist
 *
 * Entry points:
 *   - HomeScreen attorney tile (pre-auth)
 *   - AttorneyDashboardScreen header CTA
 *   - SettingsScreen My Tools
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  InteractionManager,
} from 'react-native';
import {  useTheme, RADIUS, FONT, TYPE, COLORS } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import type {} from '../types/navigation';
import { useAuthGate } from '../components/AuthGate';
import { t, perLang, useLang } from '../i18n';

type Flow = 'browse' | 'activate' | 'status';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────────
const TRIAL_DAYS = 14; // keep in sync with backend TRIAL_DAYS
const STANDARD_PRICE_DISPLAY = '$199/mo'; // keep in sync with firm_pricing_configs

// ─── VERTICAL DATA ────────────────────────────────────────────────────────────
const VERTICALS = perLang(() => [
  { key: 'criminal_defense', label: t('x_court_forms_criminal_defense'),    emoji: '⚖️',  color: COLORS.legal },
  { key: 'civil_rights',     label: t('x_firm_acquisition_civil_rights_1983'), emoji: '✊',  color: COLORS.blue },
  { key: 'white_collar',     label: t('x_firm_acquisition_white_collar_reg'),  emoji: '🏦',  color: COLORS.navy },
  { key: 'family',           label: t('x_practice_area_selector_family_law'),          emoji: '👨‍👩‍👧',  color: COLORS.emergency },
  { key: 'immigration',      label: t('chat_cat_immigration'),         emoji: '🛂',  color: COLORS.warn },
  { key: 'personal_injury',  label: t('x_practice_area_selector_personal_injury'),     emoji: '🏥',  color: COLORS.emergency },
  { key: 'public_defense',   label: t('x_firm_acquisition_public_defense'),      emoji: '🛡️',  color: COLORS.navy },
  { key: 'appellate',        label: t('x_firm_acquisition_appellate_pcr'),     emoji: '📜',  color: COLORS.blue },
  { key: 'military',         label: t('x_firm_acquisition_military_ucmj'),     emoji: '🎖️',  color: COLORS.legal },
  { key: 'juvenile',         label: t('x_firm_acquisition_juvenile_dependency'),emoji: '👦', color: COLORS.warn },
  { key: 'general',          label: t('x_firm_acquisition_general_practice'),    emoji: '📁',  color: COLORS.steel },
]);

const TIER_COLORS: Record<string, string> = {
  standard:   COLORS.blue,
  mission:    COLORS.legal,
  government: COLORS.navy,
  enterprise: COLORS.emergency,
};

function FirmAcquisitionScreen({ navigation }: any) {
  useLang();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const s = styles(colors);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const mountedRef = useRef(true);
  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  return () => { mountedRef.current = false; };
    });
    return () => _task.cancel();
  }, []);
  const [flow, setFlow]           = useState<Flow>('browse');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);
  const pitchAbort = React.useRef<AbortController | null>(null);  // component-level — persists across loadPitch calls

  // Browse state
  const [selectedV, setSelectedV] = useState('criminal_defense');
  const [pitch, setPitch]         = useState<any>(null);
  const [plans, setPlans]         = useState<any[]>([]);
  const [pitchLoading, setPL]     = useState(false);

  // Activate state
  const [firmName, setFirmName]   = useState('');
  const [activating, setActiv]    = useState(false);
  const [upgrading,  setUpgrading] = useState(false);

  // Status state
  const [status, setStatus]       = useState<any>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [checkPct, setCheckPct]   = useState(0);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const [statusRes, clRes] = await Promise.allSettled([
        api.get('/firm-acquisition/status'),
        api.get('/firm-acquisition/checklist').catch(() => ({ data: { checklist: [] } })),
      ]);
      const statusData = statusRes.status === 'fulfilled' ? statusRes.value.data : null;
      const clData     = clRes.status     === 'fulfilled' ? clRes.value.data     : null;
      if (statusData) setStatus(statusData);
      if (clData?.checklist) setChecklist(clData.checklist);
      if (clData?.completion_pct != null) setCheckPct(clData.completion_pct);
      if (statusData?.has_firm) setFlow('status');
    } catch { /* not logged in or no firm */ }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const res = await api.get('/firm-acquisition/plans');
      setPlans(res.data?.plans || []);
    } catch {}
  }, []);

  const loadPitch = useCallback(async (v: string) => {
    // Cancel any in-flight request before starting a new one
    if (pitchAbort.current) pitchAbort.current.abort();
    pitchAbort.current = new AbortController();
    setPL(true);
    try {
      const res = await api.get(`/firm-acquisition/vertical-demo?vertical=${v}`);
      if (!pitchAbort.current?.signal.aborted) setPitch(res.data || null);
    } catch (e: any) {
      // Ignore AbortError — a newer request is taking over
      // Guard all cancellation signal variants (browser AbortError, Axios ERR_CANCELED/CanceledError)
      const isCancellation = e?.name === 'AbortError' ||
        e?.code === 'ERR_CANCELED' ||
        e?.name === 'CanceledError' ||
        e?.message === 'canceled';
      if (!isCancellation) {
        setPitch(null);
      }
    } finally {
      // Always clear loading — the new request (if one fired) sets it true immediately
      setPL(false);
    }
  }, []);

  const requestUpgrade = async (tier: string) => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const res = await api.post('/firm-acquisition/upgrade', { target_tier: tier });
showToast(res.data?.message, 'success');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_firm_acquisition_could_not_submit_upgrade')), 'error');
    } finally { setUpgrading(false); }
  };

  useEffect(() => {
    Promise.all([loadStatus(), loadPlans()]).finally(() => setLoading(false));
  }, [loadStatus, loadPlans]);

  useEffect(() => { loadPitch(selectedV); }, [selectedV, loadPitch]);

  // ── Activate trial ────────────────────────────────────────────────────────
  const activateTrial = async () => {
    if (!firmName.trim()) { showToast(t('x_firm_acquisition_firm_name_required')); return; }
    if (firmName.trim().length < 2) { showToast(t('x_firm_acquisition_firm_name_must_be')); return; }
    const canProceed = await (requireAuth as any)();
    if (canProceed === false) return;
    setActiv(true);
    try {
      const res = await api.post('/firm-acquisition/trial', {
        firm_name: firmName.trim(), vertical: selectedV,
      });
      showToast(res.data?.message, 'info');
      setFirmName('');
      setFlow('status');  // navigate first — loadStatus failure must not trap user on trial form
      loadStatus().catch(() => null);  // refresh status in background
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_firm_acquisition_could_not_activate_trial')), 'error');
    } finally { setActiv(false); }
  };

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  const vertObj = VERTICALS().find(v => v.key === selectedV);

  return (
    <View style={s.root}
      testID="firm-acquisition-screen">
      {/* Flow toggle — only show if no firm yet */}
      {!status?.has_firm && (
        <View style={s.flowBar}>
          {(['browse','activate'] as Flow[]).map(f => (
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} key={f} style={[s.flowBtn, flow===f && s.flowBtnActive]} onPress={() => setFlow(f)}
              accessibilityLabel={t('x_firm_acquisition_select_firm_vertical')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[s.flowLabel, flow===f && s.flowLabelActive]}>
                {f === 'browse' ? t('x_firm_acquisition_explore') : t('x_firm_acquisition_start_free_trial')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); loadStatus().finally(() => setRefresh(false)); }} tintColor={colors.gold} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── STATUS FLOW ──────────────────────────────────────────────────── */}
        {flow === 'status' && status?.has_firm && (
          <>
            <View style={s.heroCard}>
              <Text maxFontSizeMultiplier={1.4} style={s.heroTitle}>{status.firm?.name}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.heroSub}>
                {VERTICALS().find(v => v.key === status.firm?.vertical)?.emoji}{' '}
                {VERTICALS().find(v => v.key === status.firm?.vertical)?.label}
              </Text>
              {status.trial_active && status.trial_days_left > 0 ? (
                <View style={s.trialBadge}>
                  <Text maxFontSizeMultiplier={1.4} style={s.trialBadgeText}>
                    {t(status.trial_days_left === 1 ? 'x_firm_acquisition_trial_day_remaining_one' : 'x_firm_acquisition_trial_day_remaining_other', { trial_days_left: status.trial_days_left })}
                  </Text>
                </View>
              ) : status.firm?.plan === 'trial' && !status.trial_active ? (
                <View style={[s.trialBadge, { backgroundColor: colors.emergencyBg }]}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.trialBadgeText, { color: colors.emergency }]}>{t('x_firm_acquisition_trial_expired_upgrade_continue')}</Text>
                </View>
              ) : null}
            </View>

            {/* Stats row */}
            <View style={s.statsRow}>
              <View style={s.stat}><Text maxFontSizeMultiplier={1.4} style={s.statVal}>{status.member_count}</Text><Text maxFontSizeMultiplier={1.4} style={s.statLabel}>{t('x_firm_acquisition_team_members')}</Text></View>
              <View style={s.stat}><Text maxFontSizeMultiplier={1.4} style={s.statVal}>{status.matter_count}</Text><Text maxFontSizeMultiplier={1.4} style={s.statLabel}>{t('x_firm_acquisition_matters')}</Text></View>
              <View style={s.stat}>
                <Text maxFontSizeMultiplier={1.4} style={[s.statVal, { color: TIER_COLORS[status.firm?.pricing_tier] || colors.steel }]}>
                  {status.firm?.pricing_tier}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={s.statLabel}>{t('x_firm_acquisition_billing_tier')}</Text>
              </View>
            </View>

            {/* Onboarding checklist */}
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_firm_acquisition_getting_started')}</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${checkPct}%` as any }]} />
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.progressLabel}>{t('x_firm_acquisition_complete', { checkPct })}</Text>

            {checklist.length === 0 ? (
              // Skeleton placeholder while checklist loads
              [0,1,2].map(i => (
                <View key={`skel-${i}`} style={[s.checkRow, { opacity: 0.3 }]}>
                  <Text maxFontSizeMultiplier={1.4} style={s.checkIcon}>⬜</Text>
                  <View style={{ flex: 1, height: 14, backgroundColor: colors.bgElevated, borderRadius: 4 }} />
                </View>
              ))
            ) : checklist.map((c: any) => (
              <View key={c.key} style={[s.checkRow, c.done && s.checkRowDone]}>
                <Text maxFontSizeMultiplier={1.4} style={s.checkIcon}>{c.done ? '✅' : c.required ? '⬜' : '◽'}</Text>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.checkLabel, c.done && { color: colors.textMuted }]}>{c.label}</Text>
                  {c.required && !c.done && <Text maxFontSizeMultiplier={1.4} style={s.checkRequired}>{t('required')}</Text>}
                </View>
              </View>
            ))}

            {/* Upgrade CTA — shown when on trial or standard tier */}
            {status?.firm && ['trial','standard'].includes(status.firm.plan) && (
              <View style={s.upgradeCard}>
                <Text maxFontSizeMultiplier={1.4} style={s.upgradeTitle}>{t('x_firm_acquisition_ready_upgrade')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.upgradeBody}>{t('x_firm_acquisition_mission_pricing_75_off')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                    style={[s.upgradeBtn, { backgroundColor: colors.legalDark }]}
                    onPress={() => requestUpgrade('enterprise')}
                    disabled={upgrading}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={s.upgradeBtnText}>{upgrading ? t('x_bar_prep_quiz_submitting') : t('x_firm_acquisition_enterprise')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                    style={[s.upgradeBtn, { backgroundColor: COLORS.warnDark }]}
                    onPress={() => requestUpgrade('mission')}
                    disabled={upgrading}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={s.upgradeBtnText}>{upgrading ? '…' : t('x_firm_acquisition_mission_75_off')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Quick actions */}
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 20 }]}>{t('x_firm_acquisition_quick_actions')}</Text>
            <View style={s.actionGrid}>
              <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.actionBtn} accessibilityLabel={"\u2699\ufe0f"} onPress={() => navigation.navigate('FirmVertical')}
                      >
                <AppIcon name="settings-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={s.actionLabel}>{t('x_firm_acquisition_configure_vertical')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.actionBtn} onPress={() => navigation.navigate('DeadlineCalculator')}
                      >
                <Text maxFontSizeMultiplier={1.4} style={s.actionEmoji}>📅</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.actionLabel}>{t('x_firm_acquisition_deadline_calculator')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.actionBtn} onPress={() => navigation.navigate('MatterIntelligence')}
                      >
                <Text maxFontSizeMultiplier={1.4} style={s.actionEmoji}>📁</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.actionLabel}>{t('x_firm_acquisition_create_matter')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.actionBtn} onPress={() => navigation.navigate('FirmVertical', { tab: 'pricing' })}
                      >
                <AppIcon name="card-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={s.actionLabel}>{t('x_firm_acquisition_upgrade_plan')}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── BROWSE FLOW ──────────────────────────────────────────────────── */}
        {flow === 'browse' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.pageTitle}>{t('x_firm_acquisition_find_vertical')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.pageHint}>{t('x_firm_acquisition_justice_gavel_adapts_its')}</Text>

            {/* Vertical grid */}
            <View style={s.vertGrid}>
              {VERTICALS().map(v => (
                <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                  key={v.key}
                  style={[s.vertTile, selectedV === v.key && { borderColor: v.color, borderWidth: 1.5 }]}
                  accessibilityLabel={v.emoji} onPress={() => setSelectedV(v.key)}
                  activeOpacity={0.75}
                >
                  <Text maxFontSizeMultiplier={1.4} style={s.vertEmoji}>{v.emoji}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[s.vertLabel, selectedV === v.key && { color: v.color }]} numberOfLines={2}>{v.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Pitch card */}
            {pitchLoading ? (
              <ActivityIndicator color={colors.gold} style={{ marginTop: 20 }} />
            ) : pitch ? (
              <View style={[s.pitchCard, { borderLeftColor: vertObj?.color || colors.steel }]}>
                <Text maxFontSizeMultiplier={1.4} style={s.pitchHeadline}>{pitch.headline}</Text>
                {(pitch.stats || []).map((stat: string, i: number) => (
                  <View key={`stat-${i}`} style={s.pitchStat}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: vertObj?.color || colors.steel, fontSize: 14, marginRight: 8 }}>→</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.pitchStatText}>{stat}</Text>
                  </View>
                ))}
                {pitch.roi && (
                  <View style={s.roiBox}>
                    <Text maxFontSizeMultiplier={1.4} style={s.roiLabel}>ROI</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.roiText}>{pitch.roi}</Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Pricing cards */}
            {plans.length > 0 && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 24 }]}>{t('x_firm_acquisition_pricing')}</Text>
                {plans.map((p: any) => (
                  <View key={p.tier_key} style={[s.tierCard, { borderLeftColor: TIER_COLORS[p.tier_key] || colors.steel }]}>
                    <View style={s.tierHeader}>
                      <View>
                        <Text maxFontSizeMultiplier={1.4} style={[s.tierName, { color: TIER_COLORS[p.tier_key] }]}>{p.display_name}</Text>
                        <Text maxFontSizeMultiplier={1.4} style={s.tierDesc}>{p.description}</Text>
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.tierPrice}>${((p.monthly_cents ?? 0) / 100).toFixed(0)}<Text maxFontSizeMultiplier={1.4} style={s.tierPriceSub}>{t('x_check_in_manager_mo')}</Text></Text>
                    </View>
                    <View style={s.tierMeta}>
                      <Text maxFontSizeMultiplier={1.4} style={s.tierMetaItem}>{t('x_firm_acquisition_seats', { value: p.seat_limit >= 999 ? '∞' : p.seat_limit })}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.tierMetaItem}>{t('x_firm_acquisition_matters_2', { value: p.matter_limit >= 99999 ? '∞' : p.matter_limit })}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.tierMetaItem}>{t('x_firm_acquisition_day', { ai_calls_daily: p.ai_calls_daily })}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.ctaBtn} accessibilityLabel={t('x_firm_acquisition_start_trial_days_day', { TRIAL_DAYS })} onPress={() => setFlow('activate')}
                    >
              <Text maxFontSizeMultiplier={1.4} style={s.ctaBtnText}>{t('x_firm_acquisition_start_day_free_trial', { TRIAL_DAYS })}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── ACTIVATE FLOW ─────────────────────────────────────────────────── */}
        {flow === 'activate' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.pageTitle}>{t('x_firm_acquisition_activate_trial')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.pageHint}>{t('x_firm_acquisition_days_free_no_credit', { TRIAL_DAYS })}</Text>

            {/* Selected vertical recap */}
            <View style={[s.vertRecap, { borderColor: vertObj?.color || colors.steel }]}>
              <Text maxFontSizeMultiplier={1.4} style={s.vertRecapEmoji}>{vertObj?.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={s.vertRecapLabel}>{vertObj?.label}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.vertRecapHint}>{t('x_firm_acquisition_tap_explore_change_vertical')}</Text>
              </View>
              <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} accessibilityLabel={t('x_firm_acquisition_change')} onPress={() => setFlow('browse')}
                      >
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.steel, fontSize: TYPE.sm }}>{t('x_firm_acquisition_change')}</Text>
              </TouchableOpacity>
            </View>

            <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_acquisition_firm_name')}</Text>
            <TextInput
              style={[s.input, activating && { opacity: 0.5 }]}
              value={firmName}
              onChangeText={setFirmName}
              placeholder={t('x_firm_acquisition_e_g_harrington_voss')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              editable={!activating}
          returnKeyType="done" blurOnSubmit={true}
            />

            <View style={s.trialPerks}>
              {[
                t('x_firm_acquisition_all_vertical_features_unlocked'),
                t('x_firm_acquisition_automatic_deadline_seeding_every'),
                t('x_firm_acquisition_invite_full_team_during'),
                t('x_firm_acquisition_specialty_trackers_asylum_dpa'),
                t('x_firm_acquisition_switch_vertical_any_time'),
              ].map((p, i) => (
                <View key={`perk-${i}`} style={s.perkRow}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: colors.legal, marginRight: 8 }}>✓</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.perkText}>{p}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.activateBtn} onPress={activateTrial} disabled={activating}
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} accessibilityLabel={t('x_firm_acquisition_activate_free_trial')}>
              {activating
                ? <ActivityIndicator color={colors.navy} />
                : <Text maxFontSizeMultiplier={1.4} style={s.activateBtnText}>{t('x_firm_acquisition_activate_free_trial')}</Text>
              }
            </TouchableOpacity>

            <Text maxFontSizeMultiplier={1.4} style={s.legalNote}>
              {t('x_firm_acquisition_by_activating_trial_agree', { STANDARD_PRICE_DISPLAY, TRIAL_DAYS })}
            </Text>
          </>
        )}

      </ScrollView>
      <AuthGateModal />
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = (c: any) => StyleSheet.create({
  root:             { flex: 1, backgroundColor: c.background },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  scroll:           { padding: 16, paddingBottom: 60 },
  flowBar:          { flexDirection: 'row', backgroundColor: c.card, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle },
  flowBtn:          { flex: 1, paddingVertical: 13, alignItems: 'center' },
  flowBtnActive:    { borderBottomWidth: 2, borderBottomColor: c.gold },
  flowLabel:        { fontSize: TYPE.sm, fontFamily: FONT.medium, color: c.textMuted },
  flowLabelActive:  { color: c.gold },
  pageTitle:        { fontSize: TYPE.xl, fontFamily: FONT.bold, color: c.text, marginBottom: 6 },
  pageHint:         { fontSize: TYPE.sm, color: c.textMuted, lineHeight: 18, marginBottom: 20 },
  sectionTitle:     { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text, marginBottom: 10 },
  inputLabel:       { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 4, fontFamily: FONT.medium },
  input:            { backgroundColor: c.card, color: c.text, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.regular, fontSize: TYPE.base, marginBottom: 16 },
  // Browse
  vertGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  vertTile:         { width: '30%', backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 10, alignItems: 'center' },
  vertEmoji:        { fontSize: 20, marginBottom: 4 },
  vertLabel:        { fontSize: TYPE.xs, fontFamily: FONT.medium, color: c.textMuted, textAlign: 'center' },
  pitchCard:        { backgroundColor: c.card, borderRadius: RADIUS.md, borderLeftWidth: 3, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 16, marginBottom: 16 },
  pitchHeadline:    { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 12, lineHeight: 20 },
  pitchStat:        { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  pitchStatText:    { fontSize: TYPE.sm, color: c.textMuted, flex: 1, lineHeight: 18 },
  roiBox:           { backgroundColor: c.bgElevated, borderRadius: RADIUS.md, padding: 10, marginTop: 12 },
  roiLabel:         { fontSize: TYPE.xs, color: c.gold, fontFamily: FONT.semiBold, marginBottom: 2 },
  roiText:          { fontSize: TYPE.sm, color: c.text, lineHeight: 18 },
  tierCard:         { backgroundColor: c.card, borderRadius: RADIUS.md, borderLeftWidth: 3, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 10 },
  tierHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  tierName:         { fontSize: TYPE.md, fontFamily: FONT.bold, marginBottom: 2 },
  tierDesc:         { fontSize: TYPE.xs, color: c.textMuted, maxWidth: '75%', lineHeight: 16 },
  tierPrice:        { fontSize: TYPE.xl, fontFamily: FONT.bold, color: c.text },
  tierPriceSub:     { fontSize: TYPE.sm, color: c.textMuted },
  tierMeta:         { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  tierMetaItem:     { fontSize: TYPE.xs, color: c.textMuted },
  ctaBtn:           { backgroundColor: c.gold, borderRadius: RADIUS.md, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  ctaBtnText:       { fontSize: TYPE.md, fontFamily: FONT.bold, color: c.navy },
  // Activate
  vertRecap:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: RADIUS.md, padding: 12, marginBottom: 20, gap: 10 },
  vertRecapEmoji:   { fontSize: 22 },
  vertRecapLabel:   { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text },
  vertRecapHint:    { fontSize: TYPE.xs, color: c.textMuted },
  trialPerks:       { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 20 },
  perkRow:          { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  perkText:         { fontSize: TYPE.sm, color: c.text, lineHeight: 18 },
  activateBtn:      { backgroundColor: c.gold, borderRadius: RADIUS.md, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  activateBtnText:  { fontSize: TYPE.md, fontFamily: FONT.bold, color: c.navy },
  legalNote:        { fontSize: TYPE.xs, color: c.textMuted, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8 },
  // Status
  heroCard:         { backgroundColor: c.card, borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 20, marginBottom: 16, alignItems: 'center' },
  heroTitle:        { fontSize: TYPE.xl, fontFamily: FONT.bold, color: c.text, marginBottom: 4, textAlign: 'center' },
  heroSub:          { fontSize: TYPE.base, color: c.textMuted, marginBottom: 12 },
  trialBadge:       { backgroundColor: c.warnBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },
  trialBadgeText:   { fontSize: TYPE.sm, color: c.warn, fontFamily: FONT.semiBold },
  statsRow:         { flexDirection: 'row', gap: 10, marginBottom: 20 },
  stat:             { flex: 1, backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 12, alignItems: 'center' },
  statVal:          { fontSize: TYPE.xl, fontFamily: FONT.bold, color: c.text, marginBottom: 2 },
  statLabel:        { fontSize: TYPE.xs, color: c.textMuted },
  progressTrack:    { height: 6, backgroundColor: c.bgElevated, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill:     { height: 6, backgroundColor: c.gold, borderRadius: 3 },
  progressLabel:    { fontSize: TYPE.xs, color: c.textMuted, marginBottom: 12 },
  checkRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle, gap: 10 },
  checkRowDone:     { opacity: 0.6 },
  checkIcon:        { fontSize: 16, width: 24 },
  checkLabel:       { fontSize: TYPE.base, fontFamily: FONT.medium, color: c.text },
  checkRequired:    { fontSize: TYPE.xs, color: c.emergency, marginTop: 1 },
  actionGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn:        { width: '47%', backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, alignItems: 'center' },
  actionEmoji:      { fontSize: 24, marginBottom: 6 },
  actionLabel:      { fontSize: TYPE.xs, fontFamily: FONT.medium, color: c.text, textAlign: 'center' },
  upgradeCard:    { backgroundColor: c.bgElevated || COLORS.bgCard, borderRadius: RADIUS.md, padding: 16, marginTop: 12, borderWidth: 0.5, borderColor: c.borderSubtle },
  upgradeTitle:   { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 4 },
  upgradeBody:    { fontSize: TYPE.sm, color: c.textMuted, lineHeight: 18 },
  upgradeBtn:     { flex: 1, paddingVertical: 10, borderRadius: RADIUS.sm, alignItems: 'center' },
  upgradeBtnText: { fontSize: TYPE.sm, fontFamily: FONT.semiBold, color: COLORS.white },
});
export default React.memo(FirmAcquisitionScreen);
