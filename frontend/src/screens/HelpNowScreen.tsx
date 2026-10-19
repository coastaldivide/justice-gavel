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
import { getUserState, STATE_NAMES } from '../utils/userState';
import { isOfflineError, saveCoreProgress } from '../services/corePath';
import { getToken } from '../utils/secureStorage';

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

const CHARGES = ['DUI', 'Drug Offenses', 'Assault', 'Domestic Violence', 'Theft', 'Weapons', 'Traffic'];
const LANGUAGES = ['Spanish', 'Vietnamese', 'Portuguese', 'Chinese'];
const DISTANCES = [10, 25, 50];
const REASONS: { code: string; label: string }[] = [
  { code: 'wrong_phone', label: 'Wrong or disconnected phone number' },
  { code: 'closed', label: 'Closed / out of business' },
  { code: 'wrong_address', label: 'Wrong address' },
  { code: 'wrong_hours', label: 'Wrong hours' },
  { code: 'not_this_service', label: 'Does not offer this service' },
  { code: 'other', label: 'Something else' },
];
const CACHE_KEY = 'helpnow_cache_v2';
const EMPTY_FILTERS: Filters = { charge: '', language: '', free: false, open: false, h24: false, miles: null };

const miles = (km: number | null) => (km == null ? null : km / 1.609);
const fmtMiles = (km: number | null) => {
  const m = miles(km);
  return m == null ? '' : m < 10 ? `${m.toFixed(1)} mi` : `${Math.round(m)} mi`;
};

type Where = { lat: number; lng: number } | { city: string } | { state: string };

