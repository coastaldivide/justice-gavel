/**
 * JuvenileJusticeScreen -- Juvenile Justice Rights & Navigation
 *
 * Covers the full juvenile justice arc:
 *   1. Rights card -- what a juvenile and their parents need to know
 *   2. What happens next -- detention hearing → adjudication → disposition → sealing
 *   3. Juvenile record sealing -- dramatically more favorable than adult expungement
 *
 * Key legal distinctions built in:
 *   - Parental notification rights
 *   - No public record (in most states)
 *   - Different terminology (adjudicated delinquent, not convicted)
 *   - Miranda applies but with extra protections for juveniles
 *   - Automatic sealing timelines by state
 */
import React, { useState, useCallback } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { t }      from '../i18n';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'rights' | 'process' | 'sealing';

type ProcessStep = {
  title: string;
  timeline: string;
  what: string;
  rights: string;
  tip: string;
};

// ── Juvenile process steps ────────────────────────────────────────────────────
const PROCESS_STEPS: ProcessStep[] = [
  {
    title:    'Arrest or Contact',
    timeline: 'Immediate',
    what:     'A juvenile can be taken into custody by police for a delinquent act (crime) or status offense (truancy, curfew, running away). Police must notify parents or guardians promptly -- usually within a few hours.',
    rights:   'Miranda warnings apply to juveniles. A juvenile has the right to remain silent and the right to an attorney. In most states, a juvenile cannot waive Miranda rights without a parent or attorney present.',
    tip:      'The most important thing a juvenile can do: say "I want my parent and a lawyer." Nothing else. Do not explain, justify, or apologize.',
  },
  {
    title:    'Intake & Decision',
    timeline: 'Within 24-72 hours',
    what:     'A probation officer or intake officer reviews the case. They can: release with a warning, release to parents with conditions, refer to diversion, or refer to court. Many cases end here -- especially first offenses.',
    rights:   'Parents have the right to be present during intake questioning. The juvenile has the right to an attorney at all stages.',
    tip:      'Cooperating with intake does not mean answering questions about the offense. It means being respectful and present. The attorney speaks for the juvenile.',
  },
  {
    title:    'Detention Hearing',
    timeline: 'Within 24-72 hours if held',
    what:     'If the juvenile is held in detention (juvenile hall), a detention hearing must happen quickly -- usually within 24 to 72 hours. The judge decides whether detention continues or the juvenile is released to parents.',
    rights:   'The right to an attorney applies at the detention hearing. This is In re Gault (1967) -- the Supreme Court established that juveniles have due process rights in juvenile court. Bail is not typically used in juvenile court; release is to parental custody.',
    tip:      'The detention hearing is the first opportunity for an attorney to argue for release. A prepared attorney who knows the family situation significantly increases the odds of release.',
  },
  {
    title:    'Petition & Arraignment',
    timeline: 'Days to weeks after arrest',
    what:     'The prosecutor (or in some states the probation department) files a petition alleging the juvenile is delinquent. The juvenile enters an admission (equivalent to guilty plea) or denial (equivalent to not guilty). This is NOT a criminal complaint -- it is a petition in juvenile court.',
    rights:   'The juvenile has the right to deny the petition and contest it at an adjudicatory hearing. No jury trial in most states -- a judge decides.',
    tip:      'The language is different. The juvenile is not "convicted" -- they are "adjudicated delinquent." This distinction matters enormously for record sealing.',
  },
  {
    title:    'Adjudicatory Hearing',
    timeline: 'Weeks to months after petition',
    what:     'This is the juvenile equivalent of a trial. A judge (not a jury in most states) hears evidence and decides whether the juvenile committed the alleged offense. The standard is still "beyond a reasonable doubt."',
    rights:   'Full due process rights apply: right to notice of charges, right to an attorney, right to confront and cross-examine witnesses, right against self-incrimination. Established by In re Gault, 387 U.S. 1 (1967).',
    tip:      'Hearings are typically closed to the public. Court records are confidential in most states. This is a fundamental difference from adult court.',
  },
  {
    title:    'Disposition Hearing',
    timeline: 'Follows adjudication',
    what:     'If adjudicated delinquent, the judge holds a disposition hearing to determine consequences. Options range from informal probation to commitment to a juvenile facility. The court considers the juvenile\'s best interest -- rehabilitation, not punishment.',
    rights:   'The right to present mitigating evidence. Probation reports are used -- the juvenile and family can challenge inaccuracies.',
    tip:      'Disposition is where the attorney\'s work matters most. Community ties, school performance, family support, and demonstrated remorse all influence the outcome. A good attorney presents all of it.',
  },
  {
    title:    'Record Sealing',
    timeline: 'At completion or age 18-21',
    what:     'Juvenile records are confidential in most states and can be sealed -- meaning the record is hidden from background checks and the public. In many states this happens automatically. In others it requires a petition.',
    rights:   'Sealed records cannot be used against the individual in most circumstances. In most states, after sealing, the individual can lawfully answer "no" when asked if they have been arrested or convicted.',
    tip:      'See the Sealing tab for state-by-state details. Many juveniles and their families do not know records can be sealed. This is one of the most important things an attorney can do after disposition.',
  },
];

