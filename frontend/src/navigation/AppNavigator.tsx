declare var window: any;
declare var MediaRecorder: any;
declare var navigator: any;

/**
 * AppNavigator.tsx — Navigation structure
 * Contains all stack and tab navigators.
 */
import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { COLORS } from '../constants/theme';
import ErrorBoundary from '../components/ErrorBoundary';
import JTBLogo from '../components/JTBLogo';

// ── Screen imports — all 65 screens ──────────────────────────────────────────
import AdminVerificationScreen from '../screens/AdminVerificationScreen';
import AdvocacyScreen from '../screens/AdvocacyScreen';
import ArrestMonitorScreen from '../screens/ArrestMonitorScreen';
import AttorneyDashboardScreen from '../screens/AttorneyDashboardScreen';
import JustArrestedScreen   from '../screens/JustArrestedScreen';
import BailCalculatorScreen from '../screens/BailCalculatorScreen';
import BailSearchScreen from '../screens/BailSearchScreen';
import BondsmanDashboardScreen from '../screens/BondsmanDashboardScreen';
import BookingScreen from '../screens/BookingScreen';
import CaseScreen from '../screens/CaseScreen';
import CaseTimelineScreen from '../screens/CaseTimelineScreen';
import ChatScreen from '../screens/ChatScreen';
import CheckInManagerScreen from '../screens/CheckInManagerScreen';
import CheckInScreen from '../screens/CheckInScreen';
import ConsumerSubscriptionScreen from '../screens/ConsumerSubscriptionScreen';
import ContactsScreen from '../screens/ContactsScreen';
import CourtFormsScreen from '../screens/CourtFormsScreen';
import CourtLocatorScreen from '../screens/CourtLocatorScreen';
import CrisisResourcesScreen from '../screens/CrisisResourcesScreen';
import DUILawsScreen from '../screens/DUILawsScreen';
import DeadlineCalculatorScreen from '../screens/DeadlineCalculatorScreen';
import DiscoveryScreen from '../screens/DiscoveryScreen';
import DiversionScreen from '../screens/DiversionScreen';
import DocumentScannerScreen from '../screens/DocumentScannerScreen';
import DrugPenaltiesScreen from '../screens/DrugPenaltiesScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import EmergencyShareScreen from '../screens/EmergencyShareScreen';
import ExpungementScreen from '../screens/ExpungementScreen';
import FamilyConnectScreen from '../screens/FamilyConnectScreen';
import FamilyCourtScreen from '../screens/FamilyCourtScreen';
import GoldenGavelScreen from '../screens/GoldenGavelScreen';
import HelpNowScreen from '../screens/HelpNowScreen';
import HomeScreen from '../screens/HomeScreen';
import HousingRightsScreen from '../screens/HousingRightsScreen';
import IceDetentionScreen from '../screens/IceDetentionScreen';
import ImmigrationConsequencesScreen from '../screens/ImmigrationConsequencesScreen';
import InsuranceScreen from '../screens/InsuranceScreen';
import JuvenileJusticeScreen from '../screens/JuvenileJusticeScreen';
import LawyerProfileScreen from '../screens/LawyerProfileScreen';
import LawyersScreen from '../screens/LawyersScreen';
import LegalResearchScreen from '../screens/LegalResearchScreen';
import LessonsScreen from '../screens/LessonsScreen';
import LoginScreen from '../screens/LoginScreen';
import MatchScreen from '../screens/MatchScreen';
import MentalHealthDiversionScreen from '../screens/MentalHealthDiversionScreen';
import MessagesScreen from '../screens/MessagesScreen';
import MotionLibraryScreen from '../screens/MotionLibraryScreen';
import OfflineStatusScreen from '../screens/OfflineStatusScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import PILeadScreen from '../screens/PILeadScreen';
import PaymentsScreen from '../screens/PaymentsScreen';
import QuickConnectScreen from '../screens/QuickConnectScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ResourcesScreen from '../screens/ResourcesScreen';
import RightsCardScreen from '../screens/RightsCardScreen';
import SavedLawyersScreen from '../screens/SavedLawyersScreen';
import SearchScreen from '../screens/SearchScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SpecialtyCourtsScreen from '../screens/SpecialtyCourtsScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import TenantRightsScreen from '../screens/TenantRightsScreen';
import TranslatorScreen from '../screens/TranslatorScreen';
import VoiceNoteScreen from '../screens/VoiceNoteScreen';
import WhatHappensNextScreen from '../screens/WhatHappensNextScreen';
import InterrogationRecorderScreen from '../screens/InterrogationRecorderScreen';
import TermsOfServiceScreen from '../screens/TermsOfServiceScreen';
import PrivacyPolicyScreen  from '../screens/PrivacyPolicyScreen';
import RecoveryAgentsScreen from '../screens/RecoveryAgentsScreen';
import FirmVerticalScreen from '../screens/FirmVerticalScreen';
import FirmAcquisitionScreen from '../screens/FirmAcquisitionScreen';
import MatterIntelligenceScreen from '../screens/MatterIntelligenceScreen';
import { Analytics } from '../services/analytics';
import HagueContactScreen from '../screens/HagueContactScreen';
import AgeGateScreen            from '../screens/AgeGateScreen';
import AttorneyPrivacyScreen from '../screens/AttorneyPrivacyScreen';
import ChildSupportScreen from '../screens/ChildSupportScreen';

