/**
 * Alerts tab of a bond (routes/bondDesk/watch.js): the re-arrest watch (⚖ server setting
 * BOND_REARREST_ALERTS_ENABLED — the section is only shown when GET /bond-desk/access says it is
 * on) with the counties whose jail rosters we import (never "nationwide"), the matches (a
 * possible, name-only match is confirmed or dismissed here), the agent's "text me too" choice,
 * and the bond timeline (re-arrests, recovery-agent sharing).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { t, useLang } from '../../i18n';
import { useTheme } from '../../constants/theme';
import { Btn, Card, Check, Field, Line, Pill, Row } from './ui';
import { type Access, type BondDetail, type BondEvent, type Rearrest, type RearrestView, coverageText, fmtDay, fmtWhen, money, tOr } from '../../services/bondDesk';

const matchTone = (r: Rearrest) => (r.status === 'dismissed' ? 'muted' : r.match === 'strong' || r.status === 'confirmed' ? 'danger' : 'warn');

/** One line for a timeline event. */
export function eventLine(e: BondEvent): string {
  const d = e.detail || {};
  const where = [d.county, d.state].filter(Boolean).join(', ');
  return tOr(`bdw_ev_${e.kind}`, e.kind, { where: where || '—', email: String(d.email ?? ''), reason: tOr(`bdw_end_${String(d.reason ?? '')}`, String(d.reason ?? '')) });
}

export function AlertsSection({ detail, access }: { detail: BondDetail; access: Access | null }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const bondId = detail.bond.id;
  const rearrestOn = !!access?.features?.rearrest_alerts;
  const [view, setView] = useState<RearrestView | null>(null);
  const [events, setEvents] = useState<BondEvent[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [textOn, setTextOn] = useState(false);
  const [phone, setPhone] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const [w, tl] = await Promise.all([
        rearrestOn ? api.get<RearrestView>(`/bond-desk/bonds/${bondId}/rearrests`) : Promise.resolve(null),
        api.get<{ events: BondEvent[] }>(`/bond-desk/bonds/${bondId}/timeline`),
      ]);
      if (!mounted.current) return;
      if (w) { setView(w.data); setTextOn(!!w.data.settings.rearrest_text); setPhone(w.data.settings.alert_phone || ''); }
      setEvents(tl.data?.events || []); setError('');
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [bondId, rearrestOn]);
  useEffect(() => { load(); }, [load]);

  const decide = async (r: Rearrest, d: 'confirm' | 'dismiss') => {
    if (busy) return;
    setBusy(`${d}-${r.id}`);
    try { await api.post(`/bond-desk/rearrests/${r.id}/${d}`); showToast(t('bdk_saved'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { if (mounted.current) setBusy(null); }
  };
  const saveSettings = async () => {
    if (busy) return;
    setBusy('settings');
    try { await api.put('/bond-desk/rearrest-settings', { rearrest_text: textOn, alert_phone: phone.trim() || null }); showToast(t('bdk_saved'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { if (mounted.current) setBusy(null); }
  };

  if (!events) {
    return (
      <Card testID="bond-alerts">
        {error ? <><Line tone="danger" testID="alerts-error">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></>
          : <ActivityIndicator color={colors.textBrand} />}
      </Card>
    );
  }

  return (
    <View testID="bond-alerts">
      {rearrestOn && view && (
        <Card title={t('bdw_title')} testID="rearrest-watch">
          {view.coverage.counties.length
            ? <Line testID="rearrest-coverage">{t('bdw_coverage', { counties: coverageText(view.coverage) })}</Line>
            : <Line tone="warn" testID="rearrest-no-coverage">{t('bdw_no_coverage')}</Line>}
          <Line muted>{t('bdw_how')}</Line>
          {!view.watching && <Line tone="warn" testID="rearrest-not-watching">{t('bdw_not_watching')}</Line>}
          {!view.dob_on_file && <Line tone="warn" testID="rearrest-no-dob">{t('bdw_no_dob')}</Line>}
          <Line muted>{t('bdw_price')}</Line>
          {!view.matches.length && <Line muted testID="rearrest-none">{t('bdw_none')}</Line>}
          {view.matches.map(r => (
            <View key={r.id} testID={`rearrest-${r.id}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Pill text={t(r.match === 'strong' ? 'bdw_strong' : 'bdw_possible')} tone={matchTone(r)} />
                <Pill text={t(`bdw_st_${r.status}`)} tone={r.status === 'pending' ? 'warn' : 'muted'} />
              </View>
              <Row label={t('bdw_booking_name')} value={r.booking.name} />
              <Row label={t('bdw_booked')} value={[fmtDay(r.booking.booking_date), [r.booking.county, r.booking.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'} />
              {!!r.booking.facility && <Row label={t('bdw_facility')} value={r.booking.facility} />}
              {!!r.booking.charges && <Row label={t('bdw_charges')} value={r.booking.charges} />}
              <Line muted>{t(r.match === 'strong' ? 'bdw_strong_help' : 'bdw_possible_help')}</Line>
              {r.status === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn label={t('bdw_confirm')} testID={`rearrest-confirm-${r.id}`} busy={busy === `confirm-${r.id}`} onPress={() => decide(r, 'confirm')} style={{ flex: 1 }} />
                  <Btn kind="ghost" label={t('bdw_dismiss')} testID={`rearrest-dismiss-${r.id}`} busy={busy === `dismiss-${r.id}`} onPress={() => decide(r, 'dismiss')} style={{ flex: 1 }} />
                </View>
              )}
            </View>
          ))}
          <Line strong>{t('bdw_text_me')}</Line>
          <Check label={t('bdw_text_me_box', { price: money(view.text_cents) })} value={textOn} onChange={setTextOn} testID="rearrest-text-on" />
          {textOn && <Field label={t('bdw_text_phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={t('bdw_text_phone_ph')} testID="rearrest-text-phone" maxLength={40} />}
          <Btn kind="ghost" label={t('bdk_save')} busy={busy === 'settings'} onPress={saveSettings} testID="rearrest-settings-save" />
        </Card>
      )}
      <Card title={t('bdw_timeline')} testID="bond-timeline">
        {!events.length && <Line muted>{t('bdw_timeline_empty')}</Line>}
        {events.map(e => <Row key={e.id} label={fmtWhen(e.at)} value={eventLine(e)} testID={`timeline-${e.kind}`} />)}
      </Card>
    </View>
  );
}
