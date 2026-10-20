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

/** Download (web) or share (native) a calendar file. Resolves to how it was delivered. */
export async function saveIcs(text: string, filename: string): Promise<'download' | 'share'> {
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

/** Download / share a court date's file. Resolves to how it was delivered. */
export async function exportCourtDateIcs(id: number): Promise<'download' | 'share'> {
  const { text, filename } = await fetchCourtDateIcs(id);
  return saveIcs(text, filename);
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\r?\n/g, '\\n');
const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A one-event calendar file for an exact start (UTC) and length. */
export function buildEventIcs({ uid, start, minutes, title, description }: { uid: string; start: Date; minutes: number; title: string; description?: string }): string {
  const end = new Date(start.getTime() + minutes * 60_000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Justice Gavel//Consultation//EN', 'CALSCALE:GREGORIAN', // i18n-exempt: iCalendar protocol fields
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsUtc(new Date())}`, `DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscape(title)}`, ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
