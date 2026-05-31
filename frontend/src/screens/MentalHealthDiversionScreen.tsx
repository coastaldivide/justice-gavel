import { AppIcon } from '../components/AppIcon';
/**
 * MentalHealthDiversionScreen -- Mental Health & Criminal Justice Intersection
 *
 * Three-tab approach:
 *   1. Programs -- mental health courts, competency, deferred prosecution
 *   2. Rights -- what a defendant with a mental health condition is entitled to
 *   3. Navigate -- step-by-step guide through mental health court
 *
 * Key legal concepts built in:
 *   - Competency to stand trial (Dusky v. United States)
 *   - Not Guilty by Reason of Insanity (NGRI)
 *   - Guilty but Mentally Ill (GBMI)
 *   - Mental health court structure
 *   - HIPAA protections in court proceedings
 */
import React, { useState, useCallback } from 'react';
import type {} from '../types/navigation';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking } from 'react-native';
import { t }      from '../i18n';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

type Tab = 'programs' | 'rights' | 'navigate';

// ── Program data ──────────────────────────────────────────────────────────────
type Program = {
  name: string;
  icon: string;
  what: string;
  who: string;
  outcome: string;
  howToAccess: string;
};

const PROGRAMS: Program[] = [
  {
    name:        'Mental Health Court',
    icon:        '🏛️',
    what:        'A specialized court docket where judges, prosecutors, defense attorneys, and mental health professionals collaborate on treatment-based alternatives to incarceration. Participants appear before the same judge regularly for accountability and support.',
    who:         'Defendants with diagnosed mental health conditions who are charged with non-violent offenses. Most programs exclude serious violent felonies. A mental health evaluation is required for entry.',
    outcome:     'Charges dismissed or significantly reduced upon successful completion. Participants receive treatment, housing support, medication management, and case management -- with the goal of long-term stability, not just case resolution.',
    howToAccess: 'Ask your attorney to request a mental health screening at arraignment or before. The defense can raise mental health as a factor at any point. Many courts have a mental health public defender or court liaison who coordinates referrals.',
  },
  {
    name:        'Competency Evaluation',
    icon:        '🧠',
    what:        'A formal evaluation to determine whether a defendant can understand the charges against them and assist in their own defense. Required before trial if there is reason to believe the defendant lacks this ability. Based on Dusky v. United States, 362 U.S. 402 (1960).',
    who:         'Any defendant who appears unable to understand court proceedings or communicate meaningfully with their attorney. The defense attorney, the prosecutor, or the judge can raise competency at any time.',
    outcome:     'If found incompetent, the defendant cannot be tried. They are referred to a competency restoration program -- usually inpatient or outpatient psychiatric treatment. When restored to competency, the case resumes. If restoration is impossible, charges may be dismissed.',
    howToAccess: 'Tell your attorney if you or your loved one is having difficulty understanding the proceedings or communicating. The attorney can file a motion for competency evaluation at any time. This is one of the most important protections in the criminal justice system.',
  },
  {
    name:        'Competency Restoration',
    icon:        '📋',
    what:        'A structured treatment program designed to help a defendant understand the legal process and regain the ability to assist in their defense. Can be inpatient (in a psychiatric facility) or outpatient (in the community). Duration varies by state and by the defendant\'s progress.',
    who:         'Defendants found incompetent to stand trial. Priority given to defendants facing more serious charges, but all defendants have the right to competency restoration before trial.',
    outcome:     'Most defendants are restored to competency. Once restored, the case resumes from where it stopped. Time in restoration may or may not count toward any eventual sentence depending on state law.',
    howToAccess: 'Triggered by a finding of incompetency. The court orders the evaluation. The defendant and family should work with the attorney to identify the least restrictive restoration setting possible.',
  },
  {
    name:        'Deferred Prosecution (Mental Health)',
    icon:        '⏸️',
    what:        'The prosecutor agrees to pause or not file charges in exchange for the defendant completing a mental health treatment program. Different from mental health court in that it typically involves no formal court supervision -- the agreement is between the prosecutor and defense attorney.',
    who:         'Defendants with diagnosed mental health conditions charged with minor to moderate offenses, particularly first-time offenders. The prosecutor has full discretion to offer or decline deferred prosecution.',
    outcome:     'Charges are never filed or are dismissed upon completion of treatment. No conviction on the record. Often the cleanest resolution available for defendants with mental health conditions.',
    howToAccess: 'Raise mental health issues with your attorney immediately. The earlier deferred prosecution is requested -- ideally before charges are filed -- the more likely it is to succeed. A mental health evaluation and treatment plan strengthens the request.',
  },
  {
    name:        'Not Guilty by Reason of Insanity (NGRI)',
    icon:        '⚖️',
    what:        'A complete defense to criminal charges based on the defendant\'s mental state at the time of the offense. The standard varies by state but generally requires that the defendant either did not understand the nature of their actions or did not understand that their actions were wrong due to a mental disease or defect.',
    who:         'Defendants with severe mental illness who were in a psychotic or otherwise significantly impaired state at the time of the offense. Rarely used -- accounts for less than 1% of criminal cases. Almost always requires expert testimony from a forensic psychiatrist.',
    outcome:     'If successful, the defendant is not guilty and not sentenced. However, most states commit NGRI defendants to a secure psychiatric facility, sometimes for longer than a prison sentence would have been. This is a strategic decision that requires careful evaluation with an experienced attorney.',
    howToAccess: 'Only available through an experienced criminal defense attorney with access to forensic psychiatric experts. Do not attempt to raise this defense without expert legal and psychiatric support.',
  },
  {
    name:        'Guilty but Mentally Ill (GBMI)',
    icon:        '📝',
    what:        'A verdict in some states where the defendant is found guilty but the court acknowledges their mental illness. The defendant receives a criminal sentence but with a requirement that mental health treatment be provided. Available in about half of US states.',
    who:         'Defendants whose mental illness is established but who do not meet the high bar for NGRI. Often used when jurors want to acknowledge mental illness without fully acquitting.',
    outcome:     'A criminal conviction with (in theory) a requirement for mental health treatment during incarceration. Critics note that treatment mandates are often not adequately funded or enforced. This outcome carries the collateral consequences of a conviction.',
    howToAccess: 'Discussed with the defense attorney as part of plea negotiations or trial strategy. May be offered by the prosecution as an alternative to going to trial on a NGRI defense.',
  },
];

