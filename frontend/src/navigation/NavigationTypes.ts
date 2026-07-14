/**
 * NavigationTypes.ts — Type-safe navigation for all 81 screens
 *
 * Usage in any screen:
 *   import { NativeStackScreenProps } from '@react-navigation/native-stack';
 *   import { RootStackParamList } from '../navigation/NavigationTypes';
 *
 *   type Props = NativeStackScreenProps<RootStackParamList, 'BailCalculator'>;
 *   function BailCalculatorScreen({ navigation, route }: Props) { ... }
 *
 * Or with useNavigation hook:
 *   import { useNavigation } from '@react-navigation/native';
 *   import { NativeStackNavigationProp } from '@react-navigation/native-stack';
 *   const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
 */

export type RootStackParamList = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  Login:                    undefined;
  Register:                 undefined;
  Onboarding:               undefined;
  AgeGate:                  undefined;
  TermsOfService:           undefined;
  TermsAcceptance:          undefined;
  PrivacyPolicy:            undefined;
  LegalDisclaimer:          undefined;
  AttorneyPrivacy:          undefined;
  AdminVerification:        undefined;

  // ── Home & Navigation ────────────────────────────────────────────────────
  Home:                     undefined;
  Search:                   { query?: string };
  Settings:                 undefined;
  Contacts:                 undefined;

  // ── Crisis & Emergency ───────────────────────────────────────────────────
  Emergency:                undefined;
  EmergencyShare:           undefined;
  HelpNow:                  { urgency?: 'high' | 'medium' | 'low' };
  JustArrested:             { state?: string };
  CrisisResources:          { category?: string };

  // ── Know Your Rights ────────────────────────────────────────────────────
  RightsCard:               { state?: string };
  IceDetention:             undefined;
  ImmigrationConsequences:  { chargeType?: string };
  HagueContact:             undefined;
  KnowYourRights:           undefined;

  // ── Legal Info Screens ───────────────────────────────────────────────────
  Expungement:              { state?: string; charge?: string };
  ChildSupport:             { state?: string };
  LegalPenalties:           { tab?: 'drug' | 'dui' | 'other' };
  Diversion:                { tab?: 'drug' | 'mental' | 'veteran' };
  JuvenileJustice:          { state?: string };
  SpecialtyCourts:          { state?: string; type?: string };
  FamilyCourt:              undefined;
  TenantRights:             { state?: string };
  HousingRights:            { state?: string };
  Advocacy:                 undefined;

  // ── Attorney Matching ─────────────────────────────────────────────────────
  Lawyers:                  { specialty?: string; state?: string; urgency?: string };
  LawyerProfile:            { lawyerId: number; name?: string };
  Match:                    { caseType?: string; state?: string };
  SavedLawyers:             undefined;
  QuickConnect:             { lawyerId?: number };

  // ── Bail & Bonds ─────────────────────────────────────────────────────────
  BailCalculator:           { amount?: number; state?: string; chargeType?: string };
  BailSearch:               { county?: string; state?: string };
  BondsmanDashboard:        undefined;
  RecoveryAgents:           { state?: string };

  // ── Cases ────────────────────────────────────────────────────────────────
  Case:                     { caseId: number; title?: string };
  CaseTimeline:             { caseId: number };

  // ── Attorney Pro ─────────────────────────────────────────────────────────
  AttorneyDashboard:        undefined;
  FirmVertical:             { verticalType?: string };
  FirmAcquisition:          undefined;
  FirmDiscovery:            undefined;
  FirmPublicProfile:        { firmId: number };
  MatterIntelligence:       { matterId: number };
  Matter:                   { matterId?: number };
  LegalResearch:            { query?: string };
  MotionLibrary:            { caseId?: number };
  DeadlineCalculator:       { caseId?: number; courtDate?: string };
  ConflictCheck:            undefined;
  Docket:                   { matterId?: number };
  CourtLocator:             { state?: string; county?: string };
  CourtForms:               { state?: string; chargeType?: string };

  // ── Subscriptions & Payments ─────────────────────────────────────────────
  Subscription:             { highlight?: string };
  ConsumerSubscription:     { tier?: string };
  Payments:                 { purpose?: string; amount?: number };
  Insurance:                undefined;
  PILead:                   { severity?: string };

  // ── Booking & Consultation ─────────────────────────────────────────────
  Booking:                  { lawyerId: number; specialtyHint?: string };
  VideoConsultation:        { sessionId?: string; lawyerId?: number };

  // ── Chat & Messaging ─────────────────────────────────────────────────────
  Chat:                     { context?: string; caseId?: number };
  Messages:                 undefined;
  VoiceNote:                { caseId?: number };

  // ── Discovery & Documents ────────────────────────────────────────────────
  Discovery:                { caseId?: number };
  DocumentScanner:          { caseId?: number; fieldHint?: string };

  // ── Check-In & Monitoring ────────────────────────────────────────────────
  CheckIn:                  { enrollmentId?: number };
  CheckInManager:           undefined;
  ArrestMonitor:            undefined;

  // ── Education & Gamification ─────────────────────────────────────────────
  Lessons:                  { category?: string };
  Resources:                { category?: string };
  GoldenGavel:              undefined;

  // ── Translator ───────────────────────────────────────────────────────────
  Translator:               { document?: string; targetLang?: string };

  // ── Interrogation ────────────────────────────────────────────────────────
  InterrogationRecorder:    undefined;

  // ── Family ───────────────────────────────────────────────────────────────
  FamilyConnect:            undefined;
  EmergencyContacts:        undefined;
};

/** Helper: extract route params type for a specific screen */
export type ScreenParams<T extends keyof RootStackParamList> = RootStackParamList[T];

/** useTypedNavigation — typed navigation hook */
export type NavigationProp<T extends keyof RootStackParamList> =
  import('@react-navigation/native-stack').NativeStackNavigationProp<RootStackParamList, T>;
