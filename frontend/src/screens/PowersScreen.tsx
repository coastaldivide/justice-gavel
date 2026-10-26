/**
 * PowersScreen — the agency's power-of-attorney inventory by surety: add a
 * numbered range received from a surety, see which are available / executed
 * (and on which bond) / void / returned, void a spoiled power, return unused
 * ones. Powers are executed on a bond from the bond's overview.
 * Contract: docs/BOND_DESK.md (Powers).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill, useTextPrompt } from '../components/bondDesk/ui';
import { AccessGate } from './BondDeskScreen';
import { type Access, type Power, fmtDay, isIsoDate, money, parseCents, todayIso } from '../services/bondDesk';

type PowerStatus = NonNullable<Power['status']>;
const STATUSES: PowerStatus[] = ['available', 'executed', 'void', 'returned'];
const tone = { available: 'ok', executed: 'muted', void: 'danger', returned: 'warn' } as const;

/** Range form → POST body, or an i18n error key. */
export function rangeBody(d: { surety: string; prefix: string; start: string; end: string; limit: string; received: string; expires: string }) {
  if (!d.surety.trim()) return { error: 'bdk_err_surety' };
  const start = /^\d{1,9}$/.test(d.start.trim()) ? Number(d.start.trim()) : NaN;
  const end = /^\d{1,9}$/.test(d.end.trim()) ? Number(d.end.trim()) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { error: 'bdk_err_range' };
  if (end - start + 1 > 500) return { error: 'bdk_err_range_size' };
  const limit = parseCents(d.limit);
  if (limit === null || limit <= 0) return { error: 'bdk_err_amount' };
  if (!isIsoDate(d.received.trim())) return { error: 'bdk_err_date' };
  if (d.expires.trim() && !isIsoDate(d.expires.trim())) return { error: 'bdk_err_date' };
  // start / end go as the typed strings: the server keeps the surety's zero padding (000101 → 000150)
  return { body: { surety_name: d.surety.trim(), prefix: d.prefix.trim(), start: d.start.trim(), end: d.end.trim(), limit_cents: limit, received_on: d.received.trim(), expires_on: d.expires.trim() || null }, count: end - start + 1 };
}

function PowersScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const prompt = useTextPrompt();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [access, setAccess] = useState<Access | null>(null);
  const [powers, setPowers] = useState<Power[] | null>(null);
  const [sureties, setSureties] = useState<string[]>([]);
  const [status, setStatus] = useState<PowerStatus | 'all'>('available');
  const [surety, setSurety] = useState<string>('all');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ surety: '', prefix: '', start: '', end: '', limit: '', received: todayIso(), expires: '' });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (st: PowerStatus | 'all' = status, su: string = surety) => {
    try {
      if (!access) {
        const a = await api.get<Access>('/bond-desk/access');
        if (!mounted.current) return;
        setAccess(a.data);
        if (!a.data?.allowed) return;
      }
      const params: Record<string, string> = {};
      if (st !== 'all') params.status = st;
      if (su !== 'all') params.surety = su;
      const r = await api.get<{ powers: Power[]; sureties: string[] }>('/bond-desk/powers', { params });
      if (mounted.current) { setPowers(r.data?.powers || []); setSureties(r.data?.sureties || []); setError(''); }
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [access, status, surety]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    const r = rangeBody(draft);
    if (r.error) { setFormErr(t(r.error)); return; }
    if (!(await confirm(t('bdk_power_add_confirm', { n: r.count, surety: draft.surety.trim() }), undefined, { confirmLabel: t('bdk_add') }))) return;
    setBusy(true); setFormErr('');
    try {
      const res = await api.post<{ created: number; skipped: number }>('/bond-desk/powers', r.body);
      showToast(t('bdk_powers_added', { created: res.data.created, skipped: res.data.skipped }), 'success');
      setAdding(false); setDraft({ surety: '', prefix: '', start: '', end: '', limit: '', received: todayIso(), expires: '' });
      await load();
    } catch (e) { setFormErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { if (mounted.current) setBusy(false); }
  };

  const voidPower = async (p: Power) => {
    const reason = await prompt.ask(t('bdk_void_power_title', { number: p.number }), t('bdk_void_reason'));
    if (!reason) return;
    try { await api.post(`/bond-desk/powers/${p.id}/void`, { reason }); showToast(t('bdk_voided'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };
  const returnPower = async (p: Power) => {
    if (!(await confirm(t('bdk_return_power_title', { number: p.number }), t('bdk_return_power_body'), { confirmLabel: t('bdk_return') }))) return;
    try { await api.post(`/bond-desk/powers/${p.id}/return`); showToast(t('bdk_saved'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };

  if (access && !access.allowed) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="powers-screen"><AccessGate access={access} onPlans={() => navigation.navigate('Subscription' as never)} /></ScrollView>;
  }
  if (!powers && !error) return <View style={[s.center, { backgroundColor: colors.bg }]} testID="powers-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  const set = (k: keyof typeof draft) => (v: string) => setDraft(p => ({ ...p, [k]: v }));

  return (
    <ScrollView testID="powers-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {prompt.element}
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_powers')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_powers_intro')}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" />}

      <Card title={t('bdk_powers_add')} testID="powers-add-card">
        {!adding ? <Btn label={t('bdk_powers_add')} onPress={() => { setFormErr(''); setAdding(true); }} testID="powers-add" /> : (
          <>
            <Field label={t('bdk_f_surety')} value={draft.surety} onChangeText={set('surety')} testID="powers-surety" />
            <Field label={t('bdk_power_prefix')} value={draft.prefix} onChangeText={set('prefix')} testID="powers-prefix" autoCapitalize="characters" placeholder="S25-" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t('bdk_power_start')} value={draft.start} onChangeText={set('start')} keyboardType="number-pad" testID="powers-start" /></View>
              <View style={{ flex: 1 }}><Field label={t('bdk_power_end')} value={draft.end} onChangeText={set('end')} keyboardType="number-pad" testID="powers-end" /></View>
            </View>
            <Field label={t('bdk_power_limit')} value={draft.limit} onChangeText={set('limit')} keyboardType="decimal-pad" testID="powers-limit" />
            <Field label={t('bdk_received_on')} value={draft.received} onChangeText={set('received')} testID="powers-received" placeholder={t('bdk_date_ph')} />
            <Field label={t('bdk_power_expires')} value={draft.expires} onChangeText={set('expires')} testID="powers-expires" placeholder={t('bdk_date_ph')} />
            <Line muted>{t('bdk_power_range_help')}</Line>
            {!!formErr && <Line tone="danger" testID="powers-error">{formErr}</Line>}
            <Btn label={t('bdk_add')} onPress={add} busy={busy} testID="powers-save" />
            <Btn kind="ghost" label={t('cancel')} onPress={() => setAdding(false)} />
          </>
        )}
      </Card>

      <Card title={t('bdk_inventory')} testID="powers-list">
        <Chips options={[{ key: 'all' as const, label: t('bdk_all') }, ...STATUSES.map(k => ({ key: k, label: t(`bdk_pw_${k}`) }))]} value={status}
          onChange={k => { setStatus(k); load(k, surety); }} testIDPrefix="powers-status" />
        {sureties.length > 1 && (
          <Chips options={[{ key: 'all', label: t('bdk_all_sureties') }, ...sureties.map(n => ({ key: n, label: n }))]} value={surety}
            onChange={k => { setSurety(k); load(status, k); }} testIDPrefix="powers-surety-filter" />
        )}
        {!powers?.length && <Line muted testID="powers-empty">{t('bdk_powers_none')}</Line>}
        {(powers || []).map(p => (
          <View key={p.id} testID={`power-${p.id}`} style={s.item}>
            <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{p.number} · {p.surety_name}</Text>
            <Line>{t('bdk_power_limit')}: {money(p.limit_cents)}{p.expires_on ? ` · ${t('bdk_expires', { date: fmtDay(p.expires_on) })}` : ''}</Line>
            <Pill text={t(`bdk_pw_${p.status || 'available'}`)} tone={tone[p.status || 'available']} />
            {p.status === 'executed' && p.bond_id && (
              <TouchableOpacity accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => navigation.navigate('BondDetail', { bondId: p.bond_id })}>
                <Line tone="ok">{t('bdk_power_on_bond', { name: p.defendant_name || '', date: fmtDay(p.executed_on) })}</Line>
              </TouchableOpacity>
            )}
            {!!p.void_reason && <Line muted>{t('bdk_void_reason')}: {p.void_reason}</Line>}
            {p.status === 'available' && (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Btn kind="danger" label={t('bdk_void')} onPress={() => voidPower(p)} testID={`power-void-${p.id}`} />
                <Btn kind="ghost" label={t('bdk_return')} onPress={() => returnPower(p)} testID={`power-return-${p.id}`} />
              </View>
            )}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  itemTitle: { fontSize: 15, ...FONTS.bold, color: colors.textPrimary },
});

export default React.memo(PowersScreen);
