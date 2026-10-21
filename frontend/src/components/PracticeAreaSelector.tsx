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
import { FONTS, RADIUS, useTheme, type ThemeColors } from '../constants/theme';
import { AppIcon, ICONS, type IconName } from './AppIcon';
import { t, perLang, useLang } from '../i18n';

type Tone = 'emergency' | 'info' | 'warn' | 'legal' | 'bail' | 'neutral';

export interface PracticeArea {
  key:   string;
  label: string;
  icon:  IconName;
  tone:  Tone;
}

/** Chip colours per tone, from the active theme (AA for 12pt bold in both modes). */
function toneColors(tone: Tone, c: ThemeColors): { fg: string; bg: string } {
  switch (tone) {
    case 'emergency': return { fg: c.emergency, bg: c.emergencyBg };
    case 'info':      return { fg: c.info, bg: c.infoBg };
    case 'warn':      return { fg: c.warnDark, bg: c.warnBg };
    case 'legal':     return { fg: c.legal, bg: c.legalBg };
    case 'bail':      return { fg: c.bail, bg: c.bailBg };
    default:          return { fg: c.textBrand, bg: c.bgSubtle };
  }
}

export const PRACTICE_AREAS = perLang((): PracticeArea[] => [
  // ── Criminal (core product) ──────────────────────────────────────────────
  { key: 'DUI',               label: 'DUI / DWI',                                       icon: ICONS.car,          tone: 'emergency' },
  { key: 'Drug Offenses',     label: t('x_practice_area_selector_drug_charges'),        icon: ICONS.drug,         tone: 'info' },
  { key: 'Assault',           label: t('whn_charge_assault'),                           icon: ICONS.alertHigh,    tone: 'warn' },
  { key: 'Domestic Violence', label: t('div_charge_domestic'),                          icon: ICONS.housing,      tone: 'emergency' },
  { key: 'Theft',             label: t('x_practice_area_selector_theft_robbery'),       icon: ICONS.bail,         tone: 'info' },
  { key: 'Weapons Charges',   label: t('hn_charge_weapons'),                            icon: ICONS.weapon,       tone: 'neutral' },
  { key: 'Federal Crimes',    label: t('x_practice_area_selector_federal'),             icon: ICONS.courthouse,   tone: 'neutral' },
  { key: 'Murder/Homicide',   label: t('x_practice_area_selector_murder_homicide'),     icon: ICONS.lawyer,       tone: 'emergency' },
  { key: 'Sex Offenses',      label: t('x_practice_area_selector_sex_offenses'),        icon: ICONS.shield,       tone: 'bail' },
  { key: 'Juvenile Defense',  label: t('x_practice_area_selector_juvenile'),            icon: ICONS.juvenile,     tone: 'legal' },
  { key: 'Expungement',       label: t('chat_prompt_expungement'),                      icon: ICONS.document,     tone: 'info' },
  { key: 'White Collar',      label: t('x_practice_area_selector_white_collar'),        icon: ICONS.briefcase,    tone: 'legal' },
  // ── Civil & Family ────────────────────────────────────────────────────────
  { key: 'Family Law',        label: t('x_practice_area_selector_family_law'),          icon: ICONS.family,       tone: 'info' },
  { key: 'Divorce',           label: t('chat_prompt_divorce'),                          icon: ICONS.heartBroken,  tone: 'emergency' },
  { key: 'Child Custody',     label: t('x_practice_area_selector_child_custody'),       icon: ICONS.juvenile,     tone: 'info' },
  { key: 'Immigration',       label: t('chat_cat_immigration'),                         icon: ICONS.immigration,  tone: 'info' },
  { key: 'Personal Injury',   label: t('x_practice_area_selector_personal_injury'),     icon: ICONS.drug,         tone: 'bail' },
  { key: 'Employment',        label: t('x_practice_area_selector_employment'),          icon: ICONS.briefcase,    tone: 'legal' },
  { key: 'Bankruptcy',        label: t('chat_prompt_bankruptcy'),                       icon: ICONS.card,         tone: 'neutral' },
  { key: 'Real Estate',       label: t('x_practice_area_selector_real_estate'),         icon: ICONS.housing,      tone: 'legal' },
  { key: 'Civil Rights',      label: t('x_practice_area_selector_civil_rights'),        icon: ICONS.rights,       tone: 'neutral' },
  { key: 'Traffic',           label: t('hn_charge_traffic'),                            icon: ICONS.car,          tone: 'warn' },
]);

interface Props {
  selected:    string;
  onSelect:    (key: string) => void;
  showAll?:    boolean;  // if false, shows criminal only (default)
}

function PracticeAreaSelector({ selected, onSelect, showAll = false }: Props) {
  useLang();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
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
          <AppIcon name={ICONS.lawyer} size={14} color={!selected ? colors.white : colors.textBrand} />
          <Text style={[styles.chipLabel, !selected && styles.chipLabelActive]}>
            {t('x_practice_area_selector_all')}
          </Text>
        </TouchableOpacity>

        {areas.map(area => {
          const active = selected === area.key;
          const tone = toneColors(area.tone, colors);
          return (
            <TouchableOpacity
              key={area.key}
              style={[
                styles.chip,
                active && { backgroundColor: tone.fg, borderColor: tone.fg },
                !active && { backgroundColor: tone.bg, borderColor: tone.fg + '44' },
              ]}
              onPress={() => onSelect(active ? '' : area.key)}
          accessibilityRole="button"
              activeOpacity={0.75}
            >
              <AppIcon name={area.icon} size={14} color={active ? colors.textOnAccent : tone.fg} />
              <Text style={[
                styles.chipLabel,
                { color: active ? colors.textOnAccent : tone.fg },
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { backgroundColor: colors.bgCard, paddingVertical: 10 },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 14, marginBottom: 8,
  },
  label:   { fontSize: 12, ...FONTS.black, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  seeAll:  { fontSize: 11, color: colors.textBrand, ...FONTS.semi },
  scroll:  { paddingHorizontal: 14, gap: 8, paddingRight: 24 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.bgCard,
    minWidth: 80, minHeight: 44,
  },
  chipAllActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipLabel: { fontSize: 12, ...FONTS.bold, flexShrink: 1, color: colors.textBrand },
  chipLabelActive: { color: colors.white },
});

export default React.memo(PracticeAreaSelector);
