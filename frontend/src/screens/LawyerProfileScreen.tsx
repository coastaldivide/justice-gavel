import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
/**
 * LawyerProfileScreen -- Full attorney profile
 *
 * Shows: photo/avatar, name, verified badges, specialties,
 * bio, bar info, response rate, availability, recent reviews,
 * and action buttons (Book Consultation, Send Message).
 *
 * Navigation params: { lawyerId: number, lawyerData?: object }
 */
import React, { useState, useCallback, useEffect } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, RefreshControl, LayoutAnimation } from 'react-native';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import {  useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, RNShare } from '../utils/webCompat';

function StarRating({ rating, count }: { rating: number; count: number }) {
  useLang();
  const { colors } = useTheme();
  const filled = Math.round(rating);
  return (
    <View style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
      <View style={{ flexDirection:'row', gap:2 }}>
        {[1,2,3,4,5].map(i => (
          <Text key={`item-${i}`} style={{ fontSize:14, color: i<=filled ? COLORS.gold : COLORS.border }}>
            ★
          </Text>
        ))}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
        color:colors.textMuted }}>
        {t(count === 1 ? 'x_lawyer_profile_review_one' : 'x_lawyer_profile_review_other', { rating: rating.toFixed(1), count })}
      </Text>
    </View>
  );
}

