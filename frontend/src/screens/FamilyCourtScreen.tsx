/**
 * FamilyCourtScreen -- Family Court Navigation Guide
 *
 * Three-tab layout matching existing civil screens:
 *   1. Custody & Visitation -- types, how courts decide, what to do
 *   2. Protective Orders    -- emergency vs permanent, how to get one
 *   3. Child Support        -- how it's calculated, modification, enforcement
 *
 * Fully static. Works offline. No API calls.
 * Criminal record implications noted throughout -- the intersection
 * this population actually faces.
 */
import { api } from '../services/api';
import React, { useState, useCallback } from 'react';

import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator} from 'react-native';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

type Tab = 'custody' | 'orders' | 'support';

const CUSTODY_SECTIONS = [
  {
    icon: '⚖️',
    title: 'Types of custody',
    body: 'Legal custody is the right to make major decisions about a child\'s education, healthcare, and religion. Physical custody is where the child lives. Both can be sole (one parent) or joint (shared). Courts strongly prefer joint legal custody when both parents are fit -- sole legal custody requires evidence the other parent is unfit or unavailable.',
  },
  {
    icon: '🧒',
    title: 'How courts decide',
    body: 'Every state uses "best interest of the child" as the standard. Courts consider: the child\'s relationship with each parent, each parent\'s ability to provide stability, the child\'s adjustment to home and school, any history of domestic violence or abuse, and in many states the child\'s own preference (usually considered at age 12-14). There is no presumption favoring mothers over fathers in any state.',
  },
  {
    icon: '🔒',
    title: 'Criminal record and custody',
    body: 'A criminal record does not automatically disqualify a parent from custody. Courts look at the nature of the offense, how long ago it occurred, evidence of rehabilitation, and whether the offense involved violence or child endangerment. A domestic violence conviction is the most significant factor -- courts take it very seriously and may impose supervised visitation or limit contact. Drug offenses may trigger drug testing requirements. Non-violent, older offenses carry far less weight.',
  },
  {
    icon: '📋',
    title: 'Emergency custody',
    body: 'If a child is in immediate danger, either parent can request an emergency custody order (ex parte order) -- a temporary order issued without the other parent present. The requesting parent must show immediate harm. Emergency orders are temporary and require a full hearing, usually within 14-21 days, where both parents can present their case.',
  },
  {
    icon: '✏️',
    title: 'Modifying a custody order',
    body: 'Once a custody order is in place, it can only be modified by showing a substantial change in circumstances -- a significant change in the child\'s needs or a parent\'s situation. Moving to a new state, a parent\'s incarceration, a significant change in the child\'s school or health needs, and evidence of abuse all qualify. Routine disagreements between parents do not.',
  },
  {
    icon: '🏛️',
    title: 'Representing yourself',
    body: 'You have the right to represent yourself in family court (pro se). Many courthouses have self-help centers with forms and guidance. However, if the other parent has an attorney and the stakes involve custody of your children, getting at least a one-hour consultation with a family law attorney before your first hearing is strongly recommended. The decisions made in early hearings often set the pattern for years.',
  },
  {
    icon: '📞',
    title: 'If you cannot afford an attorney',
    body: 'Legal aid organizations provide free or low-cost family law help in every state. Income-qualified applicants can get full representation. Law school family law clinics also take cases. Domestic violence organizations often have staff attorneys for protective order cases. Call 211 from any phone to reach local legal aid referrals.',
  },
];

