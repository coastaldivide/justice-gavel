import { AIDisclaimer } from '../components/AIDisclaimer';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
/**
 * MatchScreen -- AI-powered lawyer matching with GPS location + full contact actions
 *
 * Flow:
 *  1. Collect user's situation via text input + case type + language filters
 *  2. Acquire GPS → pass lat/lng + situation to /api/match/lawyers
 *  3. Display ranked results with AI-written match reports + one-tap contact actions
 */

import React, { useState, useCallback } from 'react';
import { View, Text, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, TextInput, Linking, ActivityIndicator, Platform, KeyboardAvoidingView, Modal, LayoutAnimation} from 'react-native';
import { PRACTICE_AREAS } from '../components/PracticeAreaSelector';
import { Picker } from '@react-native-picker/picker';
import { useNavigation } from '@react-navigation/native';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { getLocationWithCity, formatDistance } from '../services/location';
import {  useTheme, COLORS } from '../constants/theme';
import { t, useLang } from '../i18n';

// ── Constants ─────────────────────────────────────────────────────────────────

// Language values as lawyer profiles store them (English); the picker shows langLabel().
const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo']; // i18n-exempt: stored values
const langLabel = (l: string): string => t(`lang_name_${l.toLowerCase()}`);
const LANGUAGES_FILTERED = LANGUAGES.filter(Boolean);
const CASE_TYPES = PRACTICE_AREAS().map(a => a.key);


// ── Contact helpers ───────────────────────────────────────────────────────────

// Module-level link helpers: no hooks here; failures go to the optional callback.
function callPhone(phone: string, onError?: () => void) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}
function sendSMS(phone: string, onError?: () => void) {
  Linking.openURL('sms:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}
function openDirections(lat: number, lng: number, name: string, onError?: () => void) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => onError?.());
}
function openWebsite(url: string, onError?: () => void) {
  const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];
  if (BLOCKED_SCHEMES.some(sc => url.toLowerCase().startsWith(sc))) return;
  const safeUrl = url.startsWith('http') ? url : 'https://' + url;
  Linking.openURL(safeUrl).catch(() => onError?.());
}

// ── Match result card ─────────────────────────────────────────────────────────

