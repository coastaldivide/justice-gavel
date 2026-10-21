/**
 * BookingScreen — book a consultation with a lawyer who is on Justice Gavel.
 * duration → date/time → confirm & pay → confirmed.
 *
 * Prices, slots and the refund window come from the server
 * (GET /consultations/slots/:lawyerId): what is shown is what is charged.
 * Slots are offered on the lawyer's clock; each carries its exact instant
 * (`starts_at`), and the app shows it in the phone's own time zone (with the
 * zone named, plus the lawyer's time when the zones differ).
 *
 * Payment: POST /consultations/book → payment sheet → POST /:id/confirm. Without
 * Stripe keys the server answers 503 and the app says payments are not
 * available yet. Lawyers who are not on the app cannot be booked: the screen
 * says so and offers their phone number.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { ContactActions } from '../components/ContactActions';
import { useAuthGate } from '../components/AuthGate';
import { api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import { t, useLang, locale } from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { track } from '../services/analytics';
import { usePaymentSheet } from '../payments';
import { buildEventIcs, saveIcs } from '../utils/icsExport';
import { getToken } from '../utils/secureStorage';
import type { ScreenProps } from '../types/navigation';

type Price = { duration_min: number; fee_cents: number; fee_display: string };
type SlotTime = { time: string; starts_at: string; available: boolean };
type SlotDay = { date: string; times: SlotTime[] };
type SlotsResponse = {
  lawyer_id: number; lawyer_name: string; lawyer_phone: string | null; bookable: boolean; message?: string;
  time_zone: string; slots: SlotDay[]; prices: Price[]; refund_cutoff_hours: number;
};
type Booking = { id: number; starts_at: string; time_zone: string; duration_min: number; fee_display?: string | null; lawyer_name: string };
type Step = 'duration' | 'datetime' | 'confirm' | 'confirmed' | 'callback_sent';

const DURATION_TEXT: Record<number, [string, string, string]> = {
  15: ['x_booking_15_min', 'x_booking_quick_intro', '⚡'],
  30: ['x_booking_30_min', 'x_booking_standard_consult', '⚖️'],
  60: ['x_booking_60_min', 'x_booking_deep_dive', '🔍'],
};

/** The phone's own zone (e.g. America/Chicago). */
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const timeIn = (iso: string, timeZone?: string) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) });
const dayIn = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) });
const longDayIn = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', ...(timeZone ? { timeZone } : {}) });
/** "Central Daylight Time" / "hora de verano central" — the phone's zone, named in the app's language. */
const zoneName = () => {
  try { return new Intl.DateTimeFormat(locale(), { timeZoneName: 'long' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || deviceZone(); }
  catch { return deviceZone(); }
};
/** Same wall clock in both zones at this instant? */
const sameClock = (iso: string, a: string, b: string) => timeIn(iso, a).replace(/\s?\S+$/, '') === timeIn(iso, b).replace(/\s?\S+$/, '') && dayIn(iso, a) === dayIn(iso, b);

function BookingScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors, isDark } = useTheme();
  const { showToast } = useToast();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const params = (route?.params ?? {}) as { lawyerId?: number | string; lawyerName?: string };
  const lawyerId = Number(params.lawyerId);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [info, setInfo] = useState<SlotsResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [step, setStep] = useState<Step>('duration');
  const [duration, setDuration] = useState(30);
  const [selDate, setSelDate] = useState('');
  const [selSlot, setSelSlot] = useState<SlotTime | null>(null);
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<Booking | null>(null);
  const [callbackContact, setCallbackContact] = useState('');
  const [sendingCallback, setSendingCallback] = useState(false);
  const zone = deviceZone();

  const load = useCallback(async () => {
    if (!Number.isFinite(lawyerId) || lawyerId <= 0) { setLoadError(t('bk_no_lawyer')); setLoading(false); return; }
    try {
      const r = await api.get<SlotsResponse>(`/consultations/slots/${lawyerId}`);
      if (!mountedRef.current) return;
      setInfo(r.data);
      setLoadError('');
      setSelDate(d => d || r.data.slots.find(x => x.times.some(tm => tm.available))?.date || r.data.slots[0]?.date || '');
    } catch (e) {
      if (mountedRef.current) setLoadError(apiErrorMessage(e, t('x_booking_could_not_complete_booking')));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [lawyerId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Guests have no case to prefill from (and would only get a 401).
    getToken().then(tok => (tok ? api.get('/consultations/prefill') : null))
      .then(r => { if (r && mountedRef.current && r.data?.suggested_notes) setNotes(n => n || String(r.data.suggested_notes)); }).catch(() => {});
  }, []);

  const price = useMemo(() => info?.prices.find(p => p.duration_min === duration) || null, [info, duration]);
  const day = info?.slots.find(d => d.date === selDate) || null;
  const availTimes = day?.times.filter(tm => tm.available) ?? [];
  const lawyerName = info?.lawyer_name || params.lawyerName || t('x_booking_lawyer');

  const confirmBooking = () => requireAuth(async () => {
    if (!selSlot || !day || !price) { showToast(t('x_booking_select_time_slot_continue'), 'warning'); return; }
    setBooking(true);
    try {
      const res = await api.post('/consultations/book', {
        lawyer_id: lawyerId, duration_min: duration, date_slot: day.date, time_slot: selSlot.time, notes: notes.trim(),
      });
      const { client_secret, booking: b } = res.data || {};
      if (!client_secret || !b?.id) throw new Error(t('x_booking_payment_setup_failed_please'));
      const { error: initError } = await initPaymentSheet({ paymentIntentClientSecret: client_secret, merchantDisplayName: 'Justice Gavel', allowsDelayedPaymentMethods: false });
      if (initError) { showToast(initError.message || t('x_booking_payment_setup_failed_please'), 'error'); return; }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') showToast(presentError.message || t('x_booking_payment_failed_please_try'), 'error');
        return;
      }
      const conf = await api.post(`/consultations/${b.id}/confirm`, {});
      setConfirmed(conf.data?.booking || b);
      setStep('confirmed');
      track('consultation_booked', { lawyerId, slot: selSlot.starts_at }).catch(() => {});
    } catch (e) {
      showToast(isPaymentsUnavailable(e) ? t('bk_payments_unavailable') : apiErrorMessage(e, t('x_booking_could_not_complete_booking')), isPaymentsUnavailable(e) ? 'info' : 'error');
      if ((e as { response?: { data?: { code?: string } } })?.response?.data?.code === 'slot_taken') { setSelSlot(null); setStep('datetime'); load(); }
    } finally {
      if (mountedRef.current) setBooking(false);
    }
  });

  const sendCallback = () => requireAuth(async () => {
    if (!callbackContact.trim()) { showToast(t('x_booking_enter_phone_number_so'), 'warning'); return; }
    setSendingCallback(true);
    try {
      await api.post('/consultations/callback-request', { lawyer_id: lawyerId, phone: callbackContact.trim(), notes: notes.trim(), duration_min: duration });
      setStep('callback_sent');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_booking_could_not_complete_booking')), 'error');
    } finally {
      if (mountedRef.current) setSendingCallback(false);
    }
  });

  const addToCalendar = async () => {
    if (!confirmed) return;
    try {
      const text = buildEventIcs({ uid: `consult-${confirmed.id}@justicegavel.app`, start: new Date(confirmed.starts_at), minutes: confirmed.duration_min, title: t('bk_calendar_title', { name: lawyerName }) });
      const how = await saveIcs(text, `consultation-${confirmed.id}.ics`);
      if (how === 'download') showToast(t('bk_calendar_downloaded'), 'success');
    } catch { showToast(t('action_failed'), 'error'); }
  };

  const goBack = () => { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('HomeTab'); };
  const s = makeStyles();

  if (loading) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.navy} size="large" /></View>;
  if (loadError || !info) return (
    <View style={[s.center, { backgroundColor: colors.bg, padding: 32 }]} testID="booking-error">
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', fontSize: 15 }}>{loadError || t('x_booking_could_not_complete_booking')}</Text>
      <TouchableOpacity accessibilityRole="button" style={[s.nextBtn, { paddingHorizontal: 24 }]} onPress={() => { setLoading(true); load(); }}>
        <Text maxFontSizeMultiplier={1.4} style={s.nextBtnText}>{t('try_again')}</Text>
      </TouchableOpacity>
    </View>
  );

  if (!info.bookable) return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.scroll} testID="booking-not-on-app">
      <Text maxFontSizeMultiplier={1.4} style={[s.stepTitle, { color: colors.textPrimary }]}>{lawyerName}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[s.stepSub, { color: colors.textSecond }]}>{info.message || t('consult_not_on_app')}</Text>
      <ContactActions listing={{ name: info.lawyer_name, phone: info.lawyer_phone }} />
    </ScrollView>
  );

  if (step === 'confirmed' && confirmed) return (
    <View style={[s.center, { backgroundColor: colors.bg, padding: 28 }]} testID="booking-confirmed">
      <AppIcon name="checkmark-circle" size={44} color={colors.legal} />
      <Text maxFontSizeMultiplier={1.4} style={[s.confirmedTitle, { color: colors.textPrimary }]}>{t('booking_confirmed_title')}</Text>
      <Text testID="booking-confirmed-when" maxFontSizeMultiplier={1.4} style={[s.confirmedSub, { color: colors.textSecond }]}>
        {longDayIn(confirmed.starts_at)} · {timeIn(confirmed.starts_at)}
      </Text>
      <View style={[s.receiptCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[s.receiptRow, { color: colors.textSecond }]}>{t('booking_duration')} <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{t(DURATION_TEXT[confirmed.duration_min]?.[0] || 'x_booking_30_min')}</Text></Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.receiptRow, { color: colors.textSecond }]}>{t('booking_platform_fee')} <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{confirmed.fee_display || price?.fee_display}</Text></Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.receiptRow, { color: colors.textSecond }]}>{t('x_booking_booking')}<Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{confirmed.id}</Text></Text>
      </View>
      <TouchableOpacity accessibilityRole="button" style={[s.doneBtn, { backgroundColor: colors.legalDark, marginBottom: 10 }]} onPress={addToCalendar}>
        <IconLabel icon={ICONS.calendar} textStyle={s.doneBtnText} maxFontSizeMultiplier={1.4}>{t('x_booking_add_calendar')}</IconLabel>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={[s.doneBtn, { backgroundColor: COLORS.navy }]} onPress={goBack}>
        <Text maxFontSizeMultiplier={1.4} style={s.doneBtnText}>{t('booking_done')}</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === 'callback_sent') return (
    <View style={[s.center, { backgroundColor: colors.bg, padding: 28 }]} testID="booking-callback-sent">
      <AppIcon name="call-outline" size={40} color={colors.legal} />
      <Text maxFontSizeMultiplier={1.4} style={[s.confirmedTitle, { color: colors.textPrimary }]}>{t('booking_callback_sent_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[s.confirmedSub, { color: colors.textSecond }]}>{t('x_booking_will_call_at_schedule', { value: lawyerName, callbackPhone: callbackContact })}</Text>
      <TouchableOpacity accessibilityRole="button" style={[s.doneBtn, { backgroundColor: COLORS.navy }]} onPress={goBack}>
        <Text maxFontSizeMultiplier={1.4} style={s.doneBtnText}>{t('booking_done')}</Text>
      </TouchableOpacity>
    </View>
  );

  const zoneNote = selSlot && !sameClock(selSlot.starts_at, zone, info.time_zone)
    ? t('bk_lawyer_time', { time: timeIn(selSlot.starts_at, info.time_zone) }) : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView testID="booking-screen" style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.navy} />}>
        <AuthGateModal />
        <View style={s.progress}>
          {(['duration', 'datetime', 'confirm'] as Step[]).map((st, i) => (
            <View key={st} style={[s.dot, { backgroundColor: ['duration', 'datetime', 'confirm'].indexOf(step) >= i ? colors.navy : colors.border }]} />
          ))}
        </View>

        {step === 'duration' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={[s.stepTitle, { color: colors.textPrimary }]}>{t('x_booking_how_long_do_need')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.stepSub, { color: colors.textMuted }]}>{t('x_booking_consulting_with_platform_fee', { value: lawyerName })}</Text>
            {info.prices.map(p => {
              const [labelKey, subKey, emoji] = DURATION_TEXT[p.duration_min] || ['x_booking_30_min', 'x_booking_standard_consult', '⚖️'];
              const on = duration === p.duration_min;
              return (
                <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: on }} key={p.duration_min} testID={`booking-duration-${p.duration_min}`}
                  style={[s.durationCard, { backgroundColor: colors.bgCard, borderColor: on ? colors.navy : colors.border, borderWidth: on ? 2 : 1 }]}
                  onPress={() => setDuration(p.duration_min)} accessibilityLabel={t('x_booking_platform_fee', { label: t(labelKey), fee: p.fee_display })}>
                  <Text maxFontSizeMultiplier={1.4} style={s.durEmoji}>{emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.durLabel, { color: colors.textPrimary }]}>{t(labelKey)}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[s.durSub, { color: colors.textMuted }]}>{t(subKey)}</Text>
                  </View>
                  <Text testID={`booking-fee-${p.duration_min}`} maxFontSizeMultiplier={1.4} style={[s.durFee, { color: colors.textBrand }]}>{p.fee_display}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity accessibilityRole="button" style={s.nextBtn} onPress={() => setStep('datetime')} testID="booking-next">
              <Text maxFontSizeMultiplier={1.4} style={s.nextBtnText}>{t('whn_next')}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'datetime' && (
          <>
            <TouchableOpacity accessibilityRole="button" onPress={() => setStep('duration')} style={s.back}>
              <Text maxFontSizeMultiplier={1.4} style={[s.backText, { color: colors.textMuted }]}>{t('ja_back')}</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={[s.stepTitle, { color: colors.textPrimary }]}>{t('x_booking_pick_date_time')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.stepSub, { color: colors.textMuted }]}>{t('bk_times_in_zone', { zone: zoneName() })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
              {info.slots.map(d => (
                <TouchableOpacity accessibilityRole="button" key={d.date} testID={`booking-day-${d.date}`} accessibilityState={{ selected: selDate === d.date }}
                  style={[s.dayChip, { borderColor: selDate === d.date ? colors.navy : colors.border, backgroundColor: selDate === d.date ? (isDark ? colors.bgElevated : colors.bgSubtle) : colors.bgCard }]}
                  onPress={() => { setSelDate(d.date); setSelSlot(null); }}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.dayChipText, { color: selDate === d.date ? colors.textBrand : colors.textSecond }]}>{d.times[0] ? dayIn(d.times[0].starts_at) : d.date}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {availTimes.length === 0 ? (
              <View style={[s.noSlotsCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]} testID="booking-no-slots">
                <Text maxFontSizeMultiplier={1.4} style={[s.noSlotsTitle, { color: colors.textPrimary }]}>{t('x_booking_no_open_slots_this')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[s.noSlotsSub, { color: colors.textMuted }]}>{t('x_booking_request_callback_will_call', { value: lawyerName })}</Text>
                <TextInput style={[s.callbackInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                  placeholder={t('bk_contact_placeholder')} placeholderTextColor={colors.placeholder} keyboardType="email-address" autoCapitalize="none"
                  value={callbackContact} onChangeText={setCallbackContact} accessibilityLabel={t('x_booking_phone_number_callback')} maxLength={120} />
                <Text maxFontSizeMultiplier={1.4} style={[s.noSlotsSub, { color: colors.textMuted }]}>{t('bk_callback_privacy', { name: lawyerName })}</Text>
                <TouchableOpacity accessibilityRole="button" style={[s.callbackBtn, { backgroundColor: colors.legalDark }]} onPress={sendCallback} disabled={sendingCallback}>
                  {sendingCallback ? <ActivityIndicator color={COLORS.white} /> : <Text maxFontSizeMultiplier={1.4} style={s.callbackBtnText}>{t('x_booking_request_callback')}</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.4} style={[s.timesLabel, { color: colors.textMuted }]}>{t('x_booking_available_times')}</Text>
                <View testID="booking-datetime-step" style={s.timesGrid}>
                  {availTimes.map(tm => (
                    <TouchableOpacity accessibilityRole="radio" key={tm.starts_at} testID="booking-time" accessibilityState={{ selected: selSlot?.starts_at === tm.starts_at }}
                      style={[s.timeChip, { borderColor: selSlot?.starts_at === tm.starts_at ? colors.navy : colors.border, backgroundColor: selSlot?.starts_at === tm.starts_at ? (isDark ? colors.bgElevated : colors.bgSubtle) : colors.bgCard }]}
                      onPress={() => setSelSlot(tm)}>
                      <Text maxFontSizeMultiplier={1.4} style={[s.timeChipText, { color: selSlot?.starts_at === tm.starts_at ? colors.textBrand : colors.textSecond }]}>{timeIn(tm.starts_at)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!!zoneNote && <Text testID="booking-zone-note" maxFontSizeMultiplier={1.4} style={[s.stepSub, { color: colors.textMuted }]}>{zoneNote}</Text>}
                <TouchableOpacity accessibilityRole="button" style={[s.nextBtn, !selSlot && { opacity: 0.45 }]} testID="booking-confirm-button" onPress={() => selSlot && setStep('confirm')} disabled={!selSlot}>
                  <Text maxFontSizeMultiplier={1.4} style={s.nextBtnText}>{t('whn_next')}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {step === 'confirm' && selSlot && (
          <>
            <TouchableOpacity accessibilityRole="button" onPress={() => setStep('datetime')} style={s.back}>
              <Text maxFontSizeMultiplier={1.4} style={[s.backText, { color: colors.textMuted }]}>{t('ja_back')}</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={[s.stepTitle, { color: colors.textPrimary }]}>{t('x_booking_confirm_booking')}</Text>
            <View style={[s.summaryCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]} testID="booking-summary">
              <Text maxFontSizeMultiplier={1.4} style={[s.summaryLine, { color: colors.textPrimary }]}>{lawyerName}</Text>
              <Text testID="booking-summary-when" maxFontSizeMultiplier={1.4} style={[s.summaryLine, { color: colors.textSecond }]}>
                {longDayIn(selSlot.starts_at)} · {timeIn(selSlot.starts_at)} · {t(DURATION_TEXT[duration]?.[0] || 'x_booking_30_min')}
              </Text>
              {!!zoneNote && <Text maxFontSizeMultiplier={1.4} style={[s.stepSub, { color: colors.textMuted, marginBottom: 0 }]}>{zoneNote}</Text>}
              <Text testID="booking-summary-fee" maxFontSizeMultiplier={1.4} style={[s.summaryFee, { color: colors.textBrand }]}>{t('x_booking_platform_fee_2', { fee: price?.fee_display || '' })}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[s.timesLabel, { color: colors.textMuted }]}>{t('x_booking_add_notes_attorney_optional')}</Text>
            <TextInput style={[s.notesInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
              multiline numberOfLines={4} maxLength={2000} placeholder={t('x_booking_e_g_i_have')} placeholderTextColor={colors.placeholder}
              value={notes} onChangeText={setNotes} textAlignVertical="top" accessibilityLabel={t('x_booking_notes_attorney')} />
            <TouchableOpacity accessibilityRole="button" style={[s.confirmBtn, { backgroundColor: COLORS.navy }, booking && { opacity: 0.6 }]}
              testID="booking-confirm" onPress={confirmBooking} disabled={booking} accessibilityLabel={t('x_booking_confirm_pay_duration_fee', { fee: price?.fee_display || '' })}>
              {booking ? <ActivityIndicator color={COLORS.white} /> : <Text maxFontSizeMultiplier={1.4} style={s.confirmBtnText}>{t('x_booking_confirm_pay', { fee: price?.fee_display || '' })}</Text>}
            </TouchableOpacity>
            <Text testID="booking-refund-terms" maxFontSizeMultiplier={1.4} style={[s.disclaimer, { color: colors.textMuted }]}>{t('bk_fee_terms', { hours: info.refund_cutoff_hours })}</Text>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = () => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16 },
  progress: { flexDirection: 'row', gap: 8, marginBottom: 20, justifyContent: 'center' },
  dot: { width: 24, height: 4, borderRadius: 2 },
  back: { marginBottom: 8, paddingVertical: 6, alignSelf: 'flex-start' },
  backText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  stepTitle: { fontSize: 22, lineHeight: 28, ...FONTS.black, marginBottom: 6 },
  stepSub: { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  durationCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, padding: 16, marginBottom: 10, ...SHADOW.sm },
  durEmoji: { fontSize: 26 },
  durLabel: { fontSize: 16, lineHeight: 24, ...FONTS.heavy },
  durSub: { fontSize: 12, marginTop: 2 },
  durFee: { fontSize: 18, ...FONTS.black },
  dayChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1.5, minHeight: 44 },
  dayChipText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  timesLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  timesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  timeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1.5, minHeight: 44 },
  timeChipText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  noSlotsCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, alignItems: 'center', marginBottom: 16 },
  noSlotsTitle: { fontSize: 16, lineHeight: 24, ...FONTS.black, marginBottom: 6 },
  noSlotsSub: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  callbackInput: { width: '100%', borderWidth: 1.5, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  callbackBtn: { width: '100%', borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center' },
  callbackBtnText: { color: COLORS.white, fontSize: 14, lineHeight: 21, ...FONTS.black },
  summaryCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 16 },
  summaryLine: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, marginBottom: 3 },
  summaryFee: { fontSize: 18, ...FONTS.black, marginTop: 6 },
  notesInput: { borderWidth: 1.5, borderRadius: RADIUS.lg, padding: 14, fontSize: 14, minHeight: 100, marginBottom: 14, lineHeight: 21 },
  confirmBtn: { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', marginBottom: 10, minHeight: 52 },
  confirmBtnText: { color: COLORS.white, fontSize: 16, lineHeight: 24, ...FONTS.black },
  disclaimer: { fontSize: 11, textAlign: 'center', lineHeight: 17 },
  nextBtn: { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginTop: 6, minHeight: 50 },
  nextBtnText: { color: COLORS.white, fontSize: 15, lineHeight: 22, ...FONTS.black },
  confirmedTitle: { fontSize: 22, ...FONTS.black, textAlign: 'center', marginTop: 12, marginBottom: 8 },
  confirmedSub: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  receiptCard: { width: '100%', borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 20 },
  receiptRow: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  doneBtn: { borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', minWidth: 220 },
  doneBtnText: { color: COLORS.white, fontSize: 15, lineHeight: 22, ...FONTS.black },
});

export default React.memo(BookingScreen);
