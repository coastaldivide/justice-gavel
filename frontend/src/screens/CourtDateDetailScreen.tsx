/**
 * CourtDateDetailScreen — one hearing: when, where (courthouse name,
 * address, phone, hours, directions), the reminder schedule, "Add to phone
 * calendar" (.ics), the court-day checklist, "I missed this court date"
 * guidance (ends with "Call your lawyer or the court clerk"), "Change date or
 * time" (a continuance moves the hearing; its reminders are re-planned and
 * family followers are told), text-message
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
import { getCachedCourtDates, isOfflineError, formatCourtDay, formatCourtTime, hearingLabel, statusLabel, HEARING_TYPES, type CourtDate } from '../services/corePath';
import { validCourtDate } from '../utils/dateUtils';
import { pickGuidance, GuidanceView, makeStyles as courtStyles, type Guidance } from './CourtDatesScreen';
import { useConfirm } from '../hooks/useConfirm';
import { getToken } from '../utils/secureStorage';
import { SignInNeeded } from '../components/SignInNeeded';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

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
  const [phase, setPhase] = useState<'loading' | 'ok' | 'offline' | 'error' | 'signed_out'>('loading');
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
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ date: '', time: '', hearing: '', location: '' });
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) { setErrorMsg(t('cdd_not_found')); setPhase('error'); return; }
    if (!(await getToken().catch(() => null))) { if (mounted.current) setPhase('signed_out'); return; }
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

  const openEdit = () => {
    if (!d) return;
    setEdit({ date: d.court_date, time: d.court_time || '', hearing: d.hearing_type || '', location: d.location || '' });
    setEditError(''); setEditOpen(true);
  };
  const saveEdit = async () => {
    if (!validCourtDate(edit.date.trim())) { setEditError(t('cd_err_date')); return; }
    if (edit.time.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(edit.time.trim())) { setEditError(t('cd_err_time')); return; }
    setBusy(true); setEditError('');
    try {
      const r = await api.patch<Detail>(`/court-dates/${id}`, {
        court_date: edit.date.trim(), court_time: edit.time.trim() || null, hearing_type: edit.hearing || null,
        location: edit.location.trim() || null, ...(d?.status !== 'scheduled' ? { status: 'scheduled' } : {}),
      });
      if (!mounted.current) return;
      setD(prev => ({ ...(prev as Detail), ...r.data, reminders: r.data.reminders || [] }));
      setEditOpen(false);
      showToast(t('cdd_moved', { day: formatCourtDay(r.data.court_date) }), 'success');
    } catch (e: any) {
      setEditError(e?.response?.status === 409 ? t('cd_err_duplicate') : apiErrorMessage(e, t('cdd_update_failed')));
    } finally { if (mounted.current) setBusy(false); }
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
  if (phase === 'signed_out') {
    return (
      <View style={styles.screen} testID="court-date-detail-screen">
        <SignInNeeded navigation={navigation} testID="court-date-sign-in" body={t('sin_court_body')} onSignedIn={load} />
      </View>
    );
  }
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
      {phase === 'offline' && (
        <View style={styles.offline}>
          <IconLabel icon={ICONS.offline} color={colors.warnDark} textStyle={styles.offlineText} testID="court-date-offline">{t('cdd_offline')}</IconLabel>
        </View>
      )}
      <IconLabel icon={ICONS.calendar} color={colors.textPrimary} textStyle={styles.title} testID="court-date-when">{formatCourtDay(d.court_date)}{d.court_time ? ` · ${formatCourtTime(d.court_time)}` : ''}</IconLabel>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{d.case_title}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
        {[d.hearing_type ? hearingLabel(d.hearing_type) : null, d.location, d.status !== 'scheduled' ? t('cdd_status', { status: statusLabel(d.status) }) : null].filter(Boolean).join(' · ')}
      </Text>

      {ch ? (
        <View style={styles.box} testID="court-date-courthouse">
          <IconLabel icon={ICONS.courthouse} color={colors.textPrimary} textStyle={styles.boxTitle}>{ch.name}</IconLabel>
          {!!ch.address && <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{ch.address}</Text>}
          {!!ch.hours && <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{t('cdd_hours', { hours: String(ch.hours) })}</Text>}
          <View style={styles.followRow}>
            {!!ch.phone && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-call-clerk" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(`tel:${String(ch.phone).replace(/[^\d+]/g, '')}`).catch(() => showToast(t('cp_dial_manually', { num: String(ch.phone) }), 'warning'))}>
                <IconLabel center icon={ICONS.phoneFilled} color={colors.white} textStyle={styles.goBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_call_court')}</IconLabel>
              </TouchableOpacity>
            )}
            {!!ch.directions_url && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-directions" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(String(ch.directions_url)).catch(() => {})}>
                <IconLabel center icon={ICONS.directions} color={colors.white} textStyle={styles.goBtnText} maxFontSizeMultiplier={1.3}>{t('hn_directions')}</IconLabel>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cdd_no_courthouse')}</Text>
      )}

      {phase === 'ok' && (
        <TouchableOpacity accessibilityRole="button" testID="court-date-edit" style={styles.secondaryBtn} onPress={openEdit}>
          <IconLabel center icon={ICONS.edit} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_change')}</IconLabel>
        </TouchableOpacity>
      )}
      <TouchableOpacity accessibilityRole="button" testID="court-date-ics" style={styles.primaryBtn} onPress={addToCalendar} disabled={phase === 'offline'}>
        <IconLabel center icon={ICONS.calendarAdd} color={colors.white} textStyle={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_add_calendar')}</IconLabel>
      </TouchableOpacity>

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-reminders">
          <IconLabel icon={ICONS.notification} color={colors.textPrimary} textStyle={styles.boxTitle}>{t('cdd_reminders')}</IconLabel>
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
        <IconLabel center icon={ICONS.calculator} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_bail_amounts')}</IconLabel>
      </TouchableOpacity>

      <GuidanceView g={guidance} which="checklist" styles={styles} />

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-family">
          <IconLabel icon={ICONS.family} color={colors.textPrimary} textStyle={styles.boxTitle}>{t('cdd_share_family')}</IconLabel>
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
          <IconLabel center icon={ICONS.help} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_missed_btn')}</IconLabel>
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

      <Modal visible={editOpen} animationType="slide" onRequestClose={() => setEditOpen(false)} accessibilityViewIsModal>
        <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="court-date-edit-form" keyboardShouldPersistTaps="handled">
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('cdd_change')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cdd_change_note')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_court_date')}</Text>
          <TextInput accessibilityLabel={t('cd_date_a11y')} testID="court-edit-date" style={styles.inputFull} value={edit.date} onChangeText={v => setEdit(e => ({ ...e, date: v }))}
            placeholder={t('cd_date_placeholder')} placeholderTextColor={colors.textMuted} maxLength={10} />
          {validCourtDate(edit.date.trim()) && <IconLabel icon={ICONS.calendar} color={colors.textMuted} textStyle={styles.muted}>{formatCourtDay(edit.date.trim())}</IconLabel>}
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_time_optional')}</Text>
          <TextInput accessibilityLabel={t('cd_time_a11y')} testID="court-edit-time" style={styles.inputFull} value={edit.time} onChangeText={v => setEdit(e => ({ ...e, time: v }))}
            placeholder={t('cd_time_placeholder')} placeholderTextColor={colors.textMuted} maxLength={5} />
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_hearing_optional')}</Text>
          <View style={styles.chipsWrap}>
            {HEARING_TYPES.map(h => (
              <TouchableOpacity key={h} accessibilityRole="radio" accessibilityState={{ selected: edit.hearing === h }} style={[styles.chip, edit.hearing === h && styles.chipOn]}
                onPress={() => setEdit(e => ({ ...e, hearing: e.hearing === h ? '' : h }))}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, edit.hearing === h && styles.chipTextOn]}>{hearingLabel(h)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cd_room_optional')}</Text>
          <TextInput accessibilityLabel={t('cd_room_a11y')} style={styles.inputFull} value={edit.location} onChangeText={v => setEdit(e => ({ ...e, location: v }))}
            placeholder={t('cd_room_placeholder')} placeholderTextColor={colors.textMuted} maxLength={200} />
          {!!editError && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="court-edit-error">{editError}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="court-edit-save" style={styles.primaryBtn} onPress={saveEdit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('cd_save_reminders')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setEditOpen(false)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

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
                <IconLabel center icon={withReminders ? ICONS.checkbox : ICONS.checkboxEmpty} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_send_reminders')}</IconLabel>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consent }} testID="family-consent" style={[styles.box, consent && { borderColor: colors.legalDark }]} onPress={() => setConsent(v => !v)}>
                <IconLabel icon={consent ? ICONS.checkbox : ICONS.checkboxEmpty} color={colors.textPrimary} textStyle={styles.boxText}>{t('cdd_consent', { title: d.case_title })}</IconLabel>
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
                <IconLabel center icon={ICONS.send} color={colors.white} textStyle={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdd_send_code')}</IconLabel>
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
