import * as Haptics from 'expo-haptics';

export const haptic = {
  light:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  medium:  () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  error:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};

// ── Convenience named exports for existing screens ────────────────────────────
export const hapticCall    = haptic.light;
export const hapticSuccess = haptic.success;
export const hapticWarn    = haptic.warning;
export const hapticError   = haptic.error;
export const hapticSelect  = haptic.light;
export const hapticMedium  = haptic.medium;
