/**
 * EmptyState.tsx — visual empty state component
 *
 * Replaces bare "No results found" text with an engaging visual prompt.
 * Used across all list and search screens.
 *
 * Usage:
 *   {data.length === 0 && (
 *     <EmptyState
 *       icon={ICONS.search}
 *       title="No lawyers found"
 *       subtitle="Try adjusting your filters or search radius"
 *       action={{ label: 'Clear filters', onPress: clearFilters }}
 *     />
 *   )}
 */

import React from 'react';
import { COLORS } from '../constants/theme';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useTheme } from '../constants/theme';
import { AppIcon, type IconName } from './AppIcon';

interface EmptyStateAction {
  label:   string;
  onPress: () => void;
}

interface EmptyStateProps {
  icon?:     IconName;
  title:     string;
  subtitle?: string;
  action?:   EmptyStateAction;
  style?:    object;
}

export function EmptyState({ icon, title, subtitle, action, style }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, style]}>
      {icon ? (
        <AppIcon name={icon} size={40} color={colors.textMuted} style={styles.icon} />
      ) : null}
      <Text style={[styles.title, { color: colors?.text ?? colors.textPrimary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: (colors as any)?.subtext ?? colors?.text ?? colors.textMuted }]}>
          {subtitle}
        </Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors?.primary ?? colors.blue }]}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 32,
    paddingVertical:   48,
  },
  icon: {
    fontSize:     48,
    marginBottom: 16,
    textAlign:    'center',
  },
  title: {
    fontSize:     18,
    fontWeight:   '600',
    textAlign:    'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize:     14,
    textAlign:    'center',
    lineHeight:   20,
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical:   12,
    borderRadius:      24,
  },
  buttonText: {
    color:      COLORS.white,
    fontSize:   15,
    fontWeight: '600',
  },
});

export default EmptyState;
