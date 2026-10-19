import { RNShare, COPIED_ACTION } from '../utils/webCompat';
import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
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
import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, BackHandler, Linking, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View, LayoutAnimation } from 'react-native';
import type { ScreenProps } from '../types/navigation';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { getLocation } from '../services/location';
import { activeContacts, openSmsComposer, isPhoneContact, smsUrl } from '../services/sos';
import { getUserName } from '../services/storage';
import { hapticCall, hapticSuccess, hapticWarn } from '../services/haptics';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { t, useLang } from '../i18n';

type Phase = 'ready' | 'locating' | 'finding' | 'confirm' | 'sharing' | 'done' | 'error';

// Message template lines are built inside buildMessage()

function EmergencyShareScreen({ navigation }: ScreenProps) {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [phase, setPhase]       = useState<Phase>('ready');
  const [userName, setUserName] = useState('');
  const [contacts, setContacts] = useState<string[]>([]);
  const [coords, setCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [bondsman, setBondsman] = useState<any>(null);
  const [lawyer, setLawyer]     = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sharedTo, setSharedTo] = useState(0);
  const [doneHow, setDoneHow] = useState<'sms' | 'share'>('sms');
  // Arrest details the family needs to make calls (kept on this phone only).
  const [arrest, setArrest] = useState({ who: '', where: '', booking: '', charges: '' });
  const setArrestField = (k: keyof typeof arrest, v: string) => {
    setArrest(prev => {
      const next = { ...prev, [k]: v.slice(0, 120) };
      AsyncStorage.setItem('arrest_info_v1', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

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

  // In the signed-out stack (age gate → "Need help right now?") there is no
  // Home tab or Contacts screen: quick exit goes back, and the contacts links hide.
  const routeNames: string[] = (navigation as any)?.getState?.()?.routeNames || [];
  const inMainApp = !!(navigation as any)?.getParent?.()?.getState?.()?.routeNames?.includes('HomeTab');
  const canEditContacts = routeNames.includes('Contacts');

  const triggerQuickExit = React.useCallback(() => {
    // Navigate immediately to a neutral screen (Home tab)
    // This replaces the navigation stack so back button doesn't return here
    setShowCoverScreen(true);
    setTimeout(() => {
      if (inMainApp) (navigation as any).navigate('HomeTab');
      else if (navigation.canGoBack()) navigation.goBack();
      setShowCoverScreen(false);
    }, 80);
  }, [navigation, inMainApp]);

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

  // Contacts reload on focus: coming back from "Add emergency contacts" shows them.
  useEffect(() => {
    const load = () => { activeContacts().then(c => { if (mountedRef.current) setContacts(c); }).catch(() => {}); };
    load();
    const unsub = (navigation as any)?.addListener?.('focus', load);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation]);

  useEffect(() => {
    // Pre-load user data
    getUserName().then(n => { if (mountedRef.current) setUserName(n); }).catch(() => {});
    AsyncStorage.getItem('arrest_info_v1').then(v => {
      if (!v) return;
      try { const a = JSON.parse(v); setArrest(prev => ({ ...prev, ...a })); } catch { /* ignore a damaged copy */ }
    }).catch(() => {});
  }, []);

  const buildMessage = (
    name: string,
    lat: number,
    lng: number,
    bondsmanPhone: string | null,
    lawyerPhone: string | null,
  ): string => {
    const mapsLink = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    const lines: string[] = [
      t('x_emergency_share_needs_legal_help_right', { value: arrest.who.trim() || name }),
      ``,
    ];
    if (arrest.who.trim()) lines.push(t('es_msg_arrested', { value: arrest.who.trim() }));
    if (arrest.where.trim()) lines.push(t('es_msg_held_at', { value: arrest.where.trim() }));
    if (arrest.booking.trim()) lines.push(t('es_msg_booking', { value: arrest.booking.trim() }));
    if (arrest.charges.trim()) lines.push(t('es_msg_charges', { value: arrest.charges.trim() }));
    if (arrest.who.trim() || arrest.where.trim() || arrest.booking.trim() || arrest.charges.trim()) lines.push(``);
    if (lat || lng) lines.push(t('es_msg_location'), mapsLink, ``);
    if (bondsmanPhone) lines.push(t('es_msg_bail'), bondsmanPhone, ``);
    if (lawyerPhone) lines.push(t('es_msg_lawyer'), lawyerPhone, ``);
    lines.push(t('es_msg_footer'));
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
    const hasArrestInfo = !!(arrest.who.trim() || arrest.where.trim() || arrest.booking.trim() || arrest.charges.trim());
    if (!coords && !bondsman && !lawyer && !hasArrestInfo) {
      showToast(t('x_emergency_share_add_arrest_details_allow'));
      return;
    }

    hapticCall();
    setPhase('sharing');

    const message = buildMessage(
      userName || t('sos_someone'),
      coords?.lat ?? 0,
      coords?.lng ?? 0,
      bondsman?.phone ?? null,
      lawyer?.phone ?? null,
    );

    // Phone contacts: the messages app with the text for all of them; otherwise the share sheet.
    const phones = contacts.filter(isPhoneContact);
    try {
      if (phones.length && await openSmsComposer(phones, message)) {
        setSharedTo(phones.length);
        setDoneHow('sms');
        setPhase('done');
        hapticSuccess();
        return;
      }
      const result = await RNShare.share({ message, title: t('x_emergency_share_needs_help', { userName: userName || t('sos_someone') }) });
      if (result?.action === Share.sharedAction) {
        setSharedTo(0);
        setDoneHow('share');
        setPhase('done');
        hapticSuccess();
      } else {
        if (result?.action === COPIED_ACTION) showToast(t('es_copied'), 'info');
        setPhase('confirm');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || t('x_emergency_share_could_not_send_message'));
      setPhase('error');
      hapticWarn();
    }
  };


  // ── Ready ─────────────────────────────────────────────────────────────────

  // Quick exit cover -- neutral screen shown during transition
  if (showCoverScreen) {
    return (
      <View style={{ flex:1, backgroundColor:colors.bgSubtle, alignItems:'center', justifyContent:'center' }}
        testID="emergency-share-screen">
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize:24 }}>🌤️</Text>
      </View>
    );
  }

if (phase === 'ready') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={{ paddingBottom: 24, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}>
      <View style={styles.quickExitBar}>
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          onPress={handleQuickExitTap}
          style={styles.quickExitBtn}
          accessibilityLabel={t('x_emergency_share_quick_exit_tap_3')}
          hitSlop={{ top:12, bottom:12, left:12, right:12 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.quickExitBtnText}>{t('x_emergency_share_quick_exit')}</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.quickExitHint}>{t('x_emergency_share_tap_3_exit_immediately')}</Text>
      </View>
      <View style={styles.hero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>{t('x_emergency_share_one_tap_emergency_share')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>
          {t('x_emergency_share_sends_gps_location_bail')}
        </Text>
      </View>

      {contacts.length === 0 && (
        <View style={styles.noContactsCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.noContactsTitle}>{t('x_emergency_share_no_emergency_contacts_set')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.noContactsBody}>
            {t('x_emergency_share_add_contacts_first_so')}
          </Text>
          {canEditContacts && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={t('cp_double_tap')}
              style={styles.addContactsBtn}
              accessibilityLabel={t('x_emergency_share_add_emergency_contacts')} onPress={() => navigation.navigate('Contacts')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.addContactsBtnText}>{t('x_emergency_share_add_emergency_contacts')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {contacts.length > 0 && (
        <View style={styles.contactsList}>
          <Text maxFontSizeMultiplier={1.4} style={styles.contactsLabel}>{t('x_emergency_share_will_be_sent')}</Text>
          {contacts.map((c, i) => (
            <View key={`contact-${i}`} style={styles.contactRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactNum}>{i + 1}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.contactVal}>{c}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.whatIncluded} testID="arrest-info">
        <Text maxFontSizeMultiplier={1.4} style={styles.whatTitle}>{t('x_emergency_share_arrest_details_optional_saved')}</Text>
        {([
          ['who', t('x_es_f_who'), t('x_es_f_who_ph')],
          ['where', t('x_es_f_where'), t('x_es_f_where_ph')],
          ['booking', t('x_es_f_booking'), t('x_es_f_booking_ph')],
          ['charges', t('x_es_f_charges'), t('x_es_f_charges_ph')],
        ] as const).map(([k, label, ph]) => (
          <View key={k} style={{ marginBottom: 8 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.whatItem}>{label}</Text>
            <TextInput accessibilityLabel={label} testID={`arrest-${k}`} value={arrest[k]} onChangeText={v => setArrestField(k, v)}
              placeholder={ph} placeholderTextColor={colors.textMuted} maxLength={120}
              style={{ backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, color: colors.textPrimary, fontSize: 15 }} />
          </View>
        ))}
      </View>

      <View style={styles.whatIncluded}>
        <Text maxFontSizeMultiplier={1.4} style={styles.whatTitle}>{t('x_emergency_share_what_s_included')}</Text>
        {[
          t('x_emergency_share_live_gps_location_google'),
          t('x_emergency_share_nearest_bail_bondsman_phone'),
          t('x_emergency_share_nearest_criminal_defense_lawyer'),
          t('x_emergency_share_name_so_contacts_know'),
          t('x_emergency_share_arrest_details_typed_above'),
        ].map(item => <Text maxFontSizeMultiplier={1.4} key={item} style={styles.whatItem}>{item}</Text>)}
      </View>

      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={styles.goBtn}
        onPress={gatherInfo}
        testID="emergency-share-go"
        activeOpacity={0.85}
       accessibilityLabel={t('x_emergency_share_get_info_preview_message')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.goBtnText}>{t('x_emergency_share_get_info_preview_message')}</Text>
      </TouchableOpacity>

      {canEditContacts && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.editContactsLink}
          onPress={() => navigation.navigate('Contacts')}
          accessibilityLabel={t('x_emergency_share_edit_emergency_contacts')}>
          <Text maxFontSizeMultiplier={1.4} style={styles.editContactsText}>{t('x_emergency_share_edit_emergency_contacts')}</Text>
        </TouchableOpacity>
      )}

      {/* ── Crisis & Mental Health Resources ───────────────────────────────
           Apple App Store §1.4.1 requires emergency resource links in apps
           serving populations at elevated mental health risk.
           These resources are always shown -- no paywall, no login required. */}
      <View style={styles.crisisSection}>
        <Text maxFontSizeMultiplier={1.4} style={styles.crisisSectionTitle}>{t('x_emergency_share_crisis_mental_health_resources')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.crisisSectionSub}>
          {t('x_emergency_share_free_confidential_available_24')}
        </Text>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:988').catch(() => showToast(t('action_failed'), 'error'))}
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.bgSubtle }]}>
            <AppIcon name="call-outline" size={20} color={colors.legal} />
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>{t('x_emergency_share_988_suicide_crisis_lifeline')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>{t('x_emergency_share_call_text_988_24')}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.crisisRow}
          onPress={() => Linking.openURL(smsUrl('741741', 'HOME')).catch(() => showToast(t('action_failed'), 'error'))}
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>💬</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>Crisis Text Line</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>{t('x_emergency_share_text_home_741741_free')}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:18009506264').catch(() => showToast(t('action_failed'), 'error'))}
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.warnBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>🧠</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>{t('x_emergency_share_nami_helpline')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>{t('x_emergency_share_1_800_950_6264')}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.crisisRow}
          onPress={() => Linking.openURL('tel:18007994889').catch(() => showToast(t('action_failed'), 'error'))}
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisIconText}>🏥</Text>
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>{t('x_emergency_share_samhsa_national_helpline')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>{t('x_emergency_share_1_800_662_4357')}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.crisisArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.crisisRow, { borderBottomWidth: 0 }]}
          onPress={() => Linking.openURL('https://www.thehotline.org/get-help/').catch(() => showToast(t('action_failed'), 'error'))}
          accessibilityLabel={t('x_emergency_share_national_domestic_violence_hotline')}
        >
          <View style={[styles.crisisIcon, { backgroundColor: colors.emergencyBg }]}>
            <AppIcon name="shield-checkmark-outline" size={20} color={COLORS.navy} />
          </View>
          <View style={styles.crisisInfo}>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisName}>{t('x_emergency_share_national_domestic_violence_hotline')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.crisisDetail}>{t('x_emergency_share_1_800_799_7233')}</Text>
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
        {phase === 'locating' ? t('qc_loc_getting')
         : phase === 'finding' ? t('x_emergency_share_finding_nearest_bail_agent')
         : t('x_emergency_share_opening_message')}
      </Text>
    </View>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <View style={styles.center}>
      <AppIcon name="warning-outline" size={20} color={colors.warn} />
      <Text maxFontSizeMultiplier={1.4} style={styles.errorTitle}>{t('x_emergency_could_not_send')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.errorBody}>{errorMsg}</Text>
      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={styles.retryBtn}
        onPress={sendShare}
        accessibilityLabel={t('try_again')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>{t('help_now_error_retry')}</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <View style={styles.center}>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneIcon}>✓</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneTitle}>{t('x_emergency_share_message_sent')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.doneSub}>
        {doneHow === 'sms' ? t('es_done_sms', { n: sharedTo }) : t('es_done_share')}
      </Text>
      <TouchableOpacity
  accessibilityRole="button"
        style={styles.doneBtn}
        onPress={() => { if (navigation.canGoBack()) navigation.goBack(); else setPhase('ready'); }}
         accessibilityLabel={t('x_emergency_share_done_sharing')}
          accessibilityHint={t('x_emergency_share_confirms_closes_this_view')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.doneBtnText}>{t('x_emergency_share_done_sharing')}</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Confirm ────────────────────────────────────────────────────────────────
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.confirmHeader}>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmTitle}>{t('x_emergency_share_preview_message')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.confirmSub}>{t(contacts.length === 1 ? 'x_emergency_share_review_before_sending_contact_one' : 'x_emergency_share_review_before_sending_contact_other', { length: contacts.length })}</Text>
      </View>

      {/* Message preview */}
      <View style={styles.messagePreview}>
        {/* exactly the text that will be sent */}
        <Text maxFontSizeMultiplier={1.4} style={styles.messageText} testID="emergency-share-preview">
          {buildMessage(userName || t('sos_someone'), coords?.lat ?? 0, coords?.lng ?? 0, bondsman?.phone ?? null, lawyer?.phone ?? null)}
        </Text>
      </View>

      {/* Contacts */}
      <View style={styles.contactsList}>
        <Text maxFontSizeMultiplier={1.4} style={styles.contactsLabel}>{t('x_emergency_share_sending')}</Text>
        {contacts.map((c, i) => (
          <View key={`contact-${i}`} style={styles.contactRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.contactNum}>{i + 1}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.contactVal}>{c}</Text>
          </View>
        ))}
      </View>

      {/* Provider cards */}
      {bondsman && (
        <View style={styles.providerCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerLabel}>{t('x_emergency_share_bail_bondsman')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerName}>{bondsman.name}</Text>
          {bondsman.phone && (
            <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
               onPress={() => Linking.openURL('tel:' + String(bondsman.phone).replace(/[^0-9+]/g, '')).catch(() => showToast(t('x_emergency_share_please_dial_manually', { phone: bondsman.phone }), 'warning'))}
               accessibilityLabel={bondsman.phone}>
              <Text maxFontSizeMultiplier={1.4} style={styles.providerPhone}>{bondsman.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {lawyer && (
        <View style={[styles.providerCard, { borderLeftColor: COLORS.legal }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.providerLabel, { color: COLORS.legal }]}>{t('x_emergency_share_lawyer')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.providerName}>{lawyer.name}</Text>
          {lawyer.phone && (
            <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
               onPress={() => Linking.openURL('tel:' + String(lawyer.phone).replace(/[^0-9+]/g, '')).catch(() => showToast(t('x_emergency_share_please_dial_manually', { phone: lawyer.phone }), 'warning'))}
               accessibilityLabel={lawyer.phone}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.providerPhone, { color: COLORS.legal }]}>{lawyer.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={styles.sendBtn}
        onPress={sendShare}
        testID="emergency-share-send"
       accessibilityLabel={t('x_emergency_share_send_now')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>{t('x_emergency_share_send_now')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnSub}>{t('x_emergency_share_opens_messages_app')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
  accessibilityRole="button"
        style={styles.cancelBtn}
        onPress={() => setPhase('ready')}
         accessibilityLabel={t('case_cancel')}
          accessibilityHint={t('x_arrest_monitor_cancels_returns_previous_screen')}>
        <Text maxFontSizeMultiplier={1.4} style={styles.cancelBtnText}>{t('case_cancel')}</Text>
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
  heroSub:   { fontSize: 12, color: colors.textOnNavy, lineHeight: 18 },

  noContactsCard: {
    backgroundColor: COLORS.warnBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.steelMid },
  noContactsTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: colors.textOnGold, marginBottom: 6 },
  noContactsBody:  { fontSize: 12, lineHeight: 20, color: COLORS.textSecond, marginBottom: 12 },
  addContactsBtn:  { backgroundColor: COLORS.warn, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center' },
  addContactsBtnText: { color: colors.textOnGold, ...FONTS.heavy, fontSize: 12 },

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
  editContactsText: { fontSize: 12, lineHeight: 20, color: colors.info, ...FONTS.semi },

  statusText: { marginTop: 16, fontSize: 14, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },
  errorIcon:  { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, ...FONTS.heavy, color: colors.emergency, marginBottom: 8 },
  errorBody:  { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  retryBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, paddingHorizontal: 28 },
  retryBtnText: { color: COLORS.bgCard, ...FONTS.heavy },

  doneIcon:  { fontSize: 72, marginBottom: 8 },
  doneTitle: { fontSize: 22, ...FONTS.black, color: colors.legal, marginBottom: 4 },
  doneSub:   { fontSize: 12, lineHeight: 20, color: colors.textMuted, marginBottom: 24 },
  doneBtn:   { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },
  doneBtnText: { color: COLORS.bgCard, ...FONTS.black, fontSize: 15,
    lineHeight: 22 },

  confirmHeader: { backgroundColor: COLORS.emergency, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14, ...SHADOW.md },
  confirmTitle:  { fontSize: 20, ...FONTS.black, color: COLORS.bgCard, marginBottom: 2 },
  confirmSub:    { fontSize: 12, color: colors.textOnNavy },

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
  sendBtnSub:  { color: colors.textOnNavy, fontSize: 11, marginTop: 3 },
  cancelBtn:   { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  cancelBtnText: { fontSize: 14, lineHeight: 21, color: colors.textMuted, ...FONTS.semi },
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
    backgroundColor: colors.emergency,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8 },
  quickExitBtnText: {
    color: colors.textOnAccent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3 },
  quickExitHint: {
    fontSize: 11,
    color: colors.info,
    fontStyle: 'italic' } });
export default React.memo(EmergencyShareScreen);