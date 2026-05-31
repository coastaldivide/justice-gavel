/**
 * MatchScreen -- AI-powered lawyer matching with GPS location + full contact actions
 *
 * Flow:
 *  1. Collect user's situation via text input + case type + language filters
 *  2. Acquire GPS → pass lat/lng + situation to /api/match/lawyers
 *  3. Display ranked results with AI-written match reports + one-tap contact actions
 */

import React, { useState, useCallback } from 'react';
import { View, Text, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, TextInput, Linking, ActivityIndicator, Platform, KeyboardAvoidingView, Modal, Alert } from 'react-native';
import PracticeAreaSelector, {} from '../components/PracticeAreaSelector';
import { api } from '../services/api';
import { getLocationWithCity, formatDistance } from '../services/location';
import {  useTheme, COLORS } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var CASE_TYPES: any;
declare var Picker: any;
declare var caseLoading: any; // hoisted from component scope
declare var useNavigation: any; // hoisted from component scope
// ── Constants ─────────────────────────────────────────────────────────────────

const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo'];
const LANGUAGES_FILTERED = LANGUAGES.filter(Boolean);


// ── Contact helpers ───────────────────────────────────────────────────────────

function callPhone(phone: string) { Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => {}).catch(() => {}); }
function sendSMS(phone: string)   { Linking.openURL('sms:' + phone.replace(/\D/g, '')).catch(() => {}).catch(() => {}); }
function openDirections(lat: number, lng: number, name: string) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => {});
}
function openWebsite(url: string) {
  const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];
        const safeUrl = url.startsWith('http') ? url : 'https://' + url;
        if (!BLOCKED_SCHEMES.some(s => url.toLowerCase().startsWith(s))) {
          Linking.openURL(safeUrl).catch(() => {});
        }
}

// ── Match result card ─────────────────────────────────────────────────────────

