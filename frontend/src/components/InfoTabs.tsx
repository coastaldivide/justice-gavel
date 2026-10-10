/**
 * InfoTabs — segmented tab bar for the static legal-information screens
 * (Housing Rights, Immigration Consequences, Juvenile Justice).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RADIUS, useTheme } from '../constants/theme';

export interface InfoTab { key: string; label: string }

export function InfoTabs({ tabs, active, onChange, testID }: {
  tabs: InfoTab[];
  active: string;
  onChange: (key: string) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="tablist"
      style={[styles.tabs, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
      {tabs.map(tab => {
        const selected = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => onChange(tab.key)}
            style={[styles.tabBtn, selected && { backgroundColor: colors.navy }]}
          >
            <Text maxFontSizeMultiplier={1.3}
              style={[styles.tabLabel, { color: selected ? colors.bgCard : colors.textSecond }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs:     { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  tabLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', textAlign: 'center' },
});

export default InfoTabs;
