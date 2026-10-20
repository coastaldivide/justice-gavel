/**
 * HagueContactScreen — international child abduction (1980 Hague Convention):
 * who to call, where to file, the destination country's Central Authority, and
 * a record of the facts on the person's own case.
 *
 * Every contact comes from the server's stored data (GET /hague-contacts/
 * us-resources, /member-states, /central-authority/:code) and is shown with its
 * source, the date it was recorded and whether anyone checked it again. Country
 * names are shown in the app's language (Intl), the authority names as recorded.
 * The information is public; recording facts on a case needs a session and one
 * of the person's cases (from the case's tools, or chosen here).
 *
 * Entry: Family court › Custody ("Child taken to another country?"), /hague.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { formatPhone, telUrl, websiteUrl } from '../utils/contact';
import { hapticCall, hapticSelect, hapticSuccess, hapticWarn } from '../services/haptics';
import { useToast } from '../components/ToastProvider';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { SourceLine, UnreviewedNotice } from '../components/LegalSource';
import { t, useLang, locale, getLang } from '../i18n';

interface Source { label: string; url: string | null; recorded_at: string | null; last_verified_at: string | null }
interface Authority {
  country_code: string; country_name: string; contracting_state: boolean; note: string;
  central_authority: { name: string; website: string | null; phone: string | null; emergency_phone: string | null; email: string | null };
  source: Source;
}
interface Resource { key: string; name: string; phone: string | null; website: string | null; statute: string | null; source: Source }
interface Member { code: string; name: string; contracting: boolean }
interface CaseRow { id: number; title?: string | null }
type Phase = 'home' | 'lookup' | 'intake' | 'done';

const RESOURCE_KEYS = new Set(['oci_application', 'ncmec', 'fbi', 'interpol']);

/** The country's name in the app's language; the stored English name when Intl cannot say. */
function countryName(code: string, fallback: string): string {
  try {
    const dn = new Intl.DisplayNames([locale()], { type: 'region' });
    return dn.of(code) || fallback;
  } catch { return fallback; }
}

function HagueContactScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showToast } = useToast();
  const { hasSession } = useHasSession();
  const params = (route?.params || {}) as { caseId?: number | string; caseName?: string };

  const [phase, setPhase] = useState<Phase>('home');
  const [us, setUs] = useState<Authority | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState('');
  const [authority, setAuthority] = useState<Authority | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseId, setCaseId] = useState<number | null>(params.caseId ? Number(params.caseId) : null);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState<{ next_steps: string[]; legal_notice: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [r1, r2] = await Promise.all([
        api.get<{ central_authority: Authority; resources: Resource[] }>('/hague-contacts/us-resources', { params: { lang: getLang() } }),
        api.get<{ member_states: Member[] }>('/hague-contacts/member-states', { params: { lang: getLang() } }),
      ]);
      setUs(r1.data.central_authority);
      setResources(r1.data.resources || []);
      setMembers(r2.data.member_states || []);
    } catch (e) {
      setLoadError(apiErrorMessage(e, t('hg_load_error')));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (phase === 'intake' && hasSession && !params.caseId) {
      api.get<CaseRow[]>('/cases').then(r => setCases(Array.isArray(r.data) ? r.data : [])).catch(() => setCases([]));
    }
  }, [phase, hasSession, params.caseId]);

  const sortedMembers = useMemo(() => members.map(m => ({ ...m, local: countryName(m.code, m.name) }))
    .sort((a, b) => a.local.localeCompare(b.local, locale())), [members]);

  const pickCountry = async (code: string) => {
    hapticSelect();
    setCountry(code); setAuthority(null); setAuthError(''); setAuthLoading(true);
    try {
      const r = await api.get<Authority>(`/hague-contacts/central-authority/${code}`, { params: { lang: getLang() } });
      setAuthority(r.data);
    } catch (e) {
      hapticWarn();
      setAuthError(apiErrorMessage(e, t('x_hague_contact_could_not_load_authority')));
    } finally { setAuthLoading(false); }
  };

  const open = (url: string | null) => {
    const u = websiteUrl(url);
    if (!u) return;
    Linking.openURL(u).catch(() => showToast(t('x_hague_contact_please_copy_this_url'), 'warning'));
  };
  const call = (phone: string | null) => {
    const u = telUrl(phone);
    if (!u) return;
    hapticCall();
    Linking.openURL(u).catch(() => showToast(t('cp_dial_manually', { num: formatPhone(phone) }), 'warning'));
  };

  const submit = async () => {
    setFormError('');
    if (!caseId) { setFormError(t('hg_choose_case')); return; }
    if (!childName.trim()) { setFormError(t('x_hague_contact_child_name_required')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { setFormError(t('hg_date_format')); return; }
    setSubmitting(true);
    try {
      const r = await api.post<{ next_steps: string[]; legal_notice: string }>('/hague-contacts/report-intake', {
        caseId, countryCode: country, childName: childName.trim(), childAge: childAge ? Number(childAge) : undefined,
        abductionDate: date.trim(), notes: notes.trim(),
      });
      hapticSuccess();
      setDone(r.data); setPhase('done');
    } catch (e) {
      hapticWarn();
      setFormError(apiErrorMessage(e, t('x_hague_contact_failed_record_intake_please')));
    } finally { setSubmitting(false); }
  };

  const resName = (r: Resource) => (RESOURCE_KEYS.has(r.key) ? t(`hg_res_${r.key}`) : r.name);

  const usCard = us && (
    <View style={[s.card, s.emergency]} testID="hague-us-authority">
      <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('x_hague_contact_emergency_contacts')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={s.name}>{us.central_authority.name}</Text>
      {!!us.central_authority.emergency_phone && (
        <TouchableOpacity accessibilityRole="button" testID="hague-call-emergency" style={s.callBtn} onPress={() => call(us.central_authority.emergency_phone)}
          accessibilityLabel={t('x_hague_contact_call_office_children_s')}>
          <Text maxFontSizeMultiplier={1.3} style={s.callText}>📞 {t('hg_emergency_phone', { phone: formatPhone(us.central_authority.emergency_phone) })}</Text>
        </TouchableOpacity>
      )}
      {!!us.central_authority.phone && (
        <TouchableOpacity accessibilityRole="button" testID="hague-call-office" style={s.linkRow} onPress={() => call(us.central_authority.phone)}>
          <Text maxFontSizeMultiplier={1.3} style={s.link}>{t('hg_office_phone', { phone: formatPhone(us.central_authority.phone) })}</Text>
        </TouchableOpacity>
      )}
      {!!us.central_authority.website && (
        <TouchableOpacity accessibilityRole="link" style={s.linkRow} onPress={() => open(us.central_authority.website)}>
          <Text maxFontSizeMultiplier={1.3} style={s.link}>{t('hg_open_website')}</Text>
        </TouchableOpacity>
      )}
      <SourceLine source={us.source.label} recorded={us.source.recorded_at} verified={us.source.last_verified_at} />
    </View>
  );

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done' && done) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content} testID="hague-done">
        <Text maxFontSizeMultiplier={1.4} style={[s.heading, { color: colors.legalDark }]}>✓ {t('x_hague_contact_intake_recorded')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{done.legal_notice}</Text>
        <View style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('x_hague_contact_next_steps')}</Text>
          {done.next_steps.map((step, i) => (
            <View key={step} style={s.stepRow}>
              <Text maxFontSizeMultiplier={1.3} style={s.stepNum}>{i + 1}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.stepText}>{step}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.3} style={s.muted}>{t('src_guide_not_reviewed')}</Text>
        </View>
        {usCard}
        <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => { setPhase('home'); setDone(null); }}>
          <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Intake ────────────────────────────────────────────────────────────────
  if (phase === 'intake') {
    if (hasSession === false) {
      return (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
          <SignInNeeded navigation={navigation} body={t('hg_sign_in_body')} onSignedIn={() => setPhase('intake')} testID="hague-sign-in" />
          <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => setPhase('lookup')}>
            <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" testID="hague-intake">
          <Text maxFontSizeMultiplier={1.4} style={s.heading}>{t('x_hague_contact_record_intake')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('x_hague_contact_case_tracking_only_attorney')}</Text>

          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('hg_case')}</Text>
          {params.caseId ? (
            <Text maxFontSizeMultiplier={1.4} style={s.tag}>📁 {params.caseName || `#${params.caseId}`}</Text>
          ) : cases.length === 0 ? (
            <Text maxFontSizeMultiplier={1.4} style={s.muted} testID="hague-no-cases">{t('hg_no_cases')}</Text>
          ) : (
            <View style={s.chips}>
              {cases.map(c => (
                <TouchableOpacity key={c.id} accessibilityRole="radio" aria-checked={caseId === c.id} testID={`hague-case-${c.id}`}
                  style={[s.chip, caseId === c.id && s.chipOn]} onPress={() => setCaseId(c.id)}>
                  <Text maxFontSizeMultiplier={1.3} style={[s.chipText, caseId === c.id && s.chipTextOn]} numberOfLines={1}>{c.title || `#${c.id}`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('x_hague_contact_destination_country')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.tag}>{authority ? countryName(authority.country_code, authority.country_name) : t('x_hague_contact_not_selected_go_back')}</Text>

          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('x_hague_contact_child_s_full_name')}</Text>
          <TextInput testID="hague-child-name" returnKeyType="next" style={s.input} value={childName} onChangeText={setChildName} maxLength={100}
            placeholder={t('x_hague_contact_as_it_appears_birth')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('x_hague_contact_child_s_full_name')} />
          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('x_hague_contact_child_s_age')}</Text>
          <TextInput testID="hague-child-age" returnKeyType="next" style={s.input} value={childAge} onChangeText={v => setChildAge(v.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad" placeholder={t('x_hague_contact_years')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('x_hague_contact_child_s_age')} />
          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('x_hague_contact_date_abduction_wrongful_retention')}</Text>
          <TextInput testID="hague-date" returnKeyType="next" style={s.input} value={date} onChangeText={setDate} maxLength={10}
            placeholder={t('hg_date_placeholder')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('x_hague_contact_date_abduction_wrongful_retention')} />
          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('x_hague_contact_notes_facts_witnesses_documentation')}</Text>
          <TextInput testID="hague-notes" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} multiline maxLength={2000}
            placeholder={t('x_hague_contact_key_facts_case_record')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('x_hague_contact_notes_facts_witnesses_documentation')} />

          {!!formError && <Text testID="hague-form-error" maxFontSizeMultiplier={1.4} style={s.error}>{formError}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="hague-submit" style={[s.primary, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting || !authority}>
            {submitting ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.3} style={s.primaryText}>{t('x_hague_contact_record_intake')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => setPhase('lookup')}>
            <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Country lookup ────────────────────────────────────────────────────────
  if (phase === 'lookup') {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content} testID="hague-lookup">
        <Text maxFontSizeMultiplier={1.4} style={s.heading}>{t('x_hague_contact_central_authorities')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('hg_partial_list')}</Text>
        {sortedMembers.map(m => (
          <TouchableOpacity key={m.code} accessibilityRole="button" testID={`hague-country-${m.code}`}
            accessibilityLabel={t('x_hague_contact_select', { name: m.local })}
            style={[s.country, country === m.code && s.countryOn]} onPress={() => pickCountry(m.code)}>
            <Text maxFontSizeMultiplier={1.4} style={[s.countryText, country === m.code && { fontWeight: '700' }]}>{m.local}</Text>
            {!m.contracting && <Text maxFontSizeMultiplier={1.3} style={s.muted}>{t('hg_not_party')}</Text>}
          </TouchableOpacity>
        ))}
        {authLoading && <ActivityIndicator color={colors.navy} style={{ marginTop: 16 }} />}
        {!!authError && <Text maxFontSizeMultiplier={1.4} style={s.error}>{authError}</Text>}
        {authority && !authLoading && (
          <View style={s.card} testID="hague-authority">
            <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{countryName(authority.country_code, authority.country_name)}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.note, { color: authority.contracting_state ? colors.legalDark : colors.warnDark }]}>{authority.note}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.name}>{authority.central_authority.name}</Text>
            {!!websiteUrl(authority.central_authority.website) && (
              <TouchableOpacity accessibilityRole="link" testID="hague-authority-website" style={s.linkRow} onPress={() => open(authority.central_authority.website)}
                accessibilityLabel={t('x_hague_contact_open_central_authority_website')}>
                <Text maxFontSizeMultiplier={1.3} style={s.link} numberOfLines={1}>{authority.central_authority.website}</Text>
              </TouchableOpacity>
            )}
            <SourceLine source={authority.source.label} recorded={authority.source.recorded_at} verified={authority.source.last_verified_at} testID="hague-authority-source" />
            <TouchableOpacity accessibilityRole="button" testID="hague-start-intake" style={s.primary} onPress={() => setPhase('intake')}>
              <Text maxFontSizeMultiplier={1.3} style={s.primaryText}>{t('x_hague_contact_record_intake_case')}</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => setPhase('home')}>
          <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} testID="hague-contact-screen">
      <Text maxFontSizeMultiplier={1.4} style={s.heading}>{t('x_nav_hague_convention')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('x_hague_contact_international_child_abduction_centra')}</Text>
      {!!params.caseName && <Text maxFontSizeMultiplier={1.4} style={s.tag}>📁 {params.caseName}</Text>}
      <UnreviewedNotice inset={false} text={t('hg_not_reviewed')} testID="hague-notice" />

      {loading && <ActivityIndicator color={colors.navy} style={{ marginTop: 24 }} />}
      {!!loadError && (
        <View style={s.card} testID="hague-load-error">
          <Text maxFontSizeMultiplier={1.4} style={s.error}>{loadError}</Text>
          <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={load}>
            <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {usCard}

      {resources.length > 0 && (
        <View style={s.card} testID="hague-resources">
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('x_hague_contact_federal_reporting_paths')}</Text>
          {resources.map(r => (
            <View key={r.key} style={s.resource} testID={`hague-resource-${r.key}`}>
              <Text maxFontSizeMultiplier={1.4} style={s.name}>{resName(r)}</Text>
              {!!r.statute && <Text maxFontSizeMultiplier={1.3} style={s.muted}>{r.statute}</Text>}
              <View style={s.row}>
                {!!telUrl(r.phone) && (
                  <TouchableOpacity accessibilityRole="button" style={s.smallBtn} onPress={() => call(r.phone)} accessibilityLabel={t('ca_call', { phone: formatPhone(r.phone) })}>
                    <Text maxFontSizeMultiplier={1.3} style={s.smallText}>📞 {formatPhone(r.phone)}</Text>
                  </TouchableOpacity>
                )}
                {!!websiteUrl(r.website) && (
                  <TouchableOpacity accessibilityRole="link" style={s.smallBtn} onPress={() => open(r.website)}>
                    <Text maxFontSizeMultiplier={1.3} style={s.smallText}>{t('ca_website')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <SourceLine source={r.source.label} recorded={r.source.recorded_at} verified={r.source.last_verified_at} />
            </View>
          ))}
        </View>
      )}

      {members.length > 0 && (
        <TouchableOpacity accessibilityRole="button" testID="hague-open-lookup" style={s.primary} onPress={() => setPhase('lookup')}
          accessibilityLabel={t('x_hague_contact_look_up_destination_country')}>
          <Text maxFontSizeMultiplier={1.3} style={s.primaryText}>{t('x_hague_contact_find_destination_country_authority')}</Text>
        </TouchableOpacity>
      )}
      <Text maxFontSizeMultiplier={1.3} style={[s.muted, { marginTop: 18 }]}>{t('x_hague_contact_justice_gavel_provides_contact')}</Text>
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 60, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  heading: { fontSize: 21, fontWeight: '800', color: c.textPrimary, marginBottom: 6 },
  sub: { fontSize: 14, color: c.textSecond, lineHeight: 20, marginBottom: 8 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: c.border, gap: 6 },
  emergency: { borderColor: c.emergency, borderWidth: 1.5 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary },
  name: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
  note: { fontSize: 13, lineHeight: 19 },
  callBtn: { backgroundColor: c.emergencyDark, borderRadius: 10, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  callText: { color: c.white, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 14, color: c.textBrand, fontWeight: '700', textDecorationLine: 'underline' },
  resource: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, gap: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, justifyContent: 'center' },
  smallText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  country: { minHeight: 48, justifyContent: 'center', backgroundColor: c.bgCard, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 8, borderWidth: 1, borderColor: c.border },
  countryOn: { borderColor: c.navy, backgroundColor: c.bgSubtle },
  countryText: { fontSize: 15, color: c.textPrimary },
  label: { fontSize: 13, fontWeight: '700', color: c.textPrimary, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: c.bgCard, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 15, color: c.textPrimary, borderWidth: 1, borderColor: c.border },
  tag: { backgroundColor: c.bgSubtle, borderRadius: 8, padding: 10, fontSize: 14, color: c.textPrimary, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bgCard },
  chipOn: { borderColor: c.navy, backgroundColor: c.navy },
  chipText: { fontSize: 13, color: c.textSecond, fontWeight: '600' },
  chipTextOn: { color: c.textOnNavy },
  error: { color: c.emergencyDark, fontSize: 13, marginTop: 10 },
  primary: { backgroundColor: c.navy, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingHorizontal: 12 },
  primaryText: { color: c.textOnNavy, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.navy, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: c.textBrand, fontSize: 15, fontWeight: '700' },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 6 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.navy, color: c.textOnNavy, textAlign: 'center', fontWeight: '800', fontSize: 12, lineHeight: 24, overflow: 'hidden' },
  stepText: { flex: 1, fontSize: 14, color: c.textPrimary, lineHeight: 20 },
  muted: { fontSize: 12, lineHeight: 17, color: c.textMuted },
});

export default React.memo(HagueContactScreen);
