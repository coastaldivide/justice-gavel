/**
 * CheckInManagerScreen — the bail agent's side of post-release check-ins.
 *
 *  - Defendants with today's status in THEIR day (checked in / not yet / court
 *    soon / waiting for them to sign in), the check-in link to send them
 *    (share sheet; copied on web), history with 30-day compliance, stop
 *    monitoring.
 *  - Enroll: name, phone and/or e-mail (the defendant's account is matched by
 *    them), case number, court date, daily or weekly.
 *  - Only bail-agent accounts can enroll (the server answers 403 otherwise);
 *    other accounts see what the tool is for.
 *  - Billing: the per-defendant price is shown, and that it is not charged yet
 *    (no payment exists for it) — never a "demo" charge.
 *  - Channel: "app" (the defendant signs in to the app) or "text link" (no app:
 *    every reminder is a text with a personal link, 5¢ per text on the plan
 *    invoice; the agent confirms the person gave the number for texts). Text
 *    enrollments show the last text and its delivery status and can text the
 *    link again or reset it (older links stop working).
 *  - Missed check-ins (job checkin-missed): listed at the top and on each row;
 *    the agent can also get them by text. Each enrollment can text the
 *    defendant a gentle reminder after a missed day.
 *  - Location alerts (⚖ server setting CHECKIN_LOCATION_ALERTS_ENABLED; hidden
 *    when off): a home point (from a check-in that shared its location, or
 *    entered) and a radius; check-ins outside it are flagged in the history.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { formatCourtDay } from '../services/corePath';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useAuthGate } from '../components/AuthGate';
import { useTheme } from '../constants/theme';
import { daysUntil, validCourtDate } from '../utils/dateUtils';
import { RNShare, COPIED_ACTION } from '../utils/webCompat';
import * as secureStorage from '../utils/secureStorage';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS, AppIcon } from '../components/AppIcon';
import { Check, Chips } from '../components/bondDesk/ui';

export type Channel = 'app' | 'sms';
export interface LastText { kind: 'link' | 'reminder' | 'missed'; status: string; at: string; delivery_status: string | null }
export interface DefendantRow {
  id: number; defendant_name: string; defendant_phone: string | null; defendant_email: string | null; case_number: string | null;
  court_date: string | null; check_in_freq: 'daily' | 'weekly'; active: number; linked: boolean; total_checkins: number;
  checkins_today: number; done_for_period: boolean; next_due: string; today: string; last_checkin: string | null; checkin_link: string | null;
  channel?: Channel; text_consent?: boolean; text_ready?: boolean; missed_text_defendant?: boolean;
  home?: { lat: number; lng: number; radius_miles: number } | null; recent_missed?: string[]; last_text?: LastText | null;
}
interface ListResponse {
  enrollments: DefendantRow[]; total_active: number; fee_cents: number; monthly_cost_cents: number; billing_active: boolean;
  can_text?: boolean; text_cents?: number; location_alerts_enabled?: boolean;
  agent_settings?: { missed_alert_text: boolean; alert_phone: string | null };
}
interface HistoryRecord {
  id: number; checked_in_at: string; local_day: string; location_label: string | null; notes: string | null; lat: number | null; lng: number | null;
  via?: string; counted?: boolean; distance_miles?: number | null; outside_radius?: boolean | null;
}
interface HistoryResponse {
  records: HistoryRecord[];
  compliance: { window_days: number; expected: number; completed: number; missed: number; rate: number | null };
  time_zone: string;
  missed?: { local_day: string }[];
  enrollment?: { home?: { lat: number; lng: number; radius_miles: number } | null };
  location_alerts_enabled?: boolean;
}
interface MissedRow { enrollment_id: number; local_day: string; defendant_name: string }

const money = (cents: number) => (cents / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });

/** The status pill for a defendant row. */
export function rowStatus(r: DefendantRow): { key: string; tone: 'muted' | 'ok' | 'urgent' | 'warn' } {
  if (!r.active) return { key: 'x_check_in_manager_inactive', tone: 'muted' };
  if (!r.linked) return { key: 'ckm_waiting_sign_in', tone: 'muted' };
  if (r.done_for_period) return { key: r.check_in_freq === 'weekly' ? 'ckm_done_week' : 'x_check_in_manager_checked_today', tone: 'ok' };
  const soon = r.court_date ? daysUntil(r.court_date) : null;
  if (soon !== null && soon >= 0 && soon <= 3) return { key: 'x_check_in_manager_court_soon_not_checked', tone: 'urgent' };
  return { key: r.check_in_freq === 'weekly' ? 'ckm_not_this_week' : 'x_check_in_manager_not_checked_today', tone: 'warn' };
}

