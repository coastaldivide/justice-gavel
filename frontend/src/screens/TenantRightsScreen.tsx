/**
 * TenantRightsScreen -- Eviction emergency + tenant rights
 *
 * Eviction is the civil equivalent of arrest -- a crisis event with a
 * hard deadline (notice period) and immediate legal consequences.
 * 3.6M eviction filings/year in the US. Most tenants don't get a lawyer.
 *
 * Flow:
 *   1. What's happening? (eviction notice / lockout / utility shutoff / other)
 *   2. Immediate steps for that situation
 *   3. Find a housing attorney → LawyersScreen filtered to Real Estate
 *   4. Legal aid referral (free help for income-qualified)
 *
 * Zero API calls. Works offline.
 *
 * Entry points:
 *   1. LawyersScreen Need modal → "Eviction / Housing"
 *   2. ChatScreen after tenant rights AI response
 *   3. HomeScreen (future tile)
 */
import { api } from '../services/api';
import React, { useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking , ActivityIndicator, RefreshControl} from 'react-native';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

type Situation = 'eviction_notice' | 'lockout' | 'utility_shutoff' | 'harassment' | 'mold_habitability' | '';

const SITUATIONS = [
  { key: 'eviction_notice',    label: 'I got an eviction notice',        icon: '📄', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
  { key: 'lockout',            label: 'My landlord locked me out',       icon: '🔒', color: COLORS.warnDark, bg: COLORS.warnBg },
  { key: 'utility_shutoff',    label: 'Utilities were shut off',         icon: '💡', color: COLORS.gold, bg: COLORS.warnBg },
  { key: 'harassment',         label: 'Landlord is harassing me',        icon: '⚠️', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'mold_habitability',  label: 'Unsafe / uninhabitable unit',     icon: '🏚️', color: COLORS.textSecond, bg: COLORS.bgSubtle },
];

const GUIDANCE: Record<string, { urgent: string[]; rights: string[]; deadline?: string }> = {
  eviction_notice: {
    deadline: 'You typically have 3-30 days depending on your state and the reason. DO NOT ignore this.',
    urgent: [
      'Read the notice carefully -- note the date and reason. Take a photo.',
      'Do NOT move out yet. An eviction notice is not a court order.',
      'Pay any overdue rent if the notice is for non-payment -- this can stop the eviction in most states.',
      'Contact a housing attorney or legal aid immediately -- before the deadline.',
      'Attend every court hearing. Missing one = automatic judgment against you.',
    ],
    rights: [
      'Your landlord must go to court to legally remove you.',
      'You cannot be locked out, have utilities cut, or have belongings removed without a court order.',
      'You can dispute the eviction in court -- even if you owe rent.',
      'Retaliation evictions (after you complained about conditions) may be illegal.',
    ],
  },
  lockout: {
    urgent: [
      'A self-help lockout is ILLEGAL in most states. Call 911 if you are locked out without a court order.',
      'Document everything -- photos, texts, emails from your landlord.',
      'Contact a housing attorney immediately. Courts issue emergency orders within hours.',
      'Keep all communications with your landlord in writing from now on.',
    ],
    rights: [
      'Your landlord CANNOT change your locks without a court eviction order.',
      'You may be entitled to money damages for an illegal lockout.',
      'Emergency injunctive relief can restore your access same day.',
    ],
  },
  utility_shutoff: {
    urgent: [
      'Contact your utility company first -- utilities in your name cannot be shut off by a landlord.',
      'If landlord controls utilities, an intentional shutoff is illegal in most states.',
      'Document the shutoff with photos and a written notice to your landlord.',
      'File a complaint with your local housing authority or code enforcement.',
      'Seek emergency legal relief if you have children, medical equipment, or extreme weather.',
    ],
    rights: [
      'Landlords cannot shut off essential utilities to force you out.',
      'You may deduct repair costs from rent in some states (repair-and-deduct).',
      'Document all habitability issues with photos and written complaints.',
    ],
  },
  harassment: {
    urgent: [
      'Document every incident -- dates, times, what was said or done. Screenshot all texts.',
      'Send all communication in writing (email or certified mail) going forward.',
      'File a police report if you feel threatened.',
      'Contact a housing attorney -- landlord harassment is illegal in most states.',
    ],
    rights: [
      'You have the right to quiet enjoyment of your home.',
      'Landlords must give proper notice before entry (typically 24-48 hours).',
      'Repeated unannounced entry, threats, or intimidation can be grounds for damages.',
    ],
  },
  mold_habitability: {
    urgent: [
      'Send a written notice to your landlord describing the problem and requesting repair.',
      'Take photos and videos of all issues -- dated and timestamped.',
      'Keep copies of all communications.',
      'Contact local code enforcement for an inspection -- this creates an official record.',
      'Do NOT withhold rent without legal advice -- it can backfire.',
    ],
    rights: [
      'Your landlord has a legal duty to maintain a habitable unit.',
      'You may be entitled to rent reduction, repair-and-deduct, or lease termination.',
      'Retaliation for reporting habitability issues is illegal in most states.',
    ],
  },
};

export default function TenantRightsScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState(0);

  const sections = SITUATIONS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 32 }}>🏘️</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.bgCard }]}>Tenant Rights</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>Housing & landlord-tenant law</Text>
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
        <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textFaint }]}>
          This information is for general education only and is not legal advice.
          Laws vary by state. Consult a licensed attorney for advice about your situation.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 0, paddingBottom: 40 },

  header: { padding: 20, paddingTop: 16, marginBottom: 16 },
  headerTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 4 },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

  sectionLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10, paddingHorizontal: 16 },

  sitCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, borderRadius: RADIUS.lg, padding: 14 },
  sitIcon:  { fontSize: 22, flexShrink: 0 },
  sitLabel: { flex: 1, fontSize: 14, lineHeight: 21, ...FONTS.heavy },
  sitCheck: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  deadlineBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', margin: 16, marginTop: 8, borderRadius: RADIUS.lg, borderWidth: 2, padding: 12 },
  deadlineIcon:   { fontSize: 20 },
  deadlineText:   { flex: 1, fontSize: 12, color: '#EF5350', fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 18 },

  stepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 16, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepText: { flex: 1, fontSize: 12, lineHeight: 19 },

  rightsCard: { marginHorizontal: 16, borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 20 },
  rightsRow:  { flexDirection: 'row', gap: 8, marginBottom: 8 },
  rightsBullet: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', flexShrink: 0, marginTop: 1 },
  rightsText: { flex: 1, fontSize: 12, lineHeight: 18 },

  ctaBlock: { paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  ctaBtn:   { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', ...SHADOW.sm },
  ctaBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  legalAidBtn: { borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  legalAidText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  disclaimer: { fontSize: 11, textAlign: 'center', lineHeight: 17, paddingHorizontal: 20, marginBottom: 10 },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);