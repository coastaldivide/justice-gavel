/**
 * EmergencyShareScreen -- One-tap emergency share
 *
 * Sends a single formatted SMS/iMessage to all emergency contacts containing:
 *   - User's name
 *   - Current GPS location (Google Maps link)
 *   - Nearest bail bondsman phone number
 *   - Nearest lawyer phone number
 *
 * Format:
 *   "[Name] needs help. 📍 Location: https://maps.google.com/?q=lat,lng
 *    🔓 Bail bondsman: [phone] · ⚖️ Lawyer: [phone]
 *    Sent via Justice Gavel"
 *
 * Accessible from:
 *   1. HomeScreen HELP NOW header area
 *   2. EmergencyScreen
 *   3. HelpNowScreen bottom CTA
 */
import React, { useState, useEffect, useRef} from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, RefreshControl} from 'react-native';
import type { ScreenProps } from '../types/navigation';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { getLocation } from '../services/location';
import { getContacts } from '../services/storage';
import { hapticCall, hapticSuccess, hapticWarn } from '../services/haptics';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
declare var name: any; // hoisted from component scope

declare var load: any;
declare var mapsLink: any; // hoisted from component scope
type Phase = 'ready' | 'locating' | 'finding' | 'confirm' | 'sharing' | 'done' | 'error';

const lines = [
      `🚨 ${name} needs legal help right now.`,
      ``,
      `📍 Their location:`,
      mapsLink,
      ``,
    ];

