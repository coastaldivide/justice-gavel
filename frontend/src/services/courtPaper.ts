/**
 * courtPaper.ts — "Read my court paper" (AI step 4; backend routes/courtPapers.js).
 *
 * A photo or PDF of a court paper is read by the server into PROPOSED court-date lines, each with
 * the exact words it came from and a confidence. Nothing is saved until the person checks every
 * line against the paper and taps confirm; the court date is then created through the ordinary
 * POST /court-dates (so reminders work as for a typed date). The paper is not kept unless the
 * person chooses to attach it to the case (POST /messages/attachment — the case documents).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from './api';
import { appendPicked } from './fileDownload';

export type Confidence = 'high' | 'medium' | 'low' | 'not_found';
export interface PaperField { value: string; source_text: string; confidence: Confidence }
export const PAPER_FIELDS = ['court_date', 'court_time', 'court_name', 'court_address', 'courtroom', 'case_number', 'judge', 'hearing_type'] as const;
export type PaperFieldName = typeof PAPER_FIELDS[number];
export interface BringItem { text: string; source_text: string; confidence: Confidence }
export interface PaperRead {
  result: 'read' | 'not_court_paper' | 'unreadable';
  fields: Record<PaperFieldName, PaperField> | null;
  bring: BringItem[];
  warnings: string[];
  notice: string;
  message?: string;
  pages?: number;
  via_file_id?: boolean;
  case_id?: number;
  attachment_id?: number;
}
export interface PaperStatus { enabled: boolean; max_mb: number; max_pages: number; types: string[]; reads_left_today: number }
export interface PickedFile { uri: string; name: string; type: string; size?: number | null }

/** The API's recommended size: a long edge of at most 1568 px (larger is scaled down server side, slower, no better). */
export const MAX_EDGE = 1568;

/** A photo resized to the recommended size and saved as JPEG (also turns an iPhone HEIC photo into JPEG). */
export async function preparePhoto(a: { uri: string; width?: number; height?: number }): Promise<PickedFile> {
  const w = Number(a.width) || 0; const h = Number(a.height) || 0;
  const actions = w > MAX_EDGE || h > MAX_EDGE ? [{ resize: w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, actions, { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: out.uri, name: 'court-paper.jpg', type: 'image/jpeg' };
}

export async function readPaperFile(file: PickedFile): Promise<PaperRead> {
  const form = new FormData();
  await appendPicked(form, 'file', { uri: file.uri, name: file.name, type: file.type });
  const r = await api.post<PaperRead>('/court-papers/read', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
  return r.data;
}

export async function readCaseDocument(attachmentId: number): Promise<PaperRead> {
  const r = await api.post<PaperRead>('/court-papers/read-attachment', { attachment_id: attachmentId }, { timeout: 120_000 });
  return r.data;
}

/** The editable form: one string per line, filled from what was read. */
export interface PaperForm {
  court_date: string; court_time: string; court_name: string; court_address: string; courtroom: string;
  case_number: string; judge: string; hearing_type: string; bring: string;
}
export function formFromRead(r: PaperRead): PaperForm {
  const v = (k: PaperFieldName) => r.fields?.[k]?.value || '';
  return {
    court_date: v('court_date'), court_time: v('court_time'), court_name: v('court_name'), court_address: v('court_address'),
    courtroom: v('courtroom'), case_number: v('case_number'), judge: v('judge'), hearing_type: v('hearing_type'),
    bring: (r.bring || []).map(b => b.text).join('\n'),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export type FormProblem = 'date' | 'time' | 'case' | null;
export function checkForm(f: PaperForm, c: { caseId: number | null; caseTitle: string }): FormProblem {
  if (!DATE_RE.test(f.court_date.trim())) return 'date';
  if (f.court_time.trim() && !TIME_RE.test(f.court_time.trim())) return 'time';
  if (!c.caseId && !c.caseTitle.trim()) return 'case';
  return null;
}

/** The POST /court-dates body for the confirmed form (the ordinary court-date path; source: 'paper'). */
export function courtDateBody(f: PaperForm, c: { caseId: number | null; caseTitle: string; state?: string | null }): Record<string, unknown> {
  const t = (s: string) => s.trim();
  const location = [t(f.court_name), t(f.court_address)].filter(Boolean).join(', ').slice(0, 200);
  const body: Record<string, unknown> = {
    court_date: t(f.court_date), source: 'paper',
    ...(t(f.court_time) ? { court_time: t(f.court_time) } : {}),
    ...(t(f.hearing_type) ? { hearing_type: t(f.hearing_type) } : {}),
    ...(location ? { location } : {}),
    ...(t(f.courtroom) ? { courtroom: t(f.courtroom) } : {}),
    ...(t(f.case_number) ? { case_number: t(f.case_number) } : {}),
    ...(t(f.judge) ? { judge: t(f.judge) } : {}),
    ...(t(f.bring) ? { bring: f.bring.split('\n').map(x => x.trim()).filter(Boolean).join('\n').slice(0, 1000) } : {}),
  };
  if (c.caseId) body.case_id = c.caseId;
  else { body.case_title = t(c.caseTitle); if (c.state) body.state = c.state; }
  return body;
}

/** Attach the paper to the case (the existing case-documents upload). */
export async function attachToCase(file: PickedFile, caseId: number, caption: string): Promise<void> {
  const form = new FormData();
  await appendPicked(form, 'file', { uri: file.uri, name: file.name, type: file.type });
  form.append('case_id', String(caseId));
  form.append('message', caption);
  await api.post('/messages/attachment', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
}
