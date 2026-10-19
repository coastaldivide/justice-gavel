
/**
 * AppNavigator.tsx — Navigation structure
 * Contains all stack and tab navigators.
 */
import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList } from '../types/navigation';
import { t, useLang, locale } from '../i18n';
import { COLORS } from '../constants/theme';
import ErrorBoundary from '../components/ErrorBoundary';
import JTBLogo from '../components/JTBLogo';

// ── Screen imports — all 70 screens (65 + 5 BarPrep) ──────────────────────────
// ── Bar Exam Prep screens ────────────────────────────────────────────────────
import BarPrepHomeScreen        from '../screens/BarPrepHomeScreen';
import BarPrepQuizScreen        from '../screens/BarPrepQuizScreen';
import BarPrepProgressScreen    from '../screens/BarPrepProgressScreen';
import BarPrepScheduleScreen    from '../screens/BarPrepScheduleScreen';
import BarPrepResultsScreen     from '../screens/BarPrepResultsScreen';

import AttorneyInboxScreen   from '../screens/AttorneyInboxScreen';
import JustArrestedScreen   from '../screens/JustArrestedScreen';
import EmergencyShareScreen from '../screens/EmergencyShareScreen';
import LoginScreen from '../screens/LoginScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import RegisterScreen from '../screens/RegisterScreen';
import RightsCardScreen from '../screens/RightsCardScreen';
import CourtDatesScreen from '../screens/CourtDatesScreen';
import HelpNowScreen from '../screens/HelpNowScreen';
import CourtDateDetailScreen from '../screens/CourtDateDetailScreen';
import PrivacyPolicyScreen  from '../screens/PrivacyPolicyScreen';
import { Analytics } from '../services/analytics';
import AgeGateScreen            from '../screens/AgeGateScreen';
import LegalDisclaimerScreen from '../screens/LegalDisclaimerScreen';

// ── Lazy-loaded screens (non-critical path) ─────────────────────────────────
// ── Suspense boundary for lazy screens ──────────────────────────────────────
// REQUIRED. React.lazy() components THROW when rendered without a Suspense
// ancestor ("A React component suspended while rendering, but no fallback UI
// was specified"). The efficiency pass converted 69 screens to React.lazy and
// left only a comment here, which would have crashed every one of them on
// first navigation.
//
// Per-screen wrapping (not one boundary around the navigator) is deliberate:
// a single top-level boundary would unmount and remount the whole navigation
// tree on every lazy load, losing tab state and back history.
function ScreenFallback() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
                   backgroundColor: COLORS.white }}>
      <ActivityIndicator size="large" color={COLORS.navyMid} />
    </View>
  );
}

function withSuspense<P extends object>(
  Lazy: React.ComponentType<P>,
): React.ComponentType<P> {
  const Wrapped = (props: P) => (
    <React.Suspense fallback={<ScreenFallback />}>
      <Lazy {...props} />
    </React.Suspense>
  );
  Wrapped.displayName = `withSuspense(${(Lazy as any).displayName || 'Screen'})`;
  return Wrapped;
}

