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
  ResetPassword:            { token?: string };
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
  ImmigrationConsequences:  undefined;
  HagueContact:             { caseId?: number; caseName?: string } | undefined;
  KnowYourRights:           undefined;

  // ── Legal Info Screens ───────────────────────────────────────────────────
  Expungement:              { state?: string; charge?: string; case_id?: number } | undefined;
  ChildSupport:             { state?: string } | undefined;
  LegalPenalties:           { tab?: 'drug' | 'dui' | 'other' };
  Diversion:                { tab?: 'drug' | 'mental' | 'veteran' } | undefined;
  MentalHealthDiversion:    { tab?: 'drug' | 'mental' | 'veteran' } | undefined;
  JuvenileJustice:          { tab?: 'rights' | 'process' | 'sealing' } | undefined;
  SpecialtyCourts:          { state?: string; type?: string } | undefined;
  FamilyCourt:              { tab?: 'custody' | 'orders' | 'support' } | undefined;
  TenantRights:             undefined;
  HousingRights:            undefined;
  Advocacy:                 undefined;

  // ── Attorney Matching ─────────────────────────────────────────────────────
  Lawyers:                  { specialty?: string; state?: string; urgency?: string };
  LawyerProfile:            { lawyerId: number; name?: string };
  Match:                    { caseType?: string; state?: string };
  SavedLawyers:             undefined;
  QuickConnect:             { lawyerId?: number };

  // ── Bail & Bonds ─────────────────────────────────────────────────────────
  BailCalculator:           { amount?: number; state?: string; chargeType?: string; caseTitle?: string };
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
  CourtDates:               { add?: boolean; guidance?: 'missed'; caseId?: number };
  CourtDateDetail:          { id: number };
  CourtForms:               { state?: string; chargeType?: string };

  // ── Subscriptions & Payments ─────────────────────────────────────────────
  Subscription:             { highlight?: string };
  ConsumerSubscription:     { tier?: string };
  Payments:                 { purpose?: string; amount?: number };
  Insurance:                undefined;
  PILead:                   { severity?: string };

  // ── Booking & Consultation ─────────────────────────────────────────────
  Booking:                  { lawyerId: number; specialtyHint?: string };
  VideoConsultation:        { matterId?: number; attorneyId?: number; topic?: string; room?: string };

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
  BondDesk:                 undefined;
  BondDetail:               { bondId: number | string; tab?: 'overview' | 'court' | 'people' | 'paperwork' | 'money' | 'collateral' | 'alerts' | 'recovery' };
  BondForms:                { setupRequestId?: number; agency?: string } | undefined;
  BondPowers:               undefined;
  BondReports:              undefined;
  BondDeskSettings:         { connect?: 'return' | 'refresh' } | undefined;
  BondImport:               undefined;
  AdminFormsSetup:          undefined;
  PdOffice:                 undefined;
  PdClients:                undefined;
  PdImport:                 undefined;
  PdClient:                 { clientId: number | string };
  PdInbox:                  undefined;
  PdStaff:                  undefined;
  PdJoin:                   { token: string };
  AdminPdOffices:           undefined;
  AdminResults:             undefined;
  VerifyPhone:              undefined;
  Results:                  undefined;
  SignPacket:               { token: string };
  AutopayLink:              { token: string; saved?: string; paid?: string };
  AgencyPay:                { slug: string; paid?: string };
  StaffJoin:                { token: string };
  MissedCourt:              { lang?: string } | undefined;
  CheckInLink:              { token: string };
  CustodyAlerts:            undefined;
  RecoveryShares:           { shareId?: number | string } | undefined;
  RecoveryInvite:           { token: string };
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

  // ── Bar Exam Prep ─────────────────────────────────────────────────────────
  BarPrepHome:        undefined;
  BarPrepQuiz:        {
    session_id:         number;
    questions:          Array<{
      id: number; category: string; difficulty: string; stem: string;
      option_a: string; option_b: string; option_c: string; option_d: string;
    }>;
    mode:               'practice' | 'timed';
    time_limit_seconds: number | null;
  };
  BarPrepExplanation: { question_id: number };
  BarPrepProgress:    undefined;
  BarPrepSchedule:    undefined;
  BarPrepResults:     {
    session_id:  number;
    score_pct:   number;
    correct:     number;
    total:       number;
    mode:        'practice' | 'timed';
    subject_id?: string;
    answers:     Record<number, { answer: string; is_correct: boolean; time_spent_ms?: number }>;
    questions:   Array<Record<string, unknown>>;
    timed_out?:  boolean;
  };
};

/** Helper: extract route params type for a specific screen */
export type ScreenParams<T extends keyof RootStackParamList> = RootStackParamList[T];

/** useTypedNavigation — typed navigation hook */
export type NavigationProp<T extends keyof RootStackParamList> =
  import('@react-navigation/native-stack').NativeStackNavigationProp<RootStackParamList, T>;
