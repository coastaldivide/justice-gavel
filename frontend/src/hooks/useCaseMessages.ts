/**
 * hooks/useCaseMessages.ts — case message thread with polling updates.
 *
 * Loads the thread from GET /messages/:caseId and refreshes it every
 * MESSAGE_POLL_MS while the app is in the foreground. This deliberately
 * does NOT use Supabase Realtime: subscribing from the app would require
 * shipping the Supabase anon key in the bundle, and the database has no
 * row-level-security policies, so that key must never ship. Authenticated
 * REST polling delivers the same messages a few seconds later with no new
 * attack surface.
 *
 * Usage:
 *   const { messages, loading, error, sending, sendMessage, refresh, unavailable } =
 *     useCaseMessages(caseId);
 *
 * `unavailable`: the server answered 403 / 404 — the case was deleted or is not
 * the person's. Polling stops and the screen says so instead of offering a composer.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { t } from '../i18n';

/** How often the open thread checks for new messages (foreground only). */
export const MESSAGE_POLL_MS = 8_000;

export interface CaseMessage {
  id:              number;
  sender_id:       number;
  sender_type:     'user' | 'attorney' | 'system';
  sender_name:     string | null;
  body:            string;
  message_type?:   'chat' | 'note' | 'attachment';
  sent_at:         string;
  read_at:         string | null;
  attachment_id?:   number | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  attachment_url?:  string | null;
}

/** Union by id (newer data wins), ordered by sent_at then id. */
function mergeById(prev: CaseMessage[], incoming: CaseMessage[]): CaseMessage[] {
  const byId = new Map<number, CaseMessage>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.sent_at === b.sent_at ? a.id - b.id : a.sent_at < b.sent_at ? -1 : 1
  );
}

export function useCaseMessages(caseId: number | string | null | undefined) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const unavailableRef = useRef(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Guards against a slow response for a previous case landing in a new thread.
  const caseIdRef = useRef(caseId);
  useEffect(() => {
    caseIdRef.current = caseId;
    setMessages([]);
    setError(null);
    setUnavailable(false);
    unavailableRef.current = false;
  }, [caseId]);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const cid = caseId;
    if (!cid) return;
    if (!opts.silent) { setLoading(true); setError(null); }
    try {
      const res = await api.get(`/messages/${cid}`);
      if (!mountedRef.current || caseIdRef.current !== cid) return;
      const list: CaseMessage[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
      setMessages(prev => mergeById(opts.silent ? prev : [], list));
      setError(null);
    } catch (e) {
      if (!mountedRef.current || caseIdRef.current !== cid) return;
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 403 || status === 404) { unavailableRef.current = true; setUnavailable(true); setMessages([]); return; }
      // A failed background poll keeps the thread as-is and tries again later.
      if (!opts.silent) setError(apiErrorMessage(e, t('x_use_case_messages_could_not_load_messages')));
    } finally {
      if (mountedRef.current && !opts.silent && caseIdRef.current === cid) setLoading(false);
    }
  }, [caseId]);

  // Initial load + foreground polling with cleanup.
  useEffect(() => {
    if (!caseId) return;
    load();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && !unavailableRef.current) load({ silent: true });
    }, MESSAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [caseId, load]);

  /**
   * Send a message in the thread. Returns true when the server accepted it,
   * so callers can keep the draft in the input on failure.
   */
  const sendMessage = useCallback(async (
    body: string,
    type: 'chat' | 'note' = 'chat'
  ): Promise<boolean> => {
    const cid  = caseId;
    const text = body.trim();
    if (!cid || !text) return false;
    const maxLen = type === 'note' ? 50_000 : 10_000;
    if (text.length > maxLen) {
      setError(t('x_use_case_messages_message_longer_than_character', { maxLen: maxLen.toLocaleString() }));
      return false;
    }
    setSending(true);
    setError(null);
    try {
      const res = await api.post(`/messages/${cid}`, { body: text, message_type: type });
      if (mountedRef.current && caseIdRef.current === cid && res.data?.message) {
        const msg = res.data.message as CaseMessage;
        setMessages(prev => mergeById(prev, [msg]));
      }
      return true;
    } catch (e) {
      if (mountedRef.current && caseIdRef.current === cid) {
        setError(apiErrorMessage(e, t('x_use_case_messages_message_not_sent_check')));
      }
      return false;
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [caseId]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, loading, sending, error, sendMessage, refresh: load, clearError, unavailable };
}
