/**
 * ImmigrationConsequencesScreen -- Criminal Record & Immigration Consequences
 *
 * Two-tab layout:
 *   1. Consequences -- which offenses trigger what immigration consequences
 *   2. DACA / Visas -- specific impact by immigration status
 *
 * Covers the three primary consequences:
 *   - Deportation / removal
 *   - Inadmissibility (bars to re-entry or status adjustment)
 *   - DACA / visa / naturalization impacts
 *
 * Fully static. Works offline.
 * Note: immigration law is extremely complex -- strong attorney referral throughout.
 */
import { api } from '../services/api';
import React, { useState, useCallback } from 'react';

import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator} from 'react-native';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

type Tab = 'consequences' | 'status';

const CONSEQUENCE_GROUPS = [
  {
    severity: 'Deportable -- almost always triggers removal',
    color:    COLORS.emergency,
    bg:       COLORS.emergencyBg,
    offenses: [
      { offense: 'Aggravated felony (INA § 101(a)(43))', detail: 'The broadest and most severe category. Includes murder, drug trafficking, crimes of violence with 1+ yr sentence, theft/fraud with 1+ yr, sexual abuse of a minor, and many others. Deportation is virtually automatic. No discretionary relief available in most cases.' },
      { offense: 'Drug conviction (any controlled substance)', detail: 'Any drug conviction -- including misdemeanor possession -- makes a non-citizen deportable. Exception: a single offense of simple possession of 30g or less of marijuana may qualify for a discretionary waiver. Drug trafficking is an aggravated felony.' },
      { offense: 'Domestic violence / stalking / child abuse', detail: 'Conviction for domestic violence, stalking, child abuse, child neglect, or violation of a protective order makes a non-citizen deportable. This includes misdemeanor domestic battery in many jurisdictions.' },
      { offense: 'Firearm offense', detail: 'Any conviction relating to purchase, sale, or possession of a firearm or destructive device triggers deportability.' },
      { offense: 'Two or more crimes involving moral turpitude (CIMT)', detail: 'Crimes involving fraud, theft, or intentional harm to persons or property. Two or more CIMTs at any time after entry, or one CIMT within 5 years of entry with potential sentence of 1+ year, triggers deportability.' },
    ],
  },
  {
    severity: 'Inadmissibility -- bars re-entry or status change',
    color:    COLORS.warn,
    bg:       COLORS.warnBg,
    offenses: [
      { offense: 'Single crime involving moral turpitude (CIMT)', detail: 'One CIMT with potential sentence of 1+ year makes a non-citizen inadmissible (bars adjustment of status, re-entry, naturalization). The "petty offense exception" may apply for sentences under 6 months for offenses carrying max 1 year.' },
      { offense: 'Any drug offense conviction or admission', detail: 'A conviction or even an admission to a drug offense to an immigration officer makes someone inadmissible. This includes marijuana offenses legal in the state where they occurred -- federal law controls immigration consequences.' },
      { offense: 'Prostitution within 10 years', detail: 'Conviction or admission to engaging in prostitution within 10 years of visa or adjustment application.' },
      { offense: 'Health-related grounds', detail: 'Not a criminal matter, but relevant context: communicable disease, lack of required vaccinations, or mental disorder with harmful behavior can independently bar admission.' },
    ],
  },
  {
    severity: 'Less severe but still consequential',
    color:    COLORS.legal,
    bg:       COLORS.legalBg,
    offenses: [
      { offense: 'Simple assault (misdemeanor)', detail: 'May or may not be a CIMT depending on the specific statute and jurisdiction. Must be analyzed case-by-case. Some simple assault convictions are not deportable -- an immigration attorney must review.' },
      { offense: 'DUI / DWI', detail: 'Not automatically a CIMT. However, DUI combined with other facts (prior convictions, aggravating circumstances, underlying drug charge) can trigger consequences. A DUI may also affect naturalization by evidence of bad moral character. Must be reviewed individually.' },
      { offense: 'Shoplifting / petit theft', detail: 'Shoplifting with conviction may be a CIMT depending on the value of the property and state law. Items worth $500+ are more likely to qualify. Items worth less, especially with no prior criminal history, often do not.' },
      { offense: 'Disorderly conduct', detail: 'Generally not a CIMT. However, "fighting words" or assault-based disorderly conduct statutes may qualify. Review the specific elements of conviction.' },
    ],
  },
];

