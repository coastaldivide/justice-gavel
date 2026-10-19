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
import { t, perLang, useLang } from '../i18n';

export interface PracticeArea {
  key:   string;
  label: string;
  icon:  string;
  color: string;
  bg:    string;
}

export const PRACTICE_AREAS = perLang((): PracticeArea[] => [
  // ── Criminal (core product) ──────────────────────────────────────────────
  { key: 'DUI',               label: 'DUI / DWI',           icon: '🚗', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
  { key: 'Drug Offenses',     label: t('x_practice_area_selector_drug_charges'),        icon: '💊', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Assault',           label: t('whn_charge_assault'),   icon: '⚠️', color: COLORS.warn, bg: COLORS.warnBg },
  { key: 'Domestic Violence', label: t('div_charge_domestic'),   icon: '🏠', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Theft',             label: t('x_practice_area_selector_theft_robbery'),     icon: '🔓', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Weapons Charges',   label: t('hn_charge_weapons'),             icon: '🔫', color: COLORS.textSecond, bg: COLORS.bgSubtle },
  { key: 'Federal Crimes',    label: t('x_practice_area_selector_federal'),             icon: '🏛️', color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Murder/Homicide',   label: t('x_practice_area_selector_murder_homicide'),   icon: '⚖️', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Sex Offenses',      label: t('x_practice_area_selector_sex_offenses'),        icon: '🛡️', color: COLORS.bail, bg: COLORS.bailBg },
  { key: 'Juvenile Defense',  label: t('x_practice_area_selector_juvenile'),            icon: '👶', color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Expungement',       label: t('chat_prompt_expungement'),         icon: '📄', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'White Collar',      label: t('x_practice_area_selector_white_collar'),        icon: '💼', color: COLORS.legalDark, bg: COLORS.legalBg },
  // ── Civil & Family ────────────────────────────────────────────────────────
  { key: 'Family Law',        label: t('x_practice_area_selector_family_law'),          icon: '👨‍👩‍👧', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Divorce',           label: t('chat_prompt_divorce'),             icon: '💔', color: COLORS.emergency, bg: COLORS.emergencyBg },
  { key: 'Child Custody',     label: t('x_practice_area_selector_child_custody'),       icon: '👶', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Immigration',       label: t('chat_cat_immigration'),         icon: '✈️', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'Personal Injury',   label: t('x_practice_area_selector_personal_injury'),     icon: '🩹', color: COLORS.warn, bg: COLORS.bailBg },
  { key: 'Employment',        label: t('x_practice_area_selector_employment'),          icon: '💼', color: COLORS.legal, bg: COLORS.legalBg },
  { key: 'Bankruptcy',        label: t('chat_prompt_bankruptcy'),          icon: '💳', color: COLORS.textSecond, bg: COLORS.bgSubtle },
  { key: 'Real Estate',       label: t('x_practice_area_selector_real_estate'),         icon: '🏡', color: COLORS.legalDark, bg: COLORS.legalBg },
  { key: 'Civil Rights',      label: t('x_practice_area_selector_civil_rights'),        icon: '✊', color: COLORS.navy, bg: COLORS.bgSubtle },
  { key: 'Traffic',           label: t('hn_charge_traffic'),             icon: '🚦', color: COLORS.gold, bg: COLORS.warnBg },
]);

interface Props {
  selected:    string;
  onSelect:    (key: string) => void;
  showAll?:    boolean;  // if false, shows criminal only (default)
}

function PracticeAreaSelector({ selected, onSelect, showAll = false }: Props) {
  useLang();
  const scrollRef = useRef<ScrollView>(null);

  const areas = showAll
    ? PRACTICE_AREAS()
    : PRACTICE_AREAS().slice(0, 12); // criminal only by default

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{t('x_practice_area_selector_area_law')}</Text>
        {!showAll && (
          <Text style={styles.seeAll}>{t('x_practice_area_selector_scroll_more')}</Text>
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
            {t('x_practice_area_selector_all')}
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
