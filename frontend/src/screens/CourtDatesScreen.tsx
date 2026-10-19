/**
 * CourtDatesScreen — core path step 3: "Never miss a court date".
 *
 *  - Signed out: a clear "sign in to save your court date" prompt (court
 *    dates are personal); the court-day checklist and "I missed my court
 *    date" guidance still show.
 *  - Signed in: upcoming hearings (many per case) and an archive of past
 *    ones; "Add a court date" (case, day, optional time, hearing type,
 *    courthouse from the directory) → the server plans reminders 7 days,
 *    3 days, 1 day before and the morning of. Notifications are asked for
 *    in context right after saving.
 *  - Family: cases you follow (court dates only) and "Follow a family
 *    member" with the invite code they shared.
 *  - Offline: the court dates and followed cases saved on this phone.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage, unwrapList, deviceTimeZone } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t } from '../i18n';
import { getToken } from '../utils/secureStorage';
import { getUserState } from '../utils/userState';
import { requestNotificationsInContext } from '../services/permissions';
import {
  cacheCourtDates, getCachedCourtDates, cacheFollowing, getCachedFollowing, isOfflineError, saveCoreProgress,
  formatCourtDay, HEARING_LABELS, type CourtDate, type CourtDatesList, type FollowedCase,
} from '../services/corePath';

export interface Guidance {
  checklist: { bring: { text: string; source: string }[]; wear: { text: string; source: string }[]; note: string };
  missed: { title: string; steps: { text: string; source: string }[]; note: string };
}
// Bundled copy of GET /api/court-dates/guidance (same text, same sources) so it shows offline.
export const BUNDLED_GUIDANCE: Guidance = {
  checklist: {
    bring: [
      { text: 'Arrive early.', source: 'Justice Gavel court-reminder guidance' },
      { text: 'Bring all your court paperwork and documents.', source: 'Justice Gavel court-reminder guidance' },
      { text: 'For a bail hearing, things that can help: an employment letter or pay stubs, a lease or mortgage showing stable housing, and family members present in court.', source: 'Justice Gavel lesson: "How to Prepare for Your Bail Hearing"' },
    ],
    wear: [{ text: 'Business casual minimum. No orange. Clean and conservative.', source: 'Justice Gavel lesson: "How to Prepare for Your Bail Hearing"' }],
    note: 'General information only — your lawyer or the court can tell you exactly what your hearing needs.',
  },
  missed: {
    title: 'I missed my court date — what now?',
    steps: [
      { text: 'Missing court can lead to a bench warrant, and often the loss of any bail that was paid.', source: 'Justice Gavel court-reminder guidance; Justice Gavel in-app FAQ: "court date / missed hearing"' },
      { text: 'Do not just stay away — a bench warrant stays active until it is dealt with.', source: 'Justice Gavel in-app FAQ: "court date / missed hearing"' },
      { text: 'If a bail agent posted your bond, tell them — when you miss court, the bondsman is responsible for the full bail amount.', source: 'Justice Gavel bail calculator: "How bail bondsmen work"' },
      { text: 'Call your lawyer or the court clerk.', source: 'Justice Gavel court-reminder guidance' },
    ],
    note: 'General information only — not legal advice.',
  },
};

const HEARING_TYPES = Object.keys(HEARING_LABELS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function GuidanceView({ g, which, styles }: { g: Guidance; which: 'missed' | 'checklist' | 'both'; styles: any }) {
  return (
    <View>
      {(which === 'missed' || which === 'both') && (
        <View style={styles.box} testID="missed-guidance">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>{g.missed.title}</Text>
          {g.missed.steps.map((s, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text maxFontSizeMultiplier={1.5} style={i === g.missed.steps.length - 1 ? styles.boxStrong : styles.boxText}>{i + 1}. {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{g.missed.note} {t('rc_lawyer_pending')}.</Text>
        </View>
      )}
      {(which === 'checklist' || which === 'both') && (
        <View style={styles.box} testID="court-checklist">
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>✅ What to bring</Text>
          {g.checklist.bring.map((s, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>• {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.boxTitle}>👔 What to wear</Text>
          {g.checklist.wear.map((s, i) => (
            <View key={i}>
              <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>• {s.text}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('rc_source')}: {s.source}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{g.checklist.note}</Text>
        </View>
      )}
    </View>
  );
}

function CourtDatesScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const params = (route?.params || {}) as { add?: boolean; guidance?: 'missed'; caseId?: number };
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [list, setList] = useState<CourtDatesList | null>(null);
  const [following, setFollowing] = useState<FollowedCase[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [guidance, setGuidance] = useState<Guidance>(BUNDLED_GUIDANCE);
  const [showMissed, setShowMissed] = useState(params.guidance === 'missed');
  const [showPast, setShowPast] = useState(false);

  // add form
  const [adding, setAdding] = useState(false);
  const [cases, setCases] = useState<{ id: number; title: string; state: string | null }[]>([]);
  const [caseId, setCaseId] = useState<number | null>(params.caseId ?? null);
  const [caseTitle, setCaseTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [hearing, setHearing] = useState('');
  const [chQuery, setChQuery] = useState('');
  const [chResults, setChResults] = useState<{ id: number; name: string; address: string; city: string; state: string }[]>([]);
  const [courthouse, setCourthouse] = useState<{ id: number; name: string } | null>(null);
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // follow
  const [code, setCode] = useState('');
  const [following_, setFollowingBusy] = useState(false);

  const load = useCallback(async () => {
    const tok = await getToken().catch(() => null);
    if (!mounted.current) return;
    setSignedIn(!!tok);
    api.get<Guidance>('/court-dates/guidance').then(r => { if (mounted.current && r.data?.missed) setGuidance(r.data); }).catch(() => {});
    if (!tok) { setPhase('ok'); return; }
    try {
      const [cd, fol] = await Promise.all([
        api.get<CourtDatesList>('/court-dates'),
        api.get<{ following: FollowedCase[] }>('/following').catch(() => null),
      ]);
      if (!mounted.current) return;
      setList(cd.data); setPhase('ok'); setSavedAt(null);
      cacheCourtDates(cd.data).catch(() => {});
      if (fol?.data?.following) { setFollowing(fol.data.following); cacheFollowing(fol.data.following).catch(() => {}); }
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const [c, f] = await Promise.all([getCachedCourtDates(), getCachedFollowing()]);
        if (c || f) {
          if (c) { setList(c.list); setSavedAt(c.at); }
          if (f) setFollowing(f.list);
          setPhase('offline'); return;
        }
      }
      setErrorMsg(isOfflineError(e) ? 'You are offline and no court dates are saved on this phone yet.' : apiErrorMessage(e, 'Could not load your court dates.'));
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = useCallback(async () => {
    setFormError(''); setAdding(true);
    try {
      const r = await api.get('/cases');
      const rows = unwrapList<{ id: number; title: string; state: string | null }>(r.data);
      if (mounted.current) { setCases(rows); if (!caseId && rows.length === 1) setCaseId(rows[0].id); }
    } catch { /* new case only */ }
  }, [caseId]);
  useEffect(() => { if (params.add && signedIn) openAdd(); }, [params.add, signedIn, openAdd]);

  const searchCourthouses = async () => {
    const q = chQuery.trim();
    if (q.length < 2) return;
    const st = (await getUserState())?.code;
    try {
      const r = await api.get('/courthouses', { params: { q, ...(st ? { state: st } : {}), limit: 10 } });
      if (mounted.current) setChResults(unwrapList(r.data));
    } catch (e) { showToast(apiErrorMessage(e, 'Could not search courthouses.'), 'error'); }
  };

  const save = async () => {
    if (savingRef.current) return;
    const d = date.trim(); const tm = time.trim();
    if (!DATE_RE.test(d)) { setFormError('Enter the date as YYYY-MM-DD, for example 2026-11-05.'); return; }
    if (tm && !TIME_RE.test(tm)) { setFormError('Enter the time as HH:MM (24-hour), for example 09:30 — or leave it empty.'); return; }
    if (!caseId && !caseTitle.trim()) { setFormError('Name this case (for example "DUI — Davidson County"), or pick one of your cases.'); return; }
    savingRef.current = true; setSaving(true); setFormError('');
    try {
      const st = (await getUserState())?.code;
      const body: Record<string, unknown> = {
        court_date: d, court_time: tm || undefined, hearing_type: hearing || undefined,
        courthouse_id: courthouse?.id, location: location.trim() || undefined,
      };
      if (caseId) body.case_id = caseId; else { body.case_title = caseTitle.trim(); if (st) body.state = st; }
      const tz = deviceTimeZone();
      const r = await api.post<CourtDate & { reminders: { deliver_at: string; days_before: number }[] }>('/court-dates', body, tz ? { headers: { 'X-Timezone': tz } } : undefined);
      const n = r.data.reminders?.length || 0;
      showToast(n ? `Saved. Reminders set: ${n === 4 ? '7 days, 3 days, 1 day before and the morning of' : `${n} reminder${n > 1 ? 's' : ''}`}.` : 'Saved. This date has passed, so it is in your archive.', 'success');
      saveCoreProgress({ mark: 'court' }).catch(() => {});
      setAdding(false);
      setDate(''); setTime(''); setHearing(''); setCourthouse(null); setLocation(''); setCaseTitle(''); setChResults([]); setChQuery('');
      requestNotificationsInContext().catch(() => {});
      await load();
      (navigation as any).navigate('CourtDateDetail', { id: r.data.id });
    } catch (e: any) {
      setFormError(e?.response?.status === 409 ? 'This court date is already saved.' : apiErrorMessage(e, 'Could not save the court date.'));
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  const follow = async () => {
    const c = code.trim();
    if (c.replace(/[^A-Za-z0-9]/g, '').length < 10) { showToast('Enter the 10-character code your family member shared.', 'warning'); return; }
    setFollowingBusy(true);
    try {
      await api.post('/following/accept', { code: c });
      showToast('You now follow their court dates. You will get the same reminders.', 'success');
      setCode('');
      load();
    } catch (e) { showToast(apiErrorMessage(e, 'That code did not work.'), 'error'); }
    finally { if (mounted.current) setFollowingBusy(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await load(); if (mounted.current) setRefreshing(false); };

  const Row = ({ d }: { d: CourtDate }) => (
    <TouchableOpacity accessibilityRole="button" testID="court-date-row" style={[styles.row, d.archived && styles.rowPast]}
      accessibilityLabel={`${d.case_title}, court on ${formatCourtDay(d.court_date)}${d.court_time_label ? ` at ${d.court_time_label}` : ''}`}
      onPress={() => (navigation as any).navigate('CourtDateDetail', { id: d.id })}>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowDate}>📅 {formatCourtDay(d.court_date)}{d.court_time_label ? ` · ${d.court_time_label}` : ''}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{d.case_title}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
        {[d.hearing_type ? HEARING_LABELS[d.hearing_type] || d.hearing_type : null, d.courthouse?.name, d.archived ? (d.status === 'scheduled' ? 'Past' : d.status) : null].filter(Boolean).join(' · ')}
      </Text>
    </TouchableOpacity>
  );

  if (signedIn === false) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="court-dates-screen">
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('ja_s3')}</Text>
        <View style={styles.box} testID="court-dates-sign-in">
          <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>🔐 {t('ja_court_signin')}</Text>
          <TouchableOpacity accessibilityRole="button" testID="court-dates-register" style={styles.primaryBtn} onPress={() => (navigation as any).navigate('Register')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ja_create')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="court-dates-login" style={styles.secondaryBtn} onPress={() => (navigation as any).navigate('Login')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('ja_sign_in')}</Text>
          </TouchableOpacity>
        </View>
        <GuidanceView g={guidance} which={showMissed ? 'both' : 'checklist'} styles={styles} />
        {!showMissed && (
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setShowMissed(true)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ {t('ja_missed')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen} testID="court-dates-screen">
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('ja_my_court_dates')}</Text>
        {phase === 'offline' && (
          <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="court-dates-offline">
            📴 Offline — showing the court dates saved on this phone{savedAt ? ` (saved ${new Date(savedAt).toLocaleString()})` : ''}.
          </Text>
        )}
        <TouchableOpacity accessibilityRole="button" testID="court-date-add" style={[styles.primaryBtn, phase === 'offline' && { opacity: 0.5 }]} onPress={openAdd} disabled={phase === 'offline'}>
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>＋ Add a court date</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.muted}>We remind you 7 days, 3 days and 1 day before, and the morning of. Add each date to your phone calendar too.</Text>

        {phase === 'loading' && <ActivityIndicator style={{ marginVertical: 20 }} color={colors.textBrand} accessibilityLabel="Loading court dates" />}
        {phase === 'error' && (
          <View style={styles.box} testID="court-dates-error">
            <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{errorMsg}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={load}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        {(phase === 'ok' || phase === 'offline') && list && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.group}>Upcoming ({list.upcoming.length})</Text>
            {list.upcoming.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="court-dates-empty">No upcoming court dates saved.</Text>}
            {list.upcoming.map(d => <Row key={d.id} d={d} />)}
            {list.past.length > 0 && (
              <TouchableOpacity accessibilityRole="button" testID="court-dates-past-toggle" style={styles.secondaryBtn} onPress={() => setShowPast(v => !v)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{showPast ? 'Hide' : 'Show'} past court dates ({list.past.length})</Text>
              </TouchableOpacity>
            )}
            {showPast && list.past.map(d => <Row key={d.id} d={d} />)}
          </>
        )}

        {(phase === 'ok' || phase === 'offline') && (
          <View testID="following-section">
            <Text maxFontSizeMultiplier={1.4} style={styles.group}>👨‍👩‍👧 Family you follow</Text>
            {following.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.muted}>When a family member shares their court dates with you, they show here — never their case notes.</Text>}
            {following.map(f => (
              <View key={f.follow_id} style={styles.row} testID="following-case">
                <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{f.owner_first_name ? `${f.owner_first_name}: ` : ''}{f.case_title}</Text>
                {f.court_dates.filter(d => !d.is_past).map(d => (
                  <Text key={d.id} maxFontSizeMultiplier={1.4} style={styles.rowDate} testID="following-court-date">
                    📅 {formatCourtDay(d.court_date)}{d.court_time_label ? ` · ${d.court_time_label}` : ''}{d.courthouse ? ` · ${d.courthouse.name}` : ''}
                  </Text>
                ))}
              </View>
            ))}
            {phase === 'ok' && (
              <View style={styles.followRow}>
                <TextInput accessibilityLabel="Invite code from your family member" testID="follow-code-input" style={styles.input}
                  placeholder="Invite code" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={code} onChangeText={setCode} />
                <TouchableOpacity accessibilityRole="button" testID="follow-code-submit" style={styles.goBtn} onPress={follow} disabled={following_}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{following_ ? '…' : 'Follow'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <GuidanceView g={guidance} which={showMissed ? 'both' : 'checklist'} styles={styles} />
        {!showMissed && (
          <TouchableOpacity accessibilityRole="button" testID="court-dates-missed" style={styles.secondaryBtn} onPress={() => setShowMissed(true)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>❓ {t('ja_missed')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)} accessibilityViewIsModal>
        <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="court-date-form">
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>Add a court date</Text>
          {cases.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>Case</Text>
              <View style={styles.chipsWrap}>
                {cases.slice(0, 8).map(c => (
                  <TouchableOpacity key={c.id} accessibilityRole="radio" accessibilityState={{ selected: caseId === c.id }} testID="court-form-case"
                    style={[styles.chip, caseId === c.id && styles.chipOn]} onPress={() => setCaseId(caseId === c.id ? null : c.id)}>
                    <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, caseId === c.id && styles.chipTextOn]}>{c.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {!caseId && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>Name this case</Text>
              <TextInput accessibilityLabel="Case name" testID="court-form-title" style={styles.inputFull} value={caseTitle} onChangeText={setCaseTitle}
                placeholder='e.g. "DUI — Davidson County"' placeholderTextColor={colors.textMuted} maxLength={300} />
            </>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Court date</Text>
          <TextInput accessibilityLabel="Court date, YYYY-MM-DD" testID="court-form-date" style={styles.inputFull} value={date} onChangeText={setDate}
            placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} maxLength={10} />
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Time (optional)</Text>
          <TextInput accessibilityLabel="Court time, HH:MM 24-hour, optional" testID="court-form-time" style={styles.inputFull} value={time} onChangeText={setTime}
            placeholder="HH:MM, e.g. 09:30" placeholderTextColor={colors.textMuted} maxLength={5} />
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Hearing (optional)</Text>
          <View style={styles.chipsWrap}>
            {HEARING_TYPES.map(h => (
              <TouchableOpacity key={h} accessibilityRole="radio" accessibilityState={{ selected: hearing === h }} testID={`court-form-hearing-${h}`}
                style={[styles.chip, hearing === h && styles.chipOn]} onPress={() => setHearing(hearing === h ? '' : h)}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, hearing === h && styles.chipTextOn]}>{HEARING_LABELS[h]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Courthouse (optional)</Text>
          {courthouse ? (
            <TouchableOpacity accessibilityRole="button" testID="court-form-courthouse-selected" style={styles.row} onPress={() => setCourthouse(null)}>
              <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>🏛️ {courthouse.name}  ✕</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.followRow}>
                <TextInput accessibilityLabel="Search courthouses by name or county" testID="court-form-courthouse-q" style={styles.input} value={chQuery}
                  onChangeText={setChQuery} onSubmitEditing={searchCourthouses} placeholder="Courthouse name or county" placeholderTextColor={colors.textMuted} />
                <TouchableOpacity accessibilityRole="button" testID="court-form-courthouse-search" style={styles.goBtn} onPress={searchCourthouses}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>Find</Text>
                </TouchableOpacity>
              </View>
              {chResults.map(c => (
                <TouchableOpacity key={c.id} accessibilityRole="button" testID="court-form-courthouse-option" style={styles.row} onPress={() => { setCourthouse({ id: c.id, name: c.name }); setChResults([]); }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{c.name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{c.address}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Room / courtroom (optional)</Text>
          <TextInput accessibilityLabel="Room or courtroom, optional" testID="court-form-location" style={styles.inputFull} value={location} onChangeText={setLocation}
            placeholder="e.g. Courtroom 4B" placeholderTextColor={colors.textMuted} maxLength={200} />
          {!!formError && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="court-form-error">{formError}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="court-form-save" style={styles.primaryBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>Save and set reminders</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setAdding(false)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

export const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { color: c.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 10 },
  group: { color: c.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  muted: { color: c.textSecond, fontSize: 14, lineHeight: 20, marginVertical: 6 },
  label: { color: c.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  offline: { color: c.warnDark, backgroundColor: c.warnBg, borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 8 },
  row: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border, minHeight: 48 },
  rowPast: { opacity: 0.8 },
  rowDate: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  rowTitle: { color: c.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 },
  rowSub: { color: c.textSecond, fontSize: 13, marginTop: 2 },
  box: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginVertical: 10, borderWidth: 1, borderColor: c.border },
  boxTitle: { color: c.textPrimary, fontSize: 17, fontWeight: '900', marginBottom: 6, marginTop: 4 },
  boxText: { color: c.textPrimary, fontSize: 16, lineHeight: 23 },
  boxStrong: { color: c.textPrimary, fontSize: 17, lineHeight: 24, fontWeight: '900' },
  source: { color: c.textMuted, fontSize: 11, lineHeight: 15 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center', minHeight: 52, marginTop: 8 },
  primaryBtnText: { color: c.white, fontSize: 17, fontWeight: '900' },
  secondaryBtn: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingVertical: 14, alignItems: 'center', minHeight: 48, marginTop: 8 },
  secondaryBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  followRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  inputFull: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  goBtn: { backgroundColor: c.navy, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', minHeight: 48 },
  goBtnText: { color: c.white, fontSize: 15, fontWeight: '800' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: c.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipText: { color: c.textPrimary, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.white },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginTop: 10 },
});

export default React.memo(CourtDatesScreen);