function HelpNowScreen({ navigation }: ScreenProps): React.JSX.Element {
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
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ result: res.data, at: new Date().toISOString() })).catch(() => {});
      saveCoreProgress({ mark: 'help' }).catch(() => {});
    } catch (e) {
      if (!mounted.current) return;
      if (isOfflineError(e)) {
        const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
        const cached = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
        if (cached?.result) { setResult(cached.result); setOfflineAt(cached.at); setPhase('ok'); return; }
      }
      setErrorMsg(isOfflineError(e) ? 'You are offline and no results are saved on this phone yet. Call 911 in an emergency.' : apiErrorMessage(e, 'Could not search right now.'));
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

  const useMyLocation = async () => {
    try {
      const c = await getLocation({ prompt: true });
      const w = { lat: c.lat, lng: c.lng };
      setWhere(w); search(w, filters);
    } catch {
      showToast('Location is off — type your city instead.', 'warning');
    }
  };
  const searchCity = () => {
    const c = cityInput.trim();
    if (c.length < 2) { showToast('Type a city, e.g. Nashville, TN', 'warning'); return; }
    const w = { city: c }; setWhere(w); search(w, filters);
  };
  const applyFilters = (patch: Partial<Filters>) => {
    const f = { ...filters, ...patch }; setFilters(f);
    if (where) search(where, f);
  };
  const onRefresh = async () => { if (!where) return; setRefreshing(true); await search(where, filters); setRefreshing(false); };

  const call = (p: Provider) => { if (!p.phone) return; hapticCall(); Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, '')}`).catch(() => showToast(`Please dial ${p.phone} manually.`, 'warning')); };
  const text = (p: Provider) => { if (!p.phone) return; Linking.openURL(`sms:${p.phone.replace(/[^\d+]/g, '')}`).catch(() => showToast('Texting is not available on this device.', 'warning')); };
  const directions = (p: Provider) => {
    const dest = p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : encodeURIComponent(p.address || `${p.name} ${p.city} ${p.state}`);
    const url = Platform.OS === 'ios' ? `maps://maps.apple.com/?daddr=${dest}` : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    Linking.openURL(url).catch(() => showToast('Maps are not available on this device.', 'warning'));
  };

  const submitReport = async () => {
    if (!report || !reason || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    try {
      const r = await api.post<{ message: string }>('/help/reports', {
        provider_type: report.kind, provider_id: report.id, reason, details: details.trim() || undefined,
      });
      showToast(r.data?.message || 'Thanks — our team will check this listing.', 'success');
      setReport(null); setReason(''); setDetails('');
    } catch (e) {
      showToast(apiErrorMessage(e, 'Could not send the report. Please try again.'), 'error');
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };

  const openClaim = async (p: Provider) => {
    const tok = await getToken().catch(() => null);
    if (!tok) {
      showToast('Sign in with your professional account to claim a listing.', 'info');
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
      showToast(r.data?.message || 'Thanks — we will check your license.', 'success');
      setClaim(null);
    } catch (e) {
      showToast(apiErrorMessage(e, 'Could not send the claim.'), 'error');
    } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };

  const Chip = ({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${label} filter${active ? ', on' : ''}`}
      testID={testID} style={[styles.chip, active && styles.chipOn]} onPress={onPress}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, active && styles.chipTextOn]}>{active ? '✓ ' : ''}{label}</Text>
    </TouchableOpacity>
  );

  const Card = ({ p }: { p: Provider }) => (
    <View style={styles.card} testID={p.kind === 'lawyer' ? 'help-lawyer-card' : 'help-bail-card'}>
      <View style={styles.cardTop}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.kind, p.kind === 'lawyer' ? styles.kindLawyer : styles.kindBail]}>
          {p.kind === 'lawyer' ? '⚖️ LAWYER' : '🔓 BAIL AGENT'}
        </Text>
        {!!p.distance_km && <Text maxFontSizeMultiplier={1.3} style={styles.distance}>{fmtMiles(p.distance_km)}</Text>}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={styles.name}>{p.name}</Text>
      {!!p.organization && p.organization !== p.name && <Text maxFontSizeMultiplier={1.4} style={styles.org}>{p.organization}</Text>}
      {!!p.address && <Text maxFontSizeMultiplier={1.4} style={styles.address} numberOfLines={2}>{p.address}</Text>}
      <View style={styles.badges}>
        {p.is_24_7 ? <Text testID="help-247-badge" maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeOpen]}>24/7</Text>
          : p.open_now === true ? <Text testID="help-open-badge" maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeOpen]}>Open now</Text>
            : p.open_now === false ? <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeClosed]}>Closed now</Text>
              : <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>Hours not listed</Text>}
        {p.kind === 'lawyer' && p.free_consultation && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>Free consultation (as listed)</Text>}
        {!!p.license_number && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>Lic. {p.license_number}</Text>}
        {p.rating != null && p.rating > 0 && <Text maxFontSizeMultiplier={1.3} style={[styles.badge, styles.badgeUnknown]}>★ {p.rating.toFixed(1)}{p.review_count ? ` (${p.review_count})` : ''}</Text>}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" testID="help-call" disabled={!p.phone} accessibilityLabel={p.phone ? `Call ${p.name}` : 'No phone listed'}
          style={[styles.actionBtn, styles.actionCall, !p.phone && styles.actionDisabled]} onPress={() => call(p)}>
          <Text maxFontSizeMultiplier={1.3} style={styles.actionCallText}>📞 Call</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="help-text" disabled={!p.phone} accessibilityLabel={`Text ${p.name}`}
          style={[styles.actionBtn, !p.phone && styles.actionDisabled]} onPress={() => text(p)}>
          <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>💬 Text</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" testID="help-directions" accessibilityLabel={`Directions to ${p.name}`}
          style={styles.actionBtn} onPress={() => directions(p)}>
          <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>🧭 Directions</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity accessibilityRole="button" testID="help-report" accessibilityLabel={`Report a problem with the listing for ${p.name}`}
        style={styles.reportLink} onPress={() => { setReport(p); setReason(''); setDetails(''); }}>
        <Text maxFontSizeMultiplier={1.3} style={styles.reportText}>⚑ Report a problem with this listing</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="help-claim" accessibilityLabel={`Claim the listing for ${p.name} (for the business owner)`}
        style={styles.reportLink} onPress={() => openClaim(p)}>
        <Text maxFontSizeMultiplier={1.3} style={styles.reportText}>Is this your business? Claim this listing</Text>
      </TouchableOpacity>
    </View>
  );

  const st = result?.meta?.state;
  return (
    <View style={styles.screen} testID="help-now-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">Lawyers and bail agents near you</Text>

        <View style={styles.whereRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-use-location" style={styles.locBtn} onPress={useMyLocation}>
            <Text maxFontSizeMultiplier={1.3} style={styles.locBtnText}>📍 Use my location</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.whereRow}>
          <TextInput accessibilityLabel="City, for example Nashville, TN" testID="help-city-input" style={styles.input}
            placeholder="City, e.g. Nashville, TN" placeholderTextColor={colors.textMuted}
            value={cityInput} onChangeText={setCityInput} onSubmitEditing={searchCity} returnKeyType="search" />
          <TouchableOpacity accessibilityRole="button" testID="help-city-search" style={styles.goBtn} onPress={searchCity}>
            <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>Search</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Open now" active={filters.open} onPress={() => applyFilters({ open: !filters.open })} testID="help-filter-open" />
          <Chip label="24/7" active={filters.h24} onPress={() => applyFilters({ h24: !filters.h24 })} testID="help-filter-24" />
          <Chip label="Free consultation" active={filters.free} onPress={() => applyFilters({ free: !filters.free })} testID="help-filter-free" />
          {DISTANCES.map(d => (
            <Chip key={d} label={`Within ${d} mi`} active={filters.miles === d} onPress={() => applyFilters({ miles: filters.miles === d ? null : d })} testID={`help-filter-mi-${d}`} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CHARGES.map(c => (
            <Chip key={c} label={c} active={filters.charge === c} onPress={() => applyFilters({ charge: filters.charge === c ? '' : c })} testID={`help-filter-charge-${c.replace(/\s+/g, '-').toLowerCase()}`} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LANGUAGES.map(l => (
            <Chip key={l} label={l} active={filters.language === l} onPress={() => applyFilters({ language: filters.language === l ? '' : l })} testID={`help-filter-lang-${l.toLowerCase()}`} />
          ))}
        </ScrollView>

        {!where && phase === 'idle' && (
          <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-need-location">Tap “Use my location” or type your city to see lawyers and bail agents near you.</Text>
        )}
        {phase === 'loading' && <ActivityIndicator style={{ marginVertical: 24 }} color={colors.textBrand} accessibilityLabel="Searching" />}
        {phase === 'error' && (
          <View style={styles.errorBox} testID="help-error">
            <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{errorMsg}</Text>
            {!!where && (
              <TouchableOpacity accessibilityRole="button" style={styles.goBtn} onPress={() => where && search(where, filters)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {!!offlineAt && (
          <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="help-offline">📴 Offline — showing results saved on this phone. Call to confirm. Call 911 in an emergency.</Text>
        )}

        {phase === 'ok' && result && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={styles.meta} testID="help-ranking-note">
              {st ? `${STATE_NAMES[st] || st} · ` : ''}{result.meta.ranking} {result.meta.hours_note}
            </Text>
            {!!result.meta.charge_note && <Text maxFontSizeMultiplier={1.4} style={styles.meta}>{result.meta.charge_note}</Text>}

            <Text maxFontSizeMultiplier={1.4} style={styles.group}>⚖️ Lawyers ({result.lawyers.length})</Text>
            {result.lawyers.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-empty-lawyers">No lawyers match these filters here. Try fewer filters or a wider distance.</Text>}
            {result.lawyers.map(p => <Card key={`l${p.id}`} p={p} />)}

            {!!result.public_defender && (
              <View style={styles.pdBox} testID="help-public-defender">
                <Text maxFontSizeMultiplier={1.4} style={styles.pdTitle}>Can’t afford a lawyer? Public defender</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.pdName}>{result.public_defender.name}</Text>
                {!!result.public_defender.eligibility && <Text maxFontSizeMultiplier={1.4} style={styles.pdBody}>Who qualifies: {result.public_defender.eligibility}</Text>}
                <Text maxFontSizeMultiplier={1.4} style={styles.pdBody}>{result.public_defender.note}</Text>
                <View style={styles.actions}>
                  {!!result.public_defender.phone && (
                    <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.actionCall]} onPress={() => Linking.openURL(`tel:${String(result.public_defender?.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}>
                      <Text maxFontSizeMultiplier={1.3} style={styles.actionCallText}>📞 Call</Text>
                    </TouchableOpacity>
                  )}
                  {!!result.public_defender.url && (
                    <TouchableOpacity accessibilityRole="link" style={styles.actionBtn} onPress={() => Linking.openURL(String(result.public_defender?.url)).catch(() => {})}>
                      <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>🌐 Website</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            <Text maxFontSizeMultiplier={1.4} style={styles.group}>🔓 Bail agents ({result.bail_agents.length})</Text>
            {result.bail_agents.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.hint} testID="help-empty-bail">No bail agents match these filters here. Try fewer filters or a wider distance.</Text>}
            {result.bail_agents.map(p => <Card key={`b${p.id}`} p={p} />)}

            {result.inmate_lookup.length > 0 && (
              <View style={styles.pdBox} testID="help-inmate-lookup">
                <Text maxFontSizeMultiplier={1.4} style={styles.pdTitle}>Find someone in jail (county inmate lookup)</Text>
                {result.inmate_lookup.map(r => (
                  <TouchableOpacity key={r.id} accessibilityRole="link" style={styles.lookupRow} disabled={!r.url}
                    onPress={() => r.url && Linking.openURL(r.url).catch(() => {})}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.lookupText}>🔎 {r.name}{r.phone ? ` · ${r.phone}` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity accessibilityRole="button" testID="help-bail-calculator" style={styles.calcBtn}
              onPress={() => (navigation as any).navigate('BailCalculator', st ? { state: st, chargeType: filters.charge || undefined } : undefined)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.calcBtnText}>💰 Typical bail amounts{st ? ` in ${STATE_NAMES[st] || st}` : ''}</Text>
            </TouchableOpacity>
          </>
        )}
        <Text maxFontSizeMultiplier={1.4} style={styles.group}>More help</Text>
        <View style={styles.moreRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-more-lawyers" style={styles.moreBtn} onPress={() => (navigation as any).navigate('LawyersTab')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>⚖️ All lawyers</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="help-more-bail" style={styles.moreBtn} onPress={() => (navigation as any).navigate('BailTab')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>🔓 All bail agents</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.moreRow}>
          <TouchableOpacity accessibilityRole="button" testID="help-more-courts" style={styles.moreBtn} onPress={() => (navigation as any).navigate('CourtLocator', st ? { state: st } : undefined)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>🏛️ Find a courthouse</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="help-more-chat" style={styles.moreBtn} onPress={() => (navigation as any).navigate('ChatTab')}>
            <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>💬 Ask a question</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Call 988 crisis line" style={styles.moreBtnWide} onPress={() => Linking.openURL('tel:988').catch(() => showToast('Please dial 988.', 'warning'))}>
          <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>💙 Crisis or feeling unsafe? Call 988</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>Listings come from public business data. Justice Gavel does not endorse any lawyer or bail agent. Not legal advice.</Text>
      </ScrollView>

      <Modal visible={!!claim} transparent animationType="slide" onRequestClose={() => setClaim(null)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet} testID="claim-modal">
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>Claim this listing</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.meta}>{claim?.name}. We check your license before linking it, so families can message you in the app. The public listing is not changed.</Text>
            <TextInput accessibilityLabel={claim?.kind === 'lawyer' ? 'Bar number' : 'Bail agent license number'} testID="claim-license" style={[styles.input, { marginTop: 10 }]}
              placeholder={claim?.kind === 'lawyer' ? 'Bar number' : 'License number'} placeholderTextColor={colors.textMuted} value={license} onChangeText={setLicense} maxLength={40} />
            <TextInput accessibilityLabel="Phone we can reach you on (optional)" style={[styles.input, { marginTop: 8 }]} keyboardType="phone-pad"
              placeholder="Phone (optional)" placeholderTextColor={colors.textMuted} value={claimPhone} onChangeText={setClaimPhone} maxLength={30} />
            <TouchableOpacity accessibilityRole="button" testID="claim-submit" disabled={license.trim().length < 3 || sending}
              style={[styles.submitBtn, (license.trim().length < 3 || sending) && styles.actionDisabled]} onPress={submitClaim}>
              <Text maxFontSizeMultiplier={1.3} style={styles.submitText}>Send claim</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={() => setClaim(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!report} transparent animationType="slide" onRequestClose={() => setReport(null)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet} testID="report-modal">
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>Report a problem</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.meta}>{report?.name}</Text>
            {REASONS.map(r => (
              <TouchableOpacity key={r.code} accessibilityRole="radio" accessibilityState={{ selected: reason === r.code }}
                testID={`report-reason-${r.code}`} style={[styles.reasonRow, reason === r.code && styles.reasonRowOn]} onPress={() => setReason(r.code)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.reasonText}>{reason === r.code ? '◉' : '○'}  {r.label}</Text>
              </TouchableOpacity>
            ))}
            <TextInput accessibilityLabel="Details (optional)" testID="report-details" style={[styles.input, { marginTop: 8 }]} maxLength={500}
              placeholder="Details (optional)" placeholderTextColor={colors.textMuted} value={details} onChangeText={setDetails} />
            <TouchableOpacity accessibilityRole="button" testID="report-submit" disabled={!reason || sending}
              style={[styles.submitBtn, (!reason || sending) && styles.actionDisabled]} onPress={submitReport}>
              {sending ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.3} style={styles.submitText}>Send report</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={() => setReport(null)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelText}>Cancel</Text>
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
  input: { flex: 1, backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, minHeight: 48, color: c.textPrimary, fontSize: 16 },
  goBtn: { backgroundColor: c.navy, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', minHeight: 48, marginTop: 4 },
  goBtnText: { color: c.white, fontSize: 15, fontWeight: '800' },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { backgroundColor: c.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipText: { color: c.textPrimary, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.white },
  hint: { color: c.textSecond, fontSize: 15, lineHeight: 21, marginVertical: 10 },
  errorBox: { backgroundColor: c.bgCard, borderRadius: 12, padding: 14, marginVertical: 10, borderWidth: 1, borderColor: c.border },
  errorText: { color: c.textPrimary, fontSize: 15, lineHeight: 21 },
  offline: { color: c.warnDark, backgroundColor: c.warnBg, borderRadius: 10, padding: 10, fontSize: 13, marginVertical: 8 },
  meta: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  group: { color: c.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 16, marginBottom: 8 },
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
