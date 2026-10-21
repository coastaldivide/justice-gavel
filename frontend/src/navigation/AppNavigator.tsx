
/**
 * AppNavigator.tsx — Navigation structure
 * Contains all stack and tab navigators.
 */
import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList } from '../types/navigation';
import { t, useLang, locale, perLang } from '../i18n';
import { COLORS, useTheme } from '../constants/theme';
import ErrorBoundary from '../components/ErrorBoundary';
import JTBLogo from '../components/JTBLogo';
import { AppIcon, ICONS, type IconName } from '../components/AppIcon';

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
import { getGuestStart } from '../services/auth';
import AgeGateScreen            from '../screens/AgeGateScreen';
import LegalDisclaimerScreen from '../screens/LegalDisclaimerScreen';
// Bundled with the app (not lazy chunks): Home and every screen the app
// promises works offline must open with no network on the web, too.
import HomeScreen from '../screens/HomeScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import ContactsScreen from '../screens/ContactsScreen';
import CrisisResourcesScreen from '../screens/CrisisResourcesScreen';
import DeadlineCalculatorScreen from '../screens/DeadlineCalculatorScreen';
import CaseScreen from '../screens/CaseScreen';
import OfflineStatusScreen from '../screens/OfflineStatusScreen';

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
  useLang();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
                   backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.textBrand} />
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
  Wrapped.displayName = `withSuspense(${(Lazy as any).displayName || 'Screen'})`; // i18n-exempt: React dev-tools name
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
const CaseTimelineScreen = withSuspense(React.lazy(() => import('../screens/CaseTimelineScreen')));
const ChatScreen = withSuspense(React.lazy(() => import('../screens/ChatScreen')));
const CheckInManagerScreen = withSuspense(React.lazy(() => import('../screens/CheckInManagerScreen')));
const VideoConsultationScreen = withSuspense(React.lazy(() => import('../screens/VideoConsultationScreen')));
const ConflictCheckScreen = withSuspense(React.lazy(() => import('../screens/ConflictCheckScreen')));
const MatterScreen = withSuspense(React.lazy(() => import('../screens/MatterScreen')));
const CheckInScreen = withSuspense(React.lazy(() => import('../screens/CheckInScreen')));
const ConsumerSubscriptionScreen = withSuspense(React.lazy(() => import('../screens/ConsumerSubscriptionScreen')));
const CourtFormsScreen = withSuspense(React.lazy(() => import('../screens/CourtFormsScreen')));
const CourtLocatorScreen = withSuspense(React.lazy(() => import('../screens/CourtLocatorScreen')));
const LegalPenaltiesScreen = withSuspense(React.lazy(() => import('../screens/LegalPenaltiesScreen')));
const DiscoveryScreen = withSuspense(React.lazy(() => import('../screens/DiscoveryScreen')));
const DiversionScreen = withSuspense(React.lazy(() => import('../screens/DiversionScreen')));
const DocumentScannerScreen = withSuspense(React.lazy(() => import('../screens/DocumentScannerScreen')));
const ExpungementScreen = withSuspense(React.lazy(() => import('../screens/ExpungementScreen')));
const FamilyConnectScreen = withSuspense(React.lazy(() => import('../screens/FamilyConnectScreen')));
const FamilyCourtScreen = withSuspense(React.lazy(() => import('../screens/FamilyCourtScreen')));
const GoldenGavelScreen = withSuspense(React.lazy(() => import('../screens/GoldenGavelScreen')));

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





// Deep link configuration lives in ./linking.ts (single source of truth).

// ── Stack / Tab instances ─────────────────────────────────────────────────────
const MoreStack  = createNativeStackNavigator<RootStackParamList>();
const GuestStack = createNativeStackNavigator<RootStackParamList>();
const Tab        = createBottomTabNavigator<RootStackParamList>();

// ── Shared header style ────────────────────────────────────────────────────────
const HDR = perLang(() => ({
  headerStyle:     { backgroundColor: COLORS.navy },
  headerTintColor: COLORS.white,
  headerTitleStyle:{ fontWeight: '700' as const },
  headerBackTitle: t('back'),
}));

