/**
 * attachments.ts — open a case document (GET /api/messages/attachment/:id).
 *
 * The file is fetched with the signed-in person's token (the server checks
 * that they can open the case thread), then:
 *   web    → a download (<a download>) the browser can open
 *   native → written to the cache folder and handed to the share sheet
 *            (Files, a PDF viewer, Photos …)
 */
import { Platform } from 'react-native';
import { api } from './api';
import { t } from '../i18n';

const safeName = (name: string) => String(name || 'document').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'document';

export async function openAttachment(id: number, name: string, mime: string | null | undefined): Promise<'download' | 'share'> {
  const file = safeName(name);
  if (Platform.OS === 'web') {
    const res = await api.get<Blob>(`/messages/attachment/${id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = file; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'download';
  }
  const res = await api.get<ArrayBuffer>(`/messages/attachment/${id}`, { responseType: 'arraybuffer' });
  const fs = await import('expo-file-system');
  const out = new fs.File(fs.Paths.cache, file);
  if (out.exists) out.delete();
  out.create();
  out.write(new Uint8Array(res.data));
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('msg2_cannot_open'));
  await Sharing.shareAsync(out.uri, { mimeType: mime || 'application/octet-stream', dialogTitle: file });
  return 'share';
}
