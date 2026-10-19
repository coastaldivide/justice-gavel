import { useConfirm } from '../hooks/useConfirm';
import { requestNotificationsInContext } from '../services/permissions';
import { escapeHtml } from '../utils/html';
import { useToast } from '../components/ToastProvider';
// T4-05: wrap heavy useEffect bodies with InteractionManager.runAfterInteractions
import { AppIcon } from '../components/AppIcon';

import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenCapture, RNShare } from '../utils/webCompat';
import type {} from '../types/navigation';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Linking, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, LayoutAnimation } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { planCourtReminders, formatReminderTime } from '../services/reminders';
import { cacheAgeLabel, cacheSavedLawyers, getCachedLawyers, cacheCases, getCachedCases } from '../services/offlineCache';
import { t, useLang, locale }   from '../i18n';
import { formatCourtDay } from '../services/corePath';
import * as Calendar      from 'expo-calendar';
import * as ImagePicker   from 'expo-image-picker';
import { COLORS, RADIUS, useTheme } from '../constants/theme';
import * as secureStorage from '../utils/secureStorage';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { saveCaseOffline, getOfflineCases, startSyncListener } from '../services/offlineSync';
import Markdown from 'react-native-markdown-display';
import { daysUntil, formatDate, toLocalISODate } from '../utils/dateUtils';
const C_0A1929 = ('\x23' + '0A1929') as string; // hex color

const STATUS_COLORS: Record<string, string> = {
  Open: COLORS.blue, Active: COLORS.legalDark, Pending: COLORS.warnDark,
  Closed: COLORS.textMuted, Dismissed: COLORS.blue};
// Stored status values (English, as the server records them); shown through statusLabel().
const STATUS_OPTIONS = ['Open', 'Active', 'Pending', 'Closed', 'Dismissed']; // i18n-exempt: stored values
const STATUS_KEYS: Record<string, string> = {
  Open: 'case_status_open', Active: 'case_status_active', Pending: 'case_status_pending',
  Closed: 'case_status_closed', Dismissed: 'case_status_dismissed',
};
export const statusLabel = (s: string | null | undefined): string => (s && STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : String(s ?? ''));

interface Case {
  state?:          string;
  id: number; title: string; status: string;
  next_court_date: string | null; notes: string; created_at: string;
}

const CaseCard = React.memo(function CaseCard({ item, onPress, navigation, onCalendar, onShare, onInvite, onExport }: any) {
  useLang();
  const { showToast } = useToast();
  const color = STATUS_COLORS[item.status] || COLORS.textMuted;
  const hasDate = !!item.next_court_date;
  const days = hasDate
    ? daysUntil(item.next_court_date) ?? Infinity
    : null;

  return (
    <TouchableOpacity
      accessibilityRole="button" testID="case-card" style={styles.card} onPress={onPress} activeOpacity={0.85}
     accessibilityLabel={item.title}>
      <View style={styles.cardTop}>
        <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

              {item.next_court_date && (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={{ flexDirection:'row', alignItems:'center', gap:4, paddingVertical:6,
                    marginTop:2 }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  testID="case-remind-me"
                  onPress={async () => {
                    try {
                      const planned = await planCourtReminders(item.id);
                      const when = planned.map(r => formatReminderTime(r.deliver_at));
                      showToast(when.length
                        ? t('x_cs_court_reminders_set', { when: when.join(' · ') })
                        : t('x_cs_court_reminders_set_2'), 'success');
                    } catch (e: any) {
                      showToast(apiErrorMessage(e, t('x_cs_could_not_set_reminder')), 'error');
                    }
                  }}
                  accessibilityLabel={t('x_cs_set_court_date_reminder')}
                >
                  <AppIcon name="notifications-outline" size={20} color={COLORS.navy} />
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color:COLORS.navy, fontWeight:'600' }}>{t('x_cs_remind_me')}</Text>
                </TouchableOpacity>
              )}
        <View style={[styles.statusBadge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statusText, { color }]}>{statusLabel(item.status)}</Text>
        </View>
      </View>
      {hasDate && (
        <View style={[styles.courtDateRow, days !== null && (days as number) <= 7 && styles.courtDateUrgent]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.courtDateIcon}>📅</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.courtDateText}>
            {t('x_cs_court', { next_court_date: formatDate(item.next_court_date, { month: 'short', day: 'numeric', year: 'numeric' }) })}
            {days !== null && (days as number) >= 0 && <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700' }}>  ({(days as number) === 0 ? t('x_cs_today') : (days as number) === 1 ? t('x_cs_tomorrow') : t('x_cs_days', { days })})</Text>}
          </Text>
        </View>
      )}
      {!!item.notes && <Markdown style={{ body: { fontSize:14, lineHeight:21, color:COLORS.textSecond } }}>{item.notes}</Markdown>}
      <Text maxFontSizeMultiplier={1.4}>{t('x_cs_created', { value: new Date(item.created_at ?? 0).toLocaleDateString() })}</Text>
      <TouchableOpacity
          accessibilityRole="button" testID="case-share-sheet"
        style={styles.shareBtn}
        onPress={() => onShare?.(item)}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>{t('x_cs_share_link')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button" testID="case-court-dates"
        style={styles.shareBtn}
        onPress={() => navigation.navigate('CourtDates', { caseId: item.id })}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>📅  {t('cs_court_dates')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.shareBtn, { borderColor: 'rgba(133,183,235,0.33)', backgroundColor: COLORS.bgCard }]}
        onPress={() => onInvite(item)}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.shareBtnText, { color: COLORS.info }]}>👨‍👩‍👧  {t('cs_invite_family')}</Text>
      </TouchableOpacity>
      {hasDate && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.calendarBtn}
          onPress={() => onCalendar(item)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.calendarBtnText}>{t('x_cs_add_calendar')}</Text>
        </TouchableOpacity>
      )}
      {['Open', 'Active', 'Pending'].includes(item.status) && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.discoveryBtn}
          onPress={() => navigation?.navigate('Discovery', {
            caseId: item.id, caseTitle: item.title
          })}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.discoveryBtnText}>{t('x_cs_analyze_discovery_docs')}</Text>
        </TouchableOpacity>
      )}
      {['Closed','Dismissed'].includes(item.status) && (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.bgSubtle }]}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'CaseTimeline',
              params: { caseId: item.id, caseTitle: item.title }
            })}
            accessibilityLabel={t('x_cs_view_case_timeline')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>{t('x_cs_view_timeline')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.bgSubtle }]}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'VoiceNote',
              params: { caseId: item.id, caseTitle: item.title }
            })}
            accessibilityLabel={t('x_cs_record_voice_note_this')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              {t('x_cs_voice_note')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.infoBg }]}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'DocumentScanner',
              params: { caseId: item.id }
            })}
            accessibilityLabel={t('x_cs_scan_document_attach_this')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              {t('x_cs_scan_document')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.bgSubtle }]}
            onPress={() => onExport?.(item)}
            accessibilityLabel={t('x_cs_export_full_case_summary')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              {t('x_cs_export_case_pdf')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.expungeBtn}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'Expungement',
              params: {
                case_id:        item.id,
                incomingState:  item.state || undefined,
                incomingCharges: item.charges || item.charge_type || undefined,
                caseTitle:      item.title || undefined}
            })}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>{t('x_cs_check_expungement_eligibility')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.civilRightsBtn}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'PILead',
              params: { caseType: 'Civil Rights' }
            })}
            accessibilityLabel={t('x_cs_were_rights_violated_submit')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.civilRightsBtnText}>{t('x_cs_were_rights_violated_get')}</Text>
          </TouchableOpacity>
        </>
      )}
    </TouchableOpacity>
  );
})