const BarPrepExplanationScreen = withSuspense(React.lazy(() => import('../screens/BarPrepExplanationScreen')));
const AdminVerificationScreen = withSuspense(React.lazy(() => import('../screens/AdminVerificationScreen')));
const AdvocacyScreen = withSuspense(React.lazy(() => import('../screens/AdvocacyScreen')));
const ArrestMonitorScreen = withSuspense(React.lazy(() => import('../screens/ArrestMonitorScreen')));
const AttorneyDashboardScreen = withSuspense(React.lazy(() => import('../screens/AttorneyDashboardScreen')));
const BailCalculatorScreen = withSuspense(React.lazy(() => import('../screens/BailCalculatorScreen')));
const BailSearchScreen = withSuspense(React.lazy(() => import('../screens/BailSearchScreen')));
const BondsmanDashboardScreen = withSuspense(React.lazy(() => import('../screens/BondsmanDashboardScreen')));
const BookingScreen = withSuspense(React.lazy(() => import('../screens/BookingScreen')));
const CaseScreen = withSuspense(React.lazy(() => import('../screens/CaseScreen')));
const CaseTimelineScreen = withSuspense(React.lazy(() => import('../screens/CaseTimelineScreen')));
const ChatScreen = withSuspense(React.lazy(() => import('../screens/ChatScreen')));
const CheckInManagerScreen = withSuspense(React.lazy(() => import('../screens/CheckInManagerScreen')));
const VideoConsultationScreen = withSuspense(React.lazy(() => import('../screens/VideoConsultationScreen')));
const ConflictCheckScreen = withSuspense(React.lazy(() => import('../screens/ConflictCheckScreen')));
const MatterScreen = withSuspense(React.lazy(() => import('../screens/MatterScreen')));
const CheckInScreen = withSuspense(React.lazy(() => import('../screens/CheckInScreen')));
const ConsumerSubscriptionScreen = withSuspense(React.lazy(() => import('../screens/ConsumerSubscriptionScreen')));
const ContactsScreen = withSuspense(React.lazy(() => import('../screens/ContactsScreen')));
const CourtFormsScreen = withSuspense(React.lazy(() => import('../screens/CourtFormsScreen')));
const CourtLocatorScreen = withSuspense(React.lazy(() => import('../screens/CourtLocatorScreen')));
const CrisisResourcesScreen = withSuspense(React.lazy(() => import('../screens/CrisisResourcesScreen')));
const LegalPenaltiesScreen = withSuspense(React.lazy(() => import('../screens/LegalPenaltiesScreen')));
const DeadlineCalculatorScreen = withSuspense(React.lazy(() => import('../screens/DeadlineCalculatorScreen')));
const DiscoveryScreen = withSuspense(React.lazy(() => import('../screens/DiscoveryScreen')));
const DiversionScreen = withSuspense(React.lazy(() => import('../screens/DiversionScreen')));
const DocumentScannerScreen = withSuspense(React.lazy(() => import('../screens/DocumentScannerScreen')));
const EmergencyScreen = withSuspense(React.lazy(() => import('../screens/EmergencyScreen')));
const ExpungementScreen = withSuspense(React.lazy(() => import('../screens/ExpungementScreen')));
const FamilyConnectScreen = withSuspense(React.lazy(() => import('../screens/FamilyConnectScreen')));
const FamilyCourtScreen = withSuspense(React.lazy(() => import('../screens/FamilyCourtScreen')));
const GoldenGavelScreen = withSuspense(React.lazy(() => import('../screens/GoldenGavelScreen')));

