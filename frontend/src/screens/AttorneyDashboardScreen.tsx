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
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, KeyboardAvoidingView, Platform} from 'react-native';
import { api }      from '../services/api';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';
import OfflineBanner from '../components/OfflineBanner';

import { ScreenCapture } from '../utils/webCompat';
import { daysUntil, formatDate} from '../utils/dateUtils';
import { useFocusEffect } from '@react-navigation/native';

declare var profile: any;
declare var setError: any;
declare var setTab: any;
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
const DAY_LABELS: Record<string, string>  = { mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun' };
const SLOT_LABELS: Record<string, string> = { morning:'AM',afternoon:'PM',evening:'Eve' };

function AvailabilityGrid({ userId }: { userId: number }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [schedule, setSchedule] = React.useState<Record<string, string[]>>({});
  const [note, setNote]         = React.useState('');
  const [saving, setSaving]     = React.useState(false);
  const [saved, setSaved]       = React.useState(false);

  React.useEffect(() => {
    api.get('/attorney/profile/availability')
      .then(r => { setSchedule(r.data?.schedule || {}); setNote(r.data?.note || ''); })
      .catch(() => {});
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
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <View style={{ marginTop: 20 }}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22,
        fontWeight: '700', color: COLORS.textPrimary, marginBottom: 12 }}>
        📅 Weekly Availability
      </Text>
      {/* Grid */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {/* Slot labels */}
        <View style={{ width: 36, paddingTop: 24 }}>
          {SLOTS.map(s => (
            <Text key={s} maxFontSizeMultiplier={1.4} style={{ fontSize: 10, lineHeight: 22,
              color: COLORS.textMuted, height: 30, textAlignVertical: 'center' }}>
              {SLOT_LABELS[s]}
            </Text>
          ))}
        </View>
        {/* Days */}
        {DAYS.map(day => (
          <View key={day} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 10, lineHeight: 14,
              color: COLORS.textMuted, fontWeight: '700', marginBottom: 4 }}>
              {DAY_LABELS[day]}
            </Text>
            {SLOTS.map(slot => {
              const active = (schedule[day] || []).includes(slot);
              return (
                <TouchableOpacity key={slot}
                  style={{ width: '100%', height: 28, borderRadius: 4,
                    backgroundColor: active ? COLORS.navy : COLORS.bgSubtle,
                    borderWidth: 1, borderColor: active ? COLORS.navy : COLORS.border }}
                  onPress={() => toggle(day, slot)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${DAY_LABELS[day]} ${SLOT_LABELS[slot]}`}
                />
              );
            })}
          </View>
        ))}
      </View>
      {/* Note */}
      <TextInput
        style={{ marginTop: 12, borderWidth: 1, borderColor: COLORS.inputBorder,
          borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 19,
          color: COLORS.inputText, backgroundColor: COLORS.inputBg }}
        placeholder="Availability note (e.g. 'Best to reach me Tuesday mornings')"
        placeholderTextColor={COLORS.placeholder}
        value={note}
        onChangeText={t => { setNote(t); setSaved(false); }}
        maxLength={200}
        returnKeyType="done"
        blurOnSubmit
        accessibilityLabel="Availability note"
      />
      <TouchableOpacity
        style={{ marginTop: 10, backgroundColor: saving ? COLORS.bgSubtle : COLORS.navy,
          borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
        onPress={save} disabled={saving}
        accessibilityRole="button" accessibilityLabel="Save availability"
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: saving ? COLORS.textMuted : COLORS.bgCard,
          fontWeight: '700', fontSize: 13, lineHeight: 19 }}>
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Availability'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function AttorneyDashboardScreen({ navigation }: ScreenProps): React.JSX.Element | null {

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const { colors } = useTheme();

  // ── Role gate -- only attorneys and defenders can access this screen ──────────
  // Any authenticated user can navigate here via deep link or direct navigation.
  // This check prevents consumer users from seeing attorney-only features.
  const [roleChecked, setRoleChecked] = React.useState(false);
  const [isAuthorized, setIsAuthorized] = React.useState(false);
  React.useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = (() => { try { return JSON.parse(raw); } catch { return null; } })();
        const allowed = ['attorney','defender','admin'].includes(u.role);
        setIsAuthorized(allowed);
        if (!allowed) {
          // Redirect immediately -- consumer users should not see this screen
          (navigation as any).replace('HomeTab');
        }
      } else {
        (navigation as any).replace('HomeTab');
      }
      setRoleChecked(true);
    }).catch(() => { (navigation as any).replace('HomeTab'); });
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

  useEffect(() => { loadAll(); }, [loadAll]);
  // Reload when returning from CaseScreen, BookingScreen, etc.
  useFocusEffect(React.useCallback(() => { loadAll(); }, [loadAll]));

  const onRefresh = useCallback(() => { setRefreshing(true); loadAll(); }, [loadAll]);

  const completeCLE = async (courseId: number) => {
    setCompleting(courseId);
    try {
      const res = await api.post(`/attorney/cle/${courseId}/complete`, {});
      const msg = res.data?.already_completed
        ? 'Already completed -- credit on your transcript.'
        : `✓ ${res.data?.message}`;
      Alert.alert('CLE Credit', msg);
      loadAll();
    } catch (e: any) { Alert.alert('Dashboard Error', e.response?.data?.error || 'Could not complete course'); }
    setCompleting(null);
  };

  const saveProfile = async () => {
      if (!barInput?.trim()) { Alert.alert('Bar Number Required', 'Please enter your state bar number.'); return; }
      setSavingProfile(true);
    try {
      await api.patch('/attorney/profile', { bar_number: barInput, is_defender: 1 });
      if (officeInput && officeNameInput) {
        await api.post('/attorney/office/join', {
          office_id: officeInput.trim().toLowerCase().replace(/\s+/g,'_'),
          office_name: officeNameInput.trim(),
        });
      }
      Alert.alert('Saved', 'Profile updated.');
      loadAll();
    } catch (e: any) { Alert.alert('Dashboard Error', e.response?.data?.error || 'Could not save'); }
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
          ? 'Your bar verification is over 1 year old -- consider re-verifying your license.'
          : `Your bar verification is ${monthsSince} months old -- renewal may be approaching.`,
      };
    }
    return null;
  }, [profile]);
  if (loading) return (
    <View style={[styles.screen, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.steel} />
    </View>
  );

  // Bar license renewal reminder
  // Most state bars renew annually or biennially. Remind after 10 months.
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* ── Dashboard greeting header ──────────────────────────────────── */}
      <View style={{ paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 36,
        paddingBottom: 12, backgroundColor: colors.bg,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 20, fontWeight: '800',
              color: colors.textPrimary, letterSpacing: -0.3 }}>⚖️ Dashboard</Text>
            {cases.length > 0 && (
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {cases.length} active {cases.length === 1 ? 'case' : 'cases'}
                {cases.filter((c: any) => c.escalation?.level === 'critical').length > 0
                  ? ` · ${cases.filter((c: any) => c.escalation?.level === 'critical').length} 🚨 critical`
                  : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('MoreTab', { screen: 'MatterIntelligence' })}
            accessibilityRole="button"
            accessibilityLabel='Open matter intelligence'
            style={{ backgroundColor: colors.navy, paddingHorizontal: 12,
              paddingVertical: 7, borderRadius: 8 }}>
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '700',
              color: '#fff', letterSpacing: 0.3 }}>🧠 Intelligence</Text>
          </TouchableOpacity>
        </View>
      </View>

  if (!roleChecked) return null;
  if (!isAuthorized) return null;

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
        {([
          { key:'cases',     label:'Cases',     badge: cases.length },
          { key:'templates', label:'Templates', badge: null },
          { key:'cle',       label:'CLE',       badge: null },
          { key:'profile',   label:'Profile',   badge: null },
        ] as { key: Tab; label: string; badge: number | null }[]).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab===t.key && { borderBottomColor: colors.steel, borderBottomWidth: 2 }]}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.tabLabel, { color: tab===t.key ? colors.textPrimary : colors.textMuted }]}>
              {t.label}
              {t.badge !== null && t.badge > 0 ? ` (${t.badge})` : ''}
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

        {/* ── MY CASES ─────────────────────────────────────────────────── */}
        {tab === 'cases' && (
          <>
            {cases.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📁</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>No assigned cases</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>
                  Cases are assigned when a client adds you through the Lawyer Search or when a supervisor assigns cases through the office dashboard.
                </Text>
              </View>
            ) : (
              <></>
            )}

            {/* Sort controls */}
            {cases.length > 1 && (
              <View style={{ flexDirection:'row', gap:6, marginBottom:10 }}>
                {(['date','name','status'] as const).map(opt => (
                  <TouchableOpacity key={opt} onPress={() => setSortBy(opt)}
                    accessibilityRole="button"
                    style={{ paddingHorizontal:12, paddingVertical:5, borderRadius:16,
                      borderWidth:1, borderColor:sortBy===opt?colors.navy:colors.border,
                      backgroundColor:sortBy===opt?colors.navy:colors.bgCard }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, fontWeight:'600',
                      color:sortBy===opt?colors.bgCard:colors.textMuted }}>
                      {opt==='date'?'📅 Soonest':opt==='name'?'🔤 Name':'⚡ Status'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {[...cases].sort((a,b)=>{ if(sortBy==='name') return (a.title||'').localeCompare(b.title||''); if(sortBy==='status') return (a.status||'').localeCompare(b.status||''); const da=a.next_court_date?new Date(a.next_court_date).getTime():Infinity; const db2=b.next_court_date?new Date(b.next_court_date).getTime():Infinity; return da-db2; }).map((cas, i) => {
              const days = daysUntil(cas.next_court_date);
              return (
                <TouchableOpacity
                  key={cas.id}
                  style={[styles.caseCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                  onPress={() => navigation.navigate('Cases')}
                  accessibilityRole="button"
                  accessibilityLabel={`Open case: ${cas.title}`}
                >
                  <View style={styles.caseHeader}>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                        {cas.title || `Case #${cas.id}`}
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseMeta, { color: colors.textMuted }]}>
                        {cas.client_name || 'Client'} · {cas.status || 'Active'}
                      </Text>
                    </View>
                    {cas.next_court_date && (
                      <View style={[styles.courtDateBadge, { backgroundColor: days !== null && days <= 7 ? colors.emergencyBg : colors.bgElevated }]}>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.courtDateDays, { color: urgencyColor(days) }]}>
                          {days !== null ? `${days}d` : '--'}
                        </Text>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.courtDateLabel, { color: colors.textMuted }]}>court</Text>
                      </View>
                    )}
                  </View>
                  {cas.assignment_notes ? (
                    <Text maxFontSizeMultiplier={1.4} style={[styles.caseNote, { color: colors.textSecond }]} numberOfLines={1}>
                      Note: {cas.assignment_notes}
                    </Text>
                  ) : null}
                  <View style={styles.caseActions}>
                    <TouchableOpacity
                      style={[styles.caseActionBtn, { borderColor: colors.border }]}
                      onPress={() => navigation.navigate('Messages', { caseId: cas.id, caseTitle: cas.title })}
                      accessibilityRole="button"
                      accessibilityLabel="Message client"
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseActionText, { color: colors.steel }]}>💬 Message</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.caseActionBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
                      onPress={() => navigation.navigate('MotionLibrary', { caseId: cas.id })}
                      accessibilityLabel="Draft a motion for this case"
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.caseActionText, { color: colors.steel }]}>📋 Motion</Text>
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
                color: colors.textMuted, marginRight: 4 }}>View:</Text>
              {(['cards','table'] as const).map(mode => (
                <TouchableOpacity key={mode}
                  accessibilityRole="button"
                  onPress={() => setMotionViewMode(mode)}
                  style={{ paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
                    borderWidth: 1,
                    borderColor: motionViewMode === mode ? colors.blue : colors.border,
                    backgroundColor: motionViewMode === mode ? colors.infoBg : colors.bgCard }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600',
                    color: motionViewMode === mode ? colors.blue : colors.textMuted }}>
                    {mode === 'cards' ? 'Cards' : 'Table'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.filterRow}>
              {(['approved','pending','all'] as const).map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip,
                    { backgroundColor: tplFilter===f ? colors.steel : colors.bgCard,
                      borderColor: tplFilter===f ? colors.steel : colors.border }]}
          accessibilityRole="button"
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
                <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📋</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>No templates yet</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>
                  Generate a motion in the Motion Library, then save it as an office template for your colleagues to use.
                </Text>
                <TouchableOpacity
                  style={[styles.emptyBtn, { backgroundColor: colors.steel }]}
                  onPress={() => navigation.navigate('MotionLibrary')}
                  accessibilityRole="button"
                  accessibilityLabel="Go to Motion Library"
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.emptyBtnText}>Open Motion Library →</Text>
                </TouchableOpacity>
              </View>
            ) : templates.map((tpl) => (
              <View key={tpl.id} style={[styles.tplCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <View style={styles.tplHeader}>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} numberOfLines={2} ellipsizeMode="tail" style={[styles.tplTitle, { color: colors.textPrimary }]}>{tpl.title}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.tplMeta, { color: colors.textMuted }]}>
                      {tpl.motion_type} · {tpl.created_by_name || 'Unknown'}
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
              <Text maxFontSizeMultiplier={1.4} style={[styles.cleHours, { color: colors.steel }]}>{cleTotal.toFixed(1)}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.cleHoursLabel, { color: colors.textMuted }]}>CLE hours earned on Justice Gavel</Text>
            </View>

            {courses.map((course) => {
              const done      = !!course.completed_at;
              const expanded  = expandedCourse === course.id;

              return (
                <View key={course.id} style={[styles.cleCard, { backgroundColor: colors.bgCard, borderColor: done ? colors.legalDark : colors.border }]}>
                  <TouchableOpacity
                    style={styles.cleCardHeader}
                    onPress={() => setExpandedCourse(expanded ? null : course.id)}
            accessibilityRole="button"
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
                          style={[styles.completeBtn, { backgroundColor: colors.steel },
                            completing === course.id && { opacity: 0.6 }]}
                          onPress={() => completeCLE(course.id)}
            accessibilityRole="button"
                          disabled={completing === course.id}
                          accessibilityLabel={`Mark ${course.title} complete`}
                        >
                          {completing === course.id
                            ? <ActivityIndicator color={colors.bg} size="small" />
                            : <Text maxFontSizeMultiplier={1.4} style={styles.completeBtnText}>
                                Mark Complete -- Earn {course.credit_hours}h CLE Credit
                              </Text>
                          }
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.completedBanner, { backgroundColor: colors.legalBg, borderColor: colors.legalDark }]}>
                          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.legal, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>
                            ✓ Completed -- {course.credit_hours}h earned
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            <TouchableOpacity
              style={[styles.transcriptBtn, { borderColor: colors.steel }]}
              onPress={() => Alert.alert('CLE Transcript', `${cleTotal.toFixed(1)} CLE hours earned on Justice Gavel.`)}
              accessibilityRole="button"
              accessibilityLabel="View CLE transcript"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.transcriptBtnText, { color: colors.steel }]}>View Full Transcript →</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── PROFILE ──────────────────────────────────────────────────── */}
        {tab === 'profile' && !profile && !loading && (
          <View style={[styles.emptyCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>👤</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>Profile not loaded</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyBody, { color: colors.textSecond }]}>Pull to refresh or check your connection.</Text>
          </View>
        )}
        {tab === 'profile' && profile && (
          <>

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
                      Profile {pct}% complete
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.completionLabel, { color: colors.textMuted }]}>
                      {done}/{fields.length} fields
                    </Text>
                  </View>
                  <View style={[styles.completionBar, { backgroundColor: colors.border }]}>
                    <View style={[styles.completionFill, { width: (pct + '%') as any,
                      backgroundColor: pct >= 80 ? colors.legalDark : pct >= 50 ? colors.warnDark : colors.emergencyDark
                    }]} />
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.completionHint, { color: colors.textMuted }]}>
                    {!profile.bar_verified && '• Verify your bar number for the JTB badge'}
                    {!profile.bio && '• Add a bio so clients can learn about you'}
                    {!profile.office_name && !profile.office_id && '• Add your office name to appear in firm search'}
                  </Text>
                </View>
              ) : null;
            })()}

            {/* Stats */}
            <View style={[styles.statsGrid, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              {[
                { label: 'Active Cases',  value: String(profile.stats?.active_cases      || 0), color: colors.blue },
                { label: 'This Week',     value: String(profile.stats?.hearings_this_week || 0), color: colors.warn },
                { label: 'Motions Filed', value: String(profile.stats?.motions_generated  || 0), color: colors.legal },
                { label: 'Avg Rating',    value: profile.stats?.avg_rating ? profile.stats.avg_rating.toFixed(1) + '★' : 'N/A', color: colors.gold },
                { label: 'Unread Msgs',   value: String(profile.stats?.unread_messages    || 0), color: colors.emergency },
                { label: 'Response Rate', value: profile.stats?.response_rate ? profile.stats.response_rate + '%' : 'N/A', color: colors.steel },
                { label: 'CLE Hours', value: (profile.stats?.cle_hours_earned || 0).toFixed(1) + 'h', color: colors.legal },
              ].map((s,i,arr) => (
                <View key={s.label} style={[styles.statCell,
                  i < arr.length-1 && { borderRightWidth:1, borderRightColor: colors.border }]}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.statValue, { color: colors.steel }]}>{s.value}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.statLabel, { color: colors.textMuted }]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Gavel level */}
            {profile.gavel_level > 0 && (
              <View style={[styles.gavelBadge, { backgroundColor: colors.warnBg, borderColor: colors.gold }]}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.gold, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>
                  {['','🥉 Bronze','🥈 Silver','🏆 Golden'][profile.gavel_level] || ''} Gavel Holder
                </Text>
              </View>
            )}

            {/* Edit fields */}
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>BAR NUMBER</Text>
            <TextInput
                  maxLength={15}
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={barInput}
              onChangeText={setBarInput}
              placeholder="State bar number"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="State bar number"
          returnKeyType="next"
          blurOnSubmit
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>OFFICE ID (e.g. pd_davidson_tn)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={officeInput}
              onChangeText={setOfficeInput}
              placeholder="office_id"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              accessibilityLabel="Office ID"
          returnKeyType="next"
          blurOnSubmit
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textMuted }]}>OFFICE NAME</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
              value={officeNameInput}
              onChangeText={setOfficeNameInput}
              placeholder="Davidson County Public Defender"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Office name"
          returnKeyType="next"
          blurOnSubmit
        />

            <TouchableOpacity activeOpacity={0.6}
              style={[styles.saveBtn, { backgroundColor: colors.steel }, savingProfile && { opacity: 0.6 }]}
              onPress={saveProfile}
              disabled={savingProfile}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
            >
              {savingProfile
                ? <ActivityIndicator color={colors.bg} />
                : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>Save Profile</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.legalDark }]}
              onPress={async () => {
                if (!barInput.trim()) {
                  setError('Enter your bar number in the field above, then tap Verify.');
                  return;
                }
                try {
                  await api.post('/attorney/verify-bar', { bar_number: barInput, state: officeInput.slice(0,2) || 'TN' });
                  Alert.alert('Verification submitted ✓', 'Your bar number has been submitted for verification. You will be notified when approved. Verified attorneys appear first in search results.');
                } catch (e: any) {
                  Alert.alert('Could not submit', e.response?.data?.error || 'Try again.');
                }
              }}
              accessibilityLabel="Submit bar number for verification"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.legal }]}>✅  Submit Bar Number for Verification →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'GoldenGavel' })}
              accessibilityRole="button"
              accessibilityLabel="View Gavel Program"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.textSecond }]}>🏆  Gavel Program Status →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('Subscription')}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.outlineBtnText, { color: colors.textSecond }]}>💎  Manage Subscription →</Text>
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
  emptyBtnText:     { color: COLORS.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
  completeBtnText:  { color: COLORS.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
  saveBtnText:      { color: COLORS.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  outlineBtn:       { borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  outlineBtnText:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Bar verification status card
  barStatusCard:       { flexDirection:'row', alignItems:'center', borderRadius:12, borderWidth:1, padding:14, marginBottom:12, gap:10 },
  barStatusTitle:      { fontSize:13, fontWeight:'700', marginBottom:3 },
  barStatusSub:        { fontSize:12, color:colors.steel, lineHeight:17 },
  barStatusAction:     { backgroundColor:'#042C53', borderRadius:8, paddingHorizontal:12, paddingVertical:8 },
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

            {/* Bar Verification Status */}
            <View style={[styles.barStatusCard, {
              backgroundColor: profile.bar_verified ? COLORS.legal : '#FFA726',
              borderColor: profile.bar_verified ? COLORS.legal : COLORS.warn,
            }]}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.barStatusTitle, {
                  color: profile.bar_verified ? COLORS.legal : '#FFA726'
                }]}>
                  {profile.bar_verified ? '✓ Bar Verified -- JTB Badge Active' : '⏳ Bar Verification Pending'}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.barStatusSub}>
                  {profile.bar_verified
                    ? ('Bar #' + (profile.bar_number || 'on file') + ' · ' + (profile.subscription_tier || 'Attorney') + ' plan')
                    : profile.bar_number
                      ? ('Bar #' + profile.bar_number + ' submitted -- review within 1-2 business days')
                      : 'Submit your bar number in the field below to get verified'}
                </Text>
              </View>
              {!profile.bar_verified && (
                <TouchableOpacity
                  style={styles.barStatusAction}
                  onPress={() => setTab('profile')}
                  accessibilityRole="button"
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.barStatusActionText}>
                    {profile.bar_number ? 'View Status' : 'Verify Now'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
