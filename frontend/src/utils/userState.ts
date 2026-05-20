/**
 * userState.ts — Single source of truth for the user's selected US state.
 *
 * KEY: 'jg_user_state'      — two-letter code  e.g. 'TN', 'CA', 'NY'
 * KEY: 'jg_user_state_name' — full name         e.g. 'Tennessee'
 *
 * Used by:
 *   RightsCardScreen  — state-specific rights card
 *   ChatScreen        — jurisdiction injected into every AI message
 *   ExpungementScreen — pre-fills state selector
 *   LawyersScreen     — filters attorneys by state
 *   BailSearchScreen  — filters bondsmen by state
 *   OnboardingScreen  — sets on first launch
 *   SettingsScreen    — lets user update preference
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const USER_STATE_KEY      = 'jg_user_state';
export const USER_STATE_NAME_KEY = 'jg_user_state_name';

export const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',    AK:'Alaska',       AZ:'Arizona',      AR:'Arkansas',
  CA:'California', CO:'Colorado',     CT:'Connecticut',  DE:'Delaware',
  DC:'Washington D.C.', FL:'Florida', GA:'Georgia',      HI:'Hawaii',
  ID:'Idaho',      IL:'Illinois',     IN:'Indiana',      IA:'Iowa',
  KS:'Kansas',     KY:'Kentucky',     LA:'Louisiana',    ME:'Maine',
  MD:'Maryland',   MA:'Massachusetts',MI:'Michigan',     MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',     MT:'Montana',      NE:'Nebraska',
  NV:'Nevada',     NH:'New Hampshire',NJ:'New Jersey',   NM:'New Mexico',
  NY:'New York',   NC:'North Carolina',ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma',   OR:'Oregon',       PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',  TX:'Texas',
  UT:'Utah',       VT:'Vermont',      VA:'Virginia',     WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',  WY:'Wyoming',
};

export const STATE_LIST = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Load the user's saved state. Returns {code, name} or null. */
export async function getUserState(): Promise<{ code: string; name: string } | null> {
  try {
    const code = await AsyncStorage.getItem(USER_STATE_KEY);
    if (!code) return null;
    return { code, name: STATE_NAMES[code] || code };
  } catch { return null; }
}

/** Persist the user's state choice everywhere. */
export async function setUserState(code: string): Promise<void> {
  try {
    const name = STATE_NAMES[code] || code;
    await AsyncStorage.setItem(USER_STATE_KEY, code);
    await AsyncStorage.setItem(USER_STATE_NAME_KEY, name);
  } catch { /* storage write failed — non-critical */ }
}

/** Called on logout to clear state preference. */
export async function clearUserState(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([USER_STATE_KEY, USER_STATE_NAME_KEY]);
  } catch { /* non-critical */ }
}
