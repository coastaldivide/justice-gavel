/**
 * BondFormsScreen — the agency's forms library for Bond Desk paperwork.
 *
 * The agent uploads their own PDF forms (surety-issued or custom), says who
 * signs each one (defendant, indemnitor or both — each signer gets their own
 * copy), and maps each fillable text field of the PDF to a case-file value
 * once (defendant name, bond amount, power number …). "Preview" fills the form
 * with a real bond's data so the mapping can be checked before it is sent.
 * Contract: docs/BOND_DESK.md (Forms library).
 *
 * "Have us set up your forms": the agency asks Justice Gavel staff to map its surety PDFs and
 * uploads them to the request (requested → in progress → ready). Staff (admin role) open this same
 * screen with `setupRequestId` (AdminFormsSetupScreen): it then works on that request's forms on
 * the agency's behalf through /api/admin/bd-setup/:id, and "Preview" fills sample data.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { appendPicked, fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { AccessGate } from './BondDeskScreen';
import { type Access, type Bond, type BondForm, type SetupRequest, DATA_KEYS, dataKeyLabelKey, fmtDay, setupTone } from '../services/bondDesk';

const MAX_PDF = 10 * 1024 * 1024;

function BondFormsScreen({ navigation, route }: ScreenProps) {
  useLang();
  const setupId = Number((route?.params as { setupRequestId?: number | string } | undefined)?.setupRequestId) || null;
  const agencyName = (route?.params as { agency?: string } | undefined)?.agency || '';
  const base = setupId ? `/admin/bd-setup/${setupId}` : '/bond-desk';
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [access, setAccess] = useState<Access | null>(null);
  const [forms, setForms] = useState<BondForm[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<BondForm | null>(null);
  const [picking, setPicking] = useState<string | null>(null);   // field name whose data key is being chosen
  const [saving, setSaving] = useState(false);
  const [bonds, setBonds] = useState<Bond[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [setups, setSetups] = useState<SetupRequest[] | null>(null);
  const [setupNote, setSetupNote] = useState('');
  const [setupBusy, setSetupBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api.get<Access>('/bond-desk/access');
      if (!mounted.current) return;
      setAccess(a.data);
      if (!a.data?.allowed) return;
      const r = await api.get<{ forms: BondForm[] }>(`${base}/forms`);
      if (mounted.current) { setForms(r.data?.forms || []); setError(''); }
      if (!setupId) {
        const sr = await api.get<{ requests: SetupRequest[] }>('/bond-desk/forms-setup').catch(() => null);
        if (mounted.current) setSetups(sr?.data?.requests || null);
      }
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [base, setupId]);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!name.trim()) { showToast(t('bdk_form_name_needed'), 'error'); return; }
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_PDF) { showToast(t('bdk_pdf_too_big'), 'error'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      await appendPicked(form, 'file', { uri: a.uri, name: a.name || 'form.pdf', type: 'application/pdf' });
      form.append('name', name.trim());
      const res = await api.post<{ form: BondForm }>(`${base}/forms`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      if (!mounted.current) return;
      setName(''); showToast(t('bdk_form_uploaded'), 'success');
      setEditing(res.data.form); await load();
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_form_upload_failed')), 'error'); }
    finally { if (mounted.current) setUploading(false); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.roles.length) { showToast(t('bdk_err_roles'), 'error'); return; }
    setSaving(true);
    try {
      const fieldMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(editing.field_map || {})) if (v) fieldMap[k] = v;
      const r = await api.patch<{ form: BondForm }>(`${base}/forms/${editing.id}`, { name: editing.name.trim(), roles: editing.roles, field_map: fieldMap });
      showToast(t('bdk_saved'), 'success'); setEditing(r.data?.form || null); await load();
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { if (mounted.current) setSaving(false); }
  };

  const archive = async (f: BondForm) => {
    if (!(await confirm(t('bdk_archive_title', { name: f.name }), t('bdk_archive_body'), { confirmLabel: t('bdk_archive') }))) return;
    try { await api.post(`${base}/forms/${f.id}/archive`); setEditing(null); showToast(t('bdk_archived'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };

  const loadBonds = async () => {
    try { const r = await api.get<{ bonds: Bond[] }>('/bond-desk/bonds'); setBonds(r.data?.bonds || []); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_load_failed')), 'error'); }
  };
  // ── "Have us set up your forms" (the agency's side) ──
  const openSetup = setups?.find(r => r.status === 'requested' || r.status === 'in_progress') || null;
  const lastReady = setups?.find(r => r.status === 'ready') || null;
  const askSetup = async () => {
    setSetupBusy('ask');
    try { await api.post('/bond-desk/forms-setup', { note: setupNote.trim() || null }); setSetupNote(''); showToast(t('bdk_setup_requested'), 'success'); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { if (mounted.current) setSetupBusy(null); }
  };
  const uploadToSetup = async () => {
    if (!openSetup) return;
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_PDF) { showToast(t('bdk_pdf_too_big'), 'error'); return; }
    setSetupBusy('upload');
    try {
      const form = new FormData();
      await appendPicked(form, 'file', { uri: a.uri, name: a.name || 'form.pdf', type: 'application/pdf' });
      form.append('name', String(a.name || 'Form').replace(/\.pdf$/i, ''));
      await api.post(`/bond-desk/forms-setup/${openSetup.id}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      showToast(t('bdk_form_uploaded'), 'success'); await load();
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_form_upload_failed')), 'error'); } finally { if (mounted.current) setSetupBusy(null); }
  };
  const cancelSetup = async () => {
    if (!openSetup) return;
    if (!(await confirm(t('bdk_setup_cancel_title'), t('bdk_setup_cancel_body'), { confirmLabel: t('bdk_setup_cancel') }))) return;
    setSetupBusy('cancel');
    try { await api.post(`/bond-desk/forms-setup/${openSetup.id}/cancel`, {}); await load(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { if (mounted.current) setSetupBusy(null); }
  };

  const open = async (url: string, file: string) => {
    try { await fetchFile(url, file, 'application/pdf', 'view'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };

  if (access && !access.allowed && !setupId) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="bond-forms-screen"><AccessGate access={access} onPlans={() => navigation.navigate('Subscription' as never)} /></ScrollView>;
  }
  if (!forms && !error) return <View style={[s.center, { backgroundColor: colors.bg }]} testID="bond-forms-screen"><ActivityIndicator size="large" color={colors.textBrand} /></View>;

  const shown = (forms || []).filter(f => showArchived || !f.archived);
  const textFields = editing ? editing.fields.filter(f => f.type === 'text') : [];
  const otherFields = editing ? editing.fields.filter(f => f.type !== 'text') : [];

  return (
    <ScrollView testID="bond-forms-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_forms')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{setupId ? t('bdk_setup_admin_intro', { agency: agencyName }) : t('bdk_forms_intro')}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" />}
      {access && !access.storage_live && <Notice text={t('bdk_storage_off')} tone="error" testID="forms-storage-off" />}

      {!setupId && setups && (
        <Card title={t('bdk_forms_setup_title')} testID="forms-setup">
          {lastReady && !openSetup && <Line tone="ok" testID="forms-setup-ready">{t('bdk_setup_ready_line', { date: fmtDay(lastReady.ready_at), n: lastReady.forms.length })}</Line>}
          {lastReady?.staff_note && !openSetup && <Line muted>{lastReady.staff_note}</Line>}
          {openSetup ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pill text={t(`bdk_setup_st_${openSetup.status}`)} tone={setupTone(openSetup.status)} />
              </View>
              <Line>{t(`bdk_setup_help_${openSetup.status}`)}</Line>
              {openSetup.forms.map(f => <Line key={f.id} muted>{`• ${f.name} (${t('bdk_form_pages', { n: f.page_count })})`}</Line>)}
              <Btn kind="ghost" label={t('bdk_setup_add_pdf')} onPress={uploadToSetup} busy={setupBusy === 'upload'} disabled={access ? !access.storage_live : false} testID="forms-setup-upload" />
              {openSetup.status === 'requested' && <Btn kind="danger" label={t('bdk_setup_cancel')} onPress={cancelSetup} busy={setupBusy === 'cancel'} testID="forms-setup-cancel" />}
            </>
          ) : (
            <>
              <Line>{t('bdk_setup_intro')}</Line>
              <Field label={t('bdk_setup_note')} value={setupNote} onChangeText={setSetupNote} multiline maxLength={1000} testID="forms-setup-note" />
              <Btn label={t('bdk_setup_ask')} onPress={askSetup} busy={setupBusy === 'ask'} testID="forms-setup-ask" />
            </>
          )}
        </Card>
      )}

      <Card title={t('bdk_form_upload')} testID="forms-upload">
        <Field label={t('bdk_form_name')} value={name} onChangeText={setName} testID="forms-name" placeholder={t('bdk_form_name_ph')} />
        <Btn label={t('bdk_pick_pdf')} onPress={upload} busy={uploading} disabled={access ? !access.storage_live : false} testID="forms-pick" />
        <Line muted>{t('bdk_pdf_rules')}</Line>
      </Card>

      {editing && (
        <Card title={t('bdk_form_setup', { name: editing.name })} testID="form-editor">
          <Field label={t('bdk_form_name')} value={editing.name} onChangeText={v => setEditing({ ...editing, name: v })} testID="form-edit-name" />
          <Line strong>{t('bdk_form_roles')}</Line>
          <Chips multi options={(['defendant', 'indemnitor'] as const).map(k => ({ key: k, label: t(`bdk_role_${k}`) }))} value={editing.roles}
            onChange={k => setEditing({ ...editing, roles: editing.roles.includes(k) ? editing.roles.filter(r => r !== k) : [...editing.roles, k] })} testIDPrefix="form-role" />
          <Line strong>{t('bdk_form_fields', { n: textFields.length })}</Line>
          {!editing.fields.length && <Line muted testID="form-no-fields">{t('bdk_form_no_fields')}</Line>}
          {textFields.map(f => (
            <TouchableOpacity key={f.name} accessibilityRole="button" testID={`form-field-${f.name}`} onPress={() => setPicking(f.name)} style={s.fieldRow}>
              <Text maxFontSizeMultiplier={1.4} style={s.fieldName}>{f.name}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.fieldKey}>{editing.field_map?.[f.name] ? t(dataKeyLabelKey(editing.field_map[f.name])) : t('bdk_not_filled')}</Text>
            </TouchableOpacity>
          ))}
          {otherFields.length > 0 && <Line muted>{t('bdk_form_other_fields', { n: otherFields.length })}</Line>}
          <Line muted>{t('bdk_signature_fields_help')}</Line>
          <Btn label={t('bdk_save')} onPress={save} busy={saving} testID="form-save" />
          <Btn kind="ghost" label={t('bdk_view_original')} onPress={() => open(`${base}/forms/${editing.id}/file`, `${editing.name}.pdf`)} testID="form-original" />
          {setupId ? <Btn kind="ghost" label={t('bdk_preview_sample')} onPress={() => open(`${base}/forms/${editing.id}/preview.pdf`, `${editing.name}-preview.pdf`)} testID="form-preview-sample" /> : bonds === null ? <Btn kind="ghost" label={t('bdk_preview')} onPress={loadBonds} testID="form-preview" /> : !bonds.length ? <Line muted>{t('bdk_preview_no_bonds')}</Line> : (
            <>
              <Line strong>{t('bdk_preview_pick')}</Line>
              {bonds.slice(0, 20).map(b => (
                <Btn key={b.id} kind="ghost" label={b.defendant_name} testID={`form-preview-${b.id}`}
                  onPress={() => open(`/bond-desk/forms/${editing.id}/preview.pdf?bond_id=${b.id}`, `${editing.name}-preview.pdf`)} />
              ))}
            </>
          )}
          {!editing.archived && <Btn kind="danger" label={t('bdk_archive')} onPress={() => archive(editing)} testID="form-archive" />}
          <Btn kind="ghost" label={t('bdk_close')} onPress={() => { setEditing(null); setBonds(null); }} testID="form-close" />
        </Card>
      )}

      <Card title={t('bdk_your_forms')} testID="forms-list">
        {!shown.length && <Line muted testID="forms-empty">{t('bdk_forms_none')}</Line>}
        {shown.map(f => (
          <TouchableOpacity key={f.id} accessibilityRole="button" testID={`form-${f.id}`} onPress={() => { setBonds(null); setEditing({ ...f, field_map: { ...(f.field_map || {}) } }); }} style={s.fieldRow}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={s.fieldName}>{f.name}</Text>
              <Line muted>{t('bdk_form_summary', { pages: f.page_count, mapped: Object.keys(f.field_map || {}).length, fields: f.fields.filter(x => x.type === 'text').length })}</Line>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {f.roles.map(r => <Pill key={r} text={t(`bdk_role_${r}`)} />)}
                {f.archived && <Pill text={t('bdk_archived')} tone="danger" />}
              </View>
            </View>
          </TouchableOpacity>
        ))}
        <Btn kind="ghost" label={showArchived ? t('bdk_hide_archived') : t('bdk_show_archived')} onPress={() => setShowArchived(v => !v)} testID="forms-archived-toggle" />
      </Card>

      <Modal visible={!!picking} animationType="slide" onRequestClose={() => setPicking(null)}>
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} testID="data-key-picker">
          <Card title={t('bdk_fill_field_with', { field: picking || '' })}>
            <Btn kind="ghost" label={t('bdk_not_filled')} testID="data-key-none" onPress={() => {
              if (editing && picking) { const m = { ...editing.field_map }; delete m[picking]; setEditing({ ...editing, field_map: m }); }
              setPicking(null);
            }} />
            {DATA_KEYS.map(k => (
              <Btn key={k} kind={editing?.field_map?.[picking || ''] === k ? 'primary' : 'ghost'} label={t(dataKeyLabelKey(k))} testID={`data-key-${k}`}
                onPress={() => { if (editing && picking) setEditing({ ...editing, field_map: { ...editing.field_map, [picking]: k } }); setPicking(null); }} />
            ))}
            <Btn kind="ghost" label={t('cancel')} onPress={() => setPicking(null)} />
          </Card>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  fieldRow: { minHeight: 44, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  fieldName: { fontSize: 14, ...FONTS.bold, color: colors.textPrimary, flexShrink: 1 },
  fieldKey: { fontSize: 13, color: colors.textBrand, flexShrink: 1, textAlign: 'right' },
});

export default React.memo(BondFormsScreen);
