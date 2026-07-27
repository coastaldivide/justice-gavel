/**
 * BarPrepHomeScreen — Bar Exam MBE Supplement Home
 *
 * Criminal Law + Constitutional Law drilling for law students.
 * Gate: legal_radar+ subscription. Free users see 10-Q sample CTA.
 *
 * Layout:
 *   ┌─ Header: streak + pass probability ─────────────────────────┐
 *   │  Progress ring per subject                                   │
 *   │  Subject cards (Crim Law / Con Law)                         │
 *   │  Mode selector: Practice | Timed (100Q / 2.5hr MBE sim)    │
 *   │  Category filter chips                                       │
 *   │  [Start Session] CTA                                         │
 *   └─────────────────────────────────────────────────────────────┘
 */

import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { api }              from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useHaptics }       from '../hooks/useHaptics';
import { GradientHeader }   from '../components/GradientHeader';
// @ts-ignore
import { AuthGate }         from '../components/AuthGate';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Subject {
  id:            string;
  name:          string;
  mbe_weight:    number;
  question_count: number;
  progress?: {
    accuracy_pct:   number;
    answered_count: number;
    streak_days:    number;
    pass_probability: number;
  };
}

interface Dashboard {
  streak_days:       number;
  pass_probability:  number;
  peer_percentile:   number;
  questions_due:     number;
  total_answered:    number;
}

const CATEGORY_MAP: Record<string, string[]> = {
  'crim-law-001': [
    'homicide','theft_property','defenses','criminal_procedure','fifth_sixth_amendment'
  ],
  'con-law-001': [
    'fourth_amendment','due_process','equal_protection','first_amendment','incorporation_14th'
  ],
};

const CATEGORY_LABELS: Record<string, string> = {
  // Criminal Law
  homicide:             'Homicide',
  theft_property:       'Theft & Property',
  defenses:             'Defenses',
  criminal_procedure:   'Crim Procedure',
  // Constitutional Law
  fourth_amendment:     '4th Amendment',
  fifth_sixth_amendment:'5th & 6th Amendment',
  due_process:          'Due Process',
  equal_protection:     'Equal Protection',
  first_amendment:      '1st Amendment',
  incorporation_14th:   'Incorporation / 14th',
  commerce_clause:      'Commerce Clause',
  executive_power:      'Executive Power',
  takings_clause:       'Takings Clause',
  // Contracts
  formation:            'Contract Formation',
  consideration:        'Consideration',
  performance_breach:   'Performance & Breach',
  remedies:             'Remedies',
  contract_defenses:    'Contract Defenses',
  ucc_article_2:        'UCC Article 2',
  // Civil Procedure
  jurisdiction:         'Jurisdiction',
  pleading:             'Pleading',
  discovery_civ_pro:    'Discovery',
  summary_judgment:     'Summary Judgment',
  trial:                'Trial',
  preclusion:           'Preclusion',
  venue:                'Venue',
  class_actions:        'Class Actions',
  appeals:              'Appeals',
  // Evidence
  relevance:            'Relevance',
  character_evidence:   'Character Evidence',
  hearsay:              'Hearsay',
  hearsay_exceptions:   'Hearsay Exceptions',
  impeachment:          'Impeachment',
  privileges:           'Privileges',
  expert_witnesses:     'Expert Witnesses',
  authentication:       'Authentication',
  // Real Property
  ownership:            'Ownership',
  concurrent_ownership: 'Concurrent Ownership',
  landlord_tenant:      'Landlord-Tenant',
  recording_acts:       'Recording Acts',
  adverse_possession:   'Adverse Possession',
  easements:            'Easements',
  covenants:            'Covenants',
  mortgages:            'Mortgages',
  // Torts
  intentional_torts:    'Intentional Torts',
  negligence:           'Negligence',
  strict_liability:     'Strict Liability',
  products_liability:   'Products Liability',
  defamation:           'Defamation',
  nuisance:             'Nuisance',
  damages_torts:        'Damages',
};