declare var navigationRef: any; // hoisted from component scope
// ── Deep link configuration ────────────────────────────────────────────────────
// Handles universal links (https://justicegavel.app/...) and
// custom scheme (justicegavel://...) from push notifications,
// emails, and referral links.
const linking = {
  prefixes: ['https://justicegavel.app', 'justicegavel://'],
  config: {
    screens: {
      HomeTab: '',
      ChatTab: 'chat',
      LawyersTab: 'lawyers',
      BailTab: 'bail',
      MoreTab: {
        screens: {
          MoreHome: 'home',
          Cases: 'cases',
          Messages: 'messages/:caseId?',
          Expungement: 'expunge',
          Subscription: 'subscribe',
          ConsumerSubscription: 'subscribe/consumer',
          ArrestMonitor: 'arrest-monitor',
          Settings: 'settings',
          // Password reset and auth flows
          Login: 'login',
          Register: 'register',
        },
      },
    },
  },
};



// ── Stack / Tab instances ─────────────────────────────────────────────────────
const MoreStack  = createNativeStackNavigator();
const GuestStack = createNativeStackNavigator();
const Tab        = createBottomTabNavigator();

// ── Shared header style ────────────────────────────────────────────────────────
const HDR = {
  headerStyle:     { backgroundColor: COLORS.navy || '#020E1C' },
  headerTintColor: '#fff',
  headerTitleStyle:{ fontWeight: '700' as const },
  headerBackTitle: 'Back',
};

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

