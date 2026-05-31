/**
 * components/GradientHeader.tsx — Branded gradient header
 *
 * Replaces flat solid-color headers. LinearGradient from navy to blue
 * gives depth and communicates authority — critical for a legal app.
 * Supports icon, title, subtitle, badge, back button, and action slot.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/theme';
import { AppIcon, ICONS } from './AppIcon';

interface GradientHeaderProps {
  title:        string;
  subtitle?:    string;
  icon?:        keyof typeof ICONS;
  iconName?:    string;
  badge?:       string;
  badgeColor?:  string;
  onBack?:      () => void;
  rightAction?: React.ReactNode;
  variant?:     'navy' | 'emergency' | 'legal' | 'gold' | 'dark';
  compact?:     boolean;
}

const GRADIENTS = {
  navy:      ['#042C53', '#185FA5'] as const,
  emergency: ['#C62828', '#E53935'] as const,
  legal:     ['#1B5E20', '#2E7D32'] as const,
  gold:      ['#8B6914', '#F59E0B'] as const,
  dark:      ['#0A1929', '#042C53'] as const,
};

export function GradientHeader({
  title, subtitle, icon, iconName, badge, badgeColor,
  onBack, rightAction, variant = 'navy', compact = false,
}: GradientHeaderProps) {
  const gradColors = GRADIENTS[variant];

  return (
    <LinearGradient
      colors={gradColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.container, compact && s.compact]}
    >
      {/* Back button */}
      {onBack && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={s.backBtn}
          onPress={onBack}
        >
          <AppIcon name={ICONS.back} size={24} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      )}

      {/* Content */}
      <View style={s.content}>
        {/* Icon */}
        {(icon || iconName) && (
          <View style={[s.iconWrap, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <AppIcon
              name={(iconName || ICONS[icon!]) as any}
              size={compact ? 20 : 26}
              color="#fff"
            />
          </View>
        )}

        {/* Text */}
        <View style={s.textWrap}>
          <View style={s.titleRow}>
            <Text
              style={[s.title, compact && s.titleCompact]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {title}
            </Text>
            {badge && (
              <View style={[s.badge, { backgroundColor: badgeColor || 'rgba(255,255,255,0.25)' }]}>
                <Text style={s.badgeText}>{badge}</Text>
              </View>
            )}
          </View>
          {subtitle && (
            <Text style={s.subtitle} numberOfLines={2} maxFontSizeMultiplier={1.1}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      {/* Right action slot */}
      {rightAction && (
        <View style={s.rightAction}>{rightAction}</View>
      )}

      {/* Subtle bottom highlight line */}
      <View style={s.bottomLine} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  container:    { paddingTop: 52, paddingBottom: 20, paddingHorizontal: 20, position: 'relative' },
  compact:      { paddingTop: 44, paddingBottom: 14 },
  backBtn:      { position: 'absolute', top: 50, left: 16, padding: 4, zIndex: 10 },
  content:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconWrap:     { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  textWrap:     { flex: 1 },
  titleRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title:        { fontSize: 22, fontWeight: '800', color: '#fff', fontFamily: 'Inter_800ExtraBold', letterSpacing: -0.3 },
  titleCompact: { fontSize: 18 },
  subtitle:     { fontSize: 13, color: 'rgba(255,255,255,0.78)', marginTop: 3, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText:    { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  rightAction:  { position: 'absolute', right: 16, bottom: 18 },
  bottomLine:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
});

export default GradientHeader;
