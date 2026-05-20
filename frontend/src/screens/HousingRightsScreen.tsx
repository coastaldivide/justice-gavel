/**
 * HousingRightsScreen -- Housing Rights & Criminal Record
 *
 * Two-tab layout:
 *   1. Eviction Defense -- expanded from TenantRightsScreen (no overlap)
 *   2. Criminal Record & Housing -- the specific barrier this population faces
 *
 * Covers:
 *   - Fair Chance Housing laws (ban-the-box for housing)
 *   - HUD guidance on criminal record screening
 *   - Public housing and Section 8 with a record
 *   - How to challenge a denial based on criminal history
 *
 * Fully static. Works offline.
 */
import { api } from '../services/api';
import React, { useState, useRef, useCallback } from 'react';
  const [fetchError, setFetchError] = useState<string>('');
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl , ActivityIndicator} from 'react-native';
import { useTheme, RADIUS } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

type Tab = 'record' | 'eviction';

const RECORD_SECTIONS = [
  {
    icon: '⚖️',
    title: 'HUD and the Fair Housing Act',
    body: 'The Department of Housing and Urban Development (HUD) issued guidance in 2016 stating that blanket policies refusing housing to people with criminal records may violate the Fair Housing Act (42 U.S.C. § 3604) because they have a disparate impact on protected classes -- particularly Black and Hispanic Americans. Landlords and housing providers must conduct an individualized assessment, not automatic rejection based on a record.',
  },
  {
    icon: '🏠',
    title: 'What landlords can and cannot do',
    body: 'Landlords CAN: consider criminal history as one factor, use a policy that excludes people convicted of manufacturing or distributing controlled substances, and deny housing when the individual poses a demonstrable risk to others or property.\n\nLandlords CANNOT: automatically deny everyone with any criminal history, use criminal history as a pretext for race discrimination, or apply policies that have a disparate impact without a legitimate justification. A single arrest without conviction cannot be used as a basis for denial.',
  },
  {
    icon: '📋',
    title: 'Fair Chance Housing -- state and local laws',
    body: 'Growing number of cities and states have enacted "Fair Chance Housing" laws that limit when and how criminal history can be used in housing decisions. These laws typically: prohibit asking about criminal history before a conditional offer is made (similar to ban-the-box in employment), require individualized assessment, and limit the lookback period for convictions. Cities with strong Fair Chance Housing laws include Seattle, San Francisco, Los Angeles, Chicago, and Washington DC. Check your city or county\'s housing authority website for local rules.',
  },
  {
    icon: '🏘️',
    title: 'Public housing and Section 8',
    body: 'Public housing authorities (PHAs) have specific federal rules. Certain convictions are mandatory bars to public housing: lifetime sex offender registration, methamphetamine manufacture on federally assisted housing. All other criminal history is subject to PHA discretion. PHAs must use an individualized assessment and consider factors like: age at time of offense, nature and severity, evidence of rehabilitation, time elapsed, and whether the person poses a current risk.\n\nSection 8 (Housing Choice Vouchers) follows the same rules as public housing.',
  },
  {
    icon: '🛑',
    title: 'Challenging a denial',
    body: 'If you are denied housing based on criminal history:\n1. Request a written explanation -- you have the right to know the specific reason.\n2. Request an individualized assessment if one was not conducted.\n3. Gather evidence of rehabilitation: employment, education, family ties, community ties, letters from counselors or employers.\n4. File a complaint with HUD if you believe the denial was discriminatory: hud.gov/program_offices/fair_housing_equal_opp.\n5. Contact a local fair housing organization -- most provide free advocacy.',
  },
  {
    icon: '📝',
    title: 'Expungement and housing',
    body: 'A sealed or expunged record generally cannot be used in housing decisions. After sealing, you typically do not have to disclose the offense on rental applications. However, some housing providers -- particularly federally subsidized housing -- may have access to FBI records that reflect arrests even after state-level sealing. Private landlords running standard background checks generally see only state records, which reflect sealed records as sealed.',
  },
  {
    icon: '📞',
    title: 'Resources',
    body: 'National Fair Housing Alliance: nationalfairhousing.org. HUD Housing Discrimination Complaint: hud.gov. NLIHC (National Low Income Housing Coalition): nlihc.org. Reentry housing resources by state: reentrycouncil.org. Call 211 for local emergency housing assistance.',
  },
];

