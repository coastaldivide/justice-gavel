import Ionicons from '@expo/vector-icons/Ionicons'; // one icon set only: the package root bundles every set's glyph map
import 'react-native-gesture-handler';
import OfflineBanner from './src/components/OfflineBanner';
/**
 * App.tsx — Justice Gavel root
 *
 * Auth states:
 *   loading   → splash screen
 *   guest     → onboarding (first time) or login
 *   browsing  → full app, no account
 *   authed    → full app with account
 */
import React, { useEffect, useState } from 'react';
import {
  AppState, Modal, Platform, StatusBar, Text, TouchableOpacity, View,
} from 'react-native';
import { linkingFor } from './src/navigation/linking';
import { ToastProvider } from './src/components/ToastProvider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Font from 'expo-font';
import { PaymentsProvider } from './src/payments';
import FeedbackButton from './src/components/FeedbackButton';
import { NavigationContainer, createNavigationContainerRef, getStateFromPath, getActionFromState, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import NetInfo from '@react-native-community/netinfo';
import { processSyncQueue } from './src/services/offlineSync';

import { initLang, getLang, t, useLang } from './src/i18n';
import { registerAuthSetter, AuthState, canBrowse, setGuestStart } from './src/services/auth';
import { signOut, takePendingHome } from './src/services/session';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import { getToken } from './src/utils/secureStorage';
import { ThemeProvider, useTheme } from './src/constants/theme';
import { AppIcon, ICONS } from './src/components/AppIcon';
import ErrorBoundary from './src/components/ErrorBoundary';
import { Analytics } from './src/services/analytics';
import { MainTabs, GuestNavigator, SplashScreen } from './src/navigation/AppNavigator';
import { registerForPushNotificationsAsync, useOTAUpdates, usePushTokenRefresh, usePushNotificationTap } from './src/hooks/useAppSetup';
import AgeGateScreen from './src/screens/AgeGateScreen';
import TermsAcceptanceModal from './src/screens/TermsAcceptanceModal';
import { api } from './src/services/api';
import { onDisclaimerRequired } from './src/services/legalGate';

// ── Sentry crash reporting ────────────────────────────────────────────────────
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
  // No-op until a DSN is configured (EXPO_PUBLIC_SENTRY_DSN).
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === 'production',
  environment: __DEV__ ? 'development' : 'production',
  ignoreErrors: ['Network request failed', 'AbortError'],
  tracesSampleRate: 0.2,
  attachScreenshot: false,
  beforeSend(event) {
    // Strip URLs from error reports — they may contain tokens
    if (event.request?.url) event.request.url = '[redacted]';
    return event;
  },
});

// ── Push notification default handler ────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

// ── Navigation ref — lets us navigate from outside React tree ────────────────
const navigationRef = createNavigationContainerRef<any>();

// Deep link / URL scheme config: see src/navigation/linking.ts

// ── Fonts referenced by name in styles (fontFamily: 'Inter_700Bold' …) ───────
const INTER_FONTS = {
  Inter_400Regular:   require('./assets/fonts/Inter_400Regular.ttf'),
  Inter_500Medium:    require('./assets/fonts/Inter_500Medium.ttf'),
  Inter_600SemiBold:  require('./assets/fonts/Inter_600SemiBold.ttf'),
  Inter_700Bold:      require('./assets/fonts/Inter_700Bold.ttf'),
  Inter_800ExtraBold: require('./assets/fonts/Inter_800ExtraBold.ttf'),
  Inter_900Black:     require('./assets/fonts/Inter_900Black.ttf'),
};

