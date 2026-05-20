/**
 * auth.ts — App-level auth state broadcaster
 *
 * States:
 *   loading  — checking AsyncStorage on startup
 *   guest    — onboarding / login screens (no token)
 *   browsing — guest with access to Lawyers/Bail/Chat/Emergency (no account needed)
 *   authed   — logged in with JWT token
 */

export type AuthState = 'loading' | 'guest' | 'browsing' | 'authed';

let _setter: ((s: AuthState) => void) | null = null;

export function registerAuthSetter(fn: (s: AuthState) => void) {
  _setter = fn;
}

export function setAppAuth(s: AuthState) {
  if (_setter) {
    _setter(s);
  } else {
    console.warn('[auth] setAppAuth called before registerAuthSetter');
  }
}

/** True if user can access protected features (cases, payments, SOS with contacts) */
export function isAuthenticated(state: AuthState): boolean {
  return state === 'authed';
}

/** True if user can access public features (find lawyers, bail search, chat, emergency) */
export function canBrowse(state: AuthState): boolean {
  return state === 'authed' || state === 'browsing';
}
