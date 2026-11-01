/**
 * caseSteps.ts — saving "Your case, step by step" progress.
 *
 *   Signed in: per case on the account (GET / PUT /api/case-steps/:caseId — owner only; the
 *              server ticks "I know my next court date" from the case's court dates).
 *   Guest:     on this phone (AsyncStorage, like guestCourtDates): one progress, no case.
 *              "I know my next court date" is ticked when an upcoming court date is saved on
 *              this phone (services/guestCourtDates).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { listGuestCourtDates } from './guestCourtDates';
import { ALL_ITEM_IDS, AUTO_ITEMS, STAGE_IDS, type StageId } from '../constants/caseSteps';

export const GUEST_STEPS_KEY = 'case_steps_guest_v1';

export interface StepsProgress {
  stage: StageId | null;
  checked: Record<string, true>;
  auto: Record<string, true>;
  share_stage: boolean;
  next_court_date?: string | null;
  state?: string | null;
  case_title?: string;
}

const isStage = (s: unknown): s is StageId => typeof s === 'string' && (STAGE_IDS as readonly string[]).includes(s);

/** Only known, hand-ticked items that are true. */
export function cleanChecked(c: unknown): Record<string, true> {
  const o = c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
  const out: Record<string, true> = {};
  for (const [k, v] of Object.entries(o)) if (v === true && ALL_ITEM_IDS.includes(k) && !AUTO_ITEMS.includes(k)) out[k] = true;
  return out;
}

function fromServer(d: any): StepsProgress {
  const auto: Record<string, true> = {};
  for (const k of AUTO_ITEMS) if (d?.auto?.[k] === true) auto[k] = true;
  return {
    stage: isStage(d?.stage) ? d.stage : null, checked: cleanChecked(d?.checked), auto,
    share_stage: d?.share_stage === true, next_court_date: d?.next_court_date || null,
    state: d?.state || null, case_title: d?.case_title,
  };
}

/** Today on this device, 'YYYY-MM-DD'. */
function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function guestAuto(now = new Date()): Promise<Record<string, true>> {
  const dates = await listGuestCourtDates().catch(() => []);
  const auto: Record<string, true> = {};
  if (dates.length) auto['first.date_saved'] = true;
  if (dates.some(d => d.court_date >= today(now))) auto['pretrial.next_date'] = true;
  return auto;
}

export async function loadGuestSteps(now = new Date()): Promise<StepsProgress> {
  let saved: any = null;
  try { const raw = await AsyncStorage.getItem(GUEST_STEPS_KEY); saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  return { stage: isStage(saved?.stage) ? saved.stage : null, checked: cleanChecked(saved?.checked), auto: await guestAuto(now), share_stage: false };
}

export async function saveGuestSteps(p: { stage: StageId | null; checked: Record<string, true> }): Promise<void> {
  await AsyncStorage.setItem(GUEST_STEPS_KEY, JSON.stringify({ stage: isStage(p.stage) ? p.stage : null, checked: cleanChecked(p.checked), saved_at: new Date().toISOString() }));
}

export async function loadCaseSteps(caseId: number): Promise<StepsProgress> {
  const r = await api.get(`/case-steps/${caseId}`);
  return fromServer(r.data);
}

/** Save a change: { stage? } / { checked: { id: bool } } / { share_stage? }. */
export async function saveCaseSteps(caseId: number, patch: { stage?: StageId | null; checked?: Record<string, boolean>; share_stage?: boolean }): Promise<StepsProgress> {
  const r = await api.put(`/case-steps/${caseId}`, patch);
  return fromServer(r.data);
}
