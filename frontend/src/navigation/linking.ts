/**
 * linking.ts — THE deep link / universal link configuration.
 *
 * Built from the real navigator tree in App.tsx + AppNavigator.tsx:
 *
 *   RootStack
 *   ├─ MainTabs  (signed in or browsing)
 *   │   ├─ HomeTab · ChatTab · LawyersTab · BailTab
 *   │   └─ MoreTab (MoreStack: every secondary screen)
 *   ├─ GuestNav  (signed out: AgeGate · Onboarding · Login · Register · …)
 *   ├─ ResetPassword (reset-password?token=… from the e-mail; any auth state)
 *   ├─ SignPacket (sign/<token> — a bail agent's paperwork link; any auth state)
 *   └─ MissedCourt (missed-court[/es|pt|vi] — the morning-after text's link; any auth state)
 *
 * Only one of MainTabs / GuestNav is mounted at a time: `linking` serves the
 * main app (browsing / signed in), `guestLinking` the signed-out flow (App.tsx
 * picks one with linkingFor). Login/Register exist in both, so /login and
 * /register work in either state.
 *
 * Domains must match app.json: ios.associatedDomains (applinks:justicegavel.app)
 * and android.intentFilters (https://justicegavel.app).
 *
 * Examples:
 *   justicegavel://lawyers                 → LawyersTab
 *   justicegavel://attorney/42             → MoreTab › LawyerProfile { lawyerId: '42' }
 *   https://justicegavel.app/expungement   → MoreTab › Expungement
 *   https://justicegavel.app/messages/7    → MoreTab › Messages { caseId: '7' }
 */
import type { LinkingOptions } from '@react-navigation/native';

export const DEEP_LINK_PREFIXES = [
  'justicegavel://',
  'https://justicegavel.app',
  'https://www.justicegavel.app',
];

export const linking: LinkingOptions<any> = {
  prefixes: DEEP_LINK_PREFIXES,
  config: {
    screens: {
      MainTabs: {
        screens: {
          HomeTab:    '',
          ChatTab:    'chat',
          LawyersTab: 'lawyers',
          BailTab:    'bail',
          // Core path tabs (Oct 26 2026). Each tab is a stack opening on its own screen.
          RightsTab:  'my-rights',
          HelpTab:    'get-help',
          CourtTab:   'my-court-dates',
          MoreTab: {
            screens: {
              MoreHome:           'home',

              // Urgent help
              HelpNow:            'help',
              Emergency:          'emergency',
              EmergencyShare:     'emergency-share',
              JustArrested:       'just-arrested',
              WhatHappensNext:    'what-happens-next',
              CrisisResources:    'crisis',

              // Cases & documents
              Cases:              'cases',
              CaseTimeline:       'case/:caseId/timeline',
              Messages:           'messages/:caseId?',
              Discovery:          'discovery',
              DocumentScanner:    'scan',
              VoiceNote:          'voice-note',
              MotionLibrary:      'motions',
              CourtForms:         'court-forms',

              // Legal tools
              DeadlineCalculator: 'deadlines',
              Expungement:        'expungement',
              RightsCard:         'rights',
              CourtDates:         'court-dates',
              CourtDateDetail:    'court-dates/:id',
              DUILaws:            'dui-laws',
              DrugPenalties:      'drug-penalties',
              BailCalculator:     'bail-calculator',
              Bail:               'bail-agents',
              CourtLocator:       'courts',
              SpecialtyCourts:    'specialty-courts',
              LegalResearch:      'research',
              Diversion:          'diversion',
              MentalHealthDiversion: 'mental-health-diversion',

              // Specialized legal guides
              ChildSupport:       'child-support',
              FamilyCourt:        'family-court',
              HagueContact:       'hague',
              HousingRights:      'housing-rights',
              TenantRights:       'tenant-rights',
              IceDetention:       'ice-detention',
              ImmigrationConsequences: 'immigration-consequences',
              JuvenileJustice:    'juvenile-justice',
              Insurance:          'legal-insurance',
              Translator:         'interpreter',
              InterrogationRecorder: 'encounter-recorder',
              Education:          'learn',
              Resources:          'resources',
              BarPrepHome:        'bar-prep',
              BarPrepProgress:    'bar-prep/progress',
              BarPrepSchedule:    'bar-prep/schedule',
              Advocacy:           'advocacy',
              Search:             'search',

              // Providers
              LawyerProfile:      'attorney/:lawyerId',
              SavedLawyers:       'saved/attorneys',
              Booking:            'booking/:lawyerId',
              Match:              'match',
              QuickConnect:       'quick-connect',
              FirmDiscovery:      'firms',
              FirmPublicProfile:  'firms/:firmId',
              PILead:             'case-review',
              VideoConsultation:  'video-consult',

              // Monitoring
              ArrestMonitor:      'arrest-monitor',
              CheckIn:            'checkin',
              CheckInManager:     'checkin/manage',
              BondDesk:           'bond-desk',
              BondDetail:         'bond-desk/bond/:bondId',
              BondForms:          'bond-desk/forms',
              BondPowers:         'bond-desk/powers',
              BondReports:        'bond-desk/reports',
              FamilyConnect:      'family',
              Contacts:           'emergency-contacts',

              // Account & plans
              Settings:           'settings',
              GoldenGavel:        'golden-gavel',
              Subscription:       'subscribe',
              ConsumerSubscription: 'plans',
              Payments:           'payments',
              OfflineStatus:      'offline',
              TermsOfService:     'terms',
              PrivacyPolicy:      'privacy',
              Login:              'login',
              Register:           'register',

              // Professionals
              AttorneyDashboard:  'attorney-dashboard',
              AttorneyInbox:      'attorney-inbox',
              BondsmanDashboard:  'bondsman-dashboard',
              ConflictCheck:      'conflict-check',
              FirmAcquisition:    'firm-trial',
              AdminVerification:  'admin-review',
              MatterIntelligence: 'matter-intelligence/:matterId?',
              Matter:             'matters/:matterId',
            },
          },
        },
      },
      // Root level: the password-reset e-mail link and a bail agent's signing link (any auth state)
      ResetPassword: 'reset-password',
      SignPacket:    'sign/:token',
      MissedCourt:   'missed-court/:lang?',
    },
  },
};

/**
 * Signed out only GuestNav is mounted, so its screens own the shared paths
 * (/login, /register, /terms, /privacy …): the same path cannot point at two
 * screens in one config, which is why App.tsx picks the config for the state
 * it starts in (linkingFor).
 */
export const guestLinking: LinkingOptions<any> = {
  prefixes: DEEP_LINK_PREFIXES,
  config: {
    screens: {
      ResetPassword: 'reset-password',
      SignPacket:    'sign/:token',
      MissedCourt:   'missed-court/:lang?',
      GuestNav: {
        screens: {
          Onboarding:      'welcome',
          AgeGate:         'age-check',
          Login:           'login',
          Register:        'register',
          TermsOfService:  'terms',
          PrivacyPolicy:   'privacy',
          JustArrested:    'just-arrested',
          Emergency:       'emergency',
          AttorneyPrivacy: 'attorney-privacy',
          LegalDisclaimer: 'legal-disclaimer',
        },
      },
    },
  },
};

/** The deep-link config for the navigator that is mounted (signed out vs browsing / signed in). */
export function linkingFor(signedOut: boolean): LinkingOptions<any> {
  return signedOut ? guestLinking : linking;
}

export default linking;
