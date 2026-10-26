/**
 * The bond case-file fields (new bond, edit bond) and their validation.
 */
import React from 'react';
import { t, useLang } from '../../i18n';
import { Field } from './ui';
import { isIsoDate, parseCents } from '../../services/bondDesk';

export const EMPTY_BOND = { defendant_name: '', bond_amount: '', defendant_phone: '', defendant_email: '', defendant_dob: '', defendant_address: '',
  case_number: '', court_name: '', county: '', state: '', court_date: '', charges: '', surety_name: '', notes: '' };
export type BondDraft = typeof EMPTY_BOND;

/** The POST/PATCH body for a bond draft, or an i18n error key. */
export function bondBody(d: BondDraft): { body?: Record<string, unknown>; error?: string } {
  if (!d.defendant_name.trim()) return { error: 'bdk_err_name' };
  const cents = parseCents(d.bond_amount);
  if (cents === null || cents <= 0) return { error: 'bdk_err_amount' };
  if (d.state.trim() && !/^[A-Za-z]{2}$/.test(d.state.trim())) return { error: 'bdk_err_state' };
  for (const k of ['defendant_dob', 'court_date'] as const) if (d[k].trim() && !isIsoDate(d[k].trim())) return { error: 'bdk_err_date' };
  if (d.defendant_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.defendant_email.trim())) return { error: 'bdk_err_email' };
  const body: Record<string, unknown> = { bond_amount_cents: cents };
  for (const [k, v] of Object.entries(d)) {
    if (k === 'bond_amount') continue;
    const s = v.trim();
    body[k] = k === 'state' ? (s ? s.toUpperCase() : null) : (s || null);
  }
  body.defendant_name = d.defendant_name.trim();
  return { body };
}

export function BondFields({ draft, set }: { draft: BondDraft; set: (k: keyof BondDraft, v: string) => void }) {
  useLang();
  return (
    <>
      <Field label={t('bdk_f_defendant_name')} value={draft.defendant_name} onChangeText={v => set('defendant_name', v)} testID="bond-f-defendant_name" autoCapitalize="words" />
      <Field label={t('bdk_f_bond_amount')} value={draft.bond_amount} onChangeText={v => set('bond_amount', v)} testID="bond-f-bond_amount" keyboardType="decimal-pad" placeholder="5000.00" />
      <Field label={t('bdk_f_phone')} value={draft.defendant_phone} onChangeText={v => set('defendant_phone', v)} testID="bond-f-defendant_phone" keyboardType="phone-pad" />
      <Field label={t('bdk_f_email')} value={draft.defendant_email} onChangeText={v => set('defendant_email', v)} testID="bond-f-defendant_email" keyboardType="email-address" autoCapitalize="none" />
      <Field label={t('bdk_f_dob')} value={draft.defendant_dob} onChangeText={v => set('defendant_dob', v)} testID="bond-f-defendant_dob" placeholder={t('bdk_date_ph')} />
      <Field label={t('bdk_f_address')} value={draft.defendant_address} onChangeText={v => set('defendant_address', v)} testID="bond-f-defendant_address" />
      <Field label={t('bdk_f_case_number')} value={draft.case_number} onChangeText={v => set('case_number', v)} testID="bond-f-case_number" autoCapitalize="characters" />
      <Field label={t('bdk_f_court_name')} value={draft.court_name} onChangeText={v => set('court_name', v)} testID="bond-f-court_name" />
      <Field label={t('bdk_f_county')} value={draft.county} onChangeText={v => set('county', v)} testID="bond-f-county" />
      <Field label={t('bdk_f_state')} value={draft.state} onChangeText={v => set('state', v)} testID="bond-f-state" autoCapitalize="characters" maxLength={2} placeholder="TN" />
      <Field label={t('bdk_f_court_date')} value={draft.court_date} onChangeText={v => set('court_date', v)} testID="bond-f-court_date" placeholder={t('bdk_date_ph')} />
      <Field label={t('bdk_f_charges')} value={draft.charges} onChangeText={v => set('charges', v)} testID="bond-f-charges" multiline maxLength={1000} />
      <Field label={t('bdk_f_surety')} value={draft.surety_name} onChangeText={v => set('surety_name', v)} testID="bond-f-surety_name" />
      <Field label={t('bdk_f_notes')} value={draft.notes} onChangeText={v => set('notes', v)} testID="bond-f-notes" multiline maxLength={2000} />
    </>
  );
}

