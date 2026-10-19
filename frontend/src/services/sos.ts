/**
 * sos.ts — the emergency alert to the person's saved contacts (Home "SOS",
 * Emergency screen).
 *
 * POST /api/alerts says, per contact, whether the alert really went out (the
 * server texts / e-mails only when an SMS / e-mail provider is configured).
 * Whatever did not go out is handed to the phone's own messages app with the
 * same text, so an SOS is never reported as "sent" when nobody got it.
 * Location is attached when available; a denied permission never blocks it.
 */
import { Linking, Platform } from 'react-native';
import { api } from './api';
import { getLocation } from './location';
import { getContacts, getUserName } from './storage';
import { t } from '../i18n';

export interface AlertDelivery { contact: string; method: 'sms' | 'email'; delivered: boolean; reason?: string }
export interface SosResult {
  sent: number; total: number; results: AlertDelivery[];
  /** The alert text (the server's, or the same text built here when the server could not be reached). */
  message: string;
  /** Contacts the alert did NOT reach — hand these to openSmsComposer(). */
  notSent: string[];
  /** True when the server could not be reached at all. */
  offline: boolean;
}

/** The saved emergency contacts (empty slots removed). */
export async function activeContacts(): Promise<string[]> {
  return (await getContacts()).map(c => c.trim()).filter(Boolean);
}

/**
 * Send the alert. Never throws: when the server can't be reached (or refuses)
 * every contact is returned in notSent with the same alert text built here.
 */
export async function sendSos(contacts: string[], locationReason?: string): Promise<SosResult> {
  const coords = await getLocation(locationReason ? { reason: locationReason } : {}).catch(() => null);
  const name = (await getUserName()).trim();
  try {
    const res = await api.post<{ sent: number; total: number; results: AlertDelivery[]; message: string }>('/alerts', {
      userName: name,
      contacts,
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    });
    const results = Array.isArray(res.data?.results) ? res.data.results : [];
    return {
      sent: Number(res.data?.sent) || 0,
      total: Number(res.data?.total) || contacts.length,
      results,
      message: String(res.data?.message || ''),
      notSent: results.filter(r => !r.delivered).map(r => r.contact),
      offline: false,
    };
  } catch (e) {
    const who = name || t('sos_someone');
    const message = coords
      ? t('sos_message', { name: who, link: `https://maps.google.com/?q=${coords.lat},${coords.lng}` })
      : t('sos_message_no_location', { name: who });
    return { sent: 0, total: contacts.length, results: [], message, notSent: contacts, offline: !(e as { response?: unknown })?.response };
  }
}

const digits = (c: string) => c.replace(/[^\d+]/g, '');
export const isPhoneContact = (c: string) => !c.includes('@') && digits(c).replace(/\D/g, '').length >= 7;

/**
 * The phone's messages app with `body` filled in for every number in
 * `contacts` (Android / web: sms:a,b?body=; iOS: sms:/open?addresses=a,b&body=).
 * Resolves false when there is no number to text or the app can't be opened.
 */
export async function openSmsComposer(contacts: string[], body: string): Promise<boolean> {
  const nums = contacts.filter(isPhoneContact).map(digits);
  if (!nums.length) return false;
  const text = encodeURIComponent(body);
  const url = Platform.OS === 'ios'
    ? `sms:/open?addresses=${nums.join(',')}&body=${text}`
    : `sms:${nums.join(',')}?body=${text}`;
  try { await Linking.openURL(url); return true; } catch { return false; }
}

/** Crisis Text Line style "text WORD to NUMBER" (iOS uses &body=, Android ?body=). */
export function smsUrl(number: string, body: string): string {
  return `sms:${digits(number)}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

type Confirm = (title: string, message?: string, opts?: { confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
type Toast = (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;

/**
 * Tell the person what really happened. Everyone reached → a success toast.
 * Otherwise → "Your alert did not reach N contacts — open your messages app?"
 * and, on yes, the messages app with the alert text. Returns the summary line.
 */
export async function reportSosResult(r: SosResult, confirm: Confirm, showToast: Toast): Promise<string> {
  if (r.total > 0 && r.sent === r.total) {
    const line = t('sos_sent_all', { n: r.sent });
    showToast(line, 'success');
    return line;
  }
  const line = r.offline ? t('sos_offline', { n: r.notSent.length })
    : r.sent > 0 ? t('sos_sent_some', { sent: r.sent, total: r.total })
      : t('sos_sent_none', { n: r.total });
  const phones = r.notSent.filter(isPhoneContact);
  if (!phones.length) { showToast(line, 'warning'); return line; }
  const ok = await confirm(t('sos_text_them_title'), `${line}\n\n${t('sos_text_them_body')}`, { confirmLabel: t('sos_open_messages') });
  if (ok && !(await openSmsComposer(phones, r.message))) showToast(t('sos_messages_unavailable'), 'error');
  return line;
}