const HomeScreen = withSuspense(React.lazy(() => import('../screens/HomeScreen')));
const HousingRightsScreen = withSuspense(React.lazy(() => import('../screens/HousingRightsScreen')));
const IceDetentionScreen = withSuspense(React.lazy(() => import('../screens/IceDetentionScreen')));
const ImmigrationConsequencesScreen = withSuspense(React.lazy(() => import('../screens/ImmigrationConsequencesScreen')));
const InsuranceScreen = withSuspense(React.lazy(() => import('../screens/InsuranceScreen')));
const JuvenileJusticeScreen = withSuspense(React.lazy(() => import('../screens/JuvenileJusticeScreen')));
const LawyerProfileScreen = withSuspense(React.lazy(() => import('../screens/LawyerProfileScreen')));
const LawyersScreen = withSuspense(React.lazy(() => import('../screens/LawyersScreen')));
const LegalResearchScreen = withSuspense(React.lazy(() => import('../screens/LegalResearchScreen')));
const LessonsScreen = withSuspense(React.lazy(() => import('../screens/LessonsScreen')));
const MatchScreen = withSuspense(React.lazy(() => import('../screens/MatchScreen')));
const MessagesScreen = withSuspense(React.lazy(() => import('../screens/MessagesScreen')));
const MotionLibraryScreen = withSuspense(React.lazy(() => import('../screens/MotionLibraryScreen')));
const PILeadScreen = withSuspense(React.lazy(() => import('../screens/PILeadScreen')));
const PaymentsScreen = withSuspense(React.lazy(() => import('../screens/PaymentsScreen')));
const QuickConnectScreen = withSuspense(React.lazy(() => import('../screens/QuickConnectScreen')));
const ResourcesScreen = withSuspense(React.lazy(() => import('../screens/ResourcesScreen')));
const SavedLawyersScreen = withSuspense(React.lazy(() => import('../screens/SavedLawyersScreen')));
const SearchScreen = withSuspense(React.lazy(() => import('../screens/SearchScreen')));
const SettingsScreen = withSuspense(React.lazy(() => import('../screens/SettingsScreen')));
const SpecialtyCourtsScreen = withSuspense(React.lazy(() => import('../screens/SpecialtyCourtsScreen')));
const SubscriptionScreen = withSuspense(React.lazy(() => import('../screens/SubscriptionScreen')));
const TenantRightsScreen = withSuspense(React.lazy(() => import('../screens/TenantRightsScreen')));
const TranslatorScreen = withSuspense(React.lazy(() => import('../screens/TranslatorScreen')));
const VoiceNoteScreen = withSuspense(React.lazy(() => import('../screens/VoiceNoteScreen')));
const InterrogationRecorderScreen = withSuspense(React.lazy(() => import('../screens/InterrogationRecorderScreen')));
const TermsOfServiceScreen = withSuspense(React.lazy(() => import('../screens/TermsOfServiceScreen')));
// RecoveryAgentsScreen import removed — item 5.5 (screen unregistered,
// directory unverified, activity prohibited in 4 states).
const FirmVerticalScreen = withSuspense(React.lazy(() => import('../screens/FirmVerticalScreen')));
const FirmDiscoveryScreen = withSuspense(React.lazy(() => import('../screens/FirmDiscoveryScreen')));
const FirmPublicProfileScreen = withSuspense(React.lazy(() => import('../screens/FirmPublicProfileScreen')));
const FirmAcquisitionScreen = withSuspense(React.lazy(() => import('../screens/FirmAcquisitionScreen')));
const MatterIntelligenceScreen = withSuspense(React.lazy(() => import('../screens/MatterIntelligenceScreen')));
const HagueContactScreen = withSuspense(React.lazy(() => import('../screens/HagueContactScreen')));
const AttorneyPrivacyScreen = withSuspense(React.lazy(() => import('../screens/AttorneyPrivacyScreen')));
const ChildSupportScreen = withSuspense(React.lazy(() => import('../screens/ChildSupportScreen')));
const OfflineStatusScreen = withSuspense(React.lazy(() => import('../screens/OfflineStatusScreen')));





// Deep link configuration lives in ./linking.ts (single source of truth).

// ── Stack / Tab instances ─────────────────────────────────────────────────────
const MoreStack  = createNativeStackNavigator<RootStackParamList>();
const GuestStack = createNativeStackNavigator<RootStackParamList>();
const Tab        = createBottomTabNavigator<RootStackParamList>();

// ── Shared header style ────────────────────────────────────────────────────────
const HDR = {
  headerStyle:     { backgroundColor: COLORS.navy },
  headerTintColor: COLORS.white,
  headerTitleStyle:{ fontWeight: '700' as const },
  headerBackTitle: 'Back',
};

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

