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
import { getCachedCourtDates, isOfflineError, formatCourtDay, HEARING_LABELS, type CourtDate } from '../services/corePath';
import { BUNDLED_GUIDANCE, GuidanceView, makeStyles as courtStyles, type Guidance } from './CourtDatesScreen';
import { useConfirm } from '../hooks/useConfirm';

interface Reminder { id: number; deliver_at: string; days_before: number | null; title: string }
interface Detail extends CourtDate { reminders: Reminder[]; time_zone: string; guidance?: Guidance }
interface Follower { id: number; status: string; name: string | null; email: string | null; share_reminders: boolean }

function whenLabel(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  } catch { return iso; }
}
const daysLabel = (n: number | null) => (n === 0 ? 'Morning of' : n === 1 ? '1 day before' : n == null ? 'Reminder' : `${n} days before`);

function CourtDateDetailScreen({ navigation, route }: ScreenProps): React.JSX.Element {
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
  const [guidance, setGuidance] = useState<Guidance>(BUNDLED_GUIDANCE);
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
    if (!Number.isFinite(id)) { setErrorMsg('This court date could not be found.'); setPhase('error'); return; }
    try {
      const r = await api.get<Detail>(`/court-dates/${id}`);
      if (!mounted.current) return;
      setD(r.data); setPhase('ok');
      if (r.data.guidance) setGuidance(r.data.guidance);
      api.get(`/cases/${r.data.case_id}/followers`).then(f => { if (mounted.current && Array.isArray(f.data)) setFollowers(f.data); }).catch(() => {});
      api.get('/court-dates/preferences').then(p => { if (mounted.current) setSms(p.data); }).catch(() => {});
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const c = await getCachedCourtDates();
        const hit = c && [...c.list.upcoming, ...c.list.past].find(x => x.id === id);
        if (hit) { setD({ ...hit, reminders: [], time_zone: c?.list.time_zone || '' }); setPhase('offline'); return; }
      }
      setErrorMsg((e as any)?.response?.status === 404 ? 'This court date could not be found.' : apiErrorMessage(e, 'Could not load the court date.'));
      setPhase('error');
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.patch<Detail>(`/court-dates/${id}`, body);
      if (!mounted.current) return;
      setD(prev => ({ ...(prev as Detail), ...r.data, reminders: r.data.reminders || [] }));
      if (r.data.guidance) { setGuidance(g => ({ ...g, missed: r.data.guidance as unknown as Guidance['missed'] })); }
      showToast(ok, 'success');
    } catch (e) { showToast(apiErrorMessage(e, 'Could not update the court date.'), 'error'); }
    finally { if (mounted.current) setBusy(false); }
  };

  const markMissed = async () => {
    setMissedOpen(true);
    if (d?.status !== 'missed') await patch({ status: 'missed' }, 'Marked as missed. Reminders for this date are off.');
  };

  const addToCalendar = async () => {
    try {
      const how = await exportCourtDateIcs(id);
      showToast(how === 'download' ? 'Calendar file downloaded — open it to add the date.' : 'Choose your calendar to add the date.', 'success');
    } catch (e) { showToast(apiErrorMessage(e, 'Could not create the calendar file.'), 'error'); }
  };

  const remove = async () => {
    const ok = await confirm('Delete this court date?', 'Its reminders will be cancelled.', { confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try { await api.delete(`/court-dates/${id}`); showToast('Court date deleted.', 'success'); navigation.goBack(); }
    catch (e) { showToast(apiErrorMessage(e, 'Could not delete.'), 'error'); }
  };

  const saveSms = async (on: boolean) => {
    try {
      const r = await api.put('/court-dates/preferences', { sms_reminders: on, ...(phone.trim() ? { phone: phone.trim() } : {}) });
      setSms(s => ({ ...(s || { has_phone: true, sms_available: false }), sms_reminders: on, has_phone: true, sms_available: !!r.data?.sms_available }));
      showToast(r.data?.note || (on ? 'Text reminders on.' : 'Text reminders off.'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, 'Could not save.'), 'error'); }
  };

  const createInvite = async () => {
    if (!consent || !d) return;
    try {
      const r = await api.post<{ invite_code: string; share_message: string }>(`/cases/${d.case_id}/followers`, {
        consent: true, name: famName.trim() || undefined, email: famEmail.trim() || undefined, share_reminders: withReminders,
      });
      setInvite(r.data);
      api.get(`/cases/${d.case_id}/followers`).then(f => { if (mounted.current && Array.isArray(f.data)) setFollowers(f.data); }).catch(() => {});
    } catch (e) { showToast(apiErrorMessage(e, 'Could not create the invite.'), 'error'); }
  };
  const stopSharing = async (f: Follower) => {
    if (!d) return;
    try {
      await api.delete(`/cases/${d.case_id}/followers/${f.id}`);
      setFollowers(list => list.filter(x => x.id !== f.id));
      showToast('Stopped sharing. They will not get your court dates or reminders.', 'success');
    } catch (e) { showToast(apiErrorMessage(e, 'Could not stop sharing.'), 'error'); }
  };

  if (phase === 'loading') return <View style={styles.screen}><ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} accessibilityLabel="Loading" /></View>;
  if (phase === 'error' || !d) {
    return (
      <View style={[styles.screen, styles.scroll]} testID="court-date-detail-screen">
        <View style={styles.box} testID="court-date-error"><Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{errorMsg}</Text></View>
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={load}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const ch = d.courthouse;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="court-date-detail-screen">
      {phase === 'offline' && <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="court-date-offline">📴 Offline — saved copy on this phone.</Text>}
      <Text maxFontSizeMultiplier={1.4} style={styles.title} testID="court-date-when">📅 {formatCourtDay(d.court_date)}{d.court_time_label ? ` · ${d.court_time_label}` : ''}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{d.case_title}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
        {[d.hearing_type ? HEARING_LABELS[d.hearing_type] || d.hearing_type : null, d.location, d.status !== 'scheduled' ? `Status: ${d.status}` : null].filter(Boolean).join(' · ')}
      </Text>

      {ch ? (
        <View style={styles.box} testID="court-date-courthouse">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>🏛️ {ch.name}</Text>
          {!!ch.address && <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{ch.address}</Text>}
          {!!ch.hours && <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>Hours: {ch.hours}</Text>}
          <View style={styles.followRow}>
            {!!ch.phone && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-call-clerk" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(`tel:${String(ch.phone).replace(/[^\d+]/g, '')}`).catch(() => showToast(`Please dial ${ch.phone}.`, 'warning'))}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>📞 Call the court</Text>
              </TouchableOpacity>
            )}
            {!!ch.directions_url && (
              <TouchableOpacity accessibilityRole="button" testID="court-date-directions" style={[styles.goBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(String(ch.directions_url)).catch(() => {})}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>🧭 Directions</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={1.4} style={styles.muted}>No courthouse saved for this date. Add it so you have the address and phone on the day.</Text>
      )}

      <TouchableOpacity accessibilityRole="button" testID="court-date-ics" style={styles.primaryBtn} onPress={addToCalendar} disabled={phase === 'offline'}>
        <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>🗓 Add to phone calendar</Text>
      </TouchableOpacity>

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-reminders">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>🔔 Reminders</Text>
          {d.reminders.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{d.status === 'scheduled' && !d.is_past ? 'No reminders left before this date.' : 'Reminders are off for this date.'}</Text>}
          {d.reminders.map(r => (
            <Text key={r.id} maxFontSizeMultiplier={1.4} style={styles.boxText} testID="court-reminder-row">• {daysLabel(r.days_before)} — {whenLabel(r.deliver_at, d.time_zone)}</Text>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>Push notification first, then e-mail{sms?.sms_available ? ', then text message' : ''}. Times are in {d.time_zone || 'your time zone'}.</Text>
          {sms?.sms_available && (
            <View style={{ marginTop: 8 }}>
              {!sms.has_phone && (
                <TextInput accessibilityLabel="Mobile number for text reminders" style={styles.inputFull} value={phone} onChangeText={setPhone}
                  placeholder="Mobile number" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
              )}
              <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: sms.sms_reminders }} testID="court-date-sms" style={styles.secondaryBtn} onPress={() => saveSms(!sms.sms_reminders)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{sms.sms_reminders ? '✓ Text reminders on' : 'Also text me reminders'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity accessibilityRole="button" testID="court-date-bail" style={styles.secondaryBtn}
        onPress={() => (navigation as any).navigate('BailCalculator', { state: d.case_state || undefined, caseTitle: d.case_title })}>
        <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>💰 Typical bail amounts for this case</Text>
      </TouchableOpacity>

      <GuidanceView g={guidance} which="checklist" styles={styles} />

      {phase === 'ok' && (
        <View style={styles.box} testID="court-date-family">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>👨‍👩‍👧 Share with family</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>A family member can get the same reminders. They see your court dates and courthouse only — never your notes. You can stop any time.</Text>
          {followers.map(f => (
            <View key={f.id} style={styles.followRow} testID="court-date-follower">
              <Text maxFontSizeMultiplier={1.4} style={[styles.boxText, { flex: 1 }]}>{f.name || f.email || 'Invited person'} · {f.status === 'pending' ? 'invite not used yet' : f.status}</Text>
              <TouchableOpacity accessibilityRole="button" testID="court-date-stop-sharing" style={styles.goBtn} onPress={() => stopSharing(f)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>Stop</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity accessibilityRole="button" testID="court-date-share-family" style={styles.secondaryBtn}
            onPress={() => { setShareOpen(true); setInvite(null); setConsent(false); }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Invite a family member</Text>
          </TouchableOpacity>
        </View>
      )}

      {missedOpen ? <GuidanceView g={guidance} which="missed" styles={styles} /> : (
        <TouchableOpacity accessibilityRole="button" testID="court-date-missed" style={styles.secondaryBtn} onPress={markMissed} disabled={phase === 'offline'}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ I missed this court date</Text>
        </TouchableOpacity>
      )}
      {phase === 'ok' && d.status === 'scheduled' && d.is_past && (
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => patch({ status: 'attended' }, 'Marked as attended.')}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>✓ I went to this court date</Text>
        </TouchableOpacity>
      )}
      {phase === 'ok' && (
        <TouchableOpacity accessibilityRole="button" testID="court-date-delete" style={styles.secondaryBtn} onPress={remove}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Delete this court date</Text>
        </TouchableOpacity>
      )}

      <Modal visible={shareOpen} animationType="slide" onRequestClose={() => setShareOpen(false)} accessibilityViewIsModal>
        <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="family-share-modal" keyboardShouldPersistTaps="handled">
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>Invite a family member</Text>
          {!invite ? (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>Their name (optional)</Text>
              <TextInput accessibilityLabel="Family member name" testID="family-name" style={styles.inputFull} value={famName} onChangeText={setFamName} maxLength={80} />
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>Their e-mail (optional — we e-mail them the code)</Text>
              <TextInput accessibilityLabel="Family member e-mail" testID="family-email" style={styles.inputFull} value={famEmail} onChangeText={setFamEmail} autoCapitalize="none" keyboardType="email-address" />
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: withReminders }} testID="family-reminders" style={styles.secondaryBtn} onPress={() => setWithReminders(v => !v)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{withReminders ? '☑' : '☐'} Send them my court reminders too</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consent }} testID="family-consent" style={[styles.box, consent && { borderColor: colors.legalDark }]} onPress={() => setConsent(v => !v)}>
                <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{consent ? '☑' : '☐'} I agree to share my court dates (day, time, courthouse) for “{d.case_title}” with this person. They will not see my notes. I can stop sharing at any time.</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="family-create-invite" style={[styles.primaryBtn, !consent && { opacity: 0.5 }]} disabled={!consent} onPress={createInvite}>
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>Create invite code</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.box} testID="family-invite-code">
              <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>Give them this code. They open Justice Gavel → My court dates → “Follow”.</Text>
              <Text maxFontSizeMultiplier={1.2} style={[styles.title, { letterSpacing: 3, marginTop: 10 }]} selectable testID="family-code-text">{invite.invite_code}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => RNShare.share({ message: invite.share_message, title: 'Follow my court dates' }).catch(() => {})}>
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>📤 Send the code</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setShareOpen(false)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

export default React.memo(CourtDateDetailScreen);
