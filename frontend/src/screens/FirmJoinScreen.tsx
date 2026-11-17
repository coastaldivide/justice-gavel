/**
 * FirmJoinScreen — accept an invitation into a law firm's account
 * (https://justicegavel.app/firm/join/<token>, e-mailed by the firm admin).
 * The person signs in (or creates an account) with the invited e-mail address and accepts.
 * Joining needs this link: the token arrives only in the invited inbox (sandbox review
 * 2026-11-17, finding 1; backend routes/firm_acquisition.js).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice } from '../components/bondDesk/ui';
import { CORE_ONLY } from '../constants/features';

interface Preview { firm: string; role: 'partner' | 'associate' | 'paralegal'; email: string; email_matches: boolean; invited_by_name: string | null; expires_at: string }

function FirmJoinScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { hasSession, recheck } = useHasSession();
  const token = String((route?.params as { token?: string } | undefined)?.token || '');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api.get<Preview>(`/firm-acquisition/invite/${encodeURIComponent(token)}`); if (mounted.current) setPreview(r.data); }
    catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('fj_invalid'))); }
  }, [token]);
  useEffect(() => { if (hasSession) load(); }, [hasSession, load]);

  const accept = async () => {
    setBusy(true);
    try { const r = await api.post<{ firm?: string | null }>('/firm-acquisition/invite/accept', { token }); if (mounted.current) setJoined(r.data.firm || preview?.firm || ''); }
    catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('fj_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };

  if (hasSession === false) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} testID="firm-join-screen"><SignInNeeded navigation={navigation} body={t('fj_sign_in')} onSignedIn={recheck} /></View>;
  }
  if (hasSession === null || (!preview && !problem)) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }} testID="firm-join-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="firm-join-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <Card title={t('fj_title')}>
        {!!problem && <Line tone="danger" testID="firm-join-error">{problem}</Line>}
        {joined !== null ? (
          <>
            <Notice tone="ok" text={t('fj_done', { firm: joined })} testID="firm-join-done" />
            {/* The firm screens are parked in the core-only build (constants/features.ts). */}
            {!CORE_ONLY && <Btn label={t('fj_open_firm')} onPress={() => navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen: 'FirmAcquisition' } })} testID="firm-join-open" />}
          </>
        ) : preview ? (
          <>
            <Line strong>{t('fa_invited', { firm: preview.firm })}</Line>
            <Line>{t('fj_invited_role', { role: t(`fa_role_${preview.role}`), name: preview.invited_by_name || '—' })}</Line>
            <Line>{t('fa_join_body')}</Line>
            {!preview.email_matches && <Line tone="warn" testID="firm-join-other-email">{t('fj_other_email', { email: preview.email })}</Line>}
            <Btn label={t('fa_join_cta')} onPress={accept} busy={busy} disabled={!preview.email_matches} testID="firm-join-accept" />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}

export default React.memo(FirmJoinScreen);
