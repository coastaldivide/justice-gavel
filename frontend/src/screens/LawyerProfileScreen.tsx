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
import { api, apiErrorMessage } from '../services/api';
import {  useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, RNShare } from '../utils/webCompat';

function StarRating({ rating, count }: { rating: number; count: number }) {
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
        {rating.toFixed(1)} ({count} review{count!==1?'s':''})
      </Text>
    </View>
  );
}

import Analytics from '../services/analytics';
function LawyerProfileScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const { showToast } = useToast();

  const submitReview = async () => {
    if (userRating === 0) return;
    setSubmitting(true);
    try {
      await api.post('/reviews', {
        entity_type: 'lawyer',
        entity_id:   lawyerId,
        rating:      userRating,
        comment:     reviewText.trim() || '',
        anonymous:   0 });
      setSubmitted(true);
      setShowReview(false);
      setReviews(prev => [{
        rating: userRating,
        comment: reviewText.trim(),
        created_at: new Date().toISOString() }, ...prev]);
    } catch (e: any) {
      showToast(apiErrorMessage(e, 'Check your connection and try again.'), 'error');
    } finally {
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
            navigation.setOptions({ title: lawyerRes.value.data?.name || 'Attorney Profile' });
          }
          if (reviewRes.status==='fulfilled') {
            setReviews(reviewRes.value.data?.slice(0,5) || []);
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
    Linking.openURL(`tel:${lawyer.phone.replace(/\D/g,'')}`).catch(() => { showToast('Action failed. Please try again.', 'error'); });
  }, [lawyer, showToast]);

  const handleShare = async () => {
    if (!lawyer) return;
    try {
      await RNShare.share({
        title: `${lawyer.name} -- Criminal Defense Attorney`,
        message: `Attorney: ${lawyer.name}\nCity: ${lawyer.city}, ${lawyer.state}\n${lawyer.phone ? 'Phone: '+lawyer.phone+'\n' : ''}Find legal help on Justice Gavel: https://justicegavel.app`,
        url: lawyer.website || 'https://justicegavel.app',
      });
    } catch { /* share cancelled */ }
  };

  const handleSave = async () => {
    hapticImpact();
    if (!lawyer) return;
    try {
      await api.post('/saved/lawyers', { lawyer_id: lawyer.id });
      showToast(`${lawyer.name} saved to your attorneys.`, 'success');
    } catch {
      showToast('Could not save attorney. Please try again.');
    }
  };

  const handleDirections = () => {
    if (!lawyer) return;
    const addr = encodeURIComponent(lawyer.address || `${lawyer.city}, ${lawyer.state}`);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${addr}&q=${encodeURIComponent(lawyer.name)}`
      : `https://www.google.com/maps/search/?api=1&query=${addr}`;
    Linking.openURL(url).catch(() => showToast('Could not open maps app.'));
  };


  const s = styles(colors as any);

  if (loading) return (
    <View style={[s.screen, { justifyContent:'center', alignItems:'center' }]}>
      <ActivityIndicator color={colors.navy} size="large" />
    </View>
  );

  if (!lawyer) return (
    <View style={[s.screen, { justifyContent:'center', alignItems:'center', padding:32 }]}>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, color:colors.textMuted,
        textAlign:'center' }}>
        Attorney profile not available.
      </Text>
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
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.textBrand }]}>Google Verified</Text>
            </View>
          )}
          {lawyer.bar_verified && (
            <View style={s.badge}>
              <Text maxFontSizeMultiplier={1.4} style={s.badgeText}>✓ Bar Verified</Text>
            </View>
          )}
          {lawyer.jtb_verified && (
            <View style={[s.badge, { backgroundColor:colors.gold, borderColor:colors.warnDark }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color:colors.textOnGold }]}>
                ⚖️ JTB Verified
              </Text>
            </View>
          )}
          {lawyer.golden_gavel && (
            <View style={[s.badge, { backgroundColor:colors.warnBg, borderColor:colors.gold }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color:colors.warnDark }]}>
                🏆 Golden Gavel
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
              Profile information pending verification
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
              color:colors.warnDark }}>
              This attorney has not yet claimed their profile. Contact details were
              sourced from public bar records. Verify credentials before retaining.
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
              Rating
            </Text>
          </View>
        )}
        {lawyer.years_experience > 0 && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.textPrimary }]}>
              {lawyer.years_experience}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              Yrs exp
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
              Avg reply
            </Text>
          </View>
        )}
        {lawyer.free_consultation && (
          <View style={s.stat}>
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.legal }]}>
              Free
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.statLabel, { color:colors.textMuted }]}>
              Consult
            </Text>
          </View>
        )}
      </View>

      {/* Content sections */}
      <View style={s.body}>
        {lawyer.bio ? (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              About
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              {lawyer.bio}
            </Text>
          </View>
        ) : null}

        {specialties.length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              Specialties
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
              Languages
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              {langs.join(' · ')}
            </Text>
          </View>
        )}

        {lawyer.bar_number && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              Bar Information
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.bodyText, { color:colors.textSecond }]}>
              Bar #{lawyer.bar_number}
              {lawyer.bar_state ? ` · ${lawyer.bar_state}` : ''}
            </Text>
          </View>
        )}

        {/* Reviews */}
        {(
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              Reviews
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
                ✓ Thanks -- your review was posted.
              </Text>
            ) : showReview ? (
              <View testID="review-form" style={[s.reviewCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                      accessibilityState={{ selected: userRating === n }} onPress={() => setUserRating(n)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 24, color: colors.goldText }}>{n <= userRating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel="Review comment (optional)"
                  value={reviewText}
                  onChangeText={setReviewText}
                  placeholder="Share your experience (optional)"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={1000}
                  style={{ minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
                    color: colors.textPrimary, textAlignVertical: 'top', marginBottom: 10 }}
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Post review"
                    disabled={userRating === 0 || submitting} onPress={submitReview}
                    style={[s.actionBtn, { flex: 1, backgroundColor: colors.navy, opacity: userRating === 0 || submitting ? 0.5 : 1 }]}>
                    <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>{submitting ? 'Posting…' : 'Post review'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel review"
                    onPress={() => setShowReview(false)} style={[s.actionBtn, { paddingHorizontal: 16 }]}>
                    <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color: colors.textSecond }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Write a review" testID="write-review-button"
                onPress={() => setShowReview(true)} style={{ paddingVertical: 8, marginBottom: 8 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontWeight: '700', color: colors.navy }}>✍️ Write a review</Text>
              </TouchableOpacity>
            )}
            {reviews.length === 0 ? (
              <Text style={{color: colors.textMuted, textAlign: 'center', padding: 16}}>No reviews yet</Text>
            ) : reviews.map((r, i) => (
              <View key={`reviews-${i}`} style={[s.reviewCard, { backgroundColor:colors.bgCard,
                borderColor:colors.border }]}>
                <View style={{ flexDirection:'row', justifyContent:'space-between',
                  marginBottom:6 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, color:colors.goldText }}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color:colors.textMuted }}>
                    {new Date(r.created_at ?? 0).toLocaleDateString('en-US', { month:'short', year:'numeric' })}
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
          testID="lawyer-book-button" accessibilityLabel={"\ud83d\udcc5 Book Consultation"}
          accessibilityHint="Schedules a video consultation" onPress={() => { hapticImpact(); handleBook(); }}>
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>📅 Book Consultation</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Opens a message thread with this attorney" style={[s.actionBtn, { backgroundColor:colors.legalDark }]}
          accessibilityLabel="Send Message" onPress={handleMessage}
                  >
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>💬 Send Message</Text>
        </TouchableOpacity>
        {lawyer.phone && (
          <TouchableOpacity style={[s.actionBtn, { backgroundColor:colors.legalDark }]}
            testID="lawyer-profile-contact-button" onPress={handleCall} accessibilityRole="button"
 accessibilityLabel="Call attorney"
          accessibilityHint="Dials this phone number">
            <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>📞 Call</Text>
          </TouchableOpacity>
        )}
        {/* Secondary actions row */}
        <View style={{ flexDirection:'row', gap:10 }}>
          <TouchableOpacity
            accessibilityRole="button"

            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleSave} accessibilityLabel={"\u2b50 Save"}
          accessibilityHint="Saves your changes">
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>⭐ Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleDirections} accessibilityLabel={"\ud83d\udccd Directions"}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>📍 Directions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"

            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleShare} accessibilityLabel={"\u2191 Share"}
          accessibilityHint="Shares this information">
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>↑ Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    
      {/* JTB Platform Section */}
      {jtbProfile?.is_jtb_registered === true && (
        <View style={{ margin: 12, padding: 12, backgroundColor: colors.legalBg,
                       borderRadius: 10, borderWidth: 1, borderColor: colors.legalBg }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.legal, letterSpacing: 0.5, marginBottom: 6 }}>
            {'✓ RESPONDS VIA JUSTICE GAVEL'}
          </Text>
          {!!jtbProfile.platform_rating && (
            <Text style={{ fontSize: 13, color: colors.textSecond, marginBottom: 2 }}>
              {'Platform rating: ' + jtbProfile.platform_rating.toFixed(1) + ' ★' +
               (jtbProfile.platform_review_count ? ' (' + jtbProfile.platform_review_count + ' consultations)' : '')}
            </Text>
          )}
          {!!jtbProfile.outcome_label && (
            <Text style={{ fontSize: 12, color: colors.textSecond, marginBottom: 4 }}>
              {jtbProfile.outcome_label}
            </Text>
          )}
          {(jtbProfile.next_slots?.length ?? 0) > 0 && (
            <View>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>{'Next available:'}</Text>
              {(jtbProfile.next_slots as Array<{date:string;time:string;label:string}>).slice(0,3).map(sl => (
                <Text key={sl.date + sl.time} style={{ fontSize: 12, color: colors.legal, marginBottom: 2 }}>
                  {sl.label + ' at ' + sl.time}
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