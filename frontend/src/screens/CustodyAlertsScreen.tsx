/**
 * CustodyAlertsScreen — the bookings this person follows (A9, docs/CUSTODY_ALERTS.md; ⚖ server
 * setting CUSTODY_ALERTS_ENABLED — the screen says so when it is off).
 *
 * Each followed booking as the jail roster shows it now (status, facility, listed or "no longer
 * listed since …", the jail's phone to call) and the changes since it was followed. The person
 * can link it to one of their cases, turn texts on or off, and unfollow at any time. Wording
 * repeats the roster; it never says "released" unless the roster's own status does.
 * API: GET/PATCH/DELETE /api/custody/follows (backend routes/custody.js).
 */
import AmeelioCard from '../components/AmeelioCard';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Chips, Field, Line, Pill, Row } from '../components/bondDesk/ui';
import { fmtDay, fmtWhen } from '../services/bondDesk';

export interface CustodyEvent { id: number; kind: 'status_changed' | 'facility_changed' | 'not_listed' | 'listed_again'; old_value: string | null; new_value: string | null; observed_at: string }
export interface Follow {
  id: number; arrest_id: number; available: boolean; created_at: string; case_id: number | null; case_title: string | null;
  text_opt_in: boolean; text_phone_last4: string | null;
  booking?: { name: string; county: string | null; state: string | null; facility: string | null; status: string | null; jail_phone: string | null;
    booking_date: string | null; listed: boolean; not_listed_since: string | null; last_seen_at: string | null };
  events?: CustodyEvent[];
}

/** One line for a custody event, quoting the roster. */
export function eventText(e: CustodyEvent): string {
  if (e.kind === 'status_changed') return t('cus_ev_status', { old: e.old_value || '—', new: e.new_value || '—' });
  if (e.kind === 'facility_changed') return t('cus_ev_facility', { old: e.old_value || '—', new: e.new_value || '—' });
  return t(e.kind === 'not_listed' ? 'cus_ev_not_listed' : 'cus_ev_listed_again');
}

