import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
/**
 * BookingScreen -- Lawyer video consultation booking
 * 3-step booking flow: duration → date/time → confirm
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform} from 'react-native';
import { api } from '../services/api';
import { t }   from '../i18n';
import { useAuthGate } from '../components/AuthGate';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

declare var setError: any;
const DURATIONS = [
  { min: 15, label: '15 min',  sub: 'Quick intro',      fee: '$9.99',  cents: 999,  emoji: '⚡' },
  { min: 30, label: '30 min',  sub: 'Standard consult', fee: '$14.99', cents: 1499, emoji: '⚖️', popular: true },
  { min: 60, label: '60 min',  sub: 'Deep dive',        fee: '$24.99', cents: 2499, emoji: '🔍' },
];

const TIMES = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
               '1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM'];

type Step = 'duration' | 'datetime' | 'confirm' | 'confirmed' | 'callback_sent';

function buildDays(): { date: string; label: string; times: { time: string; available: boolean }[] }[] {
  const days = [];
  const d = new Date();
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0) continue; // skip Sundays
    days.push({
      date:  d.toISOString().split('T')[0],
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      times: TIMES.map((t, ti) => {
        // Deterministic availability based on date + time index
        // Avoids slots changing every render -- consistent UX
        const seed = d.getDate() + d.getMonth() * 31 + ti * 7;
        return { time: t, available: (seed % 10) > 2 };
      }),
    });
    if (days.length >= 7) break;
  }
  return days;
}

export default function BookingScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);

  // Load attorney's weekly availability so users know best times to expect responses
  const { lawyerName, lawyerPhone, lawyerId } = (route?.params as any) ?? {};
  React.useEffect(() => {
    if (!lawyerId) return;
    api.get('/attorney/profile/availability', { params: { lawyerId } })
      .then(r => setLawyerAvail(r.data || []))
      .catch(() => {});
  }, [lawyerId]);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [step, setStep]           = useState<Step>('duration');
  const [duration, setDuration]   = useState(DURATIONS[1]);
  const [days, setDays]            = useState(buildDays);

  // Refresh slots from server when lawyerId is known
  useEffect(() => {
    if (!lawyerId) return;
    api.get(`/consultations/slots/${lawyerId}`)
      .then(r => {
        const serverSlots = r.data?.slots;
        if (serverSlots?.length) setDays(serverSlots);
      })
      .catch((e) => { __DEV__ && console.warn(e?.message); }); // keep random fallback on failure
  }, [lawyerId]);
  const [selDay, setSelDay]       = useState(days[0]);
  const [selTime, setSelTime]     = useState('');
  const [notes, setNotes]         = useState('');
  const [booking, setBooking]     = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);
  const [callbackPhone, setCallbackPhone] = useState('');
  const [sendingCallback, setSendingCallback] = useState(false);
  const [lawyerAvail, setLawyerAvail] = React.useState<{
    schedule: Record<string,string[]>; note: string;
  } | null>(null);

  // Auth check at mount
  useEffect(() => {
    requireAuth(() => {});
  }, []);

  const availTimes = selDay?.times.filter(t => t.available) ?? [];
  const noSlots    = availTimes.length === 0;

  const confirmBooking = () => requireAuth(async () => {
    if (!selTime) { setError('Select a time slot to continue.'); return; }
    setBooking(true);
    try {
      const res = await api.post('/consultations/book', {
        lawyer_id:    lawyerId ?? null,
        duration_min: duration.min,
        fee_cents:    duration.cents,
        date_slot:    selDay.date,
        time_slot:    selTime,
        notes:        notes.trim(),
      });
      setConfirmed(res.data || null);
      setStep('confirmed');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Could not complete booking. Please try again.';
      Alert.alert('Booking issue', msg);
    } finally {
      setBooking(false);
    }
  });

  const sendCallback = async () => {
    if (!callbackPhone.trim()) { setError('Enter your phone number so the attorney can reach you.'); return; }
    setSendingCallback(true);
    try {
      await api.post('/consultations/callback-request', {
        lawyer_id: lawyerId ?? null,
        phone: callbackPhone.trim(),
        notes: notes.trim(),
        duration_min: duration.min,
      }).catch((e) => { __DEV__ && console.warn(e?.message); }); // graceful
      setStep('callback_sent');
    } finally {
      setSendingCallback(false);
    }
  };

  // ── Confirmed ────────────────────────────────────────────────────────────
  if (step === 'confirmed') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.confirmedWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmedEmoji}>✅</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.confirmedTitle, { color: colors.textPrimary }]}>Consultation booked!</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.confirmedSub, { color: colors.textSecond }]}>
          {selDay.label} at {selTime} · {duration.label}
          {'\n'}{lawyerName || 'Your lawyer'} will confirm shortly.
        </Text>
        <View style={[styles.receiptCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.receiptRow, { color: colors.textSecond }]}>Duration   <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{duration.label}</Text></Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.receiptRow, { color: colors.textSecond }]}>Platform fee  <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{duration.fee}</Text></Text>
        </View>
        <TouchableOpacity style={[styles.doneBtn, { backgroundColor: COLORS.navy }]}
          onPress={(handleBack as any)}
            accessibilityRole="button"
          >
          <Text maxFontSizeMultiplier={1.4} style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Callback sent ─────────────────────────────────────────────────────────
  if (step === 'callback_sent') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.confirmedWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmedEmoji}>📞</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.confirmedTitle, { color: colors.textPrimary }]}>Callback requested</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.confirmedSub, { color: colors.textSecond }]}>
          {lawyerName || 'The attorney'} will call you at {callbackPhone} to schedule a time.
        </Text>
        <TouchableOpacity style={[styles.doneBtn, { backgroundColor: COLORS.navy }]}
          onPress={(handleBack as any)}
            accessibilityRole="button"
          >
          <Text maxFontSizeMultiplier={1.4} style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );


  // ── Memoised handlers — prevents child re-render on every keystroke/state update ──
  var handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else (navigation as any).navigate('HomeTab');
  }, [navigation]);

  const handleConfirmStep = useCallback(() => {
    if (selTime) setStep('confirm');
  }, [selTime]);

  const handleDatetimeStep = useCallback(() => setStep('datetime'), []);

  return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <AuthGateModal />

      {/* Progress dots */}
      <View style={styles.progress}>
        {(['duration','datetime','confirm'] as Step[]).map((s, i) => (
          <View key={s} style={[styles.dot,
            { backgroundColor: ['duration','datetime','confirm'].indexOf(step) >= i
                ? COLORS.navy : colors.border }]} />
        ))}
      </View>

      {/* ── Step 1: Duration ──────────────────────────────────────────────── */}
      {step === 'duration' && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>How long do you need?</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
            Consulting with {lawyerName || 'your lawyer'}. Platform fee is separate from attorney fees.
          </Text>
          {DURATIONS.map(d => (
            <TouchableOpacity key={d.min}
              style={[styles.durationCard, { backgroundColor: colors.bgCard, borderColor: colors.border },
                duration.min === d.min && { borderColor: COLORS.navy, borderWidth: 2 }]}
              onPress={() => setDuration(d)}
            accessibilityRole="button"
              accessibilityLabel={`${d.label} -- ${d.fee} platform fee`}>
              <Text maxFontSizeMultiplier={1.4} style={styles.durEmoji}>{d.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.durLabel, { color: colors.textPrimary }]}>{d.label}</Text>
                  {d.popular && (
                    <View style={styles.popularBadge}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.popularText}>Most popular</Text>
                    </View>
                  )}
                </View>
                <Text maxFontSizeMultiplier={1.4} style={[styles.durSub, { color: colors.textMuted }]}>{d.sub}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.durFee, { color: COLORS.navy }]}>{d.fee}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.nextBtn, { backgroundColor: COLORS.navy }]}
            accessibilityRole="button"
            onPress={handleDatetimeStep}>
            <Text maxFontSizeMultiplier={1.4} style={styles.nextBtnText}>Next →</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── Step 2: Date + Time on ONE screen ────────────────────────────── */}
      {step === 'datetime' && (
        <>
          <TouchableOpacity onPress={() => setStep('duration')} style={styles.back}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>← Back</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>Pick a date and time</Text>

          {/* Day picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.dayScroll} contentContainerStyle={{ gap: 8 }}>
            {days.map(day => (
              <TouchableOpacity key={day.date}
                accessibilityRole="button"
                style={[styles.dayChip, { borderColor: colors.border, backgroundColor: colors.bgCard },
                  selDay?.date === day.date && { borderColor: COLORS.navy, backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle }]}
                onPress={() => { setSelDay(day); setSelTime(''); }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.dayChipText,
                  { color: selDay?.date === day.date ? COLORS.navy : colors.textSecond }]}>
                  {day.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Time slots or no-slots CTA */}
          {noSlots ? (
            <View style={[styles.noSlotsCard, { backgroundColor: isDark ? colors.bgCard : colors.bg, borderColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.noSlotsEmoji}>📅</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.noSlotsTitle, { color: colors.textPrimary }]}>No open slots this day</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.noSlotsSub, { color: colors.textMuted }]}>
                Request a callback -- {lawyerName || 'the attorney'} will call you to schedule.
              </Text>
              <TextInput
                style={[styles.callbackInput, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                {...{placeholder: t("booking_phone_placeholder")}}
                placeholderTextColor={COLORS.textSecond}
                keyboardType="phone-pad"
                value={callbackPhone}
                onChangeText={setCallbackPhone}
                accessibilityLabel="Your phone number for callback"
          returnKeyType="next"
          blurOnSubmit
        />
              <TouchableOpacity activeOpacity={0.6}
                accessibilityRole="button"
                style={[styles.callbackBtn, { backgroundColor: COLORS.legal }]}
                onPress={sendCallback} disabled={sendingCallback}>
                {sendingCallback
                  ? <ActivityIndicator color={colors.bgCard} />
                  : <Text maxFontSizeMultiplier={1.4} style={styles.callbackBtnText}>Request Callback →</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.4} style={[styles.timesLabel, { color: colors.textMuted }]}>Available times</Text>
              <View style={styles.timesGrid}>
                {availTimes.map(t => (
                  <TouchableOpacity key={t.time}
                    accessibilityRole="button"
                    style={[styles.timeChip, { borderColor: colors.border, backgroundColor: colors.bgCard },
                      selTime === t.time && { borderColor: COLORS.navy, backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle }]}
                    onPress={() => setSelTime(t.time)}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.timeChipText,
                      { color: selTime === t.time ? COLORS.navy : colors.textSecond }]}>
                      {t.time}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.nextBtn, { backgroundColor: COLORS.navy }, !selTime && styles.nextBtnDisabled]}
                onPress={handleConfirmStep}
                disabled={!selTime}>
                <Text maxFontSizeMultiplier={1.4} style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {/* ── Step 3: Notes + Confirm ───────────────────────────────────────── */}
      {step === 'confirm' && (
        <>
          <TouchableOpacity onPress={() => setStep('datetime')} style={styles.back}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>← Back</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>Confirm booking</Text>

          <View style={[styles.summaryCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.summaryLine, { color: colors.textPrimary }]}>
              {lawyerName || 'Your lawyer'}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.summaryLine, { color: colors.textSecond }]}>
              {selDay.label} · {selTime} · {duration.label}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.summaryFee, { color: COLORS.navy }]}>
              Platform fee: {duration.fee}
            </Text>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.timesLabel, { color: colors.textMuted }]}>
            Add notes for the attorney (optional)
          </Text>
          <TextInput
            style={[styles.notesInput, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
            multiline numberOfLines={4} maxLength={2000}
            placeholder="e.g. I have a DUI from last week, first offense..."
            placeholderTextColor={COLORS.textSecond}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
            accessibilityLabel="Notes for your attorney"
          />

          <TouchableOpacity activeOpacity={0.6}
            accessibilityRole="button"
            style={[styles.confirmBtn, { backgroundColor: COLORS.navy }, booking && { opacity: 0.6 }]}
            onPress={confirmBooking} disabled={booking}>
            {booking
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.confirmBtnText}>Confirm & Pay {duration.fee} →</Text>}
          </TouchableOpacity>

          <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
            Platform fee only. Attorney rates are set separately. Cancel 24h before for a full refund.
          </Text>
        </>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
      </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },

  progress: { flexDirection: 'row', gap: 8, marginBottom: 20, justifyContent: 'center' },
  dot: { width: 24, height: 4, borderRadius: 2 },

  back:     { marginBottom: 8 },
  backText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  stepTitle:{ fontSize: 22, ...FONTS.black, marginBottom: 6 },
  stepSub:  { fontSize: 12, lineHeight: 19, marginBottom: 20 },

  // Duration
  durationCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 10, ...SHADOW.sm },
  durEmoji: { fontSize: 28 },
  durLabel: { fontSize: 16, lineHeight: 24, ...FONTS.heavy },
  durSub:   { fontSize: 12, marginTop: 2 },
  durFee:   { fontSize: 18, ...FONTS.black },
  popularBadge: { backgroundColor: COLORS.legalBg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  popularText:  { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.legal },

  // Day/time
  dayScroll: { marginBottom: 16 },
  dayChip:   { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1.5 },
  dayChipText:{ fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  timesLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  timesGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  timeChip:   { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1.5 },
  timeChipText:{ fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  // No slots
  noSlotsCard:  { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, alignItems: 'center', marginBottom: 16, ...SHADOW.sm },
  noSlotsEmoji: { fontSize: 36, marginBottom: 8 },
  noSlotsTitle: { fontSize: 16, lineHeight: 24, ...FONTS.black, marginBottom: 6 },
  noSlotsSub:   { fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 14 },
  callbackInput:{ width: '100%', borderWidth: 1.5, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  callbackBtn:  { width: '100%', borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center' },
  callbackBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },

  // Confirm
  summaryCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 16, ...SHADOW.sm },
  summaryLine: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, marginBottom: 3 },
  summaryFee:  { fontSize: 18, ...FONTS.black, marginTop: 6 },
  notesInput:  { borderWidth: 1.5, borderRadius: RADIUS.lg, padding: 16, fontSize: 14, minHeight: 100, marginBottom: 14, lineHeight: 21 },
  confirmBtn:         { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md, marginBottom: 10 },
  confirmBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },
  disclaimer:         { fontSize: 11, textAlign: 'center', lineHeight: 17 },

  nextBtn:         { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginTop: 6, ...SHADOW.sm },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnText:     { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },

  // Confirmed / callback
  confirmedWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  confirmedEmoji: { fontSize: 54, marginBottom: 14 },
  confirmedTitle: { fontSize: 22, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  confirmedSub:   { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  receiptCard:    { width: '100%', borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 20 },
  receiptRow:     { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  doneBtn:        { borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', ...SHADOW.sm },
  doneBtnText:    { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);