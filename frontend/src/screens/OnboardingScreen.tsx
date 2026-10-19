/**
 * OnboardingScreen -- First-time user intro
 *
 * Fixes applied:
 *  - Skip → setAppAuth('browsing') directly (not Login)
 *  - "Browse Without Account" visible on EVERY slide (not just last)
 *  - Simple 3rd-grade language
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, LayoutAnimation, FlatList, NativeModules, Platform } from 'react-native';
import { setPendingRoute } from '../services/corePath';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAppAuth } from '../services/auth';
import { t, initLang, setLang, useLang } from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { detectAndSaveUserState } from '../services/location';
import JTBLogo from '../components/JTBLogo';

const { width } = Dimensions.get('window');

const SITUATION_PATHS = {
  arrested: [
    { key:'s_arrested', icon:'🔒', titleKey:'onboard_slide1_title', bodyKey:'onboard_slide1_body', accent: COLORS.navy },
    { key:'bail',       icon:'💰', titleKey:'onboard_slide2_title', bodyKey:'onboard_slide2_body', accent: COLORS.bail },
    { key:'rights',     icon:'✊', titleKey:'onboard_rights_title', bodyKey:'onboard_rights_body', accent: COLORS.navy },
    { key:'lawyer',     icon:'⚖️', titleKey:'onboard_slide3_title', bodyKey:'onboard_slide3_body', accent: COLORS.legal },
    { key:'free',       icon:'✅', titleKey:'onboard_slide4_title', bodyKey:'onboard_slide4_body', accent: COLORS.legal },
  ],
  family: [
    { key:'s_family',  icon:'👪', titleKey:'onboard_family_title', bodyKey:'onboard_family_body', accent: COLORS.navy },
    { key:'what_next', icon:'📋', titleKey:'onboard_whatnext_title', bodyKey:'onboard_whatnext_body', accent: COLORS.steel },
    { key:'bail',      icon:'💰', titleKey:'onboard_slide2_title', bodyKey:'onboard_slide2_body', accent: COLORS.bail },
    { key:'lawyer',    icon:'⚖️', titleKey:'onboard_slide3_title', bodyKey:'onboard_slide3_body', accent: COLORS.legal },
    { key:'free',      icon:'✅', titleKey:'onboard_slide4_title', bodyKey:'onboard_slide4_body', accent: COLORS.legal },
  ],
  record: [
    { key:'s_record',   icon:'📋', titleKey:'onboard_record_title', bodyKey:'onboard_record_body', accent: COLORS.legal },
    { key:'expunge',    icon:'🗂️', titleKey:'onboard_expunge_title', bodyKey:'onboard_expunge_body', accent: COLORS.legal },
    { key:'lawyer',     icon:'⚖️', titleKey:'onboard_slide3_title', bodyKey:'onboard_slide3_body', accent: COLORS.legal },
    { key:'free',       icon:'✅', titleKey:'onboard_slide4_title', bodyKey:'onboard_slide4_body', accent: COLORS.legal },
  ] };

// Default slides for 'general' / no situation selected
const SLIDES = [
  { key: 'welcome', icon: '🔓', titleKey: 'onboard_slide1_title', bodyKey: 'onboard_slide1_body', accent: COLORS.navy },
  { key: 'bail',    icon: '💰', titleKey: 'onboard_slide2_title', bodyKey: 'onboard_slide2_body', accent: COLORS.bail },
  { key: 'lawyer',  icon: '⚖️', titleKey: 'onboard_slide3_title', bodyKey: 'onboard_slide3_body', accent: COLORS.legal },
  { key: 'free',    icon: '✅', titleKey: 'onboard_slide4_title', bodyKey: 'onboard_slide4_body', accent: COLORS.legal },
];

function OnboardingScreen({ navigation }: ScreenProps) {
  useLang(); // re-render in the chosen language
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // Passive: uses location only if already allowed — no prompt during onboarding.
    detectAndSaveUserState({ prompt: false }).catch(() => {});
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => {
  return () => { mountedRef.current = false; }; }, []);

  const [activeIndex, setActiveIndex] = useState(0);
  const [situation] = React.useState<string | null>(null);
  // Active slides -- changes based on situation selected
  const activeSlides = React.useMemo(() =>
    situation && situation !== 'general'
      ? SITUATION_PATHS[situation as keyof typeof SITUATION_PATHS] || SLIDES
      : SLIDES,
    [situation]
  );


  const flatRef  = useRef<FlatList<(typeof SLIDES)[0]>>(null);
  const scrollX  = useRef(new Animated.Value(0)).current;
  // Slide width = the carousel's MEASURED width, not the window width. On desktop
  // web the app is a centred column far narrower than the window, so window-wide
  // slides left a blank centre page with neighbours bleeding out (audit11 M7).
  const [slideW, setSlideW] = useState(width);

  // P2 FIX: Browse goes directly to app -- NOT to Login
  useEffect(() => {
    Promise.resolve(initLang()).then(() => {
      // Auto-detect system language and offer Spanish if not already set
      try {
        const locale = Platform.OS === 'ios'
          ? NativeModules.SettingsManager?.settings?.AppleLocale ||
            NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] || 'en'
          : NativeModules.I18nManager?.localeIdentifier || 'en';
        if (locale.startsWith('es') || locale.startsWith('ES')) {
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('es'); }
          });
        } else if (locale.startsWith('pt') || locale.startsWith('PT')) {
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('pt'); }
          });
        } else if (locale.startsWith('vi') || locale.startsWith('VI')) {
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('vi'); }
          });
        }
      } catch (e: any) {
      __DEV__ && console.warn(e?.message); }
    }).catch(() => {});
  }, []);

  const browseNow = async () => {
    // The user's state is auto-detected on mount (detectAndSaveUserState).
    AsyncStorage.setItem('onboarding_done', 'true').catch(() => {});
    await AsyncStorage.setItem('has_browsed', 'true').catch(() => {});
    setAppAuth('browsing');
  };

  // "Just arrested?" — straight into the three-step path, no account needed.
  const startJustArrested = async () => {
    AsyncStorage.setItem('onboarding_done', 'true').catch(() => {});
    await setPendingRoute('JustArrested');
    await AsyncStorage.setItem('has_browsed', 'true').catch(() => {});
    setAppAuth('browsing');
  };

  const goToLogin = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true').catch(() => {}); // non-fatal storage write
    navigation.navigate('Login');
  };

  const next = () => {
    if (activeIndex < activeSlides.length - 1) {
      flatRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      browseNow(); // Last slide "Get Started" also goes to browse
    }
  };

  const isLast = activeIndex === activeSlides.length - 1;

  return (
    <View style={styles.screen}
      testID="onboarding-screen">

      {/* Logo + Social proof */}
      <View style={styles.logoWrap}>
        <JTBLogo size={50} />

        {/* ── Crisis resource footer ───────────────────────────────────────── */}
        <View style={{ marginTop: 24, paddingTop: 16, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.15)' }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, fontSize: 11, textAlign: 'center', marginBottom: 4 }}>
            {t('onb_help_q')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.info, fontSize: 13, textAlign: 'center', fontWeight: '600' }}>
            {t('x_onboarding_public_defender_project_1')}
          </Text>
        </View>

      </View>
      <View style={{
        flexDirection:'row', alignItems:'center', justifyContent:'center',
        gap:16, paddingHorizontal:20, marginBottom:8,
      }}>
        <View style={{ alignItems:'center' }}>
          {/* The app has no store rating yet — never show an invented one. */}
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, fontWeight:'900', color:colors.textPrimary }}>{t('onb_private')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>{t('onb_private_sub')}</Text>
        </View>
        <View style={{ width:1, height:28, backgroundColor:colors.border }} />
        <View style={{ alignItems:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, fontWeight:'900', color:colors.textPrimary }}>{t('onb_free')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>{t('onb_free_sub')}</Text>
        </View>
        <View style={{ width:1, height:28, backgroundColor:colors.border }} />
        <View style={{ alignItems:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, fontWeight:'900', color:colors.textPrimary }}>24/7</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>{t('onb_ai_sub')}</Text>
        </View>
      </View>

      {/* ── "Just arrested?" — the core path, no account required ── */}
      <TouchableOpacity
        style={styles.justArrestedBtn}
        onPress={startJustArrested}
        testID="onboarding-just-arrested"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('onb_core_a11y')}
        accessibilityHint={t('onb_core_hint')}
      >
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.justArrestedTitle}>🚨 {t('ja_title')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.justArrestedSub}>1) {t('ja_s1')} · 2) {t('ja_s2')} · 3) {t('ja_s3')}</Text>
        </View>
        <Text style={styles.justArrestedTitle}>→</Text>
      </TouchableOpacity>

      {/* Slides */}
      <Animated.FlatList
        ref={flatRef}
        testID="onboarding-carousel"
        ListEmptyComponent={<View/>}
        data={SLIDES}
        style={styles.carousel}
        onLayout={e => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && w !== slideW) {
            setSlideW(w);
            // keep the current slide in view after a resize
            requestAnimationFrame(() => flatRef.current?.scrollToOffset({ offset: activeIndex * w, animated: false }));
          }
        }}
        getItemLayout={(_, index) => ({ length: slideW, offset: slideW * index, index })}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={s => s.key}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        onMomentumScrollEnd={e => {
          setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / slideW));
        }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: slideW }]} testID="onboarding-slide">
            <View style={[styles.iconCircle, {
              backgroundColor: item.accent + '18',
              borderColor: item.accent + '44' }]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.slideIcon}>{item.icon}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.slideTitle}>{t(item.titleKey)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.slideBody}>{t(item.bodyKey)}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dotsRow}>
        {activeSlides.map((_, i) => {
          const inputRange = [(i-1)*slideW, i*slideW, (i+1)*slideW];
          const w = scrollX.interpolate({ inputRange, outputRange: [8, 24, 8], extrapolate: 'clamp' });
          const o = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
          return <Animated.View key={`item-${i}`} style={[styles.dot, { width: w, opacity: o }]} />;
        })}
      </View>

      {/* CTAs -- Browse is PRIMARY on every slide */}
      <View style={styles.ctaWrap}>

        {/* PRIMARY: Browse -- clear label on every slide */}
        <TouchableOpacity accessibilityRole="button" style={styles.browseBtn} onPress={browseNow} activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.browseBtnText}>
{activeIndex === 0 ? t('onboard_browse_1') : activeIndex === 1 ? t('onboard_browse_2') : activeIndex === 2 ? t('onboard_browse_3') : t('onboard_browse_4')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.browseBtnSub}>{t('onboard_browse_sub')}</Text>
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, textAlign: 'center', lineHeight: 16, paddingHorizontal: 24, marginTop: 6, color: colors.textOnAccent, opacity: 0.9 }}>
          {t('onb_terms_pre')}
          <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }}
            onPress={() => navigation.navigate('TermsOfService')}>
            {t('onb_terms_tos')}
          </Text>
          {t('onb_terms_and')}
          <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }}
            onPress={() => navigation.navigate('PrivacyPolicy')}>
            {t('onb_terms_pp')}
          </Text>
        </Text>
        </TouchableOpacity>

        {/* SECONDARY: Next slide or login */}
        <View style={styles.secondaryRow}>
          {!isLast && (
            <TouchableOpacity
              accessibilityRole="button" style={styles.nextBtn} onPress={next} activeOpacity={0.8}
             accessibilityLabel={t('onboard_next')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.nextBtnText}>{t('onboard_next')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.loginBtn} onPress={goToLogin} activeOpacity={0.8}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.loginBtnText}>
              {isLast ? t('onboard_signin_last') : t('onboard_signin')}
            </Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  justArrestedBtn: { backgroundColor: colors.emergencyDark, borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 },
  justArrestedTitle: { color: colors.white, fontSize: 18, fontWeight: '900' },
  justArrestedSub: { color: colors.white, fontSize: 13, marginTop: 2 },
  screen: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', paddingBottom: 32 },
  logoWrap: {
    marginTop: 56, width: 54, height: 54,
    borderRadius: RADIUS.md, overflow: 'hidden',
    marginBottom: 4,
    shadowColor: COLORS.steel, shadowOpacity: 0.2,
    shadowRadius: 10, elevation: 6 },
  carousel: { alignSelf: 'stretch', width: '100%' },
  slide: {
    alignItems: 'center',
    paddingHorizontal: 32, paddingTop: 16 },
  iconCircle: {
    width: 110, height: 110, borderRadius: 45,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, marginBottom: 24 },
  slideIcon:  { fontSize: 50 },
  slideTitle: {
    fontSize: 30, ...FONTS.black, color: colors.textPrimary,
    textAlign: 'center', lineHeight: 38, marginBottom: 14 },
  slideBody: {
    fontSize: 16, ...FONTS.medium, color: colors.textMuted,
    textAlign: 'center', lineHeight: 26 },
  dotsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginTop: 20, marginBottom: 20 },
  dot: { height: 8, borderRadius: 4, backgroundColor: COLORS.steel },

  ctaWrap: { width: '100%', paddingHorizontal: 24, gap: 10 },

  // PRIMARY button -- Browse/Start -- big, green, unmissable
  browseBtn: {
    backgroundColor: colors.legal,
    borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1, borderColor: colors.legal,
    ...SHADOW.md, shadowColor: colors.legal },
  browseBtnText: { color: colors.textOnAccent, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.2 },
  browseBtnSub:  { color: colors.textOnAccent, fontSize: 11, marginTop: 3, ...FONTS.medium },

  secondaryRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  nextBtn: {
    flex: 1, paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', backgroundColor: 'rgba(133,183,235,0.08)' },
  nextBtnText: { color: colors.info, fontSize: 14, lineHeight: 21, ...FONTS.bold },

  loginBtn: {
    flex: 1.5, paddingVertical: 16,
    borderRadius: RADIUS.md, alignItems: 'center' },
  loginBtnText: { color: colors.textMuted, fontSize: 12, lineHeight: 20, ...FONTS.medium } });
export default React.memo(OnboardingScreen);