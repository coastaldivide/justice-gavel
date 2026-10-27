/**
 * ScreenHeader — Unified branded header for all app screens
 *
 * Deep navy background with subtle diagonal stripe texture (pure RN, no images).
 * Left: title + optional subtitle
 * Right: optional action button
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { COLORS, FONTS, SHADOW } from '../constants/theme';
import { t, useLang } from '../i18n';

interface Props {
  title: string;
  subtitle?: string;
  rightIcon?: string;
  onRightPress?: () => void;
  /** Accessibility label for the right action button */
  rightLabel?: string;
  accent?: string; // override bar color for emergency/bondsman screens
  compact?: boolean;
}

function ScreenHeader({
  title, subtitle, rightIcon, onRightPress, rightLabel, accent, compact = false,
}: Props) {
  useLang();
  const bg = accent || COLORS.navy;

  return (
    <View style={[styles.header, { backgroundColor: bg }, compact && styles.compact]}>
      {/* Subtle pattern overlay — diagonal lines via border trick */}
      <View style={styles.patternOverlay} pointerEvents="none" />

      <View style={styles.inner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {!!rightIcon && !!onRightPress && (
          <TouchableOpacity style={styles.actionBtn} onPress={onRightPress} activeOpacity={0.7}
            accessibilityLabel={rightLabel || t('x_screen_header_action')} accessibilityRole="button">
            <Text style={styles.actionIcon}>{rightIcon}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom accent line */}
      <View style={styles.accentLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 52 : 36,
    paddingBottom: 0,
    ...SHADOW.md,
  },
  compact: {
    paddingTop: Platform.OS === 'ios' ? 48 : 32,
  },
  patternOverlay: {
    ...StyleSheet.absoluteFill,
    opacity: 0.04,
    backgroundColor: 'transparent',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: {
    fontSize: 22,
    ...FONTS.black,
    color: COLORS.white,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 12,
    ...FONTS.semi,
    color: COLORS.steel,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(133,183,235,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: 12,
  },
  actionIcon: { fontSize: 18 },
  accentLine: {
    height: 2,
    backgroundColor: COLORS.steel,
    opacity: 0.3,
    marginHorizontal: 20,
    borderRadius: 1,
  },
});

export default React.memo(ScreenHeader);
