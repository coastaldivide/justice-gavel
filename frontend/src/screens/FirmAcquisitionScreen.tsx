/**
 * FirmAcquisitionScreen — start a firm workspace and run it during the free trial.
 *
 *   GET  /firm-acquisition/status     the firm, trial days left / ended, seats, matters
 *   POST /firm-acquisition/trial      attorney accounts: create the firm + the trial (no card)
 *   GET  /firm-acquisition/checklist  onboarding steps worked out from the firm's own data
 *   POST /firm-acquisition/invite     firm admin: invite a colleague (seat limit)
 *   GET  /firm-acquisition/invites    invitations for this account; accept to join
 *   POST /firm-acquisition/upgrade    ask for a paid firm plan (a request — nothing is charged)
 * There is no paid firm plan to convert to yet: the trial ends without a charge and the
 * firm keeps its data (the screen says so). Every message comes from the server in the
 * app's language.
 */
import React, { useCallback, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useStoredUser, isAttorneyUser } from '../hooks/useStoredUser';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS, AppIcon } from '../components/AppIcon';

const VERTICALS = ['criminal_defense', 'civil_rights', 'white_collar', 'family', 'immigration', 'personal_injury', 'public_defense', 'appellate', 'military', 'juvenile', 'general'] as const;
const ORG_TYPES = ['law_firm', 'solo', 'public_defender', 'legal_aid', 'nonprofit', 'government', 'other'] as const;
const PLAN_TIERS = ['standard', 'mission', 'government', 'enterprise'] as const;
const INVITE_ROLES = ['associate', 'partner', 'paralegal'] as const;

type Status = {
  has_firm: boolean; trials_left?: number; role?: string;
  firm?: { id: number; name: string; vertical: string; pricing_tier: string; plan: string; seat_limit: number };
  trial_active?: boolean; trial_ended?: boolean; trial_days?: number; trial_seats?: number; trial_end?: string | null; trial_days_left?: number;
  member_count?: number; matter_count?: number; pending_invites?: number;
  upgrade_request?: { target_tier: string; status: string; created_at: string } | null;
};
type Invite = { id: number; role: string; firm_name: string; invited_by_name: string | null; expires_at: string };
type Step = { key: 'vertical_set' | 'team_invited' | 'first_matter'; done: boolean };
const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const ADMIN_ROLES = new Set(['firm_admin', 'admin', 'owner']);
const PARTNER_ROLES = new Set(['partner', 'managing_partner', 'firm_admin', 'admin', 'owner', 'lead_attorney']);

function FirmAcquisitionScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const { hasSession, recheck } = useHasSession();
  const { user, ready } = useStoredUser();
  const [status, setStatus] = useState<Status | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [firmName, setFirmName] = useState('');
  const [vertical, setVertical] = useState<(typeof VERTICALS)[number]>('criminal_defense');
  const [orgType, setOrgType] = useState<(typeof ORG_TYPES)[number]>('law_firm');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof INVITE_ROLES)[number]>('associate');

  const load = useCallback(async () => {
    try {
      const [st, cl, inv] = await Promise.all([
        api.get<Status>('/firm-acquisition/status'),
        api.get('/firm-acquisition/checklist'),
        api.get('/firm-acquisition/invites'),
      ]);
      setStatus(st.data);
      setSteps((cl.data?.checklist || []) as Step[]);
      setInvites((inv.data?.invites || []) as Invite[]);
    } catch (e) { setNotice({ text: apiErrorMessage(e, t('fa_load_error')), tone: 'error' }); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (hasSession && isAttorneyUser(user)) load(); }, [hasSession, user, load]));

  const run = async (key: string, fn: () => Promise<{ data?: { message?: string } }>, after?: () => void) => {
    setBusy(key); setNotice(null);
    try { const r = await fn(); setNotice({ text: r.data?.message || t('fa_done'), tone: 'ok' }); after?.(); load(); }
    catch (e) { setNotice({ text: apiErrorMessage(e, t('fa_failed')), tone: 'error' }); }
    finally { setBusy(null); }
  };
  const startTrial = () => {
    if (firmName.trim().length < 2) { setNotice({ text: t('x_firm_acquisition_firm_name_must_be'), tone: 'error' }); return; }
    run('trial', () => api.post('/firm-acquisition/trial', { firm_name: firmName.trim(), vertical, org_type: orgType }), () => setFirmName(''));
  };
  const invite = () => run('invite', () => api.post('/firm-acquisition/invite', { email: inviteEmail.trim(), role: inviteRole }), () => setInviteEmail(''));
  const accept = (inv: Invite) => confirm(t('fa_join_title', { firm: inv.firm_name }), t('fa_join_body'), { confirmLabel: t('fa_join_cta') })
    .then(ok => { if (ok) run(`inv${inv.id}`, () => api.post(`/firm-acquisition/invites/${inv.id}/accept`, {})); });
  const requestPlan = (tier: (typeof PLAN_TIERS)[number]) => run(`plan-${tier}`, () => api.post('/firm-acquisition/upgrade', { target_tier: tier }));

  if (hasSession === false) return <View style={{ flex: 1, backgroundColor: colors.bg }}><SignInNeeded navigation={navigation} title={t('x_nav_start_firm_trial')} body={t('fa_signin_body')} onSignedIn={recheck} /></View>;
  if (hasSession === null || !ready) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  if (!isAttorneyUser(user)) {
    return <View testID="firm-acquisition-not-attorney" style={[s.center, { backgroundColor: colors.bg, padding: 24 }]}><Text maxFontSizeMultiplier={1.4} style={[s.title, { textAlign: 'center' }]}>{t('fa_attorney_only')}</Text></View>;
  }
  if (!status) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;

  const f = status.firm;
  const canInvite = !!status.role && ADMIN_ROLES.has(status.role);
  const canRequest = !!status.role && PARTNER_ROLES.has(status.role);
  return (
    <ScrollView testID="firm-acquisition-screen" style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {!!notice && (
        <View testID="fa-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger, fontSize: 14, lineHeight: 20 }}>{notice.text}</Text>
        </View>
      )}
      {invites.map(inv => (
        <View key={inv.id} style={s.card} testID="fa-invite">
          <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('fa_invited', { firm: inv.firm_name })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('fa_invited_by', { name: inv.invited_by_name || '', role: t(`fa_role_${inv.role}`), date: fmtDay(inv.expires_at) })}</Text>
          <TouchableOpacity accessibilityRole="button" testID="fa-invite-accept" style={s.primaryBtn} disabled={busy !== null} onPress={() => accept(inv)}>
            <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('fa_join_cta')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!status.has_firm || !f ? (
        <View style={s.card} testID="fa-start">
          <Text maxFontSizeMultiplier={1.4} style={s.h1}>{t('x_firm_acquisition_activate_trial')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('fa_trial_terms', { days: status.trial_days ?? '', seats: status.trial_seats ?? '' })}</Text>
          {status.trials_left === 0 ? <Text maxFontSizeMultiplier={1.4} style={[s.line, { color: colors.danger }]}>{t('fa_no_trials_left')}</Text> : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('x_firm_acquisition_firm_name')}</Text>
              <TextInput testID="fa-firm-name" style={s.field} value={firmName} onChangeText={setFirmName} maxLength={200} placeholder={t('x_firm_acquisition_e_g_harrington_voss')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('x_firm_acquisition_firm_name')} />
              <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('fa_practice_area')}</Text>
              <View style={s.chips}>
                {VERTICALS.map(v => (
                  <TouchableOpacity key={v} accessibilityRole="radio" aria-checked={vertical === v} accessibilityState={{ checked: vertical === v }} testID={`fa-vertical-${v}`}
                    style={[s.chip, vertical === v && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setVertical(v)}>
                    <Text maxFontSizeMultiplier={1.2} style={[s.chipText, vertical === v && { color: colors.textOnNavy }]}>{t(`fa_v_${v}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('fa_org_type')}</Text>
              <View style={s.chips}>
                {ORG_TYPES.map(o => (
                  <TouchableOpacity key={o} accessibilityRole="radio" aria-checked={orgType === o} accessibilityState={{ checked: orgType === o }}
                    style={[s.chip, orgType === o && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setOrgType(o)}>
                    <Text maxFontSizeMultiplier={1.2} style={[s.chipText, orgType === o && { color: colors.textOnNavy }]}>{t(`fa_org_${o}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity accessibilityRole="button" testID="fa-start-trial" style={[s.primaryBtn, busy === 'trial' && { opacity: 0.6 }]} disabled={busy !== null} onPress={startTrial}>
                {busy === 'trial' ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_firm_acquisition_activate_free_trial')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <>
          <View style={s.card} testID="fa-status">
            <Text maxFontSizeMultiplier={1.4} style={s.h1}>{f.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t(`fa_v_${(VERTICALS as readonly string[]).includes(f.vertical) ? f.vertical : 'general'}`)}</Text>
            {status.trial_active ? (
              <IconLabel icon={ICONS.clock} textStyle={[s.badge, { backgroundColor: colors.legalBg, color: colors.legal }]} maxFontSizeMultiplier={1.4} testID="fa-trial">{t(status.trial_days_left === 1 ? 'x_firm_acquisition_trial_day_remaining_one' : 'x_firm_acquisition_trial_day_remaining_other', { trial_days_left: status.trial_days_left })}</IconLabel>
            ) : status.trial_ended ? (
              <Text maxFontSizeMultiplier={1.4} testID="fa-trial-ended" style={[s.badge, { backgroundColor: colors.warnBg, color: colors.warnDark }]}>{t('fa_trial_ended', { date: fmtDay(status.trial_end) })}</Text>
            ) : null}
            <View style={s.statsRow}>
              {[[`${status.member_count ?? 0}/${f.seat_limit}`, t('fa_seats')], [String(status.matter_count ?? 0), t('x_firm_acquisition_matters')], [String(status.pending_invites ?? 0), t('fa_pending_invites')]].map(([v, l]) => (
                <View key={l} style={s.stat}><Text maxFontSizeMultiplier={1.2} style={s.statVal}>{v}</Text><Text maxFontSizeMultiplier={1.2} style={s.statLabel}>{l}</Text></View>
              ))}
            </View>
          </View>

          <View style={s.card} testID="fa-checklist">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('x_firm_acquisition_getting_started')}</Text>
            {steps.map(st => (
              <TouchableOpacity key={st.key} accessibilityRole="button" accessibilityState={{ checked: st.done }} style={s.step} onPress={() => {
                if (st.key === 'vertical_set') navigation.navigate('FirmVertical' as never);
                else if (st.key === 'first_matter') navigation.navigate('MatterIntelligence' as never);
              }} disabled={st.key === 'team_invited'}>
                <AppIcon name={st.done ? ICONS.statusOk : ICONS.checkboxEmpty} size={18} color={st.done ? colors.legal : colors.textMuted} style={s.stepIcon} />
                <Text maxFontSizeMultiplier={1.4} style={[s.line, { flex: 1 }, st.done && { textDecorationLine: 'line-through' }]}>{t(`fa_step_${st.key}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {canInvite && (
            <View style={s.card} testID="fa-invite-form">
              <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('fa_invite_title')}</Text>
              <TextInput testID="fa-invite-email" style={[s.field, { marginTop: 8 }]} value={inviteEmail} onChangeText={setInviteEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200}
                placeholder={t('fa_invite_email')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('fa_invite_email')} />
              <View style={s.chips}>
                {INVITE_ROLES.map(r => (
                  <TouchableOpacity key={r} accessibilityRole="radio" aria-checked={inviteRole === r} accessibilityState={{ checked: inviteRole === r }}
                    style={[s.chip, inviteRole === r && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setInviteRole(r)}>
                    <Text maxFontSizeMultiplier={1.2} style={[s.chipText, inviteRole === r && { color: colors.textOnNavy }]}>{t(`fa_role_${r}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity accessibilityRole="button" testID="fa-invite-send" style={[s.ghostBtn, (!inviteEmail.trim() || busy !== null) && { opacity: 0.5 }]} disabled={!inviteEmail.trim() || busy !== null} onPress={invite}>
                <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('fa_invite_send')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={s.card} testID="fa-plans">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{t('fa_plans_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('fa_plans_body')}</Text>
            {status.upgrade_request && <Text maxFontSizeMultiplier={1.4} style={[s.line, { color: colors.legal }]}>{t('fa_plan_requested', { plan: t(`fa_tier_${status.upgrade_request.target_tier}`), date: fmtDay(status.upgrade_request.created_at) })}</Text>}
            {canRequest ? (
              <View style={s.chips}>
                {PLAN_TIERS.map(tier => (
                  <TouchableOpacity key={tier} accessibilityRole="button" testID={`fa-plan-${tier}`} style={[s.chip, busy === `plan-${tier}` && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => requestPlan(tier)}>
                    <Text maxFontSizeMultiplier={1.2} style={s.chipText}>{t(`fa_tier_${tier}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : <Text maxFontSizeMultiplier={1.3} style={s.line}>{t('fa_plans_partner')}</Text>}
          </View>

          <View style={s.chipsPadded}>
            {[['ConflictCheck', t('x_nav_conflict_check')], ['DeadlineCalculator', t('x_firm_acquisition_deadline_calculator')], ['FirmVertical', t('x_firm_acquisition_configure_vertical')]].map(([screen, label]) => (
              <TouchableOpacity key={screen} accessibilityRole="button" style={s.ghostBtn} onPress={() => navigation.navigate(screen as never)}>
                <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{label} ›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  h1: { fontSize: 20, ...FONTS.black, color: colors.textBrand, marginBottom: 4 },
  title: { fontSize: 16, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 14, lineHeight: 20, color: colors.textSecond, marginTop: 4 },
  label: { fontSize: 13, ...FONTS.semi, color: colors.textSecond, marginTop: 12, marginBottom: 4 },
  field: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 10, minHeight: 44, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chipsPadded: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginHorizontal: 12 },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bgCard },
  chipText: { fontSize: 13, ...FONTS.semi, color: colors.textSecond },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 12 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.bgCard },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  badge: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, fontSize: 13, ...FONTS.bold, overflow: 'hidden' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: colors.bgSubtle, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  statVal: { fontSize: 18, ...FONTS.black, color: colors.textBrand },
  statLabel: { fontSize: 12, color: colors.textSecond, textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
  stepIcon: { marginRight: 2 },
});

export default React.memo(FirmAcquisitionScreen);