/** The last text's state in words: the carrier's delivery report when there is one, else what we did. */
export function textStateKey(tx: LastText | null | undefined): string | null {
  if (!tx) return null;
  if (tx.delivery_status === 'delivered') return 'ckm_text_delivered';
  if (tx.delivery_status && /fail|unconfirmed/.test(tx.delivery_status)) return 'ckm_text_not_delivered';
  return ({ sent: 'ckm_text_sent', opted_out: 'ckm_text_opted_out', no_plan: 'ckm_text_no_plan', failed: 'ckm_text_failed', skipped: 'ckm_text_skipped', sending: 'ckm_text_sent' } as Record<string, string>)[tx.status] || null;
}

function CheckInManagerScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error' | 'guest'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [history, setHistory] = useState<{ row: DefendantRow; data: HistoryResponse | null; error: string } | null>(null);

  // enroll form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [caseNum, setCaseNum] = useState('');
  const [courtDate, setCourtDate] = useState('');
  const [freq, setFreq] = useState<'daily' | 'weekly'>('daily');
  const [channel, setChannel] = useState<Channel>('app');
  const [consent, setConsent] = useState(false);
  const [missedText, setMissedText] = useState(true);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [missed, setMissed] = useState<MissedRow[]>([]);
  // the agent's own alert by text
  const [alertText, setAlertText] = useState(false);
  const [alertPhone, setAlertPhone] = useState('');
  const [alertSaving, setAlertSaving] = useState(false);
  // per-enrollment settings (channel / consent / missed text)
  const [settingsFor, setSettingsFor] = useState<DefendantRow | null>(null);
  const [stChan, setStChan] = useState<Channel>('app');
  const [stPhone, setStPhone] = useState('');
  const [stConsent, setStConsent] = useState(false);
  const [stMissed, setStMissed] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  // home point (location alerts)
  const [radius, setRadius] = useState('');
  const [homeLat, setHomeLat] = useState('');
  const [homeLng, setHomeLng] = useState('');
  const [homeError, setHomeError] = useState('');

  const load = useCallback(async () => {
    const token = await secureStorage.getToken().catch(() => null);
    if (!token) { if (mounted.current) { setPhase('guest'); setIsAgent(false); } return; }
    const raw = await secureStorage.getItem('user').catch(() => null);
    let agent = false;
    try { agent = JSON.parse(raw || '{}')?.accountType === 'bail_agent'; } catch { agent = false; }
    try {
      const r = await api.get<ListResponse>('/checkins/enrollments');
      if (!mounted.current) return;
      setData(r.data); setPhase('ok');
      setIsAgent(agent || (r.data?.enrollments?.length ?? 0) > 0);
      setAlertText(!!r.data?.agent_settings?.missed_alert_text);
      setAlertPhone(r.data?.agent_settings?.alert_phone || '');
      api.get<{ missed: MissedRow[] }>('/checkins/missed')
        .then(m => { if (mounted.current) setMissed(Array.isArray(m.data?.missed) ? m.data.missed : []); }).catch(() => {});
    } catch {
      if (mounted.current) { setPhase('error'); setIsAgent(agent); }
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load().finally(() => { if (mounted.current) setRefreshing(false); }); };

  const resetForm = () => {
    setName(''); setPhone(''); setEmail(''); setCaseNum(''); setCourtDate(''); setFreq('daily'); setFormError('');
    setChannel('app'); setConsent(false); setMissedText(true);
  };

  const shareLink = async (row: DefendantRow, message?: string) => {
    if (!row.checkin_link) return;
    const text = message || t('ckm_share_message', { name: row.defendant_name.split(/\s+/)[0], link: row.checkin_link });
    const r = await RNShare.share({ message: text, title: t('ckm_share_title') }).catch(() => null);
    if (r?.action === COPIED_ACTION) showToast(t('ckm_link_copied'), 'success');
  };

  const enroll = async () => {
    if (!name.trim()) { setFormError(t('x_check_in_manager_enter_defendant_name')); return; }
    if (!phone.trim() && !email.trim()) { setFormError(t('ckm_need_contact')); return; }
    if (channel === 'sms' && !phone.trim()) { setFormError(t('ckm_text_needs_phone')); return; }
    if (channel === 'sms' && !consent) { setFormError(t('ckm_err_consent')); return; }
    if (courtDate.trim() && !validCourtDate(courtDate.trim())) { setFormError(t('cs2_err_date')); return; }
    setSaving(true); setFormError('');
    try {
      const r = await api.post<{ enrollment: DefendantRow; checkin_link: string; share_message: string; text_status: string | null }>('/checkins/enroll', {
        defendant_name: name.trim(), defendant_phone: phone.trim() || undefined, defendant_email: email.trim() || undefined,
        case_number: caseNum.trim() || undefined, court_date: courtDate.trim() || undefined, check_in_freq: freq,
        channel, ...(channel === 'sms' ? { consent_confirmed: consent, missed_text_defendant: missedText } : {}),
      });
      if (!mounted.current) return;
      setEnrollOpen(false); resetForm();
      await load();
      if (r.data.enrollment.channel === 'sms') {
        const st = r.data.text_status;
        showToast(st === 'sent' ? t('ckm_enrolled_text', { name: r.data.enrollment.defendant_name }) : t('ckm_enrolled_text_not_sent', { name: r.data.enrollment.defendant_name }), st === 'sent' ? 'success' : 'error');
        return;
      }
      showToast(t('ckm_enrolled', { name: r.data.enrollment.defendant_name }), 'success');
      await shareLink({ ...r.data.enrollment, checkin_link: r.data.checkin_link }, r.data.share_message);
    } catch (e) {
      setFormError(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again')));
    } finally { if (mounted.current) setSaving(false); }
  };

  const textLink = async (row: DefendantRow, rotate: boolean) => {
    if (rotate) {
      const ok = await confirm(t('ckm_reset_link_title'), t('ckm_reset_link_body', { name: row.defendant_name }), { confirmLabel: t('ckm_reset_link') });
      if (!ok) return;
    }
    try {
      const r = await api.post<{ status: string }>(`/checkins/enrollments/${row.id}/link`, { rotate });
      showToast(r.data.status === 'sent' ? t('ckm_link_texted') : t('ckm_text_skipped'), r.data.status === 'sent' ? 'success' : 'error');
      load();
    } catch (e) { showToast(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again')), 'error'); }
  };

  const openSettings = (row: DefendantRow) => {
    setSettingsFor(row); setStChan(row.channel || 'app'); setStPhone(row.defendant_phone || '');
    setStConsent(!!row.text_consent); setStMissed(row.missed_text_defendant ?? row.channel === 'sms'); setSettingsError('');
  };
  const saveSettings = async () => {
    const row = settingsFor;
    if (!row) return;
    if (stChan === 'sms' && !stPhone.trim()) { setSettingsError(t('ckm_text_needs_phone')); return; }
    if (stChan === 'sms' && !stConsent) { setSettingsError(t('ckm_err_consent')); return; }
    try {
      const phoneChanged = stPhone.trim() !== (row.defendant_phone || '');
      const r = await api.patch<{ text_status: string | null }>(`/checkins/enrollments/${row.id}/settings`, {
        channel: stChan, missed_text_defendant: stMissed,
        ...(phoneChanged ? { defendant_phone: stPhone.trim() } : {}),
        ...(stChan === 'sms' && stConsent ? { consent_confirmed: true } : {}),
      });
      if (!mounted.current) return;
      setSettingsFor(null);
      showToast(r.data.text_status === 'sent' ? t('ckm_link_texted') : t('ckm_saved'), 'success');
      load();
    } catch (e) { setSettingsError(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again'))); }
  };

  const saveAlertSettings = async () => {
    if (alertText && !alertPhone.trim()) { showToast(t('ckm_alert_phone_needed'), 'error'); return; }
    setAlertSaving(true);
    try {
      await api.put('/checkins/agent-settings', { missed_alert_text: alertText, alert_phone: alertPhone.trim() || undefined });
      showToast(t('ckm_saved'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again')), 'error'); }
    finally { if (mounted.current) setAlertSaving(false); }
  };

  const saveHome = async (fromRecord?: number) => {
    if (!history) return;
    const miles = Number(radius);
    if (!Number.isFinite(miles) || miles <= 0 || miles > 500) { setHomeError(t('ckm_home_radius_bad')); return; }
    const body: Record<string, unknown> = { radius_miles: miles };
    if (fromRecord) body.record_id = fromRecord;
    else {
      const la = Number(homeLat); const lo = Number(homeLng);
      if (!homeLat.trim() || !homeLng.trim() || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { setHomeError(t('ckm_home_point_bad')); return; }
      body.lat = la; body.lng = lo;
    }
    setHomeError('');
    try {
      await api.put(`/checkins/enrollments/${history.row.id}/home`, body);
      showToast(t('ckm_home_saved'), 'success');
      openHistory(history.row);
    } catch (e) { setHomeError(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again'))); }
  };
  const clearHome = async () => {
    if (!history) return;
    try { await api.delete(`/checkins/enrollments/${history.row.id}/home`); openHistory(history.row); }
    catch (e) { setHomeError(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again'))); }
  };

  const openHistory = async (row: DefendantRow) => {
    setHistory({ row, data: null, error: '' });
    setHomeError('');
    try {
      const r = await api.get<HistoryResponse>(`/checkins/history/${row.id}`);
      if (mounted.current) {
        setHistory({ row, data: r.data, error: '' });
        const h = r.data?.enrollment?.home;
        setRadius(h ? String(h.radius_miles) : ''); setHomeLat(h ? String(h.lat) : ''); setHomeLng(h ? String(h.lng) : '');
      }
    } catch (e) {
      if (mounted.current) setHistory({ row, data: null, error: apiErrorMessage(e, t('ckm_history_failed')) });
    }
  };

  const setActive = async (row: DefendantRow, active: boolean) => {
    if (!active) {
      const ok = await confirm(t('x_check_in_manager_remove', { name: row.defendant_name }), t('x_check_in_manager_they_will_no_longer'),
        { confirmLabel: t('ckm_stop'), destructive: true });
      if (!ok) return;
    }
    try {
      await api.put(`/checkins/enrollments/${row.id}`, { active });
      showToast(active ? t('ckm_restarted') : t('ckm_stopped'), 'success');
      load();
    } catch (e) { showToast(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again')), 'error'); }
  };

  const rows = data?.enrollments || [];
  const active = rows.filter(r => r.active);
  const toneColor = { muted: colors.textMuted, ok: colors.legalDark, urgent: colors.emergency, warn: colors.warnDark } as const;

  return (
    <View style={styles.screen}>
      <AuthGateModal />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.heading} accessibilityRole="header">{t('x_check_in_manager_check_manager')}</Text>
          {!!data && (
            <Text maxFontSizeMultiplier={1.4} style={styles.subheading} testID="checkin-manager-summary">
              {t('ckm_summary_included', { n: active.length })}
            </Text>
          )}
        </View>
        {isAgent && (
          <TouchableOpacity accessibilityRole="button" testID="checkin-manager-enroll" style={styles.enrollBtn}
            onPress={() => requireAuth(() => { resetForm(); setEnrollOpen(true); })}>
            <Text maxFontSizeMultiplier={1.3} style={styles.enrollBtnText}>{t('x_check_in_manager_enroll')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView testID="check-in-manager-screen" contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {phase === 'loading' && <ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} />}
        {phase === 'error' && (
          <View style={styles.box}>
            <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('x_check_in_manager_check_connection_pull_down')}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => { setPhase('loading'); load(); }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('try_again')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!data && (
          <View style={styles.note} testID="checkin-manager-billing">
            <IconLabel icon={ICONS.card} textStyle={styles.noteText} maxFontSizeMultiplier={1.4}>{data.fee_cents > 0 ? t(data.billing_active ? 'ckm_billing_on' : 'ckm_billing_off', { price: money(data.fee_cents) }) : t('ckm_included')}</IconLabel>
          </View>
        )}
        {(phase === 'ok' || phase === 'guest') && active.length === 0 && (
          <View style={styles.box} testID="checkin-manager-how">
            <IconLabel icon={ICONS.mobile} textStyle={styles.boxTitle} maxFontSizeMultiplier={1.4}>{t('x_check_in_manager_digital_check_defendants')}</IconLabel>
            {['ckm_how_1', 'ckm_how_2', 'ckm_how_3', 'ckm_how_4', 'ckm_how_5'].map(k => <Text key={k} maxFontSizeMultiplier={1.4} style={styles.body}>{t(k)}</Text>)}
            {isAgent ? (
              <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => requireAuth(() => { resetForm(); setEnrollOpen(true); })}>
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('x_check_in_manager_enroll_first_defendant')}</Text>
              </TouchableOpacity>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={styles.small} testID="checkin-manager-agents-only">{t('ckm_agents_only')}</Text>
            )}
          </View>
        )}
        {missed.length > 0 && (
          <View style={styles.box} testID="checkin-manager-missed">
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.emergency} textStyle={styles.boxTitle} maxFontSizeMultiplier={1.4}>{t('ckm_missed_title')}</IconLabel>
            {missed.slice(0, 20).map(m => (
              <Text key={`${m.enrollment_id}-${m.local_day}`} maxFontSizeMultiplier={1.4} style={styles.body}>
                {t('ckm_missed_line', { name: m.defendant_name, day: formatCourtDay(String(m.local_day).slice(0, 10)) })}
              </Text>
            ))}
          </View>
        )}
        {isAgent && !!data && (
          <View style={styles.box} testID="checkin-manager-alerts">
            <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>{t('ckm_alerts_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_alerts_body')}</Text>
            <Check label={t('ckm_alert_text', { price: money(data.text_cents ?? 5) })} value={alertText} onChange={setAlertText} testID="checkin-alert-text" />
            {alertText && (
              <TextInput testID="checkin-alert-phone" accessibilityLabel={t('ckm_alert_phone')} style={styles.input} value={alertPhone} onChangeText={setAlertPhone}
                placeholder={t('ckm_alert_phone')} placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
            )}
            {alertText && data.can_text === false && <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_text_needs_plan')}</Text>}
            <TouchableOpacity accessibilityRole="button" style={[styles.action, { marginTop: 8 }]} onPress={saveAlertSettings} disabled={alertSaving} testID="checkin-alert-save">
              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t('ckm_save')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {rows.map(row => {
          const st = rowStatus(row);
          const textKey = textStateKey(row.last_text);
          return (
            <View key={row.id} style={[styles.card, !row.active && { opacity: 0.65 }]} testID="checkin-manager-row">
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.name}>{row.defendant_name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.small}>
                    {[row.case_number ? t('x_check_in_manager_case', { case_number: row.case_number }) : null, t(row.check_in_freq === 'weekly' ? 'ckm_weekly' : 'ckm_daily'),
                      t(row.channel === 'sms' ? 'ckm_channel_sms' : 'ckm_channel_app')].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.pillRow}>
                  {st.tone !== 'muted' && <AppIcon name={st.tone === 'ok' ? ICONS.statusOk : st.tone === 'urgent' ? ICONS.statusWarn : ICONS.hourglass} size={16} color={toneColor[st.tone]} />}
                  <Text maxFontSizeMultiplier={1.3} style={[styles.pill, { color: toneColor[st.tone], borderColor: toneColor[st.tone] }]}>{t(st.key)}</Text>
                </View>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.small}>
                {[t('ckm_total', { n: row.total_checkins }),
                  row.last_checkin ? t('ckm_last', { when: new Date(row.last_checkin).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : null,
                  row.court_date ? t('ckm_court', { day: formatCourtDay(row.court_date) }) : null].filter(Boolean).join(' · ')}
              </Text>
              {!!row.recent_missed?.length && (
                <Text maxFontSizeMultiplier={1.4} style={[styles.small, { color: colors.emergency }]} testID="checkin-manager-row-missed">
                  {t('ckm_row_missed', { days: row.recent_missed.slice(0, 3).map(d => formatCourtDay(String(d).slice(0, 10))).join(', ') })}
                </Text>
              )}
              {row.channel === 'sms' && !!textKey && (
                <Text maxFontSizeMultiplier={1.4} style={styles.small} testID="checkin-manager-row-text">{t('ckm_last_text', { state: t(textKey) })}</Text>
              )}
              <View style={styles.actions}>
                <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => openHistory(row)} testID="checkin-manager-history">
                  <IconLabel icon={ICONS.clipboard} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('x_check_in_manager_view_history')}</IconLabel>
                </TouchableOpacity>
                {!!row.active && row.channel !== 'sms' && !!row.checkin_link && (
                  <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => shareLink(row)} testID="checkin-manager-send-link">
                    <IconLabel icon={ICONS.share} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('ckm_send_link')}</IconLabel>
                  </TouchableOpacity>
                )}
                {!!row.active && row.channel === 'sms' && (
                  <>
                    <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => textLink(row, false)} testID="checkin-manager-text-link">
                      <IconLabel icon={ICONS.share} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('ckm_text_link_again')}</IconLabel>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => textLink(row, true)} testID="checkin-manager-reset-link">
                      <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t('ckm_reset_link')}</Text>
                    </TouchableOpacity>
                  </>
                )}
                {!!row.active && (
                  <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => openSettings(row)} testID="checkin-manager-settings">
                    <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t('ckm_settings')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => setActive(row, !row.active)} testID="checkin-manager-toggle">
                  <Text maxFontSizeMultiplier={1.3} style={[styles.actionText, row.active ? { color: colors.emergency } : null]}>{row.active ? t('ckm_stop') : t('ckm_restart')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Enroll */}
      <Modal visible={enrollOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEnrollOpen(false)} accessibilityViewIsModal>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
          <View style={styles.modalHeader}>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle}>{t('x_check_in_manager_enroll_defendant')}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} style={styles.closeBtn} onPress={() => setEnrollOpen(false)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="checkin-enroll-form">
            {!!formError && <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.error} maxFontSizeMultiplier={1.4} testID="checkin-enroll-error">{formError}</IconLabel>}
            {[
              { id: 'name', label: t('x_check_in_manager_full_name'), value: name, set: setName, ph: t('x_check_in_manager_john_smith'), kb: 'default' as const },
              { id: 'phone', label: t('ckm_phone'), value: phone, set: setPhone, ph: '(615) 555-0100', kb: 'phone-pad' as const },
              { id: 'email', label: t('ckm_email'), value: email, set: setEmail, ph: t('cs_email_placeholder'), kb: 'email-address' as const },
              { id: 'case', label: t('x_check_in_manager_case_number'), value: caseNum, set: setCaseNum, ph: t('x_check_in_manager_e_g_2025_cr'), kb: 'default' as const },
              { id: 'court', label: t('x_check_in_manager_court_date_yyyy_mm'), value: courtDate, set: setCourtDate, ph: '2026-11-15', kb: 'numbers-and-punctuation' as const },
            ].map(f => (
              <View key={f.id}>
                <Text maxFontSizeMultiplier={1.4} style={styles.label}>{f.label}</Text>
                <TextInput testID={`checkin-enroll-${f.id}`} accessibilityLabel={f.label} style={styles.input} value={f.value} onChangeText={f.set}
                  placeholder={f.ph} placeholderTextColor={colors.textMuted} keyboardType={f.kb} autoCapitalize={f.id === 'email' ? 'none' : 'words'} />
              </View>
            ))}
            <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_contact_hint')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ckm_channel')}</Text>
            <Chips<Channel> options={[{ key: 'app', label: t('ckm_channel_app') }, { key: 'sms', label: t('ckm_channel_sms') }]} value={channel} onChange={setChannel} testIDPrefix="checkin-enroll-channel" />
            <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t(channel === 'sms' ? 'ckm_channel_sms_help' : 'ckm_channel_app_help', { price: money(data?.text_cents ?? 5) })}</Text>
            {channel === 'sms' && (
              <>
                <Check label={t('ckm_consent_text')} value={consent} onChange={setConsent} testID="checkin-enroll-consent" />
                <Check label={t('ckm_missed_text_defendant')} value={missedText} onChange={setMissedText} testID="checkin-enroll-missed-text" />
                {data?.can_text === false && <Text maxFontSizeMultiplier={1.4} style={styles.small} testID="checkin-enroll-needs-plan">{t('ckm_text_needs_plan')}</Text>}
              </>
            )}
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_check_in_manager_check_frequency')}</Text>
            <View style={styles.actions}>
              {(['daily', 'weekly'] as const).map(f => (
                <TouchableOpacity key={f} accessibilityRole="radio" accessibilityState={{ selected: freq === f }} testID={`checkin-enroll-${f}`}
                  style={[styles.action, freq === f && styles.actionOn]} onPress={() => setFreq(f)}>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.actionText, freq === f && { color: colors.textOnNavy }]}>{t(f === 'weekly' ? 'ckm_weekly' : 'ckm_daily')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity accessibilityRole="button" testID="checkin-enroll-save" style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={enroll} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ckm_enroll_btn')}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* History */}
      <Modal visible={!!history} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistory(null)} accessibilityViewIsModal>
        <View style={styles.screen}>
          <View style={styles.modalHeader}>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} numberOfLines={1}>{history?.row.defendant_name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} style={styles.closeBtn} onPress={() => setHistory(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.scroll} testID="checkin-history">
            {!!history?.error && <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.error} maxFontSizeMultiplier={1.4}>{history.error}</IconLabel>}
            {!history?.data && !history?.error && <ActivityIndicator style={{ marginTop: 30 }} color={colors.textBrand} />}
            {!!history?.data && (
              <>
                <View style={styles.stats}>
                  {[
                    { n: String(history.data.compliance.completed), label: t('ckm_done_30') },
                    { n: String(history.data.compliance.missed), label: t('cd_status_missed') },
                    { n: history.data.compliance.rate == null ? '—' : `${history.data.compliance.rate}%`, label: t('x_check_in_manager_rate') },
                  ].map(s => (
                    <View key={s.label} style={styles.stat}><Text maxFontSizeMultiplier={1.3} style={styles.statNum}>{s.n}</Text><Text maxFontSizeMultiplier={1.3} style={styles.small}>{s.label}</Text></View>
                  ))}
                </View>
                <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_tz_note', { tz: history.data.time_zone })}</Text>
                {!!history.data.missed?.length && (
                  <Text maxFontSizeMultiplier={1.4} style={[styles.small, { color: colors.emergency }]} testID="checkin-history-missed">
                    {t('ckm_row_missed', { days: history.data.missed.slice(0, 10).map(m => formatCourtDay(String(m.local_day).slice(0, 10))).join(', ') })}
                  </Text>
                )}
                {!!history.data.location_alerts_enabled && (
                  <View style={styles.box} testID="checkin-home">
                    <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>{t('ckm_home_title')}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_home_help')}</Text>
                    {history.data.enrollment?.home ? (
                      <Text maxFontSizeMultiplier={1.4} style={styles.body} testID="checkin-home-current">
                        {t('ckm_home_current', { lat: history.data.enrollment.home.lat.toFixed(4), lng: history.data.enrollment.home.lng.toFixed(4), miles: history.data.enrollment.home.radius_miles })}
                      </Text>
                    ) : <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('ckm_home_none')}</Text>}
                    <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ckm_home_radius')}</Text>
                    <TextInput testID="checkin-home-radius" accessibilityLabel={t('ckm_home_radius')} style={styles.input} value={radius} onChangeText={setRadius} keyboardType="decimal-pad" placeholder="5" placeholderTextColor={colors.textMuted} />
                    <View style={styles.actions}>
                      <TextInput testID="checkin-home-lat" accessibilityLabel={t('ckm_home_lat')} style={[styles.input, { flex: 1 }]} value={homeLat} onChangeText={setHomeLat} keyboardType="numbers-and-punctuation" placeholder={t('ckm_home_lat')} placeholderTextColor={colors.textMuted} />
                      <TextInput testID="checkin-home-lng" accessibilityLabel={t('ckm_home_lng')} style={[styles.input, { flex: 1 }]} value={homeLng} onChangeText={setHomeLng} keyboardType="numbers-and-punctuation" placeholder={t('ckm_home_lng')} placeholderTextColor={colors.textMuted} />
                    </View>
                    {!!homeError && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="checkin-home-error">{homeError}</Text>}
                    <View style={styles.actions}>
                      <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => saveHome()} testID="checkin-home-save">
                        <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t('ckm_home_save')}</Text>
                      </TouchableOpacity>
                      {!!history.data.enrollment?.home && (
                        <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={clearHome} testID="checkin-home-clear">
                          <Text maxFontSizeMultiplier={1.3} style={[styles.actionText, { color: colors.emergency }]}>{t('ckm_home_clear')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
                {history.data.records.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('x_check_in_manager_no_check_ins_yet')}</Text>}
                {history.data.records.map(r => (
                  <View key={r.id} style={styles.histRow}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.label}>
                      ✓ {formatCourtDay(r.local_day)} · {new Date(r.checked_in_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', timeZone: history.data?.time_zone })}
                    </Text>
                    {!!r.location_label && <IconLabel icon={ICONS.location} textStyle={styles.small} maxFontSizeMultiplier={1.4}>{r.location_label}</IconLabel>}
                    {r.lat != null && r.lng != null && <IconLabel icon={ICONS.location} textStyle={styles.small} maxFontSizeMultiplier={1.4}>{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</IconLabel>}
                    {r.distance_miles != null && (
                      <Text maxFontSizeMultiplier={1.4} style={[styles.small, r.outside_radius ? { color: colors.emergency, fontWeight: '800' } : null]} testID={r.outside_radius ? 'checkin-history-outside' : undefined}>
                        {t(r.outside_radius ? 'ckm_outside_radius' : 'ckm_inside_radius', { miles: r.distance_miles })}
                      </Text>
                    )}
                    {r.counted === false && <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_extra_checkin')}</Text>}
                    {r.via === 'link' && <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t('ckm_via_link')}</Text>}
                    {!!r.notes && <Text maxFontSizeMultiplier={1.4} style={styles.small} numberOfLines={3}>{r.notes}</Text>}
                    {!!history.data?.location_alerts_enabled && r.lat != null && r.lng != null && (
                      <TouchableOpacity accessibilityRole="button" style={[styles.action, { marginTop: 6 }]} onPress={() => saveHome(r.id)} testID={`checkin-home-from-${r.id}`}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t('ckm_home_use_this')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Per-enrollment settings: channel, consent, the gentle missed-check-in text */}
      <Modal visible={!!settingsFor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsFor(null)} accessibilityViewIsModal>
        <View style={styles.screen}>
          <View style={styles.modalHeader}>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} numberOfLines={1}>{settingsFor?.defendant_name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} style={styles.closeBtn} onPress={() => setSettingsFor(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="checkin-settings">
            {!!settingsError && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="checkin-settings-error">{settingsError}</Text>}
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ckm_channel')}</Text>
            <Chips<Channel> options={[{ key: 'app', label: t('ckm_channel_app') }, { key: 'sms', label: t('ckm_channel_sms') }]} value={stChan} onChange={setStChan} testIDPrefix="checkin-settings-channel" />
            <Text maxFontSizeMultiplier={1.4} style={styles.small}>{t(stChan === 'sms' ? 'ckm_channel_sms_help' : 'ckm_channel_app_help', { price: money(data?.text_cents ?? 5) })}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ckm_phone')}</Text>
            <TextInput testID="checkin-settings-phone" accessibilityLabel={t('ckm_phone')} style={styles.input} value={stPhone} onChangeText={setStPhone} keyboardType="phone-pad" placeholder="(615) 555-0100" placeholderTextColor={colors.textMuted} />
            {stChan === 'sms' && (
              <>
                <Check label={t('ckm_consent_text')} value={stConsent} onChange={setStConsent} testID="checkin-settings-consent" />
                <Check label={t('ckm_missed_text_defendant')} value={stMissed} onChange={setStMissed} testID="checkin-settings-missed-text" />
              </>
            )}
            <TouchableOpacity accessibilityRole="button" testID="checkin-settings-save" style={styles.primaryBtn} onPress={saveSettings}>
              <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ckm_save')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { backgroundColor: c.navy, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { color: c.textOnNavy, fontSize: 21, fontWeight: '900' },
  subheading: { color: c.textOnNavy, fontSize: 13, marginTop: 2, opacity: 0.9 },
  enrollBtn: { backgroundColor: c.bgCard, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  enrollBtnText: { color: c.textBrand, fontWeight: '800', fontSize: 14 },
  box: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 12 },
  boxTitle: { color: c.textBrand, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  body: { color: c.textPrimary, fontSize: 14, lineHeight: 21 },
  small: { color: c.textSecond, fontSize: 13, lineHeight: 18 },
  note: { backgroundColor: c.infoBg, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 10, marginBottom: 12 },
  noteText: { color: c.textPrimary, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  name: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  pill: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, fontWeight: '700', maxWidth: '50%' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  action: { flexGrow: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  actionOn: { backgroundColor: c.navy, borderColor: c.navy },
  actionText: { color: c.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  primaryBtnText: { color: c.textOnNavy, fontSize: 15, fontWeight: '800' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bgCard, borderBottomWidth: 1, borderBottomColor: c.border, paddingLeft: 16, minHeight: 56 },
  modalTitle: { flex: 1, color: c.textBrand, fontSize: 18, fontWeight: '900' },
  closeBtn: { minWidth: 56, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  modalClose: { color: c.textMuted, fontSize: 20 },
  label: { color: c.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: c.inputBg || c.bgCard, color: c.inputText || c.textPrimary, borderColor: c.inputBorder || c.border, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 8 },
  stats: { flexDirection: 'row', backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statNum: { color: c.textBrand, fontSize: 22, fontWeight: '900' },
  histRow: { borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 8 },
});

export default React.memo(CheckInManagerScreen);
