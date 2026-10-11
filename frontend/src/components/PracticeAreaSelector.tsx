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
  { key: 'DUI',               label: 'DUI / DWI',           icon: '🚗', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
  { key: 'Drug Offenses',     label: 'Drug Charges',        icon: '💊', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Assault',           label: 'Assault / Battery',   icon: '⚠️', color: COLORS.warn, bg: COLORS.warnBg },
  { key: 'Domestic Violence', label: 'Domestic Violence',   icon: '🏠', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Theft',             label: 'Theft / Robbery',     icon: '🔓', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Weapons Charges',   label: 'Weapons',             icon: '🔫', color: COLORS.textSecond, bg: COLORS.bgSubtle },
  { key: 'Federal Crimes',    label: 'Federal',             icon: '🏛️', color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Murder/Homicide',   label: 'Murder / Homicide',   icon: '⚖️', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Sex Offenses',      label: 'Sex Offenses',        icon: '🛡️', color: COLORS.bail, bg: COLORS.bailBg },
  { key: 'Juvenile Defense',  label: 'Juvenile',            icon: '👶', color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Expungement',       label: 'Expungement',         icon: '📄', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'White Collar',      label: 'White Collar',        icon: '💼', color: COLORS.legalDark, bg: COLORS.legalBg },
  // ── Civil & Family ────────────────────────────────────────────────────────
  { key: 'Family Law',        label: 'Family Law',          icon: '👨‍👩‍👧', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Divorce',           label: 'Divorce',             icon: '💔', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Child Custody',     label: 'Child Custody',       icon: '👶', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Immigration',       label: 'Immigration',         icon: '✈️', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Personal Injury',   label: 'Personal Injury',     icon: '🩹', color: COLORS.warn, bg: COLORS.bailBg },
  { key: 'Employment',        label: 'Employment',          icon: '💼', color: COLORS.legal, bg: COLORS.legalBg },
  { key: 'Bankruptcy',        label: 'Bankruptcy',          icon: '💳', color: COLORS.textSecond, bg: COLORS.bgSubtle },
  { key: 'Real Estate',       label: 'Real Estate',         icon: '🏡', color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Civil Rights',      label: 'Civil Rights',        icon: '✊', color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Traffic',           label: 'Traffic',             icon: '🚦', color: COLORS.gold, bg: COLORS.warnBg },
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
                { color: active ? COLORS.white : area.color },
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
  container: { backgroundColor: COLORS.white, paddingVertical: 10 },
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
  chipLabelActive: { color: COLORS.white },
});

export default React.memo(PracticeAreaSelector);
