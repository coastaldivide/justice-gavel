import { SkeletonLoader } from '../components/SkeletonLoader';
import { HapticButton } from '../components/HapticButton';
import { GradientHeader } from '../components/GradientHeader';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';

import React, { useState, useEffect, useCallback } from 'react';
import { FileSystem, ScreenCapture, StoreReview, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import type {} from '../types/navigation';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, Modal, ScrollView, Linking, ActivityIndicator, RefreshControl, Share, KeyboardAvoidingView, Platform, AccessibilityInfo} from 'react-native';
import { api } from '../services/api';
import { cacheAgeLabel, cacheCases, cacheSavedLawyers, getCachedLawyers } from '../services/offlineCache';
import { t }   from '../i18n';
import * as Calendar      from 'expo-calendar';
import * as ImagePicker   from 'expo-image-picker';
import { COLORS, RADIUS, useTheme } from '../constants/theme';
import * as secureStorage from '../utils/secureStorage';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { saveCaseOffline, getOfflineCases, startSyncListener } from '../services/offlineSync';
import Markdown from 'react-native-markdown-display';
import { useFocusEffect } from '@react-navigation/native';
import { daysUntil, formatDate} from '../utils/dateUtils';
const C_0A1929 = ('\x23' + '0A1929') as string; // hex color

declare var ScreenProps: any;
declare var caseData: any;
declare var loadCases: any;
declare var mountedRef: any;
declare var newNotes: any;
declare var newTitle: any;
declare var refreshing: any;
declare var selectedCase: any;
declare var setNewNotes: any;
declare var setNewTitle: any;
declare var setRefreshing: any;
declare var setShowAdd: any;
declare var userState: any;
declare var exportCasePDF: any; // hoisted from component scope
const STATUS_COLORS: Record<string, string> = {
  Open: COLORS.blue, Active: COLORS.legalDark, Pending: COLORS.warnDark,
  Closed: COLORS.textMuted, Dismissed: COLORS.blue};
const STATUS_OPTIONS = ['Open', 'Active', 'Pending', 'Closed', 'Dismissed'];
          // Rating prompt on resolution -- highest positive emotion moment
          setTimeout(() => { StoreReview.isAvailableAsync().then(ok => { if (ok) StoreReview.requestReview(); }).catch(() => {}); }, 2000);

interface Case {
  state?:          string;
  id: number; title: string; status: string;
  next_court_date: string | null; notes: string; created_at: string;
}