// ── Rights sections ───────────────────────────────────────────────────────────
const RIGHTS_SECTIONS = [
  {
    heading: 'You have the right to remain silent',
    body:    'Miranda warnings apply to juveniles. A minor cannot waive Miranda rights in many states without a parent or attorney present. Say: "I want my parent and a lawyer." Do not answer questions about the offense -- even if it feels like helping.',
    icon:    '🤫',
  },
  {
    heading: 'Your parent must be notified',
    body:    'Police must notify a parent or legal guardian promptly after taking a juvenile into custody. Most states require notification within a few hours. If no parent can be reached, a guardian or child protective services must be contacted.',
    icon:    '👨‍👩‍👧',
  },
  {
    heading: 'You have the right to an attorney',
    body:    'In re Gault (1967) -- the Supreme Court ruled that juveniles have the right to an attorney in delinquency proceedings. If you cannot afford one, the court must appoint a public defender. Exercise this right before answering any questions.',
    icon:    '⚖️',
  },
  {
    heading: 'Your records are confidential',
    body:    'Juvenile court records are not public in most states. Hearings are closed. Records are kept separate from adult criminal records. This is one of the most important protections in the juvenile system -- guard it by not discussing your case publicly.',
    icon:    '🔒',
  },
  {
    heading: 'You are not "convicted"',
    body:    'The terminology is different and it matters. In juvenile court you are not "arrested" (you are "taken into custody"), not "convicted" (you are "adjudicated delinquent"), and not sentenced (you receive a "disposition"). These distinctions affect your ability to seal your record later.',
    icon:    '📋',
  },
  {
    heading: 'You can still be tried as an adult',
    body:    'For serious offenses, prosecutors can transfer a case to adult court. This is called a "transfer," "waiver," or "certification." In adult court you lose juvenile protections. An attorney must fight any transfer motion immediately -- it is one of the most consequential decisions in the case.',
    icon:    '⚠️',
  },
  {
    heading: 'Rehabilitation is the goal',
    body:    'The juvenile justice system is designed for rehabilitation, not punishment. Courts consider the juvenile\'s best interest. Probation, counseling, community service, and education programs are the most common outcomes -- not incarceration. Use this to your advantage.',
    icon:    '🌱',
  },
  {
    heading: 'Your future is the priority',
    body:    'A juvenile adjudication does not have to define your life. Most juvenile records can be sealed. Diversion programs exist for first offenses. Mental health and substance abuse treatment are available through the court. An experienced juvenile defense attorney knows how to protect your future at every stage.',
    icon:    '🏆',
  },
];

