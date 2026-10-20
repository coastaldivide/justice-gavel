/**
 * CaseScreen — "My cases": the person's cases and everything hanging off them.
 *
 * Tabs
 *   My cases  each case card: status, next court date + countdown, "Remind me",
 *             a short notes preview, and its actions — Edit, Court dates &
 *             reminders, Timeline, Messages, Documents, Invite family, Share the
 *             court date, Export, Discovery (open cases) / Expungement and
 *             civil-rights review (closed cases). Cases family members shared
 *             with me (court dates only) are listed below.
 *   Messages  one row per case thread with its unread count (GET /messages/threads)
 *   Tools     case-aware tools (AI, motions, discovery, research, voice notes,
 *             interpreter, deadline calculator)
 *   Lawyers   saved lawyers
 *
 * The editor (a modal): title, status, next court date (quick chips or
 * YYYY-MM-DD), state, notes, document scan to pre-fill a new case, voice note
 * (existing cases: the modal closes first, then the voice note opens) and
 * "Delete case". Saving a court date plans the reminders on the server.
 * Offline, a NEW case (with its court date and state) is saved on the phone and
 * sent when the connection is back (services/offlineSync).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { AppIcon } from '../components/AppIcon';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { useTheme } from '../constants/theme';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { planCourtReminders, formatReminderTime } from '../services/reminders';
import { pollJob } from '../services/jobPoller';
import { requestNotificationsInContext } from '../services/permissions';
import { cacheAgeLabel, cacheCases, cacheSavedLawyers, getCachedCases, getCachedLawyers } from '../services/offlineCache';
import { saveCaseOffline, getOfflineCases, startSyncListener, processSyncQueue } from '../services/offlineSync';
import { formatCourtDay } from '../services/corePath';
import { escapeHtml } from '../utils/html';
import { daysUntil, toLocalISODate, validCourtDate } from '../utils/dateUtils';
import { ScreenCapture, RNShare, COPIED_ACTION, Print, Share } from '../utils/webCompat';
import * as secureStorage from '../utils/secureStorage';
import { SignInNeeded } from '../components/SignInNeeded';
import { t, useLang, locale } from '../i18n';

// Stored status values (English, as the server records them); shown through statusLabel().
const STATUS_OPTIONS = ['Open', 'Active', 'Pending', 'Closed', 'Dismissed']; // i18n-exempt: stored values
const STATUS_KEYS: Record<string, string> = {
  Open: 'case_status_open', Active: 'case_status_active', Pending: 'case_status_pending',
  Closed: 'case_status_closed', Dismissed: 'case_status_dismissed',
};
export const statusLabel = (s: string | null | undefined): string => (s && STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : String(s ?? ''));
const OPEN_STATUSES = ['Open', 'Active', 'Pending']; // i18n-exempt: stored values
const CLOSED_STATUSES = ['Closed', 'Dismissed']; // i18n-exempt: stored values
const STATE_RE = /^[A-Z]{2}$/;

export interface Case {
  id: number; title: string; status: string; next_court_date: string | null;
  notes: string; created_at: string; state?: string | null; charge?: string | null;
}
interface Thread { case_id: number; title: string; status: string; unread: number; last_message_at: string | null; counsel_count: number; role: string }
interface DirectThread { user_id: number; name: string | null; last_message: string; last_from_me: boolean; last_at: string; unread: number }
interface SavedLawyer { id: number; provider_id?: number; name?: string; address?: string; specialties?: string[] }
type Draft = { id?: number; title: string; status: string; next_court_date: string; state: string; notes: string };

/** Pre-fill fields from the document scan (structured `_intake`, JSON text, or free text). */
export function parseScanResult(raw: string, data: Record<string, unknown>): { title: string; state: string; courtDate: string; notes: string } {
  const pick = (o: Record<string, unknown>, ...k: string[]) => String(k.map(x => o[x]).find(v => typeof v === 'string' && v) || '');
  const intake = data._intake as Record<string, unknown> | undefined;
  if (intake) {
    return {
      title: pick(intake, 'title', 'charge'), state: pick(intake, 'state').toUpperCase().slice(0, 2),
      courtDate: pick(intake, 'court_date'),
      notes: [intake.defendant_name ? `${t('x_cs_scan_defendant')}: ${intake.defendant_name}` : '', pick(intake, 'notes')].filter(Boolean).join('\n'),
    };
  }
  try {
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim()) as Record<string, unknown>;
    return { title: pick(json, 'title', 'case_title', 'charge'), state: pick(json, 'state', 'jurisdiction').toUpperCase().slice(0, 2),
      courtDate: pick(json, 'court_date', 'hearing_date'), notes: pick(json, 'notes', 'summary') || raw };
  } catch { /* free text below */ }
  const title = (raw.match(/charge[d]?\s*(?:with|:)?\s*([^.]+)/i)?.[1] || '').slice(0, 80).trim();
  const st = raw.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/);
  let courtDate = raw.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] || '';
  if (courtDate.includes('/')) {
    const [m, d, y] = courtDate.split('/');
    courtDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return { title, state: st?.[1] || '', courtDate, notes: String(data.summary || raw.slice(0, 400)) };
}

/** Text for "Share court date": the day (and the case name) — no link, no notes. */
export function courtDateShareText(c: Pick<Case, 'title' | 'next_court_date'>): string {
  return t('cs2_share_text', { title: c.title, date: formatCourtDay(String(c.next_court_date).slice(0, 10)) });
}

