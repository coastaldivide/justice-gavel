/**
 * Recovery tab of a bond (routes/bondDesk/watch.js; ⚖ server setting BOND_RECOVERY_SHARING_ENABLED —
 * shown only when GET /bond-desk/access says it is on): share ONE forfeited bond with a recovery
 * agent by e-mail invite. Shows the state's recovery-agent rule as we recorded it (with how it was
 * checked, or "not verified"), which the agent must acknowledge; the shares with their status; and
 * every time the recovery agent looked at the file. Access ends when the bond is reinstated or
 * discharged, or when the agent stops sharing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../../hooks/useConfirm';
import { t, useLang } from '../../i18n';
import { useTheme } from '../../constants/theme';
import { Btn, Card, Check, Field, Line, Notice, Pill, Row } from './ui';
import { type BondDetail, type RecoveryShare, type RecoveryView, type StateRule, fmtWhen, tOr } from '../../services/bondDesk';

const statusTone = (s: RecoveryShare['status']) => (s === 'active' ? 'ok' : s === 'invited' ? 'warn' : 'muted');

/** The state's rule as recorded, with how it was checked. */
export function StateRuleCard({ rule, state }: { rule: StateRule | null; state: string | null }) {
  useLang();
  const { colors } = useTheme();
  if (!state) return <Card title={t('bdr_rule_title')} testID="recovery-rule"><Line tone="warn">{t('bdr_rule_no_state')}</Line></Card>;
  if (!rule) return <Card title={t('bdr_rule_title')} testID="recovery-rule"><Line tone="warn">{t('bdr_rule_none', { state })}</Line></Card>;
  return (
    <Card title={t('bdr_rule_state', { state: rule.state })} testID="recovery-rule">
      {rule.allowed === false && <Line tone="danger" testID="recovery-rule-banned">{t('bdr_rule_banned', { state: rule.state })}</Line>}
      <Line tone={rule.checked === 'unverified' ? 'warn' : undefined} testID="recovery-rule-checked">
        {t(rule.checked === 'unverified' ? 'bdr_rule_unverified' : 'bdr_rule_secondary')}
      </Line>
      {!!rule.law && <Row label={t('bdr_rule_law')} value={rule.law} />}
      {!!rule.agency && <Row label={t('bdr_rule_agency')} value={rule.agency} />}
      {!!rule.notes && <Row label={t('bdr_rule_notes')} value={rule.notes} />}
      {!!rule.source_url && (
        <Text maxFontSizeMultiplier={1.4} accessibilityRole="link" onPress={() => Linking.openURL(rule.source_url as string).catch(() => {})}
          style={{ color: colors.textBrand, textDecorationLine: 'underline', marginTop: 6 }}>{t('bdr_rule_source')}</Text>
      )}
      <Line muted>{t('bdr_rule_english')}</Line>
    </Card>
  );
}

export function RecoverySection({ detail, reload }: { detail: BondDetail; reload: () => Promise<void> }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const bondId = detail.bond.id;
  const [data, setData] = useState<RecoveryView | null>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [locations, setLocations] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ link: string; email_status: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<RecoveryView>(`/bond-desk/bonds/${bondId}/recovery`);
      if (mounted.current) { setData(r.data); setError(''); }
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [bondId]);
  useEffect(() => { load(); }, [load]);

  const share = async () => {
    if (busy) return;
    if (!email.trim()) { showToast(t('bdr_email_required'), 'error'); return; }
    if (!ack) { showToast(t('bdr_ack_required'), 'error'); return; }
    setBusy('share');
    try {
      const r = await api.post<{ link: string; email_status: string }>(`/bond-desk/bonds/${bondId}/recovery/shares`, { email: email.trim(), share_locations: locations, rule_acknowledged: true });
      if (!mounted.current) return;
      setSent({ link: r.data.link, email_status: r.data.email_status }); setEmail(''); setAck(false);
      showToast(t('bdr_shared'), 'success');
      await load(); await reload();
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { if (mounted.current) setBusy(null); }
  };
  const revoke = async (s: RecoveryShare) => {
    if (!(await confirm(t('bdr_revoke_q'), t('bdr_revoke_body', { email: s.invite_email }), { confirmLabel: t('bdr_revoke'), destructive: true }))) return;
    setBusy(`revoke-${s.id}`);
    try { await api.post(`/bond-desk/recovery/shares/${s.id}/revoke`); showToast(t('bdr_revoked'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { if (mounted.current) setBusy(null); }
  };

  if (!data) {
    return (
      <Card testID="bond-recovery">
        {error ? <><Line tone="danger" testID="recovery-error">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></>
          : <ActivityIndicator color={colors.textBrand} />}
      </Card>
    );
  }
  const banned = data.state_rule?.allowed === false;
  const canShare = data.bond_status === 'forfeited' && !banned;

  return (
    <View testID="bond-recovery">
      <Card title={t('bdr_title')}>
        <Line muted>{t('bdr_intro')}</Line>
        {data.bond_status !== 'forfeited' && <Line tone="warn" testID="recovery-not-forfeited">{t('bdr_only_forfeited')}</Line>}
      </Card>
      <StateRuleCard rule={data.state_rule} state={data.state} />
      {canShare && (
        <Card title={t('bdr_share_title')} testID="recovery-share-form">
          <Field label={t('bdr_email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="recovery-email" maxLength={254} />
          <Check label={t('bdr_locations')} value={locations} onChange={setLocations} testID="recovery-locations" />
          <Check label={t('bdr_ack', { state: data.state || '' })} value={ack} onChange={setAck} testID="recovery-ack" />
          <Line muted>{t('bdr_what_they_see')}</Line>
          <Btn label={t('bdr_share')} onPress={share} busy={busy === 'share'} disabled={!ack} testID="recovery-share" />
        </Card>
      )}
      {sent && (
        <Notice tone="ok" testID="recovery-sent" text={`${t(sent.email_status === 'sent' ? 'bdr_sent_email' : 'bdr_sent_no_email')} ${sent.link}`} />
      )}
      <Card title={t('bdr_shares')} testID="recovery-shares">
        {!data.shares.length && <Line muted>{t('bdr_no_shares')}</Line>}
        {data.shares.map(s => (
          <View key={s.id} testID={`recovery-share-${s.id}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <Pill text={t(`bdr_st_${s.status}`)} tone={statusTone(s.status)} />
              {s.share_locations && <Pill text={t('bdr_with_locations')} />}
            </View>
            <Row label={t('bdr_email')} value={s.account_name ? `${s.invite_email} (${s.account_name})` : s.invite_email} />
            <Row label={t('bdr_shared_on')} value={fmtWhen(s.created_at)} />
            {!!s.accepted_at && <Row label={t('bdr_accepted_on')} value={fmtWhen(s.accepted_at)} />}
            {!!s.ended_at && <Row label={t('bdr_ended_on')} value={`${fmtWhen(s.ended_at)} · ${tOr(`bdw_end_${s.ended_reason}`, s.ended_reason || '')}`} />}
            <Line strong>{t('bdr_views', { n: s.views.length })}</Line>
            {s.views.slice(0, 20).map((v, i) => <Line key={i} muted>{`${fmtWhen(v.at)} · ${t(v.what === 'photo' ? 'bdr_view_photo' : 'bdr_view_details')}`}</Line>)}
            {s.status !== 'ended' && <Btn kind="danger" label={t('bdr_revoke')} busy={busy === `revoke-${s.id}`} onPress={() => revoke(s)} testID={`recovery-revoke-${s.id}`} />}
          </View>
        ))}
      </Card>
    </View>
  );
}