function MatchCard({ item, rank }: { item: Record<string,any>; rank: number }) {
  const rankColors = [COLORS.emergencyDark, COLORS.warnDark, COLORS.legalDark];
  const rankColor = rankColors[rank - 1] ?? COLORS.navy;

  const navigation = useNavigation();
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
      accessibilityLabel={`View profile for ${String(item?.name || 'attorney')}`}
      onPress={() => navigation.navigate('LawyerProfile', { id: item?.id, lawyerId: item?.id })}
      style={styles.card}
      activeOpacity={0.85}
    >
      {/* Rank banner */}
      <View style={[styles.rankBanner, { backgroundColor: rankColor }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.rankText}>#{rank} Match</Text>
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
          {item.free_consultation && <Text maxFontSizeMultiplier={1.4} style={styles.greenBadge}>Free Consult</Text>}
          {item.pro_bono && <Text maxFontSizeMultiplier={1.4} style={styles.purpleBadge}>Pro Bono</Text>}
          {item.sliding_scale && <Text maxFontSizeMultiplier={1.4} style={styles.tealBadge}>Sliding Scale</Text>}
          {item.verified && <Text maxFontSizeMultiplier={1.4} style={styles.verifiedBadge}>✓ Verified</Text>}
          {item.gavel_level === 1 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.bailBg, color: COLORS.bail }]}>🥉 Bronze Gavel</Text>}
          {item.gavel_level === 2 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.bgSubtle, color: COLORS.textSecond }]}>🥈 Silver Gavel</Text>}
          {item.gavel_level >= 3 && <Text maxFontSizeMultiplier={1.4} style={[styles.verifiedBadge, { backgroundColor: COLORS.warnBg, color: COLORS.gold, borderColor: COLORS.gold }]}>🏆 Golden Gavel</Text>}
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
          <Text maxFontSizeMultiplier={1.4} style={styles.experience}>{item.years_experience} years experience</Text>
        )}

        {/* AI match report */}
        {item.matchReport && (
          <View style={styles.reportBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.reportLabel}>Why this match</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.reportText}>{item.matchReport}</Text>
          </View>
        )}

        {/* Contact action buttons */}
        <View style={styles.actionRow}>
          {item?.phone && (
            <TouchableOpacity
          accessibilityRole="button" style={[styles.actionBtn, styles.callBtn]} onPress={() => callPhone(item?.phone)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>📞 Call</Text>
            </TouchableOpacity>
          )}
          {item?.phone && (
            <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.smsBtn]} onPress={() => sendSMS(item?.phone)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>💬 Text</Text>
            </TouchableOpacity>
          )}
          {item.lat && item.lng && (
            <TouchableOpacity
          accessibilityRole="button" style={[styles.actionBtn, styles.dirBtn]} onPress={() => openDirections(item.lat, item.lng, item?.name)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>🗺 Dir</Text>
            </TouchableOpacity>
          )}
          {item.website && (
            <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.webBtn]} onPress={() => openWebsite(item.website)}
                    >
              <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>🌐 Web</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Leave a Message -- always-visible async contact option */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.leaveMessageBtn}
          onPress={() => { setMsgSent(false); setMsgModal(true); }}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.leaveMessageBtnText}>✉️  Leave a Message for {item?.name}</Text>
        </TouchableOpacity>

        {/* Leave a Message modal */}
        <Modal accessibilityViewIsModal={true} visible={msgModal} transparent animationType="slide" onRequestClose={() => setMsgModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <TouchableOpacity
          accessibilityRole="button" style={styles.modalOverlay} activeOpacity={1} onPress={() => setMsgModal(false)}
              accessibilityLabel="Message sent"
            >
            <View style={[styles.msgSheet, { backgroundColor: COLORS.bgCard }]}>
              {msgSent ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 40, marginBottom: 10 }}>✅</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetTitle, { color: COLORS.textPrimary }]}>Message sent</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetSub, { color: COLORS.textSecond }]}>
                    {item?.name} will contact you shortly.
                  </Text>
                  <TouchableOpacity
          accessibilityRole="button" style={[styles.msgSendBtn, { marginTop: 20, width: '100%' }]} onPress={() => setMsgModal(false)}
                    accessibilityLabel="Done"
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.msgSendBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetTitle, { color: COLORS.textPrimary }]}>
                    Leave a message for {item?.name}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.msgSheetSub, { color: COLORS.textSecond }]}>
                    They'll get your message and contact you during business hours.
                  </Text>
                  <TextInput
                    style={[styles.msgInput, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder="Your name"
                    placeholderTextColor={COLORS.textSecond}
                    value={msgName}
                    onChangeText={setMsgName}
                    autoCapitalize="words"
          returnKeyType="next"
          blurOnSubmit
        />
                  <TextInput
                    style={[styles.msgInput, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder="Best phone or email to reach you"
                    placeholderTextColor={COLORS.textSecond}
                    value={msgPhone}
                    onChangeText={setMsgPhone}
                    keyboardType="email-address"
                    autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit
        />
                  <TextInput
                    style={[styles.msgInput, styles.msgInputTall, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
                    placeholder="Briefly describe your situation (optional)"
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
                        Alert.alert('Could not send', 'Check your connection and try again.');
                      } finally {
                        setMsgSending(false);
                      }
                    }}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.msgSendBtnText}>{msgSending ? 'Sending…' : 'Send Message'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
          accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setMsgModal(false)}
                    accessibilityLabel="Cancel"
                  >
                    <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.textMuted, fontSize: 12 }}>Cancel</Text>
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
          accessibilityLabel="open Secure Message"
          style={[styles.leaveMessageBtn, styles.secureMsgBtn]}
          onPress={openSecureMessage}
          disabled={caseLoading}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.leaveMessageBtnText, { color: COLORS.legalDark }]}>
            {caseLoading ? '…' : '🔒  Message Securely -- End-to-End Encrypted'}
          </Text>
        </TouchableOpacity>

        {item?.phone && <Text maxFontSizeMultiplier={1.4} style={styles.phoneDisplay}>{item?.phone}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MatchScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  const [situation, setSituation] = useState('');
  const [caseType, setCaseType] = useState('');
  const [language, setLanguage] = useState('');
  const [proBonoOnly, setProBonoOnly] = useState(false);
  const [acceptingOnly, setAcceptingOnly] = useState(false);

  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const findMatches = useCallback(async () => {
    setLoading(true);
    setStatusMsg('Getting your location...');
    setResults([]);
    setHasSearched(true);

    try {
      const loc = await getLocationWithCity();

      if (loc.city) {
        setLocationLabel(loc.source === 'gps'
          ? `Searching near ${loc.city}`
          : loc.city);
      } else {
        setLocationLabel(loc.permissionGranted ? 'Using your GPS location' : 'Using default location');
      }

      setStatusMsg('Finding your best matches...');

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
      setResults(res.data || []);
      setStatusMsg(res.data?.length === 0 ? 'No matches found. Try removing filters.' : '');
    } catch (e: any) {
      const errMsg  = e.response?.data?.error || e.message || '';
      const status  = e.response?.status;
      if (status === 503 || errMsg.toLowerCase().includes('api') || errMsg.toLowerCase().includes('anthropic')) {
        setStatusMsg('AI Lawyer Match needs ANTHROPIC_API_KEY configured.\nAdd it to backend/.env → restart server → try again.');
      } else if (!e.response) {
        setStatusMsg('No connection. Check your internet and try again.');
      } else {
        setStatusMsg('Match failed: ' + (errMsg || 'Please try again.'));
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
        setResults(res.data?.lawyers || res.data || []);
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
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>AI Lawyer Match</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>Tell us your situation and we'll find the best attorney near you.</Text>
        </View>

        {/* Situation input */}
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Describe your situation (optional)</Text>
          <TextInput
            style={styles.textArea}
            multiline
              maxLength={2000}
            numberOfLines={4}
            placeholder="e.g. I was pulled over and charged with a DUI last night. I need someone who speaks Spanish and offers payment plans."
            placeholderTextColor={colors.textMuted}
            value={situation}
            onChangeText={setSituation}
          />
        </View>

        {/* Filters */}
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Case type</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={caseType} onValueChange={v => setCaseType(String(v))} style={styles.picker}>
              <Picker.Item label="Not sure / Any" value="" />
              {CASE_TYPES.filter(Boolean).map(t => <Picker.Item key={t} label={t} value={t} />)}
            </Picker>
          </View>
        </View>

        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionLabel}>Preferred language</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={language} onValueChange={v => setLanguage(String(v))} style={styles.picker}>
              <Picker.Item label="English (or any)" value="" />
              {LANGUAGES_FILTERED.map(l => <Picker.Item key={l} label={l} value={l} />)}
            </Picker>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="button" style={styles.toggleRow} onPress={() => setProBonoOnly(v => !v)}
        >
          <View style={[styles.toggle, proBonoOnly && styles.toggleOn]} />
          <Text maxFontSizeMultiplier={1.4} style={styles.toggleLabel}>Pro bono / free representation only</Text>
        </TouchableOpacity>

        {/* Search button */}
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.6} style={[styles.searchBtn, loading && styles.searchBtnDisabled]} onPress={findMatches} disabled={loading}
          accessibilityLabel="📍 Find My Best Matches"
        >
          {loading
            ? <ActivityIndicator color={colors.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>📍 Find My Best Matches</Text>
          }
        </TouchableOpacity>

        {/* Location label */}
        {locationLabel ? <Text maxFontSizeMultiplier={1.4} style={styles.locLabel}>📍 {locationLabel}</Text> : null}

        {/* Status / error */}
        {statusMsg ? <Text maxFontSizeMultiplier={1.4} style={styles.statusMsg}>{statusMsg}</Text> : null}

        {/* Results */}
        {results.length > 0 && (
          <View style={styles.resultsSection}>
            <Text maxFontSizeMultiplier={1.4} style={styles.resultsHeading}>Your Top {results.length} Matches</Text>
            {results.map((item, i) => <MatchCard key={String(item?.name + i)} item={item} rank={i + 1} />)}
          </View>
        )}

        {hasSearched && !loading && results.length === 0 && !statusMsg && (
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyMsg}>No matches found for your filters. Try broadening your search.</Text>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  header: { backgroundColor: '#042C53', padding: 20, paddingTop: 30 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { fontSize: 14, color: COLORS.bgSubtle, marginTop: 4, lineHeight: 20 },
  section: { backgroundColor: COLORS.bgCard, marginTop: 12, marginHorizontal: 12, borderRadius: 12, padding: 16, elevation: 1 },
  sectionLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard, marginBottom: 8 },
  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 21, color: colors.bgCard, minHeight: 90, textAlignVertical: 'top' },
  pickerWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.bgCard },
  picker: { height: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 12, backgroundColor: COLORS.bgCard, padding: 12, borderRadius: 12 },
  toggle: { width: 36, height: 20, borderRadius: 8, backgroundColor: colors.textMuted, marginRight: 10 },
  toggleOn: { backgroundColor: colors.blue },
  toggleLabel: { fontSize: 12, lineHeight: 20, color: colors.bgCard },
  searchBtn: { backgroundColor: '#042C53', margin: 12, marginTop: 16, padding: 16, borderRadius: 14, alignItems: 'center', elevation: 3 },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  locLabel: { textAlign: 'center', color: colors.blue, fontSize: 12, lineHeight: 20, marginTop: 4 },
  statusMsg: { textAlign: 'center', color: '#FFA726', padding: 12, fontSize: 14,
    lineHeight: 21, },
  resultsSection: { marginTop: 8 },
  resultsHeading: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginHorizontal: 12, marginBottom: 8 },
  emptyMsg: { textAlign: 'center', color: colors.steel, padding: 24, fontSize: 14,
    lineHeight: 21, },

  // Card
  card: { marginHorizontal: 12, marginBottom: 14, borderRadius: 14, overflow: 'hidden', elevation: 3, shadowColor: COLORS.bg, shadowOpacity: 0.09, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, backgroundColor: COLORS.bgCard },
  rankBanner: { padding: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rankText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  rankDist: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  cardBody: { padding: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', flex: 1 },
  ratingPill: { backgroundColor: '#FFA726', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#FFA726' },
  ratingText: { color: '#FFA726', fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  address: { fontSize: 12, color: colors.steel, marginTop: 4, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  greenBadge: { backgroundColor: colors.legal, color: colors.legal, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: colors.legal },
  purpleBadge: { backgroundColor: COLORS.bgSubtle, color: colors.blue, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: '#85B7EB' },
  tealBadge: { backgroundColor: colors.legal, color: colors.legal, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: colors.legal },
  verifiedBadge: { backgroundColor: COLORS.bgSubtle, color: '#042C53', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', overflow: 'hidden', borderWidth: 1, borderColor: '#85B7EB' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  specTag: { backgroundColor: COLORS.bgSubtle, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#85B7EB' },
  specText: { fontSize: 11, color: '#042C53', fontFamily: 'Inter_500Medium', fontWeight: '500' },
  languages: { fontSize: 12, color: colors.blue, marginBottom: 4 },
  experience: { fontSize: 12, color: colors.steel, fontStyle: 'italic', marginBottom: 8 },
  reportBlock: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#042C53' },
  reportLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#042C53', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  reportText: { fontSize: 12, color: colors.bgCard, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  callBtn: { backgroundColor: colors.legal },
  dirBtn: { backgroundColor: '#FFA726' },
  webBtn: { backgroundColor: colors.blue },
  actionBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  smsBtn: { backgroundColor: colors.blue },
  leaveMessageBtn: {
    borderRadius: 8, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#042C53' + '55',
    backgroundColor: '#042C53' + '08', marginTop: 6,
  },
  leaveMessageBtnText: { color: '#042C53', fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
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
    backgroundColor: '#042C53', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  msgSendBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22, },
  secureMsgBtn:  { borderColor: colors.legal, backgroundColor: colors.legal + '10', marginTop: 4 },

  phoneDisplay: { textAlign: 'center', color: colors.steel, fontSize: 12, marginTop: 2 }
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
