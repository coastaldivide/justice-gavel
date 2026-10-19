import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
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
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, TextInput, Modal, ActivityIndicator, RefreshControl, KeyboardAvoidingView, InteractionManager } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { daysUntil } from '../utils/dateUtils';
import { useAuthGate } from '../components/AuthGate';
import { t, useLang, locale } from '../i18n';

type DefendantRow = {
  id: number; defendant_name: string; defendant_phone: string;
  case_number: string; court_date: string; active: number;
  total_checkins: number; checkins_today: number; last_checkin: string | null;
  monthly_fee_cents: number;
};

function statusColor(row: DefendantRow): { color: string; bg: string; label: string } {
  if (!row.active) return { color: COLORS.textMuted, bg: COLORS.bg, label: t('x_check_in_manager_inactive') };
  if (row.checkins_today > 0) return { color: COLORS.legal, bg: COLORS.legalBg, label: t('x_check_in_manager_checked_today') };
  const courtSoon = row.court_date &&
    (daysUntil(row.court_date) ?? Infinity) <= 3;
  if (courtSoon) return { color: COLORS.emergency, bg: COLORS.emergencyBg, label: t('x_check_in_manager_court_soon_not_checked') };
  return { color: COLORS.warn, bg: COLORS.warnBg, label: t('x_check_in_manager_not_checked_today') };
}