/** The case summary for printing / PDF (escaped; notes included — it is the owner's own export). */
export function caseSummaryHtml(c: Case): string {
  const h = (k: string, p?: Record<string, string | number>) => escapeHtml(t(k, p));
  const date = new Date().toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' });
  return `<!DOCTYPE html><html lang="${escapeHtml(locale())}"><head><meta charset="utf-8"><title>${escapeHtml(c.title)}</title>
<style>body{font-family:Georgia,serif;padding:40px;max-width:680px;margin:0 auto;color:#1C1C1E}h1{color:#1B2A6B;font-size:24px;border-bottom:2px solid #1B2A6B;padding-bottom:12px}
h2{color:#1B2A6B;font-size:16px;margin-top:28px}.meta{color:#6B7280;font-size:13px}.field{margin-bottom:10px;font-size:14px}.label{font-weight:700;color:#374151}
.notes{background:#F9FAFB;border-left:3px solid #1B2A6B;padding:12px;font-size:13px;line-height:1.6;white-space:pre-wrap}.footer{margin-top:48px;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:12px}</style></head><body>
<h1>${escapeHtml(c.title) || h('x_cs_case_summary')}</h1><div class="meta">${h('x_cs_pdf_exported', { date })}</div>
<h2>${h('x_cs_pdf_case_details')}</h2>
<div class="field"><span class="label">${h('x_cs_pdf_status')}</span> ${escapeHtml(statusLabel(c.status))}</div>
<div class="field"><span class="label">${h('x_cs_pdf_next_court_date')}</span> ${c.next_court_date ? escapeHtml(formatCourtDay(String(c.next_court_date).slice(0, 10))) : h('x_cs_not_set')}</div>
<div class="field"><span class="label">${h('x_cs_pdf_state')}</span> ${escapeHtml(c.state || t('x_cs_not_specified'))}</div>
${c.charge ? `<div class="field"><span class="label">${h('x_cs_pdf_charges')}</span> ${escapeHtml(c.charge)}</div>` : ''}
${c.notes ? `<h2>${h('x_cs_pdf_notes')}</h2><div class="notes">${escapeHtml(c.notes)}</div>` : ''}
<div class="footer">${h('x_cs_pdf_footer')}</div></body></html>`;
}

// ── Case card ─────────────────────────────────────────────────────────────────
interface CardProps {
  item: Case & { _offline?: boolean }; styles: ReturnType<typeof makeStyles>; colors: any; unread: number;
  onEdit: (c: Case) => void; onAction: (action: string, c: Case) => void; onRemind: (c: Case) => void;
}
const CaseCard = React.memo(function CaseCard({ item, styles, colors, unread, onEdit, onAction, onRemind }: CardProps) {
  useLang();
  const date = item.next_court_date ? String(item.next_court_date).slice(0, 10) : null;
  const days = date ? daysUntil(date) : null;
  const open = OPEN_STATUSES.includes(item.status);
  const closed = CLOSED_STATUSES.includes(item.status);
  const Action = ({ id, icon, label, badge }: { id: string; icon: string; label: string; badge?: number }) => (
    <TouchableOpacity accessibilityRole="button" testID={`case-action-${id}`} style={styles.action} onPress={() => onAction(id, item)}
      accessibilityLabel={badge ? `${label} (${badge})` : label}>
      <Text maxFontSizeMultiplier={1.3} style={styles.actionText} numberOfLines={2}>{icon} {label}{badge ? ` · ${badge}` : ''}</Text>
    </TouchableOpacity>
  );
  return (
    <View testID="case-card" style={styles.card}>
      <View style={styles.cardTop}>
        <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle} numberOfLines={3}>{item.title}</Text>
        <View style={styles.statusBadge}><Text maxFontSizeMultiplier={1.3} style={styles.statusText}>{statusLabel(item.status)}</Text></View>
      </View>
      {item._offline ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="case-card-offline">⏳ {t('cs2_waiting_to_sync')}</Text>
      ) : (
        <>
          {date ? (
            <View style={[styles.courtRow, days !== null && days >= 0 && days <= 7 && styles.courtRowUrgent]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.courtText} testID="case-court-date-label">
                📅 {formatCourtDay(date)}
                {days !== null && days >= 0 ? `  (${days === 0 ? t('x_cs_today') : days === 1 ? t('x_cs_tomorrow') : t('x_cs_days', { days })})` : ''}
              </Text>
              {open && (
                <TouchableOpacity accessibilityRole="button" testID="case-remind-me" style={styles.remindBtn} onPress={() => onRemind(item)}
                  accessibilityLabel={t('x_cs_set_court_date_reminder')}>
                  <AppIcon name="notifications-outline" size={18} color={colors.textBrand} />
                  <Text maxFontSizeMultiplier={1.3} style={styles.remindText}>{t('x_cs_remind_me')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cs2_no_court_date')}</Text>
          )}
          {!!item.notes && <Text maxFontSizeMultiplier={1.4} style={styles.notesPreview} numberOfLines={3}>{item.notes}</Text>}
          <Text maxFontSizeMultiplier={1.3} style={styles.created}>
            {t('x_cs_created', { value: new Date(item.created_at || 0).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) })}
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" testID="case-edit" style={[styles.action, styles.actionPrimary]} onPress={() => onEdit(item)}
              accessibilityLabel={t('cs2_edit_a11y', { title: item.title })}>
              <Text maxFontSizeMultiplier={1.3} style={styles.actionPrimaryText}>✏️ {t('x_cs_edit_case')}</Text>
            </TouchableOpacity>
            <Action id="court-dates" icon="📅" label={t('cs_court_dates')} />
            <Action id="timeline" icon="🕑" label={t('cs2_act_timeline')} />
            <Action id="messages" icon="💬" label={t('messages_title')} badge={unread} />
            <Action id="documents" icon="📎" label={t('cs2_documents')} />
            <Action id="invite" icon="👨‍👩‍👧" label={t('cs_invite_family')} />
            {!!date && <Action id="share" icon="📤" label={t('cs2_share_date')} />}
            <Action id="export" icon="🖨" label={t('cs2_act_export')} />
            {open && <Action id="discovery" icon="🔍" label={t('cs2_act_discovery')} />}
            {closed && <Action id="expungement" icon="🧹" label={t('cs2_act_expunge')} />}
            {closed && <Action id="civil-rights" icon="⚖️" label={t('cs2_act_rights')} />}
          </View>
        </>
      )}
    </View>
  );
});

