/**
 * useHaptics.ts — haptic feedback hook
 *
 * Wraps expo-haptics so feedback degrades gracefully on simulators/web
 * and only triggers when the device supports it.
 *
 * Usage:
 *   const { impact, success, error, warning } = useHaptics();
 *   <ScalePressable onPress={() => { impact(); doAction(); }}>
 *
 * Feedback types:
 *   impact()  — button press / list item tap (Light)
 *   success() — payment complete, submission sent (NotificationFeedbackType.Success)
 *   error()   — validation fail, request error (NotificationFeedbackType.Error)
 *   warning() — destructive action confirm (NotificationFeedbackType.Warning)
 *   heavy()   — long-press, drag drop (Heavy)
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';

// Lazy import — won't crash if expo-haptics not installed in bare workflow
let Haptics: typeof import('expo-haptics') | null = null;
try {
  Haptics = require('expo-haptics');
} catch {
  // expo-haptics not available (web, CI, etc.) — degrade silently
}

export function useHaptics() {
  const trigger = useCallback((fn: () => Promise<void>) => {
    // No haptics on web or when not supported
    if (Platform.OS === 'web' || !Haptics) return;
    fn().catch(() => {}); // never crash for haptics failure
  }, []);

  const impact  = useCallback(() => trigger(() =>
    Haptics!.impactAsync(Haptics!.ImpactFeedbackStyle.Light)
  ), [trigger]);

  const heavy   = useCallback(() => trigger(() =>
    Haptics!.impactAsync(Haptics!.ImpactFeedbackStyle.Heavy)
  ), [trigger]);

  const success = useCallback(() => trigger(() =>
    Haptics!.notificationAsync(Haptics!.NotificationFeedbackType.Success)
  ), [trigger]);

  const error   = useCallback(() => trigger(() =>
    Haptics!.notificationAsync(Haptics!.NotificationFeedbackType.Error)
  ), [trigger]);

  const warning = useCallback(() => trigger(() =>
    Haptics!.notificationAsync(Haptics!.NotificationFeedbackType.Warning)
  ), [trigger]);

  return { impact, heavy, success, error, warning };
}

export default useHaptics;
