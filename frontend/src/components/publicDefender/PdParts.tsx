/**
 * PdParts — shared pieces of the public defender office screens (A11, docs/PUBLIC_DEFENDER.md):
 *   PdGate      loading / "not available" (⚖ setting off) / "not in an office" / error, else children
 *   PdHomeCard  the Home screen entry for office members (hidden for everyone else and while the setting is off)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../../services/api';
import * as secureStorage from '../../utils/secureStorage';
import { useTheme } from '../../constants/theme';
import { t, useLang } from '../../i18n';
import { Btn, Card, Line, Notice, Pill } from '../bondDesk/ui';
import type { PdStatus } from '../../services/publicDefender';

export function PdGate({ off, notMember, error, hasData, children, testID }: {
  loading?: boolean; off: boolean; notMember: boolean; error: string; hasData: boolean; children: React.ReactNode; testID?: string;
}) {
  const { colors } = useTheme();
  if (off) return <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg }}><Notice text={t('pd_off')} testID="pd-off" /></View>;
  if (notMember) return <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg }}><Notice text={t('pd_not_member')} testID="pd-not-member" /></View>;
  if (!hasData && error) return <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg }}><Notice tone="error" text={error} testID="pd-error" /></View>;
  if (!hasData) return <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  return <>{children}</>;
}

/** `navigation`: the Home screen's (re-checked each time Home comes into focus). */
export function PdHomeCard({ navigation }: { navigation: { navigate: (s: never) => void; addListener?: (e: 'focus', cb: () => void) => (() => void) | undefined } }) {
  useLang();
  const [status, setStatus] = useState<PdStatus | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(() => {
    secureStorage.getToken().then(token => {
      if (!token) { if (mounted.current) setStatus(null); return; }
      return api.get<PdStatus>('/pd/status').then(r => { if (mounted.current) setStatus(r.data); });
    }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const off = navigation.addListener?.('focus', load);
    return () => { if (typeof off === 'function') off(); };
  }, [navigation, load]);
  if (!status?.enabled || !status.member) return null;
  const m = status.member;
  return (
    <Card title={m.office} testID="pd-home-card">
      <Line muted>{t(m.role === 'admin' ? 'pd_home_line_admin' : 'pd_home_line')}</Line>
      {m.unread > 0 && <Pill text={t('pd_unread_n', { n: m.unread })} tone="warn" />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn label={t('pd_open_office')} onPress={() => navigation.navigate('PdOffice' as never)} testID="pd-home-open" />
        <Btn kind="ghost" label={t('pd_inbox')} onPress={() => navigation.navigate('PdInbox' as never)} testID="pd-home-inbox" />
      </View>
    </Card>
  );
}