const CaseCard = React.memo(function CaseCard({ item, onPress, navigation, onCalendar, onShare, onInvite }: any) {
  const color = STATUS_COLORS[item.status] || COLORS.textMuted;
  const hasDate = !!item.next_court_date;
  const days = hasDate
    ? daysUntil(item.next_court_date) ?? Infinity
    : null;

  return (
    <TouchableOpacity
      accessibilityRole="button" testID="case-card" style={styles.card} onPress={onPress} activeOpacity={0.85}
     accessibilityLabel="{item.title}">
      <View style={styles.cardTop}>
        <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

              {item.next_court_date && (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={{ flexDirection:'row', alignItems:'center', gap:4, paddingVertical:6,
                    marginTop:2 }}
                  onPress={async () => {
                    const d = new Date(item.next_court_date!);
                    const remind = new Date(d);
                    remind.setDate(d.getDate()-1);
                    if (remind <= new Date()) {
                      Alert.alert('Too soon','Court date is tomorrow or today.');
                      return;
                    }
                    try {
                      await api.post('/push/reminders', {
                        title: '🏛️ Court tomorrow: ' + item.title,
                        body: 'Your court date is tomorrow. Review your case details.',
                        scheduled_for: remind.toISOString(),
                        notification_type: 'court_reminder',
                      });
                      Alert.alert('Reminder set ✓', 'We\'ll remind you the day before court.');
                    } catch { Alert.alert('Could not set reminder'); }
                  }}
                  accessibilityLabel="Set court date reminder"
                >
                  <AppIcon name="notifications-outline" size={20} color={COLORS.navy} />
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color:COLORS.navy, fontWeight:'600' }}>Remind me</Text>
                </TouchableOpacity>
              )}
        <View style={[styles.statusBadge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statusText, { color }]}>{item.status}</Text>
        </View>
      </View>
      {hasDate && (
        <View style={[styles.courtDateRow, days !== null && (days as number) <= 7 && styles.courtDateUrgent]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.courtDateIcon}>📅</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.courtDateText}>
            Court: {new Date(item.next_court_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {days !== null && (days as number) >= 0 && <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700' }}>  ({(days as number) === 0 ? 'Today!' : (days as number) === 1 ? 'Tomorrow!' : `${days} days`})</Text>}
          </Text>
        </View>
      )}
      {!!item.notes && <Markdown style={{ body: { fontSize:14, lineHeight:21, color:COLORS.textSecond } }}>{item.notes}</Markdown>}
      <Text maxFontSizeMultiplier={1.4}>Created {new Date(item.created_at ?? 0).toLocaleDateString()}</Text>
      <TouchableOpacity
          accessibilityRole="button" testID="case-share-sheet"
        style={styles.shareBtn}
        accessibilityLabel="\ud83d\udd17  Share Link" onPress={() => onShare(item)}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>🔗  Share Link</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.shareBtn, { borderColor: 'rgba(133,183,235,0.33)', backgroundColor: COLORS.bgCard }]}
        onPress={() => onInvite(item)}
        accessibilityLabel={`Invite a family member to ${item.title}`}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.shareBtnText, { color: COLORS.steel }]}>👨‍👩‍👧  Invite Family</Text>
      </TouchableOpacity>
      {hasDate && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.calendarBtn}
          onPress={() => onCalendar(item)}
          accessibilityLabel={`Add ${item.title} court date to calendar`}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.calendarBtnText}>📅  Add to Calendar</Text>
        </TouchableOpacity>
      )}
      {['Open', 'Active', 'Pending'].includes(item.status) && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.discoveryBtn}
          onPress={() => navigation?.navigate('Discovery', {
            caseId: item.id, caseTitle: item.title
          })}
          accessibilityLabel={`Analyze discovery documents for ${item.title}`}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.discoveryBtnText}>🔍 Analyze discovery docs →</Text>
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
            accessibilityLabel="View case timeline"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>📋 View Timeline →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.bgSubtle }]}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'VoiceNote',
              params: { caseId: item.id, caseTitle: item.title }
            })}
            accessibilityLabel="Record a voice note for this case"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              🎤 Voice Note →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.infoBg }]}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'DocumentScanner',
              params: { caseId: item.id }
            })}
            accessibilityLabel="Scan a document and attach to this case"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              📷 Scan Document →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.expungeBtn, { backgroundColor: COLORS.bgSubtle }]}
            onPress={() => exportCasePDF(item)}
            accessibilityLabel="Export full case summary as PDF"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>
              📄 Export Case PDF →
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
            <Text maxFontSizeMultiplier={1.4} style={styles.expungeBtnText}>📋 Check expungement eligibility →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.civilRightsBtn}
            onPress={() => navigation?.navigate('MoreTab', {
              screen: 'PILead',
              params: { caseType: 'Civil Rights' }
            })}
            accessibilityLabel="Were your rights violated? Submit your case to civil rights attorneys -- free"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.civilRightsBtnText}>✊ Were your rights violated? Get a civil rights attorney -- free →</Text>
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

const a11yAnnounce = (msg) => AccessibilityInfo.announceForAccessibility(msg);