import Analytics from '../services/analytics';
import { useInFlight } from '../hooks/useInFlight';
import { t, useLang, locale } from '../i18n';
function LawyerProfileScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();

  const reviewGuard = React.useRef(false);
  const submitReview = async () => {
    if (userRating === 0 || reviewGuard.current) return;
    reviewGuard.current = true;
    setSubmitting(true);
    try {
      const res = await api.post('/reviews', {
        entity_type: 'lawyer',
        entity_id:   lawyerId,
        rating:      userRating,
        comment:     reviewText.trim() || '',
        anonymous:   0 });
      setSubmitted(true);
      setShowReview(false);
      // The server decides `verified` (a consultation or case with this lawyer).
      setReviews(prev => [{
        rating: userRating,
        comment: reviewText.trim(),
        verified: res.data?.verified ?? 0,
        created_at: new Date().toISOString() }, ...prev]);
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('home_sos_failed')), 'error');
    } finally {
      reviewGuard.current = false;
      setSubmitting(false);
    }
  };

  const { lawyerId, lawyerData: preload } = (route?.params ?? {}) as {
    lawyerId: number; lawyerData?: Record<string, unknown>;
  };
  const { colors } = useTheme();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    if (!lawyerId) return;
    api.get(`/match/profile/${lawyerId}`)
      .then(r => setJtbProfile(r.data))
      .catch(() => {});
  }, [lawyerId]);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    return () => { mountedRef.current = false; };
  }, []);

  const [lawyer, setLawyer]   = useState<any>(preload || null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [jtbProfile, setJtbProfile] = React.useState<any>(null);

  const [loading, setLoading] = useState(!preload);
  // 'notfound' (404) vs 'network' (couldn't reach the server → offer Retry)
  const [loadError, setLoadError] = useState<null | 'notfound' | 'network'>(null);
  const [userRating,  setUserRating]  = useState(0);
  const [reviewText,  setReviewText]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [showReview,  setShowReview]  = useState(false);

  // Analytics: one profile view per lawyer id (not on every refresh of the object).
  const viewedIdRef = React.useRef<unknown>(null);
  useEffect(() => {
    if (!lawyer?.id || viewedIdRef.current === lawyer.id) return;
    viewedIdRef.current = lawyer.id;
    Analytics.lawyerView(lawyer.id, lawyer.city || '', lawyer.specialties || '');
  }, [lawyer]);

  const [refreshing, setRefreshing] = useState(false);
  const loadProfile = useCallback(async (forceLawyer = false) => {
      try {
        const [lawyerRes, reviewRes] = await Promise.allSettled([
          !preload || forceLawyer ? api.get(`/providers/lawyers/${lawyerId}`) : Promise.resolve(null),
          api.get('/reviews', { params: { entity_type:'lawyer', entity_id:lawyerId } }),
        ]);
        if (mountedRef.current) {
          if (lawyerRes.status==='fulfilled' && lawyerRes.value?.data) {
            setLawyer(lawyerRes.value.data);
            setLoadError(null);
            navigation.setOptions({ title: lawyerRes.value.data?.name || t('x_nav_attorney_profile') });
          } else if (lawyerRes.status==='rejected') {
            const status = (lawyerRes.reason as { response?: { status?: number } })?.response?.status;
            setLoadError(status === 404 ? 'notfound' : 'network');
          }
          if (reviewRes.status==='fulfilled') {
            setReviews(unwrapList(reviewRes.value.data, 'reviews').slice(0, 5));
          }
          setLoading(false);
        }
      } catch { if (mountedRef.current) setLoading(false); }
  }, [lawyerId, preload, navigation]);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadProfile(true).finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [loadProfile]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleBook = useCallback(() => {
    navigation.navigate('MoreTab', {
      screen: 'Booking',
      params: { lawyerId, lawyerName: lawyer?.name } });
  }, [navigation, lawyerId, lawyer]);

  const handleMessage = useCallback(() => {
    navigation.navigate('MoreTab', {
      screen: 'Messages',
      params: { lawyerId, lawyerName: lawyer?.name } });
  }, [navigation, lawyerId, lawyer]);

  const handleCall = useCallback(() => {
    if (!lawyer?.phone) return;
    Linking.openURL(`tel:${lawyer.phone.replace(/\D/g,'')}`).catch(() => { showToast(t('action_failed'), 'error'); });
  }, [lawyer, showToast]);

  const handleShare = async () => {
    if (!lawyer) return;
    try {
      await RNShare.share({
        title: t('x_lawyer_profile_criminal_defense_attorney', { name: lawyer.name }),
        message: t('x_lawyer_profile_attorney_city_find_legal', { name: lawyer.name, city: lawyer.city, state: lawyer.state, value: lawyer.phone ? t('x_lawyer_profile_phone', { phone: lawyer.phone }) + '\n' : '' }),
        url: lawyer.website || 'https://justicegavel.app',
      });
    } catch { /* share cancelled */ }
  };

  const [runSave, savePending] = useInFlight();
  const handleSave = () => runSave(async () => {
    hapticImpact().catch(() => undefined);   // haptics are optional
    if (!lawyer) return;
    try {
      await api.post('/saved/lawyers', { lawyer_id: lawyer.id });
      showToast(t('x_lawyer_profile_saved_attorneys', { name: lawyer.name }), 'success');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_lawyer_profile_could_not_save_attorney')), 'error');
    }
  });

  const handleDirections = () => {
    if (!lawyer) return;
    const addr = encodeURIComponent(lawyer.address || `${lawyer.city}, ${lawyer.state}`);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${addr}&q=${encodeURIComponent(lawyer.name)}`
      : `https://www.google.com/maps/search/?api=1&query=${addr}`;
    Linking.openURL(url).catch(() => showToast(t('x_lawyer_profile_could_not_open_maps')));
  };


  const s = styles(colors as any);

  if (loading) return (
    <View style={[s.screen, { justifyContent:'center', alignItems:'center' }]}>
      <ActivityIndicator color={colors.navy} size="large" />
    </View>
  );

  if (!lawyer) return (
    <View testID="lawyer-profile-unavailable" style={[s.screen, { justifyContent:'center', alignItems:'center', padding:32 }]}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, color:colors.textMuted,
        textAlign:'center' }}>
        {loadError === 'network'
          ? t('x_lawyer_profile_could_not_load_this')
          : t('x_lawyer_profile_attorney_profile_not_available')}
      </Text>
      {loadError === 'network' && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('try_again')}
          onPress={() => { setLoading(true); loadProfile(true); }}
          style={{ marginTop:16, paddingHorizontal:20, paddingVertical:12, minHeight:44, borderRadius:10, backgroundColor:colors.navy }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.white, fontWeight:'700' }}>{t('try_again')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const specialties = typeof lawyer.specialties === 'string'
    ? (() => { try { return JSON.parse(lawyer.specialties || '[]'); } catch { return lawyer.specialties?.split(',') ?? []; } })()
    : (lawyer.specialties || []);

  const langs = typeof lawyer.languages === 'string'
    ? (lawyer.languages || '').split(',').map((l: string) => l.trim()).filter(Boolean)
    : (lawyer.languages || []);

  return (
    <ScrollView testID="lawyer-profile-screen" style={s.screen} contentContainerStyle={{ paddingBottom: 120, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>

      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.navy }]}>
        <View style={s.avatar}>
          <Text maxFontSizeMultiplier={1.4} style={s.avatarText}>
            {lawyer.name ? lawyer.name.charAt(0).toUpperCase() : '⚖'}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={2} ellipsizeMode="tail" style={s.name}>{lawyer.name}</Text>
        {lawyer.address && (
          <Text maxFontSizeMultiplier={1.4} style={s.address}>{lawyer.address}</Text>
        )}
        {/* Verified badges */}
        <View style={{ flexDirection:'row', gap:8, marginTop:8, flexWrap:'wrap',
          justifyContent:'center' }}>
          {lawyer.source && lawyer.source !== 'seed' && (
            <View style={[s.badge, { backgroundColor: colors.infoBg, flexDirection:'row', alignItems:'center', gap:4 }]}>
              <AppIcon name="search-outline" size={20} color={COLORS.navy} />
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.textBrand }]}>{t('x_lawyer_profile_google_verified')}</Text>
            </View>
          )}
          {lawyer.bar_verified && (
            <View style={s.badge}>
              <Text maxFontSizeMultiplier={1.4} style={s.badgeText}>{t('x_expungement_bar_verified')}</Text>
            </View>
          )}
          {lawyer.jtb_verified && (
            <View style={[s.badge, { backgroundColor:colors.gold, borderColor:colors.warnDark }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color:colors.textOnGold }]}>
                {t('x_lawyer_profile_jtb_verified')}
              </Text>
            </View>
          )}
          {lawyer.golden_gavel && (
            <View style={[s.badge, { backgroundColor:colors.warnBg, borderColor:colors.gold }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color:colors.warnDark }]}>
                {t('x_nav_golden_gavel')}
              </Text>
            </View>
          )}
        </View>
      </View>


      {/* Seed data notice */}
      {lawyer?.seed_data && (
        <View style={{ backgroundColor:colors.warnBg, margin:12, borderRadius:10,
          padding:12, flexDirection:'row', alignItems:'flex-start', gap:8,
          borderWidth:1, borderColor:colors.gold }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>⏳</Text>
          <View style={{ flex:1 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
              fontWeight:'700', color:colors.warnDark, marginBottom:2 }}>
              {t('x_lawyer_profile_profile_information_pending_verifica')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
              color:colors.warnDark }}>
              {t('x_lawyer_profile_this_attorney_has_not')}
            </Text>
          </View>
        </View>
      )}
{/* Stats row */}
      <View style={[s.statsRow, { backgroundColor:colors.bgCard, borderColor:colors.border }]}>
        {lawyer.rating > 0 && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.textPrimary }]}>
              {(lawyer.rating ?? 0).toFixed(1)}★
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              {t('x_bail_search_rating')}
            </Text>
          </View>
        )}
        {lawyer.years_experience > 0 && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.textPrimary }]}>
              {lawyer.years_experience}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              {t('x_lawyer_profile_yrs_exp')}
            </Text>
          </View>
        )}
        {lawyer.avg_response_hrs != null && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.textPrimary }]}>
              {lawyer.avg_response_hrs < 1
                ? `<1h`
                : `${Math.round(lawyer.avg_response_hrs)}h`}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              {t('x_lawyer_profile_avg_reply')}
            </Text>
          </View>
        )}
        {lawyer.free_consultation && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.legal }]}>
              {t('tier_free')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              {t('x_lawyer_profile_consult')}
            </Text>
          </View>
        )}
      </View>

      {/* Content sections */}
      <View style={s.body}>
        {lawyer.bio ? (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              {t('x_firm_public_profile_about')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              {lawyer.bio}
            </Text>
          </View>
        ) : null}

        {specialties.length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              {t('x_lawyer_profile_specialties')}
            </Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 }}>
              {specialties.map((sp: string) => (
                <View key={sp} style={[s.pill, { backgroundColor:colors.bgSubtle,
                  borderColor:colors.border }]}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                    color:colors.textPrimary }}>
                    {sp.trim()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {langs.length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              {t('x_lawyer_profile_languages')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              {langs.join(' · ')}
            </Text>
          </View>
        )}

        {lawyer.bar_number && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              {t('x_lawyer_profile_bar_information')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              {t('x_lawyer_profile_bar', { bar_number: lawyer.bar_number, value: lawyer.bar_state ? ` · ${lawyer.bar_state}` : '' })}
            </Text>
          </View>
        )}

        {/* Reviews */}
        {(
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              {t('x_lawyer_profile_reviews')}
            </Text>
            {reviews.length > 0 && (
              <View style={{ marginBottom: 10 }}>
                <StarRating
                  rating={reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length}
                  count={reviews.length}
                />
              </View>
            )}
            {submitted ? (
              <Text testID="review-submitted" maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.legal, marginBottom: 10 }}>
                {t('x_lawyer_profile_thanks_review_was_posted')}
              </Text>
            ) : showReview ? (
              <View testID="review-form" style={[s.reviewCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={t(n === 1 ? 'x_lawyer_profile_star_one' : 'x_lawyer_profile_star_other', { n })}
                      accessibilityState={{ selected: userRating === n }} onPress={() => setUserRating(n)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 24, color: colors.goldText }}>{n <= userRating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel={t('x_lawyer_profile_review_comment_optional')}
                  value={reviewText}
                  onChangeText={setReviewText}
                  placeholder={t('x_lawyer_profile_share_experience_optional')}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={1000}
                  style={{ minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
                    color: colors.textPrimary, textAlignVertical: 'top', marginBottom: 10 }}
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_lawyer_profile_post_review')}
                    disabled={userRating === 0 || submitting} onPress={submitReview}
                    style={[s.actionBtn, { flex: 1, backgroundColor: colors.navy, opacity: userRating === 0 || submitting ? 0.5 : 1 }]}>
                    <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{submitting ? t('x_lawyer_profile_posting') : t('x_lawyer_profile_post_review')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_lawyer_profile_cancel_review')}
                    onPress={() => setShowReview(false)} style={[s.actionBtn, { paddingHorizontal: 16 }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color: colors.textSecond }]}>{t('case_cancel')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_lawyer_profile_write_review')} testID="write-review-button"
                onPress={() => setShowReview(true)} style={{ paddingVertical: 8, marginBottom: 8 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontWeight: '700', color: colors.navy }}>{t('x_lawyer_profile_write_review_2')}</Text>
              </TouchableOpacity>
            )}
            {reviews.length === 0 ? (
              <Text style={{color: colors.textMuted, textAlign: 'center', padding: 16}}>{t('x_lawyer_profile_no_reviews_yet')}</Text>
            ) : reviews.map((r, i) => (
              <View key={`reviews-${i}`} style={[s.reviewCard, { backgroundColor:colors.bgCard,
                borderColor:colors.border }]}>
                <View style={{ flexDirection:'row', justifyContent:'space-between',
                  marginBottom:6 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, color:colors.goldText }}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}
                  </Text>
                  <Text testID={Number(r.verified) === 1 ? 'review-verified' : 'review-unverified'}
                    maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color: Number(r.verified) === 1 ? colors.legal : colors.textMuted }}>
                    {Number(r.verified) === 1 ? t('x_lawyer_profile_verified_client') : t('x_lawyer_profile_unverified_review')}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color:colors.textMuted }}>
                    {new Date(r.created_at ?? 0).toLocaleDateString(locale(), { month:'short', year:'numeric' })}
                  </Text>
                </View>
                {r.comment ? (
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
                    color:colors.textSecond }}>
                    {r.comment}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={s.actions}>
        <TouchableOpacity
          accessibilityRole="button"
 style={[s.actionBtn, { backgroundColor:colors.navy }]}
          testID="lawyer-book-button" accessibilityLabel={t('x_lawyer_profile_book_consultation')}
          accessibilityHint={t('x_lawyer_profile_schedules_video_consultation')} onPress={() => { hapticImpact(); handleBook(); }}>
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{t('x_lawyer_profile_book_consultation')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('x_lawyer_profile_opens_message_thread_with')} style={[s.actionBtn, { backgroundColor:colors.legalDark }]}
          accessibilityLabel={t('x_lawyer_profile_send_message')} onPress={handleMessage}
                  >
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{t('x_lawyer_profile_send_message_2')}</Text>
        </TouchableOpacity>
        {lawyer.phone && (
          <TouchableOpacity style={[s.actionBtn, { backgroundColor:colors.legalDark }]}
            testID="lawyer-profile-contact-button" onPress={handleCall} accessibilityRole="button"
 accessibilityLabel={t('x_lawyer_profile_call_attorney')}
          accessibilityHint={t('x_lawyer_profile_dials_this_phone_number')}>
            <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{t('lawyers_call')}</Text>
          </TouchableOpacity>
        )}
        {/* Secondary actions row */}
        <View style={{ flexDirection:'row', gap:10 }}>
          <TouchableOpacity
            accessibilityRole="button"

            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleSave} disabled={savePending} accessibilityState={{ disabled: savePending, busy: savePending }} accessibilityLabel={t('x_lawyer_profile_save')}
          accessibilityHint={t('x_lawyer_profile_saves_changes')}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>{t('x_lawyer_profile_save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleDirections} accessibilityLabel={t('x_lawyer_profile_directions')}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>{t('x_lawyer_profile_directions')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"

            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleShare} accessibilityLabel={t('x_bar_prep_explanation_share')}
          accessibilityHint={t('x_deadline_calculator_shares_this_information')}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>{t('x_bar_prep_explanation_share')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    
      {/* JTB Platform Section */}
      {jtbProfile?.is_jtb_registered === true && (
        <View style={{ margin: 12, padding: 12, backgroundColor: colors.legalBg,
                       borderRadius: 10, borderWidth: 1, borderColor: colors.legalBg }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.legal, letterSpacing: 0.5, marginBottom: 6 }}>
            {t('x_lawyer_profile_responds_via_justice_gavel')}
          </Text>
          {!!jtbProfile.platform_rating && (
            <Text style={{ fontSize: 13, color: colors.textSecond, marginBottom: 2 }}>
              {t('x_lawyer_profile_platform_rating', { value: jtbProfile.platform_rating.toFixed(1), value2: (jtbProfile.platform_review_count ? ' ' + t('x_lawyer_profile_consultations', { platform_review_count: jtbProfile.platform_review_count }) : '') })}
            </Text>
          )}
          {!!jtbProfile.outcome_label && (
            <Text style={{ fontSize: 12, color: colors.textSecond, marginBottom: 4 }}>
              {jtbProfile.outcome_label}
            </Text>
          )}
          {(jtbProfile.next_slots?.length ?? 0) > 0 && (
            <View>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>{t('x_lawyer_profile_next_available')}</Text>
              {(jtbProfile.next_slots as Array<{date:string;time:string;label:string}>).slice(0,3).map(sl => (
                <Text key={sl.date + sl.time} style={{ fontSize: 12, color: colors.legal, marginBottom: 2 }}>
                  {t('x_lawyer_profile_slot_at', { label: sl.label, time: sl.time })}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
</ScrollView>
  );
}

const styles = (C: Record<string, string>) => StyleSheet.create({
  screen:      { flex:1, backgroundColor:C.bg },
  header:      { paddingTop:48, paddingBottom:24, paddingHorizontal:20, alignItems:'center' },
  avatar:      { width:80, height:80, borderRadius:40, backgroundColor:'rgba(255,255,255,0.2)',
                 alignItems:'center', justifyContent:'center', marginBottom:12 },
  avatarText:  { fontSize:36, color:COLORS.bgCard },
  name:        { fontSize:TYPE['2xl'], lineHeight:34, ...FONTS.black, color:COLORS.bgCard, textAlign:'center' },
  address:     { fontSize:TYPE.sm, lineHeight:18, color:'rgba(255,255,255,0.7)', marginTop:4 },
  badge:       { backgroundColor:'rgba(255,255,255,0.15)', borderRadius:RADIUS.pill,
                 paddingHorizontal:10, paddingVertical:4, borderWidth:1,
                 borderColor:'rgba(255,255,255,0.3)' },
  badgeText:   { fontSize:TYPE.xs, lineHeight:16, ...FONTS.bold, color:COLORS.bgCard },
  statsRow:    { flexDirection:'row', justifyContent:'space-around', paddingVertical:16,
                 borderBottomWidth:1, borderTopWidth:1, marginHorizontal:0 },
  stat:        { alignItems:'center' },
  statValue:   { fontSize:TYPE.lg, lineHeight:27, ...FONTS.black },
  statLabel:   { fontSize:TYPE.xs, lineHeight:16, marginTop:2 },
  body:        { padding:20 },
  section:     { marginBottom:24 },
  sectionTitle:{ fontSize:TYPE.base, lineHeight:21, ...FONTS.extraBold,
                 letterSpacing:0.5, textTransform:'uppercase', marginBottom:8 },
  bodyText:    { fontSize:TYPE.base, lineHeight:24 },
  pill:        { borderRadius:RADIUS.pill, borderWidth:1, paddingHorizontal:10, paddingVertical:5 },
  reviewCard:  { borderRadius:RADIUS.md, borderWidth:1, padding:14, marginBottom:10 },
  actions:     { position:'absolute', bottom:0, left:0, right:0, padding:16, gap:10,
                 backgroundColor:C.bg, borderTopWidth:1, borderTopColor:C.border },
  actionBtn:   { borderRadius:RADIUS.md, paddingVertical:14, alignItems:'center' },
  actionBtnText:{ fontSize:TYPE.base, lineHeight:21, ...FONTS.bold, color:COLORS.white } });
export default React.memo(LawyerProfileScreen);