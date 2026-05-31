import UPLDisclaimer from '../components/UPLDisclaimer';
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
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, RefreshControl,
  Switch, Platform, KeyboardAvoidingView,
} from 'react-native';
import {  useTheme, RADIUS, FONT, TYPE, COLORS } from '../constants/theme';
import { api } from '../services/api';
import type {} from '../types/navigation';

declare var graceUntil: any;
declare var route: any;
declare var setGraceUntil: any;
declare var setRefreshing: any;
declare var setSelectedVsetSelectedV: any;
declare var setSubStatus: any;
declare var subscriptionStatus: any;
type Tab = 'setup' | 'pricing' | 'trackers' | 'deadlines';

// ─── Vertical metadata ────────────────────────────────────────────────────────
const VERTICALS: { key: string; label: string; emoji: string; pitch: string }[] = [
  { key: 'criminal_defense', label: 'Criminal Defense',   emoji: '⚖️',  pitch: 'Bail automation, expungement pipeline, speedy trial tracking.' },
  { key: 'civil_rights',     label: 'Civil Rights § 1983',emoji: '✊',  pitch: 'Class action management, SOL calendar, damages modeling.' },
  { key: 'white_collar',     label: 'White-Collar / Reg', emoji: '🏦',  pitch: 'DPA negotiation tracker, cooperation credit modeling, DOJ deadline stack.' },
  { key: 'family',           label: 'Family Law',         emoji: '👨‍👩‍👧',  pitch: 'Emergency TRO flow, QDRO specialist matching, asset-tier routing.' },
  { key: 'immigration',      label: 'Immigration',        emoji: '🛂',  pitch: 'Asylum clock surveillance, detained-client alerts, multi-language support.' },
  { key: 'personal_injury',  label: 'Personal Injury',    emoji: '🏥',  pitch: 'Expert witness matching, damages model, emergency intake flow.' },
  { key: 'public_defense',   label: 'Public Defense',     emoji: '🛡️',  pitch: 'Caseload dashboard, diversion tracker, expungement pipeline.' },
  { key: 'appellate',        label: 'Appellate / PCR',    emoji: '📜',  pitch: 'AEDPA deadline tracking, capital case flagging, reversal scoring.' },
  { key: 'military',         label: 'Military / UCMJ',    emoji: '🎖️',  pitch: 'UCMJ taxonomy, Article 32 deadlines, security clearance workflow.' },
  { key: 'juvenile',         label: 'Juvenile & Dependency', emoji: '👦', pitch: 'Juvenile expungement, transfer monitor, diversion offering.' },
  { key: 'general',          label: 'General Practice',   emoji: '📁',  pitch: 'Full platform access with no vertical-specific restrictions.' },
];

const PRICING_COLORS: Record<string, string> = {
  standard:   COLORS.blue,
  mission:    COLORS.legal,
  government: COLORS.navy,
  enterprise: COLORS.emergency,
};