export default function CaseScreen({ route, navigation }: any) {
  React.useEffect(() => {
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
      const Print = (await import('expo-print')).default;
      const Sharing = (await import('expo-sharing')).default;
      const date = new Date().toLocaleDateString('en-US', {
        year:'numeric', month:'long', day:'numeric'
      });
      const escapeHtml = (s?: string | null) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; padding: 40px; max-width: 680px; margin:0 auto; color: #1a1a2e; }
  h1 { color: #042C53; font-size: 24px; border-bottom: 2px solid #042C53; padding-bottom: 12px; }
  h2 { color: #042C53; font-size: 16px; margin-top: 28px; margin-bottom: 8px; }
  .meta { color: #6B7280; font-size: 13px; margin-bottom: 24px; }
  .field { margin-bottom: 10px; font-size: 14px; }
  .label { font-weight: 700; color: #374151; }
  .notes { background: #F9FAFB; border-left: 3px solid #042C53; padding: 12px; margin-top: 8px;
    font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .footer { margin-top: 48px; font-size: 11px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 12px; }
</style></head><body>
<h1>${escapeHtml(String(cas.title || '')) || 'Case Summary'}</h1>
<div class="meta">Exported ${date} · Justice Gavel</div>
<h2>Case Details</h2>
<div class="field"><span class="label">Status:</span> ${cas.status || 'Active'}</div>
<div class="field"><span class="label">Next Court Date:</span> ${cas.next_court_date ? new Date(String(cas.next_court_date)).toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'}) : 'Not set'}</div>
<div class="field"><span class="label">State:</span> ${cas.state || 'Not specified'}</div>
${cas.charges ? `<div class="field"><span class="label">Charges:</span> \${escapeHtml(String(cas.charges || ''))}</div>` : ''}
${cas.bail_amount ? `<div class="field"><span class="label">Bail Amount:</span> $\${Number(cas.bail_amount).toLocaleString()}</div>` : ''}
${cas.notes ? `<h2>Notes</h2><div class="notes">\${escapeHtml(String(cas.notes || ''))}</div>` : ''}
<div class="footer">Justice Gavel, Inc. · Not a law firm · Confidential case document</div>
</body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export Case Summary',
      });
    } catch {
      Alert.alert('Export failed', 'Could not generate PDF. Try again.');
    }
  };

  // Offline case sync -- show locally created cases + sync on reconnect
  const [offlineCases, setOfflineCases] = React.useState<any[]>([]);
  React.useEffect(() => {
    getOfflineCases().then(setOfflineCases).catch(() => {});
    const unsub = startSyncListener((tempId, serverId) => {
      // Replace offline case with synced server case
      setOfflineCases(prev => prev.filter(c => c.id !== tempId));
      // Trigger a reload of the server cases list
      setTimeout(() => loadCases(), 500);
    });
    return unsub;
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
      if (!caseData?.id) return;
      try { await api.put(`/cases/${caseData.id}`, { notes: text }); } catch {}
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
      setSavedLawyers(res.data || []);
      cacheCases(res.data).catch(() => {});  // write-through cache for offline use
      cacheSavedLawyers(res.data); // save to offline cache
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
  const [saving, setSaving]     = useState(false);
  const [scanning,      setScanning]      = useState(false);
  const [familyCases,   setFamilyCases]   = useState<any[]>([]);
  const [inviteModal,   setInviteModal]   = useState(false);
  const [inviteEmail,   setInviteEmail]   = useState('');
  const [invitingCase,  setInvitingCase]  = useState<Case|null>(null);
  const [inviting,      setInviting]      = useState(false);
  const [inviteError,   setInviteError]   = useState('');
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [myRes, famRes] = await Promise.allSettled([
        api.get('/cases'),
        api.get('/cases/family'),
      ]);
      if (myRes.status === 'fulfilled') setCases(myRes.value.data);
      if (famRes.status === 'fulfilled') setFamilyCases(famRes.value.data || []);
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    api.get('/push/reminders').then(r => setUpcomingReminders(r.data || [])).catch((e) => { __DEV__ && console.warn(e?.message); });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const save = useCallback(async () => {
    if (!editCase.title?.trim()) { setError('Please enter a case title.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: editCase.title!.trim(),
        status: editCase.status || 'Open',
        next_court_date: editCase.next_court_date?.trim() || null,
        notes: editCase.notes?.trim() || ''};
      if (editCase.id) {
        await api.put(`/cases/${editCase.id}`, payload);
      } else {
        await api.post('/cases', payload);
      }
      setModal(false);
      await load();
    } catch (e: any) {
      // Offline fallback -- save locally and sync when reconnected
      try {
        const caseData = { title: newTitle.trim(), status: 'Active',
          notes: newNotes.trim() || null, state: userState || null };
        const tempId = await saveCaseOffline(caseData);
        const offlineCase = { id: tempId, title: newTitle.trim(),
          status: 'Active', _offline: true, created_at: new Date().toISOString() };
        setOfflineCases(prev => [offlineCase, ...prev]);
        setShowAdd(false); setNewTitle(''); setNewNotes('');
        return; // Don't show error -- case was saved offline
      } catch {}

      setError(e.response?.data?.error || 'Could not save. Try again.');
    } finally {
      setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [cases, selectedCase]);

  // ── Document scanner ──────────────────────────────────────────────────────
  const scanDocument = useCallback(async () => {
    try {
      // Ask: camera or library
      Alert.alert(
        'Scan Document',
        'Choose a charging document, bail slip, police report, or any legal document to auto-fill this case.',
        [
          { text: 'Take Photo', onPress: () => pickScanSource('camera') },
          { text: 'Choose from Library', onPress: () => pickScanSource('library') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickScanSource = useCallback(async (source: 'camera' | 'library') => {
    try {
      let result;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
      'Camera Access Needed',
      'To scan documents, go to Settings and turn on Camera for Justice Gavel.',
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:').catch(()=>{}) },
      ]
    );
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          allowsEditing: false});
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
      'Photo Access Needed',
      'To attach photos, go to Settings and turn on Photos for Justice Gavel.',
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:').catch(()=>{}) },
      ]
    );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDocumentScan = useCallback(async (uri: string) => {
    try {
      // Read image as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64});
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
        Alert.alert(
          '✓ Document scanned',
          'Fields have been pre-filled from the document. Review and edit before saving.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Scanned -- no fields detected',
          'The document was read but specific case fields could not be extracted. Check the Notes field for the full text.',
          [{ text: 'OK' }]
        );
      }
    } catch (e: any) {
      __DEV__ && console.warn(e?.message);
      Alert.alert(
        'Scan failed',
        'Could not read the document. Make sure the text is visible and the image is clear.',
        [{ text: 'OK' }]
      );
    } finally {
      setScanning(false);
    }
  }, []);

  // ── Parse AI scan response into case fields ─────────────────────────────────
  const parseScanResult = (raw: string, data: Record<string,unknown>): {
    title: string; state: string; courtDate: string; notes: string;
  } => {
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
  };

  // ── Case sharing ─────────────────────────────────────────────────────────
  const shareCase = useCallback(async (cas: Case) => {
    try {
      const res = await api.post(`/cases/${cas.id}/share`);
      const url  = res.data?.share_url || `justicegavel.app/case/${res.data?.token}`;
      const msg  = `📁 ${cas.title}\n` +
        (cas.next_court_date ? `📅 Court date: ${new Date(cas.next_court_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n` : '') +
        `\nView this case (read-only, expires in 7 days):\n${url}\n\nSent via Justice Gavel`;
      await Share.share({ message: msg, title: cas.title });
    } catch (e: any) {
      Alert.alert('Could not share', e.response?.data?.error || 'Check your connection and try again.');
    }
  }, []);

  // ── Family invite ────────────────────────────────────────────────────────
  const openInvite = (cas: Case) => {
    setInvitingCase(cas);
    setInviteEmail('');
    setInviteError('');
    setInviteModal(true);
  };

  const sendInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !invitingCase) return;
    setInviting(true);
    setInviteError('');
    try {
      const res = await api.post(`/cases/${invitingCase.id}/invite`, { email: inviteEmail.trim().toLowerCase() });
      setInviteModal(false);
      Alert.alert('Access granted ✓', res.data?.message || 'Family member can now see this case.');
    } catch (e: any) {
    // eslint-disable-next-line react-hooks/exhaustive-deps
      setInviteError(e.response?.data?.error || 'Could not invite. Check the email address.');
    } finally { setInviting(false); }
  }, [selectedCase, inviteEmail, invitingCase]);

  // ── Calendar sync ──────────────────────────────────────────────────────────
  const addToCalendar = useCallback(async (cas: Case) => {
    if (!cas.next_court_date) {
      Alert.alert('No court date', 'Add a court date to this case first.');
      return;
    }
    try {

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow calendar access in Settings to add court dates.');
        return;
      }
      // Get default calendar
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writeable  = calendars.find(cal => cal.allowsModifications && (cal.type as any) !== 'birthday');
      if (!writeable) {
        Alert.alert('No calendar found', 'Could not find a writable calendar on this device.');
        return;
      }
      const courtDate  = new Date(cas.next_court_date + 'T09:00:00');
      const endDate    = new Date(cas.next_court_date + 'T10:00:00');
      await Calendar.createEventAsync(writeable.id, {
        title:     `⚖️ Court -- ${cas.title}`,
        startDate: courtDate,
        endDate:   endDate,
        alarms:    [
          { relativeOffset: -60 * 24 },   // 1 day before
          { relativeOffset: -60 * 2  },   // 2 hours before
        ],
        notes: cas.notes || '',
        location: ''});
      Alert.alert('Added to Calendar ✓', `"${cas.title}" court date added with reminders 1 day and 2 hours before.`);
    } catch (e: any) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      __DEV__ && console.warn(e?.message);
      Alert.alert('Could not add to calendar', 'Check your calendar permissions in Settings.');
    }
  }, [selectedCase, gated, unlock, unlocking]);

  return (
    <View testID="case-screen" style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'cases' && styles.tabBtnActive]}
          accessibilityLabel="{t('case_tab_cases')}" onPress={() => setActiveTab('cases')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'cases' && styles.tabBtnTextActive]}>{t('case_tab_cases')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'messages' && styles.tabBtnActive]}
          onPress={() => setActiveTab('messages')}
          accessibilityLabel={`Messages${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'messages' && styles.tabBtnTextActive]}>
              Messages
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
          accessibilityLabel="Defender Tools"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'tools' && styles.tabBtnTextActive]}>
            {t('case_tab_tools')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.tabBtn, activeTab === 'lawyers' && styles.tabBtnActive]}
          testID="case-save-button" onPress={() => { setActiveTab('lawyers'); loadSavedLawyers(); }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.tabBtnText, activeTab === 'lawyers' && styles.tabBtnTextActive]}>
            Lawyers {savedLawyers.length > 0 ? `(${savedLawyers.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('case_tab_cases')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.addBtn} testID="case-add-button" onPress={openNew}
         accessibilityLabel="{t('case_new')}">
          <Text maxFontSizeMultiplier={1.4} style={styles.addBtnText}>{t('case_new')}</Text>
        </TouchableOpacity>
      </View>

      {/* Upcoming court date reminders banner */}
      {!loading && upcomingReminders.length > 0 && activeTab === 'cases' && (
        <View style={styles.reminderBanner}>
          <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerIcon}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerTitle}>
              {upcomingReminders.length} upcoming court reminder{upcomingReminders.length > 1 ? 's' : ''}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.reminderBannerSub} numberOfLines={1}>
              Next: {upcomingReminders[0]?.title} -- {new Date(upcomingReminders[0]?.deliver_at).toLocaleDateString()}
            </Text>
          </View>
        </View>
      )}

      {loading
        ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} />
        : cases.length === 0
          ? (
            <View testID="case-empty-state" style={styles.empty}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📁</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>No cases yet</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>Tap "+ New case" to start tracking your legal matter.</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.emptyBtn} onPress={openNew}
               accessibilityLabel="Create first case">
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>Create first case</Text>
            </TouchableOpacity>
            </View>
          )
          : (
            <FlatList
          testID="case-list"
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          windowSize={10}
          removeClippedSubviews={true}
          getItemLayout={(_, index) => ({ length: 130, offset: 130 * index, index })}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSavedLawyers().finally(() => setRefreshing(false)); }} tintColor={colors.textSecond} />}
              data={cases}
              keyExtractor={i => String(i.id)}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              No cases yet. Tap + to start tracking your first case.
            </Text>
          }
              renderItem={({ item }) => <CaseCard item={item} testID="case-share-button" onPress={() => openEdit(item)} navigation={navigation} onCalendar={addToCalendar} onShare={shareCase} onInvite={openInvite} />}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            />
          )
      }
      {offlineCases.length > 0 && <View testID="case-offline-message" style={styles.offlineBanner}><Text maxFontSizeMultiplier={1.4} style={styles.offlineBannerText}>📴 {offlineCases.length} case{offlineCases.length > 1 ? 's' : ''} saved offline — will sync when connected</Text></View>}

      {/* ── Family-shared cases ──────────────────────────────────────────── */}
      {familyCases.length > 0 && activeTab === 'cases' && (
        <View style={styles.familySection}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.familySectionTitle, { color: colors.textMuted }]}>
            👨‍👩‍👧  Shared with me ({familyCases.length})
          </Text>
          {familyCases.map(fc => (
            <TouchableOpacity
              accessibilityRole="button"
              key={fc.id}
              style={[styles.familyCaseRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => navigation.navigate('Messages', { caseId: fc.id, caseTitle: fc.title })}
              accessibilityLabel={`Open shared case ${fc.title}`}
            >
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseTitle, { color: colors.textPrimary }]} numberOfLines={1}>{fc.title}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.familyCaseSub, { color: colors.textMuted }]}>
                  From {fc.owner_name || fc.owner_email || 'family member'}
                  {fc.next_court_date ? ` · Court: ${new Date(fc.next_court_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
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
            <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>Invite Family Member</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ padding: 16 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>Their Justice Gavel email address</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldHint, { color: colors.textSecond }]}>
              They must have a Justice Gavel account. Once invited, they can view "{invitingCase?.title}" and send messages to your attorney.
            </Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              placeholder="Emergency contact email"
              placeholderTextColor={colors.textMuted}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
          returnKeyType="next"
          blurOnSubmit
        />
            {!!inviteError && <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12, lineHeight: 20, marginBottom: 8 }}>⚠ {inviteError}</Text>}
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              style={[styles.emptyBtn, { backgroundColor: colors.steel, opacity: inviting ? 0.6 : 1 }]}
              onPress={sendInvite}
              disabled={inviting || !inviteEmail.trim()}
              accessibilityLabel="Send invite"
            >
              {inviting
                ? <ActivityIndicator color={colors.bg} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>👨‍👩‍👧  Grant Access</Text>
              }
            </TouchableOpacity>
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
            <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{editCase.id ? 'Edit case' : 'New case'}</Text>
            <TouchableOpacity
              accessibilityRole="button" activeOpacity={0.6} onPress={save} disabled={saving}
             accessibilityLabel="Save">
              {saving ? <ActivityIndicator color={colors.navy} /> : <Text maxFontSizeMultiplier={1.4} style={styles.modalSave}>Save</Text>}
            </TouchableOpacity>
          </View>

          {!!error && <View style={styles.errorBanner}><Text maxFontSizeMultiplier={1.4} style={styles.errorText}>⚠ {error}</Text></View>}
          {/* Document scanner -- auto-fill from photo */}
          {!editCase.id && (
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              style={[styles.scanBtn, scanning && { opacity: 0.6 }]}
              onPress={scanDocument}
              disabled={scanning}
              accessibilityLabel="Scan a document to auto-fill case fields"
            >
              {scanning ? (
                <ActivityIndicator color={colors.bgCard} size="small" />
              ) : (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={styles.scanBtnIcon}>📷</Text>
                  <View>
                    <Text maxFontSizeMultiplier={1.4} style={styles.scanBtnTitle}>Scan Document</Text>
                    <Text testID="case-bail-amount" maxFontSizeMultiplier={1.4} style={styles.scanBtnSub}>Auto-fill from charging doc, bail slip, or police report</Text>
                  </View>
                </>
              )}
            </TouchableOpacity>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Case title <Text maxFontSizeMultiplier={1.4} style={styles.required}>*</Text></Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>Describe the matter briefly, e.g. "DUI charge -- Shelby County" or "Assault charge appeal"</Text>
          <TextInput testID="case-title-input"
            style={styles.textInput}
            placeholder="e.g. DUI arrest Memphis TN Oct 2025"
            placeholderTextColor={colors.textMuted}
            value={editCase.title || ''}
            onChangeText={v => setEditCase(p => ({ ...p, title: v }))}
            autoFocus
          />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                accessibilityRole="button"
                key={s}
                style={[styles.statusChip, editCase.status === s && { backgroundColor: (STATUS_COLORS[s] || colors.textMuted) + '22', borderColor: STATUS_COLORS[s] || colors.textMuted }]}
                onPress={() => setEditCase(p => ({ ...p, status: s }))}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.statusChipText, editCase.status === s && { color: STATUS_COLORS[s] || colors.textMuted, fontFamily: 'Inter_700Bold', fontWeight: '700' }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Next court date</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>Tap a quick option or type below. Format: YYYY-MM-DD</Text>
          <View style={styles.dateQuickRow}>
            {[
              { label: '+7 days',  days: 7  },
              { label: '+14 days', days: 14 },
              { label: '+30 days', days: 30 },
              { label: '+60 days', days: 60 },
              { label: '+90 days', days: 90 },
            ].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days);
              const iso = d.toISOString().split('T')[0];
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
            placeholder="YYYY-MM-DD (e.g. 2025-11-15)"
            placeholderTextColor={colors.textMuted}
            value={editCase.next_court_date || ''}
            onChangeText={v => setEditCase(p => ({ ...p, next_court_date: v }))}
            keyboardType="numbers-and-punctuation"
          />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>State (2-letter code)</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>Used for expungement eligibility checks -- e.g. TN, CA, FL</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. TN"
            placeholderTextColor={colors.textMuted}
            value={editCase.state || ''}
            onChangeText={v => setEditCase(p => ({ ...p, state: v.toUpperCase().slice(0, 2) }))}
            autoCapitalize="characters"
            maxLength={2}
          />

          <View style={styles.notesLabelRow}>
            <View>
              <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Notes</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.fieldHint}>Attorney name, charges, hearing details, reminders</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button" activeOpacity={0.6}
              style={[styles.micChip, { backgroundColor: colors.legalBg, borderColor: colors.legalDark }]}
              onPress={scanDocument}
              disabled={scanning}
              accessibilityLabel="Scan a document"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.micChipIcon}>📷</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.micChipText, { color: colors.legal }]}>Scan</Text>
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
              accessibilityLabel="Record a voice note for this case"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.micChipIcon}>🎙</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.micChipText, { color: COLORS.navy }]}>Voice note</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder={"e.g. Attorney: John Smith, 615-555-0101. Charged with DUI first offense. Pre-trial hearing Nov 15."}
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
            Defender Tools
          </Text>

          {/* {t('case_ai_title')} -- case-aware Defender Mode */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toolCard, styles.toolCard, { backgroundColor: COLORS.navy, borderColor: COLORS.navy }]}
            onPress={() => {
              const activeCase = cases.find((ca: any) => ['Open','Active'].includes(ca.status));
              const ctx = activeCase
                ? [
                    `Case: ${activeCase.title}`,
                    `Status: ${activeCase.status}`,
                    activeCase.next_court_date ? `Court date: ${activeCase.next_court_date}` : null,
                    activeCase.notes ? `Attorney notes: ${activeCase.notes.slice(0, 500)}` : null,
                  ].filter(Boolean).join('\n')
                : null;
              navigation.navigate('ChatTab', {
                mode:        'defender',
                caseContext: ctx,
                caseTitle:   activeCase?.title || 'Active Case',
                toolCardAI: { borderWidth: 1.5 },
  privilegeNote:     { borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 6 },
  privilegeNoteText: { fontSize: 11, lineHeight: 16 }});
            }}
            accessibilityLabel="Discuss case with AI"
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
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('MotionLibrary', {
              caseId: cases[0]?.id,
              caseTitle: cases[0]?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: '#EF5350' + '18' }]}>
              <AppIcon name="document-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>
                Motion Library
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
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('Discovery', {
              caseId:    cases.find((ca: any) => ['Open','Active'].includes(ca.status))?.id,
              caseTitle: cases.find((ca: any) => ['Open','Active'].includes(ca.status))?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.blue + '18' }]}>
              <AppIcon name="search-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>
                Discovery AI
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
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('LegalResearch', {
              caseContext: cases.find((ca: any) => ['Open','Active'].includes(ca.status))?.title})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.legal + '18' }]}>
              <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>
                Legal Research
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                {t('case_research_sub')}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Voice Notes */}
          <TouchableOpacity accessibilityRole="button"
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('VoiceNote', {
              caseId:        cases.find((ca: any) => ['Open','Active'].includes(ca.status))?.id,
              caseTitle:     cases.find((ca: any) => ['Open','Active'].includes(ca.status))?.title,
              existingNotes: ''})}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: COLORS.navy + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🎙</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>
                Voice Notes
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
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: colors.surface }]}
            onPress={() => navigation.navigate('Translator')}
            accessibilityLabel="Attorney-client interpreter"
          >
            <View style={[styles.toolCardIcon, { backgroundColor: colors.legal + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>🗣</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>
                Interpreter
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
            style={[styles.toolCard, { backgroundColor: COLORS.bgCard, borderColor: COLORS.emergency + '40', borderWidth: 1.5 }]}
            onPress={() => navigation.navigate('DeadlineCalculator')}
          >
            <View style={[styles.toolCardIcon, { backgroundColor: COLORS.emergency + '18' }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 22 }}>⏰</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardTitle, { color: COLORS.bg }]}>Deadline Calculator</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardSub, { color: colors.textMuted }]}>
                Arraignment · Appeal · AEDPA · Speedy Trial -- all critical deadlines
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.toolCardArrow, { color: COLORS.emergency }]}>›</Text>
          </TouchableOpacity>

          {cases.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={[styles.toolsSectionLabel, { color: colors.textMuted, marginTop: 14 }]}>
                Analyze by case
              </Text>
              {cases.filter((ca: any) => ['Open','Active','Pending'].includes(ca.status)).slice(0,5).map((ca: any) => (
                <TouchableOpacity accessibilityRole="button"
                  key={String(ca.id)}
                  style={[styles.caseToolRow, { backgroundColor: isDark ? colors.bg : COLORS.bg, borderColor: colors.surface }]}
                  onPress={() => navigation.navigate('Discovery', {
                    caseId: ca.id, caseTitle: ca.title
                  })}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.caseToolTitle, { color: colors.steel }]}
                    numberOfLines={1}>📁 {String(ca.title)}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.caseToolCta, { color: COLORS.navy }]}>Analyze docs →</Text>
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
  header: { backgroundColor: '#042C53', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  addBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 8 },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn: { backgroundColor: '#042C53', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21},
  card: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { flex: 1, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginRight: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  courtDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.bg, borderRadius: 8, padding: 8, marginBottom: 6 },
  courtDateUrgent: { backgroundColor: '#FFA726', borderWidth: 1, borderColor: '#FFA726' },
  courtDateIcon: { fontSize: 14,
    lineHeight: 21},
  courtDateText: { fontSize: 12, color: colors.bgCard },
  cardNotes: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: 4 },
  cardCreated: { fontSize: 11, color: colors.textMuted },
  modal: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: COLORS.bgCard, borderBottomWidth: 1, borderBottomColor: colors.surface },
  modalClose: { fontSize: 18, color: colors.textMuted, padding: 4 },
  modalTitle: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53' },
  modalSave: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53' },
  errorBanner: { backgroundColor: '#EF5350', margin: 16, borderRadius: 8, padding: 12 },
  errorText: { color: '#EF5350', fontSize: 12 },
  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard, marginTop: 16, marginHorizontal: 16, marginBottom: 2 },
  fieldHint: { fontSize: 12, color: colors.textMuted, marginHorizontal: 16, marginBottom: 6, lineHeight: 16 },
  required: { color: '#EF5350' },
  textInput: { borderWidth: 1.5, borderColor: colors.surface, borderRadius: 12, backgroundColor: COLORS.bgCard, padding: 12, fontSize: 14, lineHeight: 21, color: colors.bgCard, marginHorizontal: 16 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16 },
  statusChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: COLORS.bgCard },
  statusChipText: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  tabRow: { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderBottomWidth: 1.5, borderBottomColor: colors.surface },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2.5, borderBottomColor: '#042C53' },
  tabBtnText: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textMuted },
  tabBtnTextActive: { color: '#042C53', fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  savedCard: {
    backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#042C53', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2},
  savedName:    { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bgCard, marginBottom: 2 },
  savedAddr:    { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  savedRating:  { fontSize: 12, color: '#FFA726', fontFamily: 'Inter_700Bold', fontWeight: '700' },
  savedSpecs:   { fontSize: 11, color: colors.steel, marginTop: 2 },
  savedCallBtn: { backgroundColor: colors.legal, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 10 },
  savedCallText:{ color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  reminderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFA726', padding: 12, marginHorizontal: 14, marginTop: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#F9A825'},
  reminderBannerIcon:  { fontSize: 20 },
  reminderBannerTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#FFA726' },
  reminderBannerSub:   { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  expungeBtn: {
    marginTop: 8, paddingVertical: 9, paddingHorizontal: 12,
    backgroundColor: COLORS.bgSubtle, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.bgSubtle},
  expungeBtnText:  { fontSize: 12, color: COLORS.steel, fontWeight: '700' },
  familySection:     { paddingHorizontal: 16, paddingBottom: 8 },
  familySectionTitle:{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 4 },
  familyCaseRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  familyCaseTitle:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  familyCaseSub:     { fontSize: 11 },
  shareBtn:        { marginTop: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(133,183,235,0.33)' },
  shareBtnText:    { fontSize: 12, color: '#85B7EB', fontFamily: 'Inter_700Bold', fontWeight: '700' },
  calendarBtn:     { marginTop: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.legal, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.legal },
  calendarBtnText: { fontSize: 12, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  scanBtn:         { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, padding: 16, borderRadius: RADIUS.md, backgroundColor: '#042C53', borderWidth: 1, borderColor: 'rgba(133,183,235,0.33)' },
  scanBtnIcon:     { fontSize: 22 },
  scanBtnTitle:    { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bgCard, marginBottom: 2 },
  scanBtnSub:      { fontSize: 11, color: colors.steel },
  offlineBanner: {
    backgroundColor: '#FFA726', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F9A825'},
  offlineBannerText: { fontSize: 12, color: '#FFA726', fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateQuickRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  dateQuickChip:       { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.surface, backgroundColor: COLORS.bg },
  dateQuickChipActive: { backgroundColor: '#042C53', borderColor: '#042C53' },
  dateQuickText:       { fontSize: 12, color: colors.steel, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateQuickTextActive: { color: COLORS.bgCard },
  civilRightsBtn: {
    marginTop: 6, backgroundColor: '#042C53' + '12',
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#042C53' + '40'},
  civilRightsBtnText: {
    fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#042C53'},

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