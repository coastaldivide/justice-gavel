/**
 * PdStaffScreen — the people in a public defender office and its seats (A11 step 1;
 * docs/PUBLIC_DEFENDER.md "Office accounts"). Everyone in the office sees the list; office admins
 * invite by e-mail (admin or staff), change roles, withdraw invitations and remove people. The
 * seat count is set by Justice Gavel; an office always keeps at least one office admin.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { PdGate } from '../components/publicDefender/PdParts';
import { fmtDay } from '../services/bondDesk';
import { type PdMembers, type PdRole, usePdGet } from '../services/publicDefender';

function PdStaffScreen(_: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const st = usePdGet<PdMembers & { role: PdRole }>('/pd/staff');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PdRole>('staff');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [link, setLink] = useState('');
  const admin = st.data?.role === 'admin';

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setProblem(prev => (prev ? '' : prev));
    try { await fn(); showToast(done, 'success'); await st.reload(); } catch (e) { setProblem(apiErrorMessage(e, t('pd_failed'))); }
    finally { setBusy(null); }
  };
  const invite = () => run('invite', async () => {
    const r = await api.post<{ link: string; email_status: string }>('/pd/staff/invites', { email, role });
    setLink(r.data.email_status === 'sent' ? '' : r.data.link);
    setEmail('');
  }, t('pd_invited'));

  return (
    <PdGate off={st.off} notMember={st.notMember} error={st.error} hasData={!!st.data} testID="pd-staff-screen">
      {st.data && (
        <ScrollView testID="pd-staff-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {!!problem && <Notice tone="error" text={problem} testID="pd-staff-error" />}
          <Card title={t('pd_seats_title')}>
            <Line strong testID="pd-seats">{t('pd_seats', { used: st.data.seats.used, limit: st.data.seats.limit })}</Line>
            <Line muted>{t('pd_seats_note')}</Line>
          </Card>
          <Card title={t('pd_members')}>
            {st.data.members.map(m => (
              <View key={m.user_id} style={{ marginTop: 8 }} testID={`pd-member-${m.user_id}`}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Line strong>{m.name || m.email}</Line>
                  <Pill text={t(`pd_role_${m.role}`)} tone={m.role === 'admin' ? 'ok' : 'muted'} />
                </View>
                <Line muted>{m.email} · {t('pd_since', { day: fmtDay(m.added_at) })}</Line>
                {admin && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Btn kind="ghost" label={t(m.role === 'admin' ? 'pd_make_staff' : 'pd_make_admin')} busy={busy === `role-${m.user_id}`}
                      onPress={() => run(`role-${m.user_id}`, () => api.patch(`/pd/staff/${m.user_id}`, { role: m.role === 'admin' ? 'staff' : 'admin' }), t('pd_saved'))} testID={`pd-role-${m.user_id}`} />
                    <Btn kind="danger" label={t('pd_remove')} testID={`pd-remove-${m.user_id}`}
                      onPress={() => confirm(t('pd_remove_member_q'), t('pd_remove_member_body', { name: m.name || m.email }), { destructive: true, confirmLabel: t('pd_remove') })
                        .then(ok => { if (ok) run(`rm-${m.user_id}`, () => api.delete(`/pd/staff/${m.user_id}`), t('pd_removed')); })} />
                  </View>
                )}
              </View>
            ))}
          </Card>
          {st.data.invites.length > 0 && (
            <Card title={t('pd_invites')}>
              {st.data.invites.map(i => (
                <View key={i.id} style={{ marginTop: 8 }} testID={`pd-invite-${i.id}`}>
                  <Line>{i.email} · {t(`pd_role_${i.role}`)} · {t('pd_expires', { day: fmtDay(i.expires_at) })}</Line>
                  {admin && <Btn kind="ghost" label={t('pd_withdraw')} onPress={() => run(`inv-${i.id}`, () => api.delete(`/pd/staff/invites/${i.id}`), t('pd_withdrawn'))} testID={`pd-withdraw-${i.id}`} />}
                </View>
              ))}
            </Card>
          )}
          {admin && (
            <Card title={t('pd_invite_title')} testID="pd-invite-form">
              <Field label={t('pd_col_email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="pd-invite-email" maxLength={254} />
              <Chips options={(['staff', 'admin'] as PdRole[]).map(r => ({ key: r, label: t(`pd_role_${r}`) }))} value={role} onChange={setRole} testIDPrefix="pd-invite-role" />
              <Btn label={t('pd_invite')} onPress={invite} disabled={!email.trim()} busy={busy === 'invite'} testID="pd-invite-send" />
              {!!link && <Line muted testID="pd-invite-link">{t('pd_invite_link', { link })}</Line>}
            </Card>
          )}
        </ScrollView>
      )}
    </PdGate>
  );
}

export default React.memo(PdStaffScreen);