const DEEP_BG = C_0A1929;

const _HEX_CASE = {
  _c0: C_0A1929,
} as const;


// ── Parse AI scan response into case fields ─────────────────────────────────
function parseScanResult(raw: string, data: Record<string,unknown>): {
  title: string; state: string; courtDate: string; notes: string;
} {
  // Try structured JSON first (if AI returned JSON)
  // Check for structured _intake from case_intake branch
  if (data._intake) {
    const i = (data as any)._intake as import('../types/api').CaseIntake;
    return {
      title:     i.title || i.charge || '',
      state:     (i.state || '').toUpperCase().slice(0, 2),
      courtDate: i.court_date || '',
      notes:     [(i as any).defendant_name ? `Defendant: ${(i as any).defendant_name}` : '', (i as any).notes].filter(Boolean).join('')};
  }
  try {
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return {
      title:     json.title || json.case_title || json.charge || '',
      state:     (json.state || json.jurisdiction || '').toUpperCase().slice(0, 2),
      courtDate: json.court_date || json.hearing_date || '',
      notes:     json.notes || json.summary || raw};
  } catch (e: any) { __DEV__ && console.warn(e?.message); }

  // Fallback: pull key fields from free text
  const title     = (raw.match(/charge[d]?\s*(?:with|:)?\s*([^.]+)/i)?.[1] || '').slice(0, 80).trim();
  const stateMatch = raw.match(/(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)/);
  const dateMatch  = raw.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/);
  let courtDate   = dateMatch?.[1] || '';
  if (courtDate && courtDate.includes('/')) {
    const [m, d, y] = courtDate.split('/');
    courtDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // Use summary as notes if no structured data
  const notes = String((data as any).summary || raw.slice(0, 400));
  return { title, state: stateMatch?.[1] || '', courtDate, notes };
}

