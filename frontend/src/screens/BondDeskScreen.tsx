/**
 * BondDeskScreen — a bail agent's bonds: what needs attention today
 * (overdue payments, forfeiture deadlines, paperwork waiting for a signature),
 * liability and money owed, the bond list (search, status filter) and a new
 * bond. Links to the forms library, the power inventory and the reports.
 *
 * GET /api/bond-desk/access decides what is shown: bail agents with a
 * bail-agent plan (or admins) get the desk; an agent without a plan sees the
 * plans; any other account sees what the desk is for. Contract: docs/BOND_DESK.md.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useHasSession, SignInNeeded } from '../components/SignInNeeded';
import { useToast } from '../components/ToastProvider';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { type Access, type Bond, type BondStatus, type ConnectState, type Dashboard, type PayRequest, BOND_STATUSES, fmtDay, fmtWhen, money } from '../services/bondDesk';
import { BondFields, EMPTY_BOND, bondBody, type BondDraft } from '../components/bondDesk/bondFields';

export const statusTone = (s: BondStatus): 'muted' | 'ok' | 'warn' | 'danger' =>
  s === 'active' ? 'ok' : s === 'forfeited' ? 'danger' : s === 'prospect' ? 'warn' : 'muted';

/** The "not for you" states: signed-out is handled by the screen; not an agent; agent without a plan. */
export function AccessGate({ access, onPlans }: { access: Access; onPlans: () => void }) {
  useLang();
  if (access.reason === 'no_plan') {
    return (
      <Card title={t('bdk_no_plan_title')} testID="bond-desk-no-plan">
        <Line>{t('bdk_no_plan_body')}</Line>
        <Btn label={t('bdk_see_plans')} onPress={onPlans} testID="bond-desk-plans" />
      </Card>
    );
  }
  return (
    <Card title={t('bdk_not_agent_title')} testID="bond-desk-not-agent">
      <Line>{t('bdk_not_agent_body')}</Line>
    </Card>
  );
}

function BondDeskScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const s = makeStyles(colors);
  const { hasSession, recheck } = useHasSession();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [access, setAccess] = useState<Access | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [status, setStatus] = useState<BondStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState<BondDraft>(EMPTY_BOND);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // card payments (Stripe Connect) and pay-page payments not yet on a bond
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [unassigned, setUnassigned] = useState<PayRequest[]>([]);
  const [attaching, setAttaching] = useState<PayRequest | null>(null);
  const [attachQ, setAttachQ] = useState('');
  const [attachBonds, setAttachBonds] = useState<Bond[]>([]);
  const [attachErr, setAttachErr] = useState('');
  const [attachBusy, setAttachBusy] = useState<number | null>(null);

  const loadBonds = useCallback(async (st: BondStatus | 'all', query: string) => {
    const params: Record<string, string> = {};
    if (st !== 'all') params.status = st;
    if (query.trim()) params.q = query.trim();
    const r = await api.get<{ bonds: Bond[] }>('/bond-desk/bonds', { params });
    if (mounted.current) setBonds(r.data?.bonds || []);
  }, []);

  const load = useCallback(async () => {
    try {
      const a = await api.get<Access>('/bond-desk/access');
      if (!mounted.current) return;
      setAccess(a.data);
      if (!a.data?.allowed) return;
      const d = await api.get<Dashboard>('/bond-desk/dashboard');
      if (mounted.current) setDash(d.data);
      await loadBonds(status, q);
      if (mounted.current) setError('');
      // optional extras: an older server (or no card payments yet) simply shows nothing here
      const [c, pr] = await Promise.all([
        api.get<ConnectState>('/bond-desk/connect').catch(() => null),
        api.get<{ pay_requests: PayRequest[] }>('/bond-desk/pay-requests').catch(() => null),
      ]);
      if (mounted.current) { setConnect(c?.data || null); setUnassigned(pr?.data?.pay_requests || []); }
    } catch (e) {
      if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed')));
    }
  }, [loadBonds, status, q]);
  useFocusEffect(useCallback(() => { if (hasSession) load(); }, [hasSession, load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => { if (mounted.current) setRefreshing(false); }); };

  const create = async () => {
    const { body, error: err } = bondBody(draft);
    if (err) { setFormError(t(err)); return; }
    setSaving(true); setFormError('');
    try {
      const r = await api.post<{ bond: Bond }>('/bond-desk/bonds', body);
      if (!mounted.current) return;
      setNewOpen(false); setDraft(EMPTY_BOND);
      navigation.navigate('BondDetail', { bondId: r.data.bond.id });
    } catch (e) {
      setFormError(apiErrorMessage(e, t('bdk_save_failed')));
    } finally { if (mounted.current) setSaving(false); }
  };

  if (hasSession === false) {
    return <View style={[s.screen, { backgroundColor: colors.bg }]} testID="bond-desk-screen"><SignInNeeded navigation={navigation} body={t('bdk_sign_in_body')} onSignedIn={recheck} /></View>;
  }
  if (hasSession === null || (!access && !error)) {
    return <View style={[s.center, { backgroundColor: colors.bg }]} testID="bond-desk-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  }

  const go = (screen: string, params?: object) => navigation.navigate(screen, params);
  const openAttach = async (p: PayRequest) => {
    setAttaching(p); setAttachErr(''); setAttachQ(p.defendant_name);
    try { const r = await api.get<{ bonds: Bond[] }>('/bond-desk/bonds', { params: { q: p.defendant_name.split(' ').slice(-1)[0] } }); if (mounted.current) setAttachBonds(r.data?.bonds || []); }
    catch { if (mounted.current) setAttachBonds([]); }
  };
  const searchAttach = async () => {
    try { const r = await api.get<{ bonds: Bond[] }>('/bond-desk/bonds', { params: attachQ.trim() ? { q: attachQ.trim() } : {} }); if (mounted.current) setAttachBonds(r.data?.bonds || []); }
    catch (e) { setAttachErr(apiErrorMessage(e, t('bdk_load_failed'))); }
  };
  const attach = async (bond: Bond) => {
    if (!attaching) return;
    setAttachBusy(bond.id); setAttachErr('');
    try {
      const r = await api.post<{ over_balance_cents?: number }>(`/bond-desk/pay-requests/${attaching.id}/attach`, { bond_id: bond.id });
      // the card was already charged: a payment above the balance is posted anyway and flagged
      if ((r.data?.over_balance_cents || 0) > 0) showToast(t('bdk_attach_over', { amount: money(r.data.over_balance_cents) }), 'warning');
      if (!mounted.current) return;
      setAttaching(null); await load();
      navigation.navigate('BondDetail', { bondId: bond.id, tab: 'money' });
    } catch (e) { if (mounted.current) setAttachErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { if (mounted.current) setAttachBusy(null); }
  };
  const statusOptions = [{ key: 'all' as const, label: t('bdk_all') }, ...BOND_STATUSES.map(k => ({ key: k, label: t(`bdk_st_${k}`) }))];

  return (
    <View style={[s.screen, { backgroundColor: colors.bg }]}>
      <ScrollView testID="bond-desk-screen" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_intro')}</Text>
        </View>
        {!!error && <Notice text={error} tone="error" testID="bond-desk-error" />}
        {access && !access.allowed && <AccessGate access={access} onPlans={() => go('Subscription')} />}

        {access?.allowed && (
          <>
            {dash && (
              <View style={s.tiles} testID="bond-desk-tiles">
                <Tile label={t('bdk_tile_active')} value={String(dash.counts.active)} testID="tile-active" />
                <Tile label={t('bdk_tile_prospects')} value={String(dash.counts.prospect)} testID="tile-prospect" />
                <Tile label={t('bdk_tile_forfeited')} value={String(dash.counts.forfeited)} testID="tile-forfeited" />
                <Tile label={t('bdk_tile_liability')} value={money(dash.liability_cents)} testID="tile-liability" />
                <Tile label={t('bdk_tile_receivable')} value={money(dash.receivable_cents)} testID="tile-receivable" />
                <Tile label={t('bdk_tile_overdue')} value={money(dash.overdue_cents)} testID="tile-overdue" />
                <Tile label={t('bdk_tile_texts')} value={`${dash.texts_this_month.count} · ${money(dash.texts_this_month.cents)}`} testID="tile-texts" />
              </View>
            )}

            <View style={s.actions}>
              <Btn label={t('bdk_new_bond')} onPress={() => { setDraft(EMPTY_BOND); setFormError(''); setNewOpen(true); }} testID="bond-desk-new" style={s.actionBtn} />
              <Btn kind="ghost" label={t('bdk_forms')} onPress={() => go('BondForms')} testID="bond-desk-forms" style={s.actionBtn} />
              <Btn kind="ghost" label={t('bdk_powers')} onPress={() => go('BondPowers')} testID="bond-desk-powers" style={s.actionBtn} />
              <Btn kind="ghost" label={t('bdk_reports')} onPress={() => go('BondReports')} testID="bond-desk-reports" style={s.actionBtn} />
              <Btn kind="ghost" label={t('bdk_settings')} onPress={() => go('BondDeskSettings')} testID="bond-desk-settings" style={s.actionBtn} />
            </View>
            {connect && connect.status !== 'enabled' && connect.payments_live && (
              <Card title={t('bdk_connect_cta_title')} testID="bond-desk-setup-payments">
                <Line>{t('bdk_connect_cta_body')}</Line>
                <Btn label={t('bdk_connect_setup')} onPress={() => go('BondDeskSettings')} testID="bond-desk-setup-payments-go" />
              </Card>
            )}
            {!!unassigned.length && (
              <Card title={t('bdk_unassigned_title')} testID="bond-desk-unassigned">
                <Line muted>{t('bdk_unassigned_help')}</Line>
                {unassigned.map(p => (
                  <View key={p.id} style={s.item} testID={`unassigned-${p.id}`}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{money(p.amount_cents)} · {p.payer_name}</Text>
                    <Line>{t('bdk_unassigned_line', { defendant: p.defendant_name, date: fmtWhen(p.paid_at) })}</Line>
                    <Btn kind="ghost" label={t('bdk_unassigned_attach')} onPress={() => openAttach(p)} testID={`unassigned-attach-${p.id}`} />
                  </View>
                ))}
              </Card>
            )}
            {!access.texts_live && <Notice text={t('bdk_texts_off')} testID="bond-desk-texts-off" />}

            {!!dash?.forfeitures.length && (
              <Card title={t('bdk_forfeitures')} testID="bond-desk-forfeitures">
                {dash.forfeitures.map(f => (
                  <TouchableOpacity key={f.bond_id} accessibilityRole="button" style={s.item} onPress={() => go('BondDetail', { bondId: f.bond_id })} testID={`forfeiture-${f.bond_id}`}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{f.defendant_name}</Text>
                    <Line tone={f.days_left <= 14 ? 'danger' : 'warn'}>{f.days_left < 0 ? t('bdk_deadline_passed', { date: fmtDay(f.deadline_on) }) : t('bdk_days_left', { n: f.days_left, date: fmtDay(f.deadline_on) })}</Line>
                  </TouchableOpacity>
                ))}
              </Card>
            )}
            {!!dash?.rearrests?.length && (
              <Card title={t('bdw_dash_title')} testID="bond-desk-rearrests">
                {dash.rearrests.map(r => (
                  <TouchableOpacity key={r.id} accessibilityRole="button" style={s.item} onPress={() => go('BondDetail', { bondId: r.bond_id, tab: 'alerts' })} testID={`dash-rearrest-${r.id}`}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{r.defendant_name}</Text>
                    <Line tone={r.status === 'pending' ? 'warn' : 'danger'}>
                      {t(r.status === 'pending' ? 'bdw_dash_possible' : 'bdw_dash_strong', { date: fmtDay(r.booking.booking_date), where: [r.booking.county, r.booking.state].filter(Boolean).join(', ') || '—' })}
                    </Line>
                  </TouchableOpacity>
                ))}
              </Card>
            )}
            {!!dash?.missed_checkins?.length && (
              <Card title={t('bdk_missed_checkins')} testID="bond-desk-missed-checkins">
                {dash.missed_checkins.map(m => (
                  <TouchableOpacity key={`${m.bond_id}-${m.day}`} accessibilityRole="button" style={s.item} onPress={() => go('CheckInManager')} testID={`missed-checkin-${m.bond_id}`}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{m.defendant_name}</Text>
                    <Line tone="danger">{t('bdk_missed_checkin_line', { date: fmtDay(m.day) })}</Line>
                  </TouchableOpacity>
                ))}
              </Card>
            )}
            {!!dash?.overdue.length && (
              <Card title={t('bdk_overdue')} testID="bond-desk-overdue">
                {dash.overdue.map(o => (
                  <TouchableOpacity key={`${o.bond_id}-${o.due_on}`} accessibilityRole="button" style={s.item} onPress={() => go('BondDetail', { bondId: o.bond_id })}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{o.defendant_name}</Text>
                    <Line tone="danger">{t('bdk_overdue_line', { amount: money(o.amount_due_cents), date: fmtDay(o.due_on) })}</Line>
                  </TouchableOpacity>
                ))}
              </Card>
            )}
            {!!dash?.awaiting_signature.length && (
              <Card title={t('bdk_awaiting')} testID="bond-desk-awaiting">
                {dash.awaiting_signature.map(a => (
                  <TouchableOpacity key={a.packet_id} accessibilityRole="button" style={s.item} onPress={() => go('BondDetail', { bondId: a.bond_id, tab: 'paperwork' })}>
                    <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{a.defendant_name}</Text>
                    <Line>{t('bdk_awaiting_line', { n: a.pending })}</Line>
                  </TouchableOpacity>
                ))}
              </Card>
            )}

            <Card title={t('bdk_bonds')} testID="bond-desk-list">
              <Field label={t('bdk_search')} value={q} onChangeText={setQ} testID="bond-desk-search" placeholder={t('bdk_search_ph')} />
              <Btn kind="ghost" label={t('bdk_search_go')} onPress={() => loadBonds(status, q).catch(e => setError(apiErrorMessage(e, t('bdk_load_failed'))))} testID="bond-desk-search-go" />
              <Chips options={statusOptions} value={status} testIDPrefix="bond-status"
                onChange={k => { setStatus(k); loadBonds(k, q).catch(e => setError(apiErrorMessage(e, t('bdk_load_failed')))); }} />
              {!bonds.length && <Line muted testID="bond-desk-empty">{t('bdk_no_bonds')}</Line>}
              {bonds.map(b => (
                <TouchableOpacity key={b.id} accessibilityRole="button" style={s.item} onPress={() => go('BondDetail', { bondId: b.id })} testID={`bond-row-${b.id}`}>
                  <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{b.defendant_name}</Text>
                  <Line>{[money(b.bond_amount_cents), b.case_number, b.court_date ? fmtDay(b.court_date) : null].filter(Boolean).join(' · ')}</Line>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Pill text={t(`bdk_st_${b.status}`)} tone={statusTone(b.status)} />
                    {!!b.balance_cents && <Pill text={t('bdk_balance_pill', { amount: money(b.balance_cents) })} tone="warn" />}
                  </View>
                </TouchableOpacity>
              ))}
            </Card>
          </>
        )}
      </ScrollView>

      <Modal visible={!!attaching} animationType="slide" onRequestClose={() => setAttaching(null)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="attach-modal">
          {attaching && (
            <Card title={t('bdk_attach_title', { amount: money(attaching.amount_cents), payer: attaching.payer_name })}>
              <Line muted>{t('bdk_attach_help', { defendant: attaching.defendant_name })}</Line>
              <Field label={t('bdk_search')} value={attachQ} onChangeText={setAttachQ} testID="attach-search" />
              <Btn kind="ghost" label={t('bdk_search_go')} onPress={searchAttach} testID="attach-search-go" />
              {!attachBonds.length && <Line muted>{t('bdk_no_bonds')}</Line>}
              {attachBonds.slice(0, 50).map(b => (
                <View key={b.id} style={s.item}>
                  <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{b.defendant_name}</Text>
                  <Line>{[money(b.bond_amount_cents), b.case_number, t('bdk_balance_pill', { amount: money(b.balance_cents || 0) })].filter(Boolean).join(' · ')}</Line>
                  <Btn label={t('bdk_attach_here')} onPress={() => attach(b)} busy={attachBusy === b.id} testID={`attach-to-${b.id}`} />
                </View>
              ))}
              {!!attachErr && <Line tone="danger" testID="attach-error">{attachErr}</Line>}
              <Btn kind="ghost" label={t('cancel')} onPress={() => setAttaching(null)} testID="attach-cancel" />
            </Card>
          )}
        </ScrollView>
      </Modal>

      <Modal visible={newOpen} animationType="slide" onRequestClose={() => setNewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="bond-new-modal">
            <Card title={t('bdk_new_bond')}>
              <BondFields draft={draft} set={(k, v) => setDraft(p => ({ ...p, [k]: v }))} />
              {!!formError && <Line tone="danger" testID="bond-new-error">{formError}</Line>}
              <Btn label={t('bdk_save')} onPress={create} busy={saving} testID="bond-new-save" />
              <Btn kind="ghost" label={t('cancel')} onPress={() => setNewOpen(false)} testID="bond-new-cancel" />
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Tile({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={s.tile} testID={testID}>
      <Text maxFontSizeMultiplier={1.3} style={s.tileValue}>{value}</Text>
      <Text maxFontSizeMultiplier={1.3} style={s.tileLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 24, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginTop: 12 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 100, backgroundColor: colors.bgCard, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, padding: 10 },
  tileValue: { fontSize: 18, ...FONTS.black, color: colors.textPrimary },
  tileLabel: { fontSize: 12, color: colors.textSecond, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 },
  actionBtn: { flexGrow: 1, flexBasis: '45%' },
  item: { minHeight: 44, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  itemTitle: { fontSize: 15, ...FONTS.bold, color: colors.textPrimary },
});

export default React.memo(BondDeskScreen);
