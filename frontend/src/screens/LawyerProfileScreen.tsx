/**
 * LawyerProfileScreen — one directory listing (GET /providers/lawyers/:id).
 *
 * Contact (call / text / directions / website), opening hours in the app's
 * language, practice areas, languages, Justice Gavel client reviews (write one,
 * report one), save (synced with the saved list) and share. Booking and in-app
 * messages only when the lawyer is on Justice Gavel (`on_app`).
 *
 * Params: { lawyerId } (deep link attorney/:lawyerId).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../components/ToastProvider';
import { ContactActions } from '../components/ContactActions';
import { useAuthGate } from '../components/AuthGate';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, RNShare } from '../utils/webCompat';
import Analytics from '../services/analytics';
import { t, useLang, locale } from '../i18n';
import { formatPhone, websiteLabel } from '../utils/contact';
import { parseWeek, weekdayName, clock } from '../utils/hours';
import * as secureStorage from '../utils/secureStorage';

type Review = { id: number; rating: number; comment?: string | null; verified?: number; created_at?: string; status?: string };
type Profile = {
  id: number; name: string; firm?: string | null; phone?: string | null; address?: string | null; city?: string | null; state?: string | null;
  lat?: number | null; lng?: number | null; website?: string | null; rating?: number | null; reviews?: number | null;
  specialties: string[]; languages: string[]; bio?: string | null; years_experience?: number | null;
  bar_number?: string | null; bar_state?: string | null; bar_verified: boolean; jtb_verified: boolean; golden_gavel: boolean;
  free_consultation: boolean; pro_bono: boolean; sliding_scale: boolean; seed_data: boolean; source?: string | null;
  on_app: boolean; hours?: string | null; open_now?: boolean | null; open_24_7?: boolean;
  app_reviews?: { avg_rating: number | null; count: number };
};
type JtbProfile = { is_jtb_registered: boolean; platform_rating?: number | null; platform_review_count?: number | null; outcome_positive_pct?: number | null; next_slots?: { date: string; time: string; starts_at: string }[] };

const REPORT_REASONS = ['false', 'offensive', 'private_info', 'spam', 'other'] as const;

// Listing values are stored in English; the known ones are shown in the app's language.
const AREA_KEYS: Record<string, string> = { 'criminal law': 'lp_area_criminal_law', 'criminal defense': 'lp_area_criminal_defense' };
const areaLabel = (sp: string) => (AREA_KEYS[sp.toLowerCase()] ? t(AREA_KEYS[sp.toLowerCase()]) : sp);
const KNOWN_LANGUAGES = new Set(['english', 'spanish', 'arabic', 'mandarin', 'vietnamese', 'hmong', 'navajo']);
const languageLabel = (l: string) => (KNOWN_LANGUAGES.has(l.toLowerCase()) ? t(`lang_name_${l.toLowerCase()}`) : l);

function LawyerProfileScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const lawyerId = Number((route?.params as { lawyerId?: number | string } | undefined)?.lawyerId);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [lawyer, setLawyer] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<null | 'notfound' | 'network'>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [mine, setMine] = useState<Review | null>(null);
  const [jtb, setJtb] = useState<JtbProfile | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [userRating, setUserRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reportFor, setReportFor] = useState<number | null>(null);
  const [showMsg, setShowMsg] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);

  const loadReviews = useCallback(async () => {
    const r = await api.get('/reviews', { params: { entity_type: 'lawyer', entity_id: lawyerId } }).catch(() => null);
    if (!r || !mountedRef.current) return;
    setReviews(unwrapList<Review>(r.data, 'reviews'));
    setMine((r.data as { mine?: Review | null })?.mine || null);
  }, [lawyerId]);

  const load = useCallback(async () => {
    if (!Number.isFinite(lawyerId) || lawyerId <= 0) { setLoadError('notfound'); setLoading(false); return; }
    try {
      const res = await api.get<Profile>(`/providers/lawyers/${lawyerId}`);
      if (!mountedRef.current) return;
      setLawyer(res.data);
      setLoadError(null);
      navigation.setOptions({ title: res.data.name || t('x_nav_attorney_profile') });
      if (res.data.on_app) api.get<JtbProfile>(`/match/profile/${lawyerId}`).then(r => mountedRef.current && setJtb(r.data)).catch(() => {});
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (mountedRef.current) setLoadError(status === 404 || status === 400 ? 'notfound' : 'network');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    loadReviews();
  }, [lawyerId, navigation, loadReviews]);
  useEffect(() => { load(); }, [load]);

  const loadSaved = useCallback(async () => {
    if (!(await secureStorage.getToken().catch(() => null))) { setSavedId(null); return; }
    const r = await api.get('/saved/lawyers').catch(() => null);
    if (!r || !mountedRef.current) return;
    const s = unwrapList<{ id: number; provider_id: number | null }>(r.data, 'lawyers').find(x => Number(x.provider_id) === lawyerId);
    setSavedId(s ? s.id : null);
  }, [lawyerId]);
  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved]));

  const viewedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lawyer || viewedRef.current === lawyer.id) return;
    viewedRef.current = lawyer.id;
    Analytics.lawyerView(lawyer.id, lawyer.city || '', (lawyer.specialties || []).join(', '));
  }, [lawyer]);

  const onRefresh = () => { setRefreshing(true); Promise.all([load(), loadSaved()]).finally(() => mountedRef.current && setRefreshing(false)); };

  const savingRef = useRef(false);
  const toggleSave = async () => {
    // Ref guard: a second tap before the re-render must not post twice.
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (!(await secureStorage.getToken().catch(() => null))) { requireAuth(() => undefined); return; }
      await doToggleSave();
    } finally {
      savingRef.current = false;
    }
  };
  const doToggleSave = async () => {
    if (!lawyer) return;
    hapticImpact().catch(() => undefined);
    setSaving(true);
    try {
      if (savedId) {
        await api.delete(`/saved/lawyers/${savedId}`).catch((e) => { if (e?.response?.status !== 404) throw e; });
        setSavedId(null);
        showToast(t('lw_unsaved_toast'), 'info');
      } else {
        const r = await api.post('/saved/lawyers', { provider_id: lawyer.id });
        setSavedId(Number(r.data?.id) || null);
        showToast(t('x_lawyer_profile_saved_attorneys', { name: lawyer.name }), 'success');
      }
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_lawyer_profile_could_not_save_attorney')), 'error');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const share = async () => {
    if (!lawyer) return;
    try {
      const res = await RNShare.share({
        title: lawyer.name,
        message: t('x_lawyer_profile_attorney_city_find_legal', { name: lawyer.name, city: lawyer.city || '', state: lawyer.state || '', value: lawyer.phone ? t('x_lawyer_profile_phone', { phone: formatPhone(lawyer.phone) }) + '\n' : '' }),
        url: lawyer.website || `https://justicegavel.app/attorney/${lawyer.id}`,
      });
      if ((res as { action?: string } | undefined)?.action === 'copiedAction') showToast(t('lp_copied'), 'success');
    } catch { /* share sheet dismissed */ }
  };

  const submitReview = () => requireAuth(async () => {
    if (userRating === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post('/reviews', { entity_type: 'lawyer', entity_id: lawyerId, rating: userRating, comment: reviewText.trim() });
      setShowReview(false);
      setReviewText(''); setUserRating(0);
      setReviewNote(String(res.data?.message || t('x_lawyer_profile_thanks_review_was_posted')));
      await loadReviews();
    } catch (e) {
      showToast(apiErrorMessage(e, t('lp_review_failed')), 'error');
      if ((e as { response?: { status?: number } })?.response?.status === 409) { setShowReview(false); loadReviews(); }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  });

  const report = (reviewId: number, reason: string) => requireAuth(async () => {
    try {
      const r = await api.post(`/reviews/${reviewId}/report`, { reason });
      showToast(String(r.data?.message || t('lp_reported')), 'success');
    } catch (e) {
      showToast(apiErrorMessage(e, t('lp_report_failed')), 'error');
    } finally {
      setReportFor(null);
    }
  });

  const sendMessage = () => requireAuth(async () => {
    if (!msgText.trim() || !lawyer) return;
    setMsgSending(true);
    try {
      const r = await api.post('/messages/bulk', { lawyer_ids: [lawyer.id], message: msgText.trim() });
      if (Number(r.data?.sent) > 0) { showToast(t('lp_message_sent', { name: lawyer.name }), 'success'); setShowMsg(false); setMsgText(''); }
      else showToast(t('consult_not_on_app'), 'info');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_lawyers_send_failed_check_connection')), 'error');
    } finally {
      if (mountedRef.current) setMsgSending(false);
    }
  });

  const s = makeStyles();
  if (loading) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.navy} size="large" /></View>;
  if (!lawyer) return (
    <View testID="lawyer-profile-unavailable" style={[s.center, { backgroundColor: colors.bg, padding: 32 }]}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16, color: colors.textMuted, textAlign: 'center' }}>
        {loadError === 'network' ? t('x_lawyer_profile_could_not_load_this') : t('x_lawyer_profile_attorney_profile_not_available')}
      </Text>
      {loadError === 'network' && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('try_again')} onPress={() => { setLoading(true); load(); }}
          style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 12, minHeight: 44, borderRadius: 10, backgroundColor: colors.navy }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.white, fontWeight: '700' }}>{t('try_again')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const week = parseWeek(lawyer.hours);
  const loc = locale();
  const appAvg = lawyer.app_reviews?.avg_rating;
  const appCount = lawyer.app_reviews?.count ?? 0;

  return (
    <ScrollView testID="lawyer-profile-screen" style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 40, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} keyboardShouldPersistTaps="handled">
      <AuthGateModal />
      <View style={[s.header, { backgroundColor: COLORS.navy }]}>
        <View style={s.avatar}><Text maxFontSizeMultiplier={1.2} style={s.avatarText}>{(lawyer.name || '?').charAt(0).toUpperCase()}</Text></View>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={3} style={s.name}>{lawyer.name}</Text>
        {!!lawyer.firm && <Text maxFontSizeMultiplier={1.3} style={s.address}>{lawyer.firm}</Text>}
        {!!lawyer.address && <Text maxFontSizeMultiplier={1.3} style={s.address}>{lawyer.address}</Text>}
        <View style={s.badges}>
          {lawyer.source === 'google' && <View style={s.badge}><Text maxFontSizeMultiplier={1.3} style={s.badgeText}>{t('lp_source_google')}</Text></View>}
          {lawyer.bar_verified && <View style={s.badge}><Text maxFontSizeMultiplier={1.3} style={s.badgeText}>{t('x_expungement_bar_verified')}</Text></View>}
          {lawyer.jtb_verified && <View style={[s.badge, { backgroundColor: COLORS.gold }]}><Text maxFontSizeMultiplier={1.3} style={[s.badgeText, { color: COLORS.navy }]}>{t('x_lawyer_profile_jtb_verified')}</Text></View>}
          {lawyer.golden_gavel && <View style={s.badge}><Text maxFontSizeMultiplier={1.3} style={s.badgeText}>{t('x_nav_golden_gavel')}</Text></View>}
          {lawyer.on_app && <View style={s.badge}><Text maxFontSizeMultiplier={1.3} style={s.badgeText}>{t('lp_on_app')}</Text></View>}
        </View>
      </View>

      {lawyer.seed_data && (
        <View style={[s.notice, { backgroundColor: colors.warnBg, borderColor: colors.gold }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontWeight: '700', color: colors.warnDark }}>{t('x_lawyer_profile_profile_information_pending_verifica')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.warnDark }}>{t('x_lawyer_profile_this_attorney_has_not')}</Text>
        </View>
      )}

      <View style={[s.statsRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {lawyer.rating != null && lawyer.rating > 0 && (
          <View style={s.stat} testID="lp-google-rating">
            <Text maxFontSizeMultiplier={1.3} style={[s.statValue, { color: colors.textPrimary }]}>{lawyer.rating.toFixed(1)}★</Text>
            <Text maxFontSizeMultiplier={1.3} style={[s.statLabel, { color: colors.textMuted }]}>{t(lawyer.reviews === 1 ? 'lp_google_reviews_one' : 'lp_google_reviews', { count: lawyer.reviews ?? 0 })}</Text>
          </View>
        )}
        {appCount > 0 && appAvg != null && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.3} style={[s.statValue, { color: colors.textPrimary }]}>{appAvg.toFixed(1)}★</Text>
            <Text maxFontSizeMultiplier={1.3} style={[s.statLabel, { color: colors.textMuted }]}>{t(appCount === 1 ? 'lp_app_reviews_one' : 'lp_app_reviews', { count: appCount })}</Text>
          </View>
        )}
        {!!lawyer.years_experience && lawyer.years_experience > 0 && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.3} style={[s.statValue, { color: colors.textPrimary }]}>{lawyer.years_experience}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[s.statLabel, { color: colors.textMuted }]}>{t('x_lawyer_profile_yrs_exp')}</Text>
          </View>
        )}
        {lawyer.free_consultation && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.3} style={[s.statValue, { color: colors.legal }]}>{t('tier_free')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[s.statLabel, { color: colors.textMuted }]}>{t('x_lawyer_profile_consult')}</Text>
          </View>
        )}
      </View>

      <View style={s.body}>
        <ContactActions listing={lawyer} testID="lp-contact" />
        {!lawyer.on_app && (
          <Text testID="lp-not-on-app" maxFontSizeMultiplier={1.4} style={[s.muted, { color: colors.textMuted, marginTop: 10 }]}>{t('consult_not_on_app')}</Text>
        )}
        {lawyer.on_app && (
          <View style={s.actionRow}>
            <TouchableOpacity accessibilityRole="button" testID="lawyer-book-button" style={[s.actionBtn, { backgroundColor: colors.navy }]}
              onPress={() => navigation.navigate('MoreTab', { screen: 'Booking', params: { lawyerId: lawyer.id, lawyerName: lawyer.name } })}>
              <Text maxFontSizeMultiplier={1.3} style={s.actionBtnText}>{t('x_lawyer_profile_book_consultation')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="lawyer-message-button" style={[s.actionBtn, { backgroundColor: colors.legalDark }]} onPress={() => setShowMsg(v => !v)}>
              <Text maxFontSizeMultiplier={1.3} style={s.actionBtnText}>{t('x_lawyer_profile_send_message_2')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {showMsg && (
          <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <TextInput value={msgText} onChangeText={setMsgText} multiline maxLength={500} accessibilityLabel={t('x_lawyers_message_send_selected_attorneys')}
              placeholder={t('x_lawyers_briefly_describe_situation_what')} placeholderTextColor={colors.placeholder}
              style={[s.input, { borderColor: colors.inputBorder, color: colors.inputText, backgroundColor: colors.inputBg }]} />
            <TouchableOpacity accessibilityRole="button" disabled={msgSending || !msgText.trim()} onPress={sendMessage}
              style={[s.actionBtn, { backgroundColor: colors.navy, opacity: msgSending || !msgText.trim() ? 0.5 : 1 }]}>
              <Text maxFontSizeMultiplier={1.3} style={s.actionBtnText}>{msgSending ? t('booking_sending') : t('x_lawyer_profile_send_message')}</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={s.actionRow}>
          <TouchableOpacity accessibilityRole="button" testID="lp-save" accessibilityState={{ selected: !!savedId, busy: saving }}
            accessibilityLabel={savedId ? t('x_lawyers_unsave', { name: lawyer.name }) : t('x_lawyers_save_saved_list', { name: lawyer.name })}
            style={[s.ghostBtn, { borderColor: savedId ? COLORS.gold : colors.border, backgroundColor: colors.bgCard }]} onPress={toggleSave} disabled={saving}>
            <Text maxFontSizeMultiplier={1.3} style={[s.ghostBtnText, { color: savedId ? colors.goldText : colors.textPrimary }]}>{saving ? '…' : savedId ? t('lw_saved') : t('lw_save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="lp-share" style={[s.ghostBtn, { borderColor: colors.border, backgroundColor: colors.bgCard }]} onPress={share}>
            <Text maxFontSizeMultiplier={1.3} style={[s.ghostBtnText, { color: colors.textPrimary }]}>{t('x_bar_prep_explanation_share')}</Text>
          </TouchableOpacity>
        </View>

        {(week || lawyer.open_24_7 || lawyer.open_now != null) && (
          <View style={s.section} testID="lp-hours">
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('lp_hours')}</Text>
            {lawyer.open_24_7 ? (
              <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: colors.legal }]}>{t('lw_open_24_7')}</Text>
            ) : (
              <>
                {lawyer.open_now != null && <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: lawyer.open_now ? colors.legal : colors.textMuted, marginBottom: 4 }]}>{lawyer.open_now ? t('lw_open_now') : t('lw_closed_now')}</Text>}
                {week?.map(d => (
                  <View key={d.day} style={s.hoursRow}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.hoursDay, { color: colors.textSecond }]}>{weekdayName(d.day, loc)}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[s.hoursTime, { color: colors.textPrimary }]}>
                      {d.closed ? t('lp_closed') : d.open24 ? t('lp_open_24h') : (d.ranges || []).map(([a, b]) => `${clock(a, loc)} – ${clock(b, loc)}`).join(', ')}
                    </Text>
                  </View>
                ))}
                <Text maxFontSizeMultiplier={1.4} style={[s.muted, { color: colors.textMuted }]}>{t('lp_hours_local')}</Text>
              </>
            )}
          </View>
        )}

        {!!lawyer.website && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('lp_website')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: colors.textSecond }]} numberOfLines={1}>{websiteLabel(lawyer.website)}</Text>
          </View>
        )}
        {!!lawyer.bio && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('x_firm_public_profile_about')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: colors.textSecond }]}>{lawyer.bio}</Text>
          </View>
        )}
        {(lawyer.specialties || []).length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('x_lawyer_profile_specialties')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(lawyer.specialties || []).map(sp => (
                <View key={sp} style={[s.pill, { backgroundColor: colors.bgSubtle, borderColor: colors.border }]}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.textPrimary }}>{areaLabel(sp)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {(lawyer.languages || []).length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('x_lawyer_profile_languages')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: colors.textSecond }]}>
              {(lawyer.languages || []).map(languageLabel).join(' · ')}
            </Text>
          </View>
        )}
        {!!lawyer.bar_number && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('x_lawyer_profile_bar_information')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color: colors.textSecond }]}>{t('x_lawyer_profile_bar', { bar_number: lawyer.bar_number, value: lawyer.bar_state ? ` · ${lawyer.bar_state}` : '' })}</Text>
          </View>
        )}

        {jtb?.is_jtb_registered && (
          <View style={[s.card, { backgroundColor: colors.legalBg, borderColor: colors.legal }]}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, fontWeight: '700', color: colors.legal, marginBottom: 6 }}>{t('x_lawyer_profile_responds_via_justice_gavel')}</Text>
            {jtb.platform_rating != null && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.textSecond }}>{t('x_lawyer_profile_platform_rating', { value: Number(jtb.platform_rating).toFixed(1), value2: jtb.platform_review_count ? ' ' + t('x_lawyer_profile_consultations', { platform_review_count: jtb.platform_review_count }) : '' })}</Text>}
            {jtb.outcome_positive_pct != null && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.textSecond }}>{t('lp_outcomes', { pct: jtb.outcome_positive_pct })}</Text>}
            {(jtb.next_slots?.length ?? 0) > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color: colors.textMuted }}>{t('x_lawyer_profile_next_available')}</Text>
                {(jtb.next_slots || []).map(sl => (
                  <Text key={sl.starts_at} maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.legal }}>
                    {new Date(sl.starts_at).toLocaleString(loc, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={s.section} testID="lp-reviews">
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textPrimary }]}>{t('lp_app_reviews_title')}</Text>
          {!!reviewNote && <Text testID="review-submitted" maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.legal, marginBottom: 10 }}>{reviewNote}</Text>}
          {mine && !reviewNote && (
            <Text testID="review-mine" maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.textMuted, marginBottom: 10 }}>
              {mine.status === 'pending' ? t('lp_your_review_pending') : mine.status === 'hidden' ? t('lp_your_review_hidden') : t('lp_your_review_posted')}
            </Text>
          )}
          {!mine && !reviewNote && (showReview ? (
            <View testID="review-form" style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={t(n === 1 ? 'x_lawyer_profile_star_one' : 'x_lawyer_profile_star_other', { n })}
                    accessibilityState={{ selected: userRating === n }} onPress={() => setUserRating(n)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} testID={`review-star-${n}`}>
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 26, color: colors.goldText }}>{n <= userRating ? '★' : '☆'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput accessibilityLabel={t('x_lawyer_profile_review_comment_optional')} value={reviewText} onChangeText={setReviewText}
                placeholder={t('x_lawyer_profile_share_experience_optional')} placeholderTextColor={colors.placeholder} multiline maxLength={1000}
                style={[s.input, { borderColor: colors.inputBorder, color: colors.inputText, backgroundColor: colors.inputBg }]} />
              <Text maxFontSizeMultiplier={1.4} style={[s.muted, { color: colors.textMuted, marginBottom: 8 }]}>{t('lp_review_rules')}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity accessibilityRole="button" testID="review-post" disabled={userRating === 0 || submitting} onPress={submitReview}
                  style={[s.actionBtn, { flex: 1, backgroundColor: colors.navy, opacity: userRating === 0 || submitting ? 0.5 : 1 }]}>
                  <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{submitting ? t('x_lawyer_profile_posting') : t('x_lawyer_profile_post_review')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={() => setShowReview(false)} style={[s.ghostBtn, { borderColor: colors.border }]}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.ghostBtnText, { color: colors.textSecond }]}>{t('case_cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity accessibilityRole="button" testID="write-review-button" onPress={() => requireAuth(() => setShowReview(true))} style={{ paddingVertical: 8, marginBottom: 8 }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontWeight: '700', color: colors.textBrand }}>{t('x_lawyer_profile_write_review_2')}</Text>
            </TouchableOpacity>
          ))}
          {reviews.length === 0 ? (
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>{t('x_lawyer_profile_no_reviews_yet')}</Text>
          ) : reviews.map(r => (
            <View key={r.id} style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]} testID="review-item">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.goldText }} accessibilityLabel={t(r.rating === 1 ? 'x_lawyer_profile_star_one' : 'x_lawyer_profile_star_other', { n: r.rating })}>
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                </Text>
                <Text testID={Number(r.verified) === 1 ? 'review-verified' : 'review-unverified'} maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color: Number(r.verified) === 1 ? colors.legal : colors.textMuted }}>
                  {Number(r.verified) === 1 ? t('x_lawyer_profile_verified_client') : t('x_lawyer_profile_unverified_review')}
                </Text>
                {!!r.created_at && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color: colors.textMuted }}>{new Date(r.created_at).toLocaleDateString(loc, { month: 'short', year: 'numeric' })}</Text>}
              </View>
              {!!r.comment && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19, color: colors.textSecond }}>{r.comment}</Text>}
              {mine?.id !== r.id && (reportFor === r.id ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }} testID="review-report-reasons">
                  {REPORT_REASONS.map(reason => (
                    <TouchableOpacity key={reason} accessibilityRole="button" onPress={() => report(r.id, reason)} style={[s.reasonChip, { borderColor: colors.border }]}>
                      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textSecond }}>{t(`lp_report_${reason}`)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity accessibilityRole="button" onPress={() => setReportFor(null)} style={[s.reasonChip, { borderColor: colors.border }]}>
                    <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted }}>{t('case_cancel')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity accessibilityRole="button" testID="review-report" onPress={() => setReportFor(r.id)} style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted }}>{t('lp_report')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = () => StyleSheet.create({
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { paddingTop: 28, paddingBottom: 20, paddingHorizontal: 20, alignItems: 'center' },
  avatar:      { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText:  { fontSize: 32, color: COLORS.white },
  name:        { fontSize: TYPE['2xl'], lineHeight: 32, ...FONTS.black, color: COLORS.white, textAlign: 'center' },
  address:     { fontSize: TYPE.sm, lineHeight: 18, color: 'rgba(255,255,255,0.8)', marginTop: 4, textAlign: 'center' },
  badges:      { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge:       { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  badgeText:   { fontSize: TYPE.xs, lineHeight: 16, ...FONTS.bold, color: COLORS.white },
  notice:      { margin: 12, borderRadius: 10, padding: 12, borderWidth: 1, gap: 2 },
  statsRow:    { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', paddingVertical: 14, borderBottomWidth: 1, borderTopWidth: 1, gap: 8 },
  stat:        { alignItems: 'center', minWidth: 72 },
  statValue:   { fontSize: TYPE.lg, lineHeight: 27, ...FONTS.black },
  statLabel:   { fontSize: TYPE.xs, lineHeight: 16, marginTop: 2, textAlign: 'center' },
  body:        { padding: 16 },
  actionRow:   { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn:   { flex: 1, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  actionBtnText: { fontSize: TYPE.base, lineHeight: 21, ...FONTS.bold, color: COLORS.white, textAlign: 'center' },
  ghostBtn:    { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  ghostBtnText:{ fontSize: TYPE.base, lineHeight: 21, ...FONTS.bold, textAlign: 'center' },
  section:     { marginTop: 22 },
  sectionTitle:{ fontSize: TYPE.base, lineHeight: 21, ...FONTS.extraBold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  bodyText:    { fontSize: TYPE.base, lineHeight: 22 },
  muted:       { fontSize: 12, lineHeight: 17 },
  hoursRow:    { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  hoursDay:    { fontSize: 14, lineHeight: 20, textTransform: 'capitalize' },
  hoursTime:   { fontSize: 14, lineHeight: 20, flexShrink: 1, textAlign: 'right' },
  pill:        { borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  card:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 14, marginTop: 10 },
  input:       { minHeight: 70, borderWidth: 1, borderRadius: 8, padding: 10, textAlignVertical: 'top', marginBottom: 10, fontSize: 14, lineHeight: 20 },
  reasonChip:  { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
});

export default React.memo(LawyerProfileScreen);
