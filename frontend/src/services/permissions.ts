/**
 * permissions.ts — ask for location and notifications IN CONTEXT, with a
 * reason, and never at app start.
 *
 * Flow for both:
 *   granted            → yes, no dialog
 *   never asked        → our own explainer first ("why we need it", with
 *                        "Not now"), and the system prompt only if the user
 *                        agrees — so a "no" can be asked again later, in a
 *                        moment where it makes sense
 *   denied for good    → offer to open Settings (the system will not prompt
 *                        again), or carry on without it
 *
 * Callers: Lawyers / Bail search / Help now / Emergency / Check-in (location,
 * when the user asks for "near me"), Rights card (state detection), saving a
 * court date or turning reminders on in Settings (notifications). Home and
 * Onboarding only use location that was ALREADY granted — they never prompt.
 */
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { syncPushToken } from './push';
import { t, perLang } from '../i18n';

export type PermissionAnswer = 'granted' | 'denied' | 'declined';

/** Our explainer dialog. Resolves true when the user chooses to continue. */
export function explain(title: string, message: string, confirmLabel = t('continue'), cancelLabel = t('cd_not_now')): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${title}\n\n${message}`) : true;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

async function offerSettings(title: string, why: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const open = await explain(title, t('x_permissions_can_turn_it_settings', { why }), t('x_cs_open_settings'), t('cd_not_now'));
  if (open) Linking.openSettings().catch(() => { /* no settings app (simulator) */ });
}

// ── Location ────────────────────────────────────────────────────────────────
export const LOCATION_REASON = perLang(() => t('x_permissions_justice_gavel_uses_location'));

/** Current permission without prompting. */
export async function locationGranted(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch { return false; }
}

/** Ask for location in context (see header). */
export async function requestLocationInContext(reason: string = LOCATION_REASON()): Promise<PermissionAnswer> {
  const cur = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (cur?.status === 'granted') return 'granted';
  if (cur && cur.status === 'denied' && cur.canAskAgain === false) {
    await offerSettings(t('x_permissions_location_off'), reason);
    return 'denied';
  }
  const go = await explain(t('x_permissions_use_location'), reason, t('hn_use_location'), t('cd_not_now'));
  if (!go) return 'declined';
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

// ── Notifications ───────────────────────────────────────────────────────────
export const REMINDER_REASON = perLang(() => t('x_permissions_turn_notifications_so_justice'));

/** Ask for notifications in context; registers the push token when granted. */
export async function requestNotificationsInContext(reason: string = REMINDER_REASON()): Promise<PermissionAnswer> {
  if (Platform.OS === 'web') return 'declined';     // e-mail reminders cover web
  const cur = await Notifications.getPermissionsAsync().catch(() => null);
  let granted = cur?.status === 'granted';
  if (!granted) {
    if (cur && cur.status === 'denied' && cur.canAskAgain === false) {
      await offerSettings(t('x_permissions_notifications_off'), reason);
      return 'denied';
    }
    const go = await explain(t('x_permissions_get_court_date_reminders'), reason, t('x_permissions_turn_reminders'), t('cd_not_now'));
    if (!go) return 'declined';
    const { status } = await Notifications.requestPermissionsAsync();
    granted = status === 'granted';
  }
  if (!granted) return 'denied';
  await syncPushToken().catch(() => null);
  return 'granted';
}