function CustodyAlertsScreen(_: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [follows, setFollows] = useState<Follow[] | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cases, setCases] = useState<{ id: number; title: string | null }[]>([]);
  const [editing, setEditing] = useState<{ id: number; phone: string; consent: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ follows: Follow[] }>('/custody/follows');
      if (mounted.current) { setFollows(r.data?.follows || []); setError(''); setOff(false); }
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { code?: string } } };
      if (err?.response?.data?.code === 'feature_unavailable') { if (mounted.current) { setOff(true); setFollows([]); } return; }
      if (mounted.current) setError(apiErrorMessage(e, t('cus_load_failed')));
    }
  }, []);
  useEffect(() => {
    load();
    api.get('/cases').then(r => { if (mounted.current) setCases(unwrapList<{ id: number; title: string | null }>(r.data, 'cases')); }).catch(() => { /* no cases: no link choice */ });
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); showToast(ok, 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('cus_save_failed')), 'error'); }
    finally { if (mounted.current) setBusy(null); }
  };
  const unfollow = async (f: Follow) => {
    try {
      if (!(await confirm(t('cus_unfollow_q'), t('cus_unfollow_body'), { confirmLabel: t('cus_unfollow'), destructive: true }))) return;
      await run(`un-${f.id}`, () => api.delete(`/custody/follows/${f.id}`), t('cus_unfollowed'));
    } catch (e) { showToast(apiErrorMessage(e, t('cus_save_failed')), 'error'); }
  };
  const linkCase = (f: Follow, caseId: string) => run(`case-${f.id}`, () => api.patch(`/custody/follows/${f.id}`, { case_id: caseId === 'none' ? null : Number(caseId) }), t('cus_saved'));
  const textsOff = (f: Follow) => run(`txt-${f.id}`, () => api.patch(`/custody/follows/${f.id}`, { text_opt_in: false }), t('cus_saved'));
  const textsOn = (f: Follow) => {
    if (!editing || !editing.phone.trim() || !editing.consent) { showToast(t('cus_text_needed'), 'error'); return; }
    return run(`txt-${f.id}`, async () => {
      await api.patch(`/custody/follows/${f.id}`, { text_opt_in: true, phone: editing.phone.trim(), text_consent: true });
      if (mounted.current) setEditing(null);
    }, t('cus_saved'));
  };
  const onRefresh = () => { setRefreshing(true); load().finally(() => { if (mounted.current) setRefreshing(false); }); };

  return (
    <ScrollView testID="custody-alerts-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('cus_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('cus_intro')}</Text>
      </View>
      {off && <Card testID="custody-off"><Line>{t('cus_off')}</Line></Card>}
      {!!error && <Card><Line tone="danger" testID="custody-error">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></Card>}
      {!follows && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />}
      {follows && !off && !follows.length && <Card testID="custody-empty"><Line muted>{t('cus_empty')}</Line></Card>}
      {/* B10: free letters, photos and video calls through Ameelio, where the facility works with it */}
      {!!follows?.length && <View style={{ marginHorizontal: 16 }}><AmeelioCard testID="custody-ameelio" /></View>}
      {follows?.map(f => (
        <Card key={f.id} title={f.booking?.name || t('cus_removed_title')} testID={`custody-follow-${f.id}`}>
          {!f.available || !f.booking ? <Line muted testID={`custody-removed-${f.id}`}>{t('cus_removed')}</Line> : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Pill text={f.booking.listed ? t('cus_listed') : t('cus_not_listed')} tone={f.booking.listed ? 'ok' : 'warn'} />
              </View>
              {!f.booking.listed && f.booking.not_listed_since && (
                <Line tone="warn">{t('cus_not_listed_since', { time: fmtWhen(f.booking.not_listed_since) })}</Line>
              )}
              <Row label={t('cus_roster')} value={[f.booking.county, f.booking.state].filter(Boolean).join(', ') || '—'} />
              <Row label={t('cus_status')} value={f.booking.status || '—'} />
              <Row label={t('cus_facility')} value={f.booking.facility || '—'} />
              {!!f.booking.booking_date && <Row label={t('cus_booked')} value={fmtDay(String(f.booking.booking_date).slice(0, 10))} />}
              {!!f.booking.last_seen_at && <Row label={t('cus_last_checked')} value={fmtWhen(f.booking.last_seen_at)} />}
              {!!f.booking.jail_phone && (
                <Btn kind="ghost" label={t('cus_call_jail', { phone: f.booking.jail_phone })} testID={`custody-call-${f.id}`}
                  onPress={() => Linking.openURL(`tel:${String(f.booking?.jail_phone).replace(/[^\d+]/g, '')}`).catch(() => {})} />
              )}
              <Line muted>{t('cus_source_note')}</Line>
              <Line strong>{t('cus_changes')}</Line>
              {!f.events?.length && <Line muted>{t('cus_no_changes')}</Line>}
              {f.events?.map(e => <Row key={e.id} label={fmtWhen(e.observed_at)} value={eventText(e)} testID={`custody-event-${e.id}`} />)}
            </>
          )}
          {cases.length > 0 && (
            <>
              <Line strong>{t('cus_case')}</Line>
              <Chips options={[{ key: 'none', label: t('cus_case_none') }, ...cases.slice(0, 10).map(c => ({ key: String(c.id), label: c.title || t('cus_case_untitled', { id: c.id }) }))]}
                value={f.case_id ? String(f.case_id) : 'none'} onChange={k => linkCase(f, k)} testIDPrefix={`custody-case-${f.id}`} />
            </>
          )}
          <Line strong>{t('cus_texts')}</Line>
          {f.text_opt_in ? (
            <>
              <Line testID={`custody-texts-on-${f.id}`}>{t('cus_texts_on', { last4: f.text_phone_last4 || '' })}</Line>
              <Btn kind="ghost" label={t('cus_texts_stop')} busy={busy === `txt-${f.id}`} onPress={() => textsOff(f)} testID={`custody-texts-off-${f.id}`} />
            </>
          ) : editing?.id === f.id ? (
            <>
              <Field label={t('cus_phone')} value={editing.phone} onChangeText={v => setEditing({ ...editing, phone: v })} keyboardType="phone-pad" maxLength={40} testID={`custody-phone-${f.id}`} />
              <Check label={t('cus_text_consent')} value={editing.consent} onChange={v => setEditing({ ...editing, consent: v })} testID={`custody-text-consent-${f.id}`} />
              <Btn label={t('cus_texts_start')} busy={busy === `txt-${f.id}`} onPress={() => textsOn(f)} testID={`custody-texts-save-${f.id}`} />
            </>
          ) : (
            <Btn kind="ghost" label={t('cus_texts_add')} onPress={() => setEditing({ id: f.id, phone: '', consent: false })} testID={`custody-texts-add-${f.id}`} />
          )}
          <Btn kind="danger" label={t('cus_unfollow')} busy={busy === `un-${f.id}`} onPress={() => unfollow(f)} testID={`custody-unfollow-${f.id}`} />
        </Card>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
});

export default React.memo(CustodyAlertsScreen);
