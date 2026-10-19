/**
 * icsExport.ts — save a court date's .ics file (built by the server,
 * GET /api/court-dates/:id/ics) so it lands in the phone's calendar and
 * survives deleting the app.
 *   web    → a download (<a download>), the browser hands it to the calendar
 *   native → written to the cache folder, then the share sheet (Calendar,
 *            Files, Mail …)
 */
import { Platform } from 'react-native';
import { api } from '../services/api';
import { t } from '../i18n';

/** 'court-date-YYYY-MM-DD.ics' from the event's DTSTART (not a VTIMEZONE's). */
export function icsFilename(text: string): string {
  const m = /BEGIN:VEVENT[\s\S]*?\r?\nDTSTART[^:\r\n]*:(\d{4})(\d{2})(\d{2})/.exec(text);
  return m ? `court-date-${m[1]}-${m[2]}-${m[3]}.ics` : 'court-date.ics';
}

export async function fetchCourtDateIcs(id: number): Promise<{ text: string; filename: string }> {
  const res = await api.get<string>(`/court-dates/${id}/ics`, { responseType: 'text', transformResponse: (d: unknown) => d });
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  if (!text.startsWith('BEGIN:VCALENDAR')) throw new Error('The calendar file could not be created.');
  return { text, filename: icsFilename(text) };
}

/** Download / share the file. Resolves to how it was delivered. */
export async function exportCourtDateIcs(id: number): Promise<'download' | 'share'> {
  const { text, filename } = await fetchCourtDateIcs(id);
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'download';
  }
  const fs = await import('expo-file-system');
  const file = new fs.File(fs.Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'public.calendar-event', dialogTitle: t('x_ics_export_add_calendar') });
  return 'share';
}
