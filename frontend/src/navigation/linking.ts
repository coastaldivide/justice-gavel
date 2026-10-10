/**
 * linking.ts — THE deep link / universal link configuration.
 *
 * Built from the real navigator tree in App.tsx + AppNavigator.tsx:
 *
 *   RootStack
 *   ├─ MainTabs  (signed in or browsing)
 *   │   ├─ HomeTab · ChatTab · LawyersTab · BailTab
 *   │   └─ MoreTab (MoreStack: every secondary screen)
 *   └─ GuestNav  (signed out: AgeGate · Onboarding · Login · Register · …)
 *
 * Only one of MainTabs / GuestNav is mounted at a time, so links into the main
 * app take effect once the user is browsing or signed in (App.tsx shows the
 * age gate / onboarding first). Login/Register are also registered in
 * MoreStack so "Sign in" links work while browsing.
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
              DUILaws:            'dui-laws',
              DrugPenalties:      'drug-penalties',
              BailCalculator:     'bail-calculator',
              Bail:               'bail-agents',
              CourtLocator:       'courts',
              SpecialtyCourts:    'specialty-courts',
              LegalResearch:      'research',
              Diversion:          'diversion',
              Translator:         'interpreter',
              InterrogationRecorder: 'encounter-recorder',
              Education:          'learn',
              Resources:          'resources',
              Search:             'search',

              // Providers
              LawyerProfile:      'attorney/:lawyerId',
              SavedLawyers:       'saved/attorneys',
              Booking:            'booking/:lawyerId',
              Match:              'match',
              QuickConnect:       'quick-connect',
              FirmDiscovery:      'firms',
              FirmPublicProfile:  'firms/:firmId',

              // Monitoring
              ArrestMonitor:      'arrest-monitor',
              CheckIn:            'checkin',
              CheckInManager:     'checkin/manage',
              FamilyConnect:      'family',

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
            },
          },
        },
      },
      GuestNav: {
        screens: {
          Onboarding:      'welcome',
          AgeGate:         'age-check',
          AttorneyPrivacy: 'attorney-privacy',
          LegalDisclaimer: 'legal-disclaimer',
        },
      },
    },
  },
};

export default linking;
