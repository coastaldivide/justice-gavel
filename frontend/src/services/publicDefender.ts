/**
 * services/publicDefender.ts — types and helpers for the public defender office screens (A11,
 * docs/PUBLIC_DEFENDER.md; backend routes/publicDefender.js and routes/admin/pdOffices.js).
 * The server setting PUBLIC_DEFENDER_CHANNEL_ENABLED (⚖) hides everything while it is off:
 * GET /pd/status says { enabled: false } and the other routes answer 503 feature_unavailable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from './api';
import { t } from '../i18n';

export type PdRole = 'admin' | 'staff';
export type PdLang = 'en' | 'es' | 'pt' | 'vi';
export const PD_LANGS: PdLang[] = ['en', 'es', 'pt', 'vi'];
export type PdCourtStatus = 'scheduled' | 'attended' | 'missed' | 'rescheduled' | 'cancelled';
export const PD_COURT_STATUSES: PdCourtStatus[] = ['scheduled', 'attended', 'rescheduled', 'missed', 'cancelled'];

export interface PdStatus { enabled: boolean; member: { office_id: number; office: string; role: PdRole; unread: number } | null; texts_live: boolean }
export interface PdBaseline { from: string; to: string; hearings: number; appeared: number; missed: number; source: string; set_at: string; appearance_rate?: number | null }
export interface PdOffice {
  id: number; name: string; county: string | null; state: string; phone: string | null; seat_limit: number; billing_email: string | null;
  status: 'active' | 'closed'; created_at: string; pilot_start: string | null; baseline: PdBaseline | null;
  consent: { at: string; by_user_id: number | null; by_name: string | null; text: string } | null;
}
export interface PdCounts { hearings: number; asked: number; attended: number; rescheduled: number; missed: number; no_answer: number; appearance_rate: number | null }
export interface PdDashboard {
  office: PdOffice; today: string; clients: number; upcoming_30_days: number; unread: number; opt_outs: number; rate_definition: string;
  upcoming: { court_date_id: number; court_date: string; court_time: string | null; court_name: string | null; client_id: number; name: string; case_number: string }[];
  appearance: (PdCounts & { month: string })[];
  pilot: (PdCounts & { since: string }) | null;
  baseline: PdBaseline | null;
  messages: { month: string; sent: number; failed: number; staff_replies: number; received: number }[];
}
export interface PdClient {
  id: number; name: string; phone: string; lang: PdLang; case_number: string; email: string | null; reminders_on: boolean; opted_out: boolean;
  created_at: string; last_message_at: string | null; next_court_date: string | null; unread: number;
}
export interface PdText { step: string; send_at: string; status: string; reason: string | null; sent_at: string | null; delivery: string | null }
export interface PdCourtDate {
  id: number; court_date: string; court_time: string | null; court_name: string | null; room: string | null; status: PdCourtStatus;
  status_source: 'reply' | 'office' | null; status_at: string | null; asked_at: string | null; texts: PdText[];
}
export interface PdClientDetail { client: PdClient; court_dates: PdCourtDate[] }
export interface PdMessage { id: number; direction: 'in' | 'out'; kind: string; body: string; status: string; delivery: string | null; created_at: string; sent_by_name: string | null }
export interface PdConversation { client_id: number; name: string; case_number: string; last_message_at: string; last_preview: string; last_direction: 'in' | 'out'; unread: number; opted_out: boolean; handled: boolean }
export interface PdImportRow { line: number; values: Record<string, unknown>; errors: { field: string; code: string; line?: number }[]; action: 'add' | 'update' | null }
export interface PdImportCheck { rows: PdImportRow[]; total: number; valid: number; invalid: number; adds: number; updates: number; file_errors: { code: string; column?: string; max?: number }[]; unknown_columns: string[] }
export interface PdMembers {
  seats: { limit: number; used: number; members: number; pending: number };
  members: { user_id: number; role: PdRole; email: string; name: string | null; added_at: string }[];
  invites: { id: number; email: string; role: PdRole; created_at: string; expires_at: string }[];
}
export interface PdInvoice { id: number; year: number; active_clients: number; setup_cents: number; per_client_cents: number; amount_cents: number; status: 'pending' | 'sent'; hosted_invoice_url: string | null; last_error: string | null; sent_at: string | null }

/** '$2,000,008.00' from integer cents. */
export const usd = (cents: number): string => `$${(Number(cents || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
/** '78.9%' or '—' */
export const pct = (v: number | null | undefined): string => (v == null ? '—' : `${v}%`);

export const langLabel = (l: string): string => t(`pd_lang_${l}`);
export const statusLabel = (s: string): string => t(`pd_status_${s}`);
export const stepLabel = (s: string): string => t(`pd_step_${s}`);

/** A CSV row error in words. */
export function importErrorText(e: { field: string; code: string; line?: number }): string {
  const field = t(`pd_col_${e.field}`);
  if (e.code === 'duplicate_row') return t('pd_imp_err_duplicate_row', { line: e.line ?? '' });
  return `${field}: ${t(`pd_imp_err_${e.code}`)}`;
}
export function importFileErrorText(e: { code: string; column?: string; max?: number }): string {
  return t(`pd_imp_file_${e.code}`, { column: e.column ? t(`pd_col_${e.column}`) : '', max: e.max ?? '' });
}

type LoadState<T> = { data: T | null; error: string; off: boolean; notMember: boolean; loading: boolean; reload: () => Promise<void> };

/** GET a /pd path; tells apart "setting off" (503 feature_unavailable) and "not in an office" (403 not_member). */
export function usePdGet<T>(path: string | null): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState('');
  const [off, setOff] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const r = await api.get<T>(path);
      if (!mounted.current) return;
      setData(r.data); setProblem(prev => (prev ? '' : prev)); setOff(false); setNotMember(false);
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (!mounted.current) return;
      if (code === 'feature_unavailable') setOff(true);
      else if (code === 'not_member') setNotMember(true);
      else setProblem(apiErrorMessage(e, t('pd_load_failed')));
    } finally { if (mounted.current) setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error: problem, off, notMember, loading, reload };
}