// ── Sealing data ──────────────────────────────────────────────────────────────
type SealingEntry = { state: string; automatic: boolean; when: string; notes: string };
const SEALING_DATA: SealingEntry[] = [
  { state:'AL', automatic:false, when:'Age 18 + petition required',    notes:'Misdemeanor adjudications only. Felonies require waiting period.' },
  { state:'AK', automatic:false, when:'Age 18 + 2 years offense-free', notes:'Petition to court. All charges must be included.' },
  { state:'AZ', automatic:false, when:'Age 18 + petition',             notes:'Superior court petition. Fee waiver available.' },
  { state:'AR', automatic:false, when:'Age 21 or 5 years post-disposition', notes:'Petition required. Violent offenses excluded.' },
  { state:'CA', automatic:true,  when:'Age 18 (most offenses)',        notes:'Automatic sealing under AB 1076. Some serious offenses require petition.' },
  { state:'CO', automatic:true,  when:'Age 18 or upon completion',     notes:'Broad automatic sealing. Petition available for earlier sealing.' },
  { state:'CT', automatic:true,  when:'Age 18',                        notes:'Records erased automatically for most offenses.' },
  { state:'DE', automatic:false, when:'Age 18 + petition',             notes:'Must be offense-free since adjudication.' },
  { state:'FL', automatic:false, when:'Age 21 + petition',             notes:'Petition required. Certain serious offenses ineligible.' },
  { state:'GA', automatic:false, when:'Age 21 or 4 years post-completion', notes:'Petition to juvenile court. Fee required.' },
  { state:'HI', automatic:true,  when:'Age 18',                        notes:'Records sealed automatically for most misdemeanor-equivalent offenses.' },
  { state:'ID', automatic:false, when:'Age 18 + petition',             notes:'Petition to juvenile court. Some offenses excluded.' },
  { state:'IL', automatic:true,  when:'Age 18 (minor offenses)',       notes:'Automatic expungement for minor offenses. Petition for others.' },
  { state:'IN', automatic:false, when:'Age 18 or 1 year post-case',    notes:'Petition required. Restricted access, not full sealing.' },
  { state:'IA', automatic:false, when:'Age 18',                        notes:'Records are confidential but not automatically expunged. Petition available.' },
  { state:'KS', automatic:false, when:'Age 18 or 2 years post-discharge', notes:'Petition to district court.' },
  { state:'KY', automatic:false, when:'Age 18 + 2 years offense-free', notes:'Petition required. Felony-equivalent offenses may be excluded.' },
  { state:'LA', automatic:false, when:'Age 17 (in LA, adulthood) + petition', notes:'Louisiana raised adult age to 18 in 2020. Petition to juvenile court.' },
  { state:'ME', automatic:false, when:'Age 18 + 3 years',              notes:'Petition to district court. Class A offenses excluded.' },
  { state:'MD', automatic:true,  when:'Age 18 (most offenses)',        notes:'Broad automatic expungement. Petition for earlier action.' },
  { state:'MA', automatic:true,  when:'Age 18 (most offenses)',        notes:'Records sealed automatically. Some serious offenses remain.' },
  { state:'MI', automatic:false, when:'Age 17 + petition',             notes:'Petition to family court. Good standing required.' },
  { state:'MN', automatic:true,  when:'Upon completion of sentence',   notes:'One of the most favorable states. Automatic expungement for most offenses.' },
  { state:'MS', automatic:false, when:'Age 18 + petition',             notes:'Petition to youth court. Limited offenses eligible.' },
  { state:'MO', automatic:false, when:'Age 17 or petition at any time', notes:'Records confidential. Petition for expungement available.' },
  { state:'MT', automatic:false, when:'Age 18 + petition',             notes:'Youth court petition. Felony-equivalent excluded.' },
  { state:'NE', automatic:false, when:'Age 17 or 3 years post-discharge', notes:'Petition to separate juvenile court system.' },
  { state:'NV', automatic:true,  when:'Age 21 or 3 years post-completion', notes:'Automatic sealing if no subsequent offenses.' },
  { state:'NH', automatic:false, when:'Age 17 + petition',             notes:'Petition to district court. Annual sealing windows.' },
  { state:'NJ', automatic:true,  when:'Age 19 or 5 years post-completion', notes:'Automatic expungement for most adjudications.' },
  { state:'NM', automatic:false, when:'Age 18 + 1 year offense-free',  notes:'Children\'s court petition. Broad eligibility.' },
  { state:'NY', automatic:true,  when:'Age 18 (eligible youth)',       notes:'Youthful Offender (YO) designation seals records. Apply through attorney.' },
  { state:'NC', automatic:false, when:'Age 18 + petition',             notes:'District court petition. Nonviolent misdemeanor-equivalent only.' },
  { state:'ND', automatic:false, when:'Age 18 or 2 years post-completion', notes:'Petition to juvenile court.' },
  { state:'OH', automatic:false, when:'Age 18 + 2 years offense-free', notes:'Juvenile court petition. Sealing, not expungement -- still accessible to courts.' },
  { state:'OK', automatic:false, when:'Age 18 + petition',             notes:'Juvenile court petition. First offense non-violent recommended.' },
  { state:'OR', automatic:true,  when:'Age 18 (most offenses)',        notes:'Broad automatic expungement. Measure 11 offenses excluded.' },
  { state:'PA', automatic:false, when:'Age 18 + petition or age 21',   notes:'Petition to juvenile court. Act 91 (2016) expanded access.' },
  { state:'RI', automatic:true,  when:'Age 18 (most offenses)',        notes:'Automatic expungement. Petition for serious offenses.' },
  { state:'SC', automatic:false, when:'Age 18 or 5 years post-completion', notes:'Family court petition. Limited serious offenses excluded.' },
  { state:'SD', automatic:false, when:'Age 18 + 1 year offense-free',  notes:'Circuit court petition.' },
  { state:'TN', automatic:false, when:'Age 17 or petition after completion', notes:'Juvenile court petition. T.C.A. § 37-1-153. Broad eligibility for first offenses.' },
  { state:'TX', automatic:false, when:'Age 17 or petition at 21',      notes:'Petition to juvenile court. Fam. Code § 58.003. Determinate sentence offenses excluded.' },
  { state:'UT', automatic:true,  when:'Age 18 or 5 years post-adjudication', notes:'Automatic expungement for most. Petition for serious offenses.' },
  { state:'VT', automatic:true,  when:'Age 18 (most offenses)',        notes:'Records expunged automatically. Strongest protections in New England.' },
  { state:'VA', automatic:false, when:'Age 19 + 5 years offense-free', notes:'Circuit court petition. § 16.1-306. Good standing required.' },
  { state:'WA', automatic:true,  when:'Upon completion (most offenses)', notes:'Some of the broadest automatic sealing in the US.' },
  { state:'WV', automatic:false, when:'Age 18 + petition',             notes:'Circuit court petition. First offense most likely to succeed.' },
  { state:'WI', automatic:false, when:'Age 17 + petition',             notes:'Circuit court petition. Expunged, not sealed -- more complete.' },
  { state:'WY', automatic:false, when:'Age 19 + 2 years offense-free', notes:'District court petition.' },
  { state:'DC', automatic:true,  when:'Age 21 or 2 years post-completion', notes:'Broad automatic sealing. Petition for earlier action.' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function JuvenileJusticeScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = RIGHTS_SECTIONS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 32 }}>⚖️</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.bgCard }]}>Juvenile Justice</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>Rights in the juvenile system</Text>
      </View>

      {/* Section cards */}
      {allSections.map((sec: any, idx: number) => (
        <View key={idx} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {sec.title ? <Text maxFontSizeMultiplier={1.4} style={[styles.cardTitle, { color: colors.textPrimary }]}>{sec.title}</Text> : null}
          {sec.body  ? <Text maxFontSizeMultiplier={1.4} style={[styles.cardBody,  { color: colors.textMuted  }]}>{sec.body}</Text>  : null}
          {sec.steps ? sec.steps.map((step: string, si: number) => (
            <Text maxFontSizeMultiplier={1.4} key={si} style={[styles.cardBody, { color: colors.textMuted }]}>• {step}</Text>
          )) : null}
        </View>
      ))}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimerText, { color: colors.textFaint }]}>
          This information is for general education only and is not legal advice.
          Laws vary by state. Consult a licensed attorney for advice about your situation.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:           { flex: 1 },
  scroll:           { padding: 16 },
  header:           { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:       { fontSize: 36, marginBottom: 8 },
  headerTitle:      { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:        { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  tabs:             { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:           { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:         { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  infoBox:          { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14 },
  infoBoxText:      { color: colors.steel, fontSize: 12, lineHeight: 19 },
  rightCard:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  rightCardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rightCardIcon:    { fontSize: 22 },
  rightCardTitle:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  rightCardBody:    { fontSize: 12, lineHeight: 20 },
  ctaBtn:           { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 10, marginBottom: 6 },
  ctaBtnText:       { color: COLORS.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepScroll:       { marginBottom: 12 },
  stepScrollContent:{ gap: 8, paddingBottom: 4 },
  stepPill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, gap: 6 },
  stepPillNum:      { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', width: 16, textAlign: 'center' },
  stepPillLabel:    { fontSize: 12, fontWeight: '700', maxWidth: 90 },
  stepCard:         { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  stepCardHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepNumBadge:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepNumBadgeText: { color: COLORS.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepCardTitle:    { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 2 },
  stepTimeline:     { fontSize: 12 },
  stepSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  stepBody:         { fontSize: 12, lineHeight: 20 },
  rightsBlock:      { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 4 },
  tipBlock:         { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginTop: 8 },
  tipLabel:         { color: colors.legal, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  stepNav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  stepNavBtn:       { padding: 8 },
  stepNavLabel:     { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  stepNavCount:     { fontSize: 12 },
  filterRow:        { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterChip:       { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1 },
  filterChipText:   { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  sealingRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 8 },
  stateBadge:       { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  stateBadgeText:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_900Black', fontWeight: '900' },
  sealingRowTop:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  autoChip:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  autoChipText:     { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  sealingWhen:      { fontSize: 12, fontWeight: '600', flex: 1 },
  sealingNotes:     { fontSize: 12, lineHeight: 17 },
  disclaimer:       { borderTopWidth: 1, paddingTop: 12, marginTop: 8, marginBottom: 8 },
  disclaimerText:   { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});
