import { useConfirm } from '../hooks/useConfirm';
import { EmptyState } from '../components/EmptyState';
import { useForm, Controller } from 'react-hook-form';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * FirmVerticalScreen — Practice Area Configuration & Specialty Trackers
 *
 * Unlocks the correct feature set for each of the 10 law firm verticals
 * identified in the performance analysis:
 *
 *   criminal_defense  civil_rights   white_collar   family        immigration
 *   personal_injury   public_defense appellate      military      juvenile
 *
 * Four tabs:
 *   1. Setup       — choose vertical, toggle feature flags
 *   2. Pricing     — tier selector + mission pricing request
 *   3. Trackers    — asylum clock (immigration) | DPA (white-collar) | TRO (family)
 *   4. Deadlines   — live vertical deadline calculator
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
  Switch,
  Platform,
  KeyboardAvoidingView,
  LayoutAnimation,
  InteractionManager,
} from 'react-native';
import {  useTheme, RADIUS, FONT, TYPE, COLORS } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import type {} from '../types/navigation';
import { toLocalISODate } from '../utils/dateUtils';
import { t, perLang, useLang } from '../i18n';

type Tab = 'setup' | 'pricing' | 'trackers' | 'deadlines';

// ─── Vertical metadata ────────────────────────────────────────────────────────
const VERTICALS = perLang((): { key: string; label: string; emoji: string; pitch: string }[] => [
  { key: 'criminal_defense', label: t('x_court_forms_criminal_defense'),   emoji: '⚖️',  pitch: t('x_firm_vertical_bail_automation_expungement_pipeline') },
  { key: 'civil_rights',     label: t('x_firm_acquisition_civil_rights_1983'),emoji: '✊',  pitch: t('x_firm_vertical_class_action_management_sol') },
  { key: 'white_collar',     label: t('x_firm_acquisition_white_collar_reg'), emoji: '🏦',  pitch: t('x_firm_vertical_dpa_negotiation_tracker_cooperation') },
  { key: 'family',           label: t('x_practice_area_selector_family_law'),         emoji: '👨‍👩‍👧',  pitch: t('x_firm_vertical_emergency_tro_flow_qdro') },
  { key: 'immigration',      label: t('chat_cat_immigration'),        emoji: '🛂',  pitch: t('x_firm_vertical_asylum_clock_surveillance_detained') },
  { key: 'personal_injury',  label: t('x_practice_area_selector_personal_injury'),    emoji: '🏥',  pitch: t('x_firm_vertical_expert_witness_matching_damages') },
  { key: 'public_defense',   label: t('x_firm_acquisition_public_defense'),     emoji: '🛡️',  pitch: t('x_firm_vertical_caseload_dashboard_diversion_tracker') },
  { key: 'appellate',        label: t('x_firm_acquisition_appellate_pcr'),    emoji: '📜',  pitch: t('x_firm_vertical_aedpa_deadline_tracking_capital') },
  { key: 'military',         label: t('x_firm_acquisition_military_ucmj'),    emoji: '🎖️',  pitch: t('x_firm_vertical_ucmj_taxonomy_article_32') },
  { key: 'juvenile',         label: t('x_firm_acquisition_juvenile_dependency'), emoji: '👦', pitch: t('x_firm_vertical_juvenile_expungement_transfer_monito') },
  { key: 'general',          label: t('x_firm_acquisition_general_practice'),   emoji: '📁',  pitch: t('x_firm_vertical_full_platform_access_with') },
]);

const PRICING_COLORS: Record<string, string> = {
  standard:   COLORS.blue,
  mission:    COLORS.legal,
  government: COLORS.navy,
  enterprise: COLORS.emergency,
};

// ─── Feature flag definitions per vertical ────────────────────────────────────
const FEATURE_FLAGS = perLang((): Record<string, { key: string; label: string; desc: string }[]> => ({
  criminal_defense: [
    { key: 'bail_calc_enabled', label: t('x_firm_vertical_bail_calculator'),      desc: t('x_firm_vertical_automated_bail_bracket_hearing') },
    { key: 'expunge_pipeline',  label: t('x_firm_vertical_expungement_pipeline'), desc: t('x_firm_vertical_auto_check_eligibility_every') },
  ],
  civil_rights: [
    { key: 'class_action_track', label: t('x_firm_vertical_class_action_tracker'), desc: t('x_firm_vertical_certification_status_aggregate_damag') },
    { key: 'sol_calendar',       label: t('x_firm_vertical_sol_calendar'),         desc: t('x_firm_vertical_2_year_1983_deadline') },
  ],
  white_collar: [
    { key: 'dpa_tracker',       label: t('x_firm_vertical_dpa_tracker'),           desc: t('x_firm_vertical_deferred_prosecution_negotiation_fin') },
    { key: 'coop_credit_model', label: t('x_firm_vertical_cooperation_credit'),    desc: t('x_firm_vertical_filip_factors_discount_calculator') },
  ],
  family: [
    { key: 'tro_alerts',    label: t('x_firm_vertical_tro_alerts'),      desc: t('x_firm_vertical_emergency_dv_tro_3') },
    { key: 'qdro_matching', label: t('x_firm_vertical_qdro_matching'),   desc: t('x_firm_vertical_specialist_attorney_matching_pension') },
  ],
  immigration: [
    { key: 'asylum_clock',     label: t('x_firm_vertical_asylum_clock'),      desc: t('x_firm_vertical_per_client_1_year') },
    { key: 'detention_alerts', label: t('x_firm_vertical_detention_alerts'),  desc: t('x_firm_vertical_detained_client_urgency_escalation') },
  ],
  personal_injury: [
    { key: 'expert_matching', label: t('x_firm_vertical_expert_matching'), desc: t('x_firm_vertical_domain_matched_expert_witness') },
    { key: 'damages_model',   label: t('x_firm_vertical_damages_model'),   desc: t('x_firm_vertical_net_damages_calculator_with') },
  ],
  public_defense: [
    { key: 'caseload_dashboard', label: t('x_firm_vertical_caseload_dashboard'), desc: t('x_firm_vertical_per_attorney_active_case') },
    { key: 'diversion_tracker',  label: t('x_firm_vertical_diversion_tracker'),  desc: t('x_firm_vertical_drug_court_mental_health') },
  ],
  appellate: [
    { key: 'aedpa_tracker', label: t('x_firm_vertical_aedpa_tracker'),  desc: t('x_firm_vertical_365_day_habeas_deadline') },
    { key: 'capital_flag',  label: t('x_firm_vertical_capital_flagging'), desc: t('x_firm_vertical_escalation_workflow_death_penalty') },
  ],
  military: [
    { key: 'ucmj_taxonomy',      label: t('x_firm_vertical_ucmj_taxonomy'),       desc: t('x_firm_vertical_article_level_charge_classification') },
    { key: 'clearance_workflow', label: t('x_firm_vertical_clearance_workflow'),   desc: t('x_firm_vertical_security_clearance_revocation_tracki') },
  ],
  juvenile: [
    { key: 'juvenile_expunge', label: t('x_firm_vertical_juvenile_expungement'), desc: t('x_firm_vertical_auto_eligibility_check_closed') },
    { key: 'transfer_monitor', label: t('x_firm_vertical_transfer_monitor'),     desc: t('x_firm_vertical_adult_court_transfer_risk') },
  ],
  general: [],
}));

