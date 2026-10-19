/**
 * CourtDateDetailScreen — one hearing: when, where (courthouse name,
 * address, phone, hours, directions), the reminder schedule, "Add to phone
 * calendar" (.ics), the court-day checklist, "I missed this court date"
 * guidance (ends with "Call your lawyer or the court clerk"), text-message
 * reminders (when available) and family sharing.
 *
 * Family sharing needs the owner's explicit consent (a checkbox), creates a
 * one-time invite code, and can be stopped at any time. The follower sees
 * court dates only — never case notes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { RNShare } from '../utils/webCompat';
import { exportCourtDateIcs } from '../utils/icsExport';
import { getCachedCourtDates, isOfflineError, formatCourtDay, formatCourtTime, hearingLabel, statusLabel, type CourtDate } from '../services/corePath';
import { pickGuidance, GuidanceView, makeStyles as courtStyles, type Guidance } from './CourtDatesScreen';
import { useConfirm } from '../hooks/useConfirm';
import { t, useLang, locale } from '../i18n';

interface Reminder { id: number; deliver_at: string; days_before: number | null; title: string }
interface Detail extends CourtDate { reminders: Reminder[]; time_zone: string; guidance?: Guidance }
interface Follower { id: number; status: string; name: string | null; email: string | null; share_reminders: boolean }

function whenLabel(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) })
      .replace(/[\u00a0\u202f]/g, ' ');
  } catch { return iso; }
}
const daysLabel = (n: number | null) => (n === 0 ? t('cdd_morning_of') : n === 1 ? t('cdd_1_day') : n == null ? t('cdd_reminder') : t('cdd_n_days', { n }));
const followerStatus = (status: string) => (status === 'pending' ? t('cdd_invite_unused') : status === 'active' ? t('cdd_follow_active') : status === 'expired' ? t('cdd_follow_expired') : status);

function CourtDateDetailScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const lang = useLang();
  const { colors } = useTheme();
  const styles = courtStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const id = Number((route?.params as { id?: number | string } | undefined)?.id);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [d, setD] = useState<Detail | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [serverGuidance, setServerGuidance] = useState<Guidance | null>(null);
  const guidance = pickGuidance(serverGuidance);
  const [missedOpen, setMissedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sms, setSms] = useState<{ sms_reminders: boolean; has_phone: boolean; sms_available: boolean } | null>(null);
  const [phone, setPhone] = useState('');
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [famName, setFamName] = useState('');
  const [famEmail, setFamEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [withReminders, setWithReminders] = useState(true);
  const [invite, setInvite] = useState<{ invite_code: string; share_message: string } | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) { setErrorMsg(t('cdd_not_found')); setPhase('error'); return; }
    try {
      const r = await api.get<Detail>(`/court-dates/${id}`);
      if (!mounted.current) return;
      setD(r.data); setPhase('ok');
      if (r.data.guidance) setServerGuidance(r.data.guidance);
      api.get(`/cases/${r.data.case_id}/followers`).then(f => { if (mounted.current && Array.isArray(f.data)) setFollowers(f.data); }).catch(() => {});
      api.get('/court-dates/preferences').then(p => { if (mounted.current) setSms(p.data); }).catch(() => {});
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const c = await getCachedCourtDates();
        const hit = c && [...c.list.upcoming, ...c.list.past].find(x => x.id === id);
        if (hit) { setD({ ...hit, reminders: [], time_zone: c?.list.time_zone || '' }); setPhase('offline'); return; }
      }
      setErrorMsg((e as any)?.response?.status === 404 ? t('cdd_not_found') : apiErrorMessage(e, t('cdd_load_failed')));
      setPhase('error');
    }
  }, [id]);
  // (re)load on open and when the language changes (server text comes back in it)
  useEffect(() => { load(); }, [load, lang]);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.patch<Detail>(`/court-dates/${id}`, body);
      if (!mounted.current) return;
      setD(prev => ({ ...(prev as Detail), ...r.data, reminders: r.data.reminders || [] }));
      if (r.data.guidance) {
        const missed = r.data.guidance as unknown as Guidance['missed'];
        setServerGuidance(g => ({ ...(g || pickGuidance(null)), missed, language: missed.language || g?.language }));
      }
      showToast(ok, 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdd_update_failed')), 'error'); }
    finally { if (mounted.current) setBusy(false); }
  };

  const markMissed = async () => {
    setMissedOpen(true);
    if (d?.status !== 'missed') await patch({ status: 'missed' }, t('cdd_marked_missed'));
  };

  const addToCalendar = async () => {
    try {
      const how = await exportCourtDateIcs(id);
      showToast(how === 'download' ? t('cdd_ics_downloaded') : t('cdd_ics_share'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdd_ics_failed')), 'error'); }
  };

  const remove = async () => {
    const ok = await confirm(t('cdd_delete_q'), t('cdd_delete_body'), { confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    try { await api.delete(`/court-dates/${id}`); showToast(t('cdd_deleted'), 'success'); navigation.goBack(); }
    catch (e) { showToast(apiErrorMessage(e, t('cdd_delete_failed')), 'error'); }
  };

  const saveSms = async (on: boolean) => {
    try {
      const r = await api.put('/court-dates/preferences', { sms_reminders: on, ...(phone.trim() ? { phone: phone.trim() } : {}) });
      setSms(s => ({ ...(s || { has_phone: true, sms_available: false }), sms_reminders: on, has_phone: true, sms_available: !!r.data?.sms_available }));
      showToast(r.data?.note || (on ? t('cdd_sms_on') : t('cdd_sms_off')), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdd_save_failed')), 'error'); }
  };

  const createInvite = async () => {
    if (!consent || !d) return;
    try {
      const r = await api.post<{ invite_code: string; share_message: string }>(`/cases/${d.case_id}/followers`, {
        consent: true, name: famName.trim() || undefined, email: famEmail.trim() || undefined, share_reminders: withReminders,
      });
      setInvite(r.data);
      api.get(`/cases/${d.case_id}/followers`).then(f => { if (mounted.current && Array.isArray(f.data)) setFollowers(f.data); }).catch(() => {});
    } catch (e) { showToast(apiErrorMessage(e, t('cdd_invite_failed')), 'error'); }
  };
  const stopSharing = async (f: Follower) => {
    if (!d) return;
    try {
      await api.delete(`/cases/${d.case_id}/followers/${f.id}`);
      setFollowers(list => list.filter(x => x.id !== f.id));
      showToast(t('cdd_stopped_sharing'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdd_stop_failed')), 'error'); }
  };

  if (phase === 'loading') return <View style={styles.screen}><ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} accessibilityLabel={t('loading')} /></View>;
  if (phase === 'error' || !d) {
    return (
      <View style={[styles.screen, styles.scroll]} testID="court-date-detail-screen">
        <View style={styles.box} testID="court-date-error"><Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{errorMsg}</Text></View>
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={load}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const ch = d.courthouse;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="court-date-detail-screen">
      {phase === 'offline' && <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="court-date-offline">📴 {t('cdd_offline')}</Text>}
      <Text maxFontSizeMultiplier={1.4} style={styles.title} testID="court-date-when">📅 {formatCourtDay(d.court_date)}{d.court_time ? ` · ${formatCourtTime(d.court_time)}` : ''}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{d.case_title}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
        {[d.hearing_type ? hearingLabel(d.hearing_type) : null, d.location, d.status !== 'scheduled' ? t('cdd_status', { status: statusLabel(d.status) }) : null].filter(Boolean).join(' · ')}
      </Text>

      {ch ? (
        <View style={styles.box} testID="court-date-courthouse">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>🏛️ {ch.name}</Text>
          {!!ch.address && <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{ch.address}</Text>}
          {!!ch.hours && <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{t('cdd_hours', { hours: String(ch.hours) })}</Text>}
          <View style={styles.followRow}>
            {!!ch.phone && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-call-clerk" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(`tel:${String(ch.phone).replace(/[^\d+]/g, '')}`).catch(() => showToast(t('cp_dial_manually', { num: String(ch.phone) }), 'warning'))}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>📞 {t('cdd_call_court')}</Text>
              </TouchableOpacity>
            )}
            {!!ch.directions_url && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-directions" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(String(ch.directions_url)).catch(() => {})}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>🧭 {t('hn_directions')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cdd_no_courthouse')}</Text>
      )}

      <TouchableOpacity accessibilityRole="button" testID="court-date-ics" style={styles.primaryBtn} onPress={addToCalendar} disabled={phase === 'offline'}>
        <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>🗓 {t('cdd_add_calendar')}</Text>
      </TouchableOpacity>

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-reminders">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>🔔 {t('cdd_reminders')}</Text>
          {d.reminders.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{d.status === 'scheduled' && !d.is_past ? t('cdd_no_reminders_left') : t('cdd_reminders_off')}</Text>}
          {d.reminders.map(r => (
            <Text key={r.id} maxFontSizeMultiplier={1.4} style={styles.boxText} testID="court-reminder-row">• {daysLabel(r.days_before)} — {whenLabel(r.deliver_at, d.time_zone)}</Text>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t(sms?.sms_available ? 'cdd_channels_sms' : 'cdd_channels', { tz: d.time_zone || t('cdd_your_tz') })}</Text>
          {sms?.sms_available && (
            <View style={{ marginTop: 8 }}>
              {!sms.has_phone && (
                <TextInput accessibilityLabel={t('cdd_mobile_a11y')} style={styles.inputFull} value={phone} onChangeText={setPhone}
                  placeholder={t('cdd_mobile')} placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
              )}
              <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: sms.sms_reminders }} testID="court-date-sms" style={styles.secondaryBtn} onPress={() => saveSms(!sms.sms_reminders)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{sms.sms_reminders ? `✓ ${t('cdd_sms_on_btn')}` : t('cdd_sms_off_btn')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity accessibilityRole="button" testID="court-date-bail" style={styles.secondaryBtn}
        onPress={() => (navigation as any).navigate('BailCalculator', { state: d.case_state || undefined, caseTitle: d.case_title })}>
        <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>💰 {t('cdd_bail_amounts')}</Text>
      </TouchableOpacity>

      <GuidanceView g={guidance} which="checklist" styles={styles} />

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-family">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>👨‍👩‍👧 {t('cdd_share_family')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{t('cdd_share_body')}</Text>
          {followers.map(f => (
            <View key={f.id} style={styles.followRow} testID="court-date-follower">
              <Text maxFontSizeMultiplier={1.4} style={[styles.boxText, { flex: 1 }]}>{f.name || f.email || t('cdd_invited_person')} · {followerStatus(f.status)}</Text>
              <TouchableOpacity accessibilityRole="button" testID="court-date-stop-sharing" style={styles.goBtn} onPress={() => stopSharing(f)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('cdd_stop')}</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity accessibilityRole="button" testID="court-date-share-family" style={styles.secondaryBtn}
            onPress={() => { setShareOpen(true); setInvite(null); setConsent(false); }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cdd_invite_title')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {missedOpen ? <GuidanceView g={guidance} which="missed" styles={styles} /> : (
        <TouchableOpacity accessibilityRole="button" testID="court-date-missed" style={styles.secondaryBtn} onPress={markMissed} disabled={phase === 'offline'}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ {t('cdd_missed_btn')}</Text>
        </TouchableOpacity>
      )}
      {phase === 'ok' && d.status === 'scheduled' && d.is_past && (
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => patch({ status: 'attended' }, t('cdd_marked_attended'))}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>✓ {t('cdd_attended_btn')}</Text>
        </TouchableOpacity>
      )}
      {phase === 'ok' && (
        <TouchableOpacity accessibilityRole="button" testID="court-date-delete" style={styles.secondaryBtn} onPress={remove}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cdd_delete_btn')}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={shareOpen} animationType="slide" onRequestClose={() => setShareOpen(false)} accessibilityViewIsModal>
        <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="family-share-modal" keyboardShouldPersistTaps="handled">
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('cdd_invite_title')}</Text>
          {!invite ? (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cdd_their_name')}</Text>
              <TextInput accessibilityLabel={t('cdd_name_a11y')} testID="family-name" style={styles.inputFull} value={famName} onChangeText={setFamName} maxLength={80} />
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cdd_their_email')}</Text>
              <TextInput accessibilityLabel={t('cdd_email_a11y')} testID="family-email" style={styles.inputFull} value={famEmail} onChangeText={setFamEmail} autoCapitalize="none" keyboardType="email-address" />
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: withReminders }} testID="family-reminders" style={styles.secondaryBtn} onPress={() => setWithReminders(v => !v)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{withReminders ? '☑' : '☐'} {t('cdd_send_reminders')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consent }} testID="family-consent" style={[styles.box, consent && { borderColor: colors.legalDark }]} onPress={() => setConsent(v => !v)}>
                <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{consent ? '☑' : '☐'} {t('cdd_consent', { title: d.case_title })}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="family-create-invite" style={[styles.primaryBtn, !consent && { opacity: 0.5 }]} disabled={!consent} onPress={createInvite}>
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('cdd_create_code')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.box} testID="family-invite-code">
              <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{t('cdd_give_code')}</Text>
              <Text maxFontSizeMultiplier={1.2} style={[styles.title, { letterSpacing: 3, marginTop: 10 }]} selectable testID="family-code-text">{invite.invite_code}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => RNShare.share({ message: invite.share_message, title: t('cdd_share_title') }).catch(() => {})}>
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>📤 {t('cdd_send_code')}</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setShareOpen(false)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('done')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

export default React.memo(CourtDateDetailScreen);
