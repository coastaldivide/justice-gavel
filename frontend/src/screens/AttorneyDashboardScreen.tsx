/**
 * AttorneyDashboardScreen — the attorney's workspace.
 *
 *   Overview   real counts (GET /attorney/profile → stats) and the tools: Inbox, Conflict check,
 *              Firm, Plans
 *   Cases      cases the attorney is counsel on (GET /attorney/cases)
 *   Leads      case leads people submitted (PI / civil rights / employment / ICE): type, severity,
 *              city and state only until bought; the flat fee per type is charged through
 *              services/purchase.ts and checked by the server (POST /billing/pi-lead/confirm/:id);
 *              bought leads show the description and the person's contact details
 *   Templates  office motion templates
 *   CLE        courses on record (none yet → said so)
 *   Profile    bar number for review (verification by an admin), office, weekly availability
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { StatePicker } from '../components/StatePicker';
import { ScreenCapture } from '../utils/webCompat';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { useStoredUser, isAttorneyUser } from '../hooks/useStoredUser';
import { usePurchase, takePendingCheckout } from '../services/purchase';
import { usd } from '../services/plans';
import { formatPhone, telUrl } from '../utils/contact';
import { stateName } from '../utils/userState';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

type Tab = 'overview' | 'cases' | 'leads' | 'templates' | 'cle' | 'profile';
type Stats = { active_cases: number; pending_assignments: number; hearings_this_week: number; unread_messages: number; motions_generated: number; cle_hours: number; upcoming_consultations: number | null; avg_rating: number | null; review_count: number | null };
type Profile = { name: string | null; bar_number: string | null; bar_state: string | null; bar_verified: boolean; pending_bar_verification: boolean; bar_rejection_reason: string | null; office_id: number | null; office_name: string | null; listing: { id: number; name: string } | null; plan: { tier: string; status: string } | null; stats: Stats };
type CaseRow = { id: number; title: string | null; status: string | null; state: string | null; client_name: string | null; next_hearing_date: string | null; unread_count: number; assignment_notes: string | null };
type OpenLead = { id: number; case_type: string; severity: string | null; city: string | null; state: string | null; lead_fee_cents: number; lead_fee_display: string; created_at: string };
type MyLead = { id: number; case_type: string; severity: string | null; city: string | null; state: string | null; description: string; incident_date: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; lead_fee_cents: number; accepted_at: string };
type Template = { id: number; motion_type: string; title: string; status: string; created_by_name: string | null; notes: string | null };
type Course = { id: number; title: string; credit_hours: number; completed_at: string | null; description: string | null };

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const LEAD_TYPE_KEYS: Record<string, string> = { personal_injury: 'lead_type_personal_injury', medical: 'lead_type_medical', civil_rights: 'lead_type_civil_rights', employment: 'lead_type_employment', ice_detention: 'lead_type_ice_detention' };
const SEVERITY_KEYS: Record<string, string> = { minor: 'x_pilead_minor', moderate: 'x_pilead_moderate', serious: 'x_pilead_serious', catastrophic: 'x_pilead_catastrophic' };
const STATUS_KEYS: Record<string, string> = { open: 'case_status_open', active: 'case_status_active', pending: 'case_status_pending', closed: 'case_status_closed', dismissed: 'case_status_dismissed' };
const leadType = (k: string) => (LEAD_TYPE_KEYS[k] ? t(LEAD_TYPE_KEYS[k]) : k);
const caseStatus = (st: string | null) => (st && STATUS_KEYS[st.toLowerCase()] ? t(STATUS_KEYS[st.toLowerCase()]) : st || '');

function AttorneyDashboardScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { hasSession, recheck } = useHasSession();
  const { user, ready } = useStoredUser();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);
  const params = route?.params as { tab?: Tab; checkout_session_id?: string } | undefined;
  // Back from Stripe Checkout for a case lead (the only Checkout started here).
  const [tab, setTab] = useState<Tab>(params?.checkout_session_id ? 'leads' : params?.tab || 'overview');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const r = await api.get<Profile>('/attorney/profile');
      if (mounted.current) { setProfile(r.data); setError(''); }
    } catch (e) {
      if (mounted.current) setError(apiErrorMessage(e, t('ad_load_error')));
    } finally { if (mounted.current) setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (hasSession && isAttorneyUser(user)) loadProfile(); }, [hasSession, user, loadProfile]));

  if (hasSession === false) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }}><SignInNeeded navigation={navigation} title={t('atty_title')} body={t('ad_signin_body')} onSignedIn={recheck} /></View>;
  }
  if (hasSession === null || !ready) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  if (!isAttorneyUser(user)) {
    return (
      <View testID="attorney-dashboard-not-attorney" style={[s.center, { backgroundColor: colors.bg, padding: 24 }]}>
        <Text maxFontSizeMultiplier={1.4} style={[s.title, { textAlign: 'center' }]}>{t('ad_not_attorney')}</Text>
        <TouchableOpacity accessibilityRole="button" style={s.primaryBtn} onPress={() => navigation.navigate('HomeTab' as never)}>
          <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('ad_go_home')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: t('ad_tab_overview') }, { key: 'cases', label: t('nav_cases'), badge: profile?.stats.active_cases },
    { key: 'leads', label: t('ad_tab_leads') }, { key: 'templates', label: t('atty_tab_templates') },
    { key: 'cle', label: t('atty_tab_cle') }, { key: 'profile', label: t('atty_tab_profile') },
  ];

  return (
    <View testID="attorney-dashboard-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 4 }}>
        {tabs.map(x => (
          <TouchableOpacity key={x.key} accessibilityRole="tab" aria-selected={tab === x.key} accessibilityState={{ selected: tab === x.key }} testID={`ad-tab-${x.key}`}
            style={[s.tab, tab === x.key && { borderBottomColor: colors.navy }]} onPress={() => setTab(x.key)}>
            <Text maxFontSizeMultiplier={1.2} style={[s.tabText, tab === x.key && { color: colors.textPrimary }]}>{x.label}{x.badge ? ` (${x.badge})` : ''}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProfile(); }} />}>
        {!!error && <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{error}</Text></View>}
        {tab === 'overview' && <Overview profile={profile} navigation={navigation} />}
        {tab === 'cases' && <Cases navigation={navigation} />}
        {tab === 'leads' && <Leads profile={profile} route={route} />}
        {tab === 'templates' && <Templates navigation={navigation} />}
        {tab === 'cle' && <Cle />}
        {tab === 'profile' && profile && <ProfileTab profile={profile} onSaved={loadProfile} />}
      </ScrollView>
    </View>
  );
}

function Overview({ profile, navigation }: { profile: Profile | null; navigation: ScreenProps['navigation'] }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  if (!profile) return <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />;
  const st = profile.stats;
  const cells: [string, string][] = [
    [String(st.active_cases), t('x_attorney_dashboard_active_cases')],
    [String(st.pending_assignments), t('ad_stat_invites')],
    [String(st.hearings_this_week), t('ad_stat_hearings')],
    [String(st.unread_messages), t('x_attorney_dashboard_unread_msgs')],
    [String(st.motions_generated), t('ad_stat_motions')],
    ...(st.upcoming_consultations != null ? [[String(st.upcoming_consultations), t('ad_stat_consults')] as [string, string]] : []),
    ...(st.review_count ? [[`${st.avg_rating}/5`, t('ad_stat_rating', { n: st.review_count })] as [string, string]] : []),
  ];
  const tools: { key: string; label: string; sub: string; go: () => void }[] = [
    { key: 'inbox', label: t('ad_tool_inbox'), sub: st.unread_messages ? t('ad_tool_inbox_unread', { n: st.unread_messages }) : t('ad_tool_inbox_sub'), go: () => navigation.navigate('AttorneyInbox' as never) },
    { key: 'conflicts', label: t('x_nav_conflict_check'), sub: t('ad_tool_conflicts_sub'), go: () => navigation.navigate('ConflictCheck' as never) },
    { key: 'firm', label: t('ad_tool_firm'), sub: t('ad_tool_firm_sub'), go: () => navigation.navigate('FirmAcquisition' as never) },
    { key: 'plans', label: t('ad_tool_plans'), sub: profile.plan ? t('ad_tool_plan_on', { plan: profile.plan.tier }) : t('ad_tool_plans_sub'), go: () => navigation.navigate('Subscription' as never) },
  ];
  return (
    <>
      <View style={s.card}>
        <Text maxFontSizeMultiplier={1.4} style={s.title}>{profile.name || t('atty_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.line, profile.bar_verified ? { color: colors.legal } : null]} testID="ad-bar-status">
          {profile.bar_verified ? t('ad_bar_verified', { bar: profile.bar_number || '', state: profile.bar_state ? stateName(profile.bar_state) : '' })
            : profile.pending_bar_verification ? t('ad_bar_pending', { bar: profile.bar_number || '' })
              : profile.bar_rejection_reason ? t('ad_bar_rejected', { reason: profile.bar_rejection_reason }) : t('ad_bar_none')}
        </Text>
        {profile.listing && <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_listing', { name: profile.listing.name })}</Text>}
      </View>
      <View style={s.grid} testID="ad-stats">
        {cells.map(([v, l]) => (
          <View key={l} style={s.cell}>
            <Text maxFontSizeMultiplier={1.2} style={s.cellVal}>{v}</Text>
            <Text maxFontSizeMultiplier={1.2} style={s.cellLabel}>{l}</Text>
          </View>
        ))}
      </View>
      {tools.map(x => (
        <TouchableOpacity key={x.key} accessibilityRole="button" testID={`ad-tool-${x.key}`} style={s.card} onPress={x.go}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{x.label} ›</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{x.sub}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

function Cases({ navigation }: { navigation: ScreenProps['navigation'] }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get('/attorney/cases').then(r => setRows((r.data?.cases || []) as CaseRow[])).catch(e => setErr(apiErrorMessage(e, t('ad_load_error'))));
  }, []);
  if (err) return <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{err}</Text></View>;
  if (!rows) return <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />;
  if (!rows.length) return <View style={s.card} testID="ad-no-cases"><Text maxFontSizeMultiplier={1.4} style={s.title}>{t('x_attorney_dashboard_no_assigned_cases')}</Text><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_no_cases_body')}</Text></View>;
  return (
    <>
      {rows.map(c => (
        <View key={c.id} style={s.card} testID="ad-case">
          <Text maxFontSizeMultiplier={1.4} style={s.title} numberOfLines={2}>{c.title || t('x_attorney_dashboard_case', { id: c.id })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{[c.client_name, caseStatus(c.status), c.state ? stateName(c.state) : ''].filter(Boolean).join(' · ')}</Text>
          {!!c.next_hearing_date && <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_next_hearing', { date: fmtDay(c.next_hearing_date) })}</Text>}
          <View style={s.rowWrap}>
            <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={() => navigation.navigate('Messages', { caseId: c.id, caseTitle: c.title || undefined })}>
              <IconLabel icon={ICONS.message} textStyle={s.ghostText} maxFontSizeMultiplier={1.4}>{c.unread_count ? t('ad_messages_unread', { n: c.unread_count }) : t('x_attorney_dashboard_message')}</IconLabel>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={() => navigation.navigate('MotionLibrary', { caseId: c.id })}>
              <IconLabel icon={ICONS.clipboard} textStyle={s.ghostText} maxFontSizeMultiplier={1.4}>{t('x_attorney_dashboard_motion')}</IconLabel>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </>
  );
}

function Leads({ profile, route }: { profile: Profile | null; route: ScreenProps['route'] }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const purchase = usePurchase();
  const [state, setState] = useState(profile?.bar_state || '');
  const [open, setOpen] = useState<OpenLead[] | null>(null);
  const [mine, setMine] = useState<MyLead[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([api.get('/billing/pi-leads', { params: state ? { state } : {} }), api.get('/billing/pi-leads/mine')]);
      setOpen(Array.isArray(o.data) ? (o.data as OpenLead[]) : []);
      setMine((m.data?.leads || []) as MyLead[]);
    } catch (e) { setOpen([]); setNotice({ text: apiErrorMessage(e, t('ad_load_error')), tone: 'error' }); }
  }, [state]);
  useEffect(() => { load(); }, [load]);

  const confirmLead = useCallback((id: number) => async (ids: Record<string, string | undefined>) => (await api.post(`/billing/pi-lead/confirm/${id}`, ids)).data, []);
  const sessionId = (route?.params as { checkout_session_id?: string } | undefined)?.checkout_session_id;
  useEffect(() => {
    if (!sessionId) return;
    const pending = takePendingCheckout('case_lead');
    const id = Number(pending?.ctx?.leadId);
    if (!id) return;
    purchase.finish(confirmLead(id), { checkout_session_id: sessionId }).then(r => {
      if (r.status === 'done') { setNotice({ text: t('ad_lead_bought'), tone: 'ok' }); load(); }
      else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, confirmLead, load]);

  const buy = (l: OpenLead) => confirm(t('ad_lead_buy_title', { fee: l.lead_fee_display }), t('ad_lead_buy_body', { fee: l.lead_fee_display }), { confirmLabel: t('ad_lead_buy_cta', { fee: l.lead_fee_display }) }).then(async ok => {
    if (!ok) return;
    setBusy(l.id); setNotice(null);
    const r = await purchase.run({
      key: 'case_lead', ctx: { leadId: l.id },
      start: async (ui) => (await api.post(`/billing/pi-lead/accept/${l.id}`, { ui, return_path: '/attorney-dashboard' })).data,
      confirm: confirmLead(l.id),
    });
    setBusy(null);
    if (r.status === 'done') { setNotice({ text: t('ad_lead_bought'), tone: 'ok' }); load(); }
    else {
      if (r.status === 'cancelled') api.post(`/billing/pi-lead/release/${l.id}`, {}).catch(() => {});
      if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    }
  });

  return (
    <>
      {!!notice && <View testID="ad-leads-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}><Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger }}>{notice.text}</Text></View>}
      {!profile?.bar_verified && <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_leads_verify_first')}</Text></View>}
      {mine.length > 0 && <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ad_leads_mine')}</Text>}
      {mine.map(l => (
        <View key={l.id} style={s.card} testID="ad-my-lead">
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{leadType(l.case_type)} · {[l.city, l.state ? stateName(l.state) : ''].filter(Boolean).join(', ')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{l.description}</Text>
          {!!l.contact_name && <IconLabel icon={ICONS.user} textStyle={[s.line, { marginTop: 6 }]}>{l.contact_name}</IconLabel>}
          {!!l.contact_phone && <TouchableOpacity accessibilityRole="link" style={s.contactLink} onPress={() => { const u = telUrl(l.contact_phone || ''); if (u) Linking.openURL(u).catch(() => {}); }}><IconLabel icon={ICONS.phone} textStyle={[s.line, { color: colors.info }]}>{formatPhone(l.contact_phone)}</IconLabel></TouchableOpacity>}
          {!!l.contact_email && <TouchableOpacity accessibilityRole="link" style={s.contactLink} onPress={() => Linking.openURL(`mailto:${l.contact_email}`).catch(() => {})}><IconLabel icon={ICONS.mail} textStyle={[s.line, { color: colors.info }]}>{l.contact_email}</IconLabel></TouchableOpacity>}
          <Text maxFontSizeMultiplier={1.3} style={s.line}>{t('ad_lead_bought_on', { date: fmtDay(l.accepted_at), fee: usd(l.lead_fee_cents) })}</Text>
        </View>
      ))}
      <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ad_leads_open')}</Text>
      <View style={{ marginHorizontal: 12, marginTop: 8 }}><StatePicker value={state} onChange={setState} allowAll remember={false} testID="ad-leads-state" /></View>
      <Text maxFontSizeMultiplier={1.3} style={s.hint}>{t('ad_leads_hint')}</Text>
      {open === null && <ActivityIndicator style={{ marginTop: 16 }} color={colors.textBrand} />}
      {open?.length === 0 && <View style={s.card} testID="ad-no-leads"><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_no_leads')}</Text></View>}
      {open?.map(l => (
        <View key={l.id} style={s.card} testID="ad-open-lead">
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{leadType(l.case_type)}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{[l.severity && SEVERITY_KEYS[l.severity] ? t(SEVERITY_KEYS[l.severity]) : '', l.city, l.state ? stateName(l.state) : ''].filter(Boolean).join(' · ')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={s.line}>{fmtDay(l.created_at)}</Text>
          <TouchableOpacity accessibilityRole="button" testID={`ad-buy-lead-${l.id}`} style={[s.primaryBtn, (busy !== null || !profile?.bar_verified) && { opacity: 0.5 }]} disabled={busy !== null || !profile?.bar_verified} onPress={() => buy(l)}>
            {busy === l.id ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('ad_lead_buy_cta', { fee: l.lead_fee_display })}</Text>}
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}

function Templates({ navigation }: { navigation: ScreenProps['navigation'] }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [filter, setFilter] = useState<'approved' | 'pending' | 'all'>('approved');
  const [rows, setRows] = useState<Template[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setRows(null);
    api.get('/attorney/templates', { params: { status: filter } }).then(r => setRows((r.data?.templates || []) as Template[])).catch(e => setErr(apiErrorMessage(e, t('ad_load_error'))));
  }, [filter]);
  return (
    <>
      <View style={s.rowWrap}>
        {(['approved', 'pending', 'all'] as const).map(f => (
          <TouchableOpacity key={f} accessibilityRole="radio" aria-checked={filter === f} accessibilityState={{ checked: filter === f }} style={[s.chip, filter === f && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setFilter(f)}>
            <Text maxFontSizeMultiplier={1.2} style={[s.chipText, filter === f && { color: colors.textOnNavy }]}>{t(`ad_tpl_${f}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!!err && <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{err}</Text></View>}
      {rows === null && !err && <ActivityIndicator style={{ marginTop: 16 }} color={colors.textBrand} />}
      {rows?.length === 0 && (
        <View style={s.card} testID="ad-no-templates">
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('x_attorney_dashboard_no_templates_yet')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('x_attorney_dashboard_generate_motion_motion_library')}</Text>
          <TouchableOpacity accessibilityRole="button" style={s.primaryBtn} onPress={() => navigation.navigate('MotionLibrary' as never)}>
            <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_attorney_dashboard_open_motion_library')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {rows?.map(x => (
        <View key={x.id} style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{x.title}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{[x.motion_type, x.created_by_name, t(`ad_tpl_${x.status === 'approved' || x.status === 'pending' ? x.status : 'all'}`)].filter(Boolean).join(' · ')}</Text>
          {!!x.notes && <Text maxFontSizeMultiplier={1.4} style={s.line} numberOfLines={3}>{x.notes}</Text>}
        </View>
      ))}
    </>
  );
}

function Cle() {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const [rows, setRows] = useState<Course[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => api.get('/attorney/cle').then(r => setRows((r.data?.courses || []) as Course[])).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const complete = async (id: number) => {
    setBusy(id);
    try { const r = await api.post(`/attorney/cle/${id}/complete`, {}); showToast(r.data?.message || t('ad_cle_logged'), 'info'); load(); }
    catch (e) { showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_complete_course')), 'error'); }
    finally { setBusy(null); }
  };
  if (rows === null) return <ActivityIndicator style={{ marginTop: 16 }} color={colors.textBrand} />;
  if (!rows.length) return <View style={s.card} testID="ad-no-cle"><Text maxFontSizeMultiplier={1.4} style={s.title}>{t('ad_cle_none')}</Text><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_cle_note')}</Text></View>;
  return (
    <>
      <Text maxFontSizeMultiplier={1.3} style={s.hint}>{t('ad_cle_note')}</Text>
      {rows.map(c => (
        <View key={c.id} style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{c.completed_at ? '✓ ' : ''}{c.title}</Text>
          {!!c.description && <Text maxFontSizeMultiplier={1.4} style={s.line}>{c.description}</Text>}
          {c.completed_at ? <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_cle_done', { date: fmtDay(c.completed_at) })}</Text> : (
            <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} disabled={busy === c.id} onPress={() => complete(c.id)}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('ad_cle_mark')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </>
  );
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const SLOTS = ['morning', 'afternoon', 'evening'] as const;

function ProfileTab({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const [bar, setBar] = useState(profile.bar_number || '');
  const [barState, setBarState] = useState(profile.bar_state || '');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [schedule, setSchedule] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [savingAvail, setSavingAvail] = useState(false);
  const [officeId, setOfficeId] = useState('');
  const [officeName, setOfficeName] = useState('');
  useEffect(() => {
    api.get('/attorney/profile/availability').then(r => { setSchedule(r.data?.schedule || {}); setNote(r.data?.note || ''); }).catch(() => {});
  }, []);
  const submitBar = async () => {
    setSending(true); setMsg(null);
    try { const r = await api.post('/attorney/verify-bar', { bar_number: bar, state: barState }); setMsg({ text: r.data?.message, tone: 'ok' }); onSaved(); }
    catch (e) { setMsg({ text: apiErrorMessage(e, t('x_attorney_dashboard_try_again')), tone: 'error' }); }
    finally { setSending(false); }
  };
  const toggle = (d: string, slot: string) => setSchedule(p => { const cur = p[d] || []; return { ...p, [d]: cur.includes(slot) ? cur.filter(x => x !== slot) : [...cur, slot] }; });
  const saveAvail = async () => {
    setSavingAvail(true);
    try { await api.put('/attorney/profile/availability', { schedule, note }); showToast(t('x_attorney_dashboard_saved'), 'success'); }
    catch (e) { showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_save_availability')), 'error'); }
    finally { setSavingAvail(false); }
  };
  const joinOffice = async () => {
    try { await api.post('/attorney/office/join', { office_id: officeId.trim(), office_name: officeName.trim() }); showToast(t('x_attorney_dashboard_profile_updated'), 'success'); onSaved(); }
    catch (e) { showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_save')), 'error'); }
  };
  const changed = bar.trim().toUpperCase() !== (profile.bar_number || '') || barState !== (profile.bar_state || '');
  return (
    <>
      <View style={s.card} testID="ad-bar">
        <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('ad_bar_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_bar_body')}</Text>
        <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('x_attorney_dashboard_bar_number')}</Text>
        <TextInput testID="ad-bar-number" style={s.field} value={bar} onChangeText={setBar} maxLength={20} autoCapitalize="characters" accessibilityLabel={t('x_attorney_dashboard_bar_number')} placeholderTextColor={colors.placeholder} />
        <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('ad_bar_state')}</Text>
        <StatePicker value={barState} onChange={setBarState} remember={false} testID="ad-bar-state" />
        {profile.bar_verified && changed && <Text maxFontSizeMultiplier={1.3} style={[s.hint, { marginHorizontal: 0 }]}>{t('ad_bar_change_warning')}</Text>}
        {!!msg && <Text maxFontSizeMultiplier={1.4} testID="ad-bar-msg" style={{ color: msg.tone === 'ok' ? colors.legalDark : colors.danger, marginTop: 8 }}>{msg.text}</Text>}
        <TouchableOpacity accessibilityRole="button" testID="ad-bar-submit" style={[s.primaryBtn, (sending || !bar.trim() || !barState) && { opacity: 0.5 }]} disabled={sending || !bar.trim() || !barState} onPress={submitBar}>
          {sending ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('ad_bar_submit')}</Text>}
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('x_attorney_dashboard_office_name')}</Text>
        {profile.office_name ? <Text maxFontSizeMultiplier={1.4} style={s.line}>{profile.office_name}</Text> : (
          <>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('ad_office_body')}</Text>
            <TextInput style={[s.field, { marginTop: 8 }]} value={officeId} onChangeText={setOfficeId} keyboardType="number-pad" maxLength={12} placeholder={t('ad_office_id')} accessibilityLabel={t('ad_office_id')} placeholderTextColor={colors.placeholder} />
            <TextInput style={[s.field, { marginTop: 8 }]} value={officeName} onChangeText={setOfficeName} maxLength={200} placeholder={t('x_attorney_dashboard_davidson_county_public_defender')} accessibilityLabel={t('x_attorney_dashboard_office_name_2')} placeholderTextColor={colors.placeholder} />
            <TouchableOpacity accessibilityRole="button" style={[s.ghostBtn, (!officeId.trim() || !officeName.trim()) && { opacity: 0.5 }]} disabled={!officeId.trim() || !officeName.trim()} onPress={joinOffice}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('ad_office_save')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={s.card} testID="ad-availability">
        <IconLabel icon={ICONS.calendar} textStyle={s.title} maxFontSizeMultiplier={1.4}>{t('x_attorney_dashboard_weekly_availability')}</IconLabel>
        {DAYS.map(d => (
          <View key={d} style={[s.rowWrap, { marginHorizontal: 0, alignItems: 'center' }]}>
            <Text maxFontSizeMultiplier={1.2} style={[s.line, { width: 44 }]}>{t(`x_attorney_dashboard_${d}`)}</Text>
            {SLOTS.map(slot => {
              const on = (schedule[d] || []).includes(slot);
              return (
                <TouchableOpacity key={slot} accessibilityRole="checkbox" aria-checked={on} accessibilityState={{ checked: on }} accessibilityLabel={`${t(`x_attorney_dashboard_${d}`)} ${t(`ad_slot_${slot}`)}`}
                  style={[s.chip, on && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => toggle(d, slot)}>
                  <Text maxFontSizeMultiplier={1.2} style={[s.chipText, on && { color: colors.textOnNavy }]}>{t(`ad_slot_${slot}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
        <TextInput style={[s.field, { marginTop: 10 }]} value={note} onChangeText={setNote} maxLength={200} placeholder={t('x_attorney_dashboard_availability_note_e_g')} accessibilityLabel={t('x_attorney_dashboard_availability_note')} placeholderTextColor={colors.placeholder} />
        <TouchableOpacity accessibilityRole="button" testID="ad-availability-save" style={[s.primaryBtn, savingAvail && { opacity: 0.6 }]} disabled={savingAvail} onPress={saveAvail}>
          <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_attorney_dashboard_save_availability')}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexGrow: 0, backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { minHeight: 46, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, ...FONTS.bold, color: colors.textMuted },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 10, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  section: { fontSize: 12, ...FONTS.black, color: colors.textMuted, letterSpacing: 1, marginTop: 18, marginHorizontal: 16, textTransform: 'uppercase' },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 2 },
  contactLink: { minHeight: 44, justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginHorizontal: 16, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8, marginTop: 6 },
  cell: { width: '33.33%', padding: 4 },
  cellVal: { fontSize: 20, ...FONTS.black, color: colors.textBrand, textAlign: 'center', backgroundColor: colors.bgCard, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md, paddingTop: 10 },
  cellLabel: { fontSize: 11, lineHeight: 15, color: colors.textSecond, textAlign: 'center', backgroundColor: colors.bgCard, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md, paddingBottom: 10, paddingHorizontal: 4, minHeight: 40 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 12, marginTop: 8 },
  chip: { minHeight: 44, paddingHorizontal: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bgCard },
  chipText: { fontSize: 13, ...FONTS.semi, color: colors.textSecond },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8 },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  label: { fontSize: 13, ...FONTS.semi, color: colors.textSecond, marginTop: 10, marginBottom: 4 },
  field: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 10, minHeight: 44, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14 },
});

export default React.memo(AttorneyDashboardScreen);
