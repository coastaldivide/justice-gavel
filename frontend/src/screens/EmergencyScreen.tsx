/**
 * EmergencyScreen -- SOS alert + quick actions + rights cards
 * Designed for panicked, possibly impaired users.
 * Large buttons. Plain language. Haptic feedback on every tap.
 */
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Linking, Alert, ActivityIndicator, RefreshControl} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocation } from '../services/location';
import { getContacts } from '../services/storage';
import { api } from '../services/api';
import { t } from '../i18n';
import {  useTheme, COLORS } from '../constants/theme';

type Phase = 'ready' | 'countdown' | 'sending' | 'done' | 'error';

const RIGHTS_CARDS = [
  { icon: '🤐', title: 'Stay silent', body: 'Say: "I am invoking my right to remain silent." Then stop talking.' },
  { icon: '⚖️', title: 'Ask for a lawyer', body: 'Say: "I want a lawyer." They must stop questioning you. Wait for your attorney.' },
  { icon: '🚗', title: 'Refuse searches', body: 'Say: "I do not consent to a search." Do not resist physically -- fight it in court.' },
  { icon: '📞', title: 'Your phone call', body: 'You have the right to a call. Call family or a lawyer. Do not discuss your case on the call.' },
];

export default function EmergencyScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
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

  useEffect(() => {
    getContacts().then(c => setContacts((c as string[]).filter(Boolean))).catch(() => {});
    return () => clearInterval(timerRef.current);
  }, []);

  const startCountdown = () => {
    if (sendingSOS) return;
    hapticImpact();
    setPhase('countdown');
    setCount(5);
    timerRef.current = setInterval(() => {
      setCount(n => {
        if (n <= 1) { clearInterval(timerRef.current); doSend(); return 0; }
        return n - 1;
      });
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
      const { lat, lng } = await getLocation();
      const userData = await AsyncStorage.getItem('user');
      const user = userData ? JSON.parse(userData) : {};
      const active = contacts.filter(Boolean);
      if (active.length === 0) {
        setResult('No emergency contacts saved yet.\nAdd contacts in the Emergency Contacts screen.');
        setPhase('error');
        setSendingSOS(false);
        return;
      }
      const res = await api.post('/alerts', {
        userName: user.displayName || user.name || 'User',
        contacts: active, lat, lng,
      });
      setResult(`✓ Alert sent to ${res.data?.results?.length ?? active.length} contact(s).`);
      setPhase('done');
    } catch {
      setResult('Could not send alert. Check your connection and try again.');
      setPhase('error');
    } finally {
      setSendingSOS(false);
    }
  };

  const reset = () => { setPhase('ready'); setCount(5); setResult(''); };

  const call = (num: string) => {
    hapticImpact();
    Linking.openURL(`tel:${num.replace(/\D/g, "")}`).catch(() =>
      Alert.alert('Cannot call', `Please dial ${num} manually.`)
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
          style={[styles.stripBtn, { backgroundColor: colors.emergencyDark }]}
          onPress={() => call('911')}
          accessibilityRole="button"
          accessibilityLabel="Call 911 emergency services"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.stripBtnText}>🚨  CALL 911</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stripBtn, { backgroundColor: colors.blue }]}
          accessibilityRole="button"
          onPress={() => call('988')}
          accessibilityLabel="Call 988 crisis line"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.stripBtnText}>💙  CRISIS 988</Text>
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
              Are you in trouble?
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>
              {contacts.length > 0
                ? `Tap below to alert ${contacts.length} contact(s) with your GPS location.`
                : '⚠️ No contacts saved yet.\nAdd them in Emergency Contacts first.'}
            </Text>
            <TouchableOpacity
              style={[styles.sosBtn, contacts.length === 0 && { opacity: 0.5 }]}
              onPress={startCountdown}
              disabled={contacts.length === 0}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Send emergency alert to your contacts"
              accessibilityHint="Starts a 5 second countdown then sends your location"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.sosBtnText}>🚨  Send Emergency Alert</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => navigation.navigate('EmergencyShare')}
            accessibilityRole="button"
              activeOpacity={0.85}
              accessibilityLabel="Share location with bail agent and lawyer"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>📤  Share Location + Find Help →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addContactsBtn}
              onPress={() => navigation.navigate('Contacts')}
            accessibilityRole="button"
              activeOpacity={0.85}
              accessibilityLabel="Manage emergency contacts"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.addContactsText}>
                {contacts.length > 0
                  ? `✓ ${contacts.length} contacts saved  ›  Edit`
                  : '+ Add emergency contacts'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'countdown' && (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.countdownNum}>{countdown}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>Sending in {countdown}s…</Text>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={cancelCountdown}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Cancel alert"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>✕  Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'sending' && (
          <>
            <ActivityIndicator color="#fff" size="large" />
            <Text maxFontSizeMultiplier={1.4} style={[styles.panelTitle, { marginTop: 14 }]}>
              Sending alert…
            </Text>
          </>
        )}

        {phase === 'done' && (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.bigCheck}>✓</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>Alert sent!</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>{result}</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={reset} activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'error' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelTitle}>Could not send</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.panelSub}>{result}</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={reset} activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>Try again</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Quick action grid ─────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textSecond }]}>
        QUICK ACTIONS
      </Text>
      <View style={styles.quickGrid}>
        {[
          { icon: '⚖️', label: 'Find\nLawyer',    onPress: () => navigation.navigate('LawyersTab') },
          { icon: '🔓', label: 'Bail\nAgent',      onPress: () => navigation.navigate('BailTab') },
          { icon: '💬', label: 'AI\nHelp',         onPress: () => navigation.navigate('ChatTab') },
          { icon: '🏛️', label: 'Court\nLocator',  onPress: () => navigation.navigate('MoreTab', { screen: 'CourtLocator' }) },
          { icon: '📋', label: 'Just\nArrested?', onPress: () => navigation.navigate('MoreTab', { screen: 'HelpNow' }) },
          { icon: '🧠', label: 'Crisis\nHelp',    onPress: () => navigation.navigate('MoreTab', { screen: 'CrisisResources' }) },
        ].map(item => (
          <TouchableOpacity
            key={item.label}
            style={[styles.quickBtn, { backgroundColor: colors.bgCard }]}
            onPress={item.onPress}
            activeOpacity={0.75}
            accessibilityRole="button"
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
        KNOW YOUR RIGHTS RIGHT NOW
      </Text>
      {RIGHTS_CARDS.map(c => (
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

const makeStyles = (colors: any) => StyleSheet.create({
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
    color: '#EF5350', fontSize: 18, fontWeight: '900',
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
const styles = makeStyles(COLORS);