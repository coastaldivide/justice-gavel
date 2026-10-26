/**
 * ExpungementScreen — what the recorded rule says about clearing a record
 *
 * Entry points: Home "Clear record" tile, a closed case's "Expunge" action
 * (CaseScreen passes the case's state), /expungement.
 *
 * Flow: state + how the case ended + kind of charge → GET /expungement/check →
 * the recorded rule for that state, shown with the statute it names (its only
 * source), the date it was recorded and "not reviewed by a lawyer". A rule that
 * names no statute, or contradicts itself, gives no verdict (the note is shown as
 * unreviewed text); an unknown charge or an open case says so. Waiting periods
 * appear only with a sourced verdict. Lawyers in the state come from the real
 * directory (read only). The petition draft is AI and signed-in only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useTheme, RADIUS, FONTS, SHADOW } from '../constants/theme';
import { RNShare } from '../utils/webCompat';
import { getUserState, stateName } from '../utils/userState';
import { useToast } from '../components/ToastProvider';
import { useAuthGate } from '../components/AuthGate';
import { useHasSession } from '../components/SignInNeeded';
import { ContactActions } from '../components/ContactActions';
import { StatePicker } from '../components/StatePicker';
import { SourceLine, UnreviewedNotice } from '../components/LegalSource';
import { t, useLang, getLang } from '../i18n';
import { ICONS, AppIcon, type IconName, IconLabel } from '../components/AppIcon';
import { Analytics } from '../services/analytics';

type Status = 'Dismissed' | 'Convicted' | 'Open';
type ChargeType = 'misdemeanor' | 'felony' | 'dui' | 'domestic' | 'sexual' | 'unknown';
type Result = 'eligible' | 'conditional' | 'not_eligible' | 'unsourced' | 'needs_review' | 'unknown' | 'case_open';

interface CheckResult {
  state: string; stateName: string; chargeType: string; status: Status;
  eligibility: { result: Result; waitYears: number | null; note: string | null; citation: string | null };
  notes_lang: string;
  source: { label: string | null; citation: string | null; recorded_at: string | null; reviewed: boolean };
  partners: { key: string; name: string; url: string }[];
  disclaimer: string;
}
interface Attorney { id: number; name: string; city?: string | null; phone?: string | null; address?: string | null; lat?: number | null; lng?: number | null; website?: string | null }

const STATUSES: { value: Status; key: string }[] = [ // i18n-exempt: values sent to the server; labels are the keys
  { value: 'Dismissed', key: 'x_exp_status_dismissed' }, // i18n-exempt: value
  { value: 'Convicted', key: 'exp_status_convicted' }, // i18n-exempt: value
  { value: 'Open', key: 'x_exp_status_still_open' }, // i18n-exempt: value
];
const TYPES: { value: ChargeType; key: string }[] = [
  { value: 'misdemeanor', key: 'exp_type_misdemeanor' },
  { value: 'felony', key: 'exp_type_felony' },
  { value: 'dui', key: 'x_exp_ch_dui' },
  { value: 'domestic', key: 'x_exp_ch_dv' },
  { value: 'sexual', key: 'exp_type_sexual' },
  { value: 'unknown', key: 'exp_type_unknown' },
];
const VERDICT: Record<Result, { icon: IconName; key: string; tone: 'legal' | 'warn' | 'emergency' | 'muted' }> = {
  eligible:     { icon: ICONS.statusOk, key: 'exp_r_eligible', tone: 'legal' },
  conditional:  { icon: ICONS.statusWarn, key: 'exp_r_conditional', tone: 'warn' },
  not_eligible: { icon: ICONS.statusError, key: 'exp_r_not_eligible', tone: 'emergency' },
  unsourced:    { icon: ICONS.statusUnknown, key: 'exp_r_unsourced', tone: 'muted' },
  needs_review: { icon: ICONS.statusUnknown, key: 'exp_r_needs_review', tone: 'muted' },
  unknown:      { icon: ICONS.statusUnknown, key: 'exp_r_unknown', tone: 'muted' },
  case_open:    { icon: ICONS.hourglass, key: 'exp_r_case_open', tone: 'muted' },
};
const typeLabel = (c: string) => {
  const hit = TYPES.find(x => x.value === c);
  return hit ? t(hit.key) : c === 'dismissed' ? t('x_exp_status_dismissed') : c;
};

function ExpungementScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const { showToast } = useToast();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { hasSession } = useHasSession();
  const params = (route?.params || {}) as { state?: string; incomingState?: string; charge?: string; case_id?: number | string };
  const incomingState = String(params.state || params.incomingState || '').toUpperCase();
  const incomingCharge = params.charge || '';

  const [state, setState] = useState(incomingState);
  const [status, setStatus] = useState<Status>('Convicted');
  const [type, setType] = useState<ChargeType | ''>('');
  const [charges, setCharges] = useState(incomingCharge);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [attorneys, setAttorneys] = useState<Attorney[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!incomingState) getUserState().then(s => { if (s?.code && mounted.current) setState(prev => prev || s.code); }).catch(() => {});
  }, [incomingState]);

  // Tells the nightly scheduler not to send the "you may be able to clear your record" push again.
  useEffect(() => { if (hasSession) api.post('/expungement/log-visit').catch(() => {}); }, [hasSession]);
  useEffect(() => { Analytics.track('record_check_started', { signed_in: !!hasSession }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useCallback(async () => {
    if (!state) { setError(t('x_expungement_please_select_state_first')); return; }
    setError(''); setLoading(true); setAttorneys([]);
    try {
      const query: Record<string, string> = { state, status, lang: getLang() };
      if (status === 'Convicted' && type) query.type = type;
      if (status === 'Convicted' && !type && charges.trim()) query.charges = charges.trim();
      const res = await api.get<CheckResult>('/expungement/check', { params: query });
      if (!mounted.current) return;
      setResult(res.data);
      if (['eligible', 'conditional', 'not_eligible', 'unsourced', 'needs_review'].includes(res.data.eligibility.result)) {
        setAttLoading(true);
        api.get<{ attorneys: Attorney[] }>('/expungement/attorneys', { params: { state, limit: 5 } })
          .then(r => { if (mounted.current) setAttorneys(r.data?.attorneys || []); })
          .catch(() => { if (mounted.current) setAttorneys([]); })
          .finally(() => { if (mounted.current) setAttLoading(false); });
      }
    } catch (e) {
      if (mounted.current) setError(apiErrorMessage(e, t('x_expungement_could_not_check_eligibility')));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [state, status, type, charges]);

  // From a case with both a state and a charge: show the answer straight away.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRan.current && incomingState && incomingCharge) { autoRan.current = true; check(); }
  }, [incomingState, incomingCharge, check]);

  const makeDraft = () => requireAuth(async () => {
    if (!result) return;
    setDrafting(true);
    try {
      const r = await api.post<{ draft: string }>('/expungement/petition', {
        state: result.state,
        charge_type: result.chargeType === 'dismissed' ? t('x_exp_status_dismissed') : (charges.trim() || result.chargeType),
        case_number: params.case_id ? String(params.case_id) : '',
      });
      if (mounted.current) setDraft(r.data?.draft || '');
    } catch (e) {
      showToast(apiErrorMessage(e, t('exp_draft_failed')), 'error');
    } finally {
      if (mounted.current) setDrafting(false);
    }
  });

  const toneColor = (tone: 'legal' | 'warn' | 'emergency' | 'muted') =>
    tone === 'legal' ? { fg: colors.legalDark, bg: colors.legalBg } : tone === 'warn' ? { fg: colors.warnDark, bg: colors.warnBg }
      : tone === 'emergency' ? { fg: colors.emergencyDark, bg: colors.emergencyBg } : { fg: colors.textPrimary, bg: colors.bgSubtle };

  // ── Result ────────────────────────────────────────────────────────────────
  if (result) {
    const e = result.eligibility;
    const v = VERDICT[e.result];
    const tone = toneColor(v.tone);
    const sourced = ['eligible', 'conditional', 'not_eligible'].includes(e.result);
    const showLawyers = e.result !== 'unknown' && e.result !== 'case_open';
    return (
      <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} testID="expungement-result-screen">
        <View style={[styles.verdict, { backgroundColor: tone.bg, borderColor: tone.fg }]}>
          <AppIcon name={v.icon} size={22} color={colors.textBrand} style={styles.verdictIcon} />
          <Text testID="expungement-verdict" maxFontSizeMultiplier={1.4} style={[styles.verdictLabel, { color: tone.fg }]}>{t(v.key)}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.verdictMeta}>{stateName(result.state, result.stateName)} · {typeLabel(result.chargeType)}</Text>
          {e.waitYears != null && e.waitYears > 0 && (
            <Text testID="expungement-wait-years" maxFontSizeMultiplier={1.4} style={[styles.verdictWait, { color: tone.fg }]}>
              {t(e.waitYears === 1 ? 'exp_wait_one' : 'exp_wait_other', { n: e.waitYears })}
            </Text>
          )}
        </View>

        {!!e.note && (
          <View style={styles.card} testID="expungement-rule">
            <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>{sourced ? t('exp_rule_title') : t('exp_rule_title_unsourced')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.body}>{e.note}</Text>
            <SourceLine source={result.source.label} recorded={result.source.recorded_at} testID="expungement-source" />
            {result.notes_lang === 'en' && getLang() !== 'en' && <Text maxFontSizeMultiplier={1.3} style={styles.muted}>{t('pen_notes_english')}</Text>}
          </View>
        )}
        <UnreviewedNotice inset={false} text={t('exp_not_reviewed')} testID="expungement-notice" />

        {e.result === 'case_open' && <Text maxFontSizeMultiplier={1.4} style={styles.bodyPad}>{t('exp_case_open_body')}</Text>}
        {e.result === 'unknown' && <Text maxFontSizeMultiplier={1.4} style={styles.bodyPad}>{t('exp_unknown_body')}</Text>}
        {(e.result === 'unsourced' || e.result === 'needs_review') && <Text maxFontSizeMultiplier={1.4} style={styles.bodyPad}>{t('exp_unsourced_body')}</Text>}

        {sourced && e.result !== 'not_eligible' && (
          <View style={styles.card}>
            <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>{t('x_expungement_what_does_expungement_do')}</Text>
            {([['x_expungement_seals_arrest_from_most', ICONS.lock], ['x_expungement_employers_landlords_lenders_cannot', ICONS.briefcase], ['x_expungement_can_legally_say_i', ICONS.checkOutline], ['x_expungement_court_record_still_exists', ICONS.courthouse]] as const)
              .map(([k, icon]) => <IconLabel key={k} icon={icon} maxFontSizeMultiplier={1.4} textStyle={styles.body}>{t(k)}</IconLabel>)}
          </View>
        )}

        {e.result === 'not_eligible' && (
          <View style={styles.card} testID="expungement-not-eligible">
            <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>{t('x_expungement_what_can_still_do')}</Text>
            {([['x_expungement_speak_defense_attorney_some', ICONS.lawyer], ['x_expungement_apply_certificate_relief_limits', ICONS.clipboard], ['x_expungement_apply_governor_s_pardon', ICONS.courthouse], ['x_expungement_check_back_when_waiting', ICONS.hourglass]] as const)
              .map(([k, icon]) => <IconLabel key={k} icon={icon} maxFontSizeMultiplier={1.4} textStyle={styles.body}>{t(k)}</IconLabel>)}
          </View>
        )}

        {showLawyers && (
          <View testID="expungement-attorneys">
            <Text maxFontSizeMultiplier={1.4} style={styles.section}>{t('x_expungement_expungement_attorneys', { value: stateName(result.state, result.stateName) })}</Text>
            {attLoading && <ActivityIndicator color={colors.textBrand} style={{ marginVertical: 12 }} />}
            {!attLoading && attorneys.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.bodyPad}>{t('exp_no_lawyers')}</Text>}
            {!attLoading && attorneys.map(a => (
              <View key={a.id} style={styles.card} testID="expungement-attorney">
                <TouchableOpacity accessibilityRole="link" onPress={() => navigation.navigate('LawyerProfile', { lawyerId: a.id })}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cardTitle, { color: colors.textBrand }]}>{a.name} ›</Text>
                </TouchableOpacity>
                {!!a.city && <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{a.city}</Text>}
                <ContactActions listing={a} />
              </View>
            ))}
            {!attLoading && attorneys.length === 0 && result.partners.map(p => (
              <TouchableOpacity key={p.key} accessibilityRole="link" style={styles.secondaryBtn} onPress={() => Linking.openURL(p.url).catch(() => showToast(t('action_failed'), 'error'))}>
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>{t('exp_partner_open', { name: p.name })}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {sourced && e.result !== 'not_eligible' && (
          <TouchableOpacity accessibilityRole="button" testID="expungement-draft" style={[styles.primaryBtn, drafting && { opacity: 0.6 }]} disabled={drafting} onPress={makeDraft}>
            {drafting ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{t('x_expungement_generate_petition_draft')}</Text>}
          </TouchableOpacity>
        )}
        {sourced && e.result !== 'not_eligible' && hasSession === false && <Text maxFontSizeMultiplier={1.3} style={styles.muted}>{t('exp_draft_sign_in')}</Text>}

        <TouchableOpacity accessibilityRole="button" testID="expungement-find-lawyer" style={styles.secondaryBtn} onPress={() => navigation.navigate('LawyersTab')}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>{t('x_expungement_find_criminal_defense_lawyer')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="expungement-start-over" style={styles.secondaryBtn} onPress={() => { setResult(null); setDraft(''); }}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>{t('exp_check_another')}</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={styles.disclaimer}>{result.disclaimer}</Text>

        <Modal visible={!!draft} animationType="slide" onRequestClose={() => setDraft('')}>
          <View style={{ flex: 1, backgroundColor: colors.bg }} testID="expungement-draft-modal">
            <View style={[styles.modalBar, { borderBottomColor: colors.border }]}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_expungement_close_petition_draft')} onPress={() => setDraft('')} style={styles.barBtn}>
                <Text maxFontSizeMultiplier={1.3} style={styles.barText}>{t('x_expungement_close')}</Text>
              </TouchableOpacity>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} numberOfLines={1}>{t('x_expungement_petition_draft')}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_expungement_share_petition_draft')} style={styles.barBtn}
                onPress={() => { RNShare.share({ message: draft, title: t('x_expungement_expungement_petition_draft') }).catch(() => showToast(t('action_failed'), 'error')); }}>
                <Text maxFontSizeMultiplier={1.3} style={styles.barText}>{t('share')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <UnreviewedNotice inset={false} text={t('x_legal_notice_ai_generated_draft_not')} testID="expungement-draft-notice" />
              <Text maxFontSizeMultiplier={1.4} selectable style={[styles.body, { fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, marginTop: 12 }]}>{draft}</Text>
            </ScrollView>
          </View>
        </Modal>
        <AuthGateModal />
      </ScrollView>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID="expungement-screen">
        <View style={styles.hero}>
          <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>{t('x_expungement_could_record_be_cleared')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>{t('exp_hero_sub')}</Text>
        </View>

        <View style={[styles.juvenile, { backgroundColor: colors.warnBg, borderLeftColor: colors.warnDark }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('x_expungement_under_18_have_juvenile')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('exp_juvenile_body')}</Text>
          <TouchableOpacity accessibilityRole="link" testID="expungement-juvenile-link" onPress={() => navigation.navigate('JuvenileJustice', { tab: 'sealing' })}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.body, { color: colors.textBrand, fontWeight: '700' }]}>{t('exp_juvenile_link')}</Text>
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('div_your_state')}</Text>
        <StatePicker value={state} onChange={(c) => { setState(c); setError(''); }} testID="expungement-state-picker" />

        <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_expungement_case_outcome')}</Text>
        <View style={styles.chips}>
          {STATUSES.map(s => (
            <TouchableOpacity key={s.value} accessibilityRole="radio" aria-checked={status === s.value} testID={`expungement-status-${s.value}`}
              style={[styles.chip, status === s.value && styles.chipOn]} onPress={() => setStatus(s.value)}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, status === s.value && styles.chipTextOn]}>{t(s.key)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {status === 'Convicted' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('exp_type_label')}</Text>
            <View style={styles.chips}>
              {TYPES.map(c => (
                <TouchableOpacity key={c.value} accessibilityRole="radio" aria-checked={type === c.value} testID={`expungement-type-${c.value}`}
                  style={[styles.chip, type === c.value && styles.chipOn]} onPress={() => setType(type === c.value ? '' : c.value)}>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, type === c.value && styles.chipTextOn]}>{t(c.key)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!type && (
              <TextInput testID="expungement-charges-input" accessibilityLabel={t('x_expungement_describe_charges')}
                style={styles.input} placeholder={t('x_expungement_type_charge_e_g')} placeholderTextColor={colors.textMuted}
                value={charges} onChangeText={setCharges} maxLength={300} returnKeyType="done" />
            )}
          </>
        )}

        {!!error && <Text testID="expungement-error" maxFontSizeMultiplier={1.4} style={styles.error}>{error}</Text>}
        <TouchableOpacity accessibilityRole="button" testID="expungement-check-button" style={[styles.primaryBtn, loading && { opacity: 0.6 }]} onPress={check} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{t('x_expungement_check_my_eligibility')}</Text>}
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={styles.disclaimer}>{t('x_expungement_free_eligibility_check_no')}</Text>
        <UnreviewedNotice inset={false} text={t('exp_not_reviewed')} testID="expungement-form-notice" />
        <AuthGateModal />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  hero: { backgroundColor: c.navy, borderRadius: RADIUS.xl, padding: 20, marginBottom: 12, alignItems: 'center', ...SHADOW.md },
  heroTitle: { fontSize: 20, ...FONTS.black, color: c.textOnNavy, textAlign: 'center', marginBottom: 8 },
  heroSub: { fontSize: 13, color: c.textOnNavy, textAlign: 'center', lineHeight: 19 },
  juvenile: { borderRadius: 12, padding: 14, borderLeftWidth: 4, gap: 6 },
  label: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: c.textBrand, marginBottom: 8, marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bgCard },
  chipOn: { borderColor: c.navy, backgroundColor: c.navy },
  chipText: { fontSize: 13, color: c.textSecond, ...FONTS.semi },
  chipTextOn: { color: c.textOnNavy },
  input: { marginTop: 10, backgroundColor: c.bgCard, borderWidth: 1.5, borderColor: c.border, borderRadius: RADIUS.md, paddingHorizontal: 14, minHeight: 48, fontSize: 14, color: c.textPrimary },
  error: { color: c.emergencyDark, fontSize: 13, marginTop: 12 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: RADIUS.lg, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingHorizontal: 16 },
  primaryText: { color: c.textOnNavy, fontSize: 16, ...FONTS.black, textAlign: 'center' },
  secondaryBtn: { borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.navy, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12 },
  secondaryText: { color: c.textBrand, fontSize: 14, ...FONTS.heavy, textAlign: 'center' },
  disclaimer: { fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 14, lineHeight: 16 },
  verdict: { borderRadius: RADIUS.xl, borderWidth: 2, padding: 18, alignItems: 'center', marginBottom: 12 },
  verdictIcon: { fontSize: 40, marginBottom: 4 },
  verdictLabel: { fontSize: 19, ...FONTS.black, textAlign: 'center', marginBottom: 4 },
  verdictMeta: { fontSize: 13, color: c.textSecond, textAlign: 'center' },
  verdictWait: { fontSize: 13, ...FONTS.semi, marginTop: 6, textAlign: 'center' },
  card: { backgroundColor: c.bgCard, borderRadius: RADIUS.lg, padding: 14, marginTop: 10, borderWidth: 1, borderColor: c.border, gap: 6 },
  cardTitle: { fontSize: 15, lineHeight: 21, ...FONTS.heavy, color: c.textPrimary },
  section: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: c.textBrand, marginTop: 18 },
  body: { fontSize: 13, lineHeight: 20, color: c.textSecond },
  bodyPad: { fontSize: 13, lineHeight: 20, color: c.textSecond, marginTop: 10 },
  muted: { fontSize: 12, lineHeight: 17, color: c.textMuted },
  modalBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderBottomWidth: 1 },
  barBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: 'center' },
  barText: { fontSize: 15, color: c.textBrand, fontWeight: '700' },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: c.textPrimary, textAlign: 'center' },
});

export default React.memo(ExpungementScreen);
