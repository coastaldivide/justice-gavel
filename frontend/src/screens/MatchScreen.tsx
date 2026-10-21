/**
 * MatchScreen — "AI lawyer match": the three best directory lawyers for the
 * person's situation, nearest first from their location (or the place they
 * type when location is off), with a short report on why each fits.
 *
 * GET /match/lawyers answers with a job (the AI writes the reports); the app
 * polls /jobs/:id. Without an AI key the server writes factual reports from
 * the listing itself. Every card: call / text / directions / website, profile.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Picker } from '@react-native-picker/picker';
import { AIDisclaimer } from '../components/AIDisclaimer';
import { ContactActions } from '../components/ContactActions';
import { PRACTICE_AREAS } from '../components/PracticeAreaSelector';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { pollJob } from '../services/jobPoller';
import { getLocationWithCity, formatDistance } from '../services/location';
import { useTheme, COLORS } from '../constants/theme';
import { t, useLang } from '../i18n';
import type { DirectoryLawyer } from './LawyersScreen';
import { IconLabel, ICONS } from '../components/AppIcon';

// Language values as lawyer profiles store them (English); the picker shows langLabel().
const LANGUAGES = ['Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'Hmong', 'Navajo']; // i18n-exempt: stored values
const langLabel = (l: string): string => t(`lang_name_${l.toLowerCase()}`);

type Match = DirectoryLawyer & { rank: number; matchReport?: string | null };

function MatchCard({ item }: { item: Match }) {
  useLang();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const rankColors = [COLORS.emergencyDark, COLORS.warnDark, COLORS.legalDark];
  const openProfile = () => navigation.navigate('LawyerProfile', { lawyerId: item.id });
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }]} testID="match-card">
      <View style={[styles.rankBanner, { backgroundColor: rankColors[item.rank - 1] ?? COLORS.navy }]}>
        <Text maxFontSizeMultiplier={1.3} style={styles.rankText}>{t('x_match_match', { rank: item.rank })}</Text>
        {item.distanceKm != null && <IconLabel icon={ICONS.location} textStyle={styles.rankDist} maxFontSizeMultiplier={1.3}>{formatDistance(item.distanceKm)}</IconLabel>}
      </View>
      <View style={styles.cardBody}>
        <TouchableOpacity accessibilityRole="link" onPress={openProfile} accessibilityLabel={t('x_match_view_profile', { value: item.name })}>
          <View style={styles.nameRow}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.name, { color: colors.textBrand }]}>{item.name}</Text>
            {item.rating != null && <Text maxFontSizeMultiplier={1.3} style={[styles.rating, { color: colors.textPrimary }]}>{item.rating.toFixed(1)} ★</Text>}
          </View>
          {!!item.address && <Text maxFontSizeMultiplier={1.3} style={[styles.address, { color: colors.textMuted }]}>{item.address}</Text>}
        </TouchableOpacity>
        <View style={styles.badgeRow}>
          {item.free_consultation && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, { color: colors.legal, borderColor: colors.legal, backgroundColor: colors.legalBg }]}>{t('x_lawyers_free_consult')}</Text>}
          {item.pro_bono && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, { color: colors.textSecond, borderColor: colors.border }]}>{t('x_lawyers_pro_bono')}</Text>}
          {item.sliding_scale && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, { color: colors.textSecond, borderColor: colors.border }]}>{t('x_lawyers_sliding_scale')}</Text>}
          {item.open_24_7 ? <Text maxFontSizeMultiplier={1.3} style={[styles.badge, { color: colors.legal, borderColor: colors.legal, backgroundColor: colors.legalBg }]}>{t('lw_open_24_7')}</Text>
            : item.open_now != null && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, { color: item.open_now ? colors.legalDark : colors.textMuted, borderColor: colors.border }]}>{item.open_now ? t('lw_open_now') : t('lw_closed_now')}</Text>}
        </View>
        {!!item.matchReport && (
          <View style={[styles.reportBlock, { backgroundColor: colors.bg, borderLeftColor: colors.navy }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.reportLabel, { color: colors.textBrand }]}>{t('x_match_why_this_match')}</Text>
            <Text testID="match-report" maxFontSizeMultiplier={1.3} style={[styles.reportText, { color: colors.textPrimary }]}>{item.matchReport}</Text>
          </View>
        )}
        <ContactActions listing={item} />
        <TouchableOpacity accessibilityRole="button" testID="match-open-profile" onPress={openProfile} style={[styles.profileBtn, { borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.profileBtnText, { color: colors.textBrand }]}>{item.on_app ? t('mt_profile_book') : t('lw_profile')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MatchScreen(): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const [situation, setSituation] = useState('');
  const [caseType, setCaseType] = useState('');
  const [language, setLanguage] = useState('');
  const [proBonoOnly, setProBonoOnly] = useState(false);
  const [placeText, setPlaceText] = useState('');
  const [locationOff, setLocationOff] = useState(false);
  const [results, setResults] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const findMatches = useCallback(async () => {
    setLoading(true);
    setResults([]);
    setStatusMsg(t('x_match_getting_location'));
    try {
      const params: Record<string, unknown> = { limit: 3 };
      if (caseType) params.caseType = caseType;
      if (language) params.language = language;
      if (proBonoOnly) params.proBonoOnly = true;
      if (situation.trim()) params.situation = situation.trim();
      if (placeText.trim()) {
        params.city = placeText.trim();
        setLocationLabel(t('lw_results_for', { q: placeText.trim() }));
      } else {
        const loc = await getLocationWithCity({ reason: t('lw_location_reason') });
        if (!(loc.permissionGranted && loc.source === 'gps')) {
          setLocationOff(true);
          setLocationLabel('');
          setStatusMsg(t('mt_need_place'));
          return;
        }
        setLocationOff(false);
        params.lat = loc.lat; params.lng = loc.lng;
        setLocationLabel(loc.city ? t('x_match_searching_near', { city: loc.city }) : t('x_match_using_gps_location'));
      }
      setStatusMsg(t('x_match_finding_best_matches'));
      const res = await api.get('/match/lawyers', { params });
      const body = res.data as { jobId?: string; matches?: Match[]; message?: string };
      let matches: Match[];
      if (body?.jobId) {
        const job = await pollJob(body.jobId, { timeoutMs: 90_000 });
        matches = unwrapList<Match>(job.result, 'matches');
      } else {
        matches = unwrapList<Match>(body, 'matches');
      }
      setResults(matches);
      setStatusMsg(matches.length ? '' : (body?.message || t('x_match_no_matches_found_try')));
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.data?.error === 'ai_unavailable') setStatusMsg(t('x_match_ai_lawyer_matching_temporarily'));
      else if (!err.response) setStatusMsg(t('x_ch_no_connection_check_internet'));
      else setStatusMsg(apiErrorMessage(e, t('x_consumer_subscription_please_try_again')));
    } finally {
      setLoading(false);
    }
  }, [situation, caseType, language, proBonoOnly, placeText]);

  const onRefresh = useCallback(async () => {
    if (!results.length) return;
    setRefreshing(true);
    await findMatches();
    setRefreshing(false);
  }, [results.length, findMatches]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled" testID="match-screen"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={1.3} style={styles.heading}>{t('x_match_ai_lawyer_match')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.subheading}>{t('x_match_tell_us_situation_we')}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionLabel, { color: colors.textPrimary }]}>{t('x_match_describe_situation_optional')}</Text>
          <TextInput testID="match-situation" accessibilityLabel={t('x_match_describe_situation_optional')}
            style={[styles.textArea, { borderColor: colors.inputBorder, color: colors.inputText, backgroundColor: colors.inputBg }]}
            multiline maxLength={500} numberOfLines={4} placeholder={t('x_match_e_g_i_was')} placeholderTextColor={colors.placeholder}
            value={situation} onChangeText={setSituation} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>{t('mt_privacy')}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionLabel, { color: colors.textPrimary }]}>{t('mt_place_label')}</Text>
          <TextInput testID="match-place" accessibilityLabel={t('mt_place_label')}
            style={[styles.input, { borderColor: locationOff ? colors.emergency : colors.inputBorder, color: colors.inputText, backgroundColor: colors.inputBg }]}
            placeholder={t('lw_search_placeholder')} placeholderTextColor={colors.placeholder} value={placeText} onChangeText={setPlaceText}
            returnKeyType="search" onSubmitEditing={findMatches} maxLength={100} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.hint, { color: colors.textMuted }]}>{t('mt_place_hint')}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionLabel, { color: colors.textPrimary }]}>{t('x_lawyers_case_type')}</Text>
          <View style={[styles.pickerWrap, { borderColor: colors.border }]}>
            <Picker testID="match-case-type" selectedValue={caseType} onValueChange={v => setCaseType(String(v))} style={[styles.picker, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}>
              <Picker.Item label={t('x_match_not_sure_any')} value="" />
              {PRACTICE_AREAS().map(a => <Picker.Item key={a.key} label={a.label} value={a.key} />)}
            </Picker>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionLabel, { color: colors.textPrimary, marginTop: 12 }]}>{t('x_match_preferred_language')}</Text>
          <View style={[styles.pickerWrap, { borderColor: colors.border }]}>
            <Picker testID="match-language" selectedValue={language} onValueChange={v => setLanguage(String(v))} style={[styles.picker, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}>
              <Picker.Item label={t('x_match_english_any')} value="" />
              {LANGUAGES.map(l => <Picker.Item key={l} label={langLabel(l)} value={l} />)}
            </Picker>
          </View>
          <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: proBonoOnly }} style={styles.toggleRow} onPress={() => setProBonoOnly(v => !v)}>
            <View style={[styles.toggle, { backgroundColor: proBonoOnly ? colors.navy : colors.border }]}><View style={[styles.knob, proBonoOnly && styles.knobOn]} /></View>
            <Text maxFontSizeMultiplier={1.3} style={[styles.toggleLabel, { color: colors.textPrimary }]}>{t('x_lawyers_pro_bono_free_representation')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity accessibilityRole="button" testID="match-submit" style={[styles.searchBtn, loading && { opacity: 0.6 }]} onPress={findMatches} disabled={loading}
          accessibilityLabel={t('x_match_find_my_best_matches')}>
          {loading ? <ActivityIndicator color={COLORS.white} /> : <IconLabel icon={ICONS.location} textStyle={styles.searchBtnText} maxFontSizeMultiplier={1.3}>{t('x_match_find_my_best_matches')}</IconLabel>}
        </TouchableOpacity>

        {!!locationLabel && <IconLabel icon={ICONS.location} textStyle={[styles.locLabel, { color: colors.textBrand }]} maxFontSizeMultiplier={1.3}>{locationLabel}</IconLabel>}
        {!!statusMsg && <Text testID="match-status" maxFontSizeMultiplier={1.3} style={[styles.statusMsg, { color: colors.textSecond }]}>{statusMsg}</Text>}

        {results.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.resultsHeading, { color: colors.textBrand }]}>{t('x_match_top_matches', { length: results.length })}</Text>
            {results.map(item => <MatchCard key={item.id} item={item} />)}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
      <AIDisclaimer variant="banner" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: COLORS.navy, padding: 20, paddingTop: 24 },
  heading: { fontSize: 26, lineHeight: 32, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.white },
  subheading: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 20 },
  section: { marginTop: 12, marginHorizontal: 12, borderRadius: 12, padding: 14 },
  sectionLabel: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 8 },
  textArea: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 21, minHeight: 90, textAlignVertical: 'top' },
  input: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  pickerWrap: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  picker: { height: 44, borderWidth: 0, paddingHorizontal: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  toggle: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.white },
  knobOn: { transform: [{ translateX: 20 }] },
  toggleLabel: { fontSize: 13, lineHeight: 19, flex: 1 },
  searchBtn: { backgroundColor: COLORS.navy, margin: 12, marginTop: 16, padding: 16, borderRadius: 14, alignItems: 'center', minHeight: 52 },
  searchBtnText: { color: COLORS.white, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  locLabel: { textAlign: 'center', fontSize: 12, lineHeight: 20, marginTop: 4 },
  statusMsg: { textAlign: 'center', padding: 12, fontSize: 14, lineHeight: 21 },
  resultsHeading: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginHorizontal: 12, marginBottom: 8 },
  card: { marginHorizontal: 12, marginBottom: 14, borderRadius: 14, overflow: 'hidden' },
  rankBanner: { padding: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rankText: { color: COLORS.white, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14, lineHeight: 21 },
  rankDist: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  cardBody: { padding: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  rating: { fontSize: 13, fontWeight: '700' },
  address: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '600', borderWidth: 1, overflow: 'hidden' },
  reportBlock: { borderRadius: 8, padding: 12, marginTop: 10, borderLeftWidth: 3 },
  reportLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  reportText: { fontSize: 13, lineHeight: 20 },
  profileBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8, minHeight: 44, justifyContent: 'center' },
  profileBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});

export default React.memo(MatchScreen);
