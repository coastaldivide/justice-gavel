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
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Animated, Share, Clipboard } from 'react-native';
import { FileSystem, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { api } from '../services/api';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';

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
  const progress = useRef(new Animated.Value(0)).current;
  const anim     = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
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
  }, [active]);

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
  if (text.startsWith('[STRONG]'))  return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.emergencyDark,
      backgroundColor: colors.emergencyBg, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>STRONG</Text>
  );
  if (text.startsWith('[NOTABLE]')) return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.warnDark,
      backgroundColor: colors.warnBg, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>NOTABLE</Text>
  );
  if (text.startsWith('[POSSIBLE]')) return (
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textSecond,
      backgroundColor: colors.bgSubtle, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' }}>POSSIBLE -- verify</Text>
  );
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
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
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  if (!items?.length) return null;

  return (
    <Animated.View style={[styles.section, { backgroundColor: bg, borderColor, opacity: fadeAnim }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setExpanded(e => !e)}
        accessibilityRole="button"
        accessibilityLabel={`${title} -- ${expanded ? 'collapse' : 'expand'}`}
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
          {items.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={styles.itemRow}
              onPress={() => Clipboard.setString(item)}
            accessibilityRole="button"
              accessibilityLabel={`Copy item: ${item}`}
              accessibilityRole="button"
            >
              <View style={[styles.itemBullet, { backgroundColor: color }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.itemBulletText}>
                  {numbered ? String(i + 1) : '›'}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.itemText, { color: colors.textSecond }]} selectable={true}>{item}</Text>
            </TouchableOpacity>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={[styles.tapToCopy, { color: colors.textMuted }]}>
            Tap any item to copy
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryRow({ item, onOpen, onDelete }: Record<string,unknown>) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.histRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      onPress={() => onOpen(item)}
      accessibilityRole="button"
    >
      <View style={[styles.histDocIcon, { backgroundColor: colors.bgSubtle }]}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>📄</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histFilename, { color: colors.textPrimary }]}
          numberOfLines={1}>{item.filename}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histMeta, { color: colors.textMuted }]}>
          {item.doc_type}
          {item.page_count > 0 ? `  ·  ${item.page_count}p` : ''}
          {item.inconsistencies_count > 0 ? `  ·  ${item.inconsistencies_count} flags` : ''}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.histDate, { color: colors.textMuted }]}>
          {new Date(item.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          })}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => onDelete(item.id)}
            accessibilityRole="button"
        style={styles.histDelete}
        accessibilityLabel="Delete analysis"
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const DOC_TYPES = [
    t('disc_doc_police'),  t('disc_doc_lab'),       t('disc_doc_medical'),
    t('disc_doc_witness'), t('disc_doc_bodycam'),    t('disc_doc_warrant'),
    t('disc_doc_crime_scene'), t('disc_doc_evidence'), t('disc_doc_court'),
    t('disc_doc_da'),      t('disc_doc_tox'),        t('disc_doc_transcript'),
  ];