/** Tab bar icon: the tab's Ionicon in the tab colour (the label below names it). */
function TabIcon({ name, color, focused }: { name: IconName; color: string; focused: boolean }) {
  return <AppIcon name={name} size={focused ? 23 : 22} color={color} />;
}

// ── More stack — all secondary screens ────────────────────────────────────────
function MoreNavigator() {
  useLang();
  const { colors } = useTheme();
  // The Electron menu / deep-link bridge (window.__navigateTo) lives in
  // App.tsx, where it has access to the root navigation container ref.
  return (
    <ErrorBoundary>
    <MoreStack.Navigator screenOptions={HDR()}>
      <MoreStack.Screen name="MoreHome"              component={HomeScreen}                 options={{ headerShown: false }} />
      <MoreStack.Screen name="Emergency"             component={EmergencyScreen}             options={{ title: t('x_nav_emergency_alert') }} />
      <MoreStack.Screen name="CaseTimeline"          component={CaseTimelineScreen}          options={{ title: t('x_nav_case_timeline') }} />
      <MoreStack.Screen name="MatterIntelligence"     component={MatterIntelligenceScreen}  options={{ title: t('x_nav_matter_intelligence') }} />
      <MoreStack.Screen name="FirmAcquisition"       component={FirmAcquisitionScreen}    options={{ title: t('x_nav_start_firm_trial') }} />
      <MoreStack.Screen name="FirmVertical"         component={FirmVerticalScreen}        options={{ title: t('x_nav_firm_vertical_setup') }} />
      <MoreStack.Screen name="Cases"                 component={CaseScreen}                  options={{ title: t('x_nav_my_cases') }} />
      <MoreStack.Screen name="Contacts"              component={ContactsScreen}              options={{ title: t('x_nav_emergency_contacts') }} />
      <MoreStack.Screen name="Bail"                  component={BailSearchScreen}            options={{ title: t('x_nav_bail_agents') }} />
      <MoreStack.Screen name="Resources"             component={ResourcesScreen}             options={{ title: t('x_nav_legal_resources') }} />
      <MoreStack.Screen name="Payments"              component={PaymentsScreen}              options={{ title: t('x_nav_payments') }} />
      <MoreStack.Screen name="Education"             component={LessonsScreen}               options={{ title: t('x_nav_know_rights') }} />
      <MoreStack.Screen name="Match"                 component={MatchScreen}                 options={{ title: t('x_nav_ai_lawyer_match') }} />
      <MoreStack.Screen name="Insurance"             component={InsuranceScreen}             options={{ title: t('x_nav_legal_insurance') }} />
      <MoreStack.Screen name="GoldenGavel"           component={GoldenGavelScreen}           options={{ title: t('x_nav_golden_gavel') }} />
          <MoreStack.Screen name="BarPrepHome"        component={BarPrepHomeScreen}        options={{ title: t('x_nav_bar_exam_prep'), headerShown: false }} />
          <MoreStack.Screen name="BarPrepQuiz"        component={BarPrepQuizScreen}        options={{ headerShown: false }} />
          <MoreStack.Screen name="BarPrepExplanation" component={BarPrepExplanationScreen} options={{ title: t('x_nav_explanation'), headerShown: false }} />
          <MoreStack.Screen name="BarPrepProgress"    component={BarPrepProgressScreen}    options={{ title: t('x_nav_mbe_progress'), headerShown: false }} />
          <MoreStack.Screen name="BarPrepSchedule"    component={BarPrepScheduleScreen}    options={{ title: t('x_nav_study_schedule'), headerShown: false }} />
          <MoreStack.Screen name="BarPrepResults"     component={BarPrepResultsScreen}     options={{ title: t('x_nav_quiz_results'), headerShown: false }} />
      <MoreStack.Screen name="AdminVerification"     component={AdminVerificationScreen}     options={{ title: t('adm_title') }} />
      <MoreStack.Screen name="Advocacy"              component={AdvocacyScreen}              options={{ title: t('x_nav_advocacy_stats') }} />
      {/* RecoveryAgent screen suspended — pending license verification */}
          <MoreStack.Screen name="BondsmanDashboard"     component={BondsmanDashboardScreen}     options={{ title: t('x_nav_lead_dashboard') }} />
      <MoreStack.Screen name="Subscription"          component={SubscriptionScreen}          options={{ title: t('x_nav_attorney_plans') }} />
      <MoreStack.Screen name="FamilyConnect"         component={FamilyConnectScreen}         options={{ title: t('x_nav_emergency_connection') }} />
      <MoreStack.Screen name="QuickConnect"          component={QuickConnectScreen}          options={{ title: t('x_nav_quick_connect') }} />
      <MoreStack.Screen name="ConsumerSubscription"  component={ConsumerSubscriptionScreen}  options={{ title: t('x_nav_choose_plan') }} />
      <MoreStack.Screen name="ArrestMonitor"         component={ArrestMonitorScreen}         options={{ title: t('x_nav_arrest_monitor') }} />
      <MoreStack.Screen name="HelpNow"               component={HelpNowScreen}               options={{ title: t('nav_title_help_now') }} />
      <MoreStack.Screen name="Booking"               component={BookingScreen}               options={{ title: t('x_nav_book_consultation') }} />
      <MoreStack.Screen name="RightsCard"            component={RightsCardScreen}            options={{ title: t('rc_page_title') }} />
      <MoreStack.Screen name="CourtDates"            component={CourtDatesScreen}            options={{ title: t('ja_my_court_dates') }} />
      <MoreStack.Screen name="CourtDateDetail"       component={CourtDateDetailScreen}       options={{ title: t('nav_title_court_date') }} />
      <MoreStack.Screen name="CheckIn"               component={CheckInScreen}               options={{ title: t('x_nav_daily_check'), headerStyle: { backgroundColor: COLORS.navy }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CheckInManager"        component={CheckInManagerScreen}        options={{ title: t('x_nav_check_manager') }} />
      <MoreStack.Screen name="Expungement"           component={ExpungementScreen}           options={{ title: t('x_nav_clear_my_record') }} />
      <MoreStack.Screen name="AttorneyInbox"         component={AttorneyInboxScreen}         options={{ headerTitle: t('x_nav_attorney_inbox') }} />
        <MoreStack.Screen name="WhatHappensNext"       component={JustArrestedScreen}       options={{ title: t('x_nav_what_happens_next') }} />
      <MoreStack.Screen name="EmergencyShare"        component={EmergencyShareScreen}        options={{ title: t('x_nav_emergency_share'), headerStyle: { backgroundColor: colors.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CrisisResources"       component={CrisisResourcesScreen}       options={{ title: t('x_nav_crisis_support'), headerStyle: { backgroundColor: COLORS.blue }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="Diversion"             component={DiversionScreen}             options={{ title: t('x_nav_diversion_eligibility') }} />
      <MoreStack.Screen name="Translator"            component={TranslatorScreen}            options={{ title: t('x_nav_interpreter') }} />
      <MoreStack.Screen name="Discovery"             component={DiscoveryScreen}             options={{ title: t('x_nav_discovery_ai') }} />
      <MoreStack.Screen name="LegalResearch"         component={LegalResearchScreen}         options={{ title: t('x_nav_legal_research') }} />
      <MoreStack.Screen name="MotionLibrary"         component={MotionLibraryScreen}         options={{ title: t('x_nav_motion_library') }} />
      <MoreStack.Screen name="VoiceNote"             component={VoiceNoteScreen}             options={{ title: t('x_nav_voice_note') }} />
      <MoreStack.Screen name="Messages"              component={MessagesScreen}              options={{ title: t('x_nav_messages') }} />
      <MoreStack.Screen name="SavedLawyers"          component={SavedLawyersScreen}          options={{ title: t('x_nav_saved_lawyers') }} />
      <MoreStack.Screen name="DeadlineCalculator"    component={DeadlineCalculatorScreen}    options={{ title: t('x_nav_deadline_calculator') }} />
      <MoreStack.Screen name="PILead"                component={PILeadScreen}                options={{ title: t('x_nav_submit_case') }} />
      <MoreStack.Screen name="TenantRights"          component={TenantRightsScreen}          options={{ title: t('x_nav_tenant_rights'), headerStyle: { backgroundColor: colors.legalDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="IceDetention"          component={IceDetentionScreen}          options={{ title: t('x_nav_ice_detention_help'), headerStyle: { backgroundColor: colors.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="JuvenileJustice"       component={JuvenileJusticeScreen}       options={{ title: t('x_nav_juvenile_justice') }} />
        <MoreStack.Screen name="HagueContact"
          component={HagueContactScreen}
          options={{ title: t('x_nav_hague_convention') }} />
      <MoreStack.Screen name="MentalHealthDiversion" component={DiversionScreen} options={{ title: t('x_nav_mental_health_law') }} />
      <MoreStack.Screen name="FamilyCourt"           component={FamilyCourtScreen}           options={{ title: t('x_nav_family_court') }} />
      <MoreStack.Screen name="ChildSupport"          component={ChildSupportScreen}          options={{ title: t('x_nav_support_calculator') }} />
      <MoreStack.Screen name="ImmigrationConsequences" component={ImmigrationConsequencesScreen} options={{ title: t('x_nav_immigration_consequences') }} />
      <MoreStack.Screen name="HousingRights"         component={HousingRightsScreen}         options={{ title: t('x_nav_housing_rights') }} />
      <MoreStack.Screen name="AttorneyDashboard"     component={AttorneyDashboardScreen}     options={{ title: t('x_nav_attorney_dashboard') }} />
      <MoreStack.Screen name="DUILaws"               component={LegalPenaltiesScreen}               options={{ title: t('x_nav_dui_laws_by_state') }} />
      <MoreStack.Screen name="DrugPenalties"         component={LegalPenaltiesScreen}         options={{ title: t('x_nav_drug_charge_penalties') }} />
      <MoreStack.Screen name="SpecialtyCourts"       component={SpecialtyCourtsScreen}       options={{ title: t('x_nav_specialty_courts') }} />
      <MoreStack.Screen name="CourtLocator"          component={CourtLocatorScreen}          options={{ title: t('x_nav_court_locator') }} />
      <MoreStack.Screen name="BailCalculator"        component={BailCalculatorScreen}        options={{ title: t('bail_calculator') }} />
      <MoreStack.Screen name="JustArrested"         component={JustArrestedScreen}        options={{ title: t('nav_title_just_arrested'), headerStyle: { backgroundColor: colors.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="CourtForms"            component={CourtFormsScreen}            options={{ title: t('x_nav_court_forms') }} />
      <MoreStack.Screen name="InterrogationRecorder" component={InterrogationRecorderScreen} options={{ title: t('x_nav_encounter_recorder'), headerStyle: { backgroundColor: colors.emergencyDark }, headerTintColor: COLORS.white }} />
      <MoreStack.Screen name="DocumentScanner"       component={DocumentScannerScreen}       options={{ title: t('x_nav_document_scanner') }} />
      <MoreStack.Screen name="LawyerProfile"         component={LawyerProfileScreen}         options={{ title: t('x_nav_attorney_profile') }} />
      <MoreStack.Screen name="Search"                component={SearchScreen}                options={{ title: t('x_nav_search') }} />
      <MoreStack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: t('onb_terms_tos') }} />
      <MoreStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: t('onb_terms_pp') }} />
      <MoreStack.Screen name="Settings"              component={SettingsScreen}
options={{ title: t('x_nav_settings') }} />
          <MoreStack.Screen name="VideoConsultation" component={VideoConsultationScreen} options={{ title: t('x_nav_video_consultation'), headerShown: true }} />
      <MoreStack.Screen name="FirmPublicProfile"
          component={FirmPublicProfileScreen}
          options={{ title: t('x_nav_firm_profile') }}
        />
        <MoreStack.Screen
          name="FirmDiscovery"
          component={FirmDiscoveryScreen}
          options={{ title: t('x_nav_find_firm') }}
        />
        <MoreStack.Screen name="ConflictCheck"       component={ConflictCheckScreen}       options={{ title: t('x_nav_conflict_check'),      headerShown: true }} />
      <MoreStack.Screen name="Matter"              component={MatterScreen}              options={{ title: t('x_nav_matter_detail'),       headerShown: true }} />
      <MoreStack.Screen name="OfflineStatus"       component={OfflineStatusScreen}       options={{ title: t('x_nav_offline_mode') }} />
      {/* Sign-in from inside the app (guest browsing → AuthGate "Sign in") */}
      <MoreStack.Screen name="Login"               component={LoginScreen}               options={{ headerShown: false }} />
      <MoreStack.Screen name="Register"            component={RegisterScreen}            options={{ title: t('create_account') }} />
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
  const { colors } = useTheme();
  return (
    <ErrorBoundary>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:    colors.tabActive,
        tabBarInactiveTintColor:  colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBg,
          borderTopColor:  colors.tabBorder,
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
      <Tab.Screen name="HomeTab"    component={HomeScreen}      options={{ tabBarButton: (props: any) => <TouchableOpacity testID="home-tab" {...props} />, tabBarLabel: t('tab_home'), tabBarButtonTestID: 'home-tab',     tabBarIcon: ({ focused, color }) => <TabIcon name={ICONS.home} color={color} focused={focused} /> }} />
      <Tab.Screen name="ChatTab"    component={ChatScreen}      options={{ tabBarLabel: t('tab_ai_help'),  tabBarIcon: ({ focused, color }) => <TabIcon name={ICONS.message} color={color} focused={focused} /> }} />
      <Tab.Screen name="LawyersTab" component={LawyersScreen}   options={{ tabBarLabel: t('tab_lawyers'),  tabBarIcon: ({ focused, color }) => <TabIcon name={ICONS.lawyer} color={color} focused={focused} /> }} />
      <Tab.Screen name="BailTab"    component={BailSearchScreen}options={{ tabBarLabel: t('tab_bail_help'),tabBarIcon: ({ focused, color }) => <TabIcon name={ICONS.bail} color={color} focused={focused} /> }} />
      <Tab.Screen name="MoreTab"    component={MoreNavigator}   options={{ tabBarButton: (props: any) => <TouchableOpacity testID="more-tab" {...props} />, tabBarLabel: t('tab_resources'), tabBarButtonTestID: 'more-tab',     tabBarIcon: ({ focused, color }) => <TabIcon name={ICONS.library} color={color} focused={focused} /> }} />
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
        signed-out flow starts at Onboarding the first time and at Login once the
        intro was seen (services/auth getGuestStart; AgeGate stays registered for links). */}
    <GuestStack.Navigator initialRouteName={getGuestStart()} screenOptions={{ headerShown: false, animation: 'fade' }}>
      <GuestStack.Screen name="AgeGate"    component={AgeGateScreen}    />
      <GuestStack.Screen name="Onboarding" component={OnboardingScreen} />
      <GuestStack.Screen name="Login"      component={LoginScreen} />
      <GuestStack.Screen name="Register"   component={RegisterScreen} options={{ headerShown: true, title: t('create_account'), ...HDR() }} />
      <GuestStack.Screen name="AttorneyPrivacy" component={AttorneyPrivacyScreen} />
          <GuestStack.Screen name="LegalDisclaimer" component={LegalDisclaimerScreen} />
        <GuestStack.Screen name="JustArrested"     component={JustArrestedScreen}      options={{ headerTitle: t('nav_title_your_rights') }} />
        <GuestStack.Screen name="Emergency"        component={EmergencyShareScreen}    options={{ headerShown: false }} />
        <GuestStack.Screen name="TermsOfService"   component={TermsOfServiceScreen}    options={{ headerShown: true, title: t('onb_terms_tos'), ...HDR() }} />
        <GuestStack.Screen name="PrivacyPolicy"    component={PrivacyPolicyScreen}     options={{ headerShown: true, title: t('onb_terms_pp'), ...HDR() }} />
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