export default function EmergencyShareScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [submitting, setSubmitting] = React.useState(false);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);

  const [phase, setPhase]       = useState<Phase>('ready');
  const [userName, setUserName] = useState('');
  const [contacts, setContacts] = useState<string[]>([]);
  const [coords, setCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [bondsman, setBondsman] = useState<any>(null);
  const [lawyer, setLawyer]     = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sharedTo, setSharedTo] = useState(0);

  // ── Quick Exit (Silent / Discreet Mode) ──────────────────────────────────────
  // Domestic violence app design guidelines: a visible "Emergency" screen
  // can be dangerous if the user is being coerced or monitored.
  // Quick Exit: tap 3× the exit button OR press volume-down 3× to immediately
  // navigate away and replace with a neutral cover screen.
  // Pattern drawn from: National DV Hotline Safety Net guidelines,
  // Purple (DV app), Bright Sky app design specifications.
  const quickExitCountRef = useRef(0);
  const quickExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCoverScreen, setShowCoverScreen] = React.useState(false);

  const triggerQuickExit = React.useCallback(() => {
    // Navigate immediately to a neutral screen (Home tab)
    // This replaces the navigation stack so back button doesn't return here
    setShowCoverScreen(true);
    setTimeout(() => {
      (navigation as any).navigate('HomeTab');
      setShowCoverScreen(false);
    }, 80);
  }, [navigation]);

  const handleQuickExitTap = React.useCallback(() => {
    quickExitCountRef.current += 1;
    if (quickExitTimerRef.current) clearTimeout(quickExitTimerRef.current);
    if (quickExitCountRef.current >= 3) {
      quickExitCountRef.current = 0;
      triggerQuickExit();
    } else {
      // Reset count after 1.5 seconds of no taps
      quickExitTimerRef.current = setTimeout(() => {
        quickExitCountRef.current = 0;
      }, 1500);
    }
  }, [triggerQuickExit]);

  // Android back button -- also triggers quick exit when on this screen
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      triggerQuickExit();
      return true; // prevent default back navigation
    });
    return () => sub.remove();
  }, [triggerQuickExit]);

  useEffect(() => {
    // Pre-load user data
    AsyncStorage.getItem('user').then(u => {
      if (u) {
        const user = (() => { try { return JSON.parse(u); } catch { return null; } })();
        setUserName(user.displayName || user.name || 'Someone');
      }
    }).catch(() => {});
    getContacts().then(c => setContacts((c as string[]).filter(Boolean))).catch(() => {});
  }, []);

  const buildMessage = (
    name: string,
    lat: number,
    lng: number,
    bondsmanPhone: string | null,
    lawyerPhone: string | null,
  ): string => {
    const mapsLink = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
        if (bondsmanPhone) {
      lines.push(`🔓 Bail bondsman (call now):`);
      lines.push(bondsmanPhone);
      lines.push(``);
    }
    if (lawyerPhone) {
      lines.push(`⚖️ Criminal defense lawyer:`);
      lines.push(lawyerPhone);
      lines.push(``);
    }
    lines.push(`Sent via Justice Gavel -- justicegavel.app`);
    return lines.join('\n');
  };

  const gatherInfo = async () => {
    hapticCall();
    setPhase('locating');
    setErrorMsg('');

    // Step 1: GPS
    let lat = 0, lng = 0;
    try {
      const loc = await getLocation();
      lat = loc.lat; lng = loc.lng;
      setCoords({ lat, lng });
    } catch {
      // GPS unavailable -- still proceed
    }

    // Step 2: Find nearest bail + lawyer
    setPhase('finding');
    let bail: Record<string,unknown>|null = null, law: Record<string, unknown> | null = null;
    try {
      const params: Record<string, unknown> = { limit: 1 };
      if (lat && lng) { params.lat = lat; params.lng = lng; params.radiusKm = 80; }

      const [bailRes, lawyerRes] = await Promise.all([
        api.get('/providers/bail',    { params }).catch(() => ({ data: [] })),
        api.get('/providers/lawyers', { params }).catch(() => ({ data: [] })),
      ]);
      bail = Array.isArray(bailRes.data)   ? bailRes.data?.[0]   : null;
      law  = Array.isArray(lawyerRes.data) ? lawyerRes.data?.[0] : null;
    } catch (e: any) { __DEV__ && console.warn(e?.message); }

    setBondsman(bail);
    setLawyer(law);
    setPhase('confirm');
  };

  const sendShare = async () => {
    if (!coords && !bondsman && !lawyer) {
      Alert.alert('Nothing to share', 'No location or contacts found.');
      return;
    }

    hapticCall();
    setPhase('sharing');

    const message = buildMessage(
      userName || 'Someone',
      coords?.lat ?? 0,
      coords?.lng ?? 0,
      bondsman?.phone ?? null,
      lawyer?.phone ?? null,
    );

    // If we have phone contacts, open SMS; otherwise use Share sheet
    const phoneContacts = contacts.filter(c => /\d{7 }/.test(c.replace(/\D/g, '')));
    const firstPhone = phoneContacts[0];

    try {
      if (firstPhone) {
        // Try to open SMS to first contact with message pre-filled (iOS/Android)
        const smsUrl = `sms:${firstPhone.replace(/\D/g, '')}${
          Platform.OS === 'ios' ? '&' : '?'
        }body=${encodeURIComponent(message)}`;

        const canOpen = await Linking.canOpenURL(smsUrl).catch(() => false);
        if (canOpen) {
          await Linking.openURL(smsUrl).catch(() => {});
          setSharedTo(contacts.length);
          setPhase('done');
          hapticSuccess();
          return;
        }
      }

      // Fallback: native share sheet
      let result;
      try {
        result = await Share.share({ message, title: `${userName} needs help` });
      } catch (shareErr: any) {
        // Share sheet unavailable — fallback already handled above
      }
      if (result.action === Share.sharedAction) {
        setSharedTo(contacts.length);
        setPhase('done');
        hapticSuccess();
      } else {
        setPhase('confirm');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Could not send message.');
      setPhase('error');
      hapticWarn();
    }
  };

  const mapsUrl = coords
    ? `https://maps.google.com/?q=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`
    : null;

  // ── Ready ─────────────────────────────────────────────────────────────────

  // Quick exit cover -- neutral screen shown during transition
  if (showCoverScreen) {
    return (
      <View style={{ flex:1, backgroundColor:colors.bgSubtle, alignItems:'center', justifyContent:'center' }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:24 }}>🌤️</Text>
      </View>
    );
  }