function MatchCard({ item, rank }: { item: Record<string,any>; rank: number }) {
  useLang();
  const { showToast } = useToast();
  const rankColors = [COLORS.emergencyDark, COLORS.warnDark, COLORS.legalDark];
  const rankColor = rankColors[rank - 1] ?? COLORS.navy;

  const navigation = useNavigation<any>();
  const onLinkError = () => showToast(t('x_match_action_unavailable_this_device'), 'error');
  const [msgModal,   setMsgModal]   = useState(false);
  const openSecureMessage = () => { setMsgSent(false); setMsgModal(true); };
  const [msgName,    setMsgName]    = useState('');
  const [msgPhone,   setMsgPhone]   = useState('');
  const [msgNote,    setMsgNote]    = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent,    setMsgSent]    = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      accessibilityLabel={t('x_match_view_profile', { value: String(item?.name || 'attorney') })}
      onPress={() => navigation.navigate('LawyerProfile', { id: item?.id, lawyerId: item?.id })}
      style={styles.card}
      activeOpacity={0.85}
    >
      {/* Rank banner */}
      <View style={[styles.rankBanner, { backgroundColor: rankColor }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.rankText}>{t('x_match_match', { rank })}</Text>
        {item.distanceKm != null && (
          <Text maxFontSizeMultiplier={1.4} style={styles.rankDist}>📍 {formatDistance(item.distanceKm)}</Text>
        )}
      </View>

      {/* Name + rating */}
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.name}>{item?.name}</Text>
          <View style={styles.ratingPill}>
            <Text maxFontSizeMultiplier={1.4} style={styles.ratingText}>{item?.rating?.toFixed(1) ?? '--'} ★</Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.address}>{item?.address}</Text>

        {/* Accessibility badges */}
        <View style={styles.badgeRow}>
          {item.free_consultation && <Text maxFontSizeMultiplier={1.4} style={styles.greenBadge}>{t('x_lawyers_free_consult')}</Text>}
          {item.pro_bono && <Text maxFontSizeMultiplier={1.4} style={styles.purpleBadge}>{t('x_lawyers_pro_bono')}</Text>}
          {item.sliding_scale && <Text maxFontSizeMultiplier={1.4} style={styles.tealBadge}>{t('x_lawyers_sliding_scale')}</Text>}
          {item.verified && <Text maxFontSizeMultiplier={1.4} style={styles.verifiedBadge}>{t('x_bail_search_verified')}</Text>}
          {item.gavel_level === 1 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.bailBg, color: COLORS.bail }]}>{t('x_match_bronze_gavel')}</Text>}
          {item.gavel_level === 2 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.bgSubtle, color: COLORS.textSecond }]}>{t('x_match_silver_gavel')}</Text>}
          {item.gavel_level >= 3 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.warnBg, color: COLORS.goldText, borderColor: COLORS.gold }]}>{t('x_nav_golden_gavel')}</Text>}
        </View>

        {/* Specialties */}
        {item.specialties?.length > 0 && (
          <View style={styles.tagRow}>
            {item.specialties.map((s: string) => (
              <View key={s} style={styles.specTag}><Text maxFontSizeMultiplier={1.4} style={styles.specText}>{s}</Text></View>
            ))}
          </View>
        )}

        {/* Languages */}
        {item.languages?.length > 1 && (
          <Text maxFontSizeMultiplier={1.4} style={styles.languages}>🗣 {item.languages.join(' · ')}</Text>
        )}

        {/* Years experience */}
        {item.years_experience && (
          <Text maxFontSizeMultiplier={1.4} style={styles.experience}>{t('x_match_years_experience', { years_experience: item.years_experience })}</Text>
        )}

        {/* AI match report */}
        {item.matchReport && (
          <View style={styles.reportBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.reportLabel}>{t('x_match_why_this_match')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.reportText}>{item.matchReport}</Text>
          </View>
        )}

        {/* Contact action buttons */}
        <View style={styles.actionRow}>
          {item?.phone && (
            <TouchableOpacity
          accessibilityRole="button"
 style={[styles.actionBtn, styles.callBtn]} accessibilityLabel={t('lawyers_call')}
          accessibilityHint={t('x_lawyer_profile_dials_this_phone_number')} onPress={() => callPhone(item?.phone, onLinkError)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('lawyers_call')}</Text>
            </TouchableOpacity>
          )}
          {item?.phone && (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={[styles.actionBtn, styles.smsBtn]} accessibilityLabel={t('x_match_text')} onPress={() => sendSMS(item?.phone, onLinkError)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_match_text')}</Text>
            </TouchableOpacity>
          )}
          {item.lat && item.lng && (
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={[styles.actionBtn, styles.dirBtn]} accessibilityLabel={t('x_match_dir')} onPress={() => openDirections(item.lat, item.lng, item?.name, onLinkError)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_match_dir')}</Text>
            </TouchableOpacity>
          )}
          {item.website && (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={[styles.actionBtn, styles.webBtn]} accessibilityLabel={t('x_match_web')} onPress={() => openWebsite(item.website, onLinkError)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_match_web')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Leave a Message -- always-visible async contact option */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={styles.leaveMessageBtn}
          onPress={() => { setMsgSent(false); setMsgModal(true); }}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.leaveMessageBtnText}>{t('x_match_leave_message', { name: item?.name })}</Text>
        </TouchableOpacity>

        {/* Leave a Message modal */}
        <Modal accessibilityViewIsModal={true} visible={msgModal} transparent animationType="slide" onRequestClose={() => setMsgModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.modalOverlay} activeOpacity={1} onPress={() => setMsgModal(false)}
              accessibilityLabel={t('x_match_message_sent')}
            >
            <View style={[styles.msgSheet, { backgroundColor: COLORS.bgCard }]}>
              {msgSent ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <AppIcon name="checkmark-circle" size={20} color={COLORS.legal} />
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetTitle, { color: COLORS.textPrimary }]}>{t('x_match_message_sent')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetSub, { color: COLORS.textSecond }]}>
                    {t('x_match_will_contact_shortly', { name: item?.name })}
                  </Text>
                  <TouchableOpacity
          accessibilityRole="button"
 style={[styles.msgSendBtn, { marginTop: 20, width: '100%' }]} accessibilityLabel={t('booking_done')}
          accessibilityHint={t('x_emergency_share_confirms_closes_this_view')} onPress={() => setMsgModal(false)}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.msgSendBtnText}>{t('booking_done')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetTitle, { color: COLORS.textPrimary }]}>
                    {t('x_match_leave_message_2', { name: item?.name })}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetSub, { color: COLORS.textSecond }]}>
                    {t('x_match_they_ll_get_message')}
                  </Text>
                  <TextInput
                    style={[styles.msgInput, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder={t('x_match_name')}
                    placeholderTextColor={COLORS.textSecond}
                    value={msgName}
                    onChangeText={setMsgName}
                    autoCapitalize="words"
          returnKeyType="next"
          blurOnSubmit
        maxLength={200}
        />
                  <TextInput
                    style={[styles.msgInput, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder={t('x_match_best_phone_email_reach')}
                    placeholderTextColor={COLORS.textSecond}
                    value={msgPhone}
                    onChangeText={setMsgPhone}
                    keyboardType="email-address"
                    autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit
        maxLength={254}
        />
                  <TextInput
          accessibilityLabel={t('x_match_briefly_describe_situation_optional')}
                    style={[styles.msgInput, styles.msgInputTall, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder={t('x_match_briefly_describe_situation_optional')}
                    placeholderTextColor={COLORS.textSecond}
                    value={msgNote}
                    onChangeText={setMsgNote}
                    multiline
              maxLength={2000}
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                    style={[styles.msgSendBtn, (!msgName.trim() || !msgPhone.trim()) && { opacity: 0.45 }]}
                    disabled={!msgName.trim() || !msgPhone.trim() || msgSending || (!msgPhone.trim().includes('@') && msgPhone.trim().replace(/\D/g,'').length < 7)}
                    activeOpacity={0.85}
                    onPress={async () => {
                      setMsgSending(true);
                      try {
                        await api.post('/consultations/callback-request', {
                          lawyer_id: item.id,
                          phone:     msgPhone.trim(),
                          notes:     `From: ${msgName.trim()}\nContact: ${msgPhone.trim()}\n\n${msgNote.trim()}`,
                          duration_min: 30,
                        });
                        setMsgSent(true);
                        setMsgName(''); setMsgPhone(''); setMsgNote('');
                      } catch {
                        showToast(t('home_sos_failed'));
                      } finally {
                        setMsgSending(false);
                      }
                    }}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.msgSendBtnText}>{msgSending ? t('booking_sending') : t('x_lawyer_profile_send_message')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
          accessibilityRole="button"
 style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setMsgModal(false)}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
                    accessibilityLabel={t('case_cancel')}
          accessibilityHint={t('x_arrest_monitor_cancels_returns_previous_screen')}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.textMuted, fontSize: 12 }}>{t('case_cancel')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>

        {/* Encrypted in-app message -- requires account */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          accessibilityLabel={t('x_match_open_secure_message')}
          style={[styles.leaveMessageBtn, styles.secureMsgBtn]}
          onPress={openSecureMessage}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.leaveMessageBtnText, { color: COLORS.legalDark }]}>
            {t('x_match_message_securely_end_end')}
          </Text>
        </TouchableOpacity>

        {item?.phone && <Text maxFontSizeMultiplier={1.4} style={styles.phoneDisplay}>{item?.phone}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

function MatchScreen(): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);
  const [situation, setSituation] = useState('');
  const [caseType, setCaseType] = useState('');
  const [language, setLanguage] = useState('');
  const [proBonoOnly, setProBonoOnly] = useState(false);

  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const findMatches = useCallback(async () => {
    setLoading(true);
    setStatusMsg(t('x_match_getting_location'));
    setResults([]);
    setHasSearched(true);

    try {
      const loc = await getLocationWithCity();

      if (loc.city) {
        setLocationLabel(loc.source === 'gps'
          ? t('x_match_searching_near', { city: loc.city })
          : loc.city);
      } else {
        setLocationLabel(loc.permissionGranted ? t('x_match_using_gps_location') : t('x_match_using_default_location'));
      }

      setStatusMsg(t('x_match_finding_best_matches'));

      const params: Record<string, unknown> = {
        lat: loc.lat,
        lng: loc.lng,
        caseType,
        language,
        proBonoOnly,
        limit: 3
      };
      if (situation.trim()) params.situation = situation.trim();

      const res = await api.get('/match/lawyers', { params });
      const matches = unwrapList(res.data, 'lawyers', 'matches');
      setResults(matches);
      setStatusMsg(matches.length === 0 ? t('x_match_no_matches_found_try') : '');
    } catch (e: any) {
      const errMsg  = e.response?.data?.message || apiErrorMessage(e, '');
      const status  = e.response?.status;
      if (status === 503 || e.response?.data?.error === 'ai_unavailable') {
        setStatusMsg(t('x_match_ai_lawyer_matching_temporarily'));
      } else if (!e.response) {
        setStatusMsg(t('x_ch_no_connection_check_internet'));
      } else {
        setStatusMsg(t('x_match_match_failed', { value: (errMsg || t('x_consumer_subscription_please_try_again')) }));
      }
    } finally {
      setLoading(false);
    }
  }, [situation, caseType, language, proBonoOnly]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // Re-run the last search with existing parameters
    if (situation || caseType) {
      try {
        const res = await api.get('/match/lawyers', {
          params: { situation, caseType, language, proBonoOnly },
        });
        setResults(unwrapList(res.data, 'lawyers', 'matches'));
      } catch { /* silent on refresh error */ }
    }
    setRefreshing(false);
  }, [situation, caseType, language, proBonoOnly]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} keyboardShouldPersistTaps="handled"
        testID="match-screen"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />
        }
      >

        {/* Header */}
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_match_ai_lawyer_match')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>{t('x_match_tell_us_situation_we')}</Text>
        </View>

        {/* Situation input */}
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('x_match_describe_situation_optional')}</Text>
          <TextInput
          accessibilityLabel={t('x_match_e_g_i_was')}
            style={styles.textArea}
            multiline
              maxLength={2000}
            numberOfLines={4}
            placeholder={t('x_match_e_g_i_was')}
            placeholderTextColor={colors.textMuted}
            value={situation}
            onChangeText={setSituation}
          />
        </View>

        {/* Filters */}
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('x_lawyers_case_type')}</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={caseType} onValueChange={v => setCaseType(String(v))} style={styles.picker}>
              <Picker.Item label={t('x_match_not_sure_any')} value="" />
              {CASE_TYPES.filter(Boolean).map(tItem => <Picker.Item key={tItem} label={tItem} value={tItem} />)}
            </Picker>
          </View>
        </View>

        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>{t('x_match_preferred_language')}</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={language} onValueChange={v => setLanguage(String(v))} style={styles.picker}>
              <Picker.Item label={t('x_match_english_any')} value="" />
              {LANGUAGES_FILTERED.map(l => <Picker.Item key={l} label={langLabel(l)} value={l} />)}
            </Picker>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.toggleRow} onPress={() => setProBonoOnly(v => !v)}
        >
          <View style={[styles.toggle, proBonoOnly && styles.toggleOn]} />
          <Text maxFontSizeMultiplier={1.4} style={styles.toggleLabel}>{t('x_lawyers_pro_bono_free_representation')}</Text>
        </TouchableOpacity>

        {/* Search button */}
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6} style={[styles.searchBtn, loading && styles.searchBtnDisabled]} onPress={findMatches} disabled={loading}
          accessibilityLabel={t('x_match_find_my_best_matches')}
        >
          {loading
            ? <ActivityIndicator color={colors.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>{t('x_match_find_my_best_matches')}</Text>
          }
        </TouchableOpacity>

        {/* Location label */}
        {locationLabel ? <Text maxFontSizeMultiplier={1.4} style={styles.locLabel}>📍 {locationLabel}</Text> : null}

        {/* Status / error */}
        {statusMsg ? <Text maxFontSizeMultiplier={1.4} style={styles.statusMsg}>{statusMsg}</Text> : null}

        {/* Results */}
        {results.length > 0 && (
          <View style={styles.resultsSection}>
            <Text maxFontSizeMultiplier={1.4} style={styles.resultsHeading}>{t('x_match_top_matches', { length: results.length })}</Text>
            {results.map((item, i) => <MatchCard key={String(item?.name + i)} item={item} rank={i + 1} />)}
          </View>
        )}

        {hasSearched && !loading && results.length === 0 && !statusMsg && (
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyMsg}>{t('x_match_no_matches_found_filters')}</Text>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
      <AIDisclaimer variant="banner" />

    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  header: { backgroundColor: COLORS.navy, padding: 20, paddingTop: 30 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { fontSize: 14, color: COLORS.bgSubtle, marginTop: 4, lineHeight: 20 },
  section: { backgroundColor: COLORS.bgCard, marginTop: 12, marginHorizontal: 12, borderRadius: 12, padding: 16, elevation: 1 },
  sectionLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textOnGold, marginBottom: 8 },
  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 21, color: colors.bgCard, minHeight: 90, textAlignVertical: 'top' },
  pickerWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.bgCard },
  picker: { height: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 12, backgroundColor: COLORS.bgCard, padding: 12, borderRadius: 12 },
  toggle: { width: 36, height: 20, borderRadius: 8, backgroundColor: colors.textMuted, marginRight: 10 },
  toggleOn: { backgroundColor: colors.blue },
  toggleLabel: { fontSize: 12, lineHeight: 20, color: colors.textOnGold },
  searchBtn: { backgroundColor: COLORS.navy, margin: 12, marginTop: 16, padding: 16, borderRadius: 14, alignItems: 'center', elevation: 3 },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  locLabel: { textAlign: 'center', color: colors.textBrand, fontSize: 12, lineHeight: 20, marginTop: 4 },
  statusMsg: { textAlign: 'center', color: colors.info, padding: 12, fontSize: 14,
    lineHeight: 21, },
  resultsSection: { marginTop: 8 },
  resultsHeading: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginHorizontal: 12, marginBottom: 8 },
  emptyMsg: { textAlign: 'center', color: colors.info, padding: 24, fontSize: 14,
    lineHeight: 21, },

  // Card
  card: { marginHorizontal: 12, marginBottom: 14, borderRadius: 14, overflow: 'hidden', elevation: 3, shadowColor: COLORS.bg, shadowOpacity: 0.09, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, backgroundColor: colors.bgCard },
  rankBanner: { padding: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rankText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  rankDist: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  cardBody: { padding: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, flex: 1 },
  ratingPill: { backgroundColor: COLORS.infoBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.steelMid },
  ratingText: { color: COLORS.info, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  address: { fontSize: 12, color: colors.info, marginTop: 4, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  greenBadge: { backgroundColor: colors.legalBg, color: colors.legal, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: colors.legal },
  purpleBadge: { backgroundColor: COLORS.bgSubtle, color: colors.blue, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.steel },
  tealBadge: { backgroundColor: colors.legalBg, color: colors.legal, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: colors.legal },
  verifiedBadge: { backgroundColor: COLORS.bgSubtle, color: COLORS.navy, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.steel },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  specTag: { backgroundColor: COLORS.bgSubtle, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.steel },
  specText: { fontSize: 11, color: COLORS.navy, fontFamily: 'Inter_500Medium', fontWeight: '500' },
  languages: { fontSize: 12, color: colors.textBrand, marginBottom: 4 },
  experience: { fontSize: 12, color: colors.info, fontStyle: 'italic', marginBottom: 8 },
  reportBlock: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: COLORS.navy },
  reportLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.navy, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  reportText: { fontSize: 12, color: colors.textOnGold, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  callBtn: { backgroundColor: colors.legalDark },
  dirBtn: { backgroundColor: COLORS.steelDark },
  webBtn: { backgroundColor: colors.blue },
  actionBtnText: { color: COLORS.white, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  smsBtn: { backgroundColor: colors.blue },
  leaveMessageBtn: {
    borderRadius: 8, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.navy + '55',
    backgroundColor: COLORS.navy + '08', marginTop: 6,
  },
  leaveMessageBtnText: { color: COLORS.navy, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  msgSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
  },
  msgSheetTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 4 },
  msgSheetSub:   { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  msgInput: {
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 16,
    paddingVertical: 11, fontSize: 15, lineHeight: 22, marginBottom: 10,
  },
  msgInputTall: { height: 90, paddingTop: 11 },
  msgSendBtn: {
    backgroundColor: COLORS.navy, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  msgSendBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22, },
  secureMsgBtn:  { borderColor: colors.legal, backgroundColor: colors.legal + '10', marginTop: 4 },

  phoneDisplay: { textAlign: 'center', color: colors.info, fontSize: 12, marginTop: 2 }
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(MatchScreen);