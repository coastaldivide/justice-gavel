/**
 * LinkingConfig.ts — Deep link + Universal link URL routing
 *
 * Supports:
 *   justicegavel://emergency           → Emergency screen
 *   justicegavel://bail                → BailCalculator
 *   justicegavel://bail/estimate       → BailCalculatorScreen (with estimate tab)
 *   justicegavel://lawyers             → LawyersScreen
 *   justicegavel://expungement         → ExpungementScreen
 *   justicegavel://lessons             → LessonsScreen
 *   justicegavel://lessons/:id         → LessonsScreen (specific lesson)
 *   justicegavel://checkin             → CheckInManagerScreen
 *   justicegavel://firms               → FirmDiscoveryScreen
 *   justicegavel://chat                → ChatScreen
 *
 * Universal links (web):
 *   https://justicegavel.com/app/emergency
 *   https://justicegavel.com/app/bail
 *   https://justicegavel.com/app/firms/:code
 */

export const DEEP_LINK_PREFIXES = [
  'justicegavel://',
  'https://justicegavel.com/app/',
  'http://justicegavel.com/app/',
];

export const linkingConfig = {
  prefixes: DEEP_LINK_PREFIXES,

  config: {
    screens: {
      // Root-level screens accessible without auth
      Root: {
        screens: {
          Emergency:    'emergency',
          HelpNow:      'help',
          Onboarding:   'onboarding',
        },
      },

      // Bottom-tab screens
      Main: {
        screens: {
          Home:          'home',
          BailTab: {
            screens: {
              BailCalculator: 'bail',
              BailSearch:     'bail/search',
            },
          },
          LawyersTab: {
            screens: {
              Lawyers: 'lawyers',
            },
          },
          ChatTab: {
            screens: {
              Chat: 'chat',
            },
          },
          MoreTab: {
            screens: {
              Expungement:     'expungement',
              Lessons:         'lessons',
              Lessons_Detail:  'lessons/:id',
              CheckIn:         'checkin',
              FirmDiscovery:   'firms',
              FirmPublicProfile: 'firms/:code',
              Settings:        'settings',
            },
          },
        },
      },

      // Auth screens
      Auth: {
        screens: {
          Login:    'login',
          Register: 'register',
        },
      },
    },
  },
};

/**
 * Build a deep link URL for sharing
 * Usage: buildDeepLink('firms', 'REFCODE') → 'justicegavel://firms/REFCODE'
 */
export function buildDeepLink(screen: string, param?: string): string {
  const base = 'justicegavel://';
  const path = param ? `${screen}/${param}` : screen;
  return `${base}${path}`;
}

/**
 * Build a universal link URL for web sharing
 */
export function buildUniversalLink(screen: string, param?: string): string {
  const base = 'https://justicegavel.com/app/';
  const path = param ? `${screen}/${param}` : screen;
  return `${base}${path}`;
}