// ── Electron / web bridge ────────────────────────────────────────────────────
// electron/main.js calls window.__navigateTo('Settings') from the app menu and
// window.__handleDeepLink('justicegavel://…') for protocol links.
const TAB_ROUTES = new Set(['HomeTab', 'ChatTab', 'LawyersTab', 'BailTab', 'MoreTab']);
let activeLinking = linkingFor(false);
function installDesktopBridge() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const w = window as any;
  w.__navigateTo = (screen: string) => {
    if (!navigationRef.isReady() || !screen) return;
    try {
      if (TAB_ROUTES.has(screen)) navigationRef.navigate(screen);
      else navigationRef.navigate('MoreTab', { screen });
    } catch { /* unknown route */ }
  };
  w.__handleDeepLink = (url: string) => {
    if (!navigationRef.isReady() || !url) return;
    try {
      const prefix = activeLinking.prefixes.find(p => url.startsWith(p));
      const path = prefix ? url.slice(prefix.length) : url;
      const state = getStateFromPath(path.startsWith('/') ? path : '/' + path, activeLinking.config as any);
      const action = state && getActionFromState(state, activeLinking.config as any);
      if (action) navigationRef.dispatch(action);
    } catch { /* malformed link */ }
  };
}

// ── Root stack ────────────────────────────────────────────────────────────────
const RootStack = createNativeStackNavigator();

/** App lock: ask again when the app comes back after this long in the background. */
const RELOCK_AFTER_MS = 60_000;
async function unlockWithBiometrics(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: t('app_unlock_prompt'),
      cancelLabel: t('app_unlock_use_passcode'),
      disableDeviceFallback: false,
    });
    return r.success;
  } catch { return false; }
}

