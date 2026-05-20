/**
 * PrivacyPolicyScreen
 *
 * Full Privacy Policy -- required by Apple, Google, and GDPR/CCPA.
 * Covers: data collected, how used, sharing, retention, user rights.
 * Accessible from: Settings → Privacy Policy, Onboarding footer.
 *
 * Compliant with:
 *  • CCPA (California Consumer Privacy Act)
 *  • GDPR (EU users)
 *  • Apple App Store requirements
 *  • Google Play requirements
 */
import React, { useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Linking, Alert,
} from 'react-native';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import {useTheme} from '../constants/theme';

const EFFECTIVE_DATE  = 'May 1, 2026';
const COMPANY         = 'Justice Gavel LLC';
const CONTACT_EMAIL   = 'privacy@justicegavel.app';
const WEBSITE         = 'https://justicegavel.app';
const DPO_EMAIL       = 'dpo@justicegavel.app'; // Data Protection Officer (GDPR)

// ── Data categories table ─────────────────────────────────────────────────────
type DataRow = {
  category: string;
  examples: string;
  purpose: string;
  shared: string;
  retention: string;
};

const DATA_TABLE: DataRow[] = [
  {
    category: 'Account Information',
    examples: 'Name, email, phone number, password (hashed)',
    purpose: 'Create and manage your account; authentication',
    shared: 'Not sold. Shared only with Twilio (SMS) and SendGrid (email)',
    retention: 'Until account deletion + 30 days',
  },
  {
    category: 'Case & Legal Data',
    examples: 'Case notes, documents, court dates, charge types',
    purpose: 'Provide case management features',
    shared: 'Not shared. Encrypted at rest',
    retention: 'Until account deletion or manual deletion',
  },
  {
    category: 'Audio Recordings',
    examples: 'Police encounter recordings (Encounter Recorder feature)',
    purpose: 'Transcription and PDF generation only',
    shared: 'Processed by OpenAI Whisper for transcription. Deleted after processing',
    retention: 'Deleted from our servers immediately after transcript generated',
  },
  {
    category: 'Location Data',
    examples: 'GPS coordinates (only when you search or use SOS)',
    purpose: 'Find nearby attorneys, bail agents, and courthouses',
    shared: 'Not stored. Used in real-time only',
    retention: 'Not retained after search completes',
  },
  {
    category: 'Device & Usage Data',
    examples: 'Device type, OS version, app version, crash reports',
    purpose: 'Bug fixing, performance monitoring (Sentry)',
    shared: 'Sentry (crash reporting only, no PII)',
    retention: '90 days',
  },
  {
    category: 'AI Conversation Data',
    examples: 'Messages sent to AI assistant',
    purpose: 'Generate AI responses; improve AI quality',
    shared: 'Processed by Anthropic. Not used to train Anthropic models',
    retention: '90 days for quality review, then deleted',
  },
  {
    category: 'Payment Data',
    examples: 'Subscription status, payment method type',
    purpose: 'Process subscriptions',
    shared: 'Stripe handles payment processing. We do not store card numbers',
    retention: 'Per Stripe retention policy; subscription records kept 7 years',
  },
  {
    category: 'Push Notification Tokens',
    examples: 'Expo push token for your device',
    purpose: 'Send court date reminders and alerts',
    shared: 'Expo push infrastructure (Apple APNs / Google FCM)',
    retention: 'Until disabled in Settings or account deletion',
  },
];