// ── Enroll Modal ──────────────────────────────────────────────────────────────
function EnrollModal({ visible, onClose, onEnrolled }: any) {
  useLang();
  const { showToast } = useToast();
  React.useEffect(() => {
    const tItem = InteractionManager.runAfterInteractions(() => {});
    return () => tItem.cancel();
  }, []);
  const [mgmtError, setMgmtError] = React.useState<string|null>(null);
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [caseNum, setCaseNum] = useState('');
  const [courtDate, setCourtDate] = useState('');
  const [freq, setFreq]       = useState<'daily'|'weekly'>('daily');
  const [saving, setSaving]   = useState(false);

  const reset = () => { setName(''); setPhone(''); setCaseNum(''); setCourtDate(''); };

  const save = async () => {
    if (!name.trim()) { showToast(t('x_check_in_manager_enter_defendant_name')); return; }
    setSaving(true);
    setMgmtError(null);
    try {
      const res = await api.post('/checkins/enroll', {
        defendant_name: name.trim(),
        defendant_phone: phone.trim(),
        case_number: caseNum.trim(),
        court_date: courtDate.trim() || undefined,
        check_in_freq: freq,
      });
      showToast(res.data?.message, 'success');
      reset();
      onEnrolled();
    } catch (e: any) {
      // Shown inline at the top of the form; the entered details are kept.
      setMgmtError(apiErrorMessage(e, t('x_check_in_manager_check_internet_try_again')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal accessibilityViewIsModal={true} visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => onClose()}>
    {mgmtError && (
      <View style={{margin:16,padding:14,backgroundColor:COLORS.surface,
        borderRadius:10,borderWidth:1,borderColor:COLORS.border}}>
        <Text style={{color:COLORS.danger,fontWeight:'700',fontSize:14}}>⚠ {mgmtError}</Text>
      </View>
    )}
      <View style={styles.modalWrap}>
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>{t('x_check_in_manager_enroll_defendant')}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={() => { reset(); onClose(); }}
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.feeBreakdown}>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownTitle}>{t('x_check_in_manager_billing')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>{t('x_check_in_manager_9_99_month_per')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>{t('x_check_in_manager_first_defendant_added_account')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>{t('x_check_in_manager_cancel_per_defendant_anytime')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBreakdownItem}>{t('x_check_in_manager_demo_mode_no_charge')}</Text>
          </View>

          {[
            { label: t('x_check_in_manager_full_name'), value: name, set: setName, placeholder: t('x_check_in_manager_john_smith'), keyboard: 'default' as any },
            { label: t('x_auth_gate_phone_number'), value: phone, set: setPhone, placeholder: '+1 555-000-0000', keyboard: 'phone-pad' as any },
            { label: t('x_check_in_manager_case_number'), value: caseNum, set: setCaseNum, placeholder: t('x_check_in_manager_e_g_2025_cr'), keyboard: 'default' as any },
            { label: t('x_check_in_manager_court_date_yyyy_mm'), value: courtDate, set: setCourtDate, placeholder: '2025-07-15', keyboard: 'default' as any },
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
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_check_in_manager_check_frequency')}</Text>
          <View style={styles.freqRow}>
            {(['daily', 'weekly'] as const).map(f => (
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
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

          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
           accessibilityLabel={t('x_check_in_manager_enroll_9_99_month')}>
            {saving
              ? <ActivityIndicator color={COLORS.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>{t('x_check_in_manager_enroll_9_99_month')}</Text>
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
  useLang();
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
    <Modal accessibilityViewIsModal={true} visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => onClose()}>
      <View style={styles.modalWrap}
        testID="check-in-manager-screen">
        <View style={[styles.modalHeader, { backgroundColor: COLORS.navy }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.modalTitle, { color: COLORS.bgCard }]}>{enrollment.defendant_name}</Text>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={onClose}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.modalClose, { color: COLORS.bgCard }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {compliance && (
          <View style={styles.complianceStrip}>
            {[
              { n: compliance.last_30_days, label: t('x_check_in_manager_last_30_days') },
              { n: compliance.missed, label: t('cd_status_missed'), red: true },
              { n: compliance.rate, label: t('x_check_in_manager_rate') },
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
            ? <View style={styles.emptyCenter}><Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>{t('x_check_in_manager_no_check_ins_yet')}</Text></View>
            : (
              <FlashList
          accessibilityLabel={t('x_check_in_manager_check_schedule_list')}
          data={records}
                keyExtractor={r => String(r.id)}
                contentContainerStyle={{ padding: 14}}
                renderItem={({ item }) => (
                  <View style={styles.historyRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.historyStatus,
                      item.status === 'submitted' ? { color: COLORS.legal } : { color: COLORS.goldText }
                    ]}>
                      {item.status === 'submitted' ? '✓' : '⚠'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.historyDate}>
                        {new Date(item.checked_in_at ?? 0).toLocaleDateString(locale(),
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
function CheckInManagerScreen({ navigation }: ScreenProps) {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [data, setData]             = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [selectedEnroll, setSelectedEnroll] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get('/checkins/enrollments');
      setData(res.data || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast(t('x_check_in_manager_check_connection_pull_down'));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  // Refresh whenever the user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const deactivate = (id: number, name: string) => {
    confirm(t('x_check_in_manager_remove', { name }), t('x_check_in_manager_they_will_no_longer'),
      { confirmLabel: t('saved_remove'), destructive: true }).then(async ok => { if (!ok) return;
      await api.put(`/checkins/enrollments/${id}`, { active: false }).catch((e) => { __DEV__ && console.warn(e?.message); });
        load();
    })
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
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_check_in_manager_check_manager')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
            {t('x_check_in_manager_active_month', { length: active.length, value: data?.monthly_cost || '$0.00' })}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.enrollBtn}
          accessibilityLabel={t('x_check_in_manager_enroll')} onPress={() => requireAuth(() => setShowEnroll(true))}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.enrollBtnText}>{t('x_check_in_manager_enroll')}</Text>
        </TouchableOpacity>
      </View>

      {/* How it works -- shown when empty */}
      {!loading && active.length === 0 && (
        <View style={styles.howItWorks}>
          <Text maxFontSizeMultiplier={1.4} style={styles.howTitle}>{t('x_check_in_manager_digital_check_defendants')}</Text>
          {[
            t('x_check_in_manager_1_enroll_defendant_with'),
            t('x_check_in_manager_2_they_get_link'),
            t('x_check_in_manager_3_gps_timestamp_logged'),
            t('x_check_in_manager_4_see_compliance_history'),
            t('x_check_in_manager_5_9_99_month'),
          ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={styles.howItem}>{s}</Text>)}
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={styles.howBtn}
            accessibilityLabel={t('x_check_in_manager_enroll_first_defendant')} onPress={() => requireAuth(() => setShowEnroll(true))}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.howBtnText}>{t('x_check_in_manager_enroll_first_defendant')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.navy} size="large" />
      ) : (
        <FlashList
          data={[...active, ...inactive]}
          keyExtractor={(r) => String(r.id)}
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
                      <Text maxFontSizeMultiplier={1.4} style={styles.caseNum}>{t('x_check_in_manager_case', { case_number: item.case_number })}</Text>
                    )}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>

                <View style={styles.statsStrip}>
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatNum}>{item.total_checkins}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>{t('qc_total')}</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.miniStatNum, item.checkins_today > 0 && { color: COLORS.legal }]}>
                      {item.checkins_today > 0 ? '✓' : '--'}
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>{t('x_attorney_inbox_today')}</Text>
                  </View>
                  {!!item.court_date && (
                    <View style={styles.miniStat}>
                      <Text maxFontSizeMultiplier={1.4} style={[styles.miniStatNum, { fontSize: 12 }]}>
                        {Math.max(0, daysUntil(item.court_date) ?? 0)}d
                      </Text>
                      <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>{t('x_check_in_manager_court')}</Text>
                    </View>
                  )}
                  <View style={styles.miniStat}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatNum}>${(item.monthly_fee_cents / 100).toFixed(2)}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.miniStatLabel}>{t('x_check_in_manager_mo')}</Text>
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                    style={styles.actionBtn}
                    accessibilityLabel={t('x_check_in_manager_view_history')} onPress={() => setSelectedEnroll(item)}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_check_in_manager_view_history')}</Text>
                  </TouchableOpacity>
                  {item.active && (
                    <TouchableOpacity
                      accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                      style={[styles.actionBtn, styles.actionBtnRed]}
                      accessibilityLabel={t('saved_remove')} onPress={() => deactivate(item.id, item.defendant_name)}
                    >
                      <Text maxFontSizeMultiplier={1.4} style={[styles.actionBtnText, { color: COLORS.emergency }]}>{t('saved_remove')}</Text>
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
  subheading: { fontSize: 12, color: colors.textOnNavy, marginTop: 2 },
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
  feeBreakdown: { backgroundColor: colors.legalBg, borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.legal },
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
export default React.memo(CheckInManagerScreen);