// Date validation — module-level to avoid recreation per render
const ISO_DATE_RE_FV = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const isValidDateFV  = (s: string) => ISO_DATE_RE_FV.test(s);

function FirmVerticalScreen({ route }: any) {
  useLang();

  const { confirm } = useConfirm();
  // react-hook-form: migrating from 5 individual useState form fields
  const { control } = useForm({
    defaultValues: {
      firm: '',
      acName: '',
      acNotes: '',
      dpaName: '',
      troName: '',
    },
  });

  const { showToast } = useToast();
  const { colors } = useTheme();
  const s = styles(colors);

  const mountedRef = useRef(true);
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    return () => { mountedRef.current = false; };
  }, []);
  const [tab, setTab]               = useState<Tab>('setup');
  // Read initial tab from navigation params (e.g. FirmAcquisition sends { tab: 'pricing' })
  React.useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    const initialTab = (route?.params as Record<string,string>)?.tab as Tab | undefined;
    if (initialTab && (['setup','pricing','trackers','deadlines'] as Tab[]).includes(initialTab)) {
      setTab(initialTab);
    }
    });
    return () => _task.cancel();
  }, [route?.params]);

  const [subscriptionStatus, setSubStatus] = useState<string>('active');
  const [graceUntil, setGraceUntil]        = useState<string | null>(null);

  const [loading, setLoading]       = useState(true);
  const [saving,  setSaving]        = useState(false);
  const [refreshing, setRefresh]    = useState(false);

  // Setup state
  const [firm, setFirm]             = useState<any>(null);
  const [config, setConfig]         = useState<any>(null);
  const [selectedV, setSelectedV]   = useState<string>('general');
  const [features, setFeatures]     = useState<Record<string, boolean>>({});

  // Pricing state
  const [tiers, setTiers]           = useState<any[]>([]);
  const [missionOrg, setMissionOrg] = useState('nonprofit');
  const [missionEIN, setMissionEIN] = useState('');
  const [missionWeb, setMissionWeb] = useState('');
  const [submittingMV, setSubMV]    = useState(false);

  // Tracker state
  const [trackerTab, setTrackerTab] = useState<'asylum' | 'dpa' | 'tro'>('asylum');
  const [asylumClocks, setAC]       = useState<any[]>([]);
  const [dpaList, setDPA]           = useState<any[]>([]);
  const [troList, setTRO]           = useState<any[]>([]);
  const [trackerLoading, setTL]     = useState(false);

  // New asylum clock form
  const [acName, setACName]   = useState('');
  const [acStart, setACStart] = useState(toLocalISODate(new Date()));
  const [acRelief, setACRelief] = useState('asylum');
  const [acDetained, setACDet]  = useState(false);
  const [acCountry, setACCountry] = useState('');
  const [acNotes, setACNotes]     = useState('');

  // Tracker submission states — prevent double-tap duplicates
  const [creatingAC, setCreatingAC] = useState(false);
  const [creatingDPA, setCreatingDPA] = useState(false);
  const [creatingTRO, setCreatingTRO] = useState(false);

  // New DPA form
  const [dpaName, setDPAName] = useState('');
  const [dpaAgency, setDPAAgency] = useState('');
  const [dpaCoop, setDPACoop] = useState('unknown');
  const [dpaFineM, setDPAFineM]   = useState('');
  const [dpaSignDue, setDPASignDue]   = useState('');
  const [dpaWellsDue, setDPAWellsDue] = useState('');
  const [dpaSubDue, setDPASubDue]   = useState('');  // subpoena_due on create form

  // New TRO form
  const [troName, setTROName] = useState('');
  const [troDV, setTRODV]     = useState(false);
  const [troAsset, setTROAsset] = useState('under_100k');

  // Deadlines state
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [trigDate, setTrigDate]   = useState(toLocalISODate(new Date()));
  const [dlLoading, setDLLoading] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      // allSettled: /pricing failure must not block the critical /mine load
      const [mineResult, pricingResult, subResult] = await Promise.allSettled([
        api.get('/firm-verticals/mine'),
        api.get('/firm-verticals/pricing'),
        api.get('/firm-acquisition/status'),
      ]);
      // Populate subscription status for the grace period / read-only banner
      if (subResult.status === 'fulfilled' && subResult.value?.data) {
        setSubStatus(subResult.value.data.subscription_status ?? 'active');
        setGraceUntil(subResult.value.data.grace_until ?? null);
      }
      if (mineResult.status === 'fulfilled') {
        const mineRes = mineResult.value;
        if (mineRes.data?.firm) {
          setFirm(mineRes.data.firm);
          setConfig(mineRes.data.config);
          const v = mineRes.data.firm?.vertical || 'general';
          setSelectedV(v);
          if (mineRes.data.config) {
            const f: Record<string, boolean> = {};
            const flags = FEATURE_FLAGS()[v] || [];
            flags.forEach(fl => { f[fl.key] = !!mineRes.data.config[fl.key]; });
            setFeatures(f);
          }
        }
      }
      if (pricingResult.status === 'fulfilled') {
        setTiers(pricingResult.value.data?.tiers || []);
      }
    } catch (e: any) {
      if (e?.response?.status !== 400) showToast(t('x_firm_vertical_could_not_load_firm'));
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, [showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Load trackers ──────────────────────────────────────────────────────────
  const closeTracker = async (type: string, id: number, name: string) => {
confirm(t('x_firm_vertical_mark_as_resolved'), t('x_firm_vertical_mark_as_resolved_this', { name }),
      { confirmLabel: t('x_firm_vertical_mark_resolved'), destructive: true }).then(async ok => { if (!ok) return;
      try { await api.patch(`/firm-verticals/${type}/${id}/resolve`, {}); loadTrackers(); }
         catch (e: any) { showToast(apiErrorMessage(e, t('x_firm_vertical_could_not_resolve')), 'error'); }
    })
  };

  const loadTrackers = useCallback(async () => {
    if (!firm) return;
    setTL(true);
    try {
      const [acRes, dpaRes, troRes] = await Promise.all([
        api.get('/firm-verticals/asylum-clocks').catch(() => ({ data: { clocks: [] } })),
        api.get('/firm-verticals/dpa').catch(() => ({ data: { trackers: [] } })),
        api.get('/firm-verticals/tro').catch(() => ({ data: { trackers: [] } })),
      ]);
      setAC(acRes.data?.clocks || []);
      setDPA(dpaRes.data?.trackers || []);
      setTRO(troRes.data?.trackers || []);
    } catch { /* handled per-call */ } finally {
      setTL(false);
    }
  }, [firm]);

  const [trackersFetched, setTrackersFetched] = useState(false);
  useEffect(() => {
    if (tab === 'trackers' && !trackersFetched) {
      loadTrackers().then(() => setTrackersFetched(true));
    }
  }, [tab, trackersFetched, loadTrackers]);

  // ── Load deadlines ─────────────────────────────────────────────────────────
  const loadDeadlines = useCallback(async () => {
    if (!firm) return;
    setDLLoading(true);
    try {
      const res = await api.get(`/firm-verticals/deadlines?trigger_date=${trigDate}`);
      setDeadlines(res.data?.deadlines || []);
    } catch { showToast(t('x_firm_vertical_could_not_compute_deadlines')); }
    finally { setDLLoading(false); }
  }, [firm, trigDate, showToast]);

  // Auto-fire deadline calculation when switching to deadlines tab or changing trigger date
  useEffect(() => { if (tab === 'deadlines') loadDeadlines(); }, [tab, trigDate, loadDeadlines]);

  // ── Save vertical config ───────────────────────────────────────────────────
  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload: any = { vertical: selectedV };
      Object.keys(features).forEach(k => { payload[k] = features[k]; });
      await api.put('/firm-verticals/mine', payload);
      showToast(t('x_firm_vertical_vertical_configuration_updated'));
      loadAll();
    } catch { showToast(t('x_firm_vertical_could_not_save_configuration')); }
    finally { setSaving(false); }
  };

  // ── Mission verify submit ──────────────────────────────────────────────────
  const submitMission = async () => {
    if (!missionEIN.trim() && !missionWeb.trim()) {
      showToast(t('x_firm_vertical_provide_ein_organization_website'));
      return;
    }
    setSubMV(true);
    try {
      await api.post('/firm-verticals/mine/mission-verify', {
        org_type: missionOrg, ein: missionEIN.trim(), website: missionWeb.trim(),
      });
      showToast(t('x_firm_vertical_mission_pricing_request_received'));
      setMissionEIN(''); setMissionWeb('');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_firm_vertical_could_not_submit_request')), 'error');
    } finally { setSubMV(false); }
  };

  // ── Create asylum clock ────────────────────────────────────────────────────
  const createAC = async () => {
    if (creatingAC) return;
    if (!acName.trim()) { showToast(t('x_firm_vertical_client_name_required')); return; }
    if (!isValidDateFV(acStart)) { showToast(t('x_firm_vertical_clock_start_date_must')); return; }
    setCreatingAC(true);
    try {
      await api.post('/firm-verticals/asylum-clocks', {
        client_name: acName.trim(), clock_start: acStart,
        relief_type: acRelief, detained: acDetained,
        country_condition: acCountry || undefined,
        notes: acNotes.trim() || undefined,
      });
      setACName(''); setACStart(toLocalISODate(new Date()));
      setACDet(false); setACCountry(''); setACNotes('');
      loadTrackers();
    } catch (e: any) { showToast(apiErrorMessage(e, t('x_firm_vertical_could_not_create_clock')), 'error'); }
    finally { setCreatingAC(false); }
  };

  // ── Create DPA tracker ────────────────────────────────────────────────────
  const createDPA = async () => {
    if (creatingDPA) return;
    if (!dpaName.trim()) { showToast(t('x_firm_vertical_client_name_required')); return; }
    try {
      if (dpaWellsDue.trim() && !isValidDateFV(dpaWellsDue.trim())) { showToast(t('x_firm_vertical_wells_due_must_be')); return; }
      if (dpaSubDue.trim() && !isValidDateFV(dpaSubDue.trim())) { showToast(t('x_firm_vertical_subpoena_due_must_be')); return; }
      if (dpaSignDue.trim() && !isValidDateFV(dpaSignDue.trim())) { showToast(t('x_firm_vertical_dpa_signing_deadline_must')); return; }
      const cleanedFine = dpaFineM.replace(/,/g, '').trim();  // strip commas (e.g. '1,000' → '1000')
      const parsedFine  = parseFloat(cleanedFine);
      if (cleanedFine && isNaN(parsedFine)) { showToast(t('x_firm_vertical_base_fine_must_be')); return; }
      const fineC = cleanedFine && !isNaN(parsedFine) ? Math.round(parsedFine * 100) : 0;
      setCreatingDPA(true);
      await api.post('/firm-verticals/dpa', {
        client_name: dpaName.trim(), agency: dpaAgency.trim() || undefined,
        cooperation_level: dpaCoop, base_fine_cents: fineC,
        wells_due:    dpaWellsDue.trim() || undefined,
        subpoena_due: dpaSubDue.trim() || undefined,
        dpa_sign_due: dpaSignDue.trim() || undefined,
      });
      setDPAName(''); setDPAAgency(''); setDPACoop('unknown'); setDPAFineM('');
      setDPASignDue(''); setDPAWellsDue(''); setDPASubDue('');
      loadTrackers();
    } catch (e: any) { showToast(apiErrorMessage(e, t('x_firm_vertical_could_not_create_tracker')), 'error'); }
    finally { setCreatingDPA(false); }
  };

  // ── Create TRO tracker ────────────────────────────────────────────────────
  const createTRO = async () => {
    if (creatingTRO) return;
    if (!troName.trim()) { showToast(t('x_firm_vertical_client_name_required')); return; }
    try {
      setCreatingTRO(true);
      await api.post('/firm-verticals/tro', {
        client_name: troName.trim(), dv_flag: troDV, asset_tier: troAsset,
      });
      setTROName(''); setTRODV(false); setTROAsset('under_100k');
      loadTrackers();
    } catch (e: any) { showToast(apiErrorMessage(e, t('x_firm_vertical_could_not_create_tro')), 'error'); }
    finally { setCreatingTRO(false); }
  };

  // ── Priority color ─────────────────────────────────────────────────────────
  const prioColor = (p: string) => {
    if (p === 'critical') return colors.emergency;
    if (p === 'high')     return colors.warn;
    return colors.textMuted;
  };

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────
  // Firm hasn't configured verticals yet — show setup prompt instead of empty/error
  if (config?._unconfigured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}
        testID="firm-vertical-screen">
        <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 18, fontWeight: '700', color: colors?.primary ?? COLORS.navy, marginBottom: 8, textAlign: 'center' }}>
          {t('x_firm_vertical_set_up_legal_vertical')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, color: colors?.textMuted ?? colors.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {t('x_firm_vertical_firm_hasn_t_configured')}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {/* Subscription grace period / read-only mode banner */}
      {(subscriptionStatus === 'grace' || subscriptionStatus === 'lapsed') && (
        <View style={s.graceBanner}>
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={s.graceBannerTitle} maxFontSizeMultiplier={1.4}>{subscriptionStatus === 'grace' ? t('x_firm_vertical_account_read_only_mode') : t('x_firm_vertical_subscription_inactive')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={s.graceBannerBody}>
            {subscriptionStatus === 'grace' && graceUntil
              ? t('x_firm_vertical_can_view_all_data', { graceUntil })
              : t('x_firm_vertical_subscription_inactive_all_data')}
          </Text>
        </View>
      )}

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['setup','pricing','trackers','deadlines'] as Tab[]).map(tItem => (
          <TouchableOpacity
          accessibilityRole="button" key={tItem} style={[s.tabBtn, tab===tItem && s.tabActive]} onPress={() => setTab(tItem)}
          accessibilityState={{  selected: false  }}
            accessibilityLabel={t('x_firm_vertical_switch_tab')}
          >
            <IconLabel icon={ICONS.settings} textStyle={[s.tabLabel, tab===tItem && s.tabLabelActive]} maxFontSizeMultiplier={1.4}>{tItem === 'setup' ? t('x_firm_vertical_setup') : tItem === 'pricing' ? t('x_firm_vertical_pricing') : tItem === 'trackers' ? t('x_firm_vertical_trackers') : t('x_firm_vertical_deadlines')}</IconLabel>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() =>
      { setRefresh(true); loadAll().catch(()=>{}).finally(() => setRefresh(false)); }} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ──── SETUP TAB ──────────────────────────────────────────────────── */}
        {tab === 'setup' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_firm_vertical_choose_practice_vertical')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_this_unlocks_correct_feature')}</Text>

            {VERTICALS().map(v => (
              <TouchableOpacity accessibilityRole="button"
                key={v.key}
                style={[s.vertCard, selectedV === v.key && s.vertCardSelected]}
                onPress={() => {
                  setSelectedV(v.key);
                  // Preserve existing flag values; only initialise new flags to false
                  const f: Record<string, boolean> = {};
                  (FEATURE_FLAGS()[v.key] || []).forEach(fl => {
                    f[fl.key] = features[fl.key] ?? (config ? !!config[fl.key] : false);
                  });
                  setFeatures(f);
                }}
                activeOpacity={0.75}
              >
                <View style={s.vertHeader}>
                  <Text maxFontSizeMultiplier={1.4} style={s.vertEmoji}>{v.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.vertLabel, selectedV === v.key && s.vertLabelSelected]}>{v.label}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.vertPitch}>{v.pitch}</Text>
                  </View>
                  {selectedV === v.key && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.gold, fontSize: 18 }}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}

            {(FEATURE_FLAGS()[selectedV] || []).length > 0 && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 24 }]}>{t('x_firm_vertical_feature_flags', { label: VERTICALS().find(v => v.key === selectedV)?.label })}</Text>
                {(FEATURE_FLAGS()[selectedV] || []).map(fl => (
                  <View key={fl.key} style={s.flagRow}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>{fl.label}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.flagDesc}>{fl.desc}</Text>
                    </View>
                    <Switch accessibilityLabel={fl.label}
                      value={!!features[fl.key]}
                      onValueChange={v => setFeatures(prev => ({ ...prev, [fl.key]: v }))}
                      trackColor={{ false: colors.borderSubtle, true: colors.gold }}
                      thumbColor={colors.card}
                    />
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity style={s.saveBtn} onPress={saveConfig} disabled={saving}
            accessibilityRole="button" accessibilityLabel={t('x_firm_vertical_save_configuration')}
          accessibilityHint={t('cp_double_tap')}>
              {saving
                ? <ActivityIndicator color={colors.navy} />
                : <Text maxFontSizeMultiplier={1.4} style={s.saveBtnText}>{t('x_firm_vertical_save_configuration')}</Text>
              }
            </TouchableOpacity>
          </>
        )}

        {/* ──── PRICING TAB ────────────────────────────────────────────────── */}
        {tab === 'pricing' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_firm_vertical_pricing_tiers')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_choose_tier_that_matches')}</Text>

            {tiers.map((tItem: any) => (
              <View key={tItem.tier_key} style={[s.tierCard, { borderLeftColor: PRICING_COLORS[tItem.tier_key] || colors.steel }]}>
                <View style={s.tierHeader}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.tierName, { color: PRICING_COLORS[tItem.tier_key] || colors.text }]}>{tItem.display_name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.tierPrice}>${((tItem.monthly_cents ?? 0) / 100).toFixed(0)}<Text maxFontSizeMultiplier={1.4} style={s.tierPriceSub}>{t('x_check_in_manager_mo')}</Text></Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={s.tierDesc}>{tItem.description}</Text>
                <View style={s.tierStats}>
                  <IconLabel icon={ICONS.user} textStyle={s.tierStat} maxFontSizeMultiplier={1.4}>{t('x_firm_acquisition_seats', { value: tItem.seat_limit === 999 ? t('x_firm_vertical_unlimited') : tItem.seat_limit })}</IconLabel>
                  <IconLabel icon={ICONS.cases} textStyle={s.tierStat} maxFontSizeMultiplier={1.4}>{t('x_firm_acquisition_matters_2', { value: tItem.matter_limit >= 99999 ? t('x_firm_vertical_unlimited') : tItem.matter_limit })}</IconLabel>
                  <IconLabel icon={ICONS.ai} textStyle={s.tierStat} maxFontSizeMultiplier={1.4}>{t('x_firm_vertical_day_ai_calls', { ai_calls_daily: tItem.ai_calls_daily })}</IconLabel>
                </View>
                {firm?.pricing_tier === tItem.tier_key && (
                  <View style={s.currentBadge}><Text maxFontSizeMultiplier={1.4} style={s.currentBadgeText}>{t('x_firm_vertical_current_plan')}</Text></View>
                )}
              </View>
            ))}

            <View style={s.missionBox}>
              <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_firm_vertical_apply_mission_pricing')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_nonprofit_501_c_3')}</Text>

              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_organization_type')}</Text>
              <View style={s.segRow}>
                {['nonprofit','public_defender','government','legal_aid'].map(ot => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    key={ot}
                    style={[s.segBtn, missionOrg === ot && s.segBtnActive]}
                    onPress={() => setMissionOrg(ot)}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, missionOrg === ot && s.segLabelActive]}>
                      {ot === 'nonprofit' ? t('x_firm_vertical_nonprofit') : ot === 'public_defender' ? t('x_firm_vertical_public_def') : ot === 'government' ? t('x_firm_vertical_government') : t('x_firm_vertical_legal_aid')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_ein_tax_id')}</Text>
              <TextInput
                style={s.input}
                value={missionEIN}
                onChangeText={setMissionEIN}
                placeholder="12-3456789"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
              />
              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_organization_website')}</Text>
              <TextInput
                style={s.input}
                value={missionWeb}
                onChangeText={setMissionWeb}
                placeholder="https://yourorg.org"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
              <View>

              <TouchableOpacity style={s.missionBtn} onPress={submitMission} disabled={submittingMV}
            accessibilityRole="button" accessibilityLabel={t('x_firm_vertical_submit_verification_request')}
          accessibilityHint={t('cp_double_tap')}>
                {submittingMV
                  ? <ActivityIndicator color={colors.white} />
                  : <Text maxFontSizeMultiplier={1.4} style={s.missionBtnText}>{t('x_firm_vertical_submit_verification_request')}</Text>
                }
              </TouchableOpacity>
            </View>
            </View>
          </>
        )}

        {/* ──── TRACKERS TAB ───────────────────────────────────────────────── */}
        {tab === 'trackers' && (
          <>
            <View style={s.subTabRow}>
              {(['asylum','dpa','tro'] as const).map(tt => (
                <TouchableOpacity
          accessibilityRole="button" key={tt} style={[s.subTab, trackerTab===tt && s.subTabActive]} onPress={() => setTrackerTab(tt)}
          accessibilityState={{  selected: false  }}
                        >
                  <IconLabel icon={ICONS.clock} textStyle={[s.subTabLabel, trackerTab===tt && s.subTabLabelActive]} maxFontSizeMultiplier={1.4}>{tt === 'asylum' ? t('x_firm_vertical_asylum_clock_2') : tt === 'dpa' ? t('x_firm_vertical_dpa_tracker_2') : t('x_firm_vertical_tro_tracker')}</IconLabel>
                </TouchableOpacity>
              ))}
            </View>

            {trackerLoading ? (
              <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
            ) : (
              <>
                {/* ASYLUM CLOCK */}
                {trackerTab === 'asylum' && (
                  <>
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_track_1_year_asylum')}</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>{t('x_firm_vertical_add_asylum_clock')}</Text>
                      <Controller
          control={control}
          name="acName"
          render={({ field }) => (
            <TextInput style={s.input} placeholder={t('x_firm_vertical_client_name')} placeholderTextColor={colors.textMuted}  returnKeyType="next"
              maxLength={200}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_clock_start_date_when')}</Text>
                      <TextInput style={s.input} value={acStart} onChangeText={setACStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_relief_type')}</Text>
                      <View style={s.segRow}>
                        {[
        'asylum', 'cancellation', 'DACA', 'VAWA', 'U_visa',
        'withholding', 'CAT', 'adjustment', 'citizenship', 'humanitarian', 'TPS', 'SIJ',
      ].map(rt => (
                          <TouchableOpacity
          accessibilityRole="button" key={rt} style={[s.segBtn, acRelief===rt && s.segBtnActive]} accessibilityLabel={rt} onPress={() => setACRelief(rt)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, acRelief===rt && s.segLabelActive]}>{rt}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={s.flagRow}>
                        <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>{t('x_firm_vertical_client_detained')}</Text>
                        <Switch accessibilityLabel={t('x_firm_vertical_client_detained')} value={acDetained} onValueChange={setACDet} trackColor={{ false: colors.borderSubtle, true: colors.emergency }} thumbColor={colors.card} accessibilityState={{ checked: acDetained }} />
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_country_conditions_optional')}</Text>
                      <View style={s.segRow}>
                        {(['crisis','deteriorating','stable'] as const).map(cc => (
                          <TouchableOpacity
          accessibilityRole="button" key={cc} style={[s.segBtn, acCountry===cc && s.segBtnActive]} onPress={() => setACCountry(acCountry===cc ? '' : cc)}
                                  >
                            <IconLabel icon={ICONS.emergency} iconColor={colors.emergency} textStyle={[s.segLabel, acCountry===cc && s.segLabelActive]} maxFontSizeMultiplier={1.4}>{cc==='crisis'?t('x_firm_vertical_crisis'):cc==='deteriorating'?t('x_firm_vertical_deteriorating'):t('x_firm_vertical_stable')}</IconLabel>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Controller
          control={control}
          name="acNotes"
          render={({ field }) => (
            <TextInput style={[s.input,{minHeight:56}]} placeholder={t('x_firm_vertical_notes_optional')} placeholderTextColor={colors.textMuted} multiline
              maxLength={2000}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
                      <TouchableOpacity style={[s.addBtn, creatingAC && { opacity: 0.6 }]} onPress={createAC} disabled={creatingAC}
            accessibilityRole="button" accessibilityLabel={creatingAC ? t('x_firm_vertical_adding') : t('x_firm_vertical_add_clock')}><Text maxFontSizeMultiplier={1.4} style={s.addBtnText}>{creatingAC ? t('x_firm_vertical_adding') : t('x_firm_vertical_add_clock')}</Text></TouchableOpacity>
                    </View>

                    {asylumClocks.map((c: any) => {
                      const pct = Math.min(100, Math.round((c.elapsed_days / 365) * 100));
                      const barColor = c.one_year_barred ? colors.emergency : c.elapsed_days > 300 ? colors.warn : colors.legal;
                      return (
                        <View key={c.id} style={s.clockCard}>
                          <View style={s.clockHeader}>
                            <Text maxFontSizeMultiplier={1.4} style={s.clockName}>{c.client_name}</Text>
                            {c.detained && <View style={s.detBadge}><Text maxFontSizeMultiplier={1.4} style={s.detBadgeText}>{t('x_firm_vertical_detained')}</Text></View>}
                          </View>
                          <Text maxFontSizeMultiplier={1.4} style={s.clockSub}>{t('x_firm_vertical_started', { relief_type: c.relief_type, clock_start: c.clock_start })}</Text>
                          <View style={s.progressTrack}>
                            <View style={[s.progressFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
                          </View>
                          <View style={s.clockFooter}>
                            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[s.clockDays, { color: barColor }]} maxFontSizeMultiplier={1.4}>{c.one_year_barred
                              ? t('x_firm_vertical_1_year_bar_exceeded')
                              : c.approaching_bar
                                ? t('x_firm_vertical_approaching_bar_days_remaining', { days_until_bar: c.days_until_bar })
                                : t('x_firm_vertical_days_elapsed_days_until', { elapsed_days: c.elapsed_days, days_until_bar: c.days_until_bar })}</IconLabel>
                            <Text maxFontSizeMultiplier={1.4} style={s.clockPct}>{pct}%</Text>
                          </View>
                        </View>
                      );
                    })}
                    {<EmptyState icon="📋" title={t('empty_state_nothing')} />}
                  </>
                )}

                {/* DPA TRACKER */}
                {trackerTab === 'dpa' && (
                  <>
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_model_fine_reductions_through')}</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>{t('x_firm_vertical_add_dpa_tracker')}</Text>
                      <Controller
          control={control}
          name="dpaName"
          render={({ field }) => (
            <TextInput style={s.input} placeholder={t('x_firm_vertical_client_entity_name')} placeholderTextColor={colors.textMuted} returnKeyType="next" maxLength={200}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
                      <TextInput style={s.input} value={dpaAgency} onChangeText={setDPAAgency} placeholder={t('x_firm_vertical_agency')} keyboardType="numeric" />
                      <TextInput style={s.input} value={dpaFineM} onChangeText={setDPAFineM} placeholder={t('x_firm_vertical_base_fine_m_e')} placeholderTextColor={colors.textMuted} keyboardType="numeric"  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaWellsDue} onChangeText={setDPAWellsDue} placeholder={t('x_firm_vertical_wells_notice_due_yyyy')} placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaSubDue} onChangeText={setDPASubDue} placeholder={t('x_firm_vertical_subpoena_response_due_yyyy')} placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaSignDue} onChangeText={setDPASignDue} placeholder={t('x_firm_vertical_dpa_signing_deadline_yyyy')} placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_cooperation_level')}</Text>
                      <View style={s.segRow}>
                        {['full_cooperation','limited_cooperation','proffer_agreement','no_cooperation'].map(cl => (
                          <TouchableOpacity
          accessibilityRole="button" key={cl} style={[s.segBtn, dpaCoop===cl && s.segBtnActive]} onPress={() => setDPACoop(cl)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, dpaCoop===cl && s.segLabelActive]}>
                              {cl === 'full_cooperation' ? t('x_firm_vertical_full') : cl === 'limited_cooperation' ? t('x_firm_vertical_limited') : cl === 'proffer_agreement' ? t('x_firm_vertical_proffer') : t('x_firm_vertical_none')}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity style={[s.addBtn, creatingDPA && { opacity: 0.6 }]} onPress={createDPA} disabled={creatingDPA}
            accessibilityRole="button"><Text maxFontSizeMultiplier={1.4} style={s.addBtnText}>{creatingDPA ? t('x_firm_vertical_adding') : t('x_firm_vertical_add_tracker')}</Text></TouchableOpacity>
                    </View>

                    {dpaList.map((d: any) => {
                      const base = (d.base_fine_cents ?? 0) / 100;
                      const eff  = (d.effective_fine_cents ?? 0) / 100;
                      const saved = base > 0 ? Math.round((1 - eff / base) * 100) : 0;
                      return (
                        <View key={d.id} style={s.dpaCard}>
                          <Text maxFontSizeMultiplier={1.4} style={s.dpaName}>{d.client_name}</Text>
                          <Text maxFontSizeMultiplier={1.4} style={s.dpaSub}>{d.agency || t('x_firm_vertical_agency_tbd')} · {d.dpa_status}</Text>
                          <View style={s.dpaRow}>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>{t('x_firm_vertical_base_fine')}</Text>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricVal}>${(base/1000000).toFixed(1)}M</Text>
                            </View>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>{t('x_firm_vertical_effective_fine')}</Text>
                              <Text maxFontSizeMultiplier={1.4} style={[s.dpaMetricVal, { color: colors.legal }]}>${(eff/1000000).toFixed(1)}M</Text>
                            </View>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>{t('saved_saved_on')}</Text>
                              <Text maxFontSizeMultiplier={1.4} style={[s.dpaMetricVal, { color: colors.gold }]}>{saved}%</Text>
                            </View>
                          </View>
                          <Text maxFontSizeMultiplier={1.4} style={s.coopLabel}>{t('x_firm_vertical_cooperation', { value: d.cooperation_level.replace(/_/g, ' ') })}</Text>
                          <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() => closeTracker('dpa', d.id, d.client_name)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                            style={{ alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 10,
                              backgroundColor: COLORS.infoBg, borderRadius: 6, marginTop: 8 }}
                          >
                            <Text style={{ fontSize: 12, color: COLORS.navy }}>{t('x_firm_vertical_mark_resolved_2')}</Text>
                          </TouchableOpacity>
                          {d.wells_due && (
                            <IconLabel icon={ICONS.clipboard} textStyle={[s.troDue, d.wells_overdue && { color: colors.emergency }]} maxFontSizeMultiplier={1.4}>{t('x_firm_vertical_wells', { value: d.wells_overdue
                                ? t('x_firm_vertical_overdue_by_d', { days_until_wells: Math.abs(d.days_until_wells) })
                                : t('x_firm_vertical_d_remaining', { days_until_wells: d.days_until_wells, wells_due: d.wells_due }) })}</IconLabel>
                          )}
                          {d.subpoena_due && (
                            <IconLabel icon={ICONS.attach} textStyle={[s.troDue, d.subpoena_overdue && { color: colors.emergency }]} maxFontSizeMultiplier={1.4}>{t('x_firm_vertical_subpoena', { value: d.subpoena_overdue
                                ? t('x_firm_vertical_overdue_by_d_2', { days_until_subpoena: Math.abs(d.days_until_subpoena) })
                                : t('x_firm_vertical_d_remaining_2', { days_until_subpoena: d.days_until_subpoena, subpoena_due: d.subpoena_due }) })}</IconLabel>
                          )}
                          {d.dpa_sign_due && (
                            <IconLabel icon={ICONS.edit} textStyle={[s.troDue, d.sign_overdue && { color: colors.emergency }]} maxFontSizeMultiplier={1.4}>{t('x_firm_vertical_sign', { value: d.sign_overdue
                                ? t('x_firm_vertical_overdue_by_d_3', { days_until_sign: Math.abs(d.days_until_sign) })
                                : t('x_firm_vertical_d_remaining_3', { days_until_sign: d.days_until_sign, dpa_sign_due: d.dpa_sign_due }) })}</IconLabel>
                          )}
                        </View>
                      );
                    })}
                    {<EmptyState icon="📋" title={t('empty_state_nothing')} />}
                  </>
                )}

                {/* TRO TRACKER */}
                {trackerTab === 'tro' && (
                  <>
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_emergency_tro_tracking_domestic')}</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>{t('x_firm_vertical_add_tro_tracker')}</Text>
                      <Controller
          control={control}
          name="troName"
          render={({ field }) => (
            <TextInput style={s.input} placeholder={t('x_firm_vertical_client_name')} placeholderTextColor={colors.textMuted} returnKeyType="next" maxLength={200}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
                      <View style={s.flagRow}>
                        <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>{t('x_firm_vertical_domestic_violence_flag')}</Text>
                        <Switch accessibilityLabel={t('x_firm_vertical_add_tro_tracker')} value={troDV} onValueChange={setTRODV} trackColor={{ false: colors.borderSubtle, true: colors.emergency }} thumbColor={colors.card} />
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_asset_tier')}</Text>
                      <View style={s.segRow}>
                        {(['under_100k','100k_500k','500k_2m','2m_10m','over_10m'] as const).map(at => (
                          <TouchableOpacity
          accessibilityRole="button" key={at} style={[s.segBtn, troAsset===at && s.segBtnActive]} onPress={() => setTROAsset(at)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, troAsset===at && s.segLabelActive]}>
                              {at === 'under_100k' ? '<100k'
                                : at === '100k_500k' ? '100k–500k'
                                : at === '500k_2m'  ? '500k–2M'
                                : at === '2m_10m'   ? '2M–10M'
                                :                     '>10M'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity accessibilityRole="button" style={[s.addBtn, troDV && { backgroundColor: colors.emergency }]} onPress={createTRO}
          >
                        <IconLabel icon={ICONS.emergency} textStyle={s.addBtnText} maxFontSizeMultiplier={1.4}>{troDV ? t('x_firm_vertical_file_emergency_tro') : t('x_firm_vertical_add_tro_tracker')}</IconLabel>
                      </TouchableOpacity>
                    </View>

                    {troList.map((tItem: any) => (
                      <View key={tItem.id} style={s.troCard}>
                        <View style={s.troHeader}>
                          <Text maxFontSizeMultiplier={1.4} style={s.troName}>{tItem.client_name}</Text>
                          {tItem.dv_flag ? <View style={s.dvBadge}><Text maxFontSizeMultiplier={1.4} style={s.dvBadgeText}>{t('x_firm_vertical_dv')}</Text></View> : null}
                          {tItem.tro_granted ? <View style={s.grantedBadge}><Text maxFontSizeMultiplier={1.4} style={s.grantedBadgeText}>{t('x_firm_vertical_granted')}</Text></View> : null}
                        </View>
                        {tItem.tro_hearing_due && (
                          <IconLabel icon={ICONS.alarm} textStyle={[
                            s.troDue,
                            tItem.hearing_overdue && { color: colors.emergency }
                          ]} maxFontSizeMultiplier={1.4}>{tItem.hearing_overdue
                              ? t(Math.abs(tItem.days_until_hearing) === 1 ? 'x_firm_vertical_hearing_overdue_by_day_one' : 'x_firm_vertical_hearing_overdue_by_day_other', { days_until_hearing: Math.abs(tItem.days_until_hearing) })
                              : tItem.days_until_hearing !== null
                                ? t(tItem.days_until_hearing === 1 ? 'x_firm_vertical_hearing_day_one' : 'x_firm_vertical_hearing_day_other', { days_until_hearing: tItem.days_until_hearing, tro_hearing_due: tItem.tro_hearing_due })
                                : t('x_firm_vertical_hearing_due', { tro_hearing_due: tItem.tro_hearing_due })
                            }</IconLabel>
                        )}
                        {tItem.protective_order_due && (
                          <IconLabel icon={ICONS.clipboard} textStyle={[s.troDue, tItem.po_overdue && { color: colors.emergency }]} maxFontSizeMultiplier={1.4}>{t('x_firm_vertical_po', { value: tItem.po_overdue
                              ? t('x_firm_vertical_overdue_by_d_4', { days_until_po: Math.abs(tItem.days_until_po) })
                              : tItem.days_until_po !== null
                                ? t('x_firm_vertical_d_remaining_4', { days_until_po: tItem.days_until_po, protective_order_due: tItem.protective_order_due })
                                : tItem.protective_order_due })}</IconLabel>
                        )}
                        <Text maxFontSizeMultiplier={1.4} style={s.troAsset}>{t('x_firm_vertical_asset_tier_2', { value: tItem.asset_tier.replace(/_/g, ' ') })}</Text>
                      </View>
                    ))}
                    {<EmptyState icon="📋" title={t('empty_state_nothing')} />}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ──── DEADLINES TAB ──────────────────────────────────────────────── */}
        {tab === 'deadlines' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>{t('x_firm_vertical_vertical_deadline_calculator')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('x_firm_vertical_enter_trigger_date_arrest')}</Text>

            <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>{t('x_firm_vertical_trigger_date')}</Text>
            <TextInput
              style={s.input}
              value={trigDate}
              onChangeText={setTrigDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted} returnKeyType="next" />
            <TouchableOpacity style={s.saveBtn} onPress={loadDeadlines} disabled={dlLoading}
            accessibilityRole="button" accessibilityLabel={t('x_firm_vertical_calculate_deadlines')}>
              {dlLoading ? <ActivityIndicator color={colors.navy} /> : <Text maxFontSizeMultiplier={1.4} style={s.saveBtnText}>{t('x_firm_vertical_calculate_deadlines')}</Text>}
            </TouchableOpacity>

            {deadlines.map((d: any) => {
              const daysUntil = Math.ceil((new Date(d.due).getTime() - Date.now()) / 86400000);
              const urgent    = daysUntil <= 7;
              const overdue   = daysUntil < 0;
              
return (
                <View key={d.rule_key} style={[s.dlRow, { borderLeftColor: prioColor(d.priority) }]}>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={s.dlLabel}>{d.label}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.dlDesc}>{d.description}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.dlDue, overdue && { color: colors.emergency }]}>{d.due}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[s.dlDays, urgent && !overdue && { color: colors.warn }, overdue && { color: colors.emergency }]}>
                      {overdue ? t('x_firm_vertical_d_overdue', { daysUntil: Math.abs(daysUntil) }) : `${daysUntil}d`}
                    </Text>
                  </View>
                </View>
              );
            })}
            {deadlines.length === 0 && !dlLoading && (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>{t('x_firm_vertical_enter_trigger_date_press', { selectedV: selectedV.replace(/_/g, ' ') })}</Text>
            )}
          </>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────────────────
const styles = (c: any) => StyleSheet.create({
  root:             { flex: 1, backgroundColor: c.background },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  scroll:           { padding: 16, paddingBottom: 60 },
  tabBar:           { flexDirection: 'row', backgroundColor: c.card, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle },
  tabBtn:           { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:        { borderBottomWidth: 2, borderBottomColor: c.gold },
  tabLabel:         { fontSize: TYPE.sm, fontFamily: FONT.medium, color: c.textMuted },
  tabLabelActive:   { color: c.gold },
  sectionTitle:     { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text, marginBottom: 6 },
  hint:             { fontSize: TYPE.sm, color: c.textMuted, lineHeight: 18, marginBottom: 16 },
  inputLabel:       { fontSize: TYPE.sm, color: c.textMuted, marginTop: 12, marginBottom: 4, fontFamily: FONT.medium },
  input:            { backgroundColor: c.card, color: c.text, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.regular, fontSize: TYPE.base, marginBottom: 8 },
  // Verticals
  vertCard:         { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 10 },
  vertCardSelected: { borderColor: c.gold, borderWidth: 1.5 },
  vertHeader:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vertEmoji:        { fontSize: 22, marginRight: 6 },
  vertLabel:        { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 2 },
  vertLabelSelected:{ color: c.gold },
  vertPitch:        { fontSize: TYPE.sm, color: c.textMuted, lineHeight: 16 },
  // Feature flags
  flagRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.borderSubtle },
  flagLabel:        { fontSize: TYPE.base, fontFamily: FONT.medium, color: c.text },
  flagDesc:         { fontSize: TYPE.sm, color: c.textMuted, marginTop: 2 },
  // Save button
  saveBtn:          { backgroundColor: c.gold, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 8 },
  saveBtnText:      { fontSize: TYPE.md, fontFamily: FONT.bold, color: c.navy },
  // Pricing
  tierCard:         { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, borderLeftWidth: 3, padding: 14, marginBottom: 12 },
  tierHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tierName:         { fontSize: TYPE.md, fontFamily: FONT.bold },
  tierPrice:        { fontSize: TYPE.xl, fontFamily: FONT.bold, color: c.text },
  tierPriceSub:     { fontSize: TYPE.sm, color: c.textMuted },
  tierDesc:         { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 10, lineHeight: 16 },
  tierStats:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierStat:         { fontSize: TYPE.xs, color: c.textMuted, backgroundColor: c.bgElevated, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  currentBadge:     { marginTop: 10, backgroundColor: c.legalBg, borderRadius: RADIUS.md, paddingVertical: 4, alignItems: 'center' },
  currentBadgeText: { fontSize: TYPE.xs, color: c.legal, fontFamily: FONT.semiBold },
  missionBox:       { marginTop: 24, backgroundColor: c.card, borderRadius: RADIUS.lg, padding: 16, borderWidth: 0.5, borderColor: c.borderSubtle },
  segRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  segBtn:           { borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, paddingHorizontal: 10, paddingVertical: 6 },
  segBtnActive:     { backgroundColor: c.gold, borderColor: c.gold },
  segLabel:         { fontSize: TYPE.xs, color: c.textMuted, fontFamily: FONT.medium },
  segLabelActive:   { color: c.navy },
  missionBtn:       { backgroundColor: COLORS.legal, borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  missionBtnText:   { fontSize: TYPE.base, fontFamily: FONT.bold, color: c.bg },
  // Sub tabs
  subTabRow:        { flexDirection: 'row', backgroundColor: c.bgElevated, borderRadius: RADIUS.md, padding: 4, marginBottom: 16 },
  subTab:           { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: RADIUS.md },
  subTabActive:     { backgroundColor: c.card },
  subTabLabel:      { fontSize: TYPE.xs, color: c.textMuted, fontFamily: FONT.medium },
  subTabLabelActive:{ color: c.text },
  formBox:          { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 16 },
  formTitle:        { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.gold, marginBottom: 10 },
  addBtn:           { backgroundColor: c.gold, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  addBtnText:       { fontSize: TYPE.base, fontFamily: FONT.bold, color: c.navy },
  empty:            { textAlign: 'center', color: c.textMuted, fontSize: TYPE.base, marginTop: 32, paddingHorizontal: 24, lineHeight: 22 },
  // Asylum clock
  clockCard:        { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 10 },
  clockHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  clockName:        { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text },
  clockSub:         { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 10 },
  progressTrack:    { height: 6, backgroundColor: c.bgElevated, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressFill:     { height: 6, borderRadius: 3 },
  clockFooter:      { flexDirection: 'row', justifyContent: 'space-between' },
  clockDays:        { fontSize: TYPE.sm, fontFamily: FONT.medium },
  clockPct:         { fontSize: TYPE.sm, color: c.textMuted },
  detBadge:         { backgroundColor: COLORS.errorBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  detBadgeText:     { fontSize: TYPE.xs, color: COLORS.emergency, fontFamily: FONT.semiBold },
  // DPA tracker
  dpaCard:          { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 10 },
  dpaName:          { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text, marginBottom: 2 },
  dpaSub:           { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 10 },
  dpaRow:           { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dpaMetric:        { flex: 1, backgroundColor: c.bgElevated, borderRadius: RADIUS.md, padding: 8, alignItems: 'center' },
  dpaMetricLabel:   { fontSize: TYPE.xs, color: c.textMuted, marginBottom: 2 },
  dpaMetricVal:     { fontSize: TYPE.md, fontFamily: FONT.bold, color: c.text },
  coopLabel:        { fontSize: TYPE.xs, color: c.textMuted, fontFamily: FONT.medium },
  // TRO tracker
  troCard:          { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: c.borderSubtle, padding: 14, marginBottom: 10 },
  troHeader:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  troName:          { fontSize: TYPE.md, fontFamily: FONT.semiBold, color: c.text, flex: 1 },
  troDue:           { fontSize: TYPE.sm, color: c.textMuted, marginBottom: 4 },
  troAsset:         { fontSize: TYPE.xs, color: c.textMuted },
  dvBadge:          { backgroundColor: COLORS.errorBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  dvBadgeText:      { fontSize: TYPE.xs, color: COLORS.emergency, fontFamily: FONT.semiBold },
  grantedBadge:     { backgroundColor: COLORS.legalBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  grantedBadgeText: { fontSize: TYPE.xs, color: COLORS.legal, fontFamily: FONT.semiBold },
  // Deadlines
  dlRow:            { backgroundColor: c.card, borderRadius: RADIUS.md, borderLeftWidth: 3, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  dlLabel:          { fontSize: TYPE.base, fontFamily: FONT.semiBold, color: c.text, marginBottom: 2 },
  dlDesc:           { fontSize: TYPE.xs, color: c.textMuted },
  dlDue:            { fontSize: TYPE.sm, fontFamily: FONT.semiBold, color: c.text, marginBottom: 2 },
  dlDays:           { fontSize: TYPE.xs, color: c.textMuted, textAlign: 'right' },
  graceBanner:      { backgroundColor: c.warnBg, borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: c.warn },
  graceBannerTitle: { fontSize: 16, fontWeight: '700', color: c.warn, marginBottom: 4 },
  graceBannerBody:  { fontSize: 14, color: c.textSecond, lineHeight: 20 },
});
export default React.memo(FirmVerticalScreen);