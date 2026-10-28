/**
 * AdminPdOfficesScreen — Justice Gavel staff (admin role) set up public defender offices and invoice
 * them (A11 steps 1 and 6; docs/PUBLIC_DEFENDER.md). Hidden while the ⚖ setting is off.
 *   - create an office (name, county, state, phone, seats, billing e-mail) and invite its first office admin
 *   - per office: members and invitations, change seats / billing e-mail, invite another person
 *   - "Create annual invoice": a preview of active clients and the amount (setup fee on the first
 *     invoice only + clients × the yearly fee; texts included), then one Stripe invoice per office and year
 *   - client texts delivered to no office: the number is a client of more than one office (the
 *     sender was texted to call their office)
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill, Row } from '../components/bondDesk/ui';
import { fmtWhen } from '../services/bondDesk';
import { type PdInvoice, type PdMembers, type PdOffice, usd } from '../services/publicDefender';

type OfficeRow = PdOffice & { members: number; pending_invites: number; clients: number };
interface Unroutable { id: number; received_at: string; phone_last4: string | null; body: string | null; replied: string | null; offices: { id: number; name: string | null }[] }
interface Preview { year: number; existing: PdInvoice | null; active_clients: number; setup_cents: number; per_client_cents: number; clients_cents?: number; amount_cents: number; billing_email: string | null }
const blank = { name: '', county: '', state: 'TN', phone: '', seat_limit: '5', billing_email: '', admin_email: '' };

function AdminPdOfficesScreen(_: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [offices, setOffices] = useState<OfficeRow[] | null>(null);
  const [prices, setPrices] = useState<{ setup_cents: number; per_client_cents: number } | null>(null);
  const [off, setOff] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [problem, setProblem] = useState('');
  const [form, setForm] = useState(blank);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<(PdMembers & { office: PdOffice; invoices: PdInvoice[] }) | null>(null);
  const [edit, setEdit] = useState({ seat_limit: '', billing_email: '', invite_email: '', invite_role: 'admin' as 'admin' | 'staff', year: String(new Date().getFullYear()) });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [unroutable, setUnroutable] = useState<Unroutable[]>([]);

  const fail = (e: unknown) => {
    const err = e as { response?: { status?: number; data?: { code?: string } } };
    if (err?.response?.data?.code === 'feature_unavailable') setOff(true);
    else if (err?.response?.status === 403) setForbidden(true);
    else setProblem(apiErrorMessage(e, t('pd_failed')));
  };
  const load = useCallback(async () => {
    try { const r = await api.get<{ offices: OfficeRow[]; prices: { setup_cents: number; per_client_cents: number } }>('/admin/pd-offices'); setOffices(r.data.offices); setPrices(r.data.prices); } catch (e) { fail(e); return; }
    try { const u = await api.get<{ texts: Unroutable[] }>('/admin/pd-offices/unroutable'); setUnroutable(u.data?.texts || []); } catch { setUnroutable([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const openOffice = async (id: number) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null); setPreview(null); setLink('');
    try {
      const r = await api.get<PdMembers & { office: PdOffice; invoices: PdInvoice[] }>(`/admin/pd-offices/${id}`);
      setDetail(r.data);
      setEdit(x => ({ ...x, seat_limit: String(r.data.office.seat_limit), billing_email: r.data.office.billing_email || '' }));
    } catch (e) { fail(e); }
  };
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setProblem(prev => (prev ? '' : prev));
    try { await fn(); if (done) showToast(done, 'success'); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const create = () => run('create', async () => {
    const r = await api.post<{ office: PdOffice; invite: { link: string; email_status: string } }>('/admin/pd-offices', { ...form, seat_limit: Number(form.seat_limit) });
    setLink(r.data.invite.email_status === 'sent' ? '' : r.data.invite.link);
    setForm(blank); setCreating(false); await load();
  }, t('pd_adm_created'));
  const save = (id: number) => run('save', async () => {
    await api.patch(`/admin/pd-offices/${id}`, { seat_limit: Number(edit.seat_limit), billing_email: edit.billing_email || null });
    await load(); setOpen(null); await openOffice(id);
  }, t('pd_saved'));
  const invite = (id: number) => run('invite', async () => {
    const r = await api.post<{ link: string; email_status: string }>(`/admin/pd-offices/${id}/invites`, { email: edit.invite_email, role: edit.invite_role });
    setLink(r.data.email_status === 'sent' ? '' : r.data.link);
    setEdit(x => ({ ...x, invite_email: '' }));
  }, t('pd_invited'));
  const doPreview = (id: number) => run('preview', async () => {
    const r = await api.get<Preview>(`/admin/pd-offices/${id}/invoice-preview`, { params: { year: edit.year } });
    setPreview(r.data);
  });
  const invoice = (id: number) => preview && confirm(t('pd_adm_invoice_q'), t('pd_adm_invoice_body', { amount: usd(preview.amount_cents), email: preview.billing_email || '—', year: preview.year }), { confirmLabel: t('pd_adm_invoice_go') })
    .then(ok => {
      if (!ok) return;
      run('invoice', async () => {
        await api.post(`/admin/pd-offices/${id}/invoices`, { year: Number(edit.year), confirm: true });
        setPreview(null); setOpen(null); await openOffice(id);
      }, t('pd_adm_invoiced'));
    });

  if (off) return <View testID="admin-pd-screen" style={{ flex: 1, backgroundColor: colors.bg }}><Notice text={t('pd_off')} testID="pd-off" /></View>;
  if (forbidden) return <View testID="admin-pd-screen" style={{ flex: 1, backgroundColor: colors.bg }}><Notice text={t('adm_forbidden')} testID="admin-pd-forbidden" /></View>;
  return (
    <ScrollView testID="admin-pd-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {!!problem && <Notice tone="error" text={problem} testID="admin-pd-error" />}
      {!!link && <Notice text={t('pd_invite_link', { link })} testID="admin-pd-link" />}
      <Card title={t('pd_adm_title')}>
        {prices && <Line muted testID="admin-pd-prices">{t('pd_adm_prices', { setup: usd(prices.setup_cents), per: usd(prices.per_client_cents) })}</Line>}
        <Btn label={t('pd_adm_new')} onPress={() => setCreating(v => !v)} testID="admin-pd-new" />
      </Card>
      {creating && (
        <Card title={t('pd_adm_new')} testID="admin-pd-form">
          <Field label={t('pd_adm_name')} value={form.name} onChangeText={v => setForm({ ...form, name: v })} testID="admin-pd-name" maxLength={160} />
          <Field label={t('pd_adm_county')} value={form.county} onChangeText={v => setForm({ ...form, county: v })} testID="admin-pd-county" maxLength={80} />
          <Field label={t('pd_adm_state')} value={form.state} onChangeText={v => setForm({ ...form, state: v.toUpperCase() })} autoCapitalize="characters" testID="admin-pd-state" maxLength={2} />
          <Field label={t('pd_adm_phone')} value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="admin-pd-phone" maxLength={40} />
          <Field label={t('pd_adm_seats')} value={form.seat_limit} onChangeText={v => setForm({ ...form, seat_limit: v.replace(/\D/g, '') })} keyboardType="number-pad" testID="admin-pd-seats" maxLength={3} />
          <Field label={t('pd_adm_billing_email')} value={form.billing_email} onChangeText={v => setForm({ ...form, billing_email: v })} keyboardType="email-address" autoCapitalize="none" testID="admin-pd-billing" maxLength={254} />
          <Field label={t('pd_adm_admin_email')} value={form.admin_email} onChangeText={v => setForm({ ...form, admin_email: v })} keyboardType="email-address" autoCapitalize="none" testID="admin-pd-admin-email" maxLength={254} />
          <Btn label={t('pd_adm_create')} onPress={create} disabled={!form.name.trim() || !form.admin_email.trim()} busy={busy === 'create'} testID="admin-pd-create" />
        </Card>
      )}
      {offices?.length === 0 && <Card><Line muted testID="admin-pd-empty">{t('pd_adm_none')}</Line></Card>}
      {unroutable.length > 0 && (
        <Card title={t('pd_adm_unroutable_title')} testID="admin-pd-unroutable">
          <Line muted>{t('pd_adm_unroutable_help')}</Line>
          {unroutable.map(u => (
            <View key={u.id} testID={`admin-pd-unroutable-${u.id}`}>
              <Line strong>{t('pd_adm_unroutable_line', { when: fmtWhen(u.received_at), last4: u.phone_last4 || '—', offices: u.offices.map(o => o.name || `#${o.id}`).join(', ') })}</Line>
              {!!u.body && <Line>{u.body}</Line>}
            </View>
          ))}
        </Card>
      )}
      {offices?.map(o => (
        <Card key={o.id} title={o.name} testID={`admin-pd-office-${o.id}`}>
          <Line muted>{[o.county, o.state].filter(Boolean).join(', ')} · {t('pd_adm_counts', { members: o.members, pending: o.pending_invites, seats: o.seat_limit, clients: o.clients })}</Line>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pill text={o.consent ? t('pd_adm_consent_yes') : t('pd_adm_consent_no')} tone={o.consent ? 'ok' : 'warn'} />
            {o.status === 'closed' && <Pill text={t('pd_adm_closed')} tone="danger" />}
          </View>
          <Btn kind="ghost" label={t(open === o.id ? 'pd_adm_close' : 'pd_adm_open')} onPress={() => openOffice(o.id)} testID={`admin-pd-open-${o.id}`} />
          {open === o.id && detail && (
            <View testID={`admin-pd-detail-${o.id}`}>
              {detail.members.map(m => <Line key={m.user_id}>{m.name || m.email} · {m.email} · {t(`pd_role_${m.role}`)}</Line>)}
              {detail.invites.map(i => <Line key={`i${i.id}`} muted>{t('pd_adm_invited_line', { email: i.email, role: t(`pd_role_${i.role}`) })}</Line>)}
              <Field label={t('pd_adm_seats')} value={edit.seat_limit} onChangeText={v => setEdit({ ...edit, seat_limit: v.replace(/\D/g, '') })} keyboardType="number-pad" testID="admin-pd-edit-seats" maxLength={3} />
              <Field label={t('pd_adm_billing_email')} value={edit.billing_email} onChangeText={v => setEdit({ ...edit, billing_email: v })} keyboardType="email-address" autoCapitalize="none" testID="admin-pd-edit-billing" maxLength={254} />
              <Btn kind="ghost" label={t('pd_save')} onPress={() => save(o.id)} busy={busy === 'save'} testID="admin-pd-save" />
              <Field label={t('pd_adm_invite_email')} value={edit.invite_email} onChangeText={v => setEdit({ ...edit, invite_email: v })} keyboardType="email-address" autoCapitalize="none" testID="admin-pd-invite-email" maxLength={254} />
              <Chips options={(['admin', 'staff'] as const).map(r => ({ key: r, label: t(`pd_role_${r}`) }))} value={edit.invite_role} onChange={r => setEdit({ ...edit, invite_role: r })} testIDPrefix="admin-pd-invite-role" />
              <Btn kind="ghost" label={t('pd_invite')} onPress={() => invite(o.id)} disabled={!edit.invite_email.trim()} busy={busy === 'invite'} testID="admin-pd-invite" />

              <Line strong>{t('pd_adm_invoice_title')}</Line>
              {detail.invoices.map(inv => (
                <Line key={inv.id} testID={`admin-pd-invoice-${inv.year}`}>{inv.year}: {usd(inv.amount_cents)} · {t('pd_adm_invoice_clients', { n: inv.active_clients })} · {t(`pd_adm_inv_${inv.status}`)}{inv.sent_at ? ` ${fmtWhen(inv.sent_at)}` : ''}{inv.last_error ? ` · ${inv.last_error}` : ''}</Line>
              ))}
              <Field label={t('pd_adm_year')} value={edit.year} onChangeText={v => { setEdit({ ...edit, year: v.replace(/\D/g, '') }); setPreview(null); }} keyboardType="number-pad" testID="admin-pd-year" maxLength={4} />
              <Btn kind="ghost" label={t('pd_adm_preview')} onPress={() => doPreview(o.id)} busy={busy === 'preview'} testID="admin-pd-preview" />
              {preview && (
                <View testID="admin-pd-preview-box">
                  {preview.existing ? <Line tone="ok">{t('pd_adm_already', { year: preview.year, amount: usd(preview.existing.amount_cents) })}</Line> : (
                    <>
                      <Row label={t('pd_adm_active_clients')} value={String(preview.active_clients)} testID="admin-pd-preview-clients" />
                      <Row label={t('pd_adm_setup')} value={usd(preview.setup_cents)} />
                      <Row label={t('pd_adm_clients_fee', { n: preview.active_clients, per: usd(preview.per_client_cents) })} value={usd(preview.clients_cents || 0)} />
                      <Row label={t('pd_adm_total')} value={usd(preview.amount_cents)} testID="admin-pd-preview-total" />
                      <Line muted>{t('pd_adm_texts_included')}</Line>
                    </>
                  )}
                  {(!preview.existing || preview.existing.status !== 'sent') && (
                    <Btn label={t('pd_adm_invoice_go')} onPress={() => invoice(o.id)} disabled={!preview.billing_email || (!preview.existing && preview.amount_cents <= 0)} busy={busy === 'invoice'} testID="admin-pd-invoice" />
                  )}
                </View>
              )}
            </View>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}

export default React.memo(AdminPdOfficesScreen);