type Section = { heading: string; body: string };
const SECTIONS: Section[] = [
  {
    heading: '1. Who We Are',
    body:
      COMPANY + ' operates the Justice Gavel mobile application. ' +
      'We are incorporated in Tennessee, United States.\n\n' +
      'Data Controller (GDPR): ' + COMPANY + '\n' +
      'Contact: ' + CONTACT_EMAIL + '\n' +
      'DPO (EU users): ' + DPO_EMAIL,
  },
  {
    heading: '2. Data We Collect',
    body:
      'We collect only the data necessary to provide our services. ' +
      'See the Data Table above for a complete breakdown by category.\n\n' +
      'We do NOT collect:\n' +
      '• Social Security numbers or government ID numbers\n' +
      '• Financial account numbers (Stripe handles payments separately)\n' +
      '• Biometric data (Face ID/Touch ID operates entirely on your device)\n' +
      '• Health information (crisis support data is not stored)',
  },
  {
    heading: '3. How We Use Your Data',
    body:
      'We use your data to:\n\n' +
      '• Provide and improve the Justice Gavel platform\n' +
      '• Connect you with attorneys and bail agents near you\n' +
      '• Send you court date reminders and legal deadline alerts\n' +
      '• Generate AI-powered legal information responses\n' +
      '• Process subscription payments\n' +
      '• Monitor and fix bugs and performance issues\n' +
      '• Comply with legal obligations\n\n' +
      'We do NOT use your data to:\n' +
      '• Show you targeted advertising\n' +
      '• Sell your data to third parties\n' +
      '• Build profiles for marketing purposes',
  },
  {
    heading: '4. Third-Party Service Providers',
    body:
      'We work with the following service providers. Each is contractually ' +
      'bound to protect your data:\n\n' +
      '• Anthropic -- AI responses (claude.ai privacy policy)\n' +
      '• OpenAI -- Audio transcription (openai.com/policies)\n' +
      '• Stripe -- Payment processing (stripe.com/privacy)\n' +
      '• Twilio -- SMS alerts (twilio.com/legal/privacy)\n' +
      '• SendGrid -- Email notifications (sendgrid.com/policies)\n' +
      '• Sentry -- Crash reporting (sentry.io/privacy)\n' +
      '• Expo / AWS -- App infrastructure\n\n' +
      'We do not share your data with attorneys listed on our platform ' +
      'unless you explicitly initiate contact with them.',
  },
  {
    heading: '5. Audio Recordings -- Special Notice',
    body:
      'When you use the Encounter Recorder:\n\n' +
      '1. Audio is recorded on your device\n' +
      '2. When you tap "Stop & Transcribe," audio is sent to OpenAI Whisper\n' +
      '3. OpenAI processes it and returns a text transcript\n' +
      '4. The transcript is processed by our AI to generate a PDF\n' +
      '5. The audio file is NOT retained on our servers after processing\n' +
      '6. The PDF is returned to your device -- we do not store it\n\n' +
      'Your recordings belong to you. We are a processor, not a controller, ' +
      'of your recording data.',
  },
  {
    heading: '6. Data Security',
    body:
      'We implement industry-standard security measures:\n\n' +
      '• All data transmitted over TLS 1.3\n' +
      '• Sensitive data encrypted at rest using AES-256\n' +
      '• Passwords hashed with bcrypt (never stored in plaintext)\n' +
      '• Regular security audits and penetration testing\n' +
      '• Principle of least privilege for internal data access\n' +
      '• Biometric authentication option for the app itself\n\n' +
      'No security system is perfect. In the event of a breach affecting ' +
      'your personal data, we will notify you within 72 hours as required by law.',
  },
  {
    heading: '7. Your Rights (GDPR / CCPA)',
    body:
      'Regardless of where you are located, you have the right to:\n\n' +
      '• Access: Request a copy of the data we hold about you\n' +
      '• Correction: Request we correct inaccurate data\n' +
      '• Deletion: Request we delete your account and associated data\n' +
      '• Portability: Receive your data in a machine-readable format\n' +
      '• Objection: Object to certain processing activities\n' +
      '• Restriction: Request we limit how we use your data\n• Opt-Out: California residents have the right to opt out of the sale of personal information. We do not sell personal information.\n\n' +
      'California residents have additional rights under CCPA, including ' +
      'the right to know what personal information we sell (we sell none).\n\n' +
      'To exercise any right, contact: ' + CONTACT_EMAIL,
  },
  {
    heading: '8. Children\'s Privacy',
    body:
      'Justice Gavel is not directed to children under 13. We do not ' +
      'knowingly collect personal information from children under 13. ' +
      'If we learn we have collected such information, we will delete it ' +
      'immediately and notify the account holder.\n\n' +
      'Users 13-17 may use the app in limited capacity. Users under 18 ' +
      'may not subscribe or provide payment information.',
  },
  {
    heading: '9. Data Retention',
    body:
      'We retain your data only as long as necessary for the purposes ' +
      'described in this policy, or as required by law.\n\n' +
      'When you delete your account:\n' +
      '• Profile data is deleted within 30 days\n' +
      '• Case data is deleted immediately\n' +
      '• AI conversation history is deleted within 90 days\n' +
      '• Payment records are retained 7 years (legal obligation)\n' +
      '• Anonymized, aggregated analytics data may be retained indefinitely',
  },
  {
    heading: '10. International Data Transfers',
    body:
      'We are based in the United States. If you access Justice Gavel from ' +
      'outside the US, your data may be transferred to and processed in the US.\n\n' +
      'For EU/EEA users: We rely on Standard Contractual Clauses (SCCs) ' +
      'and adequacy decisions where applicable for international transfers. ' +
      'Contact our DPO at ' + DPO_EMAIL + ' for more information.',
  },
  {
    heading: '11. Changes to This Policy',
    body:
      'We may update this Privacy Policy periodically. We will notify you ' +
      'of material changes via in-app notification and email at least 30 days ' +
      'before they take effect. Continued use of Justice Gavel after the ' +
      'effective date constitutes acceptance of the updated policy.',
  },
  {
    heading: '12. Contact & Complaints',
    body:
      'Privacy inquiries: ' + CONTACT_EMAIL + '\n' +
      'EU Data Protection Officer: ' + DPO_EMAIL + '\n' +
      'Website: ' + WEBSITE + '/privacy\n\n' +
      'EU/EEA users may lodge a complaint with their local data protection ' +
      'authority if they believe we have not complied with applicable law.',
  },
];

export default function PrivacyPolicyScreen({ navigation }: ScreenProps): JSX.Element {
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [tableExpanded, setTableExpanded] = useState(false);

  const openEmail = (addr: string) => {
    hapticImpact();
    Linking.openURL(`mailto:${addr}`).catch(() =>
      Alert.alert('Email', `Please contact us at ${addr}`)
    );
  };

  const requestDeletion = () => {
    hapticImpact();
    Alert.alert(
      'Request Data Deletion',
      'This will send an email to our privacy team to initiate deletion of your account and all associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send Request', onPress: () => openEmail(CONTACT_EMAIL) },
      ]
    );
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.2} style={styles.headerEyebrow}>
          JUSTICE GAVEL
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>
          Privacy Policy
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerMeta}>
          Effective {EFFECTIVE_DATE}
        </Text>
        <View style={styles.headerBadges}>
          {['GDPR', 'CCPA', 'Apple', 'Google Play'].map(badge => (
            <View key={badge} style={styles.badge}>
              <Text style={styles.badgeText}>✓ {badge}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Quick summary ────────────────────────────────────────── */}
      <View style={[styles.summaryBox, { backgroundColor: isDark ? colors.surface : colors.legalBg,
        borderLeftColor: colors.legalDark }]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.summaryTitle,
          { color: colors.legalDark }]}>
          🔒 Privacy in Plain English
        </Text>
        {[
          'We do NOT sell your data to anyone, ever.',
          'We do NOT show you ads or build ad profiles.',
          'Audio recordings are deleted from our servers after transcription.',
          'Location is used in real-time only -- never stored.',
          'You can delete your account and all data anytime.',
        ].map((item, i) => (
          <Text key={i} maxFontSizeMultiplier={1.3} style={[styles.summaryItem,
            { color: isDark ? colors.legal : colors.legalDark }]}>
            ✓  {item}
          </Text>
        ))}
      </View>

      {/* ── Data table ───────────────────────────────────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.tableToggle, { backgroundColor: colors.bgCard,
          borderColor: colors.border }]}
        onPress={() => {
          hapticImpact();
          setTableExpanded(v => !v);
        }}
        accessibilityLabel="Toggle data collection table"
      >
        <Text maxFontSizeMultiplier={1.3} style={[styles.tableToggleText,
          { color: colors.textPrimary }]}>
          📊 What Data We Collect -- Full Table
        </Text>
        <Text style={[styles.tableChevron, { color: colors.textMuted }]}>
          {tableExpanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {tableExpanded && (
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          {DATA_TABLE.map((row, i) => (
            <View key={i} style={[styles.tableRow,
              { backgroundColor: i % 2 === 0 ? colors.bgCard : colors.bgSubtle,
                borderBottomColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.2} style={[styles.tableCategory,
                { color: colors.textPrimary }]}>
                {row.category}
              </Text>
              <View style={styles.tableFields}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>Examples</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.examples}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>Purpose</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.purpose}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>Shared with</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.shared}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>Retention</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.retention}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Full sections ────────────────────────────────────────── */}
      {SECTIONS.map((section, idx) => (
        <View key={idx} style={[styles.section, { backgroundColor: colors.bgCard,
          borderLeftColor: colors.legalDark }]}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.sectionHeading,
            { color: colors.textPrimary }]}>
            {section.heading}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionBody,
            { color: colors.textSecond }]}>
            {section.body}
          </Text>
        </View>
      ))}

      {/* ── User rights CTAs ─────────────────────────────────────── */}
      <View style={[styles.rightsCard, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsTitle,
          { color: colors.textPrimary }]}>
          Exercise Your Rights
        </Text>
        <TouchableOpacity
          style={[styles.rightsBtn, { backgroundColor: colors.legalDark }]}
          onPress={() => openEmail(CONTACT_EMAIL)}
            accessibilityRole="button"
          activeOpacity={0.85}
          accessibilityLabel="Request data access or correction"
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.rightsBtnText}>
            📋 Request Data Access / Correction
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rightsBtn, { backgroundColor: colors.emergencyDark }]}
          onPress={requestDeletion}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Request account and data deletion"
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.rightsBtnText}>
            🗑  Request Account Deletion
          </Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rightsNote,
          { color: colors.textMuted }]}>
          We respond to all privacy requests within 30 days.
        </Text>
      </View>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <View style={[styles.footer, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerText,
          { color: colors.textMuted }]}>
          © {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerText,
          { color: colors.textFaint, marginTop: 4 }]}>
          We believe in your rights -- including the right to your own data.
        </Text>
      </View>

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:           { paddingBottom: 32 },
  header:           { padding: 28, paddingTop: 48 },
  headerEyebrow:    { color: 'rgba(133,183,235,0.8)', fontSize: 11, fontWeight: '800',
                      letterSpacing: 3, marginBottom: 6 },
  headerTitle:      { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 8 },
  headerMeta:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 14 },
  headerBadges:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge:            { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
                      paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:        { color: '#fff', fontSize: 11, fontWeight: '700' },
  summaryBox:       { margin: 16, borderRadius: 12, padding: 16, borderLeftWidth: 5, gap: 6 },
  summaryTitle:     { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  summaryItem:      { fontSize: 13, lineHeight: 20 },
  tableToggle:      { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row',
                      alignItems: 'center', padding: 14, borderRadius: 12,
                      borderWidth: 1, justifyContent: 'space-between' },
  tableToggleText:  { fontSize: 14, fontWeight: '700', flex: 1 },
  tableChevron:     { fontSize: 14, fontWeight: '700', marginLeft: 8 },
  tableRow:         { padding: 14, borderBottomWidth: 1 },
  tableCategory:    { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  tableFields:      { gap: 3 },
  tableLabel:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
                      textTransform: 'uppercase', marginTop: 6 },
  tableValue:       { fontSize: 12, lineHeight: 18 },
  section:          { marginHorizontal: 16, marginBottom: 10, borderRadius: 12,
                      padding: 18, borderLeftWidth: 4 },
  sectionHeading:   { fontSize: 14, fontWeight: '800', marginBottom: 10, lineHeight: 20 },
  sectionBody:      { fontSize: 13, lineHeight: 21 },
  rightsCard:       { margin: 16, borderRadius: 14, padding: 20, gap: 12 },
  rightsTitle:      { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  rightsBtn:        { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  rightsBtnText:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  rightsNote:       { fontSize: 12, textAlign: 'center' },
  footer:           { margin: 16, borderRadius: 12, padding: 20, alignItems: 'center' },
  footerText:       { fontSize: 12, textAlign: 'center' },
});
