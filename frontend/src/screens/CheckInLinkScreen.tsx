/**
 * CheckInLinkScreen — the page a defendant opens from the text their bail
 * agent's office sent (https://justicegavel.app/c/<token>). No app install and
 * no account: the link is the credential (only its SHA-256 is stored on the
 * server). A root-level route like the signing link, so it works signed out,
 * browsing or signed in.
 *
 *   - Shows the agency name (tap the phone to call) and the defendant's first name.
 *   - "Check in now"; an optional note.
 *   - "Share my location for this check-in" is off every time the page opens
 *     and after every check-in: the location is read once, at the moment of
 *     checking in (browser geolocation on the web), never in the background.
 *   - A second check-in on a day already done is recorded but counted once.
 *
 * API: GET/POST /api/checkins/link/:token (backend routes/checkins.js).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Field, Line, Notice } from '../components/bondDesk/ui';
import { formatCourtDay } from '../services/corePath';

export interface LinkInfo {
  agency: { name: string | null; phone: string | null };
  first_name: string;
  frequency: 'daily' | 'weekly';
  checked_in_today: boolean;
  done_for_period: boolean;
  next_due: string;
  today: string;
  time_zone: string;
  location: { optional: boolean; distance_alerts: boolean };
}
interface CheckInResult extends LinkInfo { counted: boolean; location_shared: boolean }

export const LINK_TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const LINK_ERRORS: Record<string, string> = { link_invalid: 'ckl_link_invalid', link_expired: 'ckl_link_expired', enrollment_stopped: 'ckl_stopped' };

/** The person's position once, now (browser geolocation on the web; expo-location in the app). */
export async function currentPosition(): Promise<{ lat: number; lng: number }> {
  const nav = (globalThis as { navigator?: { geolocation?: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void, err: (e: unknown) => void, o?: object) => void } } }).navigator;
  if (Platform.OS === 'web') {
    const geo = nav?.geolocation;
    if (!geo?.getCurrentPosition) throw new Error('geolocation_unavailable');
    return new Promise((resolve, reject) => {
      geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      );
    });
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') throw new Error('permission_denied');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

/** The status line for the page. */
export function linkStatusKey(info: LinkInfo): string {
  if (info.checked_in_today) return 'ckl_status_done_today';
  if (info.done_for_period) return 'ckl_status_done_week';
  return info.frequency === 'weekly' ? 'ckl_status_due_week' : 'ckl_status_due_today';
}