// const ORDERS_SECTIONS = [  // unused
//   {
//     icon: '🚨',
//     title: 'Emergency protective order (EPO)',
//     body: 'Issued by police on the scene -- usually the same night as an incident. Lasts 3-7 days. Requires no court hearing. If you have been assaulted or threatened and police respond, ask the officer for an EPO before they leave. This automatically gets you into court within a week for a longer order.',
//   },
//   {
//     icon: '📋',
//     title: 'Temporary restraining order (TRO)',
//     body: 'Filed at the courthouse, usually the same day or next business day. A judge reviews your written declaration without the other person present (ex parte). If granted, the TRO typically lasts 20-25 days until the full hearing. You do not need a police report to file a TRO -- your sworn statement is sufficient.',
//   },
//   {
//     icon: '⚖️',
//     title: 'Permanent protective order',
//     body: 'Issued after a full court hearing where both parties can present evidence. Despite the name, "permanent" usually means 1-5 years, renewable. The order can include: no contact provisions, stay-away distances, move-out orders (requiring abuser to leave shared home), custody and visitation terms, and firearm surrender requirements.',
//   },
//   {
//     icon: '📝',
//     title: 'How to file',
//     body: 'Go to the family court or civil court clerk\'s office. Ask for the protective order packet. Fill out the petition describing specific incidents with dates, locations, and what was said or done. Be specific -- vague descriptions like "he was threatening" are weaker than "on [date] at [location] he said he would kill me and showed me a knife." File for free -- there is no filing fee for domestic violence protective orders in any state.',
//   },
//   {
//     icon: '🔒',
//     title: 'What a protective order covers',
//     body: 'A protective order can protect you, your children, other family members, and even your pets. It can prohibit all contact (phone, text, email, through third parties), require the abuser to stay a specific distance from your home, workplace, and children\'s school, and require surrender of firearms. Violation of a protective order is a crime -- call 911 immediately if the order is violated.',
//   },
//   {
//     icon: '⚠️',
//     title: 'If you have a criminal record',
//     body: 'Your criminal history does not affect your right to obtain a protective order as a victim. Courts issue protective orders based on what the respondent did to you, not your history. However, if there are active custody proceedings, the protective order will affect custody and visitation arrangements.',
//   },
//   {
//     icon: '🌐',
//     title: 'National resources',
//     body: 'National Domestic Violence Hotline: 1-800-799-7233 (TTY: 1-800-787-3224). Text START to 88788. WomensLaw.org has state-specific protective order information for all 50 states. Law enforcement, hospitals, and domestic violence shelters can all help connect you to emergency protective order processes.',
//   },
// ];

// const SUPPORT_SECTIONS = [  // unused
//   {
//     icon: '🧮',
//     title: 'How child support is calculated',
//     body: 'Every state uses a formula. Most states use an income shares model -- both parents\' incomes are combined, the total child support obligation is calculated based on the combined income and number of children, then each parent pays their proportional share. The parent who pays child support (the non-custodial parent) typically pays their share to the other parent. Calculators are available on every state\'s family court website.',
//   },
//   {
//     icon: '💼',
//     title: 'Income and unemployment',
//     body: 'If you are unemployed or underemployed, courts will often impute income -- calculate support based on what you could earn, not what you currently earn. This is based on your work history, education, and local job market. If you are genuinely unable to work due to incarceration, disability, or documented job loss, this can be presented. Self-employed income is harder to hide than many believe -- courts look at tax returns, bank statements, and lifestyle.',
//   },
//   {
//     icon: '🔒',
//     title: 'Child support and criminal record',
//     body: 'If you are incarcerated, you are still legally obligated to pay child support unless you petition the court for a modification. Arrears (unpaid support) accumulate during incarceration in most states. Some states automatically suspend support during incarceration -- most do not. File a modification petition immediately upon incarceration. The court can set a nominal amount ($0 or minimal) until release. Failure to do this results in large arrears that are very difficult to discharge.',
//   },
//   {
//     icon: '📝',
//     title: 'Modifying a support order',
//     body: 'Child support can be modified when there is a substantial change in circumstances -- typically a 15-25% change in income, a significant change in the child\'s needs, or a change in custody arrangement. Either parent can request a modification. File promptly -- modifications are rarely retroactive. If you lose your job, file for modification the same week, not months later.',
//   },
//   {
//     icon: '⚠️',
//     title: 'Non-payment consequences',
//     body: 'Unpaid child support is treated very seriously. Consequences include: driver\'s license suspension, professional license suspension, passport denial, tax refund interception, bank account levy, wage garnishment, and ultimately contempt of court which can result in jail. None of these consequences are suspended during a pending modification -- file the modification first.',
//   },
//   {
//     icon: '📞',
//     title: 'Getting help',
//     body: 'Every state has a Child Support Enforcement (CSE) agency -- free service that helps establish, enforce, and modify support orders. If you are the custodial parent trying to collect, contact your state\'s CSE agency. If you are the paying parent who needs a modification, consult a family law attorney or your county\'s self-help center.',
//   },
// ];

export default function FamilyCourtScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = CUSTODY_SECTIONS;
  const _section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 32 }}>⚖️</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.bgCard }]}>Family Court</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>Custody, support & orders</Text>
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
  screen:          { flex: 1 },
  scroll:          { padding: 16 },
  header:          { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:      { fontSize: 36, marginBottom: 8 },
  headerTitle:     { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:       { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  tabs:            { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  tabBtn:          { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  offlineNote:     { borderRadius: RADIUS.sm, borderWidth: 1, padding: 9, marginBottom: 12 },
  offlineNoteText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  card:            { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon:        { fontSize: 22 },
  cardTitle:       { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  cardBody:        { fontSize: 12, lineHeight: 20 },
  cta:             { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:         { color: COLORS.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:      { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:  { fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
