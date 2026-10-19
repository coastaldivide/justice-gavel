import { apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { getItem as getSecureItem } from '../utils/secureStorage';
import { AppIcon } from '../components/AppIcon';
/**
 * AttorneyDashboardScreen -- Practice Management Hub
 *
 * Four-tab layout:
 *   1. My Cases      -- assigned caseload with client names + court dates
 *   2. Templates     -- shared motion library for the office
 *   3. CLE           -- continuing legal education courses + credit tracker
 *   4. Profile       -- attorney profile, bar number, office, stats
 *
 * Entry points:
 *   - HomeScreen attorney tile
 *   - SubscriptionScreen CTA after subscribing to attorney plan
 *   - SettingsScreen My Tools
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, LayoutAnimation, InteractionManager } from 'react-native';
import { api }      from '../services/api';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

import { ScreenCapture } from '../utils/webCompat';
import { daysUntil } from '../utils/dateUtils';
import { useFocusEffect } from '@react-navigation/native';
import { t, useLang, perLang } from '../i18n';

type Tab = 'cases' | 'templates' | 'cle' | 'profile';

// ── Helpers ───────────────────────────────────────────────────────────────────
const urgencyColor = (days: number | null) => {
  if (days === null) return COLORS.textMuted;
  if (days <= 7)  return COLORS.emergency;
  if (days <= 30) return COLORS.warn;
  return COLORS.legal;
};

// ── CLE difficulty badge ──────────────────────────────────────────────────────
const DiffBadge = ({ diff }: { diff: string }) => {
  useLang();
  const map: Record<string, { bg: string; color: string }> = {
    beginner:     { bg: COLORS.legalBg, color: COLORS.legal },
    intermediate: { bg: COLORS.bgElevated, color: COLORS.steel },
    advanced:     { bg: COLORS.emergencyBg, color: COLORS.emergency },
  };
  const s = map[diff] || map.intermediate;
  return (
    <View style={[styles.diffBadge, { backgroundColor: s.bg }]}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.diffBadgeText, { color: s.color }]}>{diff}</Text>
    </View>


  );
};

// ══════════════════════════════════════════════════════════════════════════════

// ── Availability grid component ───────────────────────────────────────────────
const DAYS  = ['mon','tue','wed','thu','fri','sat','sun'] as const;
const SLOTS = ['morning','afternoon','evening'] as const;
const DAY_LABELS = perLang((): Record<string, string> => ({ mon:t('x_attorney_dashboard_mon'),tue:t('x_attorney_dashboard_tue'),wed:t('x_attorney_dashboard_wed'),thu:t('x_attorney_dashboard_thu'),fri:t('x_attorney_dashboard_fri'),sat:t('x_attorney_dashboard_sat'),sun:t('x_attorney_dashboard_sun') }));
const SLOT_LABELS = perLang((): Record<string, string> => ({ morning:'AM',afternoon:'PM',evening:t('x_attorney_dashboard_eve') }));

function AvailabilityGrid() {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [schedule, setSchedule] = React.useState<Record<string, string[]>>({});
  const [note, setNote]         = React.useState('');
  const [saving, setSaving]     = React.useState(false);
  const [saved, setSaved]       = React.useState(false);

  React.useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    api.get('/attorney/profile/availability')
      .then(r => { setSchedule(r.data?.schedule || {}); setNote(r.data?.note || ''); })
      .catch(() => {});
    });
    return () => _task.cancel();
  }, []);

  const toggle = (day: string, slot: string) => {
    setSchedule(prev => {
      const slots = prev[day] || [];
      const next  = slots.includes(slot) ? slots.filter(s => s !== slot) : [...slots, slot];
      return { ...prev, [day]: next };
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/attorney/profile/availability', { schedule, note });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_save_availability')), 'error');
    }
    finally { setSaving(false); }
  };

  return (
    <View style={{ marginTop: 20 }}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22,
        fontWeight: '700', color: colors.textPrimary, marginBottom: 12 }}>
        {t('x_attorney_dashboard_weekly_availability')}
      </Text>
      {/* Grid */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {/* Slot labels */}
        <View style={{ width: 36, paddingTop: 24 }}>
          {SLOTS.map(s => (
            <Text key={s} maxFontSizeMultiplier={1.4} style={{ fontSize: 10, lineHeight: 22,
              color: colors.textMuted, height: 30, textAlignVertical: 'center' }}>
              {SLOT_LABELS()[s]}
            </Text>
          ))}
        </View>
        {/* Days */}
        {DAYS.map(day => (
          <View key={day} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 10, lineHeight: 14,
              color: colors.textMuted, fontWeight: '700', marginBottom: 4 }}>
              {DAY_LABELS()[day]}
            </Text>
            {SLOTS.map(slot => {
              const active = (schedule[day] || []).includes(slot);
              return (
                <TouchableOpacity
                accessibilityRole="button"

                key={slot}
                  style={{ width: '100%', height: 28, borderRadius: 4,
                    backgroundColor: active ? colors.navy : colors.bgSubtle,
                    borderWidth: 1, borderColor: active ? colors.navy : colors.border }}
                  onPress={() => toggle(day, slot)}
                  hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${DAY_LABELS()[day]} ${SLOT_LABELS()[slot]}`}
                />
              );
            })}
          </View>
        ))}
      </View>
      {/* Note */}
      <TextInput
        style={{ marginTop: 12, borderWidth: 1, borderColor: colors.inputBorder,
          borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 19,
          color: colors.inputText, backgroundColor: colors.inputBg }}
        placeholder={t('x_attorney_dashboard_availability_note_e_g')}
        placeholderTextColor={colors.placeholder}
        value={note}
        onChangeText={(tItem) => { setNote(tItem); setSaved(false); }}

        maxLength={200}
        returnKeyType="done"
        blurOnSubmit
        accessibilityLabel={t('x_attorney_dashboard_availability_note')}
      />
      <TouchableOpacity
  accessibilityRole="button"
        style={{ marginTop: 10, backgroundColor: saving ? colors.bgSubtle : colors.navy,
          borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
        onPress={save} disabled={saving}
      
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: saving ? colors.textMuted : colors.textOnNavy,
          fontWeight: '700', fontSize: 13, lineHeight: 19 }}>
          {saved ? t('x_attorney_dashboard_saved') : saving ? t('x_attorney_dashboard_saving') : t('x_attorney_dashboard_save_availability')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AttorneyDashboardScreen({ navigation }: ScreenProps): React.JSX.Element | null {
  useLang();
  const { showToast } = useToast();

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const { colors } = useTheme();
  // Themed styles (shadows the static module-level fallback used by helpers)
  const styles = makeStyles(colors);

  // ── Role gate -- only attorneys and defenders can access this screen ──────────
  // Any authenticated user can navigate here via deep link or direct navigation.
  // This check prevents consumer users from seeing attorney-only features.
  const [roleChecked, setRoleChecked] = React.useState(false);
  const [isAuthorized, setIsAuthorized] = React.useState(false);
  React.useEffect(() => {
    const leave = () => {
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('HomeTab');
    };
    getSecureItem('user').then(raw => {
      if (raw) {
        const u = (() => { try { return JSON.parse(raw); } catch { return null; } })();
        const allowed = ['attorney','defender','admin'].includes(u?.role);
        setIsAuthorized(allowed);
        if (!allowed) {
          // Redirect immediately -- consumer users should not see this screen
          leave();
        }
      } else {
        leave();
      }
      setRoleChecked(true);
    }).catch(() => { leave(); });
  }, [navigation]);


  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [tab, setTab]               = useState<Tab>('cases');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading]       = useState(true);

  // Cases
  const [cases,    setCases]    = useState<any[]>([]);
  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplFilter, setTplFilter] = useState<'approved'|'pending'|'all'>('approved');
  // CLE
  const [courses,   setCourses]   = useState<any[]>([]);
  const [cleTotal,  setCleTotal]  = useState(0);
  const [completing, setCompleting] = useState<number | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<number | null>(null);
  // Profile
  const [profile,  setProfile]   = useState<any>(null);
  const [motionViewMode, setMotionViewMode] = React.useState<'cards'|'table'>('cards');
  const [barInput, setBarInput]  = useState('');
  const [officeInput, setOfficeInput] = useState('');
  const [officeNameInput, setOfficeNameInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [sortBy, setSortBy] = React.useState<'date'|'name'|'status'>('date');

  const loadAll = useCallback(async () => {
    try {
      const [casesRes, templatesRes, cleRes, profileRes] = await Promise.allSettled([
        api.get('/attorney/cases'),
        api.get('/attorney/templates?status=approved'),
        api.get('/attorney/cle'),
        api.get('/attorney/profile'),
      ]);
      if (casesRes.status    === 'fulfilled') setCases(casesRes.value.data?.cases || []);
      if (templatesRes.status=== 'fulfilled') setTemplates(templatesRes.value.data?.templates || []);
      if (cleRes.status      === 'fulfilled') {
        setCourses(cleRes.value.data?.courses || []);
        setCleTotal(cleRes.value.data?.total_earned || 0);
      }
      if (profileRes.status  === 'fulfilled') {
        setProfile(profileRes.value.data);
        setBarInput(profileRes.value.data?.bar_number || '');
        setOfficeInput(profileRes.value.data?.office_id || '');
      }
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Loads on first focus and reloads when returning from CaseScreen, BookingScreen, etc.
  // (a separate mount effect would fetch everything twice on open).
  useFocusEffect(React.useCallback(() => { loadAll(); }, [loadAll]));

  const onRefresh = useCallback(() => { setRefreshing(true); loadAll(); }, [loadAll]);

  const completeCLE = async (courseId: number) => {
    setCompleting(courseId);
    try {
      const res = await api.post(`/attorney/cle/${courseId}/complete`, {});
      const msg = res.data?.already_completed
        ? t('x_attorney_dashboard_already_completed_credit_transcript')
        : `✓ ${res.data?.message}`;
      showToast(msg, 'info');
      loadAll();
    } catch (e: any) { showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_complete_course')), 'info'); }
    setCompleting(null);
  };

  const saveProfile = async () => {
      if (!barInput?.trim()) { showToast(t('x_attorney_dashboard_please_enter_state_bar')); return; }
      setSavingProfile(true);
    try {
      await api.patch('/attorney/profile', { bar_number: barInput, is_defender: 1 });
      if (officeInput && officeNameInput) {
        await api.post('/attorney/office/join', {
          office_id: officeInput.trim().toLowerCase().replace(/\s+/g,'_'),
          office_name: officeNameInput.trim(),
        });
      }
      showToast(t('x_attorney_dashboard_profile_updated'));
      loadAll();
    } catch (e: any) { showToast(apiErrorMessage(e, t('x_attorney_dashboard_could_not_save')), 'info'); }
    setSavingProfile(false);
  };

  const barRenewalReminder = React.useMemo(() => {
    const verifiedAt = profile?.bar_verified_at || profile?.bar_verified_date;
    if (!verifiedAt) return null;
    const verifiedDate = new Date(verifiedAt);
    const now = new Date();
    const monthsSince = (now.getFullYear() - verifiedDate.getFullYear()) * 12
      + (now.getMonth() - verifiedDate.getMonth());
    if (monthsSince >= 10) {
      return {
        months: monthsSince,
        urgent: monthsSince >= 12,
        message: monthsSince >= 12
          ? t('x_attorney_dashboard_bar_verification_over_1')
          : t('x_attorney_dashboard_bar_verification_months_old', { monthsSince }),
      };
    }
    return null;
  }, [profile]);

  // Role gate: render nothing until the role check passes (redirects otherwise)
  if (!roleChecked || !isAuthorized) return null;

  if (loading) return (
    <View style={[styles.screen, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.steel} />
    </View>
  );

  // Bar license renewal reminder
  // Most state bars renew annually or biennially. Remind after 10 months.
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="attorney-dashboard-screen">
      {/* ── Dashboard greeting header ──────────────────────────────────── */}
      <View style={{ paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 36,
        paddingBottom: 12, backgroundColor: colors.bg,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 20, fontWeight: '800',
              color: colors.textPrimary, letterSpacing: -0.3 }}>{t('x_attorney_dashboard_dashboard')}</Text>
            {cases.length > 0 && (
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {t('x_attorney_dashboard_active', { length: cases.length, value: cases.length === 1 ? 'case' : 'cases', value2: (cases ?? []).filter((c: any) => c.escalation?.level === 'critical').length > 0
                  ? ' ' + t('x_attorney_dashboard_critical', { length: (cases ?? []).filter((c: any) => c.escalation?.level === 'critical').length })
                  : '' })}
              </Text>
            )}
          </View>
          <TouchableOpacity
  accessibilityRole="button"
            onPress={() => navigation.navigate('MoreTab', { screen: 'MatterIntelligence' })}
            accessibilityLabel={t('x_attorney_dashboard_open_matter_intelligence')}
            style={{ backgroundColor: colors.navy, paddingHorizontal: 12,
              paddingVertical: 7, borderRadius: 8 }}>
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '700',
              color: colors.textOnNavy, letterSpacing: 0.3 }}>{t('x_attorney_dashboard_intelligence')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
        {([
          { key:'cases',     label:t('nav_cases'),     badge: cases.length },
          { key:'templates', label:t('atty_tab_templates'), badge: null },
          { key:'cle',       label:'CLE',       badge: null },
          { key:'profile',   label:t('atty_tab_profile'),   badge: null },
        ] as { key: Tab; label: string; badge: number | null }[]).map(tItem => (
          <TouchableOpacity
            accessibilityRole="tab"
            key={tItem.key}
            style={[styles.tabBtn, tab===tItem.key && { borderBottomColor: colors.steel, borderBottomWidth: 2 }]}
            onPress={() => setTab(tItem.key)}
            accessibilityState={{ selected: tab === tItem.key }}
            accessibilityLabel={tItem.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.tabLabel, { color: tab===tItem.key ? colors.textPrimary : colors.textMuted }]}>
              {tItem.label}
              {tItem.badge !== null && tItem.badge > 0 ? ` (${tItem.badge})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex:1 }}>
      <ScrollView keyboardShouldPersistTaps='handled'
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.steel} />}
      >

      {/* Attorney-client privilege notice */}
      <View style={{ backgroundColor: COLORS.navyLight, borderRadius: 8, padding: 10, margin: 12, marginBottom: 0 }}>
        <Text style={{ fontSize: 11, color: colors.textOnNavy, lineHeight: 15 }}>
          {t('x_attorney_dashboard_all_matter_data_handled')}
        </Text>
      </View>
        {/* ── MY CASES ─────────────────────────────────────────────────── */}
        {tab === 'cases' && (
          <>
            {cases.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📁</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('x_attorney_dashboard_no_assigned_cases')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>
                  {t('x_attorney_dashboard_cases_assigned_when_client')}
                </Text>
              </View>
            ) : (
              <></>
            )}

            {/* Sort controls */}
            {cases.length > 1 && (
              <View style={{ flexDirection:'row', gap:6, marginBottom:10 }}>
                {(['date','name','status'] as const).map(opt => (
                  <TouchableOpacity
                    key={opt}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sortBy === opt }}
                    accessibilityLabel={t('x_attorney_dashboard_sort_cases_by', { opt })}
                    onPress={() => setSortBy(opt)}
                    style={{ paddingHorizontal:12, paddingVertical:5, borderRadius:16,
                      borderWidth:1, borderColor:sortBy===opt?colors.navy:colors.border,
                      backgroundColor:sortBy===opt?colors.navy:colors.bgCard }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, fontWeight:'600',
                      color:sortBy===opt?colors.bgCard:colors.textMuted }}>
                      {opt==='date'?t('x_attorney_dashboard_soonest'):opt==='name'?t('x_attorney_dashboard_name'):t('x_attorney_dashboard_status')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {[...cases].sort((a,b)=>{ if(sortBy==='name') return (a.title||'').localeCompare(b.title||''); if(sortBy==='status') return (a.status||'').localeCompare(b.status||''); const da=a.next_court_date?new Date(a.next_court_date).getTime():Infinity; const db2=b.next_court_date?new Date(b.next_court_date).getTime():Infinity; return da-db2; }).map((cas) => {
              const days = daysUntil(cas.next_court_date);
              return (
                <TouchableOpacity accessibilityRole="button"
                  key={cas.id}
                  style={[styles.caseCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                  onPress={() => navigation.navigate('Cases')}
                  accessibilityLabel={t('x_attorney_dashboard_open_case', { title: cas.title })}
                >
                  <View style={styles.caseHeader}>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                        {cas.title || t('x_attorney_dashboard_case', { id: cas.id })}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseMeta, { color: colors.textMuted }]}>
                        {cas.client_name || t('x_attorney_dashboard_client')} · {cas.status || t('case_status_active')}
                      </Text>
                    </View>
                    {cas.next_court_date && (
                      <View style={[styles.courtDateBadge, { backgroundColor: days !== null && days <= 7 ? colors.emergencyBg : colors.bgElevated }]}>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.courtDateDays, { color: urgencyColor(days) }]}>
                          {days !== null ? t('x_attorney_dashboard_days_short', { days }) : '--'}
                        </Text>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.courtDateLabel, { color: colors.textMuted }]}>{t('x_attorney_dashboard_court')}</Text>
                      </View>
                    )}
                  </View>
                  {cas.assignment_notes ? (
                    <Text maxFontSizeMultiplier={1.4} style={[styles.caseNote, { color: colors.textSecond }]} numberOfLines={1}>
                      {t('x_attorney_dashboard_note', { assignment_notes: cas.assignment_notes })}
                    </Text>
                  ) : null}
                  <View style={styles.caseActions}>
                    <TouchableOpacity accessibilityRole="button"
                      style={[styles.caseActionBtn, { borderColor: colors.border }]}
                      onPress={() => navigation.navigate('Messages', { caseId: cas.id, caseTitle: cas.title })}
                      accessibilityLabel={t('x_attorney_dashboard_message_client')}
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseActionText, { color: colors.info }]}>{t('x_attorney_dashboard_message')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button"
                      style={[styles.caseActionBtn, { borderColor: colors.border }]}
                      onPress={() => navigation.navigate('MotionLibrary', { caseId: cas.id })}
                      accessibilityLabel={t('x_attorney_dashboard_draft_motion_this_case')}
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseActionText, { color: colors.info }]}>{t('x_attorney_dashboard_motion')}</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── TEMPLATES ────────────────────────────────────────────────── */}
        {tab === 'templates' && (
          <>

            {/* Cards / Table view toggle */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600',
                color: colors.textMuted, marginRight: 4 }}>{t('x_attorney_dashboard_view')}</Text>
              {(['cards','table'] as const).map(mode => (
                <TouchableOpacity accessibilityRole="button" key={mode}
                  onPress={() => setMotionViewMode(mode)}
                  style={{ paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
                    borderWidth: 1,
                    borderColor: motionViewMode === mode ? colors.blue : colors.border,
                    backgroundColor: motionViewMode === mode ? colors.infoBg : colors.bgCard }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600',
                    color: motionViewMode === mode ? colors.blue : colors.textMuted }}>
                    {mode === 'cards' ? t('x_attorney_dashboard_cards') : t('x_attorney_dashboard_table')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.filterRow}>
              {(['approved','pending','all'] as const).map(f => (
                <TouchableOpacity accessibilityRole="button"
                  key={f}
                  style={[styles.filterChip,
                    { backgroundColor: tplFilter===f ? colors.steel : colors.bgCard,
                      borderColor: tplFilter===f ? colors.steel : colors.border }]}
                  onPress={() => setTplFilter(f)}
                  accessibilityLabel={f}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.filterChipText, { color: tplFilter===f ? colors.bg : colors.textMuted }]}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {templates.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('x_attorney_dashboard_no_templates_yet')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>
                  {t('x_attorney_dashboard_generate_motion_motion_library')}
                </Text>
                <TouchableOpacity accessibilityRole="button"
                  style={[styles.emptyBtn, { backgroundColor: colors.steel }]}
                  onPress={() => navigation.navigate('MotionLibrary')}
                  accessibilityLabel={t('x_attorney_dashboard_go_motion_library')}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>{t('x_attorney_dashboard_open_motion_library')}</Text>
                </TouchableOpacity>
              </View>
            ) : templates.map((tpl) => (
              <View key={tpl.id} style={[styles.tplCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <View style={styles.tplHeader}>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} numberOfLines={2} ellipsizeMode="tail" style={[styles.tplTitle, { color: colors.textPrimary }]}>{tpl.title}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.tplMeta, { color: colors.textMuted }]}>
                      {tpl.motion_type} · {tpl.created_by_name || t('x_attorney_dashboard_unknown')}
                      {tpl.approved_by_name ? ` · ✓ ${tpl.approved_by_name}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, {
                    backgroundColor: tpl.status==='approved' ? colors.legalBg : tpl.status==='pending' ? colors.bgElevated : colors.emergencyBg,
                  }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.statusPillText, {
                      color: tpl.status==='approved' ? colors.legal : tpl.status==='pending' ? colors.steel : colors.emergency,
                    }]}>
                      {tpl.status}
                    </Text>
                  </View>
                </View>
                {tpl.notes ? <Text maxFontSizeMultiplier={1.4} style={[styles.tplNote, { color: colors.textSecond }]} numberOfLines={2} ellipsizeMode="tail">{tpl.notes}</Text> : null}
              </View>
            ))}
          </>
        )}

        {/* ── CLE ──────────────────────────────────────────────────────── */}
        {tab === 'cle' && (
          <>
            <View style={[styles.cleHeader, { backgroundColor: colors.bgElevated, borderColor: colors.steel }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.cleHours, { color: colors.info }]}>{cleTotal.toFixed(1)}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.cleHoursLabel, { color: colors.textMuted }]}>{t('x_attorney_dashboard_cle_hours_earned_justice')}</Text>
            </View>

            {courses.map((course) => {
              const done      = !!course.completed_at;
              const expanded  = expandedCourse === course.id;

              return (
                <View key={course.id} style={[styles.cleCard, { backgroundColor: colors.bgCard, borderColor: done ? colors.legalDark : colors.border }]}>
                  <TouchableOpacity
  accessibilityRole="button"
                    style={styles.cleCardHeader}
                    onPress={() => setExpandedCourse(expanded ? null : course.id)}
                    activeOpacity={0.8}
                    accessibilityLabel={course.title}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.cleTitleRow}>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.cleTitle, { color: done ? colors.legal : colors.textPrimary }]}>
                          {done ? '✓ ' : ''}{course.title}
                        </Text>
                      </View>
                      <View style={styles.cleMeta}>
                        <DiffBadge diff={course.difficulty} />
                        <Text maxFontSizeMultiplier={1.4} style={[styles.cleMetaText, { color: colors.textMuted }]}>
                          {course.credit_hours}h · {course.category.replace('_',' ')}
                        </Text>
                      </View>
                    </View>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.chevron, { color: colors.textMuted }]}>{expanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {expanded && (
                    <View style={styles.cleBody}>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.cleDesc, { color: colors.textSecond }]}>{course.description}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.cleContent, { color: colors.textSecond }]}>{course.content}</Text>
                      {!done ? (
                        <TouchableOpacity
  accessibilityRole="button"
                          style={[styles.completeBtn, { backgroundColor: colors.steel },
                            completing === course.id && { opacity: 0.6 }]}
                          onPress={() => completeCLE(course.id)}
                          disabled={completing === course.id}
                          accessibilityLabel={t('x_attorney_dashboard_mark_complete', { title: course.title })}
                        >
                          {completing === course.id
                            ? <ActivityIndicator color={colors.bg} size="small" />
                            : <Text maxFontSizeMultiplier={1.4} style={styles.completeBtnText}>
                                {t('x_attorney_dashboard_mark_complete_earn_h', { credit_hours: course.credit_hours })}
                              </Text>
                          }
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.completedBanner, { backgroundColor: colors.legalBg, borderColor: colors.legalDark }]}>
                          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.legal, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>
                            {t('x_attorney_dashboard_completed_h_earned', { credit_hours: course.credit_hours })}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            <TouchableOpacity
  accessibilityRole="button"
              style={[styles.transcriptBtn, { borderColor: colors.steel }]}
              onPress={() => showToast(t('x_attorney_dashboard_cle_hours_earned_justice_2', { cleTotal: cleTotal.toFixed(1) }), 'info')}
              accessibilityLabel={t('x_attorney_dashboard_view_cle_transcript')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.transcriptBtnText, { color: colors.info }]}>{t('atty_transcript')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── PROFILE ──────────────────────────────────────────────────── */}
        {tab === 'profile' && !profile && !loading && (
          <View style={[styles.emptyCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <AppIcon name="person-outline" size={20} color={COLORS.navy} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('x_attorney_dashboard_profile_not_loaded')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>{t('x_attorney_dashboard_pull_refresh_check_connection')}</Text>
          </View>
        )}
        {tab === 'profile' && profile && (
          <>
            {barRenewalReminder && (
              <View testID="bar-renewal-reminder" style={{ borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 12,
                borderColor: barRenewalReminder.urgent ? colors.emergency : colors.warn, backgroundColor: colors.bgCard }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 17,
                  color: barRenewalReminder.urgent ? colors.emergency : colors.textSecond }}>
                  {barRenewalReminder.urgent ? '⚠️ ' : '🗓 '}{barRenewalReminder.message}
                </Text>
              </View>
            )}
            {/* Bar Verification Status */}
            <View style={[styles.barStatusCard, {
              backgroundColor: profile.bar_verified ? COLORS.legal : COLORS.steelMid,
              borderColor: profile.bar_verified ? COLORS.legal : COLORS.warn,
            }]}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.barStatusTitle, {
                  color: profile.bar_verified ? COLORS.legal : COLORS.steelMid
                }]}>
                  {profile.bar_verified ? t('x_attorney_dashboard_bar_verified_jtb_badge') : t('x_attorney_dashboard_bar_verification_pending')}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.barStatusSub}>
                  {profile.bar_verified
                    ? (t('x_attorney_dashboard_bar_plan', { value: (profile.bar_number || t('x_attorney_dashboard_file')), value2: (profile.subscription_tier || t('x_attorney_dashboard_attorney')) }))
                    : profile.bar_number
                      ? (t('x_attorney_dashboard_bar_submitted_review_within', { bar_number: profile.bar_number }))
                      : t('x_attorney_dashboard_submit_bar_number_field')}
                </Text>
              </View>
              {!profile.bar_verified && (
                <TouchableOpacity
  accessibilityRole="button"
                  style={styles.barStatusAction}
                  onPress={() => setTab('profile')}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.barStatusActionText}>
                    {profile.bar_number ? t('x_attorney_dashboard_view_status') : t('x_attorney_dashboard_verify_now')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Profile completion indicator */}
            {(() => {
              const fields = [
                profile.bar_number, profile.bar_verified,
                profile.bio, profile.specialties?.length,
                profile.phone, profile.office_name || profile.office_id,
              ];
              const done = fields.filter(Boolean).length;
              const pct  = fields.length ? Math.round((done / fields.length) * 100) : 0;
              return pct < 100 ? (
                <View style={[styles.completionCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.completionLabel, { color: colors.textPrimary }]}>
                      {t('x_attorney_dashboard_profile_complete', { pct })}
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.completionLabel, { color: colors.textMuted }]}>
                      {t('x_attorney_dashboard_fields', { done, length: fields.length })}
                    </Text>
                  </View>
                  <View style={[styles.completionBar, { backgroundColor: colors.border }]}>
                    <View style={[styles.completionFill, { width: (pct + '%') as any,
                      backgroundColor: pct >= 80 ? colors.legalDark : pct >= 50 ? colors.warnDark : colors.emergencyDark
                    }]} />
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.completionHint, { color: colors.textMuted }]}>
                    {!profile.bar_verified && t('x_attorney_dashboard_verify_bar_number_jtb')}
                    {!profile.bio && t('x_attorney_dashboard_add_bio_so_clients')}
                    {!profile.office_name && !profile.office_id && t('x_attorney_dashboard_add_office_name_appear')}
                  </Text>
                </View>
              ) : null;
            })()}

            {/* Stats */}
            <View style={[styles.statsGrid, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              {[
                { label: t('x_attorney_dashboard_active_cases'),  value: String(profile.stats?.active_cases      || 0), color: colors.blue },
                { label: t('x_attorney_dashboard_this_week'),     value: String(profile.stats?.hearings_this_week || 0), color: colors.warn },
                { label: t('x_attorney_dashboard_motions_filed'), value: String(profile.stats?.motions_generated  || 0), color: colors.legal },
                { label: t('x_attorney_dashboard_avg_rating'),    value: profile.stats?.avg_rating ? profile.stats.avg_rating.toFixed(1) + '★' : 'N/A', color: colors.gold },
                { label: t('x_attorney_dashboard_unread_msgs'),   value: String(profile.stats?.unread_messages    || 0), color: colors.emergency },
                { label: t('x_attorney_dashboard_response_rate'), value: profile.stats?.response_rate ? profile.stats.response_rate + '%' : 'N/A', color: colors.steel },
                { label: t('x_attorney_dashboard_cle_hours'), value: (profile.stats?.cle_hours_earned || 0).toFixed(1) + 'h', color: colors.legal },
              ].map((s,i,arr) => (
                <View key={s.label} style={[styles.statCell,
                  i < arr.length-1 && { borderRightWidth:1, borderRightColor: colors.border }]}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.statValue, { color: colors.info }]}>{s.value}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.statLabel, { color: colors.textMuted }]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Gavel level */}
            {profile.gavel_level > 0 && (
              <View style={[styles.gavelBadge, { backgroundColor: colors.warnBg, borderColor: colors.gold }]}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.goldText, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>
                  {t('x_attorney_dashboard_gavel_holder', { value: ['', t('x_attorney_dashboard_gavel_bronze'), t('x_attorney_dashboard_gavel_silver'), t('x_attorney_dashboard_gavel_golden')][profile.gavel_level] || '' })}
                </Text>
              </View>
            )}

            {/* Edit fields */}
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('x_attorney_dashboard_bar_number')}</Text>
            <TextInput
                  maxLength={15}
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={barInput}
              onChangeText={setBarInput}
              placeholder={t('x_attorney_dashboard_state_bar_number')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('x_attorney_dashboard_state_bar_number')}
          returnKeyType="next"
          blurOnSubmit
        keyboardType="numeric"
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('x_attorney_dashboard_office_id_e_g')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={officeInput}
              onChangeText={setOfficeInput}
              placeholder="office_id"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              accessibilityLabel={t('atty_office_id')}
          returnKeyType="next"
          blurOnSubmit
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('x_attorney_dashboard_office_name')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={officeNameInput}
              onChangeText={setOfficeNameInput}
              placeholder={t('x_attorney_dashboard_davidson_county_public_defender')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('x_attorney_dashboard_office_name_2')}
          returnKeyType="next"
          blurOnSubmit
        keyboardType="numeric"
        />

            <TouchableOpacity
  accessibilityRole="button"
              style={[styles.saveBtn, { backgroundColor: colors.steel }, savingProfile && { opacity: 0.6 }]}
              onPress={saveProfile}
              disabled={savingProfile}
              accessibilityLabel={t('x_attorney_dashboard_save_profile')}
          accessibilityHint={t('cp_double_tap')}
            >
              {savingProfile
                ? <ActivityIndicator color={colors.bg} />
                : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>{t('atty_save_profile')}</Text>
              }
            </TouchableOpacity>

            <AvailabilityGrid />

            <TouchableOpacity accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.legalDark }]}
              onPress={async () => {
                if (!barInput.trim()) {
                  showToast(t('x_attorney_dashboard_enter_bar_number_field'), 'error');
                  return;
                }
                try {
                  await api.post('/attorney/verify-bar', { bar_number: barInput, state: officeInput.slice(0,2) || 'TN' });
                  showToast(t('x_attorney_dashboard_bar_number_has_been'));
                } catch (e: any) {
                  showToast(apiErrorMessage(e, t('x_attorney_dashboard_try_again')), 'info');
                }
              }}
              accessibilityLabel={t('x_attorney_dashboard_submit_bar_number_verification')}
          accessibilityHint={t('cp_double_tap')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.legal }]}>{t('x_attorney_dashboard_submit_bar_number_verification_2')}</Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'GoldenGavel' })}
              accessibilityLabel={t('x_attorney_dashboard_view_gavel_program')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.textSecond }]}>{t('x_attorney_dashboard_gavel_program_status')}</Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('Subscription')}
              accessibilityLabel={t('x_attorney_dashboard_manage_subscription')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.textSecond }]}>{t('x_attorney_dashboard_manage_subscription_2')}</Text>
            </TouchableOpacity>
          </>
        )}
        <View style={{ height: 48 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:           { flex: 1 },
  scroll:           { padding: 16 },
  tabBar:           { flexDirection: 'row', borderBottomWidth: 1 },
  tabBtn:           { flex: 1, alignItems: 'center', paddingVertical: 13 },
  tabLabel:         { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  emptyCard:        { borderRadius: RADIUS.lg, borderWidth: 1, padding: 24, alignItems: 'center', marginTop: 8 },
  emptyIcon:        { fontSize: 36, marginBottom: 10 },
  emptyTitle:       { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  emptyBody:        { fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 16 },
  emptyBtn:         { borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 20 },
  emptyBtnText:     { color: colors.textOnGold, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  caseCard:         { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  caseHeader:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  caseTitle:        { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 2 },
  caseMeta:         { fontSize: 12 },
  caseNote:         { fontSize: 12, marginBottom: 8, fontStyle: 'italic' },
  courtDateBadge:   { borderRadius: RADIUS.sm, padding: 8, alignItems: 'center', minWidth: 48 },
  courtDateDays:    { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  courtDateLabel:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  caseActions:      { flexDirection: 'row', gap: 8 },
  caseActionBtn:    { flex: 1, borderRadius: RADIUS.sm, borderWidth: 1, paddingVertical: 9, alignItems: 'center' },
  caseActionText:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  filterRow:        { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip:       { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1 },
  filterChipText:   { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  tplCard:          { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 8 },
  tplHeader:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tplTitle:         { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 3 },
  tplMeta:          { fontSize: 11 },
  tplNote:          { fontSize: 12, marginTop: 8, lineHeight: 17 },
  statusPill:       { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText:   { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  cleHeader:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, alignItems: 'center', marginBottom: 14 },
  cleHours:         { fontSize: 48, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  cleHoursLabel:    { fontSize: 12 },
  cleCard:          { borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 10 },
  cleCardHeader:    { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  cleTitleRow:      { marginBottom: 4 },
  cleTitle:         { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', lineHeight: 18 },
  cleMeta:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  cleMetaText:      { fontSize: 11 },
  chevron:          { fontSize: 11 },
  diffBadge:        { borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  diffBadgeText:    { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  cleBody:          { paddingHorizontal: 16, paddingBottom: 14 },
  cleDesc:          { fontSize: 12, lineHeight: 19, marginBottom: 10 },
  cleContent:       { fontSize: 12, lineHeight: 19, marginBottom: 12 },
  completeBtn:      { borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  completeBtnText:  { color: colors.textOnGold, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  completedBanner:  { borderRadius: RADIUS.sm, borderWidth: 1, padding: 10, alignItems: 'center' },
  transcriptBtn:    { borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  transcriptBtnText:{ fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  statsGrid:        { flexWrap: 'wrap' as const, flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  statCell:         { width: '33%', flex: 1, alignItems: 'center', paddingVertical: 16 },
  statValue:        { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 3 },
  statLabel:        { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  gavelBadge:       { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14, alignItems: 'center' },
  fieldLabel:       { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, marginTop: 14 },
  input:            { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, fontSize: 14, lineHeight: 21, marginBottom: 4 },
  saveBtn:          { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  saveBtnText:      { color: colors.textOnGold, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  outlineBtn:       { borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  outlineBtnText:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Bar verification status card
  barStatusCard:       { flexDirection:'row', alignItems:'center', borderRadius:12, borderWidth:1, padding:14, marginBottom:12, gap:10 },
  barStatusTitle:      { fontSize:13, fontWeight:'700', marginBottom:3 },
  barStatusSub:        { fontSize:12, color:colors.steel, lineHeight:17 },
  barStatusAction:     { backgroundColor:COLORS.navy, borderRadius:8, paddingHorizontal:12, paddingVertical:8 },
  barStatusActionText: { fontSize:12, fontWeight:'700', color:COLORS.bgCard },
  // Profile completion bar
  completionCard:  { borderRadius:12, borderWidth:1, padding:14, marginBottom:12 },
  completionLabel: { fontSize:12, fontWeight:'600' },
  completionBar:   { height:6, borderRadius:4, overflow:'hidden', marginBottom:8 },
  completionFill:  { height:6, borderRadius:4 },
  completionHint:  { fontSize:11, lineHeight:17 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);

export default React.memo(AttorneyDashboardScreen);