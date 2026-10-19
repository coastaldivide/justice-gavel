/**
 * caseNotes.ts — add a note to a case without losing what is already there.
 *
 * The notes are re-read from the server first (GET /cases is the owner's own
 * list, notes decrypted), so a screen that opened with stale or no notes can
 * never overwrite them. Returns the combined notes that were saved.
 */
import { api, unwrapList } from './api';

export async function appendCaseNote(caseId: number | string, note: string): Promise<string> {
  const res = await api.get('/cases');
  const current = unwrapList<{ id: number | string; notes?: string | null }>(res.data, 'cases')
    .find(c => String(c.id) === String(caseId));
  if (!current) throw Object.assign(new Error('Case not found'), { response: { status: 404 } });
  const existing = String(current.notes || '').trim();
  const combined = existing ? `${existing}\n\n${note.trim()}` : note.trim();
  await api.put(`/cases/${caseId}`, { notes: combined });
  return combined;
}