// ── More stack — all secondary screens ────────────────────────────────────────
function MoreNavigator() {
  // Expose navigation to Electron menu and deep links
  // electron/main.js calls: window.__navigateTo('Settings')
  // This bridge is harmless on mobile — window is not defined in RN native
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__navigateTo = (screen: string) => {
        try { navigationRef.current?.navigate(screen as never); } catch {}
      };
      (window as any).__handleDeepLink = (url: string) => {
        try {
          const path = url.replace('justicegavel://', '');
          const [screen, ...params] = path.split('/');
          if (screen) navigationRef.current?.navigate(screen as never, { id: params[0] });
        } catch {}
      };
    }
  }, []);

  return (
    <ErrorBoundary>
    <MoreStack.Navigator screenOptions={HDR}>
      <MoreStack.Screen name="MoreHome"              component={HomeScreen}                 options={{ headerShown: false }} />
      <MoreStack.Screen name="Emergency"             component={EmergencyScreen}             options={{ title: '🚨 Emergency Alert' }} />
      <MoreStack.Screen name="CaseTimeline"          component={CaseTimelineScreen}          options={{ title: 'Case Timeline' }} />
      <MoreStack.Screen name="MatterIntelligence"     component={MatterIntelligenceScreen}  options={{ title: '🧠 Matter Intelligence' }} />
      <MoreStack.Screen name="FirmAcquisition"       component={FirmAcquisitionScreen}    options={{ title: '🚀 Start Your Firm Trial' }} />
      <MoreStack.Screen name="FirmVertical"         component={FirmVerticalScreen}        options={{ title: '🏢 Firm Vertical Setup' }} />
      <MoreStack.Screen name="Cases"                 component={CaseScreen}                  options={{ title: '📁 My Cases' }} />
      <MoreStack.Screen name="Contacts"              component={ContactsScreen}              options={{ title: 'Emergency Contacts' }} />
      <MoreStack.Screen name="Bail"                  component={BailSearchScreen}            options={{ title: '🔓 Bail Agents' }} />
      <MoreStack.Screen name="Resources"             component={ResourcesScreen}             options={{ title: '📋 Legal Resources' }} />
      <MoreStack.Screen name="Payments"              component={PaymentsScreen}              options={{ title: '💳 Payments' }} />
      <MoreStack.Screen name="Education"             component={LessonsScreen}               options={{ title: '📚 Know Your Rights' }} />
      <MoreStack.Screen name="Match"                 component={MatchScreen}                 options={{ title: '🎯 AI Lawyer Match' }} />
      <MoreStack.Screen name="Insurance"             component={InsuranceScreen}             options={{ title: '🛡️ Legal Insurance' }} />
      <MoreStack.Screen name="GoldenGavel"           component={GoldenGavelScreen}           options={{ title: '🏆 Golden Gavel' }} />
      <MoreStack.Screen name="AdminVerification"     component={AdminVerificationScreen}     options={{ title: '⚖️ Bar Verification' }} />
      <MoreStack.Screen name="Advocacy"              component={AdvocacyScreen}              options={{ title: '📊 Advocacy Stats' }} />
      <MoreStack.Screen
        name="RecoveryAgents"
        component={RecoveryAgentsScreen}
        options={{
          title: 'Recovery Agents',
          headerStyle: { backgroundColor: '#042C53' },
          headerTintColor: '#fff',
        }}
      />
      <MoreStack.Screen name="BondsmanDashboard"     component={BondsmanDashboardScreen}     options={{ title: '🔓 Lead Dashboard' }} />
      <MoreStack.Screen name="Subscription"          component={SubscriptionScreen}          options={{ title: '⚖️ Attorney Plans' }} />
      <MoreStack.Screen name="FamilyConnect"         component={FamilyConnectScreen}         options={{ title: '🚨 Emergency Connection' }} />
      <MoreStack.Screen name="QuickConnect"          component={QuickConnectScreen}          options={{ title: '⚡ Quick Connect' }} />
      <MoreStack.Screen name="ConsumerSubscription"  component={ConsumerSubscriptionScreen}  options={{ title: '📋 Choose Your Plan' }} />
      <MoreStack.Screen name="ArrestMonitor"         component={ArrestMonitorScreen}         options={{ title: '🔔 Arrest Monitor' }} />
      <MoreStack.Screen name="HelpNow"               component={HelpNowScreen}               options={{ title: '🚨 Get Help Now', headerStyle: { backgroundColor: '#B71C1C' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="Booking"               component={BookingScreen}               options={{ title: '📅 Book a Consultation' }} />
      <MoreStack.Screen name="RightsCard"            component={RightsCardScreen}            options={{ title: '📋 Know Your Rights Card' }} />
      <MoreStack.Screen name="CheckIn"               component={CheckInScreen}               options={{ title: '✓ Daily Check-In', headerStyle: { backgroundColor: COLORS.navy }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="CheckInManager"        component={CheckInManagerScreen}        options={{ title: '📋 Check-In Manager' }} />
      <MoreStack.Screen name="Expungement"           component={ExpungementScreen}           options={{ title: '📋 Clear My Record' }} />
      <MoreStack.Screen name="WhatHappensNext"       component={WhatHappensNextScreen}       options={{ title: '⚖️ What Happens Next' }} />
      <MoreStack.Screen name="EmergencyShare"        component={EmergencyShareScreen}        options={{ title: '🚨 Emergency Share', headerStyle: { backgroundColor: '#B71C1C' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="CrisisResources"       component={CrisisResourcesScreen}       options={{ title: '💙 Crisis Support', headerStyle: { backgroundColor: '#1565C0' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="Diversion"             component={DiversionScreen}             options={{ title: '🤝 Diversion Eligibility' }} />
      <MoreStack.Screen name="Translator"            component={TranslatorScreen}            options={{ title: '🗣 Interpreter' }} />
      <MoreStack.Screen name="Discovery"             component={DiscoveryScreen}             options={{ title: '📄 Discovery AI' }} />
      <MoreStack.Screen name="LegalResearch"         component={LegalResearchScreen}         options={{ title: '⚖️ Legal Research' }} />
      <MoreStack.Screen name="MotionLibrary"         component={MotionLibraryScreen}         options={{ title: '📄 Motion Library' }} />
      <MoreStack.Screen name="VoiceNote"             component={VoiceNoteScreen}             options={{ title: '🎙 Voice Note' }} />
      <MoreStack.Screen name="Messages"              component={MessagesScreen}              options={{ title: '💬 Messages' }} />
      <MoreStack.Screen name="SavedLawyers"          component={SavedLawyersScreen}          options={{ title: '⭐ Saved Lawyers' }} />
      <MoreStack.Screen name="DeadlineCalculator"    component={DeadlineCalculatorScreen}    options={{ title: '⏰ Deadline Calculator' }} />
      <MoreStack.Screen name="PILead"                component={PILeadScreen}                options={{ title: '⚖️ Submit Your Case' }} />
      <MoreStack.Screen name="TenantRights"          component={TenantRightsScreen}          options={{ title: '🏠 Tenant Rights', headerStyle: { backgroundColor: '#00796B' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="IceDetention"          component={IceDetentionScreen}          options={{ title: '✈️ ICE Detention Help', headerStyle: { backgroundColor: '#B71C1C' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="JuvenileJustice"       component={JuvenileJusticeScreen}       options={{ title: '🧒 Juvenile Justice' }} />
        <MoreStack.Screen name="HagueContact"
          component={HagueContactScreen}
          options={{ title: '🌐 Hague Convention' }} />
      <MoreStack.Screen name="MentalHealthDiversion" component={MentalHealthDiversionScreen} options={{ title: '🧠 Mental Health & Law' }} />
      <MoreStack.Screen name="OfflineStatus"         component={OfflineStatusScreen}         options={{ title: '📵 Offline Mode' }} />
      <MoreStack.Screen name="FamilyCourt"           component={FamilyCourtScreen}           options={{ title: '👨‍👩‍👧 Family Court' }} />
      <MoreStack.Screen name="ImmigrationConsequences" component={ImmigrationConsequencesScreen} options={{ title: '🌎 Immigration Consequences' }} />
      <MoreStack.Screen name="HousingRights"         component={HousingRightsScreen}         options={{ title: '🏘️ Housing Rights' }} />
      <MoreStack.Screen name="AttorneyDashboard"     component={AttorneyDashboardScreen}     options={{ title: '⚖️ Attorney Dashboard' }} />
      <MoreStack.Screen name="DUILaws"               component={DUILawsScreen}               options={{ title: '🚗 DUI Laws by State' }} />
      <MoreStack.Screen name="DrugPenalties"         component={DrugPenaltiesScreen}         options={{ title: '💊 Drug Charge Penalties' }} />
      <MoreStack.Screen name="SpecialtyCourts"       component={SpecialtyCourtsScreen}       options={{ title: '⚖️ Specialty Courts' }} />
      <MoreStack.Screen name="CourtLocator"          component={CourtLocatorScreen}          options={{ title: '🏛️ Court Locator' }} />
      <MoreStack.Screen name="BailCalculator"        component={BailCalculatorScreen}        options={{ title: '💰 Bail Calculator' }} />
      <MoreStack.Screen name="JustArrested"         component={JustArrestedScreen}        options={{ title: '🚨 Just Arrested — What To Do', headerStyle: { backgroundColor: '#B71C1C' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="CourtForms"            component={CourtFormsScreen}            options={{ title: '📝 Court Forms' }} />
      <MoreStack.Screen name="InterrogationRecorder" component={InterrogationRecorderScreen} options={{ title: '🎙 Encounter Recorder', headerStyle: { backgroundColor: '#B71C1C' }, headerTintColor: '#fff' }} />
      <MoreStack.Screen name="DocumentScanner"       component={DocumentScannerScreen}       options={{ title: '📷 Document Scanner' }} />
      <MoreStack.Screen name="LawyerProfile"         component={LawyerProfileScreen}         options={{ title: 'Attorney Profile' }} />
      <MoreStack.Screen name="Search"                component={SearchScreen}                options={{ title: '🔍 Search' }} />
      <MoreStack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: "Terms of Service" }} />
      <MoreStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
      <MoreStack.Screen name="Settings"              component={SettingsScreen}
options={{ title: '⚙️ Settings' }} />
    </MoreStack.Navigator>
    </ErrorBoundary>
  );
}

// ── Main tab navigator ─────────────────────────────────────────────────────────
// ── PHASE 2 UX ENHANCEMENT — Role-based tab bars ─────────────────────────────
// When user role is 'attorney', swap bottom tabs to:
//   Dashboard | Matters | Deadlines | AI Research | Resources
// Implementation: read role from AsyncStorage/auth state in MainTabs,
// render AttorneyTabNavigator vs ConsumerTabNavigator based on role.
// This eliminates the need for attorneys to dig through 'Resources' to reach
// FirmVerticalScreen, MatterIntelligenceScreen, and DeadlineCalculatorScreen.
// ─────────────────────────────────────────────────────────────────────────────

function MainTabs() {
  return (
    <ErrorBoundary>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:    COLORS.navy || '#020E1C',
        tabBarInactiveTintColor:  '#999',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor:  '#88888840',
          borderTopWidth:  1.5,
          height:          62,
          paddingBottom:   8,
          paddingTop:      4,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}>
      <Tab.Screen name="HomeTab"    component={HomeScreen}      options={{ tabBarButton: (props: any) => <TouchableOpacity testID="home-tab" {...props} />, tabBarLabel: 'Home', tabBarTestID: 'home-tab',     tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> } as any} />
      <Tab.Screen name="ChatTab"    component={ChatScreen}      options={{ tabBarLabel: 'AI Help',  tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} /> }} />
      <Tab.Screen name="LawyersTab" component={LawyersScreen}   options={{ tabBarLabel: 'Lawyers',  tabBarIcon: ({ focused }) => <TabIcon emoji="⚖️" focused={focused} /> }} />
      <Tab.Screen name="BailTab"    component={BailSearchScreen}options={{ tabBarLabel: 'Bail Help',tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }} />
      <Tab.Screen name="MoreTab"    component={MoreNavigator}   options={{ tabBarButton: (props: any) => <TouchableOpacity testID="more-tab" {...props} />, tabBarLabel: 'Resources', tabBarTestID: 'more-tab',     tabBarIcon: ({ focused }) => <TabIcon emoji="📚" focused={focused} /> } as any} />
    </Tab.Navigator>
    </ErrorBoundary>
  );
}

// ── Guest navigator ────────────────────────────────────────────────────────────
function GuestNavigator() {
  return (
    <ErrorBoundary>
    <GuestStack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      <GuestStack.Screen name="AgeGate"    component={AgeGateScreen}    />
      <GuestStack.Screen name="Onboarding" component={OnboardingScreen} />
      <GuestStack.Screen name="Login"      component={LoginScreen} />
      <GuestStack.Screen name="Register"   component={RegisterScreen} options={{ headerShown: true, title: 'Create Account', ...HDR }} />
      <GuestStack.Screen name="AttorneyPrivacy" component={AttorneyPrivacyScreen} />
      <GuestStack.Screen name="ChildSupport" component={ChildSupportScreen} />
    </GuestStack.Navigator>
    </ErrorBoundary>
  );
}

// ── Splash screen ──────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <ErrorBoundary>
    <View style={{ flex: 1, backgroundColor: '#020E1C', alignItems: 'center', justifyContent: 'center' }}>
      <JTBLogo size={110} />
      <Text style={{ fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: 1.5, marginBottom: 4, marginTop: 24 }}>
        JUSTICE GAVEL
      </Text>
      <Text style={{ fontSize: 10, fontWeight: '600', color: '#85B7EB', letterSpacing: 5, marginBottom: 8 }}>
        YOUR LEGAL CONNECTION
      </Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(133,183,235,0.75)', letterSpacing: 0.5, marginBottom: 36, textAlign: 'center', paddingHorizontal: 40 }}>
        Innocent until proven guilty.
      </Text>
      <ActivityIndicator color="#85B7EB" size="large" />
    </View>
    </ErrorBoundary>
  );
}

export { TabIcon, MoreNavigator, MainTabs, GuestNavigator, SplashScreen };
export { linking };


// ── Screen tracking — call from App.tsx onStateChange ──────────────────────────
export function trackScreenChange(state: Record<string, unknown> | undefined) {
  if (!state) return;
  // Walk the nav state to find the active route name
  let route = state as Record<string, unknown>;
  while (route.routes) {
    const routes = route.routes as Record<string, unknown>[];
    route = routes[route.index as number ?? routes.length - 1];
  }
  if (route.name) {
    Analytics.track('screen_view', { screen: route.name } as any);
  }
}
      <GuestStack.Screen name="ChildSupport" component={ChildSupportScreen} options={{ headerShown: false }} />

