/**
 * components/HapticButton.tsx — Button with contextual haptic feedback
 *
 * Every button press should have tactile confirmation. This replaces
 * plain TouchableOpacity for all primary CTAs and critical actions.
 *
 * Variants:
 *   primary   — navy, white text (main CTA)
 *   secondary — outlined navy
 *   danger    — red (delete, emergency)
 *   success   — green (confirm, completed)
 *   ghost     — transparent (tertiary actions)
 */

import React, { useState } from 'react';
import {
  TouchableOpacity, Text, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/theme';
import { AppIcon } from './AppIcon';

interface HapticButtonProps {
  label:        string;
  onPress:      () => void | Promise<void>;
  variant?:     'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?:        'sm' | 'md' | 'lg';
  icon?:        string;
  iconPosition?:'left' | 'right';
  loading?:     boolean;
  disabled?:    boolean;
  style?:       ViewStyle;
  textStyle?:   TextStyle;
  haptic?:      'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
  fullWidth?:   boolean;
}

export function HapticButton({
  label, onPress, variant = 'primary', size = 'md',
  icon, iconPosition = 'left', loading = false, disabled = false,
  style, textStyle, haptic, fullWidth = false,
}: HapticButtonProps) {

  const [pressing, setPressing] = useState(false);

  const handlePress = async () => {
    if (loading || disabled) return;

    // Contextual haptics based on variant and explicit override
    const hap = haptic || (variant === 'danger' ? 'warning' : variant === 'success' ? 'success' : 'light');
    switch (hap) {
      case 'light':   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
      case 'medium':  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
      case 'heavy':   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
      case 'success': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
      case 'warning': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
      case 'error':   Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
    }

    setPressing(true);
    try { await onPress(); } finally { setPressing(false); }
  };

  const variantStyle = styles[variant];
  const sizeStyle    = sizes[size];
  const txtVariant   = textStyles[variant];
  const txtSize      = textSizes[size];
  const isDisabled   = disabled || loading;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        s.base,
        variantStyle,
        sizeStyle,
        fullWidth ? s.fullWidth : null,
        isDisabled ? s.disabled : null,
        pressing ? s.pressing : null,
        style,
      ]}
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.82}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'secondary' || variant === 'ghost' ? COLORS.navy : '#fff'} />
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <AppIcon
              name={icon as any}
              size={sizeStyle.paddingVertical ? 18 : 16}
              color={txtVariant.color as string}
              style={s.iconLeft}
            />
          )}
          <Text style={[s.text, txtVariant, txtSize, textStyle]} maxFontSizeMultiplier={1.1}>
            {label}
          </Text>
          {icon && iconPosition === 'right' && (
            <AppIcon
              name={icon as any}
              size={16}
              color={txtVariant.color as string}
              style={s.iconRight}
            />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  base:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  fullWidth: { alignSelf: 'stretch' },
  disabled:  { opacity: 0.45 },
  pressing:  { transform: [{ scale: 0.97 }] },
  text:      { fontFamily: 'Inter_700Bold' },
  iconLeft:  { marginRight: 7 },
  iconRight: { marginLeft: 7 },
});

const styles = StyleSheet.create({
  primary:   { backgroundColor: COLORS.navy },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.navy },
  danger:    { backgroundColor: COLORS.emergency },
  success:   { backgroundColor: '#1B5E20' },
  ghost:     { backgroundColor: 'transparent' },
});

const sizes = StyleSheet.create({
  sm:  { paddingVertical: 9,  paddingHorizontal: 16 },
  md:  { paddingVertical: 13, paddingHorizontal: 22 },
  lg:  { paddingVertical: 16, paddingHorizontal: 28 },
});

const textStyles = StyleSheet.create({
  primary:   { color: '#fff'         },
  secondary: { color: COLORS.navy    },
  danger:    { color: '#fff'         },
  success:   { color: '#fff'         },
  ghost:     { color: COLORS.navy    },
});

const textSizes = StyleSheet.create({
  sm:  { fontSize: 13, fontWeight: '600' },
  md:  { fontSize: 15, fontWeight: '700' },
  lg:  { fontSize: 16, fontWeight: '800' },
});

export default HapticButton;
