/**
 * PdInboxScreen — a public defender office's shared inbox (A11 step 4; docs/PUBLIC_DEFENDER.md).
 * One row per client conversation, newest first (30 per page): unread count, the last text, open
 * or handled. "Open" shows conversations where the client wrote after it was last marked handled.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Line, Notice, Pill } from '../components/bondDesk/ui';
import { PdGate } from '../components/publicDefender/PdParts';
import { fmtWhen } from '../services/bondDesk';
import type { PdConversation } from '../services/publicDefender';

interface Page { conversations: PdConversation[]; page: number; page_size: number; total: number; unread_total: number }

function PdInboxScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [rows, setRows] = useState<PdConversation[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, total: 0, unread: 0 });
  const [off, setOff] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [problem, setProblem] = useState('');

  const load = useCallback(async (p = 1) => {
    try {
      const r = await api.get<Page>('/pd/inbox', { params: { filter, page: p } });
      if (!mounted.current) return;
      setRows(prev => (p === 1 || !prev ? r.data.conversations : [...prev, ...r.data.conversations]));
      setMeta({ page: p, total: r.data.total, unread: r.data.unread_total }); setProblem(prev => (prev ? '' : prev));
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (!mounted.current) return;
      if (code === 'feature_unavailable') setOff(true); else if (code === 'not_member') setNotMember(true);
      else setProblem(apiErrorMessage(e, t('pd_load_failed')));
    }
  }, [filter]);
  useFocusEffect(useCallback(() => { load(1); }, [load]));

  return (
    <PdGate off={off} notMember={notMember} error={problem} hasData={rows !== null} testID="pd-inbox-screen">
      <ScrollView testID="pd-inbox-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
        {!!problem && <Notice tone="error" text={problem} />}
        <Card title={t('pd_inbox_title', { n: meta.unread })}>
          <Chips options={[{ key: 'open' as const, label: t('pd_filter_open') }, { key: 'all' as const, label: t('pd_filter_all') }]} value={filter} onChange={setFilter} testIDPrefix="pd-filter" />
          {rows?.length === 0 && <Line muted testID="pd-inbox-empty">{t(filter === 'open' ? 'pd_inbox_none_open' : 'pd_inbox_none')}</Line>}
          {rows?.map(c => (
            <View key={c.client_id} style={{ marginTop: 10 }} testID={`pd-conv-${c.client_id}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Line strong>{c.name}</Line>
                {c.unread > 0 && <Pill text={t('pd_unread_n', { n: c.unread })} tone="warn" />}
                <Pill text={t(c.handled ? 'pd_handled' : 'pd_open')} tone={c.handled ? 'ok' : 'warn'} />
                {c.opted_out && <Pill text={t('pd_opted_out')} tone="danger" />}
              </View>
              <Line muted>{c.case_number} · {fmtWhen(c.last_message_at)}</Line>
              <Line>{c.last_direction === 'out' ? t('pd_you_prefix') : ''}{c.last_preview}</Line>
              <Btn kind="ghost" label={t('pd_open_conversation')} onPress={() => navigation.navigate('PdClient', { clientId: c.client_id })} testID={`pd-open-conv-${c.client_id}`} />
            </View>
          ))}
          {rows && rows.length < meta.total && <Btn kind="ghost" label={t('pd_load_more')} onPress={() => load(meta.page + 1)} testID="pd-inbox-more" />}
        </Card>
      </ScrollView>
    </PdGate>
  );
}

export default React.memo(PdInboxScreen);
