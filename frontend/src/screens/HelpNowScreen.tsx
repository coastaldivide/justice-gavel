/**
 * HelpNowScreen — core path step 2: lawyers AND bail agents together.
 *
 *  - One search (GET /api/help/nearby): location from GPS only when already
 *    allowed or when the person taps "Use my location" (explained first);
 *    otherwise the saved state or a typed city. Works signed out.
 *  - Filters: charge, language, free consultation (as listed), open now,
 *    24/7, distance. "Open now" / "24/7" come from each listing's stored hours.
 *  - Ranking is the server's: distance + completeness, never payment.
 *  - One tap to call, text or get directions; "Report a problem with this
 *    listing" goes to the admin review queue (the listing itself is never
 *    edited from the app).
 *  - Public defender office + county inmate lookup links for the state, and
 *    the bail calculator (bail ranges only — no invented fee estimate).
 *  - Offline: the last results saved on this phone, clearly labelled.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { getLocation } from '../services/location';
import { locationGranted } from '../services/permissions';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { hapticCall } from '../services/haptics';
import { getUserState, stateName } from '../utils/userState';
import { isOfflineError, saveCoreProgress } from '../services/corePath';
import { getToken } from '../utils/secureStorage';
import { t, useLang, getLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

export interface Provider {
  id: number; kind: 'lawyer' | 'bail_agent'; name: string; organization: string | null; phone: string | null;
  website: string | null; address: string | null; city: string; state: string; lat: number | null; lng: number | null;
  distance_km: number | null; hours: string | null; hours_known: boolean; is_24_7: boolean; open_now: boolean | null;
  rating: number | null; review_count: number | null; languages: string[]; free_consultation: boolean | null;
  license_number: string | null; completeness: number;
}
interface HelpResult {
  lawyers: Provider[]; bail_agents: Provider[];
  public_defender: { name: string; phone: string | null; url: string | null; eligibility: string | null; about: string | null; note: string } | null;
  inmate_lookup: { id: number; name: string; phone: string | null; url: string | null }[];
  meta: { state: string | null; ranking: string; hours_note: string; charge_note: string | null };
}
interface Filters { charge: string; language: string; free: boolean; open: boolean; h24: boolean; miles: number | null }

// Filter values are what the server matches (English practice areas / languages as listed);
// the chip labels are translated.
const CHARGES: { value: string; key: string }[] = [
  { value: 'DUI', key: 'hn_charge_dui' }, { value: 'Drug Offenses', key: 'hn_charge_drug' }, // i18n-exempt: server filter values; chip labels come from the key
  { value: 'Assault', key: 'hn_charge_assault' }, { value: 'Domestic Violence', key: 'hn_charge_domestic' }, // i18n-exempt: server filter values; chip labels come from the key
  { value: 'Theft', key: 'hn_charge_theft' }, { value: 'Weapons', key: 'hn_charge_weapons' }, // i18n-exempt: server filter values; chip labels come from the key
  { value: 'Traffic', key: 'hn_charge_traffic' }, // i18n-exempt: server filter values; chip labels come from the key
];
const LANGUAGES: { value: string; key: string }[] = [
  { value: 'Spanish', key: 'hn_lang_spanish' }, { value: 'Vietnamese', key: 'hn_lang_vietnamese' }, // i18n-exempt: server filter values; chip labels come from the key
  { value: 'Portuguese', key: 'hn_lang_portuguese' }, { value: 'Chinese', key: 'hn_lang_chinese' }, // i18n-exempt: server filter values; chip labels come from the key
];
const DISTANCES = [10, 25, 50];
const REASON_CODES = ['wrong_phone', 'closed', 'wrong_address', 'wrong_hours', 'not_this_service', 'other'];
// One saved copy per language (the notes in it come from the server in that language).
const cacheKey = () => `helpnow_cache_v3_${getLang()}`;
const EMPTY_FILTERS: Filters = { charge: '', language: '', free: false, open: false, h24: false, miles: null };

const miles = (km: number | null) => (km == null ? null : km / 1.609);
const fmtMiles = (km: number | null) => {
  const m = miles(km);
  if (m == null) return '';
  const n = m < 10 ? m.toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : String(Math.round(m));
  return t('hn_miles', { n });
};

type Where = { lat: number; lng: number } | { city: string } | { state: string };

function HelpNowScreen({ navigation }: ScreenProps): React.JSX.Element {
  const lang = useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [where, setWhere] = useState<Where | null>(null);
  const [cityInput, setCityInput] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [result, setResult] = useState<HelpResult | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<Provider | null>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [claim, setClaim] = useState<Provider | null>(null);
  const [license, setLicense] = useState('');
  const [claimPhone, setClaimPhone] = useState('');
  const [sortOpen, setSortOpen] = useState(false);

  const search = useCallback(async (w: Where, f: Filters) => {
    setPhase('loading'); setErrorMsg('');
    const params: Record<string, unknown> = { limit: 10 };
    if ('lat' in w) { params.lat = w.lat; params.lng = w.lng; }
    else if ('city' in w) params.city = w.city;
    else params.state = w.state;
    if (f.charge) params.charge = f.charge;
    if (f.language) params.language = f.language;
    if (f.free) params.free_consult = 1;
    if (f.open) params.open_now = 1;
    if (f.h24) params.h24 = 1;
    if (f.miles) params.max_km = Math.round(f.miles * 1.609);
    try {
      const res = await api.get<HelpResult>('/help/nearby', { params });
      if (!mounted.current) return;
      setResult(res.data); setPhase('ok'); setOfflineAt(null);
      AsyncStorage.setItem(cacheKey(), JSON.stringify({ result: res.data, at: new Date().toISOString() })).catch(() => {});
      saveCoreProgress({ mark: 'help' }).catch(() => {});
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const raw = await AsyncStorage.getItem(cacheKey()).catch(() => null);
        const cached = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
        if (cached?.result) { setResult(cached.result); setOfflineAt(cached.at); setPhase('ok'); return; }
      }
      setErrorMsg(isOfflineError(e) ? t('hn_offline_none') : apiErrorMessage(e, t('hn_search_failed')));
      setPhase('error');
    }
  }, []);

  // Start: GPS only if already allowed, else the saved state; else ask for a city.
  useEffect(() => {
    (async () => {
      let w: Where | null = null;
      if (await locationGranted().catch(() => false)) {
        const c = await getLocation({ prompt: false }).catch(() => null);
        if (c) w = { lat: c.lat, lng: c.lng };
      }
      if (!w) {
        const st = await getUserState();
        if (st?.code) w = { state: st.code };
      }
      if (!mounted.current) return;
      if (w) { setWhere(w); search(w, EMPTY_FILTERS); }
    })();
  }, [search]);

  // Language switched: the server notes come back in the new language.
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    if (where) search(where, filters);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const useMyLocation = async () => {
    try {
      const c = await getLocation({ prompt: true });
      const w = { lat: c.lat, lng: c.lng };
      setWhere(w); search(w, filters);
    } catch {
      showToast(t('hn_location_off'), 'warning');
    }
  };
  const searchCity = () => {
    const c = cityInput.trim();
    if (c.length < 2) { showToast(t('hn_type_city'), 'warning'); return; }
    const w = { city: c }; setWhere(w); search(w, filters);
  };
  const applyFilters = (patch: Partial<Filters>) => {
    const f = { ...filters, ...patch }; setFilters(f);
    if (where) search(where, f);
  };
  const onRefresh = async () => { if (!where) return; setRefreshing(true); await search(where, filters); setRefreshing(false); };

  const call = (p: Provider) => { if (!p.phone) return; hapticCall(); Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, '')}`).catch(() => showToast(t('cp_dial_manually', { num: String(p.phone) }), 'warning')); };
  const text = (p: Provider) => { if (!p.phone) return; Linking.openURL(`sms:${p.phone.replace(/[^\d+]/g, '')}`).catch(() => showToast(t('hn_text_unavailable'), 'warning')); };
  const directions = (p: Provider) => {
    const dest = p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : encodeURIComponent(p.address || `${p.name} ${p.city} ${p.state}`);
    const url = Platform.OS === 'ios' ? `maps://maps.apple.com/?daddr=${dest}` : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    Linking.openURL(url).catch(() => showToast(t('hn_maps_unavailable'), 'warning'));
  };

  const submitReport = async () => {
    if (!report || !reason || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    try {
      const r = await api.post<{ message: string }>('/help/reports', {
        provider_type: report.kind, provider_id: report.id, reason, details: details.trim() || undefined,
      });
      showToast(r.data?.message || t('hn_report_thanks'), 'success');
      setReport(null); setReason(''); setDetails('');
    } catch (e) {
      showToast(apiErrorMessage(e, t('hn_report_failed')), 'error');
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };

  const openClaim = async (p: Provider) => {
    const tok = await getToken().catch(() => null);
    if (!tok) {
      showToast(t('hn_claim_signin'), 'info');
      (navigation as any).navigate('Login');
      return;
    }
    setClaim(p); setLicense(''); setClaimPhone('');
  };
  const submitClaim = async () => {
    if (!claim || license.trim().length < 3 || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    try {
      const r = await api.post<{ message: string }>('/help/claims', {
        provider_type: claim.kind, provider_id: claim.id, license_number: license.trim(),
        license_state: claim.state, contact_phone: claimPhone.trim() || undefined,
      });
      showToast(r.data?.message || t('hn_claim_thanks'), 'success');
      setClaim(null);
    } catch (e) {
      showToast(apiErrorMessage(e, t('hn_claim_failed')), 'error');
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };

  const Chip = ({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${t('hn_filter_a11y', { label })}${active ? t('hn_filter_on') : ''}`}
      testID={testID} style={[styles.chip, active && styles.chipOn]} onPress={onPress}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, active && styles.chipTextOn]}>{active ? '✓ ' : ''}{label}</Text>
    </TouchableOpacity>
  );

  const Card = ({ p }: { p: Provider }) => (
    <View style={styles.card} testID={p.kind === 'lawyer' ? 'help-lawyer-card' : 'help-bail-card'}>
      <View style={styles.cardTop}>
        <IconLabel icon={p.kind === 'lawyer' ? ICONS.lawyer : ICONS.bail} size={14} maxFontSizeMultiplier={1.2}
          color={p.kind === 'lawyer' ? colors.textBrand : colors.textPrimary} textStyle={styles.kind}>
          {p.kind === 'lawyer' ? t('hn_kind_lawyer') : t('hn_kind_bail')}
        </IconLabel>
        {!!p.distance_km && <Text maxFontSizeMultiplier={1.3} style={styles.distance}>{fmtMiles(p.distance_km)}</Text>}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={styles.name} testID="help-card-name">{p.name}</Text>
      {!!p.organization && p.organization !== p.name && <Text maxFontSizeMultiplier={1.4} style={styles.org}>{p.organization}</Text>}
      {!!p.address && <Text maxFontSizeMultiplier={1.4} style={styles.address} numberOfLines={2}>{p.address}</Text>}
      <View style={styles.badges}>
        {p.is_24_7 ? <Text testID="help-247-badge" maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeOpen]}>24/7</Text>
          : p.open_now === true ? <Text testID="help-open-badge" maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeOpen]}>{t('hn_open_now')}</Text>
            : p.open_now === false ? <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeClosed]}>{t('hn_closed_now')}</Text>
              : <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>{t('hn_hours_unknown')}</Text>}
        {p.kind === 'lawyer' && p.free_consultation && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>{t('hn_free_consult_listed')}</Text>}
        {!!p.license_number && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>{t('hn_license', { num: String(p.license_number) })}</Text>}
        {p.rating != null && p.rating > 0 && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>★ {p.rating.toFixed(1)}{p.review_count ? ` (${p.review_count})` : ''}</Text>}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" testID="help-call" disabled={!p.phone} accessibilityLabel={p.phone ? t('hn_call_a11y', { name: p.name }) : t('hn_no_phone')}
          style={[styles.actionBtn, styles.actionCall, !p.phone && styles.actionDisabled]} onPress={() => call(p)}>
          <IconLabel center icon={ICONS.phoneFilled} color={colors.white} textStyle={styles.actionCallText} maxFontSizeMultiplier={1.3}>{t('hn_call')}</IconLabel>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="help-text" disabled={!p.phone} accessibilityLabel={t('hn_text_a11y', { name: p.name })}
          style={[styles.actionBtn, !p.phone && styles.actionDisabled]} onPress={() => text(p)}>
          <IconLabel center icon={ICONS.message} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_text')}</IconLabel>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="help-directions" accessibilityLabel={t('hn_directions_a11y', { name: p.name })}
          style={styles.actionBtn} onPress={() => directions(p)}>
          <IconLabel center icon={ICONS.directions} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_directions')}</IconLabel>
        </TouchableOpacity>
      </View>
      <TouchableOpacity accessibilityRole="button" testID="help-report" accessibilityLabel={t('hn_report_a11y', { name: p.name })}
        style={styles.reportLink} onPress={() => { setReport(p); setReason(''); setDetails(''); }}>
        <IconLabel icon={ICONS.flag} size={14} color={colors.textSecond} textStyle={styles.reportText} maxFontSizeMultiplier={1.3}>{t('hn_report_link')}</IconLabel>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="help-claim" accessibilityLabel={t('hn_claim_a11y', { name: p.name })}
        style={styles.reportLink} onPress={() => openClaim(p)}>
        <Text maxFontSizeMultiplier={1.3} style={styles.reportText}>{t('hn_claim_link')}</Text>
      </TouchableOpacity>
    </View>
  );

  const st = result?.meta?.state;
  return (
    <View style={styles.screen} testID="help-now-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('hn_title')}</Text>

        <View style={styles.whereRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-use-location" style={styles.locBtn} onPress={useMyLocation}>
            <IconLabel center icon={ICONS.location} color={colors.white} textStyle={styles.locBtnText} maxFontSizeMultiplier={1.3}>{t('hn_use_location')}</IconLabel>
          </TouchableOpacity>
        </View>
        <View style={styles.whereRow}>
          <TextInput accessibilityLabel={t('hn_city_a11y')} testID="help-city-input" style={styles.input}
            placeholder={t('hn_city_placeholder')} placeholderTextColor={colors.textMuted}
            value={cityInput} onChangeText={setCityInput} onSubmitEditing={searchCity} returnKeyType="search" />
          <TouchableOpacity accessibilityRole="button" testID="help-city-search" style={styles.goBtn} onPress={searchCity}>
            <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('search')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('hn_open_now')} active={filters.open} onPress={() => applyFilters({ open: !filters.open })} testID="help-filter-open" />
          <Chip label="24/7" active={filters.h24} onPress={() => applyFilters({ h24: !filters.h24 })} testID="help-filter-24" />
          <Chip label={t('hn_free_consult')} active={filters.free} onPress={() => applyFilters({ free: !filters.free })} testID="help-filter-free" />
          {DISTANCES.map(d => (
            <Chip key={d} label={t('hn_within', { n: d })} active={filters.miles === d} onPress={() => applyFilters({ miles: filters.miles === d ? null : d })} testID={`help-filter-mi-${d}`} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CHARGES.map(({ value: c, key }) => (
            <Chip key={c} label={t(key)} active={filters.charge === c} onPress={() => applyFilters({ charge: filters.charge === c ? '' : c })} testID={`help-filter-charge-${c.replace(/\s+/g, '-').toLowerCase()}`} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LANGUAGES.map(({ value: l, key }) => (
            <Chip key={l} label={t(key)} active={filters.language === l} onPress={() => applyFilters({ language: filters.language === l ? '' : l })} testID={`help-filter-lang-${l.toLowerCase()}`} />
          ))}
        </ScrollView>

        {!where && phase === 'idle' && (
          <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-need-location">{t('hn_need_location')}</Text>
        )}
        {phase === 'loading' && <ActivityIndicator style={{ marginVertical: 24 }} color={colors.textBrand} accessibilityLabel={t('bail_searching')} />}
        {phase === 'error' && (
          <View style={styles.errorBox} testID="help-error">
            <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{errorMsg}</Text>
            {!!where && (
              <TouchableOpacity accessibilityRole="button" style={styles.goBtn} onPress={() => where && search(where, filters)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('try_again')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {!!offlineAt && (
          <View style={styles.offline}>
            <IconLabel icon={ICONS.offline} color={colors.warnDark} textStyle={styles.offlineText} testID="help-offline">{t('hn_offline_saved')}</IconLabel>
          </View>
        )}

        {phase === 'ok' && result && (
          <>
            {!!result.meta.charge_note && <Text maxFontSizeMultiplier={1.4} style={styles.meta}>{result.meta.charge_note}</Text>}

            <View style={styles.groupRow}>
              <IconLabel icon={ICONS.lawyer} color={colors.textPrimary} textStyle={styles.groupText} style={{ flex: 1 }}>{t('hn_lawyers_count', { n: result.lawyers.length })}</IconLabel>
              <TouchableOpacity accessibilityRole="button" testID="help-sort-toggle" accessibilityState={{ expanded: sortOpen }}
                style={styles.sortLink} onPress={() => setSortOpen(o => !o)}>
                <IconLabel icon={sortOpen ? ICONS.chevronUp : ICONS.chevronDown} size={15} color={colors.textBrand} textStyle={styles.sortLinkText} maxFontSizeMultiplier={1.3}>{t('hn_how_sorted')}</IconLabel>
              </TouchableOpacity>
            </View>
            {sortOpen && (
              <Text maxFontSizeMultiplier={1.4} style={styles.sortNote} testID="help-ranking-note">
                {st ? `${stateName(st)} · ` : ''}{result.meta.ranking} {result.meta.hours_note}
              </Text>
            )}
            {result.lawyers.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-empty-lawyers">{t('hn_empty_lawyers')}</Text>}
            {result.lawyers.map(p => <Card key={`l${p.id}`} p={p} />)}

            {!!result.public_defender && (
              <View style={styles.pdBox} testID="help-public-defender">
                <Text maxFontSizeMultiplier={1.4} style={styles.pdTitle}>{t('hn_pd_title')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.pdName}>{result.public_defender.name}</Text>
                {!!result.public_defender.eligibility && <Text maxFontSizeMultiplier={1.4} style={styles.pdBody}>{t('hn_pd_who')} {result.public_defender.eligibility}</Text>}
                <Text maxFontSizeMultiplier={1.4} style={styles.pdBody}>{result.public_defender.note}</Text>
                <View style={styles.actions}>
                  {!!result.public_defender.phone && (
                    <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.actionCall]} onPress={() => Linking.openURL(`tel:${String(result.public_defender?.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}>
                      <IconLabel center icon={ICONS.phoneFilled} color={colors.white} textStyle={styles.actionCallText} maxFontSizeMultiplier={1.3}>{t('hn_call')}</IconLabel>
                    </TouchableOpacity>
                  )}
                  {!!result.public_defender.url && (
                    <TouchableOpacity accessibilityRole="link" style={styles.actionBtn} onPress={() => Linking.openURL(String(result.public_defender?.url)).catch(() => {})}>
                      <IconLabel center icon={ICONS.globe} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_website')}</IconLabel>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            <IconLabel icon={ICONS.bail} color={colors.textPrimary} textStyle={styles.groupText} style={styles.group}>{t('hn_bail_count', { n: result.bail_agents.length })}</IconLabel>
            {result.bail_agents.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-empty-bail">{t('hn_empty_bail')}</Text>}
            {result.bail_agents.map(p => <Card key={`b${p.id}`} p={p} />)}

            {result.inmate_lookup.length > 0 && (
              <View style={styles.pdBox} testID="help-inmate-lookup">
                <Text maxFontSizeMultiplier={1.4} style={styles.pdTitle}>{t('hn_inmate_title')}</Text>
                {result.inmate_lookup.map(r => (
                  <TouchableOpacity key={r.id} accessibilityRole="link" style={styles.lookupRow} disabled={!r.url}
                    onPress={() => r.url && Linking.openURL(r.url).catch(() => {})}>
                    <IconLabel icon={ICONS.search} color={colors.textPrimary} textStyle={styles.lookupText}>{r.name.replace(/^Inmate Lookup:\s*/i, '') /* recorded English label; the localized section title says it */}{r.phone ? ` · ${r.phone}` : ''}</IconLabel>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity accessibilityRole="button" testID="help-bail-calculator" style={styles.calcBtn}
              onPress={() => (navigation as any).navigate('BailCalculator', st ? { state: st, chargeType: filters.charge || undefined } : undefined)}>
              <IconLabel center icon={ICONS.calculator} color={colors.textPrimary} textStyle={styles.calcBtnText} maxFontSizeMultiplier={1.3}>{st ? t('hn_bail_amounts_in', { state: stateName(st) }) : t('hn_bail_amounts')}</IconLabel>
            </TouchableOpacity>
          </>
        )}
        <Text maxFontSizeMultiplier={1.4} style={[styles.group, styles.groupText]}>{t('hn_more_help')}</Text>
        <View style={styles.moreRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-more-lawyers" style={styles.moreBtn} onPress={() => (navigation as any).navigate('LawyersTab')}>
            <IconLabel center icon={ICONS.lawyer} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_all_lawyers')}</IconLabel>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="help-more-bail" style={styles.moreBtn} onPress={() => (navigation as any).navigate('BailTab')}>
            <IconLabel center icon={ICONS.bail} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_all_bail')}</IconLabel>
          </TouchableOpacity>
        </View>
        <View style={styles.moreRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-more-courts" style={styles.moreBtn} onPress={() => (navigation as any).navigate('CourtLocator', st ? { state: st } : undefined)}>
            <IconLabel center icon={ICONS.courthouse} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_find_courthouse')}</IconLabel>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="help-more-chat" style={styles.moreBtn} onPress={() => (navigation as any).navigate('ChatTab')}>
            <IconLabel center icon={ICONS.message} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_ask_question')}</IconLabel>
          </TouchableOpacity>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('cp_call_988_a11y')} style={styles.moreBtnWide} onPress={() => Linking.openURL('tel:988').catch(() => showToast(t('cp_dial_manually', { num: '988' }), 'warning'))}>
          <IconLabel center icon={ICONS.crisis} color={colors.textPrimary} textStyle={styles.actionText} maxFontSizeMultiplier={1.3}>{t('hn_crisis_988')}</IconLabel>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>{t('hn_disclaimer')}</Text>
      </ScrollView>

      <Modal visible={!!claim} transparent animationType="slide" onRequestClose={() => setClaim(null)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet} testID="claim-modal">
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{t('hn_claim_title')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.meta}>{t('hn_claim_body', { name: claim?.name || '' })}</Text>
            <TextInput accessibilityLabel={claim?.kind === 'lawyer' ? t('hn_bar_number') : t('hn_license_number_a11y')} testID="claim-license" style={[styles.input, { marginTop: 10 }]}
              placeholder={claim?.kind === 'lawyer' ? t('hn_bar_number') : t('hn_license_number')} placeholderTextColor={colors.textMuted} value={license} onChangeText={setLicense} maxLength={40} />
            <TextInput accessibilityLabel={t('hn_claim_phone_a11y')} style={[styles.input, { marginTop: 8 }]} keyboardType="phone-pad"
              placeholder={t('hn_claim_phone')} placeholderTextColor={colors.textMuted} value={claimPhone} onChangeText={setClaimPhone} maxLength={30} />
            <TouchableOpacity accessibilityRole="button" testID="claim-submit" disabled={license.trim().length < 3 || sending}
              style={[styles.submitBtn, (license.trim().length < 3 || sending) && styles.actionDisabled]} onPress={submitClaim}>
              <Text maxFontSizeMultiplier={1.3} style={styles.submitText}>{t('hn_send_claim')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={() => setClaim(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!report} transparent animationType="slide" onRequestClose={() => setReport(null)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet} testID="report-modal">
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{t('hn_report_title')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.meta}>{report?.name}</Text>
            {REASON_CODES.map(code => (
              <TouchableOpacity key={code} accessibilityRole="radio" accessibilityState={{ selected: reason === code }}
                testID={`report-reason-${code}`} style={[styles.reasonRow, reason === code && styles.reasonRowOn]} onPress={() => setReason(code)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.reasonText}>{reason === code ? '◉' : '○'}  {t(`hn_reason_${code}`)}</Text>
              </TouchableOpacity>
            ))}
            <TextInput accessibilityLabel={t('hn_report_details')} testID="report-details" style={[styles.input, { marginTop: 8 }]} maxLength={500}
              placeholder={t('hn_report_details')} placeholderTextColor={colors.textMuted} value={details} onChangeText={setDetails} />
            <TouchableOpacity accessibilityRole="button" testID="report-submit" disabled={!reason || sending}
              style={[styles.submitBtn, (!reason || sending) && styles.actionDisabled]} onPress={submitReport}>
              {sending ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.3} style={styles.submitText}>{t('hn_send_report')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={() => setReport(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { color: c.textPrimary, fontSize: 22, fontWeight: '900', marginBottom: 10 },
  whereRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  locBtn: { flex: 1, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
  locBtnText: { color: c.white, fontSize: 16, fontWeight: '800' },
  input: { flex: 1, minWidth: 0, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  goBtn: { backgroundColor: c.navy, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', minHeight: 48, marginTop: 4, flexShrink: 0 },
  goBtnText: { color: c.white, fontSize: 15, fontWeight: '800' },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { backgroundColor: c.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipText: { color: c.textPrimary, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.white },
  hint: { color: c.textSecond, fontSize: 15, lineHeight: 21, marginVertical: 10 },
  errorBox: { backgroundColor: c.bgCard, borderRadius: 12, padding: 14, marginVertical: 10, borderWidth: 1, borderColor: c.border },
  errorText: { color: c.textPrimary, fontSize: 15, lineHeight: 21 },
  offline: { backgroundColor: c.warnBg, borderRadius: 10, padding: 10, marginVertical: 8 },
  offlineText: { color: c.warnDark, fontSize: 13, lineHeight: 18 },
  meta: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  group: { marginTop: 16, marginBottom: 8 },
  groupText: { color: c.textPrimary, fontSize: 18, fontWeight: '900' },
  groupRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 12, marginBottom: 6 },
  sortLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  sortLinkText: { color: c.textBrand, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  sortNote: { color: c.textSecond, fontSize: 13, lineHeight: 19, backgroundColor: c.bgSubtle, borderRadius: 10, padding: 10, marginBottom: 8 },
  card: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  kindLawyer: { color: c.textBrand },
  kindBail: { color: c.textPrimary },
  distance: { color: c.textSecond, fontSize: 13, fontWeight: '700' },
  name: { color: c.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 4 },
  org: { color: c.textSecond, fontSize: 14 },
  address: { color: c.textMuted, fontSize: 13, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { fontSize: 12, fontWeight: '800', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  badgeOpen: { color: c.white, backgroundColor: c.legalDark },
  badgeClosed: { color: c.textPrimary, backgroundColor: c.bgSubtle },
  badgeUnknown: { color: c.textSecond, backgroundColor: c.bgSubtle },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  actionCall: { backgroundColor: c.legalDark, borderColor: c.legalDark },
  actionCallText: { color: c.white, fontSize: 15, fontWeight: '900' },
  actionText: { color: c.textPrimary, fontSize: 14, fontWeight: '800' },
  actionDisabled: { opacity: 0.45 },
  reportLink: { marginTop: 8, minHeight: 44, justifyContent: 'center' },
  reportText: { color: c.textSecond, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  pdBox: { backgroundColor: c.infoBg, borderRadius: 14, padding: 14, marginVertical: 10 },
  pdTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '900', marginBottom: 4 },
  pdName: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
  pdBody: { color: c.textPrimary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  lookupRow: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  lookupText: { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
  calcBtn: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingVertical: 14, alignItems: 'center', minHeight: 48, marginTop: 8 },
  calcBtnText: { color: c.textPrimary, fontSize: 15, fontWeight: '800' },
  disclaimer: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 16, fontStyle: 'italic' },
  moreRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  moreBtn: { flex: 1, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 6 },
  moreBtnWide: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { color: c.textPrimary, fontSize: 20, fontWeight: '900' },
  reasonRow: { paddingVertical: 12, paddingHorizontal: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.border },
  reasonRowOn: { backgroundColor: c.infoBg },
  reasonText: { color: c.textPrimary, fontSize: 15 },
  submitBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 52, marginTop: 12 },
  submitText: { color: c.white, fontSize: 16, fontWeight: '900' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', minHeight: 44 },
  cancelText: { color: c.textSecond, fontSize: 15, fontWeight: '700' },
});

export default React.memo(HelpNowScreen);