function AppInner() {
  useLang(); // the shell's own text (lock screen, offline banner) follows the language
  const [authState, setAuthState]     = useState<AuthState>('loading');
  const authStateRef = React.useRef<AuthState>('loading');
  authStateRef.current = authState;
  const [tosNeeded,  setTosNeeded]    = useState(false);
  const [ageVerified, setAgeVerified] = useState<boolean | null>(null);
  const [bioLocked,   setBioLocked]   = useState(false);
  const [bioChecked,  setBioChecked]  = useState(false);
  const [isOffline,   setIsOffline]   = useState(false);
  const { colors, isDark } = useTheme();
  // Navigation chrome (screen background behind every screen, stack cards)
  // follows the app theme, so no screen flashes or shows white in dark mode.
  const navTheme = React.useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return { ...base, dark: isDark, colors: { ...base.colors, background: colors.bg, card: colors.headerBg,
      text: colors.textPrimary, border: colors.border, primary: colors.textBrand } };
  }, [isDark, colors]);
  // Web: the page behind the app (#root, body) follows the theme too, so no
  // white shows through transparent screens or around the phone-width column.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (root) root.style.background = colors.bg;
    document.body.style.background = colors.bg;
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark, colors]);

  // ── OTA updates + push token refresh ───────────────────────────────────────
  useOTAUpdates();
  usePushTokenRefresh();
  usePushNotificationTap(navigationRef);

  // ── Network status ──────────────────────────────────────────────────────────
  useEffect(() => {
    let wasOnline: boolean | null = null;
    const unsub = NetInfo.addEventListener(state => {
      const offline = state.isConnected === false;
      setIsOffline(offline);
      // Send cases saved offline: on start (left from an earlier session) and on every reconnect
      if (!offline && wasOnline !== true) processSyncQueue().catch(() => {});
      wasOnline = !offline;
    });
    return unsub;
  }, []);

  // ── Startup: lang → biometric → age gate → auth ────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') registerForPushNotificationsAsync().catch(() => {});
    registerAuthSetter(setAuthState);

    (async () => {
      await initLang();

      // Biometric lock
      try {
        const bioOn = await AsyncStorage.getItem('biometric_enabled');
        if (bioOn === 'true' && Platform.OS !== 'web' && await LocalAuthentication.isEnrolledAsync()) {
          if (!(await unlockWithBiometrics())) setBioLocked(true);
        }
      } catch { /* biometrics unavailable: never lock the person out */ }
      setBioChecked(true);

      // Someone who has seen the intro starts the signed-out flow at Sign in.
      if (await AsyncStorage.getItem('onboarding_done').catch(() => null)) setGuestStart('Login');

      // Age gate
      const ageOk = await AsyncStorage.getItem('age_verified');
      setAgeVerified(!!ageOk);

      // Auth state: check secure token storage first, then fall back to AsyncStorage
      // for users upgrading from a version before SecureStore migration
      const token = await getToken()
        .catch(() => null)
        ?? await AsyncStorage.getItem('token').catch(() => null);

      if (token) {
        setAuthState('authed');
        return;
      }
      const hasBrowsed = await AsyncStorage.getItem('has_browsed');
      if (hasBrowsed) {
        setAuthState('browsing');
        return;
      }
      setAuthState('guest');
    })();
  }, []);

  // ── Legal gate: ToS + AI disclaimer ────────────────────────────────────────
  // Checked every time the app becomes signed-in (cold start with a stored
  // token, login, registration) — not only on cold start — and re-opened by
  // any 451 disclaimer_required (e.g. after a disclaimer version bump).
  useEffect(() => {
    if (authState !== 'authed') { setTosNeeded(false); return; }
    let cancelled = false;
    (async () => {
      const [tos, disc] = await Promise.all([
        api.get('/auth/tos-status').catch(() => null),
        api.get('/auth/disclaimer/status').catch(() => null),
      ]);
      if (cancelled) return;
      if (tos?.data?.needs_acceptance || disc?.data?.required) setTosNeeded(true);
      else openPendingHome();
      // Reminders fire at local wall-clock times: keep the account's zone current.
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })();
      if (tz) api.post('/push/timezone', { timezone: tz }).catch(() => {});
      // …and its language (court reminders / e-mails are written in it).
      api.post('/push/language', { language: getLang() }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [authState]);

  // After sign-in: the attorney / bail-agent dashboard, once the Terms are done.
  function openPendingHome() {
    const home = takePendingHome();
    if (home && navigationRef.isReady()) navigationRef.navigate('MainTabs', { screen: 'MoreTab', params: { screen: home } });
  }

  useEffect(() => onDisclaimerRequired(() => {
    if (authStateRef.current === 'authed') setTosNeeded(true);
  }), []);

  // ── Clear badge count when app comes to foreground; app lock on return ─────
  useEffect(() => {
    let backgroundAt: number | null = null;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') backgroundAt = Date.now();
      if (state === 'active') {
        Notifications.setBadgeCountAsync(0).catch(() => {});
        const away = backgroundAt === null ? 0 : Date.now() - backgroundAt;
        backgroundAt = null;
        if (Platform.OS !== 'web' && away > RELOCK_AFTER_MS) {
          AsyncStorage.getItem('biometric_enabled').then(async on => {
            if (on === 'true' && await LocalAuthentication.isEnrolledAsync()) {
              setBioLocked(true);
              if (await unlockWithBiometrics()) setBioLocked(false);
            }
          }).catch(() => { /* biometrics unavailable */ });
        }
      }
    });
    Notifications.setBadgeCountAsync(0).catch(() => {});
    return () => sub.remove();
  }, []);

  // ── Loading / splash ────────────────────────────────────────────────────────
  if (authState === 'loading' || !bioChecked) return <SplashScreen />;

  // ── Age gate ────────────────────────────────────────────────────────────────
  if (!ageVerified) {
    return <AgeGateScreen onVerified={() => setAgeVerified(true)} />;
  }

  // Deep links for the navigator that is mounted (signed-out flow vs main app)
  activeLinking = linkingFor(!canBrowse(authState));

  // ── App lock: a full-screen modal OVER the app, so unlocking after a return
  //    from the background keeps the person where they were ───────────────────
  const lockScreen = (
    <Modal visible={bioLocked} animationType="none" onRequestClose={() => { /* stays until unlocked */ }}>
      <View style={{ flex:1, justifyContent:'center', alignItems:'center',
        backgroundColor: colors.bg }}>
        <AppIcon name={ICONS.lock} size={48} color={colors.textBrand} style={{ marginBottom:24 }} />
        <Text style={{ fontSize:18, color:colors.textPrimary, fontWeight:'700',
          marginBottom:8 }}>{t('app_locked_title')}</Text>
        <Text style={{ fontSize:14, color:colors.textMuted, marginBottom:32,
          textAlign:'center', paddingHorizontal:40, lineHeight:21 }}>
          {t('app_locked_body')}
        </Text>
        <TouchableOpacity
          style={{ backgroundColor:colors.navy, borderRadius:12,
            paddingHorizontal:32, paddingVertical:14 }}
          onPress={async () => { if (await unlockWithBiometrics()) setBioLocked(false); }}
          accessibilityRole="button"
          accessibilityLabel={t('x_biometric_lock_view_unlock_with_biometric')}
        >
          <Text style={{ color:colors.white, fontWeight:'700', fontSize:16 }}>
            {t('x_biometric_lock_view_unlock')}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );

  return (
    <ErrorBoundary>
      <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <ToastProvider>
      <NavigationContainer linking={activeLinking} theme={navTheme}
          ref={navigationRef}
          onReady={installDesktopBridge}
          onStateChange={(state) => {
            // Track every screen navigation for funnel analysis in Mixpanel
            if (!state) return;
            const getActiveRoute = (navState: Record<string, unknown>): string => {
              const routes = navState.routes as Record<string,unknown>[];
              const route  = routes[navState.index as number ?? routes.length - 1];
              if (route.state) return getActiveRoute(route.state as Record<string, unknown>);
              return String(route.name || '');
            };
            try {
              const screen = getActiveRoute(state as unknown as Record<string, unknown>);
              if (screen) Analytics.track('screen_view', { screen });
            } catch {}
          }}
        >
        {/* The one offline banner (translated; tap → what still works offline) */}
        <OfflineBanner
          visible={isOffline}
          onPress={() => { if (navigationRef.isReady()) navigationRef.navigate('MoreTab', { screen: 'OfflineStatus' }); }}
        />
        <RootStack.Navigator screenOptions={{ headerShown:false, animation:'fade' }}>
          {canBrowse(authState) ? (
            <RootStack.Screen name="MainTabs" component={MainTabs} />
          ) : (
            <RootStack.Screen name="GuestNav" component={GuestNavigator} />
          )}
          {/* The password-reset e-mail link works signed out, browsing or signed in */}
          <RootStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
      </ToastProvider>
      {/* Beta feedback — only shows in dev/beta builds */}
      <FeedbackButton screen="App" />
      </>
    <TermsAcceptanceModal
      visible={tosNeeded}
      onAccepted={() => { setTosNeeded(false); openPendingHome(); }}
      onDecline={async () => {
        setTosNeeded(false);
        await signOut();
      }}
    />
    {/* last = on top of the Terms modal too */}
    {lockScreen}
    </ErrorBoundary>
    );
}

function App() {
  // Load the Inter font family used throughout the styles. Rendering is not
  // blocked: until (or if) loading fails, text falls back to the system font.
  useEffect(() => {
    Font.loadAsync(INTER_FONTS).catch(() => {});
    // Load the icon font up front too: @expo/vector-icons otherwise loads it on
    // the first icon render and does not catch the failure — offline (a police
    // station, airplane mode) that surfaced as an unhandled NetworkError.
    Font.loadAsync(Ionicons.font).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ErrorBoundary>
      {/* StripeProvider only mounts on native when a publishable key is set */}
      <PaymentsProvider>
      <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
    </PaymentsProvider>
    </ErrorBoundary>
    </GestureHandlerRootView>
    );
}

export default Sentry.wrap(App);