function CheckInLinkScreen({ route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const token = String((route?.params as { token?: string } | undefined)?.token || '').trim();
  const base = `/checkins/link/${encodeURIComponent(token)}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [linkError, setLinkError] = useState('');
  const [error, setError] = useState('');
  const [shareLocation, setShareLocation] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CheckInResult | null>(null);

  const codeOf = (e: unknown) => {
    const err = e as { response?: { status?: number; data?: { code?: string; error?: string } } };
    return { status: err?.response?.status, code: err?.response?.data?.code || '' };
  };

  const load = useCallback(async () => {
    if (!LINK_TOKEN.test(token)) { setLinkError(t('ckl_link_invalid')); return; }
    try {
      const r = await api.get<LinkInfo>(base);
      if (mounted.current) { setInfo(r.data); setLinkError(''); setError(''); }
    } catch (e) {
      if (!mounted.current) return;
      const { status, code } = codeOf(e);
      if (LINK_ERRORS[code]) setLinkError(t(LINK_ERRORS[code]));
      else if (status === 404) setLinkError(t('ckl_link_invalid'));
      else if (status === 410) setLinkError(t('ckl_link_expired'));
      else setError(apiErrorMessage(e, t('ckl_load_failed')));
    }
  }, [base, token]);
  useEffect(() => { load(); }, [load]);

  const checkIn = async () => {
    setBusy(true); setError(''); setDone(null);
    try {
      let coords: { lat: number; lng: number } | null = null;
      if (shareLocation) {
        try { coords = await currentPosition(); }
        catch { if (mounted.current) setError(t('ckl_location_failed')); return; }
      }
      const r = await api.post<CheckInResult>(base, { ...(coords || {}), ...(note.trim() ? { note: note.trim() } : {}) });
      if (!mounted.current) return;
      setDone(r.data); setInfo(r.data);
      // asked again next time: location is never remembered between check-ins
      setShareLocation(false); setNote('');
    } catch (e) {
      if (!mounted.current) return;
      const { code } = codeOf(e);
      if (LINK_ERRORS[code]) setLinkError(t(LINK_ERRORS[code]));
      else setError(apiErrorMessage(e, t('ckl_failed')));
    } finally { if (mounted.current) setBusy(false); }
  };

  const agency = info?.agency.name || t('ckl_your_agency');

  if (linkError) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} testID="checkin-link-screen">
        <Card title={t('ckl_title')} testID="checkin-link-error"><Line tone="danger">{linkError}</Line><Line muted>{t('ckl_ask_agent')}</Line></Card>
      </ScrollView>
    );
  }
  if (!info) {
    return (
      <View style={[s.center, { backgroundColor: colors.bg }]} testID="checkin-link-screen">
        {error ? <Card><Line tone="danger">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></Card> : <ActivityIndicator size="large" color={colors.textBrand} />}
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="checkin-link-screen" contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('ckl_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub} testID="checkin-link-agency">{t('ckl_from_agency', { agency })}</Text>
      </View>
      <View style={s.body}>
        <Card testID="checkin-link-who">
          <Line strong testID="checkin-link-hello">{t('ckl_hello', { name: info.first_name })}</Line>
          <Line tone={info.checked_in_today || info.done_for_period ? 'ok' : 'warn'} testID="checkin-link-status">{t(linkStatusKey(info))}</Line>
          {!info.done_for_period && info.next_due > info.today && <Line muted>{t('ckl_next_due', { day: formatCourtDay(info.next_due) })}</Line>}
          {!!info.agency.phone && (
            <TouchableOpacity accessibilityRole="link" accessibilityLabel={t('ckl_call_agency', { agency })} testID="checkin-link-call"
              onPress={() => Linking.openURL(`tel:${String(info.agency.phone).replace(/[^\d+]/g, '')}`).catch(() => {})} style={s.call}>
              <Text maxFontSizeMultiplier={1.4} style={s.callText}>{t('ckl_call_agency', { agency })}: {info.agency.phone}</Text>
            </TouchableOpacity>
          )}
        </Card>

        {!!done && (
          <Notice tone="ok" testID="checkin-link-done" text={done.counted ? t('ckl_done') : t('ckl_done_extra')} />
        )}
        {!!error && <Notice tone="error" testID="checkin-link-error-msg" text={error} />}

        <Card title={t('ckl_check_in_title')} testID="checkin-link-form">
          <Check label={t('ckl_share_location')} value={shareLocation} onChange={setShareLocation} testID="checkin-link-share-location" />
          <Line muted testID="checkin-link-location-note">{t('ckl_location_note', { agency })}</Line>
          {info.location.distance_alerts && <Line muted testID="checkin-link-distance-note">{t('ckl_location_alert_note', { agency })}</Line>}
          <Field label={t('ckl_note')} value={note} onChangeText={setNote} testID="checkin-link-note" multiline maxLength={500} />
          <Btn label={t('ckl_check_in_now')} onPress={checkIn} busy={busy} testID="checkin-link-submit" />
          {info.checked_in_today && <Line muted>{t('ckl_again_note')}</Line>}
        </Card>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 14, lineHeight: 20, marginTop: 4 },
  body: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  call: { minHeight: 44, justifyContent: 'center', marginTop: 6 },
  callText: { color: colors.textBrand, fontSize: 15, ...FONTS.semiBold, textDecorationLine: 'underline' },
});

export default React.memo(CheckInLinkScreen);
