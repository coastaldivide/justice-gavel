import { AIDisclaimer } from '../components/AIDisclaimer';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
/**
 * DiscoveryScreen -- AI Discovery Document Analysis
 *
 * Design direction: forensic clarity.
 * The interface mirrors how attorneys actually read discovery:
 * sections clearly delineated, inconsistencies standing out in amber,
 * questions presented as a checklist. Monochromatic foundation with
 * surgical use of color -- amber for flags, green for key facts,
 * navy for questions. Feels like a well-designed evidence brief.
 *
 * Flow:
 *   Upload → Analyzing → Result (summary / facts / inconsistencies / questions)
 *   → History
 *
 * Pricing:
 *   $19.99 per document (pay-per-use)
 *   OR Discovery Pro $149.99/mo (unlimited)
 *
 * Entry points:
 *   1. CaseScreen → Defender Tools tab → t('disc_analyze_btn')
 *   2. CaseCard → "📄 Analyze discovery" CTA on each open case
 *   3. Direct navigation
 */
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Animated, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, LayoutAnimation } from 'react-native';
import { FileSystem, RNShare } from '../utils/webCompat';
import { unwrapList, api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import { pollJob } from '../services/jobPoller';
import { usePaymentSheet, PAYMENTS_COMING_SOON } from '../payments';
import { t, useLang, perLang, locale }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { getToken } from '../utils/secureStorage';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Analysis {
  id?:             number;
  filename:        string;
  doc_type:        string;
  summary:         string;
  key_facts:       string[];
  inconsistencies: string[];
  questions:       string[];
  page_count:      number;
  charged?:        string;
  demo?:           boolean;
  created_at?:     string;
}

type Phase = 'upload' | 'analyzing' | 'result' | 'history';

// ── Animated progress bar ─────────────────────────────────────────────────────
function ProgressBar({ active }: { active: boolean }) {
  useLang();
  const progress = useRef(new Animated.Value(0)).current;
  const anim     = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (active) {
      progress.setValue(0);
      anim.current = Animated.timing(progress, {
        toValue:        0.85,
        duration:       55000, // slow -- analysis takes 20-60s
        useNativeDriver: false });
      anim.current.start();
    } else {
      anim.current?.stop();
      Animated.timing(progress, {
        toValue: active ? 1 : 0, duration: 300, useNativeDriver: false }).start();
    }
    return () => anim.current?.stop();
  }, [active, progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.progressBg}>
      <Animated.View style={[styles.progressFill, { width }]} />
    </View>
  );
}

// ── Result section ────────────────────────────────────────────────────────────
// ── Confidence tag helpers ───────────────────────────────────────────────────
function ConfidenceTag({ text }: { text: string }) {
  useLang();
  if (text.startsWith('[STRONG]'))  return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.emergencyDark,
      backgroundColor: COLORS.emergencyBg, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>{t('x_discovery_strong')}</Text>
  );
  if (text.startsWith('[NOTABLE]')) return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.warnDark,
      backgroundColor: COLORS.warnBg, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>{t('x_discovery_notable')}</Text>
  );
  if (text.startsWith('[POSSIBLE]')) return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.textSecond,
      backgroundColor: COLORS.bgSubtle, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>{t('x_discovery_possible_verify')}</Text>
  );
  return null;
}
function stripTag(text: string): string {
  return text.replace(/^\[(STRONG|NOTABLE|POSSIBLE)\]\s*/, '');
}