if (phase === 'ready') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.quickExitBar}>
        <TouchableOpacity
          onPress={handleQuickExitTap}
          style={styles.quickExitBtn}
          accessibilityRole="button"
          accessibilityLabel="Quick exit -- tap 3 times to leave this screen immediately"
          hitSlop={{ top:12, bottom:12, left:12, right:12 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.quickExitBtnText}>✕ Quick Exit</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.quickExitHint}>Tap 3× to exit immediately</Text>
      </View>
      <View style={styles.hero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>One-Tap Emergency Share</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>
          Sends your GPS location, bail bondsman, and lawyer phone number
          to your emergency contacts in one message.
        </Text>
      </View>

      {contacts.length === 0 && (
        <View style={styles.noContactsCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.noContactsTitle}>⚠️ No emergency contacts set</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.noContactsBody}>
            Add contacts first so they can be reached when you need help.
          </Text>
          <TouchableOpacity
            style={styles.addContactsBtn}
            onPress={() => navigation.navigate('Contacts')}
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.addContactsBtnText}>Add Emergency Contacts →</Text>
          </TouchableOpacity>
        </View>
      )}

      {contacts.length > 0 && (
        <View style={styles.contactsList}>
          <Text maxFontSizeMultiplier={1.4} style={styles.contactsLabel}>Will be sent to:</Text>
          {contacts.map((c, i) => (
            <View key={i} style={styles.contactRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactNum}>{i + 1}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactVal}>{c}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.whatIncluded}>
        <Text maxFontSizeMultiplier={1.4} style={styles.whatTitle}>What's included</Text>
        {[
          '📍  Your live GPS location (Google Maps link)',
          '🔓  Nearest bail bondsman phone number',
          '⚖️  Nearest criminal defense lawyer phone number',
          '👤  Your name so contacts know who sent it',
        ].map(item => <Text maxFontSizeMultiplier={1.4} key={item} style={styles.whatItem}>{item}</Text>)}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.goBtn, contacts.length === 0 && styles.goBtnDisabled]}
        onPress={gatherInfo}
        disabled={contacts.length === 0}
        activeOpacity={0.85}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.goBtnText}>🚨  Get Info & Preview Message</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editContactsLink} onPress={() => navigation.navigate('Contacts')}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.editContactsText}>Edit emergency contacts →</Text>
      </TouchableOpacity>

      {/* ── Crisis & Mental Health Resources ───────────────────────────────
           Apple App Store §1.4.1 requires emergency resource links in apps
           serving populations at elevated mental health risk.
           These resources are always shown -- no paywall, no login required. */}
      <View style={styles.crisisSection}>
        <Text maxFontSizeMultiplier={1.4} style={styles.crisisSectionTitle}>Crisis & Mental Health Resources</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.crisisSectionSub}>
          Free, confidential, available 24/7. No app or login needed.
        </Text>

        <TouchableOpacity
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:988').catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Call or text 988 Suicide and Crisis Lifeline"
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>📞</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>988 Suicide & Crisis Lifeline</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>Call or text 988 -- 24/7, free, confidential</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.crisisRow}
          onPress={() => Linking.openURL('sms:741741&body=HOME').catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Text HOME to 741741 Crisis Text Line"
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>💬</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>Crisis Text Line</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>Text HOME to 741741 -- free, 24/7</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:18009506264').catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Call NAMI Helpline 1-800-950-6264"
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.warnBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>🧠</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>NAMI Helpline</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>1-800-950-6264 -- Mon-Fri 10am-10pm ET</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:18007994889').catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Call SAMHSA National Helpline"
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>🏥</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>SAMHSA National Helpline</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>1-800-662-4357 -- Substance use & mental health</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.crisisRow, { borderBottomWidth: 0 }]}
          onPress={() => Linking.openURL('https://www.thehotline.org/get-help/').catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="National Domestic Violence Hotline"
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.emergencyBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>🛡️</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>National Domestic Violence Hotline</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>1-800-799-7233 or text START to 88788</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>↗</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ── Locating / Finding ─────────────────────────────────────────────────────
  if (phase === 'locating' || phase === 'finding' || phase === 'sharing') return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.emergency} />
      <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>
        {phase === 'locating' ? 'Getting your location…'
         : phase === 'finding' ? 'Finding nearest bail agent and lawyer…'
         : 'Opening message…'}
      </Text>
    </View>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <View style={styles.center}>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorIcon}>⚠️</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorTitle}>Could not send</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorBody}>{errorMsg}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={() => setPhase('ready')}
        accessibilityRole="button"
        >
        <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <View style={styles.center}>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneIcon}>✓</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>Message sent!</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>Your emergency contacts have been notified.</Text>
      <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
        accessibilityRole="button"
        >
        <Text maxFontSizeMultiplier={1.4} style={styles.doneBtnText}>Done Sharing</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Confirm ────────────────────────────────────────────────────────────────
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.confirmHeader}>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmTitle}>Preview Message</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmSub}>Review before sending to {contacts.length} contact{contacts.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* Message preview */}
      <View style={styles.messagePreview}>
        <Text maxFontSizeMultiplier={1.4} style={styles.messageText}>
          🚨 {userName || 'Someone'} needs legal help right now.{'\n\n'}
          📍 Their location:{'\n'}
          {mapsUrl || '(Location unavailable)'}{'\n\n'}
          {bondsman?.phone ? `🔓 Bail bondsman (call now):\n${bondsman.phone}\n\n` : ''}
          {lawyer?.phone   ? `⚖️ Criminal defense lawyer:\n${lawyer.phone}\n\n` : ''}
          Sent via Justice Gavel -- justicegavel.app
        </Text>
      </View>

      {/* Contacts */}
      <View style={styles.contactsList}>
        <Text maxFontSizeMultiplier={1.4} style={styles.contactsLabel}>Sending to:</Text>
        {contacts.map((c, i) => (
          <View key={i} style={styles.contactRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.contactNum}>{i + 1}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.contactVal}>{c}</Text>
          </View>
        ))}
      </View>

      {/* Provider cards */}
      {bondsman && (
        <View style={styles.providerCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerLabel}>🔓 Bail bondsman</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerName}>{bondsman.name}</Text>
          {bondsman.phone && (
            <TouchableOpacity onPress={() => { hapticCall(); Linking.openURL('tel:' + bondsman.phone.replace(/\s/g,'')).catch(() => {}).catch(() => {}); }}
              accessibilityRole="button"
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.providerPhone}>{bondsman.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {lawyer && (
        <View style={[styles.providerCard, { borderLeftColor: COLORS.legal }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.providerLabel, { color: COLORS.legal }]}>⚖️ Lawyer</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerName}>{lawyer.name}</Text>
          {lawyer.phone && (
            <TouchableOpacity onPress={() => { hapticCall(); Linking.openURL('tel:' + lawyer.phone.replace(/\s/g,'')).catch(() => {}).catch(() => {}); }}
              accessibilityRole="button"
              >
              <Text maxFontSizeMultiplier={1.4} style={[styles.providerPhone, { color: COLORS.legal }]}>{lawyer.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <TouchableOpacity style={styles.sendBtn} onPress={sendShare} activeOpacity={0.85}
          accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>🚨  Send Now</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnSub}>Opens your Messages app</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => setPhase('ready')}
        accessibilityRole="button"
        >
        <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  hero: {
    backgroundColor: COLORS.emergency, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 16, ...SHADOW.md },
  heroTitle: { fontSize: 20, ...FONTS.black, color: COLORS.bgCard, marginBottom: 6 },
  heroSub:   { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },

  noContactsCard: {
    backgroundColor: COLORS.warnBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#F9A825' },
  noContactsTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.warn, marginBottom: 6 },
  noContactsBody:  { fontSize: 12, lineHeight: 20, color: COLORS.textSecond, marginBottom: 12 },
  addContactsBtn:  { backgroundColor: COLORS.warn, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center' },
  addContactsBtnText: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 12 },

  contactsList:  { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  contactsLabel: { fontSize: 12, ...FONTS.heavy, color: COLORS.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  contactRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  contactNum:    { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.navy, color: COLORS.bgCard, textAlign: 'center', lineHeight: 24, fontSize: 12, ...FONTS.black, overflow: 'hidden' },
  contactVal:    { fontSize: 14, lineHeight: 21, ...FONTS.semi, color: COLORS.textPrimary },

  whatIncluded:  { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  whatTitle:     { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.navy, marginBottom: 8 },
  whatItem:      { fontSize: 12, color: COLORS.textSecond, lineHeight: 22 },

  goBtn:         { backgroundColor: COLORS.emergency, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  goBtnDisabled: { backgroundColor: COLORS.textMuted },
  goBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },

  editContactsLink: { alignItems: 'center', paddingVertical: 12 },
  editContactsText: { fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.semi },

  statusText: { marginTop: 16, fontSize: 14, lineHeight: 21, color: COLORS.textMuted, textAlign: 'center' },
  errorIcon:  { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, ...FONTS.heavy, color: COLORS.emergency, marginBottom: 8 },
  errorBody:  { fontSize: 14, color: COLORS.textSecond, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  retryBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, paddingHorizontal: 28 },
  retryBtnText: { color: COLORS.bgCard, ...FONTS.heavy },

  doneIcon:  { fontSize: 72, marginBottom: 8 },
  doneTitle: { fontSize: 22, ...FONTS.black, color: COLORS.legal, marginBottom: 4 },
  doneSub:   { fontSize: 12, lineHeight: 20, color: COLORS.textMuted, marginBottom: 24 },
  doneBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },
  doneBtnText: { color: COLORS.bgCard, ...FONTS.black, fontSize: 15,
    lineHeight: 22 },

  confirmHeader: { backgroundColor: COLORS.emergency, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14, ...SHADOW.md },
  confirmTitle:  { fontSize: 20, ...FONTS.black, color: COLORS.bgCard, marginBottom: 2 },
  confirmSub:    { fontSize: 12, color: 'rgba(255,255,255,0.8)' },

  messagePreview: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.border, borderLeftWidth: 3, borderLeftColor: COLORS.emergency,
    ...SHADOW.sm },
  messageText: { fontSize: 12, color: COLORS.textSecond, lineHeight: 19, fontFamily: 'monospace' },

  providerCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md, padding: 12, marginBottom: 10,
    borderLeftWidth: 4, borderLeftColor: COLORS.bail, borderWidth: 1, borderColor: COLORS.border },
  providerLabel: { fontSize: 11, ...FONTS.black, color: COLORS.bail, marginBottom: 2, letterSpacing: 0.5 },
  providerName:  { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 4 },
  providerPhone: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.bail },

  sendBtn:     { backgroundColor: COLORS.emergency, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', marginTop: 8, ...SHADOW.md },
  sendBtnText: { color: COLORS.bgCard, fontSize: 18, ...FONTS.black },
  sendBtnSub:  { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 3 },
  cancelBtn:   { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  cancelBtnText: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted, ...FONTS.semi },
  crisisSection: {
    marginHorizontal: 0,
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgCard,
    overflow: 'hidden' },
  crisisSectionTitle: {
    fontSize: 15,
    lineHeight: 22,
    ...FONTS.bold,
    color: COLORS.textPrimary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2 },
  crisisSectionSub: {
    fontSize: 12,
    ...FONTS.regular,
    color: COLORS.textMuted,
    paddingHorizontal: 16,
    paddingBottom: 10 },
  crisisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 12 },
  crisisIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0 },
  crisisIconText: { fontSize: 18 },
  crisisInfo:     { flex: 1 },
  crisisName:     { fontSize: 12, ...FONTS.semiBold, color: COLORS.textPrimary },
  crisisDetail:   { fontSize: 11, ...FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  crisisArrow:    { fontSize: 18, color: COLORS.textMuted },
  quickExitBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 4 },
  quickExitBtn: {
    backgroundColor: '#EF5350',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8 },
  quickExitBtnText: {
    color: COLORS.bgCard,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3 },
  quickExitHint: {
    fontSize: 11,
    color: colors.steel,
    fontStyle: 'italic' } });