// ── Rights sections ───────────────────────────────────────────────────────────
const RIGHTS = [
  {
    heading: 'Right to a competency evaluation',
    body:    'The Constitution prohibits trying an incompetent defendant. Under Dusky v. United States (1960), you have the right to a competency evaluation if there is reason to believe you cannot understand the charges or assist in your defense. Your attorney can request this at any time -- and should if there is any doubt.',
    icon:    '🧠',
  },
  {
    heading: 'Right to raise mental health as a defense',
    body:    'Mental health evidence can be introduced to challenge intent (mens rea), support an insanity defense, or as mitigating evidence at sentencing. An experienced defense attorney knows when and how to raise mental health evidence most effectively.',
    icon:    '⚖️',
  },
  {
    heading: 'Right to treatment while in custody',
    body:    'Defendants in custody have a constitutional right to adequate mental health care. Estelle v. Gamble (1976) established that deliberate indifference to serious medical needs -- including psychiatric needs -- violates the Eighth Amendment. If mental health care is being denied or is inadequate, this must be raised immediately.',
    icon:    '💊',
  },
  {
    heading: 'HIPAA protections in court proceedings',
    body:    'Medical and psychiatric records are protected by HIPAA. A defendant generally must consent to the release of mental health records. However, if a defendant raises a mental health defense, they may waive some privacy protections for records relevant to that defense. Discuss with your attorney before consenting to any records release.',
    icon:    '🔒',
  },
  {
    heading: 'Right to the least restrictive alternative',
    body:    'When mental health treatment is ordered, the defendant has the right to the least restrictive setting that meets their treatment needs. Inpatient commitment should only be ordered when outpatient treatment is insufficient. Advocate for community-based treatment whenever possible.',
    icon:    '🌱',
  },
  {
    heading: 'Medication rights',
    body:    'A defendant cannot be forcibly medicated solely to make them competent to stand trial without a court order following specific procedures. Sell v. United States (2003) established that the government must meet a high standard before ordering involuntary medication. Discuss medication issues with your attorney immediately.',
    icon:    '💉',
  },
  {
    heading: 'Family involvement rights',
    body:    'Family members cannot access a defendant\'s mental health records without consent -- even in the context of a criminal case. Family can, however, provide important information to the defense attorney, testify as witnesses at sentencing or competency hearings, and advocate for treatment-based alternatives.',
    icon:    '👨‍👩‍👧',
  },
];

