/**
 * haptics.ts — Haptic feedback utilities
 * Wraps expo-haptics with safe catch (haptics fail silently on devices without support)
 */
import * as Haptics from 'expo-haptics';

export const hapticSuccess  = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

export const hapticError    = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

export const hapticWarning  = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

export const hapticLight    = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export const hapticMedium   = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