function Section({
  icon, title, items, color, bg, borderColor, numbered }: {
  icon: string; title: string; items: string[];
  color: string; bg: string; borderColor: string;
  numbered?: boolean;
  onItemPress?: (item: string) => void;
}) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  if (!items?.length) return null;

  return (
    <Animated.View style={[styles.section, { backgroundColor: bg, borderColor, opacity: fadeAnim }]}>
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={styles.sectionHeader}
        onPress={() => setExpanded(e => !e)}
      >
        <View style={styles.sectionTitleRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionIcon}>{icon}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color }]}>{title}</Text>
          <View style={[styles.sectionCount, { backgroundColor: color }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.sectionCountText}>{items.length}</Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[styles.chevron, { color }]}>{expanded ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.sectionBody}>
          {(items || []).map((item, i) => (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              key={`row-${i}`}
              style={styles.itemRow}
              onPress={() => {
                Clipboard.setStringAsync(stripTag(item))
                  .then(() => showToast(t('x_ch_copied_clipboard'), 'success'))
                  .catch(() => {});
              }}
              accessibilityLabel={t('x_discovery_copy_item', { item })}
            >
              <View style={[styles.itemBullet, { backgroundColor: color }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.itemBulletText}>
                  {numbered ? String(i + 1) : '›'}
                </Text>
              </View>
              {/* The analysis tags findings [STRONG]/[NOTABLE]/[POSSIBLE]: show a badge, not the raw tag. */}
              <View style={{ flex: 1 }}>
                <ConfidenceTag text={item} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.itemText, { color: COLORS.textSecond }]} selectable={true}>{stripTag(item)}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={[styles.tapToCopy, { color: COLORS.textMuted }]}>
            {t('x_discovery_tap_any_item_copy')}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryRow({ item, onOpen, onDelete }: any) {
  useLang();
  return (
    <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      style={[styles.histRow, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}
      onPress={() => onOpen(item)}
    >
      <View style={[styles.histDocIcon, { backgroundColor: COLORS.bgSubtle }]}>
        <AppIcon name="document-outline" size={20} color={COLORS.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histFilename, { color: COLORS.textPrimary }]}
          numberOfLines={1}>{item.filename}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histMeta, { color: COLORS.textMuted }]}>
          {item.doc_type}
          {item.page_count > 0 ? '  ·  ' + t('x_discovery_pages_short', { n: item.page_count }) : ''}
          {item.inconsistencies_count > 0 ? '  ' + t('x_discovery_flags', { inconsistencies_count: item.inconsistencies_count }) : ''}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histDate, { color: COLORS.textMuted }]}>
          {new Date(item.created_at ?? 0).toLocaleDateString(locale(), {
            month: 'short', day: 'numeric', year: 'numeric'
          })}
        </Text>
      </View>
      <TouchableOpacity
  accessibilityRole="button"

        onPress={() => onDelete(item.id)}
        style={styles.histDelete}
        accessibilityLabel={t('x_discovery_delete_analysis')}
          accessibilityHint={t('x_discovery_permanently_removes_this_item')}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.textMuted, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const DOC_TYPES = perLang(() => [
    t('disc_doc_police'),  t('disc_doc_lab'),       t('disc_doc_medical'),
    t('disc_doc_witness'), t('disc_doc_bodycam'),    t('disc_doc_warrant'),
    t('disc_doc_crime_scene'), t('disc_doc_evidence'), t('disc_doc_court'),
    t('disc_doc_da'),      t('disc_doc_tox'),        t('disc_doc_transcript'),
  ]);

