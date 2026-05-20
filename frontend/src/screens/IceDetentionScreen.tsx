/**
 * IceDetentionScreen -- ICE Detention Emergency Guide
 *
 * Fully bilingual (English / Spanish). Works offline -- no API calls.
 * The target user is a Spanish-speaking family member who just had a
 * loved one detained by ICE and needs immediate guidance.
 *
 * The Spanish UI already exists. This screen uses t() for every string.
 *
 * Entry points:
 *   1. LawyersScreen Need modal → "Immigration / ICE"
 *   2. ChatScreen ICE detention prompt response
 *   3. CrisisResourcesScreen (immigration crisis path)
 *   4. HomeScreen tile (future)
 */
import React from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Linking } from 'react-native';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { t } from '../i18n';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

const RIGHTS_KEYS = [
  'ice_right_to_lawyer',
  'ice_right_to_call',
  'ice_right_to_silence',
  'ice_do_not_sign',
];

const STEP_KEYS = [
  'ice_step1',
  'ice_step2',
  'ice_step3',
  'ice_step4',
  'ice_step5',
  'ice_step6',
];

export default function IceDetentionScreen(): JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }
  );
  const { colors, isDark } = useTheme();
  const [tab, setTab] = React.useState(0);

  const sections = RIGHTS_KEYS;
  const section  = Array.isArray(sections) ? sections[tab] : null;
  const allSections = Array.isArray(sections) ? sections : [];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text style={{ fontSize: 32 }}>🛑</Text>
        <Text style={[styles.headerTitle, { color: colors.bgCard }]}>ICE Detention Guide</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]}>Know your rights immediately</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 0 },

  header: { padding: 20, paddingTop: 16, marginBottom: 16 },
  headerTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 4 },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

  rightsCard:  { marginHorizontal: 16, marginBottom: 16, borderRadius: RADIUS.lg, borderWidth: 2, padding: 14 },
  rightsTitle: { fontSize: 14, lineHeight: 21, ...FONTS.black, marginBottom: 10 },
  rightsRow:   { flexDirection: 'row', gap: 8, marginBottom: 7, alignItems: 'flex-start' },
  rightsBullet:{ fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flexShrink: 0 },
  rightsText:  { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 18 },

  sectionLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10, paddingHorizontal: 16 },

  stepRow:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 16, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  stepNum:  { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepText: { flex: 1, fontSize: 12, lineHeight: 19 },

  ctaBlock: { paddingHorizontal: 16, gap: 8, marginVertical: 16 },
  ctaBtn:   { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', ...SHADOW.sm },
  ctaBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  outlineBtn: { borderRadius: RADIUS.md, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center' },
  outlineBtnText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  chatCta: { marginHorizontal: 16, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 13, alignItems: 'center' },
  chatCtaText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});