function CaseScreen({ route, navigation }: any) {
  useLang();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // Set navigation header title from route params
  React.useEffect(() => {
    const p = (route as any)?.params;
    if (p?.caseTitle) navigation.setOptions({ title: p.caseTitle });
  }, [navigation, route]);


  // Export full case summary as PDF
  const exportCasePDF = async (cas: Record<string, unknown>) => {
    try {
      const Print = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const date = new Date().toLocaleDateString(locale(), {
        year:'numeric', month:'long', day:'numeric'
      });
      const h = (k: string, p?: Record<string, string | number>) => escapeHtml(t(k, p));
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; padding: 40px; max-width: 680px; margin:0 auto; color: #1C1C1E; }
  h1 { color: #1B2A6B; font-size: 24px; border-bottom: 2px solid #1B2A6B; padding-bottom: 12px; }
  h2 { color: #1B2A6B; font-size: 16px; margin-top: 28px; margin-bottom: 8px; }
  .meta { color: #6B7280; font-size: 13px; margin-bottom: 24px; }
  .field { margin-bottom: 10px; font-size: 14px; }
  .label { font-weight: 700; color: #374151; }
  .notes { background: #F9FAFB; border-left: 3px solid #1B2A6B; padding: 12px; margin-top: 8px;
    font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .footer { margin-top: 48px; font-size: 11px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 12px; }
</style></head><body>
<h1>${escapeHtml(String(cas.title || '')) || h('x_cs_case_summary')}</h1>
<div class="meta">${h('x_cs_pdf_exported', { date })}</div>
<h2>${h('x_cs_pdf_case_details')}</h2>
<div class="field"><span class="label">${h('x_cs_pdf_status')}</span> ${escapeHtml(statusLabel(String(cas.status || 'Active')))}</div>
<div class="field"><span class="label">${h('x_cs_pdf_next_court_date')}</span> ${cas.next_court_date ? formatDate(String(cas.next_court_date), {month:'long', day:'numeric', year:'numeric'}) : h('x_cs_not_set')}</div>
<div class="field"><span class="label">${h('x_cs_pdf_state')}</span> ${escapeHtml(String(cas.state || t('x_cs_not_specified')))}</div>
${cas.charges ? `<div class="field"><span class="label">${h('x_cs_pdf_charges')}</span> ${escapeHtml(String(cas.charges || ''))}</div>` : ''}
${cas.bail_amount ? `<div class="field"><span class="label">${h('x_cs_pdf_bail_amount')}</span> $${Number(cas.bail_amount).toLocaleString(locale())}</div>` : ''}
${cas.notes ? `<h2>${h('x_cs_pdf_notes')}</h2><div class="notes">${escapeHtml(String(cas.notes || ''))}</div>` : ''}
<div class="footer">${h('x_cs_pdf_footer')}</div>
</body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('x_cs_export_case_summary'),
      });
    } catch {
      showToast(t('x_cs_could_not_generate_pdf'));
    }
  };

  // Offline case sync -- show locally created cases + sync on reconnect
  const loadRef = React.useRef<() => Promise<void>>(async () => {});
  const [offlineCases, setOfflineCases] = React.useState<any[]>([]);
  React.useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    getOfflineCases().then(setOfflineCases).catch(() => {});
    const unsub = startSyncListener((tempId) => {
      // Replace offline case with synced server case
      setOfflineCases(prev => prev.filter(c => c.id !== tempId));
      // Trigger a reload after brief delay (debounced to avoid rapid re-fires)
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { reloadTimer = null; loadRef.current(); }, 500);
    });
    return () => { unsub(); if (reloadTimer) clearTimeout(reloadTimer); };
  }, []);

  const { gated, unlocking, unlock } = useBiometricGate('case_screen');

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  // ── Autosave notes ──────────────────────────────────────────────────────
  const autoSaveTimer = React.useRef<ReturnType<typeof setTimeout>|null>(null);
  const autoSaveNotes = (text: string) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const id = editCaseIdRef.current;
      if (!id) return;
      try { await api.put(`/cases/${id}`, { notes: text }); } catch {}
    }, 1500);
  };

  const [cases, setCases]       = useState<Case[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<'cases'|'messages'|'tools'|'lawyers'>('cases'); // research merged into tools
  const [unreadCount, setUnreadCount] = useState(0);
  const [savedLawyers, setSavedLawyers] = useState<any[]>([]);
  const [lawyersLoading, setLawyersLoading] = useState(false);
  const [isGuest, setIsGuest]               = useState(false);
  const [isOffline, setIsOffline]           = useState(false);
  const [cacheAge, setCacheAge]             = useState('');
  const [upcomingReminders, setUpcomingReminders] = useState<any[]>([]);

  const loadSavedLawyers = useCallback(async () => {
    setLawyersLoading(true);
    setIsOffline(false);
    try {
      const token = await secureStorage.getToken();
      if (!token) {
        setIsGuest(true);
        setLawyersLoading(false);
        return;
      }
      setIsGuest(false);
      const res = await api.get('/saved/lawyers');
      const saved = unwrapList(res.data, 'lawyers');
      setSavedLawyers(saved);
      cacheSavedLawyers(saved).catch(() => {}); // write-through offline cache of saved lawyers
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        setIsGuest(true);
      } else {
        // Network error -- try offline cache
        const { lawyers, cachedAt, isCache } = (await getCachedLawyers()) as any;
        if (isCache) {
          setSavedLawyers(lawyers);
          setIsOffline(true);
          setCacheAge(cacheAgeLabel(cachedAt));
        }
      }
    } finally {
      setLawyersLoading(false);
    }
  }, []);
  const [modalVisible, setModal] = useState(false);
  const [editCase, setEditCase] = useState<Partial<Case>>({});
  const editCaseIdRef = React.useRef<number | undefined>(undefined);
  editCaseIdRef.current = editCase.id;
  useEffect(() => () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }, []);
  const [saving, setSaving]     = useState(false);
  const [scanning,      setScanning]      = useState(false);
  const [familyCases,   setFamilyCases]   = useState<any[]>([]);
  const [inviteModal,   setInviteModal]   = useState(false);
  const [inviteEmail,   setInviteEmail]   = useState('');
  const [invitingCase,  setInvitingCase]  = useState<Case|null>(null);
  const [inviting,      setInviting]      = useState(false);
  const [inviteError,   setInviteError]   = useState('');
  const [inviteConsent, setInviteConsent] = useState(false);
  const [inviteCode,    setInviteCode]    = useState<string | null>(null);
  const [error, setError]       = useState('');
  // Case list could not be loaded: 'offline' = showing this device's copy,
  // 'error' = nothing to show (never pretend there are "no cases").
  const [casesState, setCasesState] = useState<'ok' | 'offline' | 'error'>('ok');
  const [casesCacheAge, setCasesCacheAge] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [myRes, famRes] = await Promise.allSettled([
        api.get('/cases'),
        api.get('/cases/family'),
      ]);
      if (myRes.status === 'fulfilled') {
        const list = unwrapList<Case>(myRes.value.data, 'cases');
        setCases(list);
        setCasesState('ok');
        // Offline copy of court dates — titles/dates/status only, never notes.
        cacheCases(list.map(c => ({ id: c.id, title: c.title, status: c.status, next_court_date: c.next_court_date,
          state: c.state, charge: (c as { charge?: string }).charge, created_at: c.created_at }))).catch(() => undefined);
      } else {
        const status = (myRes.reason as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) { setCases([]); setCasesState('ok'); }
        else {
          const cached = (await getCachedCases().catch(() => null)) as { cases: Case[]; cachedAt: string | null; isCache: boolean } | null;
          if (cached?.isCache && cached.cases.length) {
            setCases(cached.cases); setCasesState('offline'); setCasesCacheAge(cacheAgeLabel(cached.cachedAt));
          } else setCasesState('error');
        }
      }
      if (famRes.status === 'fulfilled') setFamilyCases(unwrapList(famRes.value.data, 'cases'));
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    api.get('/push/reminders').then(r => setUpcomingReminders(unwrapList(r.data, 'reminders'))).catch((e) => { __DEV__ && console.warn(e?.message); });
    setLoading(false);
  }, []);

  loadRef.current = load;
  // Load on focus: keeps cases fresh when returning from the timeline / other screens.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Unread message badge
  useEffect(() => {
    api.get('/messages/unread/count')
      .then(r => setUnreadCount(r.data?.count || 0))
      .catch((e) => { __DEV__ && console.warn(e?.message); });
  }, []);

  const openNew = () => {
    setEditCase({ title: '', status: 'Open', next_court_date: '', notes: '', state: '' });
    setError('');
    setModal(true);
  };

  const openEdit = (c: Case) => {
        setEditCase({ ...c, next_court_date: c.next_court_date || '' });
    setError('');
    setModal(true);
  };

  const saveGuard = React.useRef(false);
  const save = useCallback(async () => {
    if (!editCase.title?.trim()) { setError(t('x_cs_please_enter_case_title')); return; }
    // Ref guard: a second tap before the re-render must not create a second case.
    if (saveGuard.current) return;
    saveGuard.current = true;
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: (editCase.title ?? '').trim(),
        status: editCase.status || 'Open',
        next_court_date: editCase.next_court_date?.trim() || null,
        notes: editCase.notes?.trim() || ''};
      const res = editCase.id
        ? await api.put(`/cases/${editCase.id}`, payload)
        : await api.post('/cases', payload);
      setModal(false);
      // The server plans court-date reminders whenever a court date is saved.
      const planned = unwrapList<{ deliver_at: string }>(res?.data?.reminders);
      if (planned.length) {
        showToast(t('x_cs_court_reminders_set_3', { value: planned.map(r => formatReminderTime(r.deliver_at)).join(' · ') }), 'success');
        // The moment notifications matter: ask now, with the reason (never at app start).
        requestNotificationsInContext().catch(() => 'declined');
      }
      await load();
    } catch (e: any) {
      // Offline fallback -- save locally and sync when reconnected
      // Only queue offline when the request never reached the server and
      // this is a new case (edits need the server copy).
      if (!e?.response && !editCase.id) {
        try {
          const offlinePayload = { title: (editCase.title ?? '').trim(), status: editCase.status || 'Open',
            notes: editCase.notes?.trim() || null, state: editCase.state || null };
          const tempId = await saveCaseOffline(offlinePayload);
          const offlineCase = { id: tempId, title: offlinePayload.title,
            status: offlinePayload.status, _offline: true, created_at: new Date().toISOString() };
          setOfflineCases(prev => [offlineCase, ...prev]);
          setModal(false);
          return; // Don't show error -- case was saved offline
        } catch {}
      }

      setError(apiErrorMessage(e, t('x_cs_could_not_save_try')));
    } finally {
      saveGuard.current = false;
      setSaving(false);
    }
  }, [editCase, load, showToast]);

  // ── Document scanner ──────────────────────────────────────────────────────
  const runDocumentScan = useCallback(async (uri: string) => {
    try {
      // Send to /discovery/analyze -- reuse existing endpoint
      // Use FormData so it hits the same multer pipeline
      const formData = new FormData();
      formData.append('document', {
        uri,
        type: 'image/jpeg',
        name: 'scan.jpg'} as any);
      formData.append('doc_type', 'case_intake');
      formData.append('case_context', 'Extract case intake fields: defendant name, charge, court date (YYYY-MM-DD), state (2-letter), and a brief case title. Return JSON only.');

      const res = await api.post('/discovery/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000});

      // Parse AI response to populate fields
      const data = res.data;
      const raw  = data.summary || data.raw || '';

      // Extract structured fields from AI response
      const parsed = parseScanResult(raw, data);

      if (parsed.title || parsed.state || parsed.notes) {
        setEditCase(prev => ({
          ...prev,
          title:           parsed.title  || prev.title  || '',
          state:           parsed.state  || prev.state  || '',
          next_court_date: parsed.courtDate || prev.next_court_date || '',
          notes:           [
            prev.notes,
            parsed.notes,
          ].filter(Boolean).join('\\n').trim()
        }));
showToast(t('x_cs_fields_have_been_pre'), 'success');
      } else {
showToast(t('x_cs_document_read_specific_fields'), 'warning');
      }
    } catch (e: any) {
      __DEV__ && console.warn(e?.message);
      showToast(t('x_cs_could_not_read_document'), 'error');
    } finally {
      setScanning(false);
    }
  }, [showToast]);

  const pickScanSource = useCallback(async (source: 'camera' | 'library') => {
    try {
      let result;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          confirm(t('x_cs_camera_access_needed'), t('x_cs_scan_documents_go_settings'),
      { confirmLabel: t('x_cs_open_settings') }).then(ok => { if (ok) Linking.openURL('app-settings:').catch(() => showToast(t('action_failed'), 'error')) });
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          allowsEditing: false});
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          confirm(t('x_cs_photo_access_needed'), t('x_cs_attach_photos_go_settings'),
      { confirmLabel: t('x_cs_open_settings') }).then(ok => { if (ok) Linking.openURL('app-settings:').catch(() => showToast(t('action_failed'), 'error')) });
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          allowsEditing: false});
      }
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setScanning(true);
      await runDocumentScan(asset.uri);
    } catch (e: any) {
      __DEV__ && console.warn(e?.message);
      setScanning(false);
    }
  }, [confirm, showToast, runDocumentScan]);

  const scanDocument = useCallback(async () => {
    try {
      // Ask: camera or library
      confirm(t('x_cs_scan_document_2'),t('x_cs_take_photo_choose_from'),
      { confirmLabel:t('x_cs_take_photo'), cancelLabel:t('x_cs_choose_library') }).then(ok=>{
        if(ok) pickScanSource('camera'); else pickScanSource('library');
      });
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
  }, [confirm, pickScanSource]);

  // ── Case sharing ─────────────────────────────────────────────────────────
  const shareCase = useCallback(async (cas: Case) => {
    try {
      const res = await api.post(`/cases/${cas.id}/share`);
      const url  = res.data?.share_url || `justicegavel.app/case/${res.data?.token}`;
      const msg  = t('x_cs_view_this_case_read', { title: cas.title, value: (cas.next_court_date ? t('x_cs_share_court_date', { date: formatDate(cas.next_court_date) }) + '\n' : ''), url });
      await RNShare.share({ message: msg, title: cas.title });
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('home_sos_failed')), 'info');
    }
  }, [showToast]);

  // ── Family invite ────────────────────────────────────────────────────────
  const openInvite = (cas: Case) => {
    setInvitingCase(cas);
    setInviteEmail('');
    setInviteError('');
    setInviteConsent(false);
    setInviteCode(null);
    setInviteModal(true);
  };

  // Family follower: the owner must tick consent; the server returns a one-time
  // code the family member enters (and e-mails it when an address is given).
  // The follower sees court dates only — never notes. Revocable any time.
  const sendInvite = useCallback(async () => {
    if (!inviteConsent || !invitingCase) return;
    setInviting(true);
    setInviteError('');
    try {
      const res = await api.post(`/cases/${invitingCase.id}/followers`, {
        consent: true, email: inviteEmail.trim() ? inviteEmail.trim().toLowerCase() : undefined,
      });
      setInviteCode(res.data?.invite_code || null);
      showToast(res.data?.message || t('cs_invite_created'), 'success');
    } catch (e: any) {
      setInviteError(apiErrorMessage(e, t('cdd_invite_failed')));
    } finally { setInviting(false); }
  }, [inviteConsent, inviteEmail, invitingCase, showToast]);

  // ── Calendar sync ──────────────────────────────────────────────────────────
  const addToCalendar = useCallback(async (cas: Case) => {
    if (!cas.next_court_date) {
      showToast(t('x_cs_add_court_date_this'));
      return;
    }
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        showToast(t('x_cs_allow_calendar_access_settings'));
        return;
      }
      // Get default calendar
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writeable  = calendars.find(cal => cal.allowsModifications && (cal.type as any) !== 'birthday');
      if (!writeable) {
        showToast(t('x_cs_could_not_find_writable'));
        return;
      }
      const courtDate  = new Date(cas.next_court_date + 'T09:00:00');
      const endDate    = new Date(cas.next_court_date + 'T10:00:00');
      await Calendar.createEventAsync(writeable.id, {
        title:     t('x_cs_court_2', { title: cas.title }),
        startDate: courtDate,
        endDate:   endDate,
        alarms:    [
          { relativeOffset: -60 * 24 },   // 1 day before
          { relativeOffset: -60 * 2  },   // 2 hours before
        ],
        notes: cas.notes || '',
        location: ''});
      showToast(t('x_cs_court_date_added_with', { title: cas.title }), 'success');
    } catch (e: any) {
      __DEV__ && console.warn(e?.message);
      showToast(t('x_cs_check_calendar_permissions_settings'));
    }
  }, [showToast]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  return (
    <View testID="case-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'cases' && styles.tabBtnActive]}
          onPress={() => setActiveTab('cases')}
        accessibilityState={{ selected: activeTab === 'cases' }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'cases' && styles.tabBtnTextActive]}>{t('case_tab_cases')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'messages' && styles.tabBtnActive]}
          onPress={() => setActiveTab('messages')}
          accessibilityState={{  selected: false  }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'messages' && styles.tabBtnTextActive]}>
              {t('messages_title')}
            </Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text maxFontSizeMultiplier={1.4} style={styles.unreadBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'tools' && styles.tabBtnActive]}
          onPress={() => setActiveTab('tools')}
          accessibilityState={{  selected: false  }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'tools' && styles.tabBtnTextActive]}>
            {t('case_tab_tools')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'lawyers' && styles.tabBtnActive]}
          testID="case-save-button" onPress={() => { setActiveTab('lawyers'); loadSavedLawyers(); }}
          accessibilityState={{ selected: false }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'lawyers' && styles.tabBtnTextActive]}>
            {t('x_cs_lawyers', { value: savedLawyers.length > 0 ? `(${savedLawyers.length})` : '' })}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('case_tab_cases')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.addBtn} testID="case-add-button" onPress={openNew}
         accessibilityLabel={t('case_new')}>
          <Text maxFontSizeMultiplier={1.4} style={styles.addBtnText}>{t('case_new')}</Text>
        </TouchableOpacity>
      </View>

      {/* Upcoming court date reminders banner */}
      {!loading && upcomingReminders.length > 0 && activeTab === 'cases' && (
        <View style={styles.reminderBanner} testID="court-reminders-banner">
          <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerIcon}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerTitle}>
              {t(upcomingReminders.length === 1 ? 'x_cs_upcoming_court_reminder_one' : 'x_cs_upcoming_court_reminder_other', { length: upcomingReminders.length })}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerSub} numberOfLines={1}>
              {t('x_cs_next', { title: upcomingReminders[0]?.title, deliver_at: formatReminderTime(upcomingReminders[0]?.deliver_at) })}
            </Text>
          </View>
        </View>
      )}

      {activeTab === 'lawyers'
        ? (
          <ScrollView testID="case-saved-lawyers" style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={lawyersLoading && savedLawyers.length > 0} onRefresh={loadSavedLawyers} tintColor={colors.textSecond} />}>
            {isOffline && (
              <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { marginBottom: 10 }]}>
                {t('x_cs_offline_showing_saved_lawyers', { cacheAge })}
              </Text>
            )}
            {lawyersLoading && savedLawyers.length === 0
              ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} />
              : isGuest
                ? (
                  <View style={styles.empty}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('x_cs_sign_see_saved_lawyers')}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_lawyers_save_kept_account')}</Text>
                  </View>
                )
                : savedLawyers.length === 0
                  ? (
                    <View style={styles.empty}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('saved_empty_title')}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_tap_lawyer_find_lawyer')}</Text>
                    </View>
                  )
                  : savedLawyers.map((l: any) => (
                    <TouchableOpacity
                      key={String(l.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('x_cs_open_profile', { value: l.name || t('x_cs_saved_lawyer') })}
                      style={[styles.familyCaseRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                      onPress={() => navigation.navigate('LawyerProfile', { lawyerId: l.provider_id ?? l.id })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseTitle, { color: colors.textPrimary }]} numberOfLines={1}>{l.name || t('x_cs_saved_lawyer_2')}</Text>
                        {!!(l.address || l.specialties?.length) && (
                          <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseSub, { color: colors.textMuted }]} numberOfLines={1}>
                            {[l.address, Array.isArray(l.specialties) ? l.specialties.slice(0, 2).join(', ') : null].filter(Boolean).join(' · ')}
                          </Text>
                        )}
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
          </ScrollView>
        )
        : loading
        ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} />
        : casesState === 'error'
          ? (
            <View testID="case-load-error" style={styles.empty}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📶</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('x_cs_could_not_load_cases')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_check_connection_cases_safe')}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.emptyBtn} onPress={() => { load(); }} accessibilityLabel={t('try_again')}>
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>{t('try_again')}</Text>
              </TouchableOpacity>
            </View>
          )
        : cases.length === 0
          ? (
            <View testID="case-empty-state" style={styles.empty}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📁</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('case_empty_title')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_cs_tap_new_case_start')}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.emptyBtn} onPress={openNew}
               accessibilityLabel={t('x_cs_create_first_case')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>{t('x_cs_create_first_case')}</Text>
            </TouchableOpacity>
            </View>
          )
          : (
            <FlashList
          testID="case-list"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecond} />}
              data={cases}
              keyExtractor={i => String(i.id)}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              {t('x_cs_no_cases_yet_tap')}
            </Text>
          }
              renderItem={({ item }) => <CaseCard item={item} testID="case-share-button" onPress={() => openEdit(item)} navigation={navigation} onCalendar={addToCalendar} onShare={shareCase} onInvite={openInvite} onExport={exportCasePDF} />}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            />
          )
      }
      {casesState === 'offline' && activeTab === 'cases' && (
        <View testID="case-list-offline" style={styles.offlineBanner}>
          <Text maxFontSizeMultiplier={1.4} style={styles.offlineBannerText}>{t('x_cs_offline_showing_court_dates', { casesCacheAge })}</Text>
        </View>
      )}
      {offlineCases.length > 0 && <View testID="case-offline-message" style={styles.offlineBanner}><Text maxFontSizeMultiplier={1.4} style={styles.offlineBannerText}>{t(offlineCases.length === 1 ? 'x_cs_case_saved_offline_will_one' : 'x_cs_case_saved_offline_will_other', { length: offlineCases.length })}</Text></View>}

      {/* ── Family-shared cases ──────────────────────────────────────────── */}
      {familyCases.length > 0 && activeTab === 'cases' && (
        <View style={styles.familySection}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.familySectionTitle, { color: colors.textMuted }]}>
            👨‍👩‍👧  {t('cs_shared_with_me', { n: familyCases.length })}
          </Text>
          {familyCases.map(fc => (
            <TouchableOpacity
              accessibilityRole="button"
              key={fc.id}
              style={[styles.familyCaseRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => navigation.navigate('CourtDates')}
              accessibilityLabel={t('cs_shared_a11y', { title: fc.title })}
            >
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseTitle, { color: colors.textPrimary }]} numberOfLines={1}>{fc.title}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseSub, { color: colors.textMuted }]}>
                  {t('cs_from', { name: fc.owner_name || t('cs_family_member') })}
                  {fc.next_court_date ? ` · ${t('cs_court_on', { date: formatCourtDay(String(fc.next_court_date).slice(0, 10)) })}` : ''}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Invite family member modal ───────────────────────────────────── */}
      <Modal accessibilityViewIsModal={true} testID="case-detail-screen" visible={inviteModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteModal(false)}>
        <View style={[styles.modal, { backgroundColor: colors.bg }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
          accessibilityRole="button" onPress={() => setInviteModal(false)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{t('cdd_invite_title')}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ padding: 16 }}>
            {inviteCode ? (
              <View testID="case-invite-code">
                <Text maxFontSizeMultiplier={1.4} style={[styles.fieldHint, { color: colors.textSecond }]}>
                  {t('cs_give_code')}
                </Text>
                <Text selectable maxFontSizeMultiplier={1.2} style={{ color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: 3, marginVertical: 12 }}>{inviteCode}</Text>
              </View>
            ) : (<>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('cdd_their_email')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldHint, { color: colors.textSecond }]}>
              {t('cs_invite_hint', { title: invitingCase?.title || '' })}
            </Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              accessibilityLabel={t('cdd_email_a11y')}
              placeholder={t('cs_email_placeholder')}
              placeholderTextColor={colors.textMuted}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit
        maxLength={254}
        />
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: inviteConsent }} testID="case-invite-consent"
              style={{ flexDirection: 'row', gap: 8, paddingVertical: 10, minHeight: 44 }} onPress={() => setInviteConsent(v => !v)}>
              <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 20, flex: 1 }}>
                {inviteConsent ? '☑' : '☐'} {t('cs_invite_consent')}
              </Text>
            </TouchableOpacity>
            {!!inviteError && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12, lineHeight: 20, marginBottom: 8 }}>⚠ {inviteError}</Text>}
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              style={[styles.emptyBtn, { backgroundColor: colors.blue, opacity: inviting ? 0.6 : 1 }]}
              onPress={sendInvite}
              disabled={inviting || !inviteConsent}
              accessibilityLabel={t('cdd_create_code')}
          accessibilityHint={t('cp_double_tap')}
            >
              {inviting
                ? <ActivityIndicator color={colors.bg} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>👨‍👩‍👧  {t('cdd_create_code')}</Text>
              }
            </TouchableOpacity>
            </>)}
          </View>
        </View>
      </Modal>

      <Modal accessibilityViewIsModal={true} visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex:1 }}>
        <ScrollView style={styles.modal} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}>
            <TouchableOpacity
          accessibilityRole="button" onPress={() => setModal(false)}
            ><Text maxFontSizeMultiplier={1.4} style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{editCase.id ? t('x_cs_edit_case') : t('x_cs_new_case')}</Text>
            <TouchableOpacity
              accessibilityRole="button" activeOpacity={0.6} onPress={save} disabled={saving}
             accessibilityLabel={t('case_save')}
          accessibilityHint={t('cp_double_tap')}>
              {saving ? <ActivityIndicator color={colors.navy} /> : <Text maxFontSizeMultiplier={1.4} style={styles.modalSave}>{t('case_save')}</Text>}
            </TouchableOpacity>
          </View>

          {!!error && <View style={styles.errorBanner}><Text maxFontSizeMultiplier={1.4} style={styles.errorText}>⚠ {error}</Text></View>}
          {/* Document scanner -- auto-fill from photo */}
          {!editCase.id && (
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              style={[styles.scanBtn, scanning && { opacity: 0.6 }]}
              onPress={scanDocument}
              disabled={scanning}
              accessibilityLabel={t('x_cs_scan_document_auto_fill')}
            >
              {scanning ? (
                <ActivityIndicator color={colors.bgCard} size="small" />
              ) : (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={styles.scanBtnIcon}>📷</Text>
                  <View>
                    <Text maxFontSizeMultiplier={1.4} style={styles.scanBtnTitle}>{t('x_cs_scan_document_2')}</Text>
                    <Text testID="case-bail-amount" maxFontSizeMultiplier={1.4} style={styles.scanBtnSub}>{t('x_cs_auto_fill_from_charging')}</Text>
                  </View>
                </>
              )}
            </TouchableOpacity>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('case_title_label')}{' '}<Text maxFontSizeMultiplier={1.4} style={styles.required}>*</Text></Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>{t('x_cs_describe_matter_briefly_e')}</Text>
          <TextInput
          accessibilityLabel={t('x_cs_e_g_dui_arrest')} testID="case-title-input"
            style={styles.textInput}
            placeholder={t('x_cs_e_g_dui_arrest')}
            placeholderTextColor={colors.textMuted}
            value={editCase.title || ''}
            onChangeText={v => setEditCase(p => ({ ...p, title: v }))}
            autoFocus
          />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_cs_status')}</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                accessibilityRole="button"
                key={s}
                style={[styles.statusChip, editCase.status === s && { backgroundColor: (STATUS_COLORS[s] || colors.textMuted) + '22', borderColor: STATUS_COLORS[s] || colors.textMuted }]}
                onPress={() => setEditCase(p => ({ ...p, status: s }))}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.statusChipText, editCase.status === s && { color: STATUS_COLORS[s] || colors.textMuted, fontFamily: 'Inter_700Bold', fontWeight: '700' }]}>{statusLabel(s)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_cs_next_court_date')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>{t('x_cs_tap_quick_option_type')}</Text>
          <View style={styles.dateQuickRow}>
            {[
              { label: t('x_cs_7_days'),  days: 7  },
              { label: t('x_cs_14_days'), days: 14 },
              { label: t('x_cs_30_days'), days: 30 },
              { label: t('x_cs_60_days'), days: 60 },
              { label: t('x_cs_90_days'), days: 90 },
            ].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days);
              const iso = toLocalISODate(d);
              return (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={days}
                  style={[styles.dateQuickChip, editCase.next_court_date === iso && styles.dateQuickChipActive]}
                  onPress={() => setEditCase(p => ({ ...p, next_court_date: iso }))}
                >
                  <Text testID="case-court-date" maxFontSizeMultiplier={1.4} style={[styles.dateQuickText, editCase.next_court_date === iso && styles.dateQuickTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={styles.textInput}
            placeholder={t('x_cs_yyyy_mm_dd_e')}
            placeholderTextColor={colors.textMuted}
            value={editCase.next_court_date || ''}
            onChangeText={v => setEditCase(p => ({ ...p, next_court_date: v }))}
            keyboardType="numbers-and-punctuation"
          />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_cs_state_2_letter_code')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>{t('x_cs_used_expungement_eligibility_checks')}</Text>
          <TextInput
          accessibilityLabel={t('x_cs_e_g_tn')}
            style={styles.textInput}
            placeholder={t('x_cs_e_g_tn')}
            placeholderTextColor={colors.textMuted}
            value={editCase.state || ''}
            onChangeText={v => setEditCase(p => ({ ...p, state: v.toUpperCase().slice(0, 2) }))}
            autoCapitalize="characters"
            maxLength={2}
          />

          <View style={styles.notesLabelRow}>
            <View>
              <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_cs_notes')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>{t('x_cs_attorney_name_charges_hearing')}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button" activeOpacity={0.6}
              style={[styles.micChip, { backgroundColor: colors.legalBg, borderColor: colors.legalDark }]}
              onPress={scanDocument}
              disabled={scanning}
              accessibilityLabel={t('x_cs_scan_document_3')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.micChipIcon}>📷</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.micChipText, { color: colors.legal }]}>{t('x_cs_scan')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.micChip, { backgroundColor: COLORS.navy + '12', borderColor: COLORS.navy + '33' }]}
              onPress={() => navigation.navigate('VoiceNote', {
                caseId:        editCase.id,
                caseTitle:     editCase.title || 'This case',
                existingNotes: editCase.notes || '',
                onSave:        (combined: string) => {
                  setEditCase(p => ({ ...p, notes: combined }));
                }})}
              accessibilityLabel={t('x_cs_record_voice_note_this')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.micChipIcon}>🎙</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.micChipText, { color: COLORS.navy }]}>{t('x_cs_voice_note_2')}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
          accessibilityLabel={t('x_cs_e_g_attorney_john')}
            style={[styles.textInput, styles.textArea]}
            placeholder={t('x_cs_e_g_attorney_john')}
            placeholderTextColor={colors.textMuted}
            value={editCase.notes || ''}
            onChangeText={v => { setEditCase(p => ({ ...p, notes: v })); autoSaveNotes(v); }}
            multiline
            maxLength={2000}
            numberOfLines={5}
          />

          {/* Privilege disclaimer */}
          <View style={[styles.privilegeNote, { backgroundColor: COLORS.warn + '10', borderColor: COLORS.warn + '40' }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.privilegeNoteText, { color: colors.textMuted }]}>
              🔒  {t('case_notes_privilege')}
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      </Modal>
      {activeTab === 'tools' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          {/* Section: Defender Tools */}
          <Text maxFontSizeMultiplier={1.4} style={[styles.toolsSectionLabel, { color: colors.textMuted }]}>
            {t('case_tools_section')}
          </Text>

          {/* {t('case_ai_title')} -- case-aware Defender Mode */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, styles.toolCard, { backgroundColor: COLORS.navy, borderColor: COLORS.navy }]}
            onPress={() => {
              const activeCase = (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status));
              // i18n-exempt: context for the AI model (sent with the question, never shown) stays English
              const ctx = activeCase
                ? [
                    `Case: ${activeCase.title}`,
                    `Status: ${activeCase.status}`,
                    activeCase.next_court_date ? `Court date: ${activeCase.next_court_date}` : null, // i18n-exempt: AI context
                    activeCase.notes ? `Attorney notes: ${activeCase.notes.slice(0, 500)}` : null, // i18n-exempt: AI context
                  ].filter(Boolean).join('\n')
                : null;
              navigation.navigate('ChatTab', {
                mode:        'defender',
                caseContext: ctx,
                caseTitle:   activeCase?.title || 'Active Case',
              });
            }}
            accessibilityLabel={t('x_cs_discuss_case_with_ai')}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bgCard }]}>
                {t('case_ai_title')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: 'rgba(255,255,255,0.7)' }]}>
                {t('case_ai_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: 'rgba(255,255,255,0.6)' }]}>›</Text>
          </TouchableOpacity>

          {/* Motions */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('MotionLibrary', {
              caseId: cases[0]?.id,
              caseTitle: cases[0]?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.emergency + '18' }]}>
              <AppIcon name="document-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>
                {t('x_cs_motion_library')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_motion_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Discovery */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('Discovery', {
              caseId:    (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status))?.id,
              caseTitle: (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status))?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.blue + '18' }]}>
              <AppIcon name="search-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>
                {t('disc_title')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_discovery_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Legal Research */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('LegalResearch', {
              caseContext: (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status))?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.legal + '18' }]}>
              <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>
                {t('legal_research')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_research_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Voice Notes */}
          <TouchableOpacity accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('VoiceNote', {
              caseId:        (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status))?.id,
              caseTitle:     (cases ?? []).find((ca: any) => ['Open','Active'].includes(ca.status))?.title,
              existingNotes: ''})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: COLORS.navy + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🎙</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>
                {t('x_cs_voice_notes')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_voice_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Interpreter */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('Translator')}
            accessibilityLabel={t('x_cs_attorney_client_interpreter')}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.legal + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🗣</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>
                {t('translator_title')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_interpreter_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* ⏰ Deadline Calculator */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: colors.bgCard, borderColor: COLORS.emergency + '40', borderWidth: 1.5 }]}
            onPress={() => navigation.navigate('DeadlineCalculator')}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: COLORS.emergency + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>⏰</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: colors.textPrimary }]}>{t('x_cs_deadline_calculator')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('x_cs_arraignment_appeal_aedpa_speedy')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.emergency }]}>›</Text>
          </TouchableOpacity>

          {cases.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolsSectionLabel, { color: colors.textMuted, marginTop: 14 }]}>
                {t('x_cs_analyze_by_case')}
              </Text>
              {(cases ?? []).filter((ca: any) => ['Open','Active','Pending'].includes(ca.status)).slice(0,5).map((ca: any) => (
                <TouchableOpacity accessibilityRole="button"
                  key={String(ca.id)}
                  style={[styles.caseToolRow, { backgroundColor: isDark ? colors.bg : COLORS.bg, borderColor: colors.surface }]}
                  onPress={() => navigation.navigate('Discovery', {
                    caseId: ca.id, caseTitle: ca.title
                  })}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.caseToolTitle, { color: colors.steel }]}
                    numberOfLines={1}>📁 {String(ca.title)}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.caseToolCta, { color: COLORS.navy }]}>{t('x_cs_analyze_docs')}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  header: { backgroundColor: COLORS.navy, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  addBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 8 },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn: { backgroundColor: colors.navy, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnText: { color: colors.textOnNavy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21},
  card: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { flex: 1, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, marginRight: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  courtDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.bg, borderRadius: 8, padding: 8, marginBottom: 6 },
  courtDateUrgent: { backgroundColor: COLORS.warnBg, borderWidth: 1, borderColor: COLORS.warnDark },
  courtDateIcon: { fontSize: 14,
    lineHeight: 21},
  courtDateText: { fontSize: 12, color: COLORS.textSecond },
  cardNotes: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: 4 },
  cardCreated: { fontSize: 11, color: colors.textMuted },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.surface },
  modalClose: { fontSize: 18, color: colors.textMuted, padding: 4 },
  modalTitle: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand },
  modalSave: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand },
  errorBanner: { backgroundColor: colors.emergencyBg, margin: 16, borderRadius: 8, padding: 12 },
  errorText: { color: colors.emergency, fontSize: 12 },
  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textPrimary, marginTop: 16, marginHorizontal: 16, marginBottom: 2 },
  fieldHint: { fontSize: 12, color: colors.textMuted, marginHorizontal: 16, marginBottom: 6, lineHeight: 16 },
  required: { color: colors.emergency },
  textInput: { borderWidth: 1.5, borderColor: colors.surface, borderRadius: 12, backgroundColor: COLORS.bgCard, padding: 12, fontSize: 14, lineHeight: 21, color: colors.bgCard, marginHorizontal: 16 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16 },
  statusChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: COLORS.bgCard },
  statusChipText: { fontSize: 12, lineHeight: 20, color: COLORS.textMuted },
  tabRow: { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderBottomWidth: 1.5, borderBottomColor: colors.surface },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2.5, borderBottomColor: COLORS.navy },
  tabBtnText: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: COLORS.textMuted },
  tabBtnTextActive: { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  savedCard: {
    backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: COLORS.navy, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2},
  savedName:    { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bgCard, marginBottom: 2 },
  savedAddr:    { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  savedRating:  { fontSize: 12, color: COLORS.steelMid, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  savedSpecs:   { fontSize: 11, color: colors.steel, marginTop: 2 },
  savedCallBtn: { backgroundColor: colors.legal, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 10 },
  savedCallText:{ color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  reminderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.infoBg, padding: 12, marginHorizontal: 14, marginTop: 8,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.steelMid},
  reminderBannerIcon:  { fontSize: 20 },
  reminderBannerTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info },
  reminderBannerSub:   { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  expungeBtn: {
    marginTop: 8, paddingVertical: 9, paddingHorizontal: 12,
    backgroundColor: COLORS.bgSubtle, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.bgSubtle},
  expungeBtnText:  { fontSize: 12, color: COLORS.info, fontWeight: '700' },
  familySection:     { paddingHorizontal: 16, paddingBottom: 8 },
  familySectionTitle:{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 4 },
  familyCaseRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  familyCaseTitle:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  familyCaseSub:     { fontSize: 11 },
  shareBtn:        { marginTop: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(133,183,235,0.33)' },
  shareBtnText:    { fontSize: 12, color: COLORS.info, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  calendarBtn:     { marginTop: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.legalBg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.legal },
  calendarBtnText: { fontSize: 12, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  scanBtn:         { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, padding: 16, borderRadius: RADIUS.md, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: 'rgba(133,183,235,0.33)' },
  scanBtnIcon:     { fontSize: 22 },
  scanBtnTitle:    { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textOnNavy, marginBottom: 2 },
  scanBtnSub:      { fontSize: 11, color: colors.steel },
  offlineBanner: {
    backgroundColor: COLORS.infoBg, paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.steelMid},
  offlineBannerText: { fontSize: 12, color: COLORS.info, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateQuickRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  dateQuickChip:       { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.surface, backgroundColor: COLORS.bg },
  dateQuickChipActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  dateQuickText:       { fontSize: 12, color: COLORS.info, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateQuickTextActive: { color: COLORS.bgCard },
  civilRightsBtn: {
    marginTop: 6, backgroundColor: COLORS.navy + '12',
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: COLORS.navy + '40'},
  civilRightsBtnText: {
    fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.navy},

  // Messages tab
  msgInfoBanner: { marginHorizontal: 16, marginBottom: 8, borderRadius: 8, borderWidth: 1, padding: 10 },
  msgInfoText:   { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_500Medium', fontWeight: '500' },
  msgCaseRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16,
    marginBottom: 8, borderRadius: 14, borderWidth: 1, padding: 14 },
  msgCaseIcon:   { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  msgCaseTitle:  { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  msgCaseSub:    { fontSize: 12 },
  msgCaseArrow:  { fontSize: 22, fontWeight: '200' },
  unreadBadge:   { backgroundColor: COLORS.emergency, borderRadius: 8, paddingHorizontal: 5,
    paddingVertical: 1, minWidth: 16, alignItems: 'center' },
  unreadBadgeText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  notesLabelRow: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 4 },
  micChip: { flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  micChipIcon: { fontSize: 14,
    lineHeight: 21},
  micChipText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  generateMotionBtn: { marginHorizontal: 16, marginTop: 12, borderRadius: RADIUS.lg,
    paddingVertical: 16, alignItems: 'center' },
  toolCard:      { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(4,44,83,0.15)' },
  toolCardIcon:  { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  toolCardTitle: { fontSize: 14, fontWeight: '700', color: DEEP_BG, lineHeight: 18 },
  toolCardSub:   { fontSize: 12, color: (colors.textMuted), lineHeight: 16, marginTop: 2 },
  toolCardArrow: { marginLeft: 'auto', fontSize: 16, color: (colors.textMuted) },
  discoveryBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.infoBg, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.info },
  discoveryBtnText:  { fontSize: 14, color: colors.info, fontWeight: '600', marginLeft: 8 },
  toolsSectionLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  caseToolRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  caseToolTitle:     { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  caseToolCta:       { fontSize: 13, color: colors.navy, fontWeight: '700' },
  privilegeNote:     { backgroundColor: colors.infoBg, borderRadius: 8, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.info + '44' },
  privilegeNoteText: { fontSize: 12, color: colors.info, lineHeight: 18 },
  generateMotionBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(CaseScreen);