// ── Navigation steps ──────────────────────────────────────────────────────────
type NavStep = { title: string; action: string; who: string; timing: string; tip: string };
const NAV_STEPS: NavStep[] = [
  {
    title:  'Raise mental health at first appearance',
    action: 'At the very first court date, the defense attorney should notify the court that mental health issues may be relevant. This does not have to be detailed -- it puts the court on notice and preserves options.',
    who:    'Defense attorney raises it. You tell your attorney in advance.',
    timing: 'Arraignment or first appearance -- as early as possible.',
    tip:    'The earlier mental health is raised, the more options are available. Waiting until trial severely limits what can be done.',
  },
  {
    title:  'Request a mental health evaluation',
    action: 'The defense attorney files a motion for a mental health evaluation -- either for competency or to explore possible defenses. The court appoints a forensic evaluator (psychiatrist or psychologist).',
    who:    'Defense attorney files the motion. The evaluator is court-appointed.',
    timing: 'Before the preliminary hearing if possible. Can be requested at any time.',
    tip:    'Be honest with the evaluator. The evaluation is not the time for strategy -- it is the time for accurate information about your mental health history and current state.',
  },
  {
    title:  'Gather mental health history',
    action: 'Compile all mental health records -- prior diagnoses, hospitalizations, medications, therapy history, disability documentation. This evidence supports any mental health defense or diversion request.',
    who:    'You and your family gather records. Attorney requests records with signed release.',
    timing: 'As soon as possible after arrest. Records take time to obtain.',
    tip:    'Prior hospitalizations, especially involuntary commitments, are important evidence. Do not assume past mental health history is irrelevant -- it almost always matters.',
  },
  {
    title:  'Apply for mental health court or diversion',
    action: 'The defense attorney submits a referral to mental health court or requests deferred prosecution from the prosecutor. A treatment plan is often required as part of the application.',
    who:    'Defense attorney makes the referral. The defendant and family provide supporting documentation.',
    timing: 'Before arraignment or at arraignment if possible. Some programs have application windows.',
    tip:    'A letter from a psychiatrist or therapist explaining the diagnosis and recommending treatment significantly strengthens the application. If you have a current treatment provider, involve them.',
  },
  {
    title:  'Appear consistently in mental health court',
    action: 'Mental health court requires regular appearances -- often weekly or bi-weekly at first. The judge monitors treatment compliance, medication adherence, housing stability, and sobriety (if applicable).',
    who:    'The defendant must appear in person. Family members can attend for support.',
    timing: 'Ongoing throughout the program -- typically 12 to 24 months.',
    tip:    'Consistent court appearances are non-negotiable. A missed court date can result in a bench warrant even in mental health court. If there is a crisis, notify the case manager immediately.',
  },
  {
    title:  'Maintain treatment compliance',
    action: 'Complete all required treatment -- medication, therapy, group programs, drug testing (if required), and any other conditions of the mental health court order.',
    who:    'The defendant. Case managers and treatment providers monitor compliance.',
    timing: 'Daily compliance required throughout the program.',
    tip:    'Report any problems with treatment immediately -- side effects, scheduling conflicts, access issues. Mental health courts are designed to problem-solve, not punish, when participants communicate honestly.',
  },
  {
    title:  'Graduation and case resolution',
    action: 'Upon successful completion of mental health court, the judge dismisses the charges or reduces them per the agreement. A graduation ceremony in many courts is a formal acknowledgment of the work done.',
    who:    'Judge makes the final order. Defense attorney ensures the dismissal is properly documented.',
    timing: 'At completion of the program -- typically 12 to 24 months from entry.',
    tip:    'Get the dismissal order in writing. Keep it. You will need it to respond to background check questions and to pursue record sealing or expungement.',
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function MentalHealthDiversionScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = RIGHTS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="mental-health-diversion-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text style={{ fontSize: 32 }}>🧠</Text>
        <Text style={[styles.headerTitle, { color: colors.bgCard }]}>Mental Health Diversion</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]}>Diversion programs & rights</Text>
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

const WHITE = COLORS.bgCard;

const makeStyles = (colors: any) => StyleSheet.create({
  screen:           { flex: 1 },
  scroll:           { padding: 16 },
  header:           { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:       { fontSize: 36, marginBottom: 8 },
  headerTitle:      { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:        { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  crisisBanner:     { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14, alignItems: 'center' },
  crisisBannerText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', textAlign: 'center' },
  tabs:             { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:           { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:         { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  infoBox:          { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14 },
  infoBoxText:      { color: colors.steel, fontSize: 12, lineHeight: 19 },
  programCard:      { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  programHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  programIcon:      { fontSize: 22 },
  programName:      { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  programChevron:   { fontSize: 12 },
  programBody:      { marginTop: 14 },
  bodyLabel:        { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.8, marginBottom: 5, marginTop: 12 },
  bodyText:         { fontSize: 12, lineHeight: 20 },
  howBox:           { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginTop: 12 },
  howLabel:         { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  ctaBtn:           { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 10, marginBottom: 6 },
  ctaBtnText:       { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  rightCard:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  rightCardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rightCardIcon:    { fontSize: 22 },
  rightCardTitle:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  rightCardBody:    { fontSize: 12, lineHeight: 20 },
  stepScroll:       { marginBottom: 12 },
  stepScrollContent:{ gap: 8, paddingBottom: 4 },
  stepPill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, gap: 6 },
  stepPillNum:      { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', width: 16, textAlign: 'center' },
  stepPillLabel:    { fontSize: 12, fontWeight: '700', maxWidth: 90 },
  stepCard:         { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  stepCardHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepNumBadge:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepNumBadgeText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepCardTitle:    { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepNav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  stepNavBtn:       { padding: 8 },
  stepNavLabel:     { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  stepNavCount:     { fontSize: 12 },
  disclaimer:       { borderTopWidth: 1, paddingTop: 12, marginTop: 8, marginBottom: 8 },
  disclaimerText:   { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});