function DiscoveryScreen({ route, navigation }: ScreenProps) {
  useLang();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { colors, isDark } = useTheme();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { caseId, caseTitle } = (route?.params as import('../types/api').RouteParams) ?? {};

  const [phase,     setPhase]     = useState<Phase>('upload');
  const [file,      setFile]      = useState<{ name: string; uri: string; size: number } | null>(null);
  const [docType,   setDocType]   = useState('');
  const [analysis,  setAnalysis]  = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [history,   setHistory]   = useState<any[]>([]);
  const [histLoad,  setHistLoad]  = useState(false);
  const [hasPro,    setHasPro]    = useState(false);
  const [paymentsLive, setPaymentsLive] = useState(true);

  // Pro status and whether payments are live — for a signed-in person (guests sign in at "Analyze").
  useEffect(() => {
    getToken().then(tk => {
      if (!tk) return;
      api.get('/discovery/status')
        .then(r => { setHasPro(r.data?.has_pro || false); setPaymentsLive(r.data?.payments_live !== false); })
        .catch((e) => { __DEV__ && console.warn(e?.message); });
    }, () => undefined);
  }, []);


  // Get icon based on file type
  const fileIcon = (name: string = '') => {
    const ext = name.toLowerCase();
    if (ext.endsWith('.pdf')) return '📄';
    if (['.jpg','.jpeg','.png','.tiff','.tif','.heic','.heif','.webp'].some(e => ext.endsWith(e))) return '🖼️';
    if (['.doc','.docx'].some(e => ext.endsWith(e))) return '📝';
    if (ext.endsWith('.txt')) return '📃';
    return '📎';
  };

  const pickFile = useCallback(async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/heic',
          'image/heif', 'image/webp',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ],
        copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 32 * 1024 * 1024) {
        showToast(t('x_discovery_maximum_pdf_size_32mb'));
        return;
      }
      setFile({ name: asset.name, uri: asset.uri, size: asset.size || 0 });
    } catch (e: any) {
      showToast(e?.message || t('x_discovery_could_not_open_file'), 'error');
    }
  }, [showToast]);


  const { available: sheetAvailable, initPaymentSheet, presentPaymentSheet } = usePaymentSheet();

  /** POST the file (with a paid PaymentIntent the second time); returns the response body. */
  const postFile = useCallback(async (paymentIntentId?: string) => {
    if (!file) throw new Error('no file');
    const formData = new FormData();
    const getFileMime = (name: string) => {
      const ext = name.toLowerCase();
      if (ext.endsWith('.pdf'))  return 'application/pdf';
      if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
      if (ext.endsWith('.png'))  return 'image/png';
      if (ext.endsWith('.webp')) return 'image/webp';
      if (ext.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (ext.endsWith('.doc'))  return 'application/msword';
      if (ext.endsWith('.txt'))  return 'text/plain';
      return 'application/octet-stream';
    };
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      formData.append('document', new File([blob], file.name, { type: blob.type || getFileMime(file.name) }));
    } else {
      formData.append('document', { uri: file.uri, type: getFileMime(file.name), name: file.name } as any);
    }
    formData.append('doc_type', docType);
    formData.append('case_context', caseTitle || '');
    if (caseId) formData.append('case_id', String(caseId));
    if (paymentIntentId) formData.append('payment_intent_id', paymentIntentId);
    const res = await api.post('/discovery/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90_000 });
    return res.data as { jobId?: string };
  }, [file, docType, caseId, caseTitle]);

  const runAnalysis = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setPhase('analyzing');
    const fail = (m: string) => { showToast(m, 'error'); setPhase('upload'); };
    try {
      let body: { jobId?: string };
      try {
        body = await postFile();
      } catch (e: any) {
        const d = e?.response?.data;
        if (e?.response?.status !== 402 || !d?.requires_payment) throw e;
        // Not a Pro subscriber: pay for this document with the Stripe payment sheet, then send it again.
        if (!sheetAvailable || !d.client_secret) return fail(PAYMENTS_COMING_SOON());
        const init = await initPaymentSheet({ paymentIntentClientSecret: d.client_secret, merchantDisplayName: 'Justice Gavel' });
        if (init.error) return fail(init.error.message || t('x_booking_payment_setup_failed_please'));
        const paid = await presentPaymentSheet();
        if (paid.error) { if (paid.error.code !== 'Canceled') fail(paid.error.message || t('x_quick_connect_card_was_declined_please')); else setPhase('upload'); return; }
        body = await postFile(d.payment_intent_id);
      }
      if (!body?.jobId) throw new Error('no job');
      const job = await pollJob(body.jobId, { timeoutMs: 180_000 });
      if (job.status === 'failed' || !job.result) throw new Error(job.error || t('x_discovery_analysis_failed'));
      setAnalysis({ ...(job.result as Analysis), filename: file.name });
      setPhase('result');
      if (Platform.OS !== 'web') await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
    } catch (e: any) {
      if (isPaymentsUnavailable(e) || e?.response?.status === 503) return fail(t('disc2_payments_off'));
      fail(t('x_discovery_try_smaller_pdf_check', { msg: apiErrorMessage(e, t('x_discovery_analysis_failed')) }));
    } finally {
      setAnalyzing(false);
    }
  }, [file, postFile, sheetAvailable, initPaymentSheet, presentPaymentSheet, showToast]);

  const analyze = useCallback(async () => {
    if (!file) return;
    requireAuth(async () => {
      if (!hasPro && !paymentsLive) { showToast(t('disc2_payments_off'), 'info'); return; }
      // Confirm payment if not Pro subscriber
      if (!hasPro) {
        confirm(t('x_discovery_analyze_19_99', { name: file.name }),
          t('x_discovery_full_analysis_summary_key'),
          { confirmLabel: t('x_discovery_analyze_19_99_2') }).then(async ok => { if (!ok) return;
          runAnalysis();
        });
      } else {
        runAnalysis();
      }
    });
  }, [file, hasPro, paymentsLive, requireAuth, confirm, runAnalysis, showToast]);

  const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
          const res = await api.get('/discovery/history');
      setHistory(unwrapList(res.data, 'history', 'analyses'));
      setPhase('history');
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setHistLoad(false);
  }, []);

  // Header buttons (declared after loadHistory, which they call).
  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? t('x_discovery_analysis_history') : t('x_discovery_discovery'),
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 12, marginRight: 14 }}>
          {phase !== 'history' && (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={loadHistory} accessibilityLabel={t('x_discovery_history')}>
              <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{t('x_discovery_history')}</Text>
            </TouchableOpacity>
          )}
          {phase === 'result' && (
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              onPress={() => {
              setPhase('upload'); setFile(null); setAnalysis(null); setDocType('');
            }}>
              <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{t('x_discovery_new')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) });
  }, [colors.textBrand, phase, loadHistory, navigation]);

  const openHistoryItem = useCallback(async (item: Record<string,unknown>) => {
    try {
      const res = await api.get(`/discovery/analysis/${item.id}`);
      setAnalysis(res.data || null);
      setPhase('result');
    } catch {
      showToast(t('disc_load_error'), 'error');
    }
  }, [showToast]);

  const deleteAnalysis = useCallback(async (id: number) => {
    confirm(t('x_discovery_delete_analysis_2'),t('x_discovery_this_cannot_be_undone'),
      { confirmLabel:t('case_delete'), destructive:true }).then(async ok=>{ if(!ok) return;
      await api.delete(`/discovery/analysis/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setHistory(h => h.filter(a => a.id !== id));
    });
  }, [confirm]);

  const shareAnalysis = useCallback(async () => {
    if (!analysis) return;
    const text = [
      `📄 ${analysis.filename} -- Discovery Analysis`,
      `\nSUMMARY\n${analysis.summary}`,
      analysis.key_facts?.length
        ? '\n' + t('x_discovery_key_facts', { value: (analysis.key_facts ?? []).map((f,i) => `${i+1}. ${f}`).join('\n') })
        : '',
      analysis.inconsistencies?.length
        ? `\n⚠️ INCONSISTENCIES\n${(analysis.inconsistencies ?? []).map((f,i) => `${i+1}. ${f}`).join('\n')}`
        : '',
      analysis.questions?.length
        ? '\n' + t('x_discovery_cross_examination_questions', { value: (analysis.questions ?? []).map((f,i) => `${i+1}. ${f}`).join('\n') })
        : '',
    ].filter(Boolean).join('\n');
    try {
      await RNShare.share({ message: text, title: analysis.filename });
    } catch {
      // Share API unavailable on this browser/device — fail silently
    }
  }, [analysis]);

  // ── RENDER: Upload ────────────────────────────────────────────────────────
  if (phase === 'upload') return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.uploadScroll}>
      <AuthGateModal />

      {caseTitle && (
        <View style={[styles.casePill, { backgroundColor: COLORS.navy + '14', borderColor: COLORS.navy + '30' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.casePillText, { color: COLORS.navy }]}>📁  {caseTitle}</Text>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageTitle, { color: colors.textPrimary }]}>{t('disc_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageSub, { color: colors.textMuted }]}>
        {t('disc_sub')}
      </Text>

      {/* Drop zone */}
      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={[styles.dropZone, {
          borderColor: file ? COLORS.legal : colors.border,
          backgroundColor: file
            ? (isDark ? colors.legalBg : colors.legalBg)
            : colors.bgCard }]}
        onPress={pickFile}
        activeOpacity={0.8}
        accessibilityLabel={t('x_discovery_select_discovery_document')}
      >
        {file ? (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.dropIcon}>{fileIcon(file.name)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropFilename, { color: COLORS.legal }]}
              numberOfLines={2}>{file.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSize, { color: colors.textMuted }]}>
              {file.size ? t('x_discovery_kb', { value: (file.size / 1024).toFixed(0) }) : t('x_discovery_ready')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropChange, { color: COLORS.steel }]}>{t('disc_tap_change')}</Text>
          </>
        ) : (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.dropIcon}>⬆️</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropPrompt, { color: colors.textPrimary }]}>
              {t('disc_upload_prompt')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSub, { color: colors.textMuted }]}>
              PDF · JPEG · PNG · TIFF · HEIC · DOCX · TXT
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSub, { color: colors.textMuted }]}>
              {t('disc_upload_examples')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropLimit, { color: colors.textMuted }]}>{t('disc_max_size')}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Document type selector */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>
        {t('x_discovery_document_type_optional_helps')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.typeScroll} contentContainerStyle={{ gap: 8 }}>
        {DOC_TYPES().map(tItem => (
          <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            key={tItem}
            style={[styles.typeChip, {
              backgroundColor: docType === tItem
                ? COLORS.navy : colors.bgCard,
              borderColor: docType === tItem ? COLORS.navy : colors.border }]}
            onPress={() => setDocType(docType === tItem ? '' : tItem)}
            accessibilityLabel={tItem}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.typeChipText,
              { color: docType === tItem ? colors.bgCard : colors.textSecond }]}>
              {tItem}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* What you'll get */}
      {!file && (
        <View style={[styles.previewCard, {
          backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle,
          borderColor: COLORS.navy + '33' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.previewTitle, { color: COLORS.navy }]}>{t('x_discovery_what_ll_receive')}</Text>
          {[
            ['📝', t('x_discovery_plain_english_summary_document')],
            ['🔍', t('x_discovery_key_facts_extracted_dates')],
            ['⚠️', t('x_discovery_inconsistencies_flagged_with_exact')],
            ['❓', t('x_discovery_suggested_cross_examination_question')],
          ].map(([icon, text]) => (
            <View key={text as string} style={styles.previewRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.previewIcon}>{icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.previewText, { color: colors.textSecond }]}>{text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Pricing */}
      <View style={[styles.pricingRow, {
        backgroundColor: hasPro
          ? (isDark ? colors.legalBg : colors.legalBg)
          : (isDark ? colors.bgCard : colors.bg),
        borderColor: hasPro ? COLORS.legal + '55' : colors.border }]}>
        {hasPro ? (
          <Text maxFontSizeMultiplier={1.4} style={[styles.pricingText, { color: COLORS.legal }]}>
            {t('x_discovery_discovery_pro_unlimited_analyses')}
          </Text>
        ) : (
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.pricingText, { color: colors.textPrimary }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>{t('x_discovery_19_99_per_document')}</Text>
            </Text>
          </View>
        )}
      </View>

      {/* Analyze button */}
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
        style={[styles.analyzeBtn, {
          backgroundColor: file ? COLORS.navy : colors.border }, analyzing && { opacity: 0.6 }]}
        onPress={analyze}
        disabled={!file || analyzing}
        accessibilityLabel={t('x_discovery_analyze_document', { value: hasPro ? 'included' : '$19.99' })}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.analyzeBtnText}>
          {hasPro ? t('x_discovery_analyze_document_2') : t('x_discovery_analyze_19_99_3')}
        </Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
        {t('x_discovery_pdfs_not_stored_analyzed')}
      </Text>
    </ScrollView>
  );

  // ── RENDER: Analyzing ─────────────────────────────────────────────────────
  if (phase === 'analyzing') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.analyzingWrap}>
        <AppIcon name="search-outline" size={20} color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingTitle, { color: colors.textPrimary }]}>
          {t('disc_analyzing')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingFile, { color: colors.textMuted }]}
          numberOfLines={1}>{file?.name}</Text>

        <ProgressBar active={analyzing} />

        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingSteps, { color: colors.textMuted }]}>
          {t('x_discovery_reading_full_document_extracting')}
        </Text>

        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingTime, { color: colors.textMuted }]}>
          {t('x_discovery_usually_30_60_seconds')}
        </Text>
      </View>
    </View>
  );

  // ── RENDER: History ───────────────────────────────────────────────────────
  if (phase === 'history') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 16 }}>
      {histLoad
        ? <ActivityIndicator color={COLORS.navy} style={{ marginTop: 40 }} />
        : history.length === 0
        ? (
          <View style={styles.emptyWrap}>
            <AppIcon name="document-outline" size={20} color={COLORS.navy} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('x_discovery_no_analyses_yet')}</Text>
            <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              style={[styles.analyzeBtn, { backgroundColor: COLORS.navy, width: '100%', marginTop: 16 }]}
              accessibilityLabel={t('x_discovery_upload_document')} onPress={() => setPhase('upload')}
          >
              <Text maxFontSizeMultiplier={1.4} style={styles.analyzeBtnText}>{t('x_discovery_upload_document')}</Text>
            </TouchableOpacity>
          </View>
        )
        : history.map(item => (
          <HistoryRow
            key={item.id}
            item={item}
            onOpen={openHistoryItem}
            onDelete={deleteAnalysis}
          />
        ))
      }
    </ScrollView>
  );

  // ── RENDER: Result ────────────────────────────────────────────────────────
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="discovery-screen"
      contentContainerStyle={styles.resultScroll}
      showsVerticalScrollIndicator={false}>

      {/* Document header */}
      <View style={[styles.resultHeader, {
        backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle,
        borderColor: COLORS.navy + '33' }]}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.resultFilename, { color: COLORS.navy }]}
            numberOfLines={1}>{analysis?.filename}</Text>
          <View style={styles.resultMeta}>
            {analysis?.doc_type && (
              <View style={[styles.docTypeBadge, { backgroundColor: COLORS.navy }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.docTypeBadgeText}>{analysis.doc_type}</Text>
              </View>
            )}
            {analysis?.page_count ? (
              <Text maxFontSizeMultiplier={1.4} style={[styles.resultMetaText, { color: colors.textMuted }]}>
                {t('x_discovery_pages', { page_count: analysis.page_count })}
              </Text>
            ) : null}
            {analysis?.charged && (
              <Text maxFontSizeMultiplier={1.4} style={[styles.resultMetaText, { color: colors.textMuted }]}>
                · {analysis.charged}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity accessibilityRole="button"

          onPress={shareAnalysis}
          style={styles.shareBtn}
          accessibilityLabel={t('x_discovery_share_analysis')}
          accessibilityHint={t('x_deadline_calculator_shares_this_information')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.shareBtnText, { color: COLORS.navy }]}>{t('x_bar_prep_explanation_share')}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.summaryLabel, { color: colors.textMuted }]}>{t('x_discovery_summary')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.summaryText, { color: colors.textPrimary }]}>
          {analysis?.summary}
        </Text>
      </View>

      {/* Inconsistencies -- shown first, most critical */}
      {!!analysis?.inconsistencies?.length && (
        <Text maxFontSizeMultiplier={1.4} style={[styles.inconsistNote, { color: colors.textMuted }]}>
          {t('x_discovery_tap_any_flagged_inconsistency')}
        </Text>
      )}
      {!!analysis?.inconsistencies?.length && (
        <Section
          icon="⚠️"
          title={t('x_discovery_inconsistencies_red_flags')}
          items={analysis.inconsistencies}
          color={colors.bail}
          bg={isDark ? colors.bailBg : colors.warnBg}
          borderColor={colors.warn}
          numbered
          onItemPress={(inconsistency) => {
            navigation.navigate('MoreTab', {
              screen: 'MotionLibrary',
              params: {
                motion_type: 'suppress',
                prefill: {
                  grounds: `Discovery AI flagged: ${inconsistency}`,
                  specific_violation: inconsistency,
                  amendment_theory: '4th Amendment -- evidence obtained from unlawful search or seizure' },
                caseTitle: caseTitle,
                caseId: caseId } });
            }}
        />
      )}

      {/* Key facts */}
      <Section
        icon="🔍"
        title={t('disc_result_facts')}
        items={analysis?.key_facts || []}
        color={COLORS.legal}
        bg={isDark ? colors.legalBg : colors.legalBg}
        borderColor={colors.legal}
      />

      {/* Questions */}
      <Section
        icon="❓"
        title={t('x_discovery_suggested_questions')}
        items={analysis?.questions || []}
        color={COLORS.navy}
        bg={isDark ? colors.textPrimary : colors.bgSubtle}
        borderColor={COLORS.navy + '44'}
        numbered
      />

      <View style={{ height: 40 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:colors.textSecond, fontStyle:'italic', lineHeight:16 }}>
          {t('x_discovery_ai_document_analysis_not')}
        </Text>
      </View>
      <AIDisclaimer variant="banner" />

      </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },

  // Upload
  uploadScroll: { padding: 16, paddingBottom: 40 },
  casePill:     { alignSelf: 'flex-start', borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  casePillText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  pageTitle:    { fontSize: 22, ...FONTS.black, marginBottom: 6 },
  pageSub:      { fontSize: 12, lineHeight: 20, marginBottom: 16 },

  dropZone: {
    borderWidth: 2, borderStyle: 'dashed', borderRadius: RADIUS.xl,
    padding: 32, alignItems: 'center', marginBottom: 16, ...SHADOW.sm },
  dropIcon:     { fontSize: 40, marginBottom: 10 },
  dropPrompt:   { fontSize: 16, lineHeight: 24, ...FONTS.heavy, marginBottom: 6 },
  dropSub:      { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  dropLimit:    { fontSize: 11, marginTop: 8 },
  dropFilename: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, textAlign: 'center', marginBottom: 4 },
  dropSize:     { fontSize: 12, marginBottom: 4 },
  dropChange:   { fontSize: 12, fontWeight: '600', marginTop: 4 },

  fieldLabel:   { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  typeScroll:   { marginBottom: 16 },
  typeChip:     { paddingHorizontal: 13, paddingVertical: 8, borderRadius: RADIUS.pill,
    borderWidth: 1.5, flexShrink: 0 },
  typeChipText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  previewCard:  { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 14 },
  previewTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 0.6, marginBottom: 10 },
  previewRow:   { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  previewIcon:  { fontSize: 16,
    lineHeight: 24, width: 22, flexShrink: 0 },
  previewText:  { flex: 1, fontSize: 12, lineHeight: 18 },

  pricingRow:   { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md,
    borderWidth: 1, padding: 12, marginBottom: 14 },
  pricingText:  { fontSize: 12, lineHeight: 18 },
  proLink:      { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginTop: 4 },

  analyzeBtn:   { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center',
    marginBottom: 10, ...SHADOW.sm },
  analyzeBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  disclaimer:   { fontSize: 11, textAlign: 'center', lineHeight: 16 },

  // Analyzing
  analyzingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  analyzingEmoji: { fontSize: 48, marginBottom: 16 },
  analyzingTitle: { fontSize: 20, ...FONTS.black, textAlign: 'center', marginBottom: 6 },
  analyzingFile:  { fontSize: 12, lineHeight: 20, maxWidth: 260, textAlign: 'center', marginBottom: 24 },
  progressBg:     { width: '100%', height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16, overflow: 'hidden' },
  progressFill:   { height: 4, borderRadius: 2, backgroundColor: COLORS.navy },
  analyzingSteps: { fontSize: 12, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  analyzingTime:  { fontSize: 11, textAlign: 'center' },

  // Result
  resultScroll:   { padding: 16, paddingBottom: 40 },
  resultHeader:   { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.lg,
    borderWidth: 1, padding: 12, marginBottom: 12 },
  resultFilename: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, marginBottom: 6 },
  resultMeta:     { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  docTypeBadge:   { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  docTypeBadgeText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  resultMetaText: { fontSize: 11 },
  shareBtn:       { paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.navy + '55' },
  shareBtnText:   { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  summaryCard:    { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  summaryLabel:   { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  summaryText:    { fontSize: 14, lineHeight: 22 },

  // Section
  section:        { borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  sectionTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIcon:    { fontSize: 16,
    lineHeight: 24 },
  sectionTitle:   { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionCount:   { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  sectionCountText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  chevron:        { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  sectionBody:    { paddingHorizontal: 16, paddingBottom: 12 },
  itemRow:        { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-start' },
  itemBullet:     { width: 20, height: 20, borderRadius: 8, alignItems: 'center',
    justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  itemBulletText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  itemText:       { flex: 1, fontSize: 14, lineHeight: 19 },
  tapToCopy:      { fontSize: 11, marginTop: 4, textAlign: 'right' },

  // History
  histRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, padding: 16, marginBottom: 8 },
  histDocIcon:  { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  histFilename: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  histMeta:     { fontSize: 11, marginBottom: 2 },
  histDate:     { fontSize: 11 },
  histDelete:   { padding: 6 },

  // Empty
  emptyWrap:   { alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 48, paddingHorizontal: 32 },
  emptyTitle:  { fontSize: 18, ...FONTS.heavy },

  discussBtn:     { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  discussBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.3 },
  inconsistNote:  { fontSize: 11, fontStyle: 'italic', marginBottom: 6, paddingHorizontal: 4 } });

// Module-level fallback for helper components
const styles = makeStyles(COLORS);
export default React.memo(DiscoveryScreen);