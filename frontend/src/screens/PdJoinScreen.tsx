/**
 * PdJoinScreen — accept an invitation into a public defender office
 * (https://justicegavel.app/pd/join/<token>, e-mailed by Justice Gavel or an office admin).
 * The person signs in (or creates an account) with the invited e-mail address and accepts.
 * docs/PUBLIC_DEFENDER.md "Office accounts".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice } from '../components/bondDesk/ui';

interface Preview { office: string; role: 'admin' | 'staff'; email: string; email_matches: boolean; expires_at: string }

function PdJoinScreen({ navigation, route }: ScreenProps) {
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
    try { const r = await api.get<Preview>(`/pd/invite/${encodeURIComponent(token)}`); if (mounted.current) setPreview(r.data); } catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('pd_join_invalid'))); }
  }, [token]);
  useEffect(() => { if (hasSession) load(); }, [hasSession, load]);

  const accept = async () => {
    setBusy(true);
    try { const r = await api.post<{ office: string }>('/pd/invite/accept', { token }); if (mounted.current) setJoined(r.data.office); } catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('pd_join_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };

  if (hasSession === false) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} testID="pd-join-screen"><SignInNeeded navigation={navigation} body={t('pd_join_sign_in')} onSignedIn={recheck} /></View>;
  }
  if (hasSession === null || (!preview && !problem)) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }} testID="pd-join-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="pd-join-screen" contentContainerStyle={{ paddingBottom: 40 }}>
      <Card title={t('pd_join_title')}>
        {!!problem && <Line tone="danger" testID="pd-join-error">{problem}</Line>}
        {joined ? (
          <>
            <Notice tone="ok" text={t('pd_join_done', { office: joined })} testID="pd-join-done" />
            <Btn label={t('pd_open_office')} onPress={() => navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen: 'PdOffice' } })} testID="pd-join-open" />
          </>
        ) : preview ? (
          <>
            <Line strong>{t('pd_join_invited', { office: preview.office, role: t(`pd_role_${preview.role}`) })}</Line>
            <Line>{t('pd_join_what')}</Line>
            {!preview.email_matches && <Line tone="warn" testID="pd-join-other-email">{t('pd_join_other_email', { email: preview.email })}</Line>}
            <Btn label={t('pd_join_accept')} onPress={accept} busy={busy} disabled={!preview.email_matches} testID="pd-join-accept" />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}

export default React.memo(PdJoinScreen);