const EVICTION_SECTIONS = [
  {
    icon: '📋',
    title: 'Types of eviction notices',
    body: 'Pay or Quit: you have X days to pay overdue rent or vacate. Cure or Quit: you have X days to fix a lease violation or vacate. Unconditional Quit: you must vacate with no option to fix (usually reserved for serious violations or repeated offenses). The clock starts when you receive the notice -- count carefully.',
  },
  {
    icon: '⏰',
    title: 'Your timeline -- act immediately',
    body: 'The moment you receive an eviction notice, your clock starts. Typical timelines: Pay or Quit notices give 3-5 days in most states. After the notice period, the landlord files an eviction lawsuit. After filing, you have a set time to respond (often 5-10 days). The hearing is usually 2-4 weeks after filing. A default judgment is entered if you don\'t respond or appear. A writ of possession allows physical removal -- usually 5-14 days after judgment.',
  },
  {
    icon: '⚖️',
    title: 'Your rights in an eviction proceeding',
    body: 'You have the right to appear in court and contest the eviction. You have the right to raise defenses: the landlord did not follow proper notice procedures, the unit is uninhabitable (warranty of habitability), the eviction is retaliation for complaining about conditions, the landlord accepted rent after the notice (waiving the notice), or the eviction is discriminatory. You have the right to request a jury trial in most states. You do not have to leave until a court orders it and a sheriff or marshal executes the writ.',
  },
  {
    icon: '🔑',
    title: 'Self-help eviction is illegal',
    body: 'A landlord cannot lock you out, remove your belongings, shut off utilities, or remove doors or windows to force you to leave. These actions are illegal in every state regardless of whether you owe rent. If a landlord does any of these, call the police and consult a tenant rights attorney immediately. You may be entitled to damages.',
  },
  {
    icon: '💰',
    title: 'Emergency rental assistance',
    body: 'Emergency rental assistance (ERA) programs exist in most states and counties -- funded federally but administered locally. These programs can pay overdue rent directly to the landlord and stop an eviction. Apply immediately if you are behind on rent -- do not wait for an eviction notice. Find programs at: consumerfinance.gov/renthelp. Many programs also require the landlord to participate -- landlords must accept ERA funds in most jurisdictions with ERA programs.',
  },
  {
    icon: '🏘️',
    title: 'After an eviction',
    body: 'An eviction judgment appears on your rental history for 7 years and is visible to landlords on screening reports. This makes finding new housing very difficult. Options: seek housing through organizations that work with people who have eviction histories, look for private landlords who do their own screening rather than using third-party services, apply for public housing (PHAs must do individualized assessment), and work with a housing counselor (free through HUD-approved agencies: hud.gov/housingcounseling).',
  },
];

export default function HousingRightsScreen(): JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = RECORD_SECTIONS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text style={{ fontSize: 32 }}>🏠</Text>
        <Text style={[styles.headerTitle, { color: colors.bgCard }]}>Housing Rights</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]}>Tenant rights & evictions</Text>
      </View>

      {/* Section cards */}
      {allSections.map((sec: any, idx: number) => (
        <View key={idx} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {sec.title ? <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{sec.title}</Text> : null}
          {sec.body  ? <Text style={[styles.cardBody,  { color: colors.textMuted  }]}>{sec.body}</Text>  : null}
          {sec.steps ? sec.steps.map((step: string, si: number) => (
            <Text key={si} style={[styles.cardBody, { color: colors.textMuted }]}>• {step}</Text>
          )) : null}
        </View>
      ))}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text style={[styles.disclaimerText, { color: colors.textFaint }]}>
          This information is for general education only and is not legal advice.
          Laws vary by state. Consult a licensed attorney for advice about your situation.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:          { flex: 1 },
  scroll:          { padding: 16 },
  header:          { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:      { fontSize: 36, marginBottom: 8 },
  headerTitle:     { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:       { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  tabs:            { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  tabBtn:          { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:        { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', textAlign: 'center' },
  offlineNote:     { borderRadius: RADIUS.sm, borderWidth: 1, padding: 9, marginBottom: 12 },
  offlineNoteText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  card:            { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon:        { fontSize: 22 },
  cardTitle:       { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  cardBody:        { fontSize: 12, lineHeight: 20 },
  cta:             { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:         { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:      { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:  { fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