export default function DiscoveryScreen({ route, navigation }: ScreenProps) {
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors, isDark } = useTheme();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { caseId, caseTitle } = route?.params ?? {};

  const [phase,     setPhase]     = useState<Phase>('upload');
  const [file,      setFile]      = useState<{ name: string; uri: string; size: number } | null>(null);
  const [docType,   setDocType]   = useState('');
  const [analysis,  setAnalysis]  = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [history,   setHistory]   = useState<any[]>([]);
  const [histLoad,  setHistLoad]  = useState(false);
  const [hasPro,    setHasPro]    = useState(false);

    useEffect(() => {
    api.get('/discovery/status')
      .then(r => setHasPro(r.data?.has_pro || false))
      .catch((e) => { __DEV__ && console.warn(e?.message); });
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? '📄 Analysis History' : '📄 Discovery',
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 12, marginRight: 14 }}>
          {phase !== 'history' && (
            <TouchableOpacity onPress={loadHistory} accessibilityRole="button">
              <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>History</Text>
            </TouchableOpacity>
          )}
          {phase === 'result' && (
            <TouchableOpacity onPress={() => {
              setPhase('upload'); setFile(null); setAnalysis(null); setDocType('');
            }} accessibilityRole="button">
              <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>New</Text>
            </TouchableOpacity>
          )}
        </View>
      ) });
  }, [phase]);

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
        Alert.alert('File too large', 'Maximum PDF size is 32MB.');
        return;
      }
      setFile({ name: asset.name, uri: asset.uri, size: asset.size || 0 });
    } catch (e) {
      Alert.alert('Could not open file', e.message);
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!file) return;
    requireAuth(async () => {
      // Confirm payment if not Pro subscriber
      if (!hasPro) {
        Alert.alert(
          'Analyze Document -- $19.99',
          `Analyze "${file.name}" for $19.99?\n\nYou'll receive a full analysis: summary, key facts, inconsistencies flagged, and suggested cross-examination questions.\n\nDiscovery Pro ($149.99/mo) includes unlimited analyses.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Analyze -- $19.99', onPress: runAnalysis },
          ]
        );
      } else {
        runAnalysis();
      }
    });
  }, [file, hasPro, requireAuth]);

  const runAnalysis = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setPhase('analyzing');

    try {
      // Read PDF as base64
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64 });

      // Send as multipart form data
      const formData = new FormData();
      // Detect MIME type from extension for proper server-side routing
      const getFileMime = (name: string) => {
        const ext = name.toLowerCase();
        if (ext.endsWith('.pdf'))  return 'application/pdf';
        if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
        if (ext.endsWith('.png'))  return 'image/png';
        if (ext.endsWith('.tiff') || ext.endsWith('.tif')) return 'image/tiff';
        if (ext.endsWith('.heic') || ext.endsWith('.heif')) return 'image/heic';
        if (ext.endsWith('.webp')) return 'image/webp';
        if (ext.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (ext.endsWith('.doc'))  return 'application/msword';
        if (ext.endsWith('.txt'))  return 'text/plain';
        return 'application/octet-stream';
      };
      formData.append('document', {
        uri:  file.uri,
        type: getFileMime(file.name),
        name: file.name } as any);
      formData.append('doc_type',     docType);
      formData.append('case_context', caseTitle || '');
      if (caseId) formData.append('case_id', String(caseId));

      const res = await api.post('/discovery/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000, // 90s -- large PDFs take time
      });

      setAnalysis({ ...res.data, filename: file.name });
      setPhase('result');

      // Clean up cached PDF
      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch((e) => { __DEV__ && console.warn(e?.message); });
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Analysis failed.';
      Alert.alert('Analysis failed', msg + '\n\nTry a smaller PDF or check your connection.', [
        { text: 'Try again', onPress: () => setPhase('upload') },
        { text: 'Cancel',    onPress: () => setPhase('upload'), style: 'cancel' },
      ]);
      setPhase('upload');
    } finally {
      setAnalyzing(false);
    }
  }, [file, docType, caseId, caseTitle]);

  const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      const res = await api.get('/discovery/history');
      setHistory(res.data || []);
      setPhase('history');
    } catch (e) { __DEV__ && console.warn(e?.message); }
    setHistLoad(false);
  }, []);

  const openHistoryItem = useCallback(async (item: Record<string,unknown>) => {
    try {
      const res = await api.get(`/discovery/analysis/${item.id}`);
      setAnalysis(res.data || null);
      setPhase('result');
    } catch {
      Alert.alert(t('disc_load_error'));
    }
  }, []);

  const deleteAnalysis = useCallback(async (id: number) => {
    Alert.alert('Delete analysis?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await api.delete(`/discovery/analysis/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setHistory(h => h.filter(a => a.id !== id));
      }},
    ]);
  }, []);

  const shareAnalysis = useCallback(async () => {
    if (!analysis) return;
    const text = [
      `📄 ${analysis.filename} -- Discovery Analysis`,
      `\nSUMMARY\n${analysis.summary}`,
      analysis.key_facts?.length
        ? `\nKEY FACTS\n${analysis.key_facts.map((f,i) => `${i+1}. ${f}`).join('\n')}`
        : '',
      analysis.inconsistencies?.length
        ? `\n⚠️ INCONSISTENCIES\n${analysis.inconsistencies.map((f,i) => `${i+1}. ${f}`).join('\n')}`
        : '',
      analysis.questions?.length
        ? `\nCROSS-EXAMINATION QUESTIONS\n${analysis.questions.map((f,i) => `${i+1}. ${f}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');
    try {
      await Share.share({ message: text, title: analysis.filename });
    } catch (shareErr) {
      // Share API unavailable on this browser/device — fail silently
    }
  }, [analysis]);

  // ── RENDER: Upload ────────────────────────────────────────────────────────
  if (phase === 'upload') return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} tintColor={colors.textSecond} />} style={[styles.screen, { backgroundColor: colors.bg }]}
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
        style={[styles.dropZone, {
          borderColor: file ? COLORS.legal : colors.border,
          backgroundColor: file
            ? (isDark ? colors.legalBg : colors.legalBg)
            : colors.bgCard }]}
        onPress={pickFile}
        activeOpacity={0.8}
        accessibilityLabel="Select discovery document"
        accessibilityRole="button"
      >
        {file ? (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.dropIcon}>{fileIcon(file.name)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropFilename, { color: COLORS.legal }]}
              numberOfLines={2}>{file.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSize, { color: colors.textMuted }]}>
              {file.size ? `${(file.size / 1024).toFixed(0)} KB` : 'Ready'}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropChange, { color: COLORS.steel }]}>Tap to change</Text>
          </>
        ) : (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.dropIcon}>⬆️</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropPrompt, { color: colors.textPrimary }]}>
              Tap to select a document
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSub, { color: colors.textMuted }]}>
              PDF · JPEG · PNG · TIFF · HEIC · DOCX · TXT
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropSub, { color: colors.textMuted }]}>
              Police reports · Lab results · Warrants · Evidence photos · DA letters
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.dropLimit, { color: colors.textMuted }]}>Max 32MB</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Document type selector */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>
        Document type (optional -- helps with analysis)
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.typeScroll} contentContainerStyle={{ gap: 8 }}>
        {DOC_TYPES.map(t => (
          <TouchableOpacity
            accessibilityRole="button"
            key={t}
            style={[styles.typeChip, {
              backgroundColor: docType === t
                ? COLORS.navy : colors.bgCard,
              borderColor: docType === t ? COLORS.navy : colors.border }]}
            onPress={() => setDocType(docType === t ? '' : t)}
            accessibilityLabel={t}
            accessibilityRole="radio"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.typeChipText,
              { color: docType === t ? colors.bgCard : colors.textSecond }]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* What you'll get */}
      {!file && (
        <View style={[styles.previewCard, {
          backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle,
          borderColor: COLORS.navy + '33' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.previewTitle, { color: COLORS.navy }]}>What you'll receive</Text>
          {[
            ['📝', 'Plain English summary of the document'],
            ['🔍', 'Key facts extracted -- dates, names, measurements'],
            ['⚠️', 'Inconsistencies flagged with exact page references'],
            ['❓', 'Suggested cross-examination questions'],
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
            ✅  Discovery Pro -- unlimited analyses included
          </Text>
        ) : (
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.pricingText, { color: colors.textPrimary }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>$19.99 per document</Text>
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Upgrade to Discovery Pro"
              onPress={() => (navigation as any).navigate('MoreTab', { screen: 'Subscription' })}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.proLink, { color: COLORS.steel }]}>
                Discovery Pro ($149.99/mo) -- unlimited →
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Analyze button */}
      <TouchableOpacity activeOpacity={0.6}
        style={[styles.analyzeBtn, {
          backgroundColor: file ? COLORS.navy : colors.border }, analyzing && { opacity: 0.6 }]}
        onPress={analyze}
        disabled={!file || analyzing}
        accessibilityLabel={`Analyze document -- ${hasPro ? 'included' : '$19.99'}`}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.analyzeBtnText}>
          {hasPro ? 'Analyze Document →' : 'Analyze -- $19.99 →'}
        </Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
        PDFs are not stored. Analyzed and discarded immediately. Attorney review required before use.
      </Text>
    </ScrollView>
  );

  // ── RENDER: Analyzing ─────────────────────────────────────────────────────
  if (phase === 'analyzing') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.analyzingWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.analyzingEmoji}>🔍</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingTitle, { color: colors.textPrimary }]}>
          Analyzing document…
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingFile, { color: colors.textMuted }]}
          numberOfLines={1}>{file?.name}</Text>

        <ProgressBar active={analyzing} />

        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingSteps, { color: colors.textMuted }]}>
          Reading full document · Extracting facts{'\n'}Checking for inconsistencies · Drafting questions
        </Text>

        <Text maxFontSizeMultiplier={1.4} style={[styles.analyzingTime, { color: colors.textMuted }]}>
          Usually 30-60 seconds for longer documents
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
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 40, marginBottom: 12 }}>📄</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>No analyses yet</Text>
            <TouchableOpacity
              style={[styles.analyzeBtn, { backgroundColor: COLORS.navy, width: '100%', marginTop: 16 }]}
              onPress={() => setPhase('upload')}
            accessibilityRole="button"
          >
              <Text maxFontSizeMultiplier={1.4} style={styles.analyzeBtnText}>← Upload a Document</Text>
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
                {analysis.page_count} pages
              </Text>
            ) : null}
            {analysis?.charged && (
              <Text maxFontSizeMultiplier={1.4} style={[styles.resultMetaText, { color: colors.textMuted }]}>
                · {analysis.charged}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={shareAnalysis}
          style={styles.shareBtn}
          accessibilityLabel="Share analysis"
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.shareBtnText, { color: COLORS.navy }]}>↑ Share</Text>
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.summaryLabel, { color: colors.textMuted }]}>SUMMARY</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.summaryText, { color: colors.textPrimary }]}>
          {analysis?.summary}
        </Text>
      </View>

      {/* Inconsistencies -- shown first, most critical */}
      {!!analysis?.inconsistencies?.length && (
        <Text maxFontSizeMultiplier={1.4} style={[styles.inconsistNote, { color: colors.textMuted }]}>
          Tap any flagged inconsistency to generate a Motion to Suppress pre-filled with that finding.
          Verify against the original document before filing.
        </Text>
      )}
      {!!analysis?.inconsistencies?.length && (
        <Section
          icon="⚠️"
          title="Inconsistencies & Red Flags"
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
        title="Key Facts"
        items={analysis?.key_facts || []}
        color={COLORS.legal}
        bg={isDark ? colors.legalBg : colors.legalBg}
        borderColor={colors.legal}
      />

      {/* Questions */}
      <Section
        icon="❓"
        title="Suggested Questions"
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
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:'#555', fontStyle:'italic', lineHeight:16 }}>
          ⚖️ AI document analysis is not legal advice. Analysis may miss key issues or
          misinterpret jurisdiction-specific rules. Have an attorney review all documents.
        </Text>
      </View>
      </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
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
