import { StripeProvider } from '@stripe/stripe-react-native';
/**
 * App.tsx — Justice Gavel root
 *
 * Auth states:
 *   loading   → splash screen
 *   guest     → onboarding (first time) or login
 *   browsing  → full app, no account
 *   authed    → full app with account
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  AppState, Platform, StatusBar, Text, TouchableOpacity, View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import NetInfo from '@react-native-community/netinfo';

import { initLang } from './src/i18n';
import { registerAuthSetter, AuthState, canBrowse } from './src/services/auth';
import { getToken } from './src/utils/secureStorage';
import { COLORS, ThemeProvider, useTheme } from './src/constants/theme';
import ErrorBoundary from './src/components/ErrorBoundary';
import { Analytics } from './src/services/analytics';
import { MainTabs, GuestNavigator, SplashScreen } from './src/navigation/AppNavigator';
import { registerForPushNotificationsAsync, useOTAUpdates, usePushTokenRefresh } from './src/hooks/useAppSetup';
import AgeGateScreen from './src/screens/AgeGateScreen';
import TermsAcceptanceModal from './src/screens/TermsAcceptanceModal';
import { api } from './src/services/api';

// ── Sentry crash reporting ────────────────────────────────────────────────────
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
  enabled: process.env.NODE_ENV === 'production',
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
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ── Navigation ref — lets us navigate from outside React tree ────────────────
const navigationRef = React.createRef<import('@react-navigation/native').NavigationContainerRef<ReactNavigation.RootParamList>>();

// ── Deep link / URL scheme config ────────────────────────────────────────────
const linking = {
  prefixes: ['justicegavel://', 'https://justicegavel.app'],
  config: {
    screens: {
      // ── Guest flow ────────────────────────────────────────────
      Onboarding: 'onboarding',
      Login:      'login',
      Register:   'register',

      // ── Main app ──────────────────────────────────────────────
      MainTabs: {
        screens: {
          HomeTab:    '',
          ChatTab:    'chat',
          LawyersTab: 'lawyers',
          BailTab:    'bail',
          MoreTab: {
            screens: {
              // Core flows
              MoreHome:     'home',
              HelpNow:      'help',
              Emergency:    'emergency',
              JustArrested: 'just-arrested',

              // Legal tools
              Cases:              'cases',
              CaseTimeline:       'case/:id/timeline',
              DeadlineCalculator: 'deadlines',
              Expungement:        'expungement',
              RightsCard:         'rights',
              WhatHappensNext:    'what-happens-next',
              DUILaws:            'dui-laws',
              DrugPenalties:      'drug-penalties',
              BailCalculator:     'bail-calculator',
              CourtLocator:       'courts',
              SpecialtyCourts:    'specialty-courts',
              MotionLibrary:      'motions',
              LegalResearch:      'research',
              Discovery:          'discovery',

              // Providers
              LawyerProfile:      'attorney/:id',
              SavedLawyers:       'saved/attorneys',
              Booking:            'booking/:lawyerId',

              // Communication
              Messages:           'messages/:caseId',
              Chat:               'ai-chat',

              // Tools
              DocumentScanner:         'scan',
              VoiceNote:               'voice-note',
              Translator:              'interpreter',
              InterrogationRecorder:   'encounter-recorder',
              CourtForms:              'court-forms',

              // Family & Crisis
              FamilyConnect:      'family',
              ArrestMonitor:      'arrest-monitor',
              EmergencyShare:     'emergency-share',
              CrisisResources:    'crisis',

              // Community
              Education:          'learn',
              Resources:          'resources',

              // Account & Legal
              Settings:           'settings',
              TermsOfService:     'terms',
              'RecoveryAgents': 'recovery-agents',
              PrivacyPolicy:      'privacy',
              Rewards:            'rewards',
              Subscription:       'subscribe',
              ConsumerSubscription:'plans',
            },
          },
        },
      },
    },
  },
};

// ── Root stack ────────────────────────────────────────────────────────────────
const RootStack = createNativeStackNavigator();

function AppInner() {
  const [authState, setAuthState]     = useState<AuthState>('loading');
  const [tosNeeded,  setTosNeeded]    = useState(false);
  const [ageVerified, setAgeVerified] = useState<boolean | null>(null);
  const [bioLocked,   setBioLocked]   = useState(false);
  const [bioChecked,  setBioChecked]  = useState(false);
  const [isOffline,   setIsOffline]   = useState(false);
  const { colors } = useTheme();

  // ── OTA updates + push token refresh ───────────────────────────────────────
  useOTAUpdates();
  usePushTokenRefresh();

  // ── Network status ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
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
        if (bioOn === 'true' && Platform.OS !== 'web') {
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (enrolled) {
            const result = await LocalAuthentication.authenticateAsync({
              promptMessage: 'Unlock Justice Gavel',
              disableDeviceFallback: false,
              cancelLabel: 'Use Passcode',
            });
            if (!result.success) setBioLocked(true);
          }
        }
      } catch {}
      setBioChecked(true);

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
        // Check ToS version — show modal if user hasn't accepted current version
        try {
          const tosRes = await api.get('/auth/tos-status').catch(() => null);
          if (tosRes?.data?.needs_acceptance) setTosNeeded(true);
        } catch {}
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

  // ── Push notification → deep navigation ────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string,unknown>;
      if (!data) return;
      try {
        const nav = navigationRef.current;
        if (!nav) return;
        // Route by notification type — navigate to the relevant screen
        if (data.type === 'case_update' && data.case_id) {
          (nav as any).navigate('MoreTab', { screen: 'Cases' });
        } else if (data.type === 'arrest_alert') {
          (nav as any).navigate('MoreTab', { screen: 'ArrestMonitor' });
        } else if (data.type === 'message' && data.case_id) {
          (nav as any).navigate('MoreTab', {
            screen: 'Messages',
            params: { caseId: data.case_id },
          });
        } else if (data.type === 'expungement_eligible') {
          (nav as any).navigate('MoreTab', { screen: 'Expungement' });
        } else if (data.type === 'court_reminder') {
          (nav as any).navigate('MoreTab', { screen: 'Cases' });
        } else if (data.type === 'lead_accepted' || data.type === 'new_lead') {
          (nav as any).navigate('MoreTab', { screen: 'AttorneyDashboard' });
        }
      } catch {}
    });
    return () => sub.remove();
  }, []);

  // ── Clear badge count when app comes to foreground ─────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        Notifications.setBadgeCountAsync(0).catch(() => {});
      }
    });
    Notifications.setBadgeCountAsync(0).catch(() => {});
    return () => sub.remove();
  }, []);

  // ── Loading / splash ────────────────────────────────────────────────────────
  if (authState === 'loading' || !bioChecked) return <SplashScreen />;

  // ── Biometric lock screen ───────────────────────────────────────────────────
  if (bioLocked) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center',
        backgroundColor: colors.bg }}>
        <Text style={{ fontSize:48, marginBottom:24 }}>🔒</Text>
        <Text style={{ fontSize:18, color:colors.textPrimary, fontWeight:'700',
          marginBottom:8 }}>Justice Gavel is locked</Text>
        <Text style={{ fontSize:14, color:colors.textMuted, marginBottom:32,
          textAlign:'center', paddingHorizontal:40, lineHeight:21 }}>
          Use your biometric or device passcode to unlock.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor:colors.navy, borderRadius:12,
            paddingHorizontal:32, paddingVertical:14 }}
          onPress={async () => {
            try {
              const r = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Unlock Justice Gavel',
                disableDeviceFallback: false,
              });
              if (r.success) setBioLocked(false);
            } catch {}
          }}
          accessibilityRole="button"
          accessibilityLabel="Unlock with biometric"
        >
          <Text style={{ color:'#fff', fontWeight:'700', fontSize:16 }}>
            Unlock
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Age gate ────────────────────────────────────────────────────────────────
  if (!ageVerified) {
    return <AgeGateScreen onVerified={() => setAgeVerified(true)} />;
  }

  return (
    <ErrorBoundary>
      <NavigationContainer
          ref={navigationRef}
          linking={linking}
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
        {/* Global offline banner */}
        {isOffline && (
          <TouchableOpacity
            style={{ backgroundColor:'#2C1800', flexDirection:'row',
              alignItems:'center', paddingHorizontal:16, paddingVertical:10,
              gap:8, borderBottomWidth:1, borderBottomColor:'#E65100' }}
            onPress={() => (navigationRef.current as any)?.navigate('MoreTab', { screen:'OfflineStatus' })}
            accessibilityRole="button"
            accessibilityLabel="No internet — tap to see what works offline"
          >
            <Text style={{ fontSize:14 }}>📡</Text>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:13, fontWeight:'700', color:'#FFA726' }}>
                No internet connection
              </Text>
              <Text style={{ fontSize:11, color:'#8FA3B1', lineHeight:16 }}>
                Rights card, deadline calculator, and guides still work offline
              </Text>
            </View>
            <Text style={{ color:'#FFA726', fontSize:12 }}>See what works →</Text>
          </TouchableOpacity>
        )}
        <RootStack.Navigator screenOptions={{ headerShown:false, animation:'fade' }}>
          {canBrowse(authState) ? (
            <RootStack.Screen name="MainTabs" component={MainTabs} />
          ) : (
            <RootStack.Screen name="GuestNav" component={GuestNavigator} />
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    <TermsAcceptanceModal
      visible={tosNeeded}
      onAccepted={() => setTosNeeded(false)}
    />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
      merchantIdentifier="merchant.com.justicegavel"
    >
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
    </StripeProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(App);