// ── More stack — all secondary screens ────────────────────────────────────────
function MoreNavigator() {
  useLang();
  // The Electron menu / deep-link bridge (window.__navigateTo) lives in
  // App.tsx, where it has access to the root navigation container ref.
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
          <MoreStack.Screen name="BarPrepHome"        component={BarPrepHomeScreen}        options={{ title: '⚖️ Bar Exam Prep', headerShown: false }} />
          <MoreStack.Screen name="BarPrepQuiz"        component={BarPrepQuizScreen}        options={{ headerShown: false }} />
          <MoreStack.Screen name="BarPrepExplanation" component={BarPrepExplanationScreen} options={{ title: '📖 Explanation' }} />
          <MoreStack.Screen name="BarPrepProgress"    component={BarPrepProgressScreen}    options={{ title: '📈 MBE Progress' }} />
          <MoreStack.Screen name="BarPrepSchedule"    component={BarPrepScheduleScreen}    options={{ title: '📅 Study Schedule' }} />
          <MoreStack.Screen name="BarPrepResults"     component={BarPrepResultsScreen}     options={{ title: '📊 Quiz Results', headerShown: false }} />
      <MoreStack.Screen name="AdminVerification"     component={AdminVerificationScreen}     options={{ title: '⚖️ Bar Verification' }} />
      <MoreStack.Screen name="Advocacy"              component={AdvocacyScreen}              options={{ title: '📊 Advocacy Stats' }} />
      {/* RecoveryAgent screen suspended — pending license verification */}
          <MoreStack.Screen name="BondsmanDashboard"     component={BondsmanDashboardScreen}     options={{ title: '🔓 Lead Dashboard' }} />
      <MoreStack.Screen name="Subscription"          component={SubscriptionScreen}          options={{ title: '⚖️ Attorney Plans' }} />
      <MoreStack.Screen name="FamilyConnect"         component={FamilyConnectScreen}         options={{ title: '🚨 Emergency Connection' }} />
      <MoreStack.Screen name="QuickConnect"          component={QuickConnectScreen}          options={{ title: '⚡ Quick Connect' }} />
      <MoreStack.Screen name="ConsumerSubscription"  component={ConsumerSubscriptionScreen}  options={{ title: '📋 Choose Your Plan' }} />
      <MoreStack.Screen name="ArrestMonitor"         component={ArrestMonitorScreen}         options={{ title: '🔔 Arrest Monitor' }} />
      <MoreStack.Screen name="HelpNow"               component={HelpNowScreen}               options={{ title: `🚨 ${t('nav_title_help_now')}`, headerStyle: { backgroundColor: COLORS.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="Booking"               component={BookingScreen}               options={{ title: '📅 Book a Consultation' }} />
      <MoreStack.Screen name="RightsCard"            component={RightsCardScreen}            options={{ title: `📋 ${t('rc_page_title')}` }} />
      <MoreStack.Screen name="CourtDates"            component={CourtDatesScreen}            options={{ title: `📅 ${t('ja_my_court_dates')}` }} />
      <MoreStack.Screen name="CourtDateDetail"       component={CourtDateDetailScreen}       options={{ title: `📅 ${t('nav_title_court_date')}` }} />
      <MoreStack.Screen name="CheckIn"               component={CheckInScreen}               options={{ title: '✓ Daily Check-In', headerStyle: { backgroundColor: COLORS.navy }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CheckInManager"        component={CheckInManagerScreen}        options={{ title: '📋 Check-In Manager' }} />
      <MoreStack.Screen name="Expungement"           component={ExpungementScreen}           options={{ title: '📋 Clear My Record' }} />
      <MoreStack.Screen name="AttorneyInbox"         component={AttorneyInboxScreen}         options={{ headerTitle: "Attorney Inbox" }} />
        <MoreStack.Screen name="WhatHappensNext"       component={JustArrestedScreen}       options={{ title: '⚖️ What Happens Next' }} />
      <MoreStack.Screen name="EmergencyShare"        component={EmergencyShareScreen}        options={{ title: '🚨 Emergency Share', headerStyle: { backgroundColor: COLORS.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CrisisResources"       component={CrisisResourcesScreen}       options={{ title: '💙 Crisis Support', headerStyle: { backgroundColor: COLORS.blue }, headerTintColor: COLORS.white }} />
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
      <MoreStack.Screen name="TenantRights"          component={TenantRightsScreen}          options={{ title: '🏠 Tenant Rights', headerStyle: { backgroundColor: COLORS.legalDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="IceDetention"          component={IceDetentionScreen}          options={{ title: '✈️ ICE Detention Help', headerStyle: { backgroundColor: COLORS.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="JuvenileJustice"       component={JuvenileJusticeScreen}       options={{ title: '🧒 Juvenile Justice' }} />
        <MoreStack.Screen name="HagueContact"
          component={HagueContactScreen}
          options={{ title: '🌐 Hague Convention' }} />
      <MoreStack.Screen name="MentalHealthDiversion" component={DiversionScreen} options={{ title: '🧠 Mental Health & Law' }} />
      <MoreStack.Screen name="FamilyCourt"           component={FamilyCourtScreen}           options={{ title: '👨‍👩‍👧 Family Court' }} />
      <MoreStack.Screen name="ChildSupport"          component={ChildSupportScreen}          options={{ title: '🧮 Support Calculator' }} />
      <MoreStack.Screen name="ImmigrationConsequences" component={ImmigrationConsequencesScreen} options={{ title: '🌎 Immigration Consequences' }} />
      <MoreStack.Screen name="HousingRights"         component={HousingRightsScreen}         options={{ title: '🏘️ Housing Rights' }} />
      <MoreStack.Screen name="AttorneyDashboard"     component={AttorneyDashboardScreen}     options={{ title: '⚖️ Attorney Dashboard' }} />
      <MoreStack.Screen name="DUILaws"               component={LegalPenaltiesScreen}               options={{ title: '🚗 DUI Laws by State' }} />
      <MoreStack.Screen name="DrugPenalties"         component={LegalPenaltiesScreen}         options={{ title: '💊 Drug Charge Penalties' }} />
      <MoreStack.Screen name="SpecialtyCourts"       component={SpecialtyCourtsScreen}       options={{ title: '⚖️ Specialty Courts' }} />
      <MoreStack.Screen name="CourtLocator"          component={CourtLocatorScreen}          options={{ title: '🏛️ Court Locator' }} />
      <MoreStack.Screen name="BailCalculator"        component={BailCalculatorScreen}        options={{ title: `💰 ${t('bail_calculator')}` }} />
      <MoreStack.Screen name="JustArrested"         component={JustArrestedScreen}        options={{ title: `🚨 ${t('nav_title_just_arrested')}`, headerStyle: { backgroundColor: COLORS.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CourtForms"            component={CourtFormsScreen}            options={{ title: '📝 Court Forms' }} />
      <MoreStack.Screen name="InterrogationRecorder" component={InterrogationRecorderScreen} options={{ title: '🎙 Encounter Recorder', headerStyle: { backgroundColor: COLORS.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="DocumentScanner"       component={DocumentScannerScreen}       options={{ title: '📷 Document Scanner' }} />
      <MoreStack.Screen name="LawyerProfile"         component={LawyerProfileScreen}         options={{ title: 'Attorney Profile' }} />
      <MoreStack.Screen name="Search"                component={SearchScreen}                options={{ title: '🔍 Search' }} />
      <MoreStack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: "Terms of Service" }} />
      <MoreStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
      <MoreStack.Screen name="Settings"              component={SettingsScreen}
options={{ title: '⚙️ Settings' }} />
          <MoreStack.Screen name="VideoConsultation" component={VideoConsultationScreen} options={{ title: 'Video Consultation', headerShown: true }} />
      <MoreStack.Screen name="FirmPublicProfile"
          component={FirmPublicProfileScreen}
          options={{ title: "Firm Profile" }}
        />
        <MoreStack.Screen
          name="FirmDiscovery"
          component={FirmDiscoveryScreen}
          options={{ title: "Find a Firm" }}
        />
        <MoreStack.Screen name="ConflictCheck"       component={ConflictCheckScreen}       options={{ title: 'Conflict Check',      headerShown: true }} />
      <MoreStack.Screen name="Matter"              component={MatterScreen}              options={{ title: 'Matter Detail',       headerShown: true }} />
      <MoreStack.Screen name="OfflineStatus"       component={OfflineStatusScreen}       options={{ title: '📵 Offline Mode' }} />
      {/* Sign-in from inside the app (guest browsing → AuthGate "Sign in") */}
      <MoreStack.Screen name="Login"               component={LoginScreen}               options={{ headerShown: false }} />
      <MoreStack.Screen name="Register"            component={RegisterScreen}            options={{ title: 'Create Account' }} />
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
  useLang();
  return (
    <ErrorBoundary>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:    COLORS.tabActive,
        tabBarInactiveTintColor:  COLORS.tabInactive,
        tabBarStyle: {
          backgroundColor: COLORS.tabBg,
          borderTopColor:  COLORS.tabBorder,
          borderTopWidth:  1.5,
          height:          62,
          paddingBottom:   8,
          paddingTop:      4,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        // On web the default tab button is an <a role="link">, which breaks the
        // tablist's required children (axe aria-required-children). A Touchable
        // keeps the accessibilityRole="tab" + selected state the item passes in.
        tabBarButton: (props: any) => <TouchableOpacity {...props} />,
      }}>
      <Tab.Screen name="HomeTab"    component={HomeScreen}      options={{ tabBarButton: (props: any) => <TouchableOpacity testID="home-tab" {...props} />, tabBarLabel: t('tab_home'), tabBarButtonTestID: 'home-tab',     tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> }} />
      <Tab.Screen name="ChatTab"    component={ChatScreen}      options={{ tabBarLabel: t('tab_ai_help'),  tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} /> }} />
      <Tab.Screen name="LawyersTab" component={LawyersScreen}   options={{ tabBarLabel: t('tab_lawyers'),  tabBarIcon: ({ focused }) => <TabIcon emoji="⚖️" focused={focused} /> }} />
      <Tab.Screen name="BailTab"    component={BailSearchScreen}options={{ tabBarLabel: t('tab_bail_help'),tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }} />
      <Tab.Screen name="MoreTab"    component={MoreNavigator}   options={{ tabBarButton: (props: any) => <TouchableOpacity testID="more-tab" {...props} />, tabBarLabel: t('tab_resources'), tabBarButtonTestID: 'more-tab',     tabBarIcon: ({ focused }) => <TabIcon emoji="📚" focused={focused} /> }} />
    </Tab.Navigator>
    </ErrorBoundary>
  );
}

// ── Guest navigator ────────────────────────────────────────────────────────────
function GuestNavigator() {
  useLang();
  return (
    <ErrorBoundary>
    {/* App.tsx already shows the age gate before any navigator mounts, so the
        signed-out flow starts at Onboarding (AgeGate stays registered for links). */}
    <GuestStack.Navigator initialRouteName="Onboarding" screenOptions={{ headerShown: false, animation: 'fade' }}>
      <GuestStack.Screen name="AgeGate"    component={AgeGateScreen}    />
      <GuestStack.Screen name="Onboarding" component={OnboardingScreen} />
      <GuestStack.Screen name="Login"      component={LoginScreen} />
      <GuestStack.Screen name="Register"   component={RegisterScreen} options={{ headerShown: true, title: 'Create Account', ...HDR }} />
      <GuestStack.Screen name="AttorneyPrivacy" component={AttorneyPrivacyScreen} />
          <GuestStack.Screen name="LegalDisclaimer" component={LegalDisclaimerScreen} />
        <GuestStack.Screen name="JustArrested"     component={JustArrestedScreen}      options={{ headerTitle: t('nav_title_your_rights') }} />
        <GuestStack.Screen name="Emergency"        component={EmergencyShareScreen}    options={{ headerShown: false }} />
        <GuestStack.Screen name="TermsOfService"   component={TermsOfServiceScreen}    options={{ headerShown: true, title: 'Terms of Service', ...HDR }} />
        <GuestStack.Screen name="PrivacyPolicy"    component={PrivacyPolicyScreen}     options={{ headerShown: true, title: 'Privacy Policy', ...HDR }} />
      </GuestStack.Navigator>
    </ErrorBoundary>
  );
}

// ── Splash screen ──────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <ErrorBoundary>
    <View style={{ flex: 1, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' }}>
      <JTBLogo size={110} />
      <Text style={{ fontSize: 26, fontWeight: '900', color: COLORS.white, letterSpacing: 1.5, marginBottom: 4, marginTop: 24 }}>
        JUSTICE GAVEL
      </Text>
      <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.steel, letterSpacing: 5, marginBottom: 8 }}>
        {t('home_footer_title').toLocaleUpperCase(locale())}
      </Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.steel, letterSpacing: 0.5, marginBottom: 36, textAlign: 'center', paddingHorizontal: 40 }}>
        {t('splash_innocent')}
      </Text>
      <ActivityIndicator color={COLORS.steel} size="large" />
    </View>
    </ErrorBoundary>
  );
}

export { TabIcon, MoreNavigator, MainTabs, GuestNavigator, SplashScreen };


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
