/**
 * linking.ts — Deep link configuration for Justice Gavel
 *
 * Scheme: justicegavel://
 * Universal links: https://justicegavel.app/
 *
 * Examples:
 *   justicegavel://bail?amount=50000
 *   justicegavel://case/123
 *   justicegavel://lawyer/456
 *   justicegavel://emergency
 *   https://justicegavel.app/subscribe
 */

import { LinkingOptions } from '@react-navigation/native';

export const linking: LinkingOptions<any> = {
  prefixes: [
    'justicegavel://',
    'https://justicegavel.app',
    'https://www.justicegavel.app',
  ],
  config: {
    screens: {
      // ── Auth ───────────────────────────────────────────
      Login:          'login',
      Register:       'register',

      // ── Core free features ─────────────────────────────
      Home:             'home',
      JustArrested:     'just-arrested',
      Emergency:        'emergency',
      CrisisResources:  'crisis',
      KnowYourRights:   'rights',
      RightsCard:       'rights-card',
      IceDetention:     'ice-detention',
      Expungement:      'expungement',
      ChildSupport:     {
        path: 'child-support',
        parse: { state: (state: string) => state.toUpperCase() },
      },

      // ── Attorney matching ───────────────────────────────
      Lawyers:        {
        path: 'lawyers',
        parse: { specialty: String, state: String },
      },
      LawyerProfile:  { path: 'lawyer/:lawyerId', parse: { lawyerId: Number } },
      Match:          'match',
      SavedLawyers:   'saved-lawyers',

      // ── Bail & bonds ────────────────────────────────────
      BailCalculator: {
        path: 'bail',
        parse: { amount: Number, state: String },
      },
      BailSearch:       'bail-search',
      BondsmanDashboard:'bondsman',

      // ── Cases ───────────────────────────────────────────
      Case:           { path: 'case/:caseId', parse: { caseId: Number } },
      CaseTimeline:   { path: 'case/:caseId/timeline', parse: { caseId: Number } },

      // ── Subscriptions ───────────────────────────────────
      Subscription:         'subscribe',
      ConsumerSubscription: 'plans',
      Payments:             'payments',

      // ── Booking ─────────────────────────────────────────
      Booking:        { path: 'book/:lawyerId', parse: { lawyerId: Number } },
      VideoConsultation: 'consultation',

      // ── Chat & messaging ────────────────────────────────
      Chat:           'chat',
      Messages:       'messages',

      // ── Settings ────────────────────────────────────────
      Settings:       'settings',
      Profile:        'profile',
      GoldenGavel:    'rewards',
    },
  },
};