const STATUS_SECTIONS = [
  {
    icon: '🛡️',
    title: 'DACA recipients',
    body: 'DACA does not provide a path to permanent status and offers no protection against deportation for significant criminal offenses. DACA termination is automatic for conviction of a felony, a significant misdemeanor (as defined by DHS -- includes domestic violence, sexual abuse, burglary, DUI, unlawful possession of a firearm, and drug offenses), or three or more misdemeanors. A DACA recipient arrested for any offense should consult an immigration attorney immediately -- before any plea is entered.',
    critical: true,
  },
  {
    icon: '🟢',
    title: 'Green card holders (LPRs)',
    body: 'Lawful permanent residents can be deported. Deportation is not automatic for most offenses -- it requires a removal proceeding before an immigration judge. However, certain offenses (aggravated felonies, domestic violence, drug trafficking) trigger mandatory detention and removal with very limited relief. Green card holders should NEVER plead guilty to any offense -- even a misdemeanor -- without consulting an immigration attorney, because the immigration consequences of a "minor" state crime can include permanent deportation.',
    critical: false,
  },
  {
    icon: '📋',
    title: 'Visa holders (temporary status)',
    body: 'Any criminal conviction can result in visa revocation, denial of visa renewal, or denial of re-entry. The State Department can revoke a visa immediately upon notification of a conviction. A visa holder who travels outside the US after a conviction may be denied re-entry. Non-immigrant visa holders have the fewest protections of any immigration status.',
    critical: false,
  },
  {
    icon: '⭐',
    title: 'Naturalization applicants',
    body: 'To naturalize, an applicant must demonstrate "good moral character" for the 5 years before filing (3 years for married-to-citizen applicants). Any criminal conviction in that period is potentially disqualifying. A felony is almost always disqualifying. Multiple misdemeanors, DUI, and offenses involving fraud or moral turpitude can also bar naturalization. Applicants with any criminal history should consult an immigration attorney before filing.',
    critical: false,
  },
  {
    icon: '⚖️',
    title: 'Padilla warnings -- what your criminal attorney owes you',
    body: 'Under Padilla v. Kentucky (2010), the Supreme Court held that criminal defense attorneys must advise non-citizen clients about the immigration consequences of a plea. If your attorney did not warn you about immigration consequences before you pleaded guilty, you may have a claim for ineffective assistance of counsel. This can be grounds to vacate the conviction. Consult both a criminal defense attorney and an immigration attorney immediately.',
    critical: false,
  },
  {
    icon: '🧩',
    title: 'Vacating convictions for immigration purposes',
    body: 'If you were convicted without Padilla warnings, or if new law changes the immigration consequences of your conviction, it may be possible to vacate the conviction through post-conviction relief. This is complex, jurisdiction-specific, and time-sensitive. An immigration attorney and a post-conviction specialist must work together. In some states, specialized clinics handle immigration-related vacaturs.',
    critical: false,
  },
  {
    icon: '📞',
    title: 'Resources',
    body: 'National Immigration Project: nipnlg.org. Immigrant Defense Project: immigrantdefenseproject.org. CLINIC (Catholic Legal Immigration Network): cliniclegal.org. ILRC (Immigrant Legal Resource Center): ilrc.org. Call 211 for local immigration legal aid referrals.',
    critical: false,
  },
];

export default function ImmigrationConsequencesScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = CONSEQUENCE_GROUPS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text style={{ fontSize: 32 }}>🌍</Text>
        <Text style={[styles.headerTitle, { color: colors.bgCard }]}>Immigration & Charges</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]}>Consequences of convictions</Text>
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
  screen:        { flex: 1 },
  scroll:        { padding: 16 },
  header:        { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:    { fontSize: 36, marginBottom: 8 },
  headerTitle:   { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:     { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  alertBox:      { borderRadius: RADIUS.md, borderWidth: 1.5, padding: 12, marginBottom: 14 },
  alertTitle:    { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  alertBody:     { fontSize: 12, lineHeight: 19 },
  tabs:          { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:        { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:      { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  groupHeader:   { borderRadius: RADIUS.sm, borderLeftWidth: 4, padding: 10, marginBottom: 6 },
  groupTitle:    { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  offenseCard:   { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 6 },
  offenseTitle:  { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 5 },
  offenseDetail: { fontSize: 12, lineHeight: 18 },
  statusCard:    { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  statusHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusIcon:    { fontSize: 22 },
  statusTitle:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  statusBody:    { fontSize: 12, lineHeight: 20 },
  cta:           { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:       { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:    { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:{ fontSize: 11, lineHeight: 17, textAlign: 'center' },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});
