/**
 * fileDownload.ts — get a file from the API (receipts, signed PDFs, CSV
 * reports, uploaded IDs) with the signed-in person's token, then:
 *   web    → 'download' saves it; 'view' opens it in a new tab (PDFs)
 *   native → written to the cache folder and handed to the share sheet
 *            (Files, a PDF viewer, Photos …)
 * Same approach as services/attachments.ts (case documents).
 */
import { Platform } from 'react-native';
import { api } from './api';
import { t } from '../i18n';

const safeName = (name: string) => String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file';

export async function fetchFile(url: string, name: string, mime: string, mode: 'download' | 'view' = 'download'): Promise<'download' | 'view' | 'share'> {
  const file = safeName(name);
  if (Platform.OS === 'web') {
    const res = await api.get<Blob>(url, { responseType: 'blob' });
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data as BlobPart], { type: mime });
    const href = URL.createObjectURL(blob);
    if (mode === 'view') {
      // No 'noopener' feature here: with it window.open always returns null, and the file would
      // also be saved to the device (a shared office tablet). The opener link is cut by hand.
      const w = window.open(href, '_blank');
      if (w) { try { w.opener = null; } catch { /* cross-origin: already cut */ } }
      if (!w) {   // pop-up blocked: fall back to a download
        const a = document.createElement('a');
        a.href = href; a.download = file; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      }
    } else {
      const a = document.createElement('a');
      a.href = href; a.download = file; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(href), 120_000);
    return mode;
  }
  const res = await api.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  const fs = await import('expo-file-system');
  const out = new fs.File(fs.Paths.cache, file);
  if (out.exists) out.delete();
  out.create();
  out.write(new Uint8Array(res.data));
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('msg2_cannot_open'));
  await Sharing.shareAsync(out.uri, { mimeType: mime, dialogTitle: file });
  return 'share';
}

/** A picked file (document picker / camera) appended to a FormData under `field`. */
export async function appendPicked(form: FormData, field: string, file: { uri: string; name: string; type: string }) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, blob, file.name);
  } else {
    form.append(field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
}
