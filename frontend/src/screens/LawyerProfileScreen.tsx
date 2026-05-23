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
import { TextInput, ActivityIndicator, Alert, Linking, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, RefreshControl } from 'react-native';
import { api } from '../services/api';
import {  useTheme, RADIUS, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

function StarRating({ rating, count }: { rating: number; count: number }) {
  const { colors, isDark } = useTheme();
  const [fetchError, setFetchError] = React.useState<string|null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);

  const filled = Math.round(rating);
  return (
    <View style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
    {fetchError && (
      <View style={{margin:16,padding:14,backgroundColor:colors.surface,
        borderRadius:10,borderWidth:1,borderColor:COLORS.border}}>
        <Text style={{color:colors.danger,fontWeight:'700',fontSize:14}}>⚠ {fetchError}</Text>
      </View>
    )}
      <View style={{ flexDirection:'row', gap:2 }}>
        {[1,2,3,4,5].map(i => (
          <Text key={i} style={{ fontSize:14, color: i<=filled ? COLORS.gold : COLORS.border }}>
            ★
          </Text>
        ))}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
        color:COLORS.textMuted }}>
        {rating.toFixed(1)} ({count} review{count!==1?'s':''})
      </Text>
    </View>
  );
}

import Analytics from '../services/analytics';
declare var onRefresh: any;
declare var refreshing: any;
declare var load: any; // hoisted from component scope
export default function LawyerProfileScreen({ navigation, route }: ScreenProps): React.JSX.Element {

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
    } catch {
      Alert.alert('Could not submit review', 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const { lawyerId, lawyerData: preload } = (route?.params ?? {}) as {
    lawyerId: number; lawyerData?: Record<string, unknown>;
  };
  const { colors } = useTheme();
  const mountedRef = React.useRef(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lawyer?.id) Analytics.lawyerView(lawyer.id, lawyer.city || '', lawyer.specialties || ''); return () => { mountedRef.current = false; }; }, []);

  const [lawyer, setLawyer]   = useState<any>(preload || null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(!preload);
  const [userRating,  setUserRating]  = useState(0);
  const [reviewText,  setReviewText]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [showReview,  setShowReview]  = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [lawyerRes, reviewRes] = await Promise.allSettled([
          !preload ? api.get(`/providers/lawyers/${lawyerId}`) : Promise.resolve(null),
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
    })();
  }, [lawyerId, preload]);

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
    Linking.openURL(`tel:${lawyer.phone.replace(/\D/g,'')}`).catch(() => {});
  }, [lawyer]);

  const handleShare = async () => {
    if (!lawyer) return;
    try {
      await Share.share({
        title: `${lawyer.name} -- Criminal Defense Attorney`,
        message: `Attorney: ${lawyer.name}\nCity: ${lawyer.city}, ${lawyer.state}\n${lawyer.phone ? 'Phone: '+lawyer.phone+'\n' : ''}Find legal help on Justice Gavel: https://justicegavel.app`,
        url: lawyer.website || 'https://justicegavel.app',
      });
    } catch { /* share cancelled */ }
  };

  const handleSave = async () => {
    if (!lawyer) return;
    try {
      await api.post('/saved/lawyers', { lawyer_id: lawyer.id });
      Alert.alert('Saved', `${lawyer.name} has been saved to your attorneys.`);
    } catch {
      Alert.alert('Could not complete that action', 'Could not save attorney. Please try again.');
    }
  };

  const handleDirections = () => {
    if (!lawyer) return;
    const addr = encodeURIComponent(lawyer.address || `${lawyer.city}, ${lawyer.state}`);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${addr}&q=${encodeURIComponent(lawyer.name)}`
      : `https://www.google.com/maps/search/?api=1&query=${addr}`;
    Linking.openURL(url).catch(() => Alert.alert('Maps', 'Could not open maps app.'));
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
    ? JSON.parse(lawyer.specialties || '[]').catch?.() || lawyer.specialties.split(',')
    : (lawyer.specialties || []);

  const langs = typeof lawyer.languages === 'string'
    ? (lawyer.languages || '').split(',').map((l: string) => l.trim()).filter(Boolean)
    : (lawyer.languages || []);

  return (
    <ScrollView testID="lawyer-profile-screen" style={s.screen} contentContainerStyle={{ paddingBottom: 120 }}
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
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:10 }}>🔍</Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.blue }]}>Google Verified</Text>
            </View>
          )}
          {lawyer.bar_verified && (
            <View style={s.badge}>
              <Text maxFontSizeMultiplier={1.4} style={s.badgeText}>✓ Bar Verified</Text>
            </View>
          )}
          {lawyer.jtb_verified && (
            <View style={[s.badge, { backgroundColor:colors.gold, borderColor:colors.warnDark }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color:colors.bg }]}>
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
            <Text maxFontSizeMultiplier={1.4} style={[s.statValue, { color:colors.legalDark }]}>
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
        {reviews.length > 0 && (
          <View style={s.section}>
            <Text maxFontSizeMultiplier={1.4} style={[s.sectionTitle, { color:colors.textPrimary }]}>
              Reviews
            </Text>
            {reviews.map((r, i) => (
              <View key={i} style={[s.reviewCard, { backgroundColor:colors.bgCard,
                borderColor:colors.border }]}>
                <View style={{ flexDirection:'row', justifyContent:'space-between',
                  marginBottom:6 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, color:colors.gold }}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, lineHeight:16,
                    color:colors.textFaint }}>
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
        <TouchableOpacity style={[s.actionBtn, { backgroundColor:colors.navy }]}
          accessibilityRole="button"
          testID="lawyer-book-button" onPress={() => { hapticImpact(); handleBook(); }}>
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>📅 Book Consultation</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor:colors.legal }]}
          accessibilityRole="button"
          onPress={() => { hapticImpact(); handleMessage(); }}
                  >
          <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>💬 Send Message</Text>
        </TouchableOpacity>
        {lawyer.phone && (
          <TouchableOpacity style={[s.actionBtn, { backgroundColor:colors.legalDark }]}
            testID="lawyer-profile-contact-button" onPress={handleCall} accessibilityRole="button" accessibilityLabel="Call attorney">
            <Text maxFontSizeMultiplier={1.4} style={s.actionBtnText}>📞 Call</Text>
          </TouchableOpacity>
        )}
        {/* Secondary actions row */}
        <View style={{ flexDirection:'row', gap:10 }}>
          <TouchableOpacity
            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
          accessibilityRole="button"
            onPress={handleSave}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>⭐ Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
            onPress={handleDirections}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>📍 Directions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { flex:1, backgroundColor:colors.bgElevated, borderWidth:1, borderColor:colors.border }]}
          accessibilityRole="button"
            onPress={handleShare}>
            <Text maxFontSizeMultiplier={1.4} style={[s.actionBtnText, { color:colors.textPrimary }]}>↑ Share</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  actionBtnText:{ fontSize:TYPE.base, lineHeight:21, ...FONTS.bold, color:COLORS.bgCard } });