// ── Screen ────────────────────────────────────────────────────────────────────
function CaseScreen({ navigation }: any) {
  useLang();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { gated, unlocking, unlock } = useBiometricGate('case_screen');

  // Sensitive screen: no screenshots on Android/iOS (no-op on web).
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const [tab, setTab] = useState<'cases' | 'messages' | 'tools' | 'lawyers'>('cases');
  const [cases, setCases] = useState<Case[]>([]);
  const [casesState, setCasesState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [cacheAge, setCacheAge] = useState('');
  const [offlineCases, setOfflineCases] = useState<(Case & { _offline: true })[]>([]);
  const [familyCases, setFamilyCases] = useState<{ id: number; title: string; owner_name?: string; next_court_date?: string | null }[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsState, setThreadsState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [nextReminder, setNextReminder] = useState<{ count: number; title?: string; deliver_at?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const [saved, setSaved] = useState<SavedLawyer[]>([]);
  const [lawyersState, setLawyersState] = useState<'idle' | 'loading' | 'ok' | 'guest' | 'offline' | 'error'>('idle');
  const [lawyersAge, setLawyersAge] = useState('');

  // editor
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const saveGuard = useRef(false);

  // family invite
  const [inviteCase, setInviteCase] = useState<Case | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteConsent, setInviteConsent] = useState(false);
  const [inviteCode, setInviteCode] = useState<{ code: string; message?: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const [direct, setDirect] = useState<DirectThread[]>([]);
  const unreadByCase = useMemo(() => new Map(threads.map(th => [th.case_id, th.unread])), [threads]);
  const totalUnread = useMemo(() => threads.reduce((n, th) => n + th.unread, 0) + direct.reduce((n, d) => n + d.unread, 0), [threads, direct]);

  const loadThreads = useCallback(async () => {
    if (!(await secureStorage.getToken().catch(() => null))) { if (mounted.current) { setThreads([]); setDirect([]); setThreadsState('ok'); } return; }
    try {
      const [r, d] = await Promise.all([
        api.get<{ threads: Thread[] }>('/messages/threads'),
        api.get<{ threads: DirectThread[] }>('/messages/direct/threads').catch(() => null),
      ]);
      if (mounted.current) { setThreads((r.data?.threads || []).filter(th => th.role === 'client')); setDirect(d?.data?.threads || []); setThreadsState('ok'); }
    } catch { if (mounted.current) setThreadsState('error'); }
  }, []);

  const load = useCallback(async () => {
    // Signed out: nothing to load (no 401s); the screen offers to sign in.
    if (!(await secureStorage.getToken().catch(() => null))) {
      if (!mounted.current) return;
      setSignedOut(true); setCases([]); setFamilyCases([]); setThreads([]); setThreadsState('ok'); setNextReminder(null); setCasesState('ok');
      return;
    }
    const [mine, fam] = await Promise.allSettled([api.get('/cases'), api.get('/cases/family')]);
    if (!mounted.current) return;
    setSignedOut(false);
    if (mine.status === 'fulfilled') {
      const list = unwrapList<Case>(mine.value.data, 'cases');
      setCases(list); setCasesState('ok');
      // Offline copy: titles, dates and status only — never notes.
      cacheCases(list.map(c => ({ id: c.id, title: c.title, status: c.status, next_court_date: c.next_court_date, state: c.state, created_at: c.created_at }))).catch(() => undefined);
    } else {
      const status = (mine.reason as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) { setCases([]); setSignedOut(true); setCasesState('ok'); }
      else {
        const cached = (await getCachedCases().catch(() => null)) as { cases: Case[]; cachedAt: string | null; isCache: boolean } | null;
        if (cached?.isCache && cached.cases.length) { setCases(cached.cases); setCasesState('offline'); setCacheAge(cacheAgeLabel(cached.cachedAt)); }
        else setCasesState('error');
      }
    }
    if (fam.status === 'fulfilled') setFamilyCases(unwrapList(fam.value.data, 'cases'));
    const queued = (await getOfflineCases().catch(() => [])) as (Case & { _offline: true })[];
    if (mounted.current) setOfflineCases(queued);
    // The server answered, so we are online: send cases saved on the phone during a connection blip
    // (the network listener only fires when the device itself was offline).
    if (queued.length && mine.status === 'fulfilled') {
      const r = await processSyncQueue().catch(() => null);
      if (r?.synced && mounted.current) { loadRef.current(); return; }
    }
    loadThreads();
    api.get('/push/reminders').then(r => {
      const rows = unwrapList<{ title: string; deliver_at: string; type?: string }>(r.data, 'reminders');
      if (mounted.current) setNextReminder(rows.length ? { count: rows.length, title: rows[0].title, deliver_at: rows[0].deliver_at } : null);
    }).catch(() => { if (mounted.current) setNextReminder(null); });
  }, [loadThreads]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => startSyncListener(() => { loadRef.current(); }), []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => { if (mounted.current) setRefreshing(false); });
  }, [load]);

  const loadSaved = useCallback(async () => {
    setLawyersState('loading');
    if (!(await secureStorage.getToken().catch(() => null))) { setLawyersState('guest'); return; }
    try {
      const r = await api.get('/saved/lawyers');
      const list = unwrapList<SavedLawyer>(r.data, 'lawyers');
      if (!mounted.current) return;
      setSaved(list); setLawyersState('ok');
      cacheSavedLawyers(list).catch(() => {});
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) { setLawyersState('guest'); return; }
      const c = (await getCachedLawyers().catch(() => null)) as { lawyers: SavedLawyer[]; cachedAt: string | null; isCache: boolean } | null;
      if (c?.isCache) { setSaved(c.lawyers); setLawyersAge(cacheAgeLabel(c.cachedAt)); setLawyersState('offline'); }
      else setLawyersState('error');
    }
  }, []);

  // ── editor ────────────────────────────────────────────────────────────────
  const openNew = () => { setError(''); setEditing({ title: '', status: 'Open', next_court_date: '', state: '', notes: '' }); };
  const openEdit = useCallback((c: Case) => {
    setError('');
    setEditing({ id: c.id, title: c.title || '', status: c.status || 'Open', next_court_date: c.next_court_date ? String(c.next_court_date).slice(0, 10) : '',
      state: c.state || '', notes: c.notes || '' });
  }, []);
  const setField = (k: keyof Draft, v: string) => setEditing(p => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!editing) return;
    const draft = { ...editing, title: editing.title.trim(), next_court_date: editing.next_court_date.trim(), state: editing.state.trim().toUpperCase() };
    if (!draft.title) { setError(t('x_cs_please_enter_case_title')); return; }
    if (draft.next_court_date && !validCourtDate(draft.next_court_date)) { setError(t('cs2_err_date')); return; }
    if (draft.state && !STATE_RE.test(draft.state)) { setError(t('cs2_err_state')); return; }
    if (saveGuard.current) return;   // a second tap before the re-render must not create a second case
    saveGuard.current = true; setSaving(true); setError('');
    const payload = { title: draft.title, status: draft.status, next_court_date: draft.next_court_date || null, state: draft.state || null, notes: draft.notes.trim() };
    try {
      const res = draft.id ? await api.put(`/cases/${draft.id}`, payload) : await api.post('/cases', payload);
      setEditing(null);
      const planned = unwrapList<{ deliver_at: string }>(res?.data?.reminders);
      if (planned.length) {
        showToast(t('x_cs_court_reminders_set_3', { value: planned.map(r => formatReminderTime(r.deliver_at)).join(' · ') }), 'success');
        requestNotificationsInContext().catch(() => 'declined');   // the moment notifications matter
      } else showToast(t('cs2_saved'), 'success');
      await load();
    } catch (e: any) {
      if (!e?.response && !draft.id) {
        // never reached the server: keep the new case on the phone and send it later
        try {
          await saveCaseOffline(payload);
          setEditing(null);
          showToast(t('cs2_saved_offline'), 'info');
          getOfflineCases().then(list => { if (mounted.current) setOfflineCases(list as (Case & { _offline: true })[]); }).catch(() => {});
          return;
        } catch { /* fall through to the error */ }
      }
      setError(!e?.response ? t('cs2_err_offline_edit') : apiErrorMessage(e, t('x_cs_could_not_save_try')));
    } finally {
      saveGuard.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    const ok = await confirm(t('cs2_delete_q'), t('cs2_delete_body', { title: editing.title }), { confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    try {
      await api.delete(`/cases/${editing.id}`);
      setEditing(null);
      showToast(t('cs2_deleted'), 'success');
      await load();
    } catch (e) { setError(apiErrorMessage(e, t('cs2_delete_failed'))); }
  };

  const openVoiceNote = () => {
    if (!editing?.id) return;
    const { id, title } = editing;
    setEditing(null);   // the voice note must not open underneath the editor
    navigation.navigate('VoiceNote', { caseId: id, caseTitle: title });
  };

  // ── document scan → pre-fill a new case ───────────────────────────────────
  const runScan = async (uri: string, mime: string, name: string) => {
    setScanning(true);
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        form.append('document', blob, name);
      } else form.append('document', { uri, type: mime, name } as any);
      form.append('doc_type', 'case_intake');
      const res = await api.post<{ jobId?: string }>('/discovery/analyze', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90_000 });
      if (!res.data?.jobId) throw new Error('no job');
      const job = await pollJob(res.data.jobId, { timeoutMs: 90_000 });
      if (job.status === 'failed' || !job.result) throw new Error(job.error || 'scan failed');
      const data = job.result as Record<string, unknown>;
      const parsed = parseScanResult(String(data.summary || data.raw || ''), data);
      if (parsed.title || parsed.state || parsed.notes) {
        setEditing(p => (p ? {
          ...p, title: parsed.title || p.title, state: STATE_RE.test(parsed.state) ? parsed.state : p.state,
          next_court_date: validCourtDate(parsed.courtDate) ? parsed.courtDate : p.next_court_date,
          notes: [p.notes, parsed.notes].filter(Boolean).join('\n').trim(),
        } : p));
        showToast(t('x_cs_fields_have_been_pre'), 'success');
      } else showToast(t('x_cs_document_read_specific_fields'), 'warning');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_cs_could_not_read_document')), 'error');
    } finally { if (mounted.current) setScanning(false); }
  };
  const pickScan = async (source: 'camera' | 'library') => {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      const ok = await confirm(t(source === 'camera' ? 'x_cs_camera_access_needed' : 'x_cs_photo_access_needed'),
        t(source === 'camera' ? 'x_cs_scan_documents_go_settings' : 'x_cs_attach_photos_go_settings'), { confirmLabel: t('x_cs_open_settings') });
      if (ok) Linking.openSettings().catch(() => showToast(t('action_failed'), 'error'));
      return;
    }
    const opts = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 0.85, allowsEditing: false };
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    await runScan(a.uri, a.mimeType || 'image/jpeg', a.fileName || 'scan.jpg');
  };
  const scan = async () => {
    if (Platform.OS === 'web') { pickScan('library'); return; }   // no camera capture in the browser
    const camera = await confirm(t('x_cs_scan_document_2'), t('x_cs_take_photo_choose_from'), { confirmLabel: t('x_cs_take_photo'), cancelLabel: t('x_cs_choose_library') });
    pickScan(camera ? 'camera' : 'library');
  };

  // ── card actions ──────────────────────────────────────────────────────────
  const remind = useCallback(async (c: Case) => {
    try {
      const planned = await planCourtReminders(c.id);
      showToast(planned.length ? t('x_cs_court_reminders_set', { when: planned.map(r => formatReminderTime(r.deliver_at)).join(' · ') }) : t('x_cs_court_reminders_set_2'), 'success');
      requestNotificationsInContext().catch(() => 'declined');
    } catch (e) { showToast(apiErrorMessage(e, t('x_cs_could_not_set_reminder')), 'error'); }
  }, [showToast]);

  const exportCase = useCallback(async (c: Case) => {
    const html = caseSummaryHtml(c);
    try {
      if (Platform.OS === 'web') { await Print.printAsync({ html }); return; }
      const file = await Print.printToFileAsync({ html });
      if (file?.uri) await Share.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: t('x_cs_export_case_summary') });
    } catch { showToast(t('x_cs_could_not_generate_pdf'), 'error'); }
  }, [showToast]);

  const onAction = useCallback(async (action: string, c: Case) => {
    switch (action) {
      case 'court-dates': navigation.navigate('CourtDates', { caseId: c.id }); break;
      case 'timeline': navigation.navigate('CaseTimeline', { caseId: c.id, caseTitle: c.title }); break;
      case 'messages': navigation.navigate('Messages', { caseId: c.id, caseTitle: c.title }); break;
      case 'documents': navigation.navigate('DocumentScanner', { caseId: c.id, caseTitle: c.title }); break;
      case 'discovery': navigation.navigate('Discovery', { caseId: c.id, caseTitle: c.title }); break;
      case 'expungement': navigation.navigate('Expungement', { case_id: c.id, state: c.state || undefined }); break;
      case 'civil-rights': navigation.navigate('PILead', { caseType: 'Civil Rights' }); break;
      case 'export': exportCase(c); break;
      case 'invite':
        setInviteCase(c); setInviteEmail(''); setInviteConsent(false); setInviteCode(null); setInviteError('');
        break;
      case 'share': {
        const r = await RNShare.share({ message: courtDateShareText(c), title: c.title }).catch(() => null);
        if (r?.action === COPIED_ACTION) showToast(t('cs2_copied'), 'success');
        break;
      }
    }
  }, [navigation, exportCase, showToast]);

  const sendInvite = async () => {
    if (!inviteConsent || !inviteCase) return;
    setInviting(true); setInviteError('');
    try {
      const r = await api.post(`/cases/${inviteCase.id}/followers`, { consent: true, email: inviteEmail.trim() ? inviteEmail.trim().toLowerCase() : undefined });
      setInviteCode({ code: String(r.data?.invite_code || ''), message: r.data?.share_message });
    } catch (e) { setInviteError(apiErrorMessage(e, t('cdd_invite_failed'))); }
    finally { if (mounted.current) setInviting(false); }
  };

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  // ── tab bodies ────────────────────────────────────────────────────────────
  const listAll = [...offlineCases, ...cases];
  const casesBody = casesState === 'loading' ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} accessibilityLabel={t('loading')} />
    : signedOut ? <SignInNeeded navigation={navigation} testID="case-sign-in" title={t('sin_cases_title')} body={t('sin_cases_body')} onSignedIn={load} />
    : casesState === 'error' ? (
      <View testID="case-load-error" style={styles.empty}>
        <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📶</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('x_cs_could_not_load_cases')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_check_connection_cases_safe')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={() => { setCasesState('loading'); load(); }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    ) : (
      <ScrollView testID="case-list" contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecond} />}>
        {casesState === 'offline' && (
          <View testID="case-list-offline" style={styles.banner}><Text maxFontSizeMultiplier={1.4} style={styles.bannerText}>{t('x_cs_offline_showing_court_dates', { casesCacheAge: cacheAge })}</Text></View>
        )}
        {offlineCases.length > 0 && (
          <View testID="case-offline-message" style={styles.banner}>
            <Text maxFontSizeMultiplier={1.4} style={styles.bannerText}>{t(offlineCases.length === 1 ? 'x_cs_case_saved_offline_will_one' : 'x_cs_case_saved_offline_will_other', { length: offlineCases.length })}</Text>
          </View>
        )}
        {!!nextReminder && casesState === 'ok' && (
          <TouchableOpacity accessibilityRole="button" testID="court-reminders-banner" style={styles.banner} onPress={() => navigation.navigate('CourtDates')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.bannerTitle}>
              📅 {t(nextReminder.count === 1 ? 'x_cs_upcoming_court_reminder_one' : 'x_cs_upcoming_court_reminder_other', { length: nextReminder.count })}
            </Text>
            {!!nextReminder.deliver_at && (
              <Text maxFontSizeMultiplier={1.4} style={styles.bannerText} numberOfLines={2}>{t('x_cs_next', { title: nextReminder.title || '', deliver_at: formatReminderTime(nextReminder.deliver_at) })}</Text>
            )}
          </TouchableOpacity>
        )}
        {listAll.length === 0 ? (
          <View testID="case-empty-state" style={styles.empty}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📁</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('case_empty_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_tap_new_case_start')}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={openNew}>
              <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('x_cs_create_first_case')}</Text>
            </TouchableOpacity>
          </View>
        ) : listAll.map(c => (
          <CaseCard key={String(c.id)} item={c} styles={styles} colors={colors} unread={unreadByCase.get(c.id) || 0}
            onEdit={openEdit} onAction={onAction} onRemind={remind} />
        ))}
        {familyCases.length > 0 && (
          <View testID="case-family-section">
            <Text maxFontSizeMultiplier={1.4} style={styles.section}>👨‍👩‍👧 {t('cs_shared_with_me', { n: familyCases.length })}</Text>
            {familyCases.map(fc => (
              <TouchableOpacity key={fc.id} accessibilityRole="button" style={styles.row} onPress={() => navigation.navigate('CourtDates')}
                accessibilityLabel={t('cs_shared_a11y', { title: fc.title })}>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle} numberOfLines={1}>{fc.title}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
                    {t('cs_from', { name: fc.owner_name || t('cs_family_member') })}
                    {fc.next_court_date ? ` · ${t('cs_court_on', { date: formatCourtDay(String(fc.next_court_date).slice(0, 10)) })}` : ''}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    );

  const messagesBody = signedOut ? <SignInNeeded navigation={navigation} testID="case-messages-sign-in" body={t('sin_messages_body')} onSignedIn={load} /> : (
    <ScrollView testID="case-messages-tab" contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={loadThreads} tintColor={colors.textSecond} />}>
      <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('cs2_messages_intro')}</Text>
      {threadsState === 'loading' && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />}
      {threadsState === 'error' && (
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_use_case_messages_could_not_load_messages')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={loadThreads}><Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('try_again')}</Text></TouchableOpacity>
        </View>
      )}
      {threadsState === 'ok' && threads.length === 0 && direct.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_messages_messages_live_inside_case')}</Text>}
      {direct.map(d => (
        <TouchableOpacity key={`d${d.user_id}`} accessibilityRole="button" testID="case-direct-row" style={styles.row}
          onPress={() => navigation.navigate('Messages', { directWith: d.user_id, directName: d.name || undefined })}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle} numberOfLines={1}>✉️ {d.name || t('ai_someone')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowSub} numberOfLines={1}>{d.last_from_me ? `${t('ai_you')}: ` : ''}{d.last_message}</Text>
          </View>
          {d.unread > 0 && <View style={styles.unread}><Text maxFontSizeMultiplier={1.2} style={styles.unreadText}>{d.unread > 9 ? '9+' : d.unread}</Text></View>}
          <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
      {threads.map(th => (
        <TouchableOpacity key={th.case_id} accessibilityRole="button" testID="case-thread-row" style={styles.row}
          onPress={() => navigation.navigate('Messages', { caseId: th.case_id, caseTitle: th.title })} accessibilityLabel={t('x_messages_open_messages', { title: th.title })}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle} numberOfLines={1}>{th.title}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>
              {th.counsel_count ? t('cs2_counsel_n', { n: th.counsel_count }) : t('cs2_no_counsel')}
              {th.last_message_at ? ` · ${new Date(th.last_message_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}` : ''}
            </Text>
          </View>
          {th.unread > 0 && <View style={styles.unread}><Text maxFontSizeMultiplier={1.2} style={styles.unreadText}>{th.unread > 9 ? '9+' : th.unread}</Text></View>}
          <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const activeCase = cases.find(c => ['Open', 'Active'].includes(c.status));
  const tools: { id: string; icon: string; title: string; sub: string; go: () => void }[] = [
    { id: 'ai', icon: '⚖️', title: t('case_ai_title'), sub: t('case_ai_sub'), go: () => navigation.navigate('ChatTab', {
      mode: 'defender', caseTitle: activeCase?.title,
      // i18n-exempt: context for the AI model (sent with the question, never shown)
      caseContext: activeCase ? [`Case: ${activeCase.title}`, `Status: ${activeCase.status}`, activeCase.next_court_date ? `Court date: ${String(activeCase.next_court_date).slice(0, 10)}` : null].filter(Boolean).join('\n') : null,
    }) },
    { id: 'motions', icon: '📄', title: t('x_cs_motion_library'), sub: t('case_motion_sub'), go: () => navigation.navigate('MotionLibrary', { caseId: activeCase?.id, caseTitle: activeCase?.title }) },
    { id: 'discovery', icon: '🔍', title: t('disc_title'), sub: t('case_discovery_sub'), go: () => navigation.navigate('Discovery', { caseId: activeCase?.id, caseTitle: activeCase?.title }) },
    { id: 'research', icon: '📚', title: t('legal_research'), sub: t('case_research_sub'), go: () => navigation.navigate('LegalResearch', { caseContext: activeCase?.title }) },
    { id: 'voice', icon: '🎙', title: t('x_cs_voice_notes'), sub: t('case_voice_sub'), go: () => navigation.navigate('VoiceNote', { caseId: activeCase?.id, caseTitle: activeCase?.title }) },
    { id: 'interpreter', icon: '🗣', title: t('translator_title'), sub: t('case_interpreter_sub'), go: () => navigation.navigate('Translator') },
    { id: 'deadlines', icon: '⏰', title: t('x_cs_deadline_calculator'), sub: t('x_cs_arraignment_appeal_aedpa_speedy'), go: () => navigation.navigate('DeadlineCalculator') },
  ];
  const toolsBody = (
    <ScrollView testID="case-tools-tab" contentContainerStyle={styles.scroll}>
      <Text maxFontSizeMultiplier={1.4} style={styles.section}>{t('case_tools_section')}</Text>
      {tools.map(x => (
        <TouchableOpacity key={x.id} accessibilityRole="button" testID={`case-tool-${x.id}`} style={styles.row} onPress={x.go} accessibilityLabel={x.title}>
          <Text maxFontSizeMultiplier={1.3} style={styles.toolIcon}>{x.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{x.title}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowSub}>{x.sub}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const lawyersBody = (
    <ScrollView testID="case-saved-lawyers" contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={loadSaved} tintColor={colors.textSecond} />}>
      {lawyersState === 'offline' && <View style={styles.banner}><Text maxFontSizeMultiplier={1.4} style={styles.bannerText}>{t('x_cs_offline_showing_saved_lawyers', { cacheAge: lawyersAge })}</Text></View>}
      {lawyersState === 'loading' && <ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} />}
      {lawyersState === 'guest' && (
        <SignInNeeded navigation={navigation} testID="case-lawyers-sign-in" title={t('x_cs_sign_see_saved_lawyers')} body={t('x_cs_lawyers_save_kept_account')} onSignedIn={loadSaved} />
      )}
      {lawyersState === 'error' && (
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_check_connection_cases_safe')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn} onPress={loadSaved}><Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('try_again')}</Text></TouchableOpacity>
        </View>
      )}
      {(lawyersState === 'ok' || lawyersState === 'offline') && saved.length === 0 && (
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('saved_empty_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_tap_lawyer_find_lawyer')}</Text>
        </View>
      )}
      {(lawyersState === 'ok' || lawyersState === 'offline') && saved.map(l => (
        <TouchableOpacity key={String(l.id)} accessibilityRole="button" style={styles.row} onPress={() => navigation.navigate('LawyerProfile', { lawyerId: l.provider_id ?? l.id })}
          accessibilityLabel={t('x_cs_open_profile', { value: l.name || t('x_cs_saved_lawyer') })}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle} numberOfLines={1}>{l.name || t('x_cs_saved_lawyer_2')}</Text>
            {!!(l.address || l.specialties?.length) && (
              <Text maxFontSizeMultiplier={1.4} style={styles.rowSub} numberOfLines={1}>{[l.address, Array.isArray(l.specialties) ? l.specialties.slice(0, 2).join(', ') : null].filter(Boolean).join(' · ')}</Text>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const TABS: { id: typeof tab; label: string; badge?: number }[] = [
    { id: 'cases', label: t('case_tab_cases') },
    { id: 'messages', label: t('messages_title'), badge: totalUnread },
    { id: 'tools', label: t('case_tab_tools') },
    { id: 'lawyers', label: t('x_cs_lawyers', { value: saved.length ? `(${saved.length})` : '' }) },
  ];

  return (
    <View testID="case-screen" style={styles.screen}>
      <View style={styles.tabRow} accessibilityRole="tablist">
        {TABS.map(x => (
          <TouchableOpacity key={x.id} accessibilityRole="tab" accessibilityState={{ selected: tab === x.id }} testID={`case-tab-${x.id}`}
            style={[styles.tabBtn, tab === x.id && styles.tabBtnOn]}
            onPress={() => { setTab(x.id); if (x.id === 'lawyers') loadSaved(); if (x.id === 'messages') loadThreads(); }}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.tabText, tab === x.id && styles.tabTextOn]} numberOfLines={1}>{x.label}</Text>
            {!!x.badge && <View style={styles.unread}><Text maxFontSizeMultiplier={1.2} style={styles.unreadText}>{x.badge > 9 ? '9+' : x.badge}</Text></View>}
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'cases' && (
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={1.3} style={styles.heading} accessibilityRole="header">{t('case_tab_cases')}</Text>
          {!signedOut && (
            <TouchableOpacity accessibilityRole="button" style={styles.addBtn} testID="case-add-button" onPress={openNew} accessibilityLabel={t('case_new')}>
              <Text maxFontSizeMultiplier={1.3} style={styles.addBtnText}>{t('case_new')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <View style={{ flex: 1 }}>
        {tab === 'cases' ? casesBody : tab === 'messages' ? messagesBody : tab === 'tools' ? toolsBody : lawyersBody}
      </View>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      <Modal visible={!!editing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)} accessibilityViewIsModal>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} testID="case-editor-close" style={styles.headerBtn} onPress={() => setEditing(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} numberOfLines={1}>{editing?.id ? t('x_cs_edit_case') : t('x_cs_new_case')}</Text>
            <TouchableOpacity accessibilityRole="button" testID="case-save" style={styles.headerBtn} onPress={save} disabled={saving} accessibilityLabel={t('case_save')}>
              {saving ? <ActivityIndicator color={colors.textBrand} /> : <Text maxFontSizeMultiplier={1.3} style={styles.modalSave}>{t('case_save')}</Text>}
            </TouchableOpacity>
          </View>
          {!!editing && (
            <ScrollView testID="case-editor" style={{ flex: 1 }} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              {!!error && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="case-editor-error">⚠ {error}</Text>}
              {!editing.id && (
                <TouchableOpacity accessibilityRole="button" testID="case-scan" style={[styles.scanBtn, scanning && { opacity: 0.6 }]} onPress={scan} disabled={scanning}
                  accessibilityLabel={t('x_cs_scan_document_auto_fill')}>
                  {scanning ? <ActivityIndicator color={colors.textOnNavy} /> : (
                    <>
                      <Text maxFontSizeMultiplier={1.3} style={styles.scanIcon}>📷</Text>
                      <View style={{ flex: 1 }}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.scanTitle}>{t('x_cs_scan_document_2')}</Text>
                        <Text maxFontSizeMultiplier={1.3} style={styles.scanSub}>{t('x_cs_auto_fill_from_charging')}</Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('case_title_label')} <Text style={{ color: colors.emergency }}>*</Text></Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('x_cs_describe_matter_briefly_e')}</Text>
              <TextInput testID="case-title-input" accessibilityLabel={t('case_title_label')} style={styles.input} value={editing.title}
                onChangeText={v => setField('title', v)} placeholder={t('x_cs_e_g_dui_arrest')} placeholderTextColor={colors.textMuted} maxLength={300} />

              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_cs_status')}</Text>
              <View style={styles.chips}>
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity key={s} accessibilityRole="radio" accessibilityState={{ selected: editing.status === s }} testID={`case-status-${s}`}
                    style={[styles.chip, editing.status === s && styles.chipOn]} onPress={() => setField('status', s)}>
                    <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, editing.status === s && styles.chipTextOn]}>{statusLabel(s)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_cs_next_court_date')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('x_cs_tap_quick_option_type')}</Text>
              <View style={styles.chips}>
                {[7, 14, 30, 60, 90].map(days => {
                  const d = new Date(); d.setDate(d.getDate() + days);
                  const iso = toLocalISODate(d);
                  return (
                    <TouchableOpacity key={days} accessibilityRole="button" testID="case-court-date" style={[styles.chip, editing.next_court_date === iso && styles.chipOn]}
                      onPress={() => setField('next_court_date', iso)} accessibilityLabel={formatCourtDay(iso)}>
                      <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, editing.next_court_date === iso && styles.chipTextOn]}>{t(`x_cs_${days}_days`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput testID="case-court-date-input" accessibilityLabel={t('x_cs_next_court_date')} style={styles.input} value={editing.next_court_date}
                onChangeText={v => setField('next_court_date', v)} placeholder={t('x_cs_yyyy_mm_dd_e')} placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation" maxLength={10} />
              {validCourtDate(editing.next_court_date) && <Text maxFontSizeMultiplier={1.4} style={styles.hint}>📅 {formatCourtDay(editing.next_court_date)}</Text>}

              <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_cs_state_2_letter_code')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('x_cs_used_expungement_eligibility_checks')}</Text>
              <TextInput testID="case-state-input" accessibilityLabel={t('x_cs_state_2_letter_code')} style={styles.input} value={editing.state}
                onChangeText={v => setField('state', v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} placeholder={t('x_cs_e_g_tn')}
                placeholderTextColor={colors.textMuted} autoCapitalize="characters" maxLength={2} />

              <View style={styles.notesHead}>
                <View style={{ flex: 1, minWidth: 160 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_cs_notes')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('x_cs_attorney_name_charges_hearing')}</Text>
                </View>
                {!!editing.id && (
                  <TouchableOpacity accessibilityRole="button" testID="case-voice-note" style={styles.smallChip} onPress={openVoiceNote} accessibilityLabel={t('x_cs_record_voice_note_this')}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.smallChipText}>🎙 {t('x_cs_voice_note_2')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TextInput testID="case-notes-input" accessibilityLabel={t('x_cs_notes')} style={[styles.input, styles.textArea]} value={editing.notes}
                onChangeText={v => setField('notes', v)} placeholder={t('x_cs_e_g_attorney_john')} placeholderTextColor={colors.textMuted} multiline maxLength={10_000} />
              <Text maxFontSizeMultiplier={1.4} style={styles.privacy}>🔒 {t('case_notes_privilege')}</Text>

              {!!editing.id && (
                <TouchableOpacity accessibilityRole="button" testID="case-delete" style={styles.deleteBtn} onPress={remove}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.deleteText}>🗑 {t('cs2_delete_btn')}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Family invite ──────────────────────────────────────────────── */}
      <Modal visible={!!inviteCase} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteCase(null)} accessibilityViewIsModal>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} style={styles.headerBtn} onPress={() => setInviteCase(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} numberOfLines={1}>{t('cdd_invite_title')}</Text>
            <View style={styles.headerBtn} />
          </View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" testID="case-invite">
            {inviteCode ? (
              <View testID="case-invite-code">
                <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('cs_give_code')}</Text>
                <Text selectable maxFontSizeMultiplier={1.2} style={styles.code}>{inviteCode.code}</Text>
                {!!inviteCode.message && (
                  <TouchableOpacity accessibilityRole="button" style={styles.primaryBtn}
                    onPress={async () => { const r = await RNShare.share({ message: inviteCode.message, title: t('cdd_share_title') }).catch(() => null); if (r?.action === COPIED_ACTION) showToast(t('cs2_copied'), 'success'); }}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>📤 {t('cdd_send_code')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.4} style={styles.hint}>{t('cs_invite_hint', { title: inviteCase?.title || '' })}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cdd_their_email')}</Text>
                <TextInput accessibilityLabel={t('cdd_email_a11y')} style={styles.input} value={inviteEmail} onChangeText={setInviteEmail}
                  placeholder={t('cs_email_placeholder')} placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: inviteConsent }} testID="case-invite-consent" style={styles.checkRow}
                  onPress={() => setInviteConsent(v => !v)}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.checkText}>{inviteConsent ? '☑' : '☐'} {t('cs_invite_consent')}</Text>
                </TouchableOpacity>
                {!!inviteError && <Text maxFontSizeMultiplier={1.4} style={styles.error}>⚠ {inviteError}</Text>}
                <TouchableOpacity accessibilityRole="button" testID="case-invite-create" style={[styles.primaryBtn, (!inviteConsent || inviting) && { opacity: 0.5 }]}
                  onPress={sendInvite} disabled={inviting || !inviteConsent}>
                  {inviting ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>👨‍👩‍👧 {t('cdd_create_code')}</Text>}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  tabRow: { flexDirection: 'row', backgroundColor: c.bgCard, borderBottomWidth: 1, borderBottomColor: c.border },
  tabBtn: { flex: 1, minHeight: 48, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  tabBtnOn: { borderBottomWidth: 3, borderBottomColor: c.textBrand },
  tabText: { color: c.textMuted, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  tabTextOn: { color: c.textBrand, fontWeight: '800' },
  header: { backgroundColor: c.navy, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { color: c.textOnNavy, fontSize: 22, fontWeight: '900', flexShrink: 1 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  addBtnText: { color: c.textOnNavy, fontWeight: '800', fontSize: 14 },
  card: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  cardTitle: { flex: 1, color: c.textPrimary, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  statusBadge: { borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.bgSubtle, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: c.textPrimary, fontSize: 12, fontWeight: '700' },
  courtRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: c.bgSubtle, borderRadius: 10, padding: 10, marginBottom: 8 },
  courtRowUrgent: { backgroundColor: c.warnBg, borderWidth: 1, borderColor: c.warnDark },
  courtText: { color: c.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  remindBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 8 },
  remindText: { color: c.textBrand, fontSize: 13, fontWeight: '700' },
  notesPreview: { color: c.textSecond, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  created: { color: c.textMuted, fontSize: 12, marginBottom: 8 },
  muted: { color: c.textSecond, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: '45%', minHeight: 44, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 8 },
  actionText: { color: c.textPrimary, fontSize: 13, fontWeight: '700' },
  actionPrimary: { flexBasis: '100%', backgroundColor: c.navy, borderColor: c.navy },
  actionPrimaryText: { color: c.textOnNavy, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  banner: { backgroundColor: c.infoBg, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 12 },
  bannerTitle: { color: c.textPrimary, fontSize: 14, fontWeight: '800' },
  bannerText: { color: c.textPrimary, fontSize: 13, lineHeight: 18 },
  section: { color: c.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 8, minHeight: 52 },
  rowTitle: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
  rowSub: { color: c.textSecond, fontSize: 13, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: 20 },
  toolIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  unread: { backgroundColor: c.emergency, borderRadius: 10, minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  unreadText: { color: c.white, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 10 },
  emptyTitle: { color: c.textBrand, fontSize: 19, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  emptySub: { color: c.textSecond, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 16 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, minHeight: 48, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnText: { color: c.textOnNavy, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  modalRoot: { flex: 1, backgroundColor: c.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, minHeight: 56, backgroundColor: c.bgCard, borderBottomWidth: 1, borderBottomColor: c.border },
  headerBtn: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalClose: { color: c.textMuted, fontSize: 20 },
  modalTitle: { color: c.textBrand, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  modalSave: { color: c.textBrand, fontSize: 16, fontWeight: '800' },
  form: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  error: { color: c.textPrimary, backgroundColor: c.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 10 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.navy, borderRadius: 12, padding: 14, minHeight: 56, marginBottom: 6 },
  scanIcon: { fontSize: 22 },
  scanTitle: { color: c.textOnNavy, fontSize: 15, fontWeight: '800' },
  scanSub: { color: c.textOnNavy, fontSize: 12, opacity: 0.8 },
  label: { color: c.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 14, marginBottom: 4 },
  hint: { color: c.textSecond, fontSize: 13, lineHeight: 18, marginBottom: 6 },
  input: { backgroundColor: c.inputBg || c.bgCard, color: c.inputText || c.textPrimary, borderWidth: 1.5, borderColor: c.inputBorder || c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, fontSize: 16 },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderRadius: 20, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bgCard, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipText: { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: c.textOnNavy, fontWeight: '800' },
  notesHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  smallChip: { borderRadius: 18, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bgCard, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', marginBottom: 6 },
  smallChipText: { color: c.textPrimary, fontSize: 13, fontWeight: '700' },
  privacy: { color: c.textSecond, fontSize: 12, lineHeight: 18, marginTop: 10 },
  deleteBtn: { marginTop: 24, borderRadius: 12, borderWidth: 1.5, borderColor: c.emergency, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: c.emergency, fontSize: 15, fontWeight: '800' },
  code: { color: c.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: 3, marginVertical: 12 },
  checkRow: { paddingVertical: 10, minHeight: 44 },
  checkText: { color: c.textPrimary, fontSize: 14, lineHeight: 20 },
});

export default React.memo(CaseScreen);
