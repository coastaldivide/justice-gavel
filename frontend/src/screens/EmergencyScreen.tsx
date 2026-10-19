import { useToast } from '../components/ToastProvider';
/**
 * EmergencyScreen -- SOS alert + quick actions + rights cards
 * Designed for panicked, possibly impaired users.
 * Large buttons. Plain language. Haptic feedback on every tap.
 */
import { hapticImpact, hapticNotification } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
} from 'react-native';
import { activeContacts, sendSos, reportSosResult } from '../services/sos';
import { useConfirm } from '../hooks/useConfirm';
import {  useTheme, COLORS } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';

type Phase = 'ready' | 'countdown' | 'sending' | 'done' | 'error';

const RIGHTS_CARDS = perLang(() => [
  { icon: '🤐', title: t('x_emergency_stay_silent'), body: t('x_emergency_say_i_am_invoking') },
  { icon: '⚖️', title: t('x_emergency_ask_lawyer'), body: t('x_emergency_say_i_want_lawyer') },
  { icon: '🚗', title: t('x_emergency_refuse_searches'), body: t('x_emergency_say_i_do_not') },
  { icon: '📞', title: t('x_emergency_phone_call'), body: t('x_emergency_have_right_call_call') },
]);

function EmergencyScreen({ navigation }: ScreenProps) {
  useLang();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
  return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200)
  }, []);

  const [phase, setPhase]       = useState<Phase>('ready');
  const [countdown, setCount]   = useState(5);
  const [result, setResult]     = useState('');
  const [contacts, setContacts] = useState<string[]>([]);
  const [sendingSOS, setSendingSOS] = useState(false);
  const timerRef = useRef<any>(null);

  // Reload on focus: coming back from "Add emergency contacts" must enable the alert.
  useEffect(() => {
    const load = () => { activeContacts().then(c => { if (mountedRef.current) setContacts(c); }).catch(() => {}); };
    load();
    const unsub = navigation?.addListener?.('focus', load);
    return () => { clearInterval(timerRef.current); if (typeof unsub === 'function') unsub(); };
  }, [navigation]);

  const startCountdown = () => {
    if (sendingSOS) return;
    hapticImpact();
    setPhase('countdown');
    setCount(5);
    let left = 5;
    timerRef.current = setInterval(() => {
      left -= 1;
      setCount(left);
      if (left <= 0) { clearInterval(timerRef.current); doSend(); }
    }, 1000);
  };

  const cancelCountdown = () => {
    clearInterval(timerRef.current);
    hapticNotification();
    setPhase('ready');
    setCount(5);
  };

  const doSend = async () => {
    setSendingSOS(true);
    setPhase('sending');
    try {
      const r = await sendSos(contacts);
      const line = await reportSosResult(r, confirm, showToast);
      if (!mountedRef.current) return;
      setResult(line);
      setPhase(r.total > 0 && r.sent === r.total ? 'done' : 'error');
    } finally {
      if (mountedRef.current) setSendingSOS(false);
    }
  };

  const reset = () => { setPhase('ready'); setCount(5); setResult(''); };

  const call = (num: string) => {
    hapticImpact();
    Linking.openURL(`tel:${num.replace(/\D/g, "")}`).catch(() =>
      showToast(t('cp_dial_manually', { num }), 'warning')
    );
  };

  return (
    <ScrollView
      testID="emergency-screen"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.scroll}
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── 911 / 988 strip -- always at very top ─── */}
      <View style={styles.emergencyStrip}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.stripBtn, { backgroundColor: colors.emergencyDark }]}
          accessibilityLabel={t('x_emergency_call_911')} onPress={() => call('911')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.stripBtnText}>{t('x_emergency_call_911_2')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.stripBtn, { backgroundColor: colors.blue }]}
          accessibilityLabel={t('x_emergency_crisis_988')} onPress={() => call('988')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.stripBtnText}>{t('x_emergency_crisis_988')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── SOS panel ────────────────────────────── */}
      <View style={[
        styles.sosPanel,
        { backgroundColor: phase === 'done' ? colors.legalDark : phase === 'error' ? colors.emergencyDark : colors.emergencyDark }
      ]}>
        {phase === 'ready' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>
              {t('x_emergency_trouble')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>
              {contacts.length > 0
                ? t('x_emergency_tap_below_alert_contact', { length: contacts.length })
                : t('x_emergency_no_contacts_saved_yet')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.sosBtn, contacts.length === 0 && { opacity: 0.5 }]}
              onPress={startCountdown}
              disabled={contacts.length === 0}
              activeOpacity={0.85}
              accessibilityLabel={t('x_emergency_send_emergency_alert_contacts')}
              accessibilityHint={t('x_emergency_starts_5_second_countdown')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.sosBtnText}>{t('x_emergency_send_emergency_alert')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.shareBtn}
              onPress={() => navigation.navigate('EmergencyShare')}
              activeOpacity={0.85}
              accessibilityLabel={t('x_emergency_share_location_with_bail')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>{t('x_emergency_share_location_find_help')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.addContactsBtn}
              onPress={() => navigation.navigate('Contacts')}
              activeOpacity={0.85}
              accessibilityLabel={t('x_emergency_manage_emergency_contacts')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.addContactsText}>
                {contacts.length > 0
                  ? t('x_emergency_contacts_saved_edit', { length: contacts.length })
                  : t('x_emergency_add_emergency_contacts')}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'countdown' && (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.countdownNum}>{countdown}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>{t('x_emergency_sending_s', { countdown })}</Text>
            <TouchableOpacity accessibilityRole="button"
              style={styles.cancelBtn}
              onPress={cancelCountdown}
              activeOpacity={0.85}
              accessibilityLabel={t('x_emergency_cancel_alert')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>{t('x_emergency_cancel')}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'sending' && (
          <>
            <ActivityIndicator color={colors.white} size="large" />
            <Text maxFontSizeMultiplier={1.4} style={[styles.panelTitle, { marginTop: 14 }]}>
              {t('x_emergency_sending_alert')}
            </Text>
          </>
        )}

        {phase === 'done' && (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.bigCheck}>✓</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>{t('x_emergency_alert_sent')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>{result}</Text>
            <TouchableOpacity
              accessibilityRole="button" style={styles.cancelBtn} onPress={reset} activeOpacity={0.85}
             accessibilityLabel={t('booking_done')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>{t('booking_done')}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'error' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>{t('x_emergency_could_not_send')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>{result}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={reset} activeOpacity={0.85}
             accessibilityLabel={t('try_again')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>{t('try_again')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Quick action grid ─────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textSecond }]}>
        {t('x_emergency_quick_actions')}
      </Text>
      <View style={styles.quickGrid}>
        {[
          { icon: '⚖️', label: t('x_emergency_find_lawyer'),    onPress: () => navigation.navigate('LawyersTab') },
          { icon: '🔓', label: t('x_emergency_bail_agent'),      onPress: () => navigation.navigate('BailTab') },
          { icon: '💬', label: t('x_emergency_ai_help'),         onPress: () => navigation.navigate('ChatTab') },
          { icon: '🏛️', label: t('x_emergency_court_locator'),  onPress: () => navigation.navigate('MoreTab', { screen: 'CourtLocator' }) },
          { icon: '📋', label: t('x_emergency_just_arrested'), onPress: () => navigation.navigate('MoreTab', { screen: 'JustArrested' }) },
          { icon: '🧠', label: t('x_emergency_crisis_help'),    onPress: () => navigation.navigate('MoreTab', { screen: 'CrisisResources' }) },
        ].map(item => (
          <TouchableOpacity accessibilityRole="button"
            key={item.label}
            style={[styles.quickBtn, { backgroundColor: colors.bgCard }]}
            onPress={item.onPress}
            activeOpacity={0.75}
            accessibilityLabel={item.label.replace('\n', ' ')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.quickIcon}>{item.icon}</Text>
            <Text maxFontSizeMultiplier={1.2} style={[styles.quickLabel, { color: colors.textPrimary }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Know your rights ─────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textSecond }]}>
        {t('x_emergency_know_rights_right_now')}
      </Text>
      {RIGHTS_CARDS().map(c => (
        <View key={c.title} style={[styles.rightsCard, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.rightsIcon}>{c.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.rightsTitle, { color: colors.textPrimary }]}>
              {c.title}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.rightsBody, { color: colors.textSecond }]}>
              {c.body}
            </Text>
          </View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = () => StyleSheet.create({
  scroll: { paddingBottom: 40 },

  emergencyStrip: {
    flexDirection: 'row', gap: 8, padding: 12, paddingTop: 16,
  },
  stripBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  stripBtnText: {
    color: COLORS.bgCard, fontSize: 16, fontWeight: '900', letterSpacing: 0.5,
  },

  sosPanel: {
    margin: 12, borderRadius: 20, padding: 24, alignItems: 'center', gap: 8,
  },
  panelTitle: {
    color: COLORS.bgCard, fontSize: 20, fontWeight: '900', textAlign: 'center',
  },
  panelSub: {
    color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center',
    lineHeight: 20, marginBottom: 8,
  },
  sosBtn: {
    backgroundColor: COLORS.bgCard, borderRadius: 14, paddingVertical: 18,
    paddingHorizontal: 32, marginTop: 4, width: '100%', alignItems: 'center',
  },
  sosBtnText: {
    color: COLORS.textSecond, fontSize: 18, fontWeight: '900',
  },
  shareBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12,
    paddingVertical: 14, width: '100%', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  shareBtnText: { color: COLORS.bgCard, fontWeight: '700', fontSize: 13 },
  addContactsBtn: { paddingVertical: 8 },
  addContactsText: {
    color: 'rgba(255,255,255,0.75)', fontSize: 12,
    fontWeight: '600', textDecorationLine: 'underline',
  },
  countdownNum: {
    fontSize: 80, fontWeight: '900', color: COLORS.bgCard, lineHeight: 88,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 32, marginTop: 8,
  },
  cancelBtnText: { color: COLORS.bgCard, fontWeight: '800', fontSize: 16 },
  bigCheck: { fontSize: 60, color: COLORS.bgCard },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
    marginHorizontal: 16, marginTop: 8, marginBottom: 10,
  },

  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 12, marginBottom: 16,
  },
  quickBtn: {
    width: '30.5%', borderRadius: 14, padding: 14, alignItems: 'center',
    elevation: 1, minHeight: 80, justifyContent: 'center',
  },
  quickIcon: { fontSize: 24, marginBottom: 6 },
  quickLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 15 },

  rightsCard: {
    flexDirection: 'row', gap: 12, padding: 16,
    marginHorizontal: 12, marginBottom: 10, borderRadius: 14,
    elevation: 1,
  },
  rightsIcon: { fontSize: 22, marginTop: 2 },
  rightsTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  rightsBody: { fontSize: 12, lineHeight: 18 },
});

// Module-level fallback for helper components
export default React.memo(EmergencyScreen);