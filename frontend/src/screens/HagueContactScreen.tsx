/**
 * HagueContactScreen.tsx — Hague Convention Central Authority Contact
 *
 * Provides family law attorneys and affected parents with:
 *   1. US Central Authority (Office of Children's Issues) contact details
 *   2. NCMEC emergency line for immediate reporting
 *   3. FBI federal reporting path (18 U.S.C. § 1204)
 *   4. INTERPOL Yellow Notice information
 *   5. Destination country Central Authority lookup
 *   6. Intake recording for case tracking
 *   7. Step-by-step next steps (contracting vs non-contracting states)
 *
 * Access: FirmVerticalScreen (Hague tracker) + LawyersScreen (specialty filter)
 * Auth: required
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, KeyboardAvoidingView, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Linking,
  TextInput,
} from 'react-native';
import { useTheme } from '../constants/theme';
import { hapticCall, hapticSuccess, hapticWarn, hapticSelect } from '../services/haptics';
import api from '../services/api';

declare var Platform: any;
// ── Member state list (subset — full list from API) ─────────────────────────
const QUICK_COUNTRIES = [
  { code:'GB', name:'United Kingdom' },
  { code:'AU', name:'Australia' },
  { code:'CA', name:'Canada' },
  { code:'FR', name:'France' },
  { code:'DE', name:'Germany' },
  { code:'IT', name:'Italy' },
  { code:'JP', name:'Japan' },
  { code:'MX', name:'Mexico' },
  { code:'BR', name:'Brazil' },
  { code:'ES', name:'Spain' },
  { code:'NL', name:'Netherlands' },
  { code:'CH', name:'Switzerland' },
  { code:'SE', name:'Sweden' },
  { code:'NZ', name:'New Zealand' },
  { code:'ZA', name:'South Africa' },
  { code:'IN', name:'India (non-contracting)' },
  { code:'PK', name:'Pakistan (non-contracting)' },
  { code:'CN', name:'China (non-contracting)' },
];

interface HagueContactScreenProps {
  navigation: any;
  route: any;
}

export default function HagueContactScreen({ navigation, route }: HagueContactScreenProps) {
  const { colors } = useTheme();
  const { caseId, caseName } = route?.params || {};

  const [phase, setPhase] = useState<'home'|'lookup'|'intake'|'result'>('home');
  const [usResources, setUsResources] = useState<any>(null);
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [authorityData, setAuthorityData] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [intakeResult, setIntakeResult] = useState<any>(null);

  // Intake form state
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [abductionDate, setAbductionDate] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadUsResources();
  }, []);

  const loadUsResources = useCallback(async () => {
    try {
      const res = await api.get('/hague-contacts/us-resources');
      setUsResources(res.data?.resources);
    } catch { /* non-critical */ }
  }, []);

  const lookupAuthority = useCallback(async (code: string) => {
    setLoadingAuth(true);
    setAuthorityData(null);
    try {
      hapticSelect();
      const res = await api.get(`/hague-contacts/central-authority/${code}`);
      setAuthorityData(res.data || null);
    } catch {
      hapticWarn();
      Alert.alert('Lookup Failed', 'Could not load authority information. Check HCCH at hcch.net directly.');
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  const onSelectCountry = useCallback((code: string) => {
    setSelectedCountry(code);
    lookupAuthority(code);
    setPhase('lookup');
  }, [lookupAuthority]);

  const openUrl = useCallback((url: string) => {
    hapticSelect();
    Linking.openURL(url).catch(() =>
      Alert.alert('Cannot Open', 'Please copy this URL manually:\n\n' + url)
    );
  }, []);

  const callNumber = useCallback((phone: string) => {
    hapticCall();
    Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, '')}`).catch(() =>
      Alert.alert('Call', phone)
    );
  }, []);

  const submitIntake = useCallback(async () => {
    if (!caseId) {
      return Alert.alert('No Case', 'Open from a specific case to record intake.');
    }
    if (!childName.trim()) return Alert.alert('Required', 'Child name is required.');
    if (!selectedCountry) return Alert.alert('Required', 'Select destination country first.');
    if (!abductionDate.trim()) return Alert.alert('Required', 'Abduction date is required.');

    setSubmitting(true);
    try {
      hapticSelect();
      const res = await api.post('/hague-contacts/report-intake', {
        caseId,
        countryCode: selectedCountry,
        childName: childName.trim(),
        childAge: parseInt(childAge) || undefined,
        abductionDate: abductionDate.trim(),
        notes: intakeNotes.trim(),
      });
      hapticSuccess();
      setIntakeResult(res.data || null);
      setPhase('result');
    } catch {
      hapticWarn();
      Alert.alert('Error', 'Failed to record intake. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [caseId, childName, selectedCountry, abductionDate, childAge, intakeNotes]);

  const s = styles(colors);

  // ── PHASE: Result ──────────────────────────────────────────────────────────
  if (phase === 'result' && intakeResult) {
    return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps='handled' style={s.container} contentContainerStyle={s.content}>
        <View style={s.successBanner}>
          <Text style={s.successIcon}>✅</Text>
          <Text style={s.successTitle}>Intake Recorded</Text>
          <Text style={s.successSub}>Attached to your case for tracking</Text>
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Next Steps</Text>
          {(intakeResult.next_steps || []).map((step: string, i: number) => (
            <View key={i} style={s.stepRow}>
              <Text style={s.stepNum}>{i + 1}</Text>
              <Text style={s.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Emergency Contacts</Text>
          <TouchableOpacity
            style={s.contactRow}
            onPress={() => callNumber('+18884074747')}
            accessibilityRole="button"
            accessibilityLabel="Call Office of Children's Issues emergency line"
          >
            <Text style={s.contactName}>🏛 OCI Emergency Line</Text>
            <Text style={s.contactDetail}>1-888-407-4747</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.contactRow}
            onPress={() => callNumber('18008435678')}
            accessibilityRole="button"
            accessibilityLabel="Call NCMEC"
          >
            <Text style={s.contactName}>🔴 NCMEC 24/7</Text>
            <Text style={s.contactDetail}>1-800-843-5678</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={s.btnPrimary}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : null}
          accessibilityRole="button"
        >
          <Text style={s.btnPrimaryText}>Back to Case</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    );
  }

  // ── PHASE: Intake Form ─────────────────────────────────────────────────────
  if (phase === 'intake') {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.heading}>Record Intake</Text>
        <Text style={s.subheading}>
          For case tracking only. Your attorney files the application directly with the U.S. Central Authority.
        </Text>

        <Text style={s.label}>Child's Full Name *</Text>
        <TextInput
          style={s.input}
          value={childName}
          onChangeText={setChildName}
          placeholder="As it appears on birth certificate"
          placeholderTextColor={colors.textMuted}
          maxFontSizeMultiplier={1.4}
          maxLength={100}
          returnKeyType="next" />

        <Text style={s.label}>Child's Age</Text>
        <TextInput
          style={s.input}
          value={childAge}
          onChangeText={setChildAge}
          placeholder="Years"
          keyboardType="number-pad"
          maxFontSizeMultiplier={1.4}
          maxLength={3} returnKeyType="next" />


        <Text style={s.label}>Date of Abduction / Wrongful Retention *</Text>
        <TextInput
          style={s.input}
          value={abductionDate}
          onChangeText={setAbductionDate}
          placeholder="YYYY-MM-DD"
          maxFontSizeMultiplier={1.4}
          maxLength={10} returnKeyType="next" />


        <Text style={s.label}>Destination Country</Text>
        <View style={s.countryTag}>
          <Text style={s.countryTagText}>
            {selectedCountry
              ? QUICK_COUNTRIES.find(c => c.code === selectedCountry)?.name || selectedCountry
              : 'Not selected — go back to select country'}
          </Text>
        </View>

        <Text style={s.label}>Notes (facts, witnesses, documentation available)</Text>
        <TextInput
          style={[s.input, { height: 100, textAlignVertical: 'top' }]}
          value={intakeNotes}
          onChangeText={setIntakeNotes}
          placeholder="Key facts for case record..."
          multiline
          maxFontSizeMultiplier={1.4}
          maxLength={2000} returnKeyType="done" />

        <TouchableOpacity
          style={[s.btnPrimary, submitting && s.btnDisabled]}
          onPress={submitIntake}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Submit Hague intake record"
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnPrimaryText}>Record Intake</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.btnSecondary}
          onPress={() => setPhase('lookup')}
          accessibilityRole="button"
        >
          <Text style={s.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── PHASE: Country Lookup ──────────────────────────────────────────────────
  if (phase === 'lookup') {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.heading}>Central Authorities</Text>
        <Text style={s.subheading}>Select destination country</Text>

        {QUICK_COUNTRIES.map(c => (
          <TouchableOpacity
            key={c.code}
            style={[s.countryBtn, selectedCountry === c.code && s.countryBtnActive]}
            onPress={() => onSelectCountry(c.code)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${c.name}`}
          >
            <Text style={[s.countryBtnText, selectedCountry === c.code && s.countryBtnTextActive]}>
              {c.name}
            </Text>
          </TouchableOpacity>
        ))}

        {loadingAuth && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
        {authorityData && !loadingAuth && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{authorityData.country_name}</Text>
            <Text style={[s.noteText, {
              color: authorityData.contracting_state ? colors.legal : colors.warn
            }]}>
              {authorityData.note}
            </Text>
            {authorityData.central_authority && (
              <>
                <Text style={s.authName}>{authorityData.central_authority.name}</Text>
                <TouchableOpacity
                  onPress={() => openUrl(authorityData.central_authority.website)}
                  accessibilityRole="button"
                  accessibilityLabel="Open central authority website"
                >
                  <Text style={s.linkText}>{authorityData.central_authority.website}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={s.btnPrimary}
              onPress={() => setPhase('intake')}
              accessibilityRole="button"
            >
              <Text style={s.btnPrimaryText}>Record Intake for Case</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={s.btnSecondary} onPress={() => setPhase('home')}
        >
          <Text style={s.btnSecondaryText}>← Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── PHASE: Home ────────────────────────────────────────────────────────────
  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.heading}>🌐 Hague Convention</Text>
      <Text style={s.subheading}>
        International Child Abduction — Central Authority Contacts & Reporting
      </Text>

      {caseName && (
        <View style={s.caseBadge}>
          <Text style={s.caseBadgeText}>📁 {caseName}</Text>
        </View>
      )}

      {/* Emergency Section */}
      <View style={[s.card, s.emergencyCard]}>
        <Text style={s.emergencyTitle}>🚨 Emergency Contacts</Text>

        <TouchableOpacity
          style={s.contactRow}
          onPress={() => callNumber('+18884074747')}
          accessibilityRole="button"
          accessibilityLabel="Call Office of Children's Issues emergency line"
          accessibilityHint="24/7 emergency line for US citizens abroad"
        >
          <View style={s.contactInfo}>
            <Text style={s.contactName}>🏛 Office of Children's Issues (OCI)</Text>
            <Text style={s.contactSub}>U.S. Central Authority — State Dept</Text>
            <Text style={s.contactDetail}>1-888-407-4747 (24/7 emergency)</Text>
            <Text style={s.contactDetail}>Mon–Fri 8am–8pm: +1-202-501-4444</Text>
          </View>
        </TouchableOpacity>

        <View style={s.divider} />

        <TouchableOpacity
          style={s.contactRow}
          onPress={() => callNumber('18008435678')}
          accessibilityRole="button"
          accessibilityLabel="Call NCMEC 24/7 hotline"
        >
          <View style={s.contactInfo}>
            <Text style={s.contactName}>🔴 NCMEC — 24/7 Hotline</Text>
            <Text style={s.contactSub}>National Center for Missing & Exploited Children</Text>
            <Text style={s.contactDetail}>1-800-THE-LOST (1-800-843-5678)</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Reporting Paths */}
      <View style={s.card}>
        <Text style={s.sectionTitle}>Federal Reporting Paths</Text>

        <TouchableOpacity
          style={s.reportRow}
          onPress={() => openUrl('https://www.ic3.gov')}
          accessibilityRole="button"
          accessibilityLabel="Open FBI IC3 reporting portal"
        >
          <Text style={s.reportIcon}>🏛</Text>
          <View style={s.reportInfo}>
            <Text style={s.reportTitle}>FBI IC3 — Federal Report</Text>
            <Text style={s.reportSub}>International Parental Kidnapping (18 U.S.C. § 1204)</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.reportRow}
          onPress={() => openUrl('https://travel.state.gov/content/travel/en/International-Parental-Child-Abduction/prevention/hague-convention.html')}
          accessibilityRole="button"
          accessibilityLabel="Open State Department Hague application"
        >
          <Text style={s.reportIcon}>📋</Text>
          <View style={s.reportInfo}>
            <Text style={s.reportTitle}>File Hague Application</Text>
            <Text style={s.reportSub}>Submit to OCI — travel.state.gov</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.reportRow}
          onPress={() => openUrl('https://www.interpol.int/Crimes/Crimes-against-children/Child-abduction')}
          accessibilityRole="button"
          accessibilityLabel="Open INTERPOL child abduction information"
        >
          <Text style={s.reportIcon}>🌐</Text>
          <View style={s.reportInfo}>
            <Text style={s.reportTitle}>INTERPOL — Yellow Notice</Text>
            <Text style={s.reportSub}>Via FBI or local law enforcement</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Country Lookup */}
      <TouchableOpacity
        style={s.btnPrimary}
        onPress={() => setPhase('lookup')}
        accessibilityRole="button"
        accessibilityLabel="Look up destination country central authority"
      >
        <Text style={s.btnPrimaryText}>Find Destination Country Authority →</Text>
      </TouchableOpacity>

      <View style={s.legalNotice}>
        <Text style={s.legalNoticeText}>
          Justice Gavel provides contact information and case intake tracking.
          Hague applications must be filed directly by attorneys with the U.S. Central Authority.
          This is not legal advice. Consult a licensed family law attorney.
        </Text>
      </View>
    </ScrollView>

    );
}

const styles = (colors: any) => StyleSheet.create({
  container:          { flex: 1, backgroundColor: colors.background },
  content:            { padding: 16, paddingBottom: 60 },
  heading:            { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 6 },
  subheading:         { fontSize: 14, color: colors.textMuted, marginBottom: 16, lineHeight: 20 },
  caseBadge:          { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10, marginBottom: 16 },
  caseBadgeText:      { fontSize: 14, color: colors.primary, fontWeight: '600' },
  card:               { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 14 },
  emergencyCard:      { borderWidth: 1.5, borderColor: colors.emergency },
  emergencyTitle:     { fontSize: 16, fontWeight: '700', color: colors.emergency, marginBottom: 14 },
  sectionTitle:       { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 12 },
  contactRow:         { marginBottom: 10 },
  contactInfo:        { flex: 1 },
  contactName:        { fontSize: 15, fontWeight: '600', color: colors.text },
  contactSub:         { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  contactDetail:      { fontSize: 13, color: colors.primary, marginTop: 4 },
  divider:            { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  reportRow:          { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  reportIcon:         { fontSize: 20, marginRight: 12, marginTop: 2 },
  reportInfo:         { flex: 1 },
  reportTitle:        { fontSize: 15, fontWeight: '600', color: colors.text },
  reportSub:          { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  countryBtn:         { backgroundColor: colors.card, borderRadius: 10, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  countryBtnActive:   { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  countryBtnText:     { fontSize: 15, color: colors.text },
  countryBtnTextActive: { color: colors.primary, fontWeight: '600' },
  countryTag:         { backgroundColor: colors.card, borderRadius: 8, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  countryTagText:     { fontSize: 14, color: colors.text },
  authName:           { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 8 },
  noteText:           { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  linkText:           { fontSize: 13, color: colors.primary, textDecorationLine: 'underline', marginBottom: 14 },
  successBanner:      { alignItems: 'center', marginBottom: 24 },
  successIcon:        { fontSize: 40, marginBottom: 8 },
  successTitle:       { fontSize: 20, fontWeight: '700', color: colors.legal },
  successSub:         { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  stepRow:            { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  stepNum:            { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 22, marginRight: 10 },
  stepText:           { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
  label:              { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 14 },
  input:              { backgroundColor: colors.card, borderRadius: 10, padding: 12, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border },
  btnPrimary:         { backgroundColor: colors.primary, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 14 },
  btnPrimaryText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnSecondary:       { backgroundColor: 'transparent', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnSecondaryText:   { color: colors.primary, fontSize: 15, fontWeight: '600' },
  btnDisabled:        { opacity: 0.5 },
  legalNotice:        { marginTop: 24, padding: 14, backgroundColor: colors.card, borderRadius: 10 },
  legalNoticeText:    { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
});