// ─── Feature flag definitions per vertical ────────────────────────────────────
const FEATURE_FLAGS: Record<string, { key: string; label: string; desc: string }[]> = {
  criminal_defense: [
    { key: 'bail_calc_enabled', label: 'Bail calculator',      desc: 'Automated bail bracket and hearing deadline.' },
    { key: 'expunge_pipeline',  label: 'Expungement pipeline', desc: 'Auto-check eligibility for every closed matter.' },
  ],
  civil_rights: [
    { key: 'class_action_track', label: 'Class action tracker', desc: 'Certification status + aggregate damages.' },
    { key: 'sol_calendar',       label: 'SOL calendar',         desc: '2-year § 1983 deadline per matter.' },
  ],
  white_collar: [
    { key: 'dpa_tracker',       label: 'DPA tracker',           desc: 'Deferred prosecution negotiation + fine model.' },
    { key: 'coop_credit_model', label: 'Cooperation credit',    desc: 'Filip Factors discount calculator.' },
  ],
  family: [
    { key: 'tro_alerts',    label: 'TRO alerts',      desc: 'Emergency DV TRO — 3-business-day deadline fire.' },
    { key: 'qdro_matching', label: 'QDRO matching',   desc: 'Specialist attorney matching for pension division.' },
  ],
  immigration: [
    { key: 'asylum_clock',     label: 'Asylum clock',      desc: 'Per-client 1-year bar surveillance.' },
    { key: 'detention_alerts', label: 'Detention alerts',  desc: 'Detained client urgency escalation.' },
  ],
  personal_injury: [
    { key: 'expert_matching', label: 'Expert matching', desc: 'Domain-matched expert witness referral.' },
    { key: 'damages_model',   label: 'Damages model',   desc: 'Net damages calculator with plaintiff fault.' },
  ],
  public_defense: [
    { key: 'caseload_dashboard', label: 'Caseload dashboard', desc: 'Per-attorney active case count + burn metrics.' },
    { key: 'diversion_tracker',  label: 'Diversion tracker',  desc: 'Drug court, mental health, first-offender paths.' },
  ],
  appellate: [
    { key: 'aedpa_tracker', label: 'AEDPA tracker',  desc: '365-day habeas deadline per matter.' },
    { key: 'capital_flag',  label: 'Capital flagging', desc: 'Escalation workflow for death penalty matters.' },
  ],
  military: [
    { key: 'ucmj_taxonomy',      label: 'UCMJ taxonomy',       desc: 'Article-level charge classification.' },
    { key: 'clearance_workflow', label: 'Clearance workflow',   desc: 'Security clearance revocation tracking.' },
  ],
  juvenile: [
    { key: 'juvenile_expunge', label: 'Juvenile expungement', desc: 'Auto-eligibility check on closed delinquency matters.' },
    { key: 'transfer_monitor', label: 'Transfer monitor',     desc: 'Adult court transfer risk flag at age 16+.' },
  ],
  general: [],
};

// Date validation — module-level to avoid recreation per render
const ISO_DATE_RE_FV = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const isValidDateFV  = (s: string) => ISO_DATE_RE_FV.test(s);

