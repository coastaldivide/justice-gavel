/**
 * OnboardingScreen -- First-time user intro
 *
 * Fixes applied:
 *  - Skip → setAppAuth('browsing') directly (not Login)
 *  - "Browse Without Account" visible on EVERY slide (not just last)
 *  - Simple 3rd-grade language
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, FlatList, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAppAuth } from '../services/auth';
import { t, initLang } from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { setUserState} from '../utils/userState';
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

// Situation picker slide -- shown first to all users
const SITUATION_SLIDE = {
  key:'situation', icon:'⚖️', accent: COLORS.navy,
  situations: [
    { key:'arrested', icon:'🔒', label:'I was just arrested' },
    { key:'family',   icon:'👪', label:'My family member was arrested' },
    { key:'record',   icon:'📋', label:'I need to clear my record' },
    { key:'general',  icon:'ℹ️',  label:'I just want to learn' },
  ] };

// Default slides for 'general' / no situation selected
const SLIDES = [
  { key: 'welcome', icon: '🔓', titleKey: 'onboard_slide1_title', bodyKey: 'onboard_slide1_body', accent: COLORS.navy },
  { key: 'bail',    icon: '💰', titleKey: 'onboard_slide2_title', bodyKey: 'onboard_slide2_body', accent: COLORS.bail },
  { key: 'lawyer',  icon: '⚖️', titleKey: 'onboard_slide3_title', bodyKey: 'onboard_slide3_body', accent: COLORS.legal },
  { key: 'free',    icon: '✅', titleKey: 'onboard_slide4_title', bodyKey: 'onboard_slide4_body', accent: COLORS.legal },
];

export default function OnboardingScreen({ route, navigation }: ScreenProps) {
  useEffect(() => {
    detectAndSaveUserState().catch(() => {});
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [activeIndex, setActiveIndex] = useState(0);
  const [situation, setSituation] = React.useState<string | null>(null);
  const [showSituationPicker, setShowSituationPicker] = React.useState(true);
  // Active slides -- changes based on situation selected
  const activeSlides = React.useMemo(() =>
    situation && situation !== 'general'
      ? SITUATION_PATHS[situation as keyof typeof SITUATION_PATHS] || SLIDES
      : SLIDES,
    [situation]
  );
  const [selectedState, setSelectedOnboardState] = React.useState('');
  const [showStatePicker, setShowStatePicker] = React.useState(false);

      {/* Situation picker -- shown on first open */}
      {showSituationPicker && (
        <View style={{ position:'absolute', top:0, left:0, right:0, bottom:0,
          backgroundColor:colors.bg, zIndex:10, padding:24,
          justifyContent:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:26, lineHeight:36,
            fontWeight:'900', color:colors.textPrimary, marginBottom:8, textAlign:'center' }}>
            ⚖️ Justice Gavel
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, lineHeight:24,
            color:colors.textMuted, textAlign:'center', marginBottom:32 }}>
            What brings you here today?
          </Text>
          {SITUATION_SLIDE.situations.map(sit => (
            <TouchableOpacity
              accessibilityRole="button"
              key={sit.key}
              style={{ backgroundColor:colors.bgCard, borderRadius:14, padding:18,
                marginBottom:12, flexDirection:'row', alignItems:'center', gap:14,
                borderWidth:1, borderColor:colors.border }}
              onPress={() => {
                setSituation(sit.key);
                setShowSituationPicker(false);
              }}
              accessibilityLabel={sit.label}
              activeOpacity={0.8}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:28 }}>{sit.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, lineHeight:24,
                fontWeight:'600', color:colors.textPrimary, flex:1 }}>
                {sit.label}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textMuted, fontSize:18 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

  const flatRef  = useRef<InstanceType<typeof FlatList<(typeof SLIDES)[0]>>>( null as any);
  const scrollX  = useRef(new Animated.Value(0)).current;

  // P2 FIX: Browse goes directly to app -- NOT to Login
  useEffect(() => {
    Promise.resolve(initLang()).then(() => {
      // Auto-detect system language and offer Spanish if not already set
      try {
        const { NativeModules, Platform } = require('react-native');
        const locale = Platform.OS === 'ios'
          ? NativeModules.SettingsManager?.settings?.AppleLocale ||
            NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] || 'en'
          : NativeModules.I18nManager?.localeIdentifier || 'en';
        if (locale.startsWith('es') || locale.startsWith('ES')) {
          const { setLang } = require('../i18n');
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('es'); }
          });
        } else if (locale.startsWith('pt') || locale.startsWith('PT')) {
          const { setLang } = require('../i18n');
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('pt'); }
          });
        } else if (locale.startsWith('vi') || locale.startsWith('VI')) {
          const { setLang } = require('../i18n');
                    AsyncStorage.getItem('lang').then((stored: string | null) => {
            if (!stored) { setLang('vi'); }
          });
        }
      } catch (e: any) { __DEV__ && console.warn(e?.message); }
    }).catch(() => {});
  }, []);

  const browseNow = async () => {
    if (selectedState) { await setUserState(selectedState).catch(()=>{}); }
      AsyncStorage.setItem('onboarding_done', 'true');
    await AsyncStorage.setItem('has_browsed', 'true');
    setAppAuth('browsing');
  };

  const goToLogin = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true');
    navigation.navigate('AgeGate');
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
      </View>
      <View style={{
        flexDirection:'row', alignItems:'center', justifyContent:'center',
        gap:16, paddingHorizontal:20, marginBottom:8,
      }}>
        <View style={{ alignItems:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, fontWeight:'900', color:colors.gold }}>★★★★★</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>4.9 App Store</Text>
        </View>
        <View style={{ width:1, height:28, backgroundColor:colors.border }} />
        <View style={{ alignItems:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, fontWeight:'900', color:colors.textPrimary }}>Free</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>Always Free to Start</Text>
        </View>
        <View style={{ width:1, height:28, backgroundColor:colors.border }} />
        <View style={{ alignItems:'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, fontWeight:'900', color:colors.textPrimary }}>24/7</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color:colors.textMuted, marginTop:1 }}>AI Legal Help</Text>
        </View>
      </View>

      {/* Slides */}
      <Animated.FlatList
        ref={flatRef}
        ListEmptyComponent={<View/>}
        data={SLIDES}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={s => s.key}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        onMomentumScrollEnd={e => {
          setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
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
          const inputRange = [(i-1)*width, i*width, (i+1)*width];
          const w = scrollX.interpolate({ inputRange, outputRange: [8, 24, 8], extrapolate: 'clamp' });
          const o = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
          return <Animated.View key={i} style={[styles.dot, { width: w, opacity: o }]} />;
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
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, textAlign: 'center', lineHeight: 16, paddingHorizontal: 24, marginTop: 6, color: 'rgba(133,183,235,0.7)' }}>
          {'By continuing you agree to our '}
          <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }}
            onPress={() => navigation.navigate('MoreTab', { screen: 'TermsOfService' })}>
            Terms of Service
          </Text>
          {' and '}
          <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }}
            onPress={() => navigation.navigate('MoreTab', { screen: 'PrivacyPolicy' })}>
            Privacy Policy
          </Text>
        </Text>
        </TouchableOpacity>

        {/* SECONDARY: Next slide or login */}
        <View style={styles.secondaryRow}>
          {!isLast && (
            <TouchableOpacity
              accessibilityRole="button" style={styles.nextBtn} onPress={next} activeOpacity={0.8}
             accessibilityLabel="{t('onboard_next')}">
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
  screen: {
    flex: 1, backgroundColor: COLORS.bg,
    alignItems: 'center', paddingBottom: 32 },
  logoWrap: {
    marginTop: 56, width: 54, height: 54,
    borderRadius: RADIUS.md, overflow: 'hidden',
    marginBottom: 4,
    shadowColor: COLORS.steel, shadowOpacity: 0.2,
    shadowRadius: 10, elevation: 6 },
  slide: {
    width, alignItems: 'center',
    paddingHorizontal: 32, paddingTop: 16 },
  iconCircle: {
    width: 110, height: 110, borderRadius: 45,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, marginBottom: 24 },
  slideIcon:  { fontSize: 50 },
  slideTitle: {
    fontSize: 30, ...FONTS.black, color: COLORS.bgCard,
    textAlign: 'center', lineHeight: 38, marginBottom: 14 },
  slideBody: {
    fontSize: 16, ...FONTS.medium, color: COLORS.textMuted,
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
  browseBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.2 },
  browseBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 3, ...FONTS.medium },

  secondaryRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  nextBtn: {
    flex: 1, paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', backgroundColor: 'rgba(133,183,235,0.08)' },
  nextBtnText: { color: COLORS.steel, fontSize: 14, lineHeight: 21, ...FONTS.bold },

  loginBtn: {
    flex: 1.5, paddingVertical: 16,
    borderRadius: RADIUS.md, alignItems: 'center' },
  loginBtnText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 20, ...FONTS.medium } });
