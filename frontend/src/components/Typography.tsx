/**
 * components/Typography.tsx — Consistent type system
 *
 * Wraps all text rendering in one component with the correct Inter font
 * family, line heights, and max scaling. Eliminates the 29/80 screens
 * using system font by accident.
 *
 * Usage:
 *   <Heading1>Your Rights</Heading1>
 *   <Body>You have the right to remain silent.</Body>
 *   <Label>CHARGE TYPE</Label>
 *   <Caption>Last updated March 2026</Caption>
 */

import React from 'react';
import { Text, TextStyle, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';

interface TypographyProps {
  children: React.ReactNode;
  style?:   TextStyle | TextStyle[];
  color?:   string;
  center?:  boolean;
  lines?:   number;
}

export function Heading1({ children, style, color, center }: TypographyProps) {
  return (
    <Text
      style={[t.h1, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
      maxFontSizeMultiplier={1.2}
    >
      {children}
    </Text>
  );
}

export function Heading2({ children, style, color, center }: TypographyProps) {
  return (
    <Text
      style={[t.h2, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
      maxFontSizeMultiplier={1.2}
    >
      {children}
    </Text>
  );
}

export function Heading3({ children, style, color, center }: TypographyProps) {
  return (
    <Text
      style={[t.h3, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
      maxFontSizeMultiplier={1.25}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, color, lines }: TypographyProps) {
  return (
    <Text
      style={[t.body, color ? { color } : null, style]}
      maxFontSizeMultiplier={1.3}
      numberOfLines={lines}
    >
      {children}
    </Text>
  );
}

export function BodySmall({ children, style, color }: TypographyProps) {
  return (
    <Text
      style={[t.bodySmall, color ? { color } : null, style]}
      maxFontSizeMultiplier={1.3}
    >
      {children}
    </Text>
  );
}

export function Label({ children, style, color }: TypographyProps) {
  return (
    <Text
      style={[t.label, color ? { color } : null, style]}
      maxFontSizeMultiplier={1.1}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style, color, center }: TypographyProps) {
  return (
    <Text
      style={[t.caption, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
      maxFontSizeMultiplier={1.2}
    >
      {children}
    </Text>
  );
}

export function Emphasis({ children, style, color }: TypographyProps) {
  return (
    <Text
      style={[t.emphasis, color ? { color } : null, style]}
      maxFontSizeMultiplier={1.25}
    >
      {children}
    </Text>
  );
}

const t = StyleSheet.create({
  h1:       { fontSize: 26, fontWeight: '800', fontFamily: 'Inter_800ExtraBold',
               color: COLORS.textPrimary, lineHeight: 32, letterSpacing: -0.4 },
  h2:       { fontSize: 20, fontWeight: '700', fontFamily: 'Inter_700Bold',
               color: COLORS.textPrimary, lineHeight: 26, letterSpacing: -0.2 },
  h3:       { fontSize: 16, fontWeight: '700', fontFamily: 'Inter_700Bold',
               color: COLORS.textPrimary, lineHeight: 22 },
  body:     { fontSize: 15, fontWeight: '400', fontFamily: 'Inter_400Regular',
               color: COLORS.textSecond, lineHeight: 23 },
  bodySmall:{ fontSize: 13, fontWeight: '400', fontFamily: 'Inter_400Regular',
               color: COLORS.textSecond, lineHeight: 19 },
  label:    { fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold',
               color: COLORS.textMuted, letterSpacing: 0.8,
               textTransform: 'uppercase' },
  caption:  { fontSize: 12, fontWeight: '400', fontFamily: 'Inter_400Regular',
               color: COLORS.textMuted, lineHeight: 17 },
  emphasis: { fontSize: 15, fontWeight: '600', fontFamily: 'Inter_600SemiBold',
               color: COLORS.textPrimary, lineHeight: 22 },
});

export const Typography = { Heading1, Heading2, Heading3, Body, BodySmall, Label, Caption, Emphasis };
export default Typography;