export default function FirmVerticalScreen({ navigation }: any) {
  const { colors } = useTheme();
  const s = styles(colors);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  const [tab, setTab]               = useState<Tab>('setup');
  // Read initial tab from navigation params (e.g. FirmAcquisition sends { tab: 'pricing' })
  React.useEffect(() => {
    const initialTab = (route?.params as Record<string,string>)?.tab as Tab | undefined;
    if (initialTab && ['setup','pricing','tracker','dpa','asylum'].includes(initialTab)) {
      setTab(initialTab);
    }
  }, []);

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
  const [acStart, setACStart] = useState(new Date().toISOString().slice(0, 10));
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
  const [trigDate, setTrigDate]   = useState(new Date().toISOString().slice(0, 10));
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
            const flags = FEATURE_FLAGS[v] || [];
            flags.forEach(fl => { f[fl.key] = !!mineRes.data.config[fl.key]; });
            setFeatures(f);
          }
        }
      }
      if (pricingResult.status === 'fulfilled') {
        setTiers(pricingResult.value.data?.tiers || []);
      }
    } catch (e: any) {
      if (e?.response?.status !== 400) Alert.alert('Could not Load', 'Could not load firm configuration.');
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Load trackers ──────────────────────────────────────────────────────────
  const closeTracker = async (type: string, id: number, name: string) => {
    Alert.alert('Mark as Resolved',
      `Mark "${name}" as resolved? This will archive the tracker.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Mark Resolved', style: 'destructive', onPress: async () => {
         try { await api.patch(`/firm-verticals/${type}/${id}/resolve`, {}); loadTrackers(); }
         catch (e: any) { Alert.alert('Action Failed', e?.response?.data?.error || 'Could not resolve.'); }
       }}]);
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
    } catch { Alert.alert('Calculation Error', 'Could not compute deadlines.'); }
    finally { setDLLoading(false); }
  }, [firm, trigDate]);

  // Auto-fire deadline calculation when switching to deadlines tab or changing trigger date
  useEffect(() => { if (tab === 'deadlines') loadDeadlines(); }, [tab, trigDate, loadDeadlines]);

  // ── Save vertical config ───────────────────────────────────────────────────
  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload: any = { vertical: selectedV };
      Object.keys(features).forEach(k => { payload[k] = features[k]; });
      await api.put('/firm-verticals/mine', payload);
      Alert.alert('Saved', 'Vertical configuration updated.');
      loadAll();
    } catch { Alert.alert('Save Failed', 'Could not save configuration.'); }
    finally { setSaving(false); }
  };

  // ── Mission verify submit ──────────────────────────────────────────────────
  const submitMission = async () => {
    if (!missionEIN.trim() && !missionWeb.trim()) {
      Alert.alert('Required', 'Provide your EIN or organization website for verification.');
      return;
    }
    setSubMV(true);
    try {
      await api.post('/firm-verticals/mine/mission-verify', {
        org_type: missionOrg, ein: missionEIN.trim(), website: missionWeb.trim(),
      });
      Alert.alert('Submitted', 'Mission pricing request received. Review takes 1–3 business days.');
      setMissionEIN(''); setMissionWeb('');
    } catch (e: any) {
      Alert.alert('Submission Failed', e?.response?.data?.error || 'Could not submit request.');
    } finally { setSubMV(false); }
  };

  // ── Create asylum clock ────────────────────────────────────────────────────
  const createAC = async () => {
    if (creatingAC) return;
    if (!acName.trim()) { Alert.alert('Required', 'Client name is required.'); return; }
    if (!isValidDateFV(acStart)) { Alert.alert('Invalid date', 'Clock start date must be YYYY-MM-DD (e.g. 2024-06-01).'); return; }
    setCreatingAC(true);
    try {
      await api.post('/firm-verticals/asylum-clocks', {
        client_name: acName.trim(), clock_start: acStart,
        relief_type: acRelief, detained: acDetained,
        country_condition: acCountry || undefined,
        notes: acNotes.trim() || undefined,
      });
      setACName(''); setACStart(new Date().toISOString().slice(0, 10));
      setACDet(false); setACCountry(''); setACNotes('');
      loadTrackers();
    } catch (e: any) { Alert.alert('Action Failed', e?.response?.data?.error || 'Could not create clock.'); }
    finally { setCreatingAC(false); }
  };

  // ── Create DPA tracker ────────────────────────────────────────────────────
  const createDPA = async () => {
    if (creatingDPA) return;
    if (!dpaName.trim()) { Alert.alert('Required', 'Client name is required.'); return; }
    try {
      if (dpaWellsDue.trim() && !isValidDateFV(dpaWellsDue.trim())) { Alert.alert('Invalid date', 'Wells due must be YYYY-MM-DD.'); return; }
      if (dpaSubDue.trim() && !isValidDateFV(dpaSubDue.trim())) { Alert.alert('Invalid date', 'Subpoena due must be YYYY-MM-DD.'); return; }
      if (dpaSignDue.trim() && !isValidDateFV(dpaSignDue.trim())) { Alert.alert('Invalid date', 'DPA signing deadline must be YYYY-MM-DD.'); return; }
      const cleanedFine = dpaFineM.replace(/,/g, '').trim();  // strip commas (e.g. '1,000' → '1000')
      const parsedFine  = parseFloat(cleanedFine);
      if (cleanedFine && isNaN(parsedFine)) { Alert.alert('Invalid amount', 'Base fine must be a number (e.g. 12.5 for $12.5M).'); return; }
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
    } catch (e: any) { Alert.alert('Action Failed', e?.response?.data?.error || 'Could not create tracker.'); }
    finally { setCreatingDPA(false); }
  };

  // ── Create TRO tracker ────────────────────────────────────────────────────
  const createTRO = async () => {
    if (creatingTRO) return;
    if (!troName.trim()) { Alert.alert('Required', 'Client name is required.'); return; }
    try {
      setCreatingTRO(true);
      await api.post('/firm-verticals/tro', {
        client_name: troName.trim(), dv_flag: troDV, asset_tier: troAsset,
      });
      setTROName(''); setTRODV(false); setTROAsset('under_100k');
      loadTrackers();
    } catch (e: any) { Alert.alert('Action Failed', e?.response?.data?.error || 'Could not create TRO tracker.'); }
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
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 24, marginBottom: 12 }}>⚖️</Text>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 18, fontWeight: '700', color: colors?.primary ?? '#042C53', marginBottom: 8, textAlign: 'center' }}>
          Set Up Your Legal Vertical
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, color: colors?.textMuted ?? '#666', textAlign: 'center', marginBottom: 24 }}>
          Your firm hasn't configured a practice area yet. Contact your firm administrator to get started.
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
          <Text maxFontSizeMultiplier={1.4} style={s.graceBannerTitle}>
            {subscriptionStatus === 'grace' ? '⚠ Account Read-Only Mode' : '🔴 Subscription Inactive'}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={s.graceBannerBody}>
            {subscriptionStatus === 'grace' && graceUntil
              ? `You can view all data until ${graceUntil}. Renew to create or update matters.`
              : 'Your subscription is inactive. All data is preserved — renew to regain full access.'}
          </Text>
        </View>
      )}

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['setup','pricing','trackers','deadlines'] as Tab[]).map(t => (
          <TouchableOpacity
          accessibilityRole="button" key={t} style={[s.tabBtn, tab===t && s.tabActive]} onPress={() => setTab(t)}
            accessibilityLabel='Switch tab'
          >
            <Text maxFontSizeMultiplier={1.4} style={[s.tabLabel, tab===t && s.tabLabelActive]}>
              {t === 'setup' ? '⚙️ Setup' : t === 'pricing' ? '💳 Pricing' : t === 'trackers' ? '🔍 Trackers' : '📅 Deadlines'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() =>
      { setRefreshing(true); loadAll().catch(()=>{}).finally(() => setRefreshing(false)); }} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ──── SETUP TAB ──────────────────────────────────────────────────── */}
        {tab === 'setup' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Choose your practice vertical</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>This unlocks the correct feature set, deadline rules, and matcher weighting for your firm.</Text>

            {VERTICALS.map(v => (
              <TouchableOpacity accessibilityRole="button"
                key={v.key}
                style={[s.vertCard, selectedV === v.key && s.vertCardSelected]}
                onPress={() => {
                  setSelectedVsetSelectedV(v.key);
                  // Preserve existing flag values; only initialise new flags to false
                  const f: Record<string, boolean> = {};
                  (FEATURE_FLAGS[v.key] || []).forEach(fl => {
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

            {(FEATURE_FLAGS[selectedV] || []).length > 0 && (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { marginTop: 24 }]}>Feature flags — {VERTICALS.find(v => v.key === selectedV)?.label}</Text>
                {(FEATURE_FLAGS[selectedV] || []).map(fl => (
                  <View key={fl.key} style={s.flagRow}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>{fl.label}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.flagDesc}>{fl.desc}</Text>
                    </View>
                    <Switch accessibilityLabel="{fl.label}"
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
            accessibilityRole="button" accessibilityLabel="Save configuration">
              {saving
                ? <ActivityIndicator color={colors.navy} />
                : <Text maxFontSizeMultiplier={1.4} style={s.saveBtnText}>Save configuration</Text>
              }
            </TouchableOpacity>
          </>
        )}

        {/* ──── PRICING TAB ────────────────────────────────────────────────── */}
        {tab === 'pricing' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Pricing tiers</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>Choose the tier that matches your firm. Mission and Government pricing require verification.</Text>

            {tiers.map((t: any) => (
              <View key={t.tier_key} style={[s.tierCard, { borderLeftColor: PRICING_COLORS[t.tier_key] || colors.steel }]}>
                <View style={s.tierHeader}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.tierName, { color: PRICING_COLORS[t.tier_key] || colors.text }]}>{t.display_name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.tierPrice}>${((t.monthly_cents ?? 0) / 100).toFixed(0)}<Text maxFontSizeMultiplier={1.4} style={s.tierPriceSub}>/mo</Text></Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={s.tierDesc}>{t.description}</Text>
                <View style={s.tierStats}>
                  <Text maxFontSizeMultiplier={1.4} style={s.tierStat}>🪑 {t.seat_limit === 999 ? 'Unlimited' : t.seat_limit} seats</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.tierStat}>📁 {t.matter_limit >= 99999 ? 'Unlimited' : t.matter_limit} matters</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.tierStat}>🤖 {t.ai_calls_daily}/day AI calls</Text>
                </View>
                {firm?.pricing_tier === t.tier_key && (
                  <View style={s.currentBadge}><Text maxFontSizeMultiplier={1.4} style={s.currentBadgeText}>Current plan</Text></View>
                )}
              </View>
            ))}

            <View style={s.missionBox}>
              <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Apply for mission pricing</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.hint}>Nonprofit 501(c)(3), public defender offices, and legal aid organizations qualify for 75% off standard pricing.</Text>

              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Organization type</Text>
              <View style={s.segRow}>
                {['nonprofit','public_defender','government','legal_aid'].map(ot => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    key={ot}
                    style={[s.segBtn, missionOrg === ot && s.segBtnActive]}
                    onPress={() => setMissionOrg(ot)}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, missionOrg === ot && s.segLabelActive]}>
                      {ot === 'nonprofit' ? 'Nonprofit' : ot === 'public_defender' ? 'Public Def.' : ot === 'government' ? 'Government' : 'Legal Aid'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>EIN / Tax ID</Text>
              <TextInput
                style={s.input}
                value={missionEIN}
                onChangeText={setMissionEIN}
                placeholder="12-3456789"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
              />
              <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Organization website</Text>
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
            accessibilityRole="button" accessibilityLabel="Submit verification request">
                {submittingMV
                  ? <ActivityIndicator color="#fff" />
                  : <Text maxFontSizeMultiplier={1.4} style={s.missionBtnText}>Submit verification request</Text>
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
                        >
                  <Text maxFontSizeMultiplier={1.4} style={[s.subTabLabel, trackerTab===tt && s.subTabLabelActive]}>
                    {tt === 'asylum' ? '🕐 Asylum Clock' : tt === 'dpa' ? '💰 DPA Tracker' : '🚨 TRO Tracker'}
                  </Text>
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
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>Track the 1-year asylum filing deadline for each client. Clients who pass 365 days without filing may be barred from asylum relief.</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>Add asylum clock</Text>
                      <TextInput style={s.input} value={acName} onChangeText={setACName} placeholder="Client name" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Clock start date (when asylum application filed)</Text>
                      <TextInput style={s.input} value={acStart} onChangeText={setACStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Relief type</Text>
                      <View style={s.segRow}>
                        {[
        'asylum', 'cancellation', 'DACA', 'VAWA', 'U_visa',
        'withholding', 'CAT', 'adjustment', 'citizenship', 'humanitarian', 'TPS', 'SIJ',
      ].map(rt => (
                          <TouchableOpacity
          accessibilityRole="button" key={rt} style={[s.segBtn, acRelief===rt && s.segBtnActive]} accessibilityLabel="{rt}" onPress={() => setACRelief(rt)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, acRelief===rt && s.segLabelActive]}>{rt}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={s.flagRow}>
                        <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>Client is detained</Text>
                        <Switch accessibilityLabel="Client is detained" value={acDetained} onValueChange={setACDet} trackColor={{ false: colors.borderSubtle, true: colors.emergency }} thumbColor={colors.card} />
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Country conditions (optional)</Text>
                      <View style={s.segRow}>
                        {(['crisis','deteriorating','stable'] as const).map(cc => (
                          <TouchableOpacity
          accessibilityRole="button" key={cc} style={[s.segBtn, acCountry===cc && s.segBtnActive]} onPress={() => setACCountry(acCountry===cc ? '' : cc)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, acCountry===cc && s.segLabelActive]}>
                              {cc==='crisis'?'🔴 Crisis':cc==='deteriorating'?'🟡 Deteriorating':'🟢 Stable'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput style={[s.input,{minHeight:56}]} value={acNotes} onChangeText={setACNotes} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} multiline
              maxLength={2000} />
                      <TouchableOpacity style={[s.addBtn, creatingAC && { opacity: 0.6 }]} onPress={createAC} disabled={creatingAC}
            accessibilityRole="button" accessibilityLabel="{creatingAC ? 'Adding\u2026' : 'Add clock'}"><Text maxFontSizeMultiplier={1.4} style={s.addBtnText}>{creatingAC ? 'Adding…' : 'Add clock'}</Text></TouchableOpacity>
                    </View>

                    {asylumClocks.map((c: any) => {
                      const pct = Math.min(100, Math.round((c.elapsed_days / 365) * 100));
                      const barColor = c.one_year_barred ? colors.emergency : c.elapsed_days > 300 ? colors.warn : colors.legal;
                      return (
                        <View key={c.id} style={s.clockCard}>
                          <View style={s.clockHeader}>
                            <Text maxFontSizeMultiplier={1.4} style={s.clockName}>{c.client_name}</Text>
                            {c.detained && <View style={s.detBadge}><Text maxFontSizeMultiplier={1.4} style={s.detBadgeText}>Detained</Text></View>}
                          </View>
                          <Text maxFontSizeMultiplier={1.4} style={s.clockSub}>{c.relief_type} · started {c.clock_start}</Text>
                          <View style={s.progressTrack}>
                            <View style={[s.progressFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
                          </View>
                          <View style={s.clockFooter}>
                            <Text maxFontSizeMultiplier={1.4} style={[s.clockDays, { color: barColor }]}>
                              {c.one_year_barred
                              ? '⚠️ 1-YEAR BAR EXCEEDED — verify with attorney'
                              : c.approaching_bar
                                ? `🟡 APPROACHING BAR — ${c.days_until_bar} days remaining`
                                : `${c.elapsed_days} days elapsed · ${c.days_until_bar} days until bar`}
                            </Text>
                            <Text maxFontSizeMultiplier={1.4} style={s.clockPct}>{pct}%</Text>
                          </View>
                        </View>
                      );
                    })}
                    {asylumClocks.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.empty}>No asylum clocks yet. Add one above.</Text>}
                  </>
                )}

                {/* DPA TRACKER */}
                {trackerTab === 'dpa' && (
                  <>
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>Model fine reductions through DOJ/SEC cooperation credit and deferred prosecution agreements.</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>Add DPA tracker</Text>
                      <TextInput style={s.input} value={dpaName} onChangeText={setDPAName} placeholder="Client / entity name" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaAgency} onChangeText={setDPAAgency} placeholder="Agency (DOJ / SEC / FinCEN...)" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaFineM} onChangeText={setDPAFineM} placeholder="Base fine ($M, e.g. 12.5)" placeholderTextColor={colors.textMuted} keyboardType="numeric"  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaWellsDue} onChangeText={setDPAWellsDue} placeholder="Wells notice due (YYYY-MM-DD, optional)" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaSubDue} onChangeText={setDPASubDue} placeholder="Subpoena response due (YYYY-MM-DD, optional)" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <TextInput style={s.input} value={dpaSignDue} onChangeText={setDPASignDue} placeholder="DPA signing deadline (YYYY-MM-DD, optional)" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Cooperation level</Text>
                      <View style={s.segRow}>
                        {['full_cooperation','limited_cooperation','proffer_agreement','no_cooperation'].map(cl => (
                          <TouchableOpacity
          accessibilityRole="button" key={cl} style={[s.segBtn, dpaCoop===cl && s.segBtnActive]} onPress={() => setDPACoop(cl)}
                                  >
                            <Text maxFontSizeMultiplier={1.4} style={[s.segLabel, dpaCoop===cl && s.segLabelActive]}>
                              {cl === 'full_cooperation' ? 'Full' : cl === 'limited_cooperation' ? 'Limited' : cl === 'proffer_agreement' ? 'Proffer' : 'None'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity style={[s.addBtn, creatingDPA && { opacity: 0.6 }]} onPress={createDPA} disabled={creatingDPA}
            accessibilityRole="button"><Text maxFontSizeMultiplier={1.4} style={s.addBtnText}>{creatingDPA ? 'Adding…' : 'Add tracker'}</Text></TouchableOpacity>
                    </View>

                    {dpaList.map((d: any) => {
                      const base = (d.base_fine_cents ?? 0) / 100;
                      const eff  = (d.effective_fine_cents ?? 0) / 100;
                      const saved = base > 0 ? Math.round((1 - eff / base) * 100) : 0;
                      return (
                        <View key={d.id} style={s.dpaCard}>
                          <Text maxFontSizeMultiplier={1.4} style={s.dpaName}>{d.client_name}</Text>
                          <Text maxFontSizeMultiplier={1.4} style={s.dpaSub}>{d.agency || 'Agency TBD'} · {d.dpa_status}</Text>
                          <View style={s.dpaRow}>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>Base fine</Text>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricVal}>${(base/1000000).toFixed(1)}M</Text>
                            </View>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>Effective fine</Text>
                              <Text maxFontSizeMultiplier={1.4} style={[s.dpaMetricVal, { color: colors.legal }]}>${(eff/1000000).toFixed(1)}M</Text>
                            </View>
                            <View style={s.dpaMetric}>
                              <Text maxFontSizeMultiplier={1.4} style={s.dpaMetricLabel}>Saved</Text>
                              <Text maxFontSizeMultiplier={1.4} style={[s.dpaMetricVal, { color: colors.gold }]}>{saved}%</Text>
                            </View>
                          </View>
                          <Text maxFontSizeMultiplier={1.4} style={s.coopLabel}>Cooperation: {d.cooperation_level.replace(/_/g, ' ')}</Text>
                          <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() => closeTracker('dpa', d.id, d.client_name)}
                            style={{ alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 10,
                              backgroundColor: COLORS.infoBg, borderRadius: 6, marginTop: 8 }}
                          >
                            <Text style={{ fontSize: 12, color: COLORS.navy }}>✓ Mark Resolved</Text>
                          </TouchableOpacity>
                          {d.wells_due && (
                            <Text maxFontSizeMultiplier={1.4} style={[s.troDue, d.wells_overdue && { color: colors.emergency }]}>
                              📋 Wells: {d.wells_overdue
                                ? `OVERDUE by ${Math.abs(d.days_until_wells)}d`
                                : `${d.days_until_wells}d remaining (${d.wells_due})`}
                            </Text>
                          )}
                          {d.subpoena_due && (
                            <Text maxFontSizeMultiplier={1.4} style={[s.troDue, d.subpoena_overdue && { color: colors.emergency }]}>
                              📎 Subpoena: {d.subpoena_overdue
                                ? `OVERDUE by ${Math.abs(d.days_until_subpoena)}d`
                                : `${d.days_until_subpoena}d remaining (${d.subpoena_due})`}
                            </Text>
                          )}
                          {d.dpa_sign_due && (
                            <Text maxFontSizeMultiplier={1.4} style={[s.troDue, d.sign_overdue && { color: colors.emergency }]}>
                              ✍️ Sign: {d.sign_overdue
                                ? `OVERDUE by ${Math.abs(d.days_until_sign)}d`
                                : `${d.days_until_sign}d remaining (${d.dpa_sign_due})`}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                    {dpaList.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.empty}>No DPA trackers yet.</Text>}
                  </>
                )}

                {/* TRO TRACKER */}
                {trackerTab === 'tro' && (
                  <>
                    <Text maxFontSizeMultiplier={1.4} style={s.hint}>Emergency TRO tracking for domestic violence matters. Filing triggers a 3-business-day hearing deadline.</Text>

                    <View style={s.formBox}>
                      <Text maxFontSizeMultiplier={1.4} style={s.formTitle}>Add TRO tracker</Text>
                      <TextInput style={s.input} value={troName} onChangeText={setTROName} placeholder="Client name" placeholderTextColor={colors.textMuted}  returnKeyType="next" />
                      <View style={s.flagRow}>
                        <Text maxFontSizeMultiplier={1.4} style={s.flagLabel}>Domestic violence flag</Text>
                        <Switch accessibilityLabel="Add TRO tracker" value={troDV} onValueChange={setTRODV} trackColor={{ false: colors.borderSubtle, true: colors.emergency }} thumbColor={colors.card} />
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Asset tier</Text>
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
                        <Text maxFontSizeMultiplier={1.4} style={s.addBtnText}>{troDV ? '🚨 File emergency TRO' : 'Add TRO tracker'}</Text>
                      </TouchableOpacity>
                    </View>

                    {troList.map((t: any) => (
                      <View key={t.id} style={s.troCard}>
                        <View style={s.troHeader}>
                          <Text maxFontSizeMultiplier={1.4} style={s.troName}>{t.client_name}</Text>
                          {t.dv_flag ? <View style={s.dvBadge}><Text maxFontSizeMultiplier={1.4} style={s.dvBadgeText}>DV</Text></View> : null}
                          {t.tro_granted ? <View style={s.grantedBadge}><Text maxFontSizeMultiplier={1.4} style={s.grantedBadgeText}>Granted</Text></View> : null}
                        </View>
                        {t.tro_hearing_due && (
                          <Text maxFontSizeMultiplier={1.4} style={[
                            s.troDue,
                            t.hearing_overdue && { color: colors.emergency }
                          ]}>
                            ⏰ {t.hearing_overdue
                              ? `Hearing OVERDUE by ${Math.abs(t.days_until_hearing)} day${Math.abs(t.days_until_hearing) === 1 ? '' : 's'}`
                              : t.days_until_hearing !== null
                                ? `Hearing in ${t.days_until_hearing} day${t.days_until_hearing === 1 ? '' : 's'} (${t.tro_hearing_due})`
                                : `Hearing due: ${t.tro_hearing_due}`
                            }
                          </Text>
                        )}
                        {t.protective_order_due && (
                          <Text maxFontSizeMultiplier={1.4} style={[s.troDue, t.po_overdue && { color: colors.emergency }]}>
                            📋 PO: {t.po_overdue
                              ? `OVERDUE by ${Math.abs(t.days_until_po)}d`
                              : t.days_until_po !== null
                                ? `${t.days_until_po}d remaining (${t.protective_order_due})`
                                : t.protective_order_due}
                          </Text>
                        )}
                        <Text maxFontSizeMultiplier={1.4} style={s.troAsset}>Asset tier: {t.asset_tier.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                    {troList.length === 0 && <Text maxFontSizeMultiplier={1.4} style={s.empty}>No TRO trackers yet.</Text>}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ──── DEADLINES TAB ──────────────────────────────────────────────── */}
        {tab === 'deadlines' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.sectionTitle}>Vertical deadline calculator</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>Enter a trigger date (arrest, filing, or notice date) to compute all deadlines for your vertical.</Text>

            <Text maxFontSizeMultiplier={1.4} style={s.inputLabel}>Trigger date</Text>
            <TextInput
              style={s.input}
              value={trigDate}
              onChangeText={setTrigDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted} returnKeyType="next" />
            <TouchableOpacity style={s.saveBtn} onPress={loadDeadlines} disabled={dlLoading}
            accessibilityRole="button" accessibilityLabel="Calculate deadlines">
              {dlLoading ? <ActivityIndicator color={colors.navy} /> : <Text maxFontSizeMultiplier={1.4} style={s.saveBtnText}>Calculate deadlines</Text>}
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
                      {overdue ? `${Math.abs(daysUntil)}d overdue` : `${daysUntil}d`}
                    </Text>
                  </View>
                </View>
              );
            })}
            {deadlines.length === 0 && !dlLoading && (
              <Text maxFontSizeMultiplier={1.4} style={s.empty}>Enter a trigger date and press Calculate to see deadlines for the {selectedV.replace(/_/g, ' ')} vertical.</Text>
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
  missionBtnText:   { fontSize: TYPE.base, fontFamily: FONT.bold, color: '#fff' },
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
