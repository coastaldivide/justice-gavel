/**
 * CheckInManagerScreen -- Bondsman check-in management
 *
 * Bondsman can:
 *   - See all enrolled defendants + compliance status
 *   - Enroll a new defendant (name, phone, case number, court date)
 *   - View daily check-in log for each defendant
 *   - See missed check-ins highlighted in red
 *   - Deactivate monitoring for a defendant
 *
 * $9.99/month per active defendant. Shown as monthly total.
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, FlatList, TextInput, Modal, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView} from 'react-native';
import { api } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';

declare var loading: any;
declare var setLoading: any;
declare var load: any; // hoisted from component scope
type DefendantRow = {
  id: number; defendant_name: string; defendant_phone: string;
  case_number: string; court_date: string; active: number;
  total_checkins: number; checkins_today: number; last_checkin: string | null;
  monthly_fee_cents: number;
};

function statusColor(row: DefendantRow): { color: string; bg: string; label: string } {
  if (!row.active) return { color: COLORS.textMuted, bg: COLORS.bg, label: 'Inactive' };
  if (row.checkins_today > 0) return { color: COLORS.legal, bg: COLORS.legalBg, label: '✓ Checked in today' };
  const courtSoon = row.court_date &&
    Math.ceil(((new Date(row.court_date ?? 0).getTime() || Infinity) - Date.now()) / 86400000) <= 3;
  if (courtSoon) return { color: COLORS.emergency, bg: COLORS.emergencyBg, label: '⚠ Court soon -- not checked in' };
  return { color: COLORS.warn, bg: COLORS.warnBg, label: '⏳ Not checked in today' };
}

// ── Enroll Modal ──────────────────────────────────────────────────────────────
function EnrollModal({ visible, onClose, onEnrolled }: any) {
  const [mgmtError, setMgmtError] = React.useState<string|null>(null);
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [caseNum, setCaseNum] = useState('');
  const [courtDate, setCourtDate] = useState('');
  const [freq, setFreq]       = useState<'daily'|'weekly'>('daily');
  const [saving, setSaving]   = useState(false);

  const reset = () => { setName(''); setPhone(''); setCaseNum(''); setCourtDate(''); };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Enter defendant name.'); return; }
    setSaving(true);
    try {
      const res = await api.post('/checkins/enroll', {
        defendant_name: name.trim(),
        defendant_phone: phone.trim(),
        case_number: caseNum.trim(),
        court_date: courtDate.trim() || undefined,
        check_in_freq: freq,
      });
      Alert.alert('✓ Enrolled', res.data?.message);
      reset();
      onEnrolled();
    } catch (e: any) {
      Alert.alert('Couldn\'t save', 'Check your internet and try again. Your information is not lost.');
    } finally {
      setSaving(false);
    }
  };


  // Refresh data whenever user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => onClose()}>
    {mgmtError && (
      <View style={{margin:16,padding:14,backgroundColor:COLORS.surface,
        borderRadius:10,borderWidth:1,borderColor:COLORS.border}}>
        <Text style={{color:COLORS.danger,fontWeight:'700',fontSize:14}}>⚠ {mgmtError}</Text>
      </View>
    )}
      <View style={styles.modalWrap}>
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>Enroll Defendant</Text>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}
              accessibilityRole="button"
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.feeBreakdown}>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownTitle}>💳  Billing</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>• $9.99/month per active defendant</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>• First defendant added to your account after setup</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>• Cancel per-defendant anytime from this screen</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>• Demo mode: no charge made</Text>
          </View>

          {[
            { label: 'Full Name *', value: name, set: setName, placeholder: 'John Smith', keyboard: 'default' as any },
            { label: 'Phone number', value: phone, set: setPhone, placeholder: '+1 555-000-0000', keyboard: 'phone-pad' as any },
            { label: 'Case number', value: caseNum, set: setCaseNum, placeholder: 'e.g. 2025-CR-0042', keyboard: 'default' as any },
            { label: 'Court date (YYYY-MM-DD)', value: courtDate, set: setCourtDate, placeholder: '2025-07-15', keyboard: 'default' as any },
          ].map(f => (
            <View key={f.label} style={{ marginBottom: 14 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={styles.input}
                value={f.value}
                onChangeText={f.set}
                placeholder={f.placeholder}
                placeholderTextColor={COLORS.textSecond}
                keyboardType={f.keyboard}
          returnKeyType="next"
          blurOnSubmit
        />
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Check-in frequency</Text>
          <View style={styles.freqRow}>
            {(['daily', 'weekly'] as const).map(f => (
              <TouchableOpacity
                accessibilityRole="button"
                key={f}
                style={[styles.freqBtn, freq === f && styles.freqBtnActive]}
                onPress={() => setFreq(f)}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.freqBtnText, freq === f && styles.freqBtnTextActive]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity activeOpacity={0.6}
            accessibilityRole="button"
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={COLORS.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>Enroll · $9.99/month</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────
function HistoryModal({ enrollment, visible, onClose }: any) {
  const [records, setRecords]   = useState<any[]>([]);
  const [compliance, setCompliance] = useState<any>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (visible && enrollment) {
      setLoading(true);
      api.get(`/checkins/history/${enrollment.id}`)
        .then(r => { setRecords(r.data?.records); setCompliance(r.data?.compliance); })
        .catch((e) => { __DEV__ && console.warn(e?.message); })
        .finally(() => setLoading(false));
    }
  }, [visible, enrollment]);

  if (!enrollment) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => onClose()}>
      <View style={styles.modalWrap}>
        <View style={[styles.modalHeader, { backgroundColor: COLORS.navy }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.modalTitle, { color: COLORS.bgCard }]}>{enrollment.defendant_name}</Text>
          <TouchableOpacity onPress={onClose}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.modalClose, { color: COLORS.bgCard }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {compliance && (
          <View style={styles.complianceStrip}>
            {[
              { n: compliance.last_30_days, label: 'Last 30 days' },
              { n: compliance.missed, label: 'Missed', red: true },
              { n: compliance.rate, label: 'Rate' },
            ].map(item => (
              <View key={item.label} style={styles.complianceStat}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.complianceNum, item.red && { color: COLORS.emergency }]}>
                  {item.n}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.complianceLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {loading
          ? <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.navy} />
          : records.length === 0
            ? <View style={styles.emptyCenter}><Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>No check-ins yet.</Text></View>
            : (
              <FlatList
                getItemLayout={(_, index) => ({ length: 80, offset: 80 * index, index })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={records}
                keyExtractor={r => String(r.id)}
                contentContainerStyle={{ padding: 14 }}
                renderItem={({ item }) => (
                  <View style={styles.historyRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.historyStatus,
                      item.status === 'submitted' ? { color: COLORS.legal } : { color: COLORS.warn }
                    ]}>
                      {item.status === 'submitted' ? '✓' : '⚠'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.historyDate}>
                        {new Date(item.checked_in_at).toLocaleDateString('en-US',
                          { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                        )}
                      </Text>
                      {!!item.location_label && (
                        <Text maxFontSizeMultiplier={1.4} style={styles.historyLocation}>📍 {item.location_label}</Text>
                      )}
                      {!!item.notes && (
                        <Text maxFontSizeMultiplier={1.4} style={styles.historyNotes} numberOfLines={2} ellipsizeMode="tail">{item.notes}</Text>
                      )}
                    </View>
                  </View>
                )}
              />
            )
        }
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function CheckInManagerScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [data, setData]             = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [selectedEnroll, setSelectedEnroll] = useState<any>(null);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get('/checkins/enrollments');
      setData(res.data || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        Alert.alert('Could not load', 'Check your connection and pull down to refresh.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deactivate = (id: number, name: string) => {
    Alert.alert(`Remove ${name}?`, 'They will no longer need to check in. $9.99/month removed from your bill.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await api.put(`/checkins/enrollments/${id}`, { active: false }).catch((e) => { __DEV__ && console.warn(e?.message); });
        load();
      }},
    ]);
  };

  const enrollments: DefendantRow[] = data?.enrollments || [];
  const active = enrollments.filter(e => e.active);
  const inactive = enrollments.filter(e => !e.active);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AuthGateModal />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Check-In Manager</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
            {active.length} active · {data?.monthly_cost || '$0.00'}/month
          </Text>
        </View>
        <TouchableOpacity
          style={styles.enrollBtn}
          onPress={() => requireAuth(() => setShowEnroll(true))}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.enrollBtnText}>+ Enroll</Text>
        </TouchableOpacity>
      </View>

      {/* How it works -- shown when empty */}
      {!loading && active.length === 0 && (
        <View style={styles.howItWorks}>
          <Text maxFontSizeMultiplier={1.4} style={styles.howTitle}>📱 Digital Check-In for Defendants</Text>
          {[
            '1. Enroll a defendant with their name + phone',
            '2. They get a link to check in daily from their phone',
            '3. GPS + timestamp logged automatically',
            '4. You see compliance history at a glance',
            '5. $9.99/month per defendant -- cancel anytime',
          ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={styles.howItem}>{s}</Text>)}
          <TouchableOpacity
            style={styles.howBtn}
            onPress={() => requireAuth(() => setShowEnroll(true))}
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.howBtnText}>Enroll First Defendant →</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.navy} size="large" />
      ) : (
        <FlatList
          data={[...active, ...inactive]}
          keyExtractor={r => String(r.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          renderItem={({ item }) => {
            const st = statusColor(item);
            return (
              <View style={[styles.card, !item.active && styles.cardInactive]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.defendantName}>{item.defendant_name}</Text>
                    {!!item.case_number && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.caseNum}>Case #{item.case_number}</Text>
                    )}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>

                <View style={styles.statsStrip}>
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatNum}>{item.total_checkins}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>Total</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.miniStatNum, item.checkins_today > 0 && { color: COLORS.legal }]}>
                      {item.checkins_today > 0 ? '✓' : '--'}
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>Today</Text>
                  </View>
                  {!!item.court_date && (
                    <View style={styles.miniStat}>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.miniStatNum, { fontSize: 12 }]}>
                        {Math.max(0, Math.ceil((new Date(item.court_date).getTime() - Date.now()) / 86400000))}d
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>Court</Text>
                    </View>
                  )}
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatNum}>${(item.monthly_fee_cents / 100).toFixed(2)}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>/mo</Text>
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => setSelectedEnroll(item)}
          accessibilityRole="button"
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>📋 View History</Text>
                  </TouchableOpacity>
                  {item.active && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnRed]}
          accessibilityRole="button"
                      onPress={() => deactivate(item.id, item.defendant_name)}
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.actionBtnText, { color: COLORS.emergency }]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
      <EnrollModal
        visible={showEnroll}
        onClose={() => setShowEnroll(false)}
        onEnrolled={() => { setShowEnroll(false); load(); }}
      />
      <HistoryModal
        enrollment={selectedEnroll}
        visible={!!selectedEnroll}
        onClose={() => setSelectedEnroll(null)}
      />
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    backgroundColor: COLORS.bail, paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'flex-end',
  },
  heading:    { fontSize: 22, ...FONTS.black, color: COLORS.bgCard },
  subheading: { fontSize: 12, color: colors.emergency, marginTop: 2 },
  enrollBtn:  {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  enrollBtnText: { color: COLORS.bail, ...FONTS.heavy, fontSize: 12 },

  howItWorks: {
    backgroundColor: COLORS.bgCard, margin: 14, borderRadius: RADIUS.xl,
    padding: 16, ...SHADOW.md, borderWidth: 1, borderColor: COLORS.border,
  },
  howTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 12 },
  howItem:  { fontSize: 12, color: COLORS.textSecond, lineHeight: 22 },
  howBtn:   {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.md,
    paddingVertical: 12, alignItems: 'center', marginTop: 14,
  },
  howBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  card: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 10,
    ...SHADOW.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  defendantName: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, marginBottom: 2 },
  caseNum:       { fontSize: 12, color: COLORS.textMuted },
  statusBadge:   { borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusText:    { fontSize: 11, ...FONTS.bold },

  statsStrip: { flexDirection: 'row', marginBottom: 10, gap: 12 },
  miniStat:   { alignItems: 'center', flex: 1 },
  miniStatNum:   { fontSize: 18, ...FONTS.black, color: COLORS.navy },
  miniStatLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, paddingVertical: 9, borderRadius: RADIUS.md,
    backgroundColor: COLORS.bg, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  actionBtnRed:  { borderColor: COLORS.emergencyBg, backgroundColor: COLORS.emergencyBg },
  actionBtnText: { fontSize: 12, ...FONTS.semi, color: COLORS.textSecond },

  // Modals
  modalWrap:   { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    backgroundColor: COLORS.bail, padding: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  modalTitle: { fontSize: 20, ...FONTS.black, color: COLORS.bgCard },
  modalClose: { fontSize: 20, color: COLORS.bgCard },
  modalBody:  { padding: 20 },

  feeNote: {
    backgroundColor: COLORS.legalBg, borderRadius: RADIUS.md, padding: 12,
    fontSize: 12, color: COLORS.legal, marginBottom: 16, lineHeight: 17,
    borderWidth: 1, borderColor: colors.legal,
  },
  feeBreakdown: { backgroundColor: colors.legal, borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.legal },
  feeBreakdownTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, marginBottom: 6 },
  feeBreakdownItem:  { fontSize: 12, color: colors.legal, lineHeight: 19 },
  fieldLabel: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, lineHeight: 21, color: COLORS.textPrimary,
  },
  freqRow:        { flexDirection: 'row', gap: 8, marginBottom: 20 },
  freqBtn:        { flex: 1, paddingVertical: 11, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center' },
  freqBtnActive:  { borderColor: COLORS.navy, backgroundColor: COLORS.navy },
  freqBtnText:    { fontSize: 14, lineHeight: 21, ...FONTS.semi, color: COLORS.textSecond },
  freqBtnTextActive: { color: COLORS.bgCard },
  saveBtn: {
    backgroundColor: COLORS.bail, borderRadius: RADIUS.lg,
    paddingVertical: 15, alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { color: COLORS.bgCard, ...FONTS.black, fontSize: 15,
    lineHeight: 22, },

  // Compliance / History
  complianceStrip: { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  complianceStat:  { flex: 1, alignItems: 'center', paddingVertical: 16 },
  complianceNum:   { fontSize: 22, ...FONTS.black, color: COLORS.navy },
  complianceLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: Platform.OS === 'ios' ? 40 : 28 },
  emptyText:   { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },

  historyRow: {
    flexDirection: 'row', gap: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  historyStatus:   { fontSize: 18, marginTop: 2 },
  historyDate:     { fontSize: 12, lineHeight: 20, ...FONTS.semi, color: COLORS.textPrimary },
  historyLocation: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  historyNotes:    { fontSize: 12, color: COLORS.textSecond, marginTop: 2, fontStyle: 'italic' },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
