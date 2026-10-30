/**
 * RecoverySharesScreen — a recovery agent's read-only view of the forfeited bonds a bail agent
 * shared with them (B4; ⚖ server setting BOND_RECOVERY_SHARING_ENABLED; routes/recoveryShares.js).
 *
 *   - the list of live shares; tap one for the file: defendant, photo if on file (opened on
 *     request), last known addresses and phones from the bond and its questionnaire, check-ins
 *     (with a location only when the defendant shared it and the bail agent included locations),
 *     re-arrest matches, the forfeiture deadline, the agency's contact details and the state's
 *     recovery-agent rule as recorded (with how it was checked);
 *   - every opening of the file or the photo is logged and shown to the bail agent (said on screen);
 *   - access ends when the bond is reinstated or discharged, or the bail agent stops sharing.
 * The invitation link itself (recovery/<token>) is handled by RecoveryInviteScreen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice, Pill, Row } from '../components/bondDesk/ui';
import { StateRuleCard } from '../components/bondDesk/RecoverySection';
import { type StateRule, fmtDay, fmtWhen, money } from '../services/bondDesk';

interface ShareRow { id: number; defendant_name: string; forfeiture_deadline_on: string | null; state: string | null; agency: string; accepted_at: string }
type Item = { value: string; source: 'bond' | 'questionnaire' };
export interface ShareFile {
  share: { id: number; share_locations: boolean };
  defendant: { name: string; dob: string | null; photo_available: boolean };
  bond: { case_number: string | null; court_name: string | null; county: string | null; state: string | null; charges: string | null; bond_amount_cents: number;
    forfeited_on: string | null; forfeiture_deadline_on: string | null; days_left: number | null };
  addresses: Item[]; phones: Item[]; employers: Item[]; references: Item[]; vehicles: Item[];
  checkins: { at: string; via: string; location: { lat: number; lng: number } | null }[];
  rearrests: { match: 'strong' | 'possible'; status: string; found_at: string; booking_date: string | null; county: string | null; state: string | null; facility: string | null }[];
  agent: { agency: string; name: string; license: string; phone: string; email: string };
  state_rule: StateRule | null;
}

const tel = (p: string) => Linking.openURL(`tel:${p.replace(/[^\d+]/g, '')}`).catch(() => {});

function RecoverySharesScreen({ route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const initial = Number((route?.params as { shareId?: number | string } | undefined)?.shareId) || null;
  const [list, setList] = useState<ShareRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(initial);
  const [file, setFile] = useState<ShareFile | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const handleErr = (e: unknown) => {
    const err = e as { response?: { data?: { code?: string } } };
    if (err?.response?.data?.code === 'feature_unavailable') { setOff(true); return; }
    setError(apiErrorMessage(e, t('rsh_load_failed')));
  };
  const loadList = useCallback(async () => {
    try { const r = await api.get<{ shares: ShareRow[] }>('/recovery-shares'); if (mounted.current) { setList(r.data?.shares || []); setError(''); } }
    catch (e) { if (mounted.current) { setList([]); handleErr(e); } }
  }, []);
  const loadFile = useCallback(async (id: number) => {
    setFile(null);
    try { const r = await api.get<ShareFile>(`/recovery-shares/${id}`); if (mounted.current) { setFile(r.data); setError(''); } }
    catch (e) { if (mounted.current) { setOpen(null); handleErr(e); loadList(); } }
  }, [loadList]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (open) loadFile(open); }, [open, loadFile]);

  const photo = async () => {
    if (!file) return;
    try { await fetchFile(`/recovery-shares/${file.share.id}/photo`, `defendant-${file.share.id}.jpg`, 'image/jpeg', 'view'); }
    catch (e) { showToast(apiErrorMessage(e, t('rsh_photo_failed')), 'error'); }
  };
  const onRefresh = () => { setRefreshing(true); (open ? loadFile(open) : loadList()).finally(() => { if (mounted.current) setRefreshing(false); }); };
  const items = (title: string, list2: Item[], phone = false) => (
    <>
      <Line strong>{title}</Line>
      {!list2.length && <Line muted>{t('rsh_none_on_file')}</Line>}
      {list2.map((x, i) => (
        <TouchableOpacity key={i} disabled={!phone} accessibilityRole={phone ? 'button' : 'text'} onPress={() => tel(x.value)}>
          <Line>{`${x.value} · ${t(x.source === 'bond' ? 'rsh_from_bond' : 'rsh_from_questionnaire')}`}</Line>
        </TouchableOpacity>
      ))}
    </>
  );

  return (
    <ScrollView testID="recovery-shares-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('rsh_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('rsh_intro')}</Text>
      </View>
      {off && <Card testID="recovery-shares-off"><Line>{t('rsh_off')}</Line></Card>}
      {!!error && <Notice tone="error" text={error} testID="recovery-shares-error" />}
      {!off && !open && (
        <Card title={t('rsh_list')}>
          {!list && <ActivityIndicator color={colors.textBrand} />}
          {list && !list.length && <Line muted testID="recovery-shares-empty">{t('rsh_empty')}</Line>}
          {list?.map(r => (
            <TouchableOpacity key={r.id} accessibilityRole="button" onPress={() => setOpen(r.id)} style={s.item} testID={`recovery-shared-${r.id}`}>
              <Text maxFontSizeMultiplier={1.4} style={s.itemTitle}>{r.defendant_name}</Text>
              <Line muted>{t('rsh_list_line', { agency: r.agency, date: fmtDay(r.forfeiture_deadline_on) || '—' })}</Line>
            </TouchableOpacity>
          ))}
        </Card>
      )}
      {!off && open && !file && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />}
      {!off && open && file && (
        <View testID="recovery-share-file">
          <Notice text={t('rsh_logged')} testID="recovery-logged-note" />
          <Card title={file.defendant.name}>
            {!!file.defendant.dob && <Row label={t('rsh_dob')} value={fmtDay(file.defendant.dob)} />}
            <Row label={t('rsh_deadline')} value={file.bond.forfeiture_deadline_on
              ? `${fmtDay(file.bond.forfeiture_deadline_on)}${file.bond.days_left != null ? ` · ${t('rsh_days_left', { n: file.bond.days_left })}` : ''}` : '—'} />
            <Row label={t('rsh_bond')} value={`${money(file.bond.bond_amount_cents)}${file.bond.case_number ? ` · ${file.bond.case_number}` : ''}`} />
            <Row label={t('rsh_court')} value={[file.bond.court_name, file.bond.county, file.bond.state].filter(Boolean).join(', ') || '—'} />
            {!!file.bond.charges && <Row label={t('rsh_charges')} value={file.bond.charges} />}
            {file.defendant.photo_available
              ? <Btn kind="ghost" label={t('rsh_photo')} onPress={photo} testID="recovery-photo" />
              : <Line muted>{t('rsh_no_photo')}</Line>}
          </Card>
          <Card title={t('rsh_contact_info')}>
            {items(t('rsh_addresses'), file.addresses)}
            {items(t('rsh_phones'), file.phones, true)}
            {items(t('rsh_employers'), file.employers)}
            {items(t('rsh_references'), file.references)}
            {items(t('rsh_vehicles'), file.vehicles)}
          </Card>
          <Card title={t('rsh_checkins')}>
            <Line muted>{t(file.share.share_locations ? 'rsh_locations_on' : 'rsh_locations_off')}</Line>
            {!file.checkins.length && <Line muted>{t('rsh_no_checkins')}</Line>}
            {file.checkins.map((c, i) => (
              <Row key={i} label={fmtWhen(c.at)} value={c.location ? t('rsh_checkin_at', { lat: c.location.lat.toFixed(5), lng: c.location.lng.toFixed(5) }) : t('rsh_checkin_no_location')} />
            ))}
          </Card>
          <Card title={t('rsh_rearrests')}>
            {!file.rearrests.length && <Line muted>{t('rsh_no_rearrests')}</Line>}
            {file.rearrests.map((r, i) => (
              <View key={i} style={{ marginTop: 6 }}>
                <Pill text={t(r.match === 'strong' ? 'bdw_strong' : 'bdw_possible')} tone="danger" />
                <Line>{[fmtDay(r.booking_date), [r.county, r.state].filter(Boolean).join(', '), r.facility].filter(Boolean).join(' · ')}</Line>
              </View>
            ))}
          </Card>
          <Card title={t('rsh_agent')}>
            <Row label={t('rsh_agency')} value={[file.agent.agency, file.agent.name].filter(Boolean).join(' · ') || '—'} />
            {!!file.agent.license && <Row label={t('rsh_license')} value={file.agent.license} />}
            {!!file.agent.phone && <Btn kind="ghost" label={t('rsh_call_agent', { phone: file.agent.phone })} onPress={() => tel(file.agent.phone)} testID="recovery-call-agent" />}
            {!!file.agent.email && <Row label={t('rsh_email')} value={file.agent.email} />}
          </Card>
          <StateRuleCard rule={file.state_rule} state={file.bond.state} />
          <Btn kind="ghost" label={t('rsh_back')} onPress={() => { setOpen(null); setFile(null); loadList(); }} testID="recovery-back" />
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  item: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, minHeight: 44 },
  itemTitle: { fontSize: 15, ...FONTS.bold, color: colors.textPrimary },
});

export default React.memo(RecoverySharesScreen);
