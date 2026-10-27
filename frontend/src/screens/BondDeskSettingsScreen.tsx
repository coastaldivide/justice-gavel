/**
 * BondDeskSettingsScreen — running the agency in Bond Desk (docs/BOND_DESK.md):
 *
 *   Card payments   Stripe Connect (Express): the fee terms are shown and accepted before set-up
 *                   (Stripe's card fee is the agency's; 99¢ per automatic payment-plan charge),
 *                   then Stripe's own onboarding page opens. Payments go to the agency's Stripe
 *                   account. Once on: the agency's public pay page link and the Stripe dashboard.
 *   Staff & seats   seats used / included in the plan; invite by e-mail, withdraw, remove (owner);
 *                   staff see whose desk they work in and can leave.
 *   Your data       import open bonds from a CSV file; export everything as one ZIP (owner).
 *
 * Stripe sends the owner back to /bond-desk/settings?connect=return (status re-read) or
 * ?connect=refresh (the set-up link expired: open it again).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { AccessGate } from './BondDeskScreen';
import { type Access, type ConnectState, type StaffList, connectStatusKey, fmtDay, money, openHosted, seatsLeft, todayIso } from '../services/bondDesk';

function BondDeskSettingsScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const back = (route?.params as { connect?: string } | undefined)?.connect;

  const [access, setAccess] = useState<Access | null>(null);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [staff, setStaff] = useState<StaffList | null>(null);
  const [error, setError] = useState('');
  const [feesOk, setFeesOk] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api.get<Access>('/bond-desk/access');
      if (!mounted.current) return;
      setAccess(a.data);
      if (!a.data?.allowed) return;
      const [c, st] = await Promise.all([
        back === 'return' ? api.post<ConnectState>('/bond-desk/connect/refresh', {}).catch(() => api.get<ConnectState>('/bond-desk/connect')) : api.get<ConnectState>('/bond-desk/connect'),
        api.get<StaffList>('/bond-desk/staff'),
      ]);
      if (!mounted.current) return;
      setConnect(c.data); setStaff(st.data); setError('');
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [back]);
  useEffect(() => { load(); }, [load]);

  const owner = access?.role !== 'staff';
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { if (mounted.current) setBusy(null); }
  };

  const startConnect = () => run('connect', async () => {
    const r = await api.post<{ url: string }>('/bond-desk/connect/start', { fees_acknowledged: true });
    await openHosted(r.data.url);
  });
  const refresh = () => run('refresh', async () => { const r = await api.post<ConnectState>('/bond-desk/connect/refresh', {}); setConnect(r.data); });
  const dashboard = () => run('dash', async () => { const r = await api.post<{ url: string }>('/bond-desk/connect/dashboard', {}); await openHosted(r.data.url); });
  const togglePayLink = () => run('paylink', async () => {
    const r = await api.put<ConnectState>('/bond-desk/connect/pay-link', { on: !connect?.pay_link_on }); setConnect(r.data);
  });
  const copy = async (text: string) => { await Clipboard.setStringAsync(text); showToast(t('bdk_link_copied'), 'success'); };

  const invite = () => run('invite', async () => {
    const r = await api.post<{ link: string; email_status: string }>('/bond-desk/staff/invites', { email: email.trim() });
    setEmail(''); setInviteLink(r.data.link);
    showToast(r.data.email_status === 'sent' ? t('bdk_staff_invited') : t('bdk_staff_invite_made'), 'success');
    setStaff((await api.get<StaffList>('/bond-desk/staff')).data);
  });
  const withdraw = (id: number) => run(`inv-${id}`, async () => { setStaff((await api.delete<StaffList>(`/bond-desk/staff/invites/${id}`)).data); });
  const remove = async (userId: number, name: string) => {
    // errors: run() has the try / catch that shows a failed request
    if (!(await confirm(t('bdk_staff_remove_title', { name }), t('bdk_staff_remove_body'), { confirmLabel: t('bdk_remove') }))) return;
    await run(`rm-${userId}`, async () => { setStaff((await api.delete<StaffList>(`/bond-desk/staff/${userId}`)).data); showToast(t('bdk_staff_removed'), 'success'); });
  };
  const leave = async () => {
    // errors: run() has the try / catch that shows a failed request
    if (!(await confirm(t('bdk_staff_leave_title'), t('bdk_staff_leave_body'), { confirmLabel: t('bdk_staff_leave') }))) return;
    await run('leave', async () => { await api.post('/bond-desk/staff/leave', {}); navigation.navigate('BondDesk' as never); });
  };
  const exportAll = () => run('export', async () => {
    await fetchFile('/bond-desk/export.zip', `bond-desk-export-${todayIso()}.zip`, 'application/zip');
    showToast(t('bdk_export_done'), 'success');
  });

  if (access && !access.allowed) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="bond-settings-screen"><AccessGate access={access} onPlans={() => navigation.navigate('Subscription' as never)} /></ScrollView>;
  }
  if (!access && !error) return <View style={[s.center, { backgroundColor: colors.bg }]} testID="bond-settings-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;

  const seats = staff?.seats;
  return (
    <ScrollView testID="bond-settings-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_settings')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_settings_intro')}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" testID="settings-error" />}
      {back === 'refresh' && connect?.status !== 'enabled' && <Notice text={t('bdk_connect_link_expired')} testID="connect-link-expired" />}

      {connect && (
        <Card title={t('bdk_connect_title')} testID="connect-card">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill text={t(connectStatusKey(connect))} tone={connect.status === 'enabled' ? 'ok' : connect.status === 'none' ? 'muted' : 'warn'} />
            {connect.status === 'enabled' && !connect.payouts_enabled && <Pill text={t('bdk_connect_payouts_off')} tone="warn" />}
          </View>
          {!connect.payments_live && <Line tone="warn" testID="connect-not-live">{t('bdk_connect_not_live')}</Line>}
          <Line>{t('bdk_connect_how')}</Line>
          <View testID="connect-fees" style={s.fees}>
            <Line strong>{t('bdk_connect_fees_title')}</Line>
            <Line>{t('bdk_connect_fee_stripe')}</Line>
            <Line>{t('bdk_connect_fee_jg', { fee: money(connect.autopay_fee_cents) })}</Line>
            <Line>{t('bdk_connect_fee_final')}</Line>
          </View>
          {!owner && connect.status !== 'enabled' && <Line muted testID="connect-owner-only">{t('bdk_owner_only_line')}</Line>}
          {owner && connect.status !== 'enabled' && connect.payments_live && (
            <>
              {connect.status === 'none' && <Check label={t('bdk_connect_fees_ok')} value={feesOk} onChange={setFeesOk} testID="connect-fees-ok" />}
              <Btn label={t(connect.status === 'none' ? 'bdk_connect_setup' : 'bdk_connect_continue')} onPress={startConnect}
                disabled={connect.status === 'none' && !feesOk} busy={busy === 'connect'} testID="connect-start" />
            </>
          )}
          {connect.status !== 'none' && <Btn kind="ghost" label={t('bdk_connect_refresh')} onPress={refresh} busy={busy === 'refresh'} testID="connect-refresh" />}
          {connect.status === 'enabled' && (
            <>
              {owner && <Btn kind="ghost" label={t('bdk_connect_dashboard')} onPress={dashboard} busy={busy === 'dash'} testID="connect-dashboard" />}
              <Line strong>{t('bdk_paylink_title')}</Line>
              <Line muted>{t('bdk_paylink_help', { min: money(connect.pay_link_limits.min_cents), max: money(connect.pay_link_limits.max_cents) })}</Line>
              {connect.pay_link ? (
                <View testID="paylink">
                  <Line>{connect.pay_link}</Line>
                  <Btn kind="ghost" label={t('bdk_copy_link')} onPress={() => copy(connect.pay_link || '')} testID="paylink-copy" />
                </View>
              ) : <Line muted testID="paylink-off">{t('bdk_paylink_off')}</Line>}
              {owner && <Btn kind="ghost" label={t(connect.pay_link_on ? 'bdk_paylink_turn_off' : 'bdk_paylink_turn_on')} onPress={togglePayLink} busy={busy === 'paylink'} testID="paylink-toggle" />}
              {connect.autopay_available && <Line muted>{t('bdk_connect_autopay_where')}</Line>}
            </>
          )}
        </Card>
      )}

      {staff && seats && (
        <Card title={t('bdk_staff_title')} testID="staff-card">
          <Line strong testID="staff-seats">{t('bdk_seats_line', { used: seats.used, included: seats.included })}</Line>
          <Line muted>{t('bdk_staff_help')}</Line>
          <View style={s.person}>
            <Line strong>{staff.owner.name || staff.owner.email}</Line>
            <Pill text={t('bdk_role_owner')} tone="ok" />
          </View>
          {staff.staff.map(m => (
            <View key={m.user_id} style={s.person} testID={`staff-${m.user_id}`}>
              <Line strong>{m.name || m.email}</Line>
              {!!m.email && <Line muted>{m.email}</Line>}
              <Pill text={t('bdk_role_staff')} />
              {owner && <Btn kind="danger" label={t('bdk_remove')} onPress={() => remove(m.user_id, m.name || m.email || '')} busy={busy === `rm-${m.user_id}`} testID={`staff-remove-${m.user_id}`} />}
            </View>
          ))}
          {staff.invites.map(i => (
            <View key={i.id} style={s.person} testID={`invite-${i.id}`}>
              <Line>{i.email}</Line>
              <Line muted>{t('bdk_invite_pending', { date: fmtDay(i.expires_at) })}</Line>
              {owner && <Btn kind="ghost" label={t('bdk_invite_withdraw')} onPress={() => withdraw(i.id)} busy={busy === `inv-${i.id}`} testID={`invite-withdraw-${i.id}`} />}
            </View>
          ))}
          {owner ? (
            seatsLeft(seats) > 0 ? (
              <>
                <Field label={t('bdk_invite_email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="invite-email" />
                <Btn label={t('bdk_invite_send')} onPress={invite} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} busy={busy === 'invite'} testID="invite-send" />
              </>
            ) : (
              <>
                <Line tone="warn" testID="seats-full">{t('bdk_seats_full', { included: seats.included })}</Line>
                <Btn kind="ghost" label={t('bdk_see_plans')} onPress={() => navigation.navigate('Subscription' as never)} testID="seats-upgrade" />
              </>
            )
          ) : <Btn kind="danger" label={t('bdk_staff_leave')} onPress={leave} busy={busy === 'leave'} testID="staff-leave" />}
          {!!inviteLink && (
            <View testID="invite-link">
              <Line muted>{t('bdk_invite_link_help')}</Line>
              <Line>{inviteLink}</Line>
              <Btn kind="ghost" label={t('bdk_copy_link')} onPress={() => copy(inviteLink)} testID="invite-copy" />
            </View>
          )}
        </Card>
      )}

      <Card title={t('bdk_data_title')} testID="data-card">
        <Line>{t('bdk_data_owns')}</Line>
        <Btn kind="ghost" label={t('bdk_import_title')} onPress={() => navigation.navigate('BondImport' as never)} testID="data-import" />
        <Btn kind="ghost" label={t('bdk_forms_setup_title')} onPress={() => navigation.navigate('BondForms' as never)} testID="data-forms-setup" />
        {owner ? (
          <>
            <Line muted>{t('bdk_export_help')}</Line>
            <Btn label={t('bdk_export')} onPress={exportAll} busy={busy === 'export'} testID="data-export" />
          </>
        ) : <Line muted>{t('bdk_export_owner_only')}</Line>}
      </Card>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  fees: { marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle },
  person: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
});

export default React.memo(BondDeskSettingsScreen);
