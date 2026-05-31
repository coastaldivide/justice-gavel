import { AppIcon } from '../components/AppIcon';
/**
 * JustArrestedScreen -- Step-by-step arrest guide
 * For panicked, possibly impaired users.
 * One step at a time. Giant text. Big buttons. No confusion.
 */
import React, { useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { Share, View, Text, TouchableOpacity, ScrollView, Linking, StyleSheet, Alert } from 'react-native';
import {  useTheme, COLORS } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var data: any;
const STEPS = [
  {
    id: 1, icon: '🤐', title: 'STOP TALKING',
    color: COLORS.emergencyDark, bg: COLORS.emergencyBg,
    body: 'Do not say ANYTHING except these exact words:',
    script: '"I am invoking my right to remain silent.\nI want a lawyer."',
    warning: 'Do NOT explain yourself. Do NOT answer questions. Do NOT try to be helpful. ANYTHING you say will be used against you.',
    action: null, actionLabel: null,
  },
  {
    id: 2, icon: '📵', title: 'DO NOT CONSENT',
    color: COLORS.warnDark, bg: COLORS.warnBg,
    body: 'If they ask to search your phone, car, or bag -- say:',
    script: '"I do not consent to any searches."',
    warning: 'Even if you have nothing to hide. Even if they say they will get a warrant. Even if they seem friendly. DO NOT CONSENT.',
    action: null, actionLabel: null,
  },
  {
    id: 3, icon: '📞', title: 'USE YOUR CALL',
    color: COLORS.blue, bg: COLORS.infoBg,
    body: 'Ask to make a phone call. Most states allow it -- use it to call:',
    script: '1. A criminal defense attorney\n2. A bail bondsman\n3. A trusted family member\n\n💡 Use the Encounter Recorder to document any ongoing interaction.',
    warning: 'Jail calls are RECORDED. Do not discuss your case. Only arrange help.',
    action: 'find_help', actionLabel: '⚖️ Find a Lawyer or Bondsman Now',
  },
  {
    id: 4, icon: '⏰', title: 'KNOW YOUR DEADLINES',
    color: COLORS.legalDark, bg: COLORS.legalBg,
    body: 'After a DUI arrest -- act FAST. DMV hearing deadlines vary by state (often 7-15 days):',
    script: '• Request a DMV hearing to keep your license\n• This is SEPARATE from your criminal case\n• Missing this = automatic license suspension',
    warning: 'Your first court date is usually within 24 to 72 hours. ALWAYS plead NOT GUILTY at arraignment -- even if you plan to make a deal later.',
    action: 'deadline', actionLabel: '⏰ Calculate My Deadlines',
  },
  {
    id: 5, icon: '✅', title: 'YOU CAN DO THIS',
    color: COLORS.blue, bg: COLORS.infoBg,
    body: 'The most important things:',
    script: '✓ Stay silent -- only say you want a lawyer\n✓ Do not consent to searches\n✓ Use your phone call to get help\n✓ Plead NOT GUILTY at arraignment\n✓ Ask for a public defender if you cannot afford a lawyer\n\n⚖️ You are INNOCENT until proven guilty.\nThe state must prove their case. Not you.',
    warning: null,
    action: 'home', actionLabel: '🏠 Get More Help',
  },
];

import Analytics from '../services/analytics';
import { PlaceholderIllustration } from '../components/PlaceholderIllustration';
export default function JustArrestedScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const bg   = isDark ? colors.bg : current.bg;
  const card = isDark ? colors.bgCard : colors.surface;
  const text = isDark ? colors.textPrimary : colors.bg;

  const next = () => {
    hapticImpact();
    if (step < STEPS.length - 1) setStep(s => s + 1);
  };
  const prev = () => {
    hapticImpact();
    if (step > 0) setStep(s => s - 1);
  };
  const handleAction = () => {
    hapticImpact();
    if (current.action === 'find_help')    navigation.navigate('MoreTab', { screen: 'HelpNow' });
    else if (current.action === 'bail')     navigation.navigate('HomeTab', { screen: 'BailSearch' });
    else if (current.action === 'rights')   navigation.navigate('HomeTab', { screen: 'RightsCard' });
    else if (current.action === 'emergency') navigation.navigate('HomeTab', { screen: 'Emergency' });
    else if (current.action === 'deadline') navigation.navigate('MoreTab', { screen: 'DeadlineCalculator' });
    else if (current.action === 'home')     navigation.navigate('HomeTab');
  };
  const call = (num: string) => {
    hapticImpact();
    Linking.openURL(`tel:${num.replace(/\D/g, "")}`).catch(() =>
      Alert.alert('Cannot call', `Please dial ${num} manually.`)
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg }}
      testID="just-arrested-screen">
      {/* ── Header ─────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: current.color }]}>
        <Text maxFontSizeMultiplier={1.2} style={styles.stepLabel}>
          STEP {current.id} OF {STEPS.length}
        </Text>
        <View style={styles.titleRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.titleIcon}>{current.icon}</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.title}>{current.title}</Text>
        </View>
        {/* Progress bar */}
        <View style={styles.progressRow}>
          {STEPS.map((_, i) => (
            <View key={i} style={[
              styles.progressDot,
              { backgroundColor: i <= step ? colors.bgCard : 'rgba(255,255,255,0.3)' }
            ]} />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
      <PlaceholderIllustration type="shield" size={80} />


        {/* Body text */}
        <Text maxFontSizeMultiplier={1.3} style={[styles.bodyText, { color: text }]}>
          {current.body}
        </Text>

        {/* Script box -- what to say */}
        <View style={[styles.scriptBox, { backgroundColor: card, borderLeftColor: current.color }]}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.scriptLabel, { color: current.color }]}>
            {current.id <= 2 ? 'SAY THESE EXACT WORDS:' : 'REMEMBER:'}
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={[
            styles.scriptText,
            { color: text, fontSize: current.id <= 2 ? 24 : 18, lineHeight: current.id <= 2 ? 34 : 28 }
          ]}>
            {current.script}
          </Text>
        </View>

        {/* Warning box */}
        {current.warning ? (
          <View style={[styles.warningBox, { backgroundColor: isDark ? colors.surface : colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.warningText, { color: isDark ? colors.gold : colors.textMuted }]}>
              ⚠️  {current.warning}
            </Text>
          </View>
        ) : null}

        {/* Action button */}
        {current.action ? (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.actionBtn, { backgroundColor: current.color }]}
            onPress={handleAction}
            activeOpacity={0.85}
            accessibilityLabel={current.actionLabel || ''}
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.actionBtnText}>
              {current.actionLabel}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* 911 / 988 -- always visible */}
        <View style={styles.emergencyRow}>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.emergencyBtn, { backgroundColor: colors.emergencyDark }]}
            onPress={() => call('911')}
            activeOpacity={0.85}
            accessibilityLabel="Call 911 emergency services"
          >
            <AppIcon name="flash" size={20} color={COLORS.emergency} />
            <Text maxFontSizeMultiplier={1.2} style={styles.emergencyLabel}>CALL 911</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.emergencyBtn, { backgroundColor: colors.blue }]}
            onPress={() => call('988')}
            activeOpacity={0.85}
            accessibilityLabel="Call 988 crisis line"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.emergencyIcon}>💙</Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.emergencyLabel}>CRISIS 988</Text>
          </TouchableOpacity>
        </View>


      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: '#555', fontStyle: 'italic' }}>
          ⚖️ Information only -- not legal advice -- not legal advice. Laws vary by
          jurisdiction and change frequently. Consult a licensed attorney for
          advice specific to your situation.
        </Text>
      </View>

      {/* Share this app -- step 5 moment */}
      {step === 4 && (
        <TouchableOpacity
          accessibilityRole="button"
          style={{ flexDirection:'row', alignItems:'center', justifyContent:'center',
            gap:8, paddingVertical:10, paddingHorizontal:16, marginTop:8 }}
          onPress={() => { try {
          Share.share({
            message: 'If you or someone you know ever gets arrested, use Justice Gavel -- it tells you exactly what to do and connects you with lawyers and bail bondsmen immediately. Get it free: https://justicegavel.app',
            title: 'Justice Gavel -- Free legal help if you get arrested',
          });
        } catch (shareErr: any) {
          // Share failed (unsupported browser) — silently ignore
        }}
        }
        >
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            📲 Share this app -- it might help someone you know
          </Text>
        </TouchableOpacity>
      )}

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>

      {/* ── Bottom nav ─────────────────────────── */}
      <View style={[styles.navBar, { backgroundColor: card, borderTopColor: colors.border }]}>
        {step > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={prev}
            style={[styles.navBtn, { backgroundColor: isDark ? colors.bgElevated : colors.bgCard, flex: 1 }]}
            activeOpacity={0.85}
            accessibilityLabel="Previous step"
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.navBtnText, { color: text }]}>← Back</Text>
          </TouchableOpacity>
        ) : null}
        {step < STEPS.length - 1 ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={next}
            style={[styles.navBtn, { backgroundColor: current.color, flex: step > 0 ? 2 : 1 }]}
            activeOpacity={0.85}
            accessibilityLabel="Next step"
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.navBtnText, { color: colors.bgCard }]}>
              Next Step →
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  header:      { paddingHorizontal: 20, paddingTop: 48, paddingBottom: 20 },
  stepLabel:   { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  titleIcon:   { fontSize: 48 },
  title:       { color: COLORS.bgCard, fontSize: 30, fontWeight: '900', flex: 1, lineHeight: 36 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: 18 },
  progressDot: { flex: 1, height: 5, borderRadius: 3 },

  scroll:      { padding: 20, gap: 16, paddingBottom: 20 },
  bodyText:    { fontSize: 20, fontWeight: '600', lineHeight: 28 },

  scriptBox: {
    borderRadius: 16, padding: 20,
    borderLeftWidth: 6,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  scriptLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  scriptText:  { fontWeight: '800' },

  warningBox:  { borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: '#F9A825' },
  warningText: { fontSize: 15, lineHeight: 22 },

  actionBtn:     { borderRadius: 14, paddingVertical: 20, alignItems: 'center' },
  actionBtnText: { color: COLORS.bgCard, fontSize: 18, fontWeight: '900' },

  emergencyRow: { flexDirection: 'row', gap: 12 },
  emergencyBtn: { flex: 1, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  emergencyIcon: { fontSize: 24, marginBottom: 4 },
  emergencyLabel: { color: COLORS.bgCard, fontWeight: '900', fontSize: 15 },

  navBar:    { flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 32, borderTopWidth: 1 },
  navBtn:    { borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  navBtnText:{ fontSize: 18, fontWeight: '900' },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);