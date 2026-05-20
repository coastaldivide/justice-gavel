/**
 * PracticeAreaSelector — Visual practice area picker
 *
 * Shows all law categories as tappable chips in a scrollable row.
 * Used on LawyersScreen, MatchScreen, and QuickConnectScreen.
 * Tapping a chip filters results immediately — no modal required.
 */
import React, { useRef } from 'react';
import {
  ScrollView, TouchableOpacity, Text, View, StyleSheet,
} from 'react-native';
import { COLORS, FONTS, RADIUS } from '../constants/theme';

export interface PracticeArea {
  key:   string;
  label: string;
  icon:  string;
  color: string;
  bg:    string;
}

export const PRACTICE_AREAS: PracticeArea[] = [
  // ── Criminal (core product) ──────────────────────────────────────────────
  { key: 'DUI',               label: 'DUI / DWI',           icon: '🚗', color: '#B71C1C', bg: '#FFEBEE' },
  { key: 'Drug Offenses',     label: 'Drug Charges',        icon: '💊', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'Assault',           label: 'Assault / Battery',   icon: '⚠️', color: '#E65100', bg: '#FFF3E0' },
  { key: 'Domestic Violence', label: 'Domestic Violence',   icon: '🏠', color: '#C62828', bg: '#FFEBEE' },
  { key: 'Theft',             label: 'Theft / Robbery',     icon: '🔓', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'Weapons Charges',   label: 'Weapons',             icon: '🔫', color: '#3D4F63', bg: '#EEF2F8' },
  { key: 'Federal Crimes',    label: 'Federal',             icon: '🏛️', color: '#042C53', bg: '#EEF2F8' },
  { key: 'Murder/Homicide',   label: 'Murder / Homicide',   icon: '⚖️', color: '#C62828', bg: '#FFEBEE' },
  { key: 'Sex Offenses',      label: 'Sex Offenses',        icon: '🛡️', color: '#BF360C', bg: '#FBE9E7' },
  { key: 'Juvenile Defense',  label: 'Juvenile',            icon: '👶', color: '#2E7D32', bg: '#E8F5E9' },
  { key: 'Expungement',       label: 'Expungement',         icon: '📄', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'White Collar',      label: 'White Collar',        icon: '💼', color: '#2E7D32', bg: '#E8F5E9' },
  // ── Civil & Family ────────────────────────────────────────────────────────
  { key: 'Family Law',        label: 'Family Law',          icon: '👨‍👩‍👧', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'Divorce',           label: 'Divorce',             icon: '💔', color: '#C62828', bg: '#FFEBEE' },
  { key: 'Child Custody',     label: 'Child Custody',       icon: '👶', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'Immigration',       label: 'Immigration',         icon: '✈️', color: '#185FA5', bg: '#EEF2F8' },
  { key: 'Personal Injury',   label: 'Personal Injury',     icon: '🩹', color: '#E65100', bg: '#FBE9E7' },
  { key: 'Employment',        label: 'Employment',          icon: '💼', color: '#1B5E20', bg: '#E8F5E9' },
  { key: 'Bankruptcy',        label: 'Bankruptcy',          icon: '💳', color: '#3D4F63', bg: '#EEF2F8' },
  { key: 'Real Estate',       label: 'Real Estate',         icon: '🏡', color: '#2E7D32', bg: '#E8F5E9' },
  { key: 'Civil Rights',      label: 'Civil Rights',        icon: '✊', color: '#042C53', bg: '#EEF2F8' },
  { key: 'Traffic',           label: 'Traffic',             icon: '🚦', color: '#F9A825', bg: '#2C1800' },
];

interface Props {
  selected:    string;
  onSelect:    (key: string) => void;
  showAll?:    boolean;  // if false, shows criminal only (default)
}

function PracticeAreaSelector({ selected, onSelect, showAll = false }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  const areas = showAll
    ? PRACTICE_AREAS
    : PRACTICE_AREAS.slice(0, 12); // criminal only by default

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Area of Law</Text>
        {!showAll && (
          <Text style={styles.seeAll}>Scroll for more →</Text>
        )}
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* "All" chip first */}
        <TouchableOpacity accessibilityRole="radio"
          style={[
            styles.chip,
            !selected && styles.chipAllActive,
          ]}
          onPress={() => onSelect('')}
          activeOpacity={0.75}
        >
          <Text style={styles.chipIcon}>⚖️</Text>
          <Text style={[styles.chipLabel, !selected && styles.chipLabelActive]}>
            All
          </Text>
        </TouchableOpacity>

        {areas.map(area => {
          const active = selected === area.key;
          return (
            <TouchableOpacity
              key={area.key}
              style={[
                styles.chip,
                active && { backgroundColor: area.color, borderColor: area.color },
                !active && { backgroundColor: area.bg, borderColor: area.color + '44' },
              ]}
              onPress={() => onSelect(active ? '' : area.key)}
          accessibilityRole="button"
              activeOpacity={0.75}
            >
              <Text style={styles.chipIcon}>{area.icon}</Text>
              <Text style={[
                styles.chipLabel,
                { color: active ? '#FFFFFF' : area.color },
              ]}>
                {area.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#FFFFFF', paddingVertical: 10 },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 14, marginBottom: 8,
  },
  label:   { fontSize: 12, ...FONTS.black, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  seeAll:  { fontSize: 11, color: COLORS.steelDark, ...FONTS.semi },
  scroll:  { paddingHorizontal: 14, gap: 8, paddingRight: 24 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1.5,
    minWidth: 80,
  },
  chipAllActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  chipIcon:  { fontSize: 14 },
  chipLabel: { fontSize: 12, ...FONTS.bold, flexShrink: 1 },
  chipLabelActive: { color: '#FFFFFF' },
});

export default React.memo(PracticeAreaSelector);
