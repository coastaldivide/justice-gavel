/**
 * StaffJoinScreen — accept an invitation to work in a bail agency's Bond Desk
 * (https://justicegavel.app/bond-desk/join/<token>, e-mailed by the agency owner). The person
 * must be signed in with the invited e-mail address; then they work in the owner's desk as staff
 * (everything except billing, the plan, card payments, staff and the export). docs/BOND_DESK.md.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice } from '../components/bondDesk/ui';

interface Preview { agency: string; email: string; email_matches: boolean; expires_at: string }

function StaffJoinScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { hasSession, recheck } = useHasSession();
  const token = String((route?.params as { token?: string } | undefined)?.token || '');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api.get<Preview>(`/bond-desk/staff/invite/${encodeURIComponent(token)}`); if (mounted.current) { setPreview(r.data); setError(prev => (prev ? '' : prev)); } }
    catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('sjn_invalid'))); }
  }, [token]);
  useEffect(() => { if (hasSession) load(); }, [hasSession, load]);

  const accept = async () => {
    setBusy(true); setError('');
    try { const r = await api.post<{ agency: string }>('/bond-desk/staff/accept', { token }); if (mounted.current) setJoined(r.data.agency); }
    catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('sjn_failed'))); } finally { if (mounted.current) setBusy(false); }
  };

  if (hasSession === false) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} testID="staff-join-screen"><SignInNeeded navigation={navigation} body={t('sjn_sign_in')} onSignedIn={recheck} /></View>;
  }
  if (hasSession === null || (!preview && !error)) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }} testID="staff-join-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="staff-join-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <Card title={t('sjn_title')}>
        {!!error && <Line tone="danger" testID="staff-join-error">{error}</Line>}
        {joined ? (
          <>
            <Notice tone="ok" text={t('sjn_joined', { agency: joined })} testID="staff-join-done" />
            <Btn label={t('sjn_open_desk')} onPress={() => navigation.navigate('BondDesk' as never)} testID="staff-join-open" />
          </>
        ) : preview ? (
          <>
            <Line strong>{t('sjn_invited', { agency: preview.agency })}</Line>
            <Line>{t('sjn_what')}</Line>
            {!preview.email_matches && <Line tone="warn" testID="staff-join-other-email">{t('sjn_other_email', { email: preview.email })}</Line>}
            <Btn label={t('sjn_accept')} onPress={accept} busy={busy} disabled={!preview.email_matches} testID="staff-join-accept" />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}

export default React.memo(StaffJoinScreen);
