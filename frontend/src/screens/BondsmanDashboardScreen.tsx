/**
 * BondsmanDashboardScreen — the bail agent's workspace.
 *
 *   Leads     recent arrests with bail set and no attorney (GET /billing/leads): initials,
 *             county, bail and charges only. "Buy" pays the flat lead fee (services/purchase.ts:
 *             payment sheet / Stripe Checkout, then POST /billing/leads/:id/confirm, which the
 *             server checks with Stripe) and reveals the full record — to this agent only.
 *   My leads  records the agent bought (GET /api/bondsman/leads) with a status and notes.
 *   Clients   the agent's check-in clients (CheckInManager).
 *   Profile   company, license, the states and counties the agent works in.
 * The counts at the top are real counts from GET /api/bondsman/dashboard (no estimates).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { SampleRecordBadge } from '../components/SampleRecordBadge';
import { StatePicker } from '../components/StatePicker';
import { ScreenCapture } from '../utils/webCompat';
import { useConfirm } from '../hooks/useConfirm';
import { usePurchase, takePendingCheckout } from '../services/purchase';
import { usd } from '../services/plans';
import { leadFeeLabel } from '../constants/leadFee';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { stateName } from '../utils/userState';
import { IconLabel, ICONS } from '../components/AppIcon';

type Tab = 'leads' | 'mine' | 'clients' | 'profile';
type Lead = { id: number; name: string; booking_date: string | null; charges: string | null; bail_amount: number; county: string | null; state: string | null; purchased: boolean; is_sample?: boolean; lead_fee_cents: number; lead_fee_display: string };
type MyLead = { id: number; arrest_id: number; name: string; charges: string | null; bail_amount: number; county: string | null; state: string | null; jail_location: string | null; case_number: string | null; court_date: string | null; booking_date: string | null; crm_status: CrmStatus; crm_notes: string | null; created_at: string; lead_fee_cents: number };
type CrmStatus = 'new' | 'contacted' | 'bonded' | 'closed';
type Dash = { leads_open_48h: number; leads_bought_30d: number; spent_30d_cents: number; leads_bought: number; clients_active: number; clients_total: number; pipeline: Record<CrmStatus, number> };
type Profile = { company_name: string; license_number: string | null; license_state: string | null; states: string[]; counties: string[]; alert_counties: string[] | 'all' };
const STATUSES: CrmStatus[] = ['new', 'contacted', 'bonded', 'closed'];
const HOURS = [24, 48, 72, 168];
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const money = (n: number) => `$${Math.round(n).toLocaleString(locale())}`;

function BondsmanDashboardScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const { hasSession, recheck } = useHasSession();
  const purchase = usePurchase();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const [tab, setTab] = useState<Tab>('leads');
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [notAgent, setNotAgent] = useState(false);
  const [dash, setDash] = useState<Dash | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [feeds, setFeeds] = useState(true);
  const [hours, setHours] = useState(48);
  const [mine, setMine] = useState<MyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [buying, setBuying] = useState<number | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const r = await api.get('/billing/bondsman/profile');
      if (!mounted.current) return null;
      const p = (r.data?.profile ?? null) as Profile | null;
      setProfile(p);
      if (!p) setTab('profile');
      return p;
    } catch { if (mounted.current) setProfile(null); return null; }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, l, m] = await Promise.all([
        api.get('/bondsman/dashboard'),
        api.get('/billing/leads', { params: { hours } }),
        api.get('/bondsman/leads'),
      ]);
      if (!mounted.current) return;
      setDash(d.data as Dash);
      setLeads((l.data?.leads || []) as Lead[]);
      setFeeds(l.data?.feeds_configured !== false);
      setMine((m.data?.leads || []) as MyLead[]);
    } catch (e) {
      if (mounted.current) setNotice({ text: apiErrorMessage(e, t('bd_load_error')), tone: 'error' });
    } finally { if (mounted.current) { setLoading(false); setRefreshing(false); } }
  }, [hours]);

  useFocusEffect(useCallback(() => {
    if (!hasSession) return;
    loadProfile().then(p => { if (p) loadAll(); });
  }, [hasSession, loadProfile, loadAll]));

  const confirmLead = useCallback((arrestId: number) => async (ids: Record<string, string | undefined>) =>
    (await api.post(`/billing/leads/${arrestId}/confirm`, ids)).data as { fee_charged: string }, []);

  // Back from Stripe Checkout (web)
  const sessionId = (route?.params as { checkout_session_id?: string } | undefined)?.checkout_session_id;
  useEffect(() => {
    if (!sessionId || !hasSession) return;
    const pending = takePendingCheckout('bail_lead');
    const arrestId = Number(pending?.ctx?.arrestId);
    if (!arrestId) return;
    purchase.finish(confirmLead(arrestId), { checkout_session_id: sessionId }).then(r => {
      if (!mounted.current) return;
      if (r.status === 'done') { setNotice({ text: t('bd_bought', { fee: r.data.fee_charged }), tone: 'ok' }); setTab('mine'); loadAll(); }
      else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hasSession, confirmLead, loadAll]);

  const buy = (lead: Lead) => {
    confirm(t('bd_buy_title', { fee: leadFeeLabel(lead) }), t('bd_buy_body', { fee: leadFeeLabel(lead) }), { confirmLabel: t('bd_buy_cta', { fee: leadFeeLabel(lead) }) }).then(async ok => {
      if (!ok) return;
      setBuying(lead.id); setNotice(null);
      const r = await purchase.run({
        key: 'bail_lead', ctx: { arrestId: lead.id },
        start: async (ui) => (await api.post(`/billing/leads/${lead.id}/accept`, { ui, return_path: '/bondsman-dashboard' })).data,
        confirm: confirmLead(lead.id),
      });
      if (!mounted.current) return;
      setBuying(null);
      if (r.status === 'done') { setNotice({ text: t('bd_bought', { fee: r.data.fee_charged }), tone: 'ok' }); setTab('mine'); loadAll(); }
      else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    });
  };

  if (hasSession === false) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <SignInNeeded navigation={navigation} title={t('x_bondsman_dashboard_lead_dashboard')} body={t('bd_signin_body')} onSignedIn={recheck} />
      </View>
    );
  }
  if (hasSession === null || profile === undefined) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.textBrand} size="large" /></View>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'leads', label: t('bd_tab_leads') }, { key: 'mine', label: t('bd_tab_mine') },
    { key: 'clients', label: t('bd_tab_clients') }, { key: 'profile', label: t('bd_tab_profile') },
  ];

  return (
    <View testID="bondsman-dashboard-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{profile?.company_name || t('x_bondsman_dashboard_lead_dashboard')}</Text>
        {dash && (
          <View style={s.stats} testID="bd-stats">
            {[[dash.leads_open_48h, t('bd_stat_open')], [dash.leads_bought_30d, t('bd_stat_bought')], [usd(dash.spent_30d_cents), t('bd_stat_spent')], [dash.clients_active, t('bd_stat_clients')]].map(([v, l]) => (
              <View key={String(l)} style={s.stat}>
                <Text maxFontSizeMultiplier={1.2} style={s.statVal}>{String(v)}</Text>
                <Text maxFontSizeMultiplier={1.2} style={s.statLabel}>{String(l)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={s.tabs}>
        {tabs.map(x => (
          <TouchableOpacity key={x.key} accessibilityRole="tab" aria-selected={tab === x.key} accessibilityState={{ selected: tab === x.key }} testID={`bd-tab-${x.key}`}
            style={[s.tab, tab === x.key && { borderBottomColor: colors.navy }]} onPress={() => setTab(x.key)} disabled={!profile && x.key !== 'profile'}>
            <Text maxFontSizeMultiplier={1.2} style={[s.tabText, tab === x.key && { color: colors.textPrimary }, !profile && x.key !== 'profile' && { opacity: 0.4 }]}>{x.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); if (profile) loadAll(); else setRefreshing(false); }} />}>
        {!!notice && (
          <View testID="bd-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger, fontSize: 14, lineHeight: 20 }}>{notice.text}</Text>
          </View>
        )}
        {notAgent && (
          <View style={s.card} testID="bd-not-agent"><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bd_not_agent')}</Text></View>
        )}

        {tab === 'leads' && profile && (
          <>
            <View style={s.chips}>
              <Text maxFontSizeMultiplier={1.3} style={s.chipLabel}>{t('x_bondsman_dashboard_show_last')}</Text>
              {HOURS.map(h => (
                <TouchableOpacity key={h} accessibilityRole="radio" aria-checked={hours === h} accessibilityState={{ checked: hours === h }}
                  style={[s.chip, hours === h && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setHours(h)}>
                  <Text maxFontSizeMultiplier={1.2} style={[s.chipText, hours === h && { color: colors.textOnNavy }]}>{h < 168 ? t('bd_hours', { h }) : t('bd_week')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.hint}>{t('bd_leads_hint', { fee: leadFeeLabel(leads[0]) })}</Text>
            {loading && !leads.length && <ActivityIndicator style={{ marginTop: 20 }} color={colors.textBrand} />}
            {!loading && leads.length === 0 && (
              <View style={s.card} testID="bd-no-leads">
                <Text maxFontSizeMultiplier={1.4} style={s.line}>{feeds ? t('bd_no_leads', { state: profile.states[0] ? stateName(profile.states[0]) : '' }) : t('x_bondsman_dashboard_no_public_arrest_feeds')}</Text>
              </View>
            )}
            {leads.map(l => (
              <View key={l.id} style={s.card} testID="lead-card">
                <SampleRecordBadge row={l} />
                <View style={s.rowBetween}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text maxFontSizeMultiplier={1.4} style={s.title} testID="lead-defendant-name">{l.name}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={s.line}>{[l.county ? t('x_bondsman_dashboard_county', { county: l.county }) : '', l.state ? stateName(l.state) : ''].filter(Boolean).join(', ')}{l.booking_date ? ` · ${fmtDay(l.booking_date)}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text maxFontSizeMultiplier={1.3} style={s.bail}>{money(l.bail_amount)}</Text>
                    <Text maxFontSizeMultiplier={1.2} style={s.line}>{t('x_bondsman_dashboard_bail')}</Text>
                  </View>
                </View>
                {!!l.charges && <IconLabel icon={ICONS.clipboard} textStyle={s.line} maxFontSizeMultiplier={1.4} testID="lead-charge">{l.charges}</IconLabel>}
                {l.purchased ? (
                  <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={() => setTab('mine')}>
                    <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('bd_owned')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity accessibilityRole="button" testID={`buy-lead-${l.id}`} style={[s.primaryBtn, buying !== null && { opacity: 0.6 }]} disabled={buying !== null} onPress={() => buy(l)}>
                    {buying === l.id ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('bd_buy_cta', { fee: leadFeeLabel(l) })}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}

        {tab === 'mine' && profile && <MyLeads leads={mine} reload={loadAll} pipeline={dash?.pipeline} />}

        {tab === 'clients' && profile && (
          <View style={s.card} testID="bd-clients">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('bd_clients_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bd_clients_body', { active: dash?.clients_active ?? 0, total: dash?.clients_total ?? 0 })}</Text>
            <TouchableOpacity accessibilityRole="button" testID="bd-open-checkins" style={s.primaryBtn} onPress={() => navigation.navigate('CheckInManager' as never)}>
              <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('bd_open_checkins')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'profile' && (
          <ProfileForm profile={profile} onSaved={async () => { const p = await loadProfile(); if (p) { setNotice({ text: t('bd_profile_saved'), tone: 'ok' }); setTab('leads'); loadAll(); } }}
            onNotAgent={() => setNotAgent(true)} onPlans={() => navigation.navigate('Subscription' as never)} />
        )}
      </ScrollView>
    </View>
  );
}

function MyLeads({ leads, reload, pipeline }: { leads: MyLead[]; reload: () => void; pipeline?: Record<CrmStatus, number> }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [filter, setFilter] = useState<CrmStatus | null>(null);
  const shown = filter ? leads.filter(l => l.crm_status === filter) : leads;
  if (!leads.length) return <View style={s.card} testID="bd-no-mine"><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bd_no_mine')}</Text></View>;
  return (
    <>
      <View style={s.chips}>
        {STATUSES.map(st => (
          <TouchableOpacity key={st} accessibilityRole="radio" aria-checked={filter === st} accessibilityState={{ checked: filter === st }}
            style={[s.chip, filter === st && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setFilter(f => (f === st ? null : st))}>
            <Text maxFontSizeMultiplier={1.2} style={[s.chipText, filter === st && { color: colors.textOnNavy }]}>{t(`bd_status_${st}`)} ({pipeline?.[st] ?? 0})</Text>
          </TouchableOpacity>
        ))}
      </View>
      {shown.map(l => <MyLeadCard key={l.id} lead={l} onSaved={reload} />)}
    </>
  );
}

function MyLeadCard({ lead, onSaved }: { lead: MyLead; onSaved: () => void }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [notes, setNotes] = useState(lead.crm_notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const save = async (patch: { status?: CrmStatus; notes?: string }) => {
    setSaving(true); setErr('');
    try { await api.patch(`/bondsman/leads/${lead.id}`, patch); onSaved(); }
    catch (e) { setErr(apiErrorMessage(e, t('bd_save_error'))); }
    finally { setSaving(false); }
  };
  return (
    <View style={s.card} testID="my-lead">
      <View style={s.rowBetween}>
        <Text maxFontSizeMultiplier={1.4} style={[s.title, { flex: 1 }]}>{lead.name}</Text>
        <Text maxFontSizeMultiplier={1.3} style={s.bail}>{money(lead.bail_amount)}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={s.line}>{[lead.county ? t('x_bondsman_dashboard_county', { county: lead.county }) : '', lead.state ? stateName(lead.state) : ''].filter(Boolean).join(', ')}</Text>
      {!!lead.charges && <IconLabel icon={ICONS.clipboard} textStyle={s.line} maxFontSizeMultiplier={1.4}>{lead.charges}</IconLabel>}
      {!!lead.jail_location && <IconLabel icon={ICONS.courthouse} textStyle={s.line} maxFontSizeMultiplier={1.4}>{lead.jail_location}</IconLabel>}
      {!!lead.case_number && <IconLabel icon={ICONS.attach} textStyle={s.line} maxFontSizeMultiplier={1.4}>{t('x_bondsman_dashboard_case', { case_number: lead.case_number })}</IconLabel>}
      {!!lead.court_date && <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bd_court_date', { date: fmtDay(lead.court_date) })}</Text>}
      <Text maxFontSizeMultiplier={1.3} style={[s.line, { marginTop: 6 }]}>{t('bd_bought_on', { date: fmtDay(lead.created_at), fee: usd(lead.lead_fee_cents) })}</Text>
      <View style={s.chips}>
        {STATUSES.map(st => (
          <TouchableOpacity key={st} accessibilityRole="radio" aria-checked={lead.crm_status === st} accessibilityState={{ checked: lead.crm_status === st }} testID={`lead-status-${st}`}
            style={[s.chip, lead.crm_status === st && { backgroundColor: colors.legalDark, borderColor: colors.legalDark }]} disabled={saving} onPress={() => save({ status: st })}>
            <Text maxFontSizeMultiplier={1.2} style={[s.chipText, lead.crm_status === st && { color: colors.textOnNavy }]}>{t(`bd_status_${st}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={s.input} value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder={t('bd_notes')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('bd_notes')} />
      {notes !== (lead.crm_notes || '') && (
        <TouchableOpacity accessibilityRole="button" testID="lead-notes-save" style={s.ghostBtn} onPress={() => save({ notes })} disabled={saving}>
          <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('bd_save_notes')}</Text>
        </TouchableOpacity>
      )}
      {!!err && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger, marginTop: 6 }}>{err}</Text>}
    </View>
  );
}

function ProfileForm({ profile, onSaved, onNotAgent, onPlans }: { profile: Profile | null; onSaved: () => void; onNotAgent: () => void; onPlans: () => void }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [company, setCompany] = useState(profile?.company_name || '');
  const [license, setLicense] = useState(profile?.license_number || '');
  const [licenseState, setLicenseState] = useState(profile?.license_state || '');
  const [state, setState] = useState(profile?.states?.[0] || profile?.license_state || '');
  const [counties, setCounties] = useState((profile?.counties || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!company.trim()) { setErr(t('bd_company_required')); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/billing/bondsman/profile', {
        company_name: company.trim(), license_number: license.trim() || undefined, license_state: licenseState || undefined,
        states: state ? [state] : [], counties: counties.split(',').map(c => c.trim()).filter(Boolean),
      });
      onSaved();
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'bail_agent_account_required') onNotAgent();
      setErr(apiErrorMessage(e, t('bd_save_error')));
    } finally { setSaving(false); }
  };
  const alerts = profile?.alert_counties;
  return (
    <View style={s.card} testID="bd-profile">
      {!profile && <Text maxFontSizeMultiplier={1.4} style={[s.line, { marginBottom: 8 }]}>{t('bd_profile_first')}</Text>}
      <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('bd_company')}</Text>
      <TextInput testID="bd-company" style={s.field} value={company} onChangeText={setCompany} maxLength={200} accessibilityLabel={t('bd_company')} placeholderTextColor={colors.placeholder} />
      <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('bd_license')}</Text>
      <TextInput style={s.field} value={license} onChangeText={setLicense} maxLength={60} autoCapitalize="characters" accessibilityLabel={t('bd_license')} placeholderTextColor={colors.placeholder} />
      <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('bd_license_state')}</Text>
      <StatePicker value={licenseState} onChange={setLicenseState} remember={false} testID="bd-license-state" />
      <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('bd_work_state')}</Text>
      <StatePicker value={state} onChange={setState} remember={false} testID="bd-work-state" />
      <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('bd_counties')}</Text>
      <TextInput testID="bd-counties" style={s.field} value={counties} onChangeText={setCounties} maxLength={600} placeholder={t('bd_counties_ph')} accessibilityLabel={t('bd_counties')} placeholderTextColor={colors.placeholder} />
      <Text maxFontSizeMultiplier={1.3} style={s.hint}>
        {alerts === 'all' ? t('bd_alerts_all') : Array.isArray(alerts) && alerts.length ? t('bd_alerts_some', { counties: alerts.join(', ') }) : t('bd_alerts_none')}
      </Text>
      <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={onPlans}>
        <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('bd_see_plans')}</Text>
      </TouchableOpacity>
      {!!err && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger, marginTop: 8 }} testID="bd-profile-error">{err}</Text>}
      <TouchableOpacity accessibilityRole="button" testID="bd-profile-save" style={[s.primaryBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
        {saving ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('bd_save_profile')}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  heading: { fontSize: 20, ...FONTS.black, color: colors.textOnNavy },
  stats: { flexDirection: 'row', marginTop: 10, gap: 6 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: RADIUS.md, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  statVal: { fontSize: 17, ...FONTS.black, color: colors.textOnNavy },
  statLabel: { fontSize: 11, color: colors.textOnNavy, opacity: 0.85, textAlign: 'center', marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  tabText: { fontSize: 13, ...FONTS.bold, color: colors.textMuted, textAlign: 'center' },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 10, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 2 },
  hint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginHorizontal: 16, marginTop: 8 },
  bail: { fontSize: 16, ...FONTS.heavy, color: colors.textBrand },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 12, marginTop: 10, alignItems: 'center' },
  chipLabel: { fontSize: 13, color: colors.textSecond, marginRight: 2 },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bgCard },
  chipText: { fontSize: 13, ...FONTS.semi, color: colors.textSecond },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 10 },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  label: { fontSize: 13, ...FONTS.semi, color: colors.textSecond, marginTop: 10, marginBottom: 4 },
  field: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 10, minHeight: 44, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, padding: 10, minHeight: 56, marginTop: 10, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14, textAlignVertical: 'top' },
});

export default React.memo(BondsmanDashboardScreen);
