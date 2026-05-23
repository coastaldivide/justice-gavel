/**
 * haptics.ts — Haptic feedback helpers
 *
 * Wraps expo-haptics with a try/catch so it never crashes on devices
 * that don't support haptics (simulators, older Android).
 *
 * Usage:
 *   import { hapticCall, hapticSuccess, hapticWarn, hapticSelect } from '../services/haptics';
 *
 *   // On CALL NOW tap:
 *   hapticCall();
 *   callPhone(item.phone);
 *
 *   // On payment success:
 *   hapticSuccess();
 */
import * as Haptics from 'expo-haptics';

// Heavy impact — for CALL NOW, SOS, emergency actions
export async function hapticCall(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {}
}

// Success notification — for Pay Now success, booking confirmed, check-in done
export async function hapticSuccess(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}

// Warning notification — for errors, failed actions
export async function hapticWarn(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {}
}

// Light selection — for tab switches, filter taps, chip selections
export async function hapticSelect(): Promise<void> {
  try {
    await Haptics.selectionAsync();
  } catch {}
}

// Medium impact — for save, confirm, secondary actions
export async function hapticMedium(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
}
