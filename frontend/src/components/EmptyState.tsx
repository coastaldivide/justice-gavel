/**
 * EmptyState.tsx — visual empty state component
 *
 * Replaces bare "No results found" text with an engaging visual prompt.
 * Used across all list and search screens.
 *
 * Usage:
 *   {data.length === 0 && (
 *     <EmptyState
 *       icon="🔍"
 *       title="No lawyers found"
 *       subtitle="Try adjusting your filters or search radius"
 *       action={{ label: 'Clear filters', onPress: clearFilters }}
 *     />
 *   )}
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useTheme } from '../constants/theme';

interface EmptyStateAction {
  label:   string;
  onPress: () => void;
}

interface EmptyStateProps {
  icon?:     string;
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
        <Text style={styles.icon}>{icon}</Text>
      ) : null}
      <Text style={[styles.title, { color: colors?.text ?? '#1C1C1E' }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: (colors as any)?.subtext ?? colors?.text ?? '#6B7280' }]}>
          {subtitle}
        </Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors?.primary ?? '#3B82F6' }]}
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
    color:      '#fff',
    fontSize:   15,
    fontWeight: '600',
  },
});

export default EmptyState;