// ── Screen ────────────────────────────────────────────────────────────────────
// @ts-ignore
export default function BarPrepHomeScreen({ navigation }: ScreenProps<'BarPrepHome'>) {
  const { colors }                      = useTheme();
  const { impact }                      = useHaptics();
  // @ts-ignore
  const { requireAuth, AuthGateModal }  = useAuthGate(navigation);
  // Bar prep disclaimer — shown once in the UI, not on every question
  const BAR_PREP_DISCLAIMER = 'MBE supplement for study only. Covers all 7 tested subjects. Not a substitute for full bar prep courses (Barbri, Themis, etc.).';
  const [subjects, setSubjects]         = useState<Subject[]>([]);
  const [dashboard, setDashboard]       = useState<Dashboard | null>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [mode, setMode]                 = useState<'practice' | 'timed'>('practice');
  const [questionCount, setQuestionCount] = useState(10);

  const load = useCallback(async () => {
    try {
      const [subRes, progRes] = await Promise.all([
        api.get('/bar-prep/subjects'),
        api.get('/bar-prep/progress'),
      ]);
      setSubjects(subRes.data.subjects || []);
      setDashboard(progRes.data);
      if (!selectedSubject && subRes.data.subjects?.length > 0) {
        setSelectedSubject(subRes.data.subjects[0].id);
      }
    } catch (e: any) {
      if (e?.response?.status !== 402) {
        Alert.alert('Error', 'Could not load bar prep data.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSubject]);

  useEffect(() => { load(); }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const startSession = useCallback(async () => {
    if (!selectedSubject) return;
    // @ts-ignore
    impact('medium');
    try {
      const res = await api.post('/bar-prep/sessions', {
        subject_id:     selectedSubject,
        category:       selectedCategory,
        mode,
        question_count: questionCount,
      });
      navigation.navigate('BarPrepQuiz', {
        session_id: res.data.session_id,
        questions:  res.data.questions,
        mode,
        time_limit_seconds: res.data.time_limit_seconds,
      });
    } catch (e: any) {
      if (e?.response?.status === 402) {
        navigation.navigate('Settings', { showUpgrade: true });
      } else {
        Alert.alert('Error', 'Could not start session. Try again.');
      }
    }
  }, [selectedSubject, selectedCategory, mode, questionCount, impact, navigation]);

  const styles = makeStyles(colors);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const categories = selectedSubject ? (CATEGORY_MAP[selectedSubject] || []) : [];

  return (
    <View style={styles.container}>
      <AuthGateModal />
        <GradientHeader
          title="Bar Exam Prep"
          subtitle="MBE Supplement — All 7 Tested Subjects"
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* ── Stats Banner ─────────────────────────────────────────── */}
          {dashboard && (
            <View style={styles.statsBanner}>
              <StatPill label="🔥 Streak" value={`${dashboard.streak_days}d`} />
              <StatPill label="📊 Pass Prob" value={`${dashboard.pass_probability}%`} accent />
              <StatPill label="👥 Top" value={`${dashboard.peer_percentile}%`} />
              <StatPill label="📬 Due" value={String(dashboard.questions_due)} />
            </View>
          )}

          {/* ── Subject Selector ──────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Subject</Text>
          <View style={styles.subjectRow}>
            {subjects.map(s => (
              <TouchableOpacity accessibilityRole="button"
                key={s.id}
                style={[
                  styles.subjectCard,
                  selectedSubject === s.id && styles.subjectCardActive,
                ]}
                onPress={() => {
                  // @ts-ignore
                  impact('light');
                  setSelectedSubject(s.id);
                  setSelectedCategory(null);
                }}
              >
                <Text style={[
                  styles.subjectName,
                  selectedSubject === s.id && styles.subjectNameActive,
                ]}>
                  {s.name}
                </Text>
                <Text style={styles.subjectMeta}>
                  {Math.round(s.mbe_weight * 100)}% MBE · {s.question_count}Q
                </Text>
                {s.progress && (
                  <View style={styles.progressBar}>
                    <View style={[
                      styles.progressFill,
                      { width: `${Math.min(100, s.progress.accuracy_pct)}%` as any },
                    ]} />
                  </View>
                )}
                {s.progress && (
                  <Text style={styles.accuracyText}>
                    {s.progress.accuracy_pct}% accuracy · {s.progress.answered_count} answered
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Category Chips ────────────────────────────────────────── */}
          {categories.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Category (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                <TouchableOpacity accessibilityRole="button"
                  style={[styles.chip, !selectedCategory && styles.chipActive]}
                  // @ts-ignore
                  onPress={() => { impact('light'); setSelectedCategory(null); }}
                >
                  <Text style={[styles.chipText, !selectedCategory && styles.chipTextActive]}>
                    All Topics
                  </Text>
                </TouchableOpacity>
                {categories.map(cat => (
                  <TouchableOpacity accessibilityRole="button"
                    key={cat}
                    style={[styles.chip, selectedCategory === cat && styles.chipActive]}
                    // @ts-ignore
                    onPress={() => { impact('light'); setSelectedCategory(cat); }}
                  >
                    <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
                      {CATEGORY_LABELS[cat] || cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* ── Mode Selector ─────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Mode</Text>
          <View style={styles.modeRow}>
            {(['practice', 'timed'] as const).map(m => (
              <TouchableOpacity accessibilityRole="button"
                key={m}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                onPress={() => {
                  // @ts-ignore
                  impact('light');
                  setMode(m);
                  setQuestionCount(m === 'timed' ? 100 : 10);
                }}
              >
                <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                  {m === 'practice' ? '✏️ Practice' : '⏱ Timed MBE Sim'}
                </Text>
                <Text style={styles.modeSubtext}>
                  {m === 'practice' ? 'Explanations shown after each Q' : '100Q · 2.5 hrs'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Question Count Picker (practice only) ─────────────────── */}
          {mode === 'practice' && (
            <>
              <Text style={styles.sectionLabel}>Questions per Session</Text>
              <View style={styles.countRow}>
                {[10, 25, 50].map(n => (
                  <TouchableOpacity accessibilityRole="button"
                    key={n}
                    style={[styles.countBtn, questionCount === n && styles.countBtnActive]}
                    // @ts-ignore
                    onPress={() => { impact('light'); setQuestionCount(n); }}
                  >
                    <Text style={[
                      styles.countBtnText,
                      questionCount === n && styles.countBtnTextActive,
                    ]}>
                      {n}Q
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ── Start Button ─────────────────────────────────────────── */}
          <TouchableOpacity accessibilityRole="button"
            style={[styles.startBtn, !selectedSubject && styles.startBtnDisabled]}
            onPress={startSession}
            disabled={!selectedSubject}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {mode === 'timed' ? '⚡ Start MBE Simulation' : `▶ Start ${questionCount} Questions`}
            </Text>
          </TouchableOpacity>

          {/* ── Footer Links ─────────────────────────────────────────── */}
          <View style={styles.footerLinks}>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('BarPrepProgress')}>
              <Text style={styles.footerLink}>📈 Progress Dashboard</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('BarPrepSchedule')}>
              <Text style={styles.footerLink}>📅 Study Schedule</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
    </View>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[pillStyles.pill, accent && pillStyles.accent]}>
      <Text style={pillStyles.label}>{label}</Text>
      <Text style={[pillStyles.value, accent && pillStyles.accentText]}>{value}</Text>

        {/* Bar prep disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: '#888', textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          For supplemental study only. Not endorsed by any state bar or the NCBE.
        </Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill:       { alignItems: 'center', minWidth: 64, padding: 8 },
  accent:     { backgroundColor: COLORS.primary + '18', borderRadius: 10 },
  label:      { fontSize: 10, color: COLORS.textMuted, marginBottom: 2 },
  // @ts-ignore
  value:      { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text },
  accentText: { color: COLORS.primary },
});

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.background },
    center:        { justifyContent: 'center', alignItems: 'center' },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    statsBanner:   {
      flexDirection: 'row', justifyContent: 'space-around',
      paddingVertical: 12, paddingHorizontal: 16,
      backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    sectionLabel:  {
      // @ts-ignore
      fontSize: 12, fontFamily: FONTS.semibold, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: 20, marginBottom: 10, marginHorizontal: 16,
    },
    subjectRow:     { flexDirection: 'row', paddingHorizontal: 12, gap: 10 },
    subjectCard:    {
      flex: 1, padding: 14, borderRadius: RADIUS.lg,
      backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
      ...SHADOW.sm,
    },
    subjectCardActive: { borderColor: colors.primary },
    // @ts-ignore
    subjectName:       { fontSize: 14, fontFamily: FONTS.semibold, color: colors.text },
    subjectNameActive: { color: colors.primary },
    subjectMeta:       { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    progressBar:       {
      height: 4, backgroundColor: colors.border, borderRadius: 2,
      marginTop: 10, overflow: 'hidden',
    },
    progressFill:      { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
    accuracyText:      { fontSize: 11, color: colors.textMuted, marginTop: 4 },
    chipRow:           { paddingHorizontal: 12, marginBottom: 4 },
    chip:              {
      paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
      borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive:        { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
    chipText:          { fontSize: 13, color: colors.textMuted },
    // @ts-ignore
    chipTextActive:    { color: colors.primary, fontFamily: FONTS.semibold },
    modeRow:           { flexDirection: 'row', paddingHorizontal: 12, gap: 10 },
    modeBtn:           {
      flex: 1, padding: 14, borderRadius: RADIUS.lg,
      borderWidth: 2, borderColor: colors.border,
      backgroundColor: colors.card,
    },
    modeBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
    // @ts-ignore
    modeBtnText:       { fontSize: 14, fontFamily: FONTS.semibold, color: colors.text },
    modeBtnTextActive: { color: colors.primary },
    modeSubtext:       { fontSize: 11, color: colors.textMuted, marginTop: 4 },
    countRow:          { flexDirection: 'row', paddingHorizontal: 12, gap: 10 },
    countBtn:          {
      flex: 1, paddingVertical: 12, borderRadius: RADIUS.md,
      alignItems: 'center', borderWidth: 2, borderColor: colors.border,
      backgroundColor: colors.card,
    },
    countBtnActive:    { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
    // @ts-ignore
    countBtnText:      { fontSize: 15, fontFamily: FONTS.semibold, color: colors.textMuted },
    countBtnTextActive: { color: colors.primary },
    startBtn:          {
      marginHorizontal: 16, marginTop: 24, paddingVertical: 16,
      borderRadius: RADIUS.lg, backgroundColor: colors.primary,
      alignItems: 'center', ...SHADOW.md,
    },
    startBtnDisabled:  { opacity: 0.4 },
    // @ts-ignore
    startBtnText:      { fontSize: 16, fontFamily: FONTS.bold, color: '#fff' },
    footerLinks:       {
      flexDirection: 'row', justifyContent: 'center', gap: 24,
      marginTop: 20, paddingBottom: 10,
    },
    // @ts-ignore
    footerLink:        { fontSize: 13, color: colors.primary, fontFamily: FONTS.medium },
  });
}