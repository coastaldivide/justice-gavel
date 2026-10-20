/**
 * dataExport.ts — hand the account's data export (GET /auth/export) to the
 * person as a JSON file: a download on the web, the share sheet (save to Files,
 * mail, …) on a phone. A file, not a share "message": exports can be large.
 */
import { Platform } from 'react-native';
import { t } from '../i18n';

export const EXPORT_FILENAME = 'justice-gavel-export.json';

/** Resolves to how the file was delivered. */
export async function saveAccountExport(data: unknown): Promise<'download' | 'share'> {
  const text = JSON.stringify(data, null, 2);
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = EXPORT_FILENAME; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'download';
  }
  const fs = await import('expo-file-system');
  const file = new fs.File(fs.Paths.cache, EXPORT_FILENAME);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('x_st_could_not_export_data'));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: t('x_st_my_justice_gavel_data') });
  return 'share';
}
