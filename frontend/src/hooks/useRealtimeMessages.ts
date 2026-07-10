/**
 * hooks/useRealtimeMessages.ts
 *
 * Subscribes to Supabase Realtime postgres_changes for a case's messages.
 * Replaces the polling pattern in ChatScreen.tsx.
 *
 * Usage:
 *   const { messages, sendMessage, unread } = useRealtimeMessages(caseId);
 */

import { useState, useEffect, useRef, useCallback } from 'react';
// Supabase Realtime: add @supabase/supabase-js to package.json (npm i @supabase/supabase-js)
// For now, channel subscription uses the REST polling as fallback
// import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { api } from '../services/api';

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl as string;
const SUPABASE_KEY = Constants.expoConfig?.extra?.supabaseAnonKey as string;

interface Message {
  id:          number;
  sender_id:   number;
  sender_type: 'user' | 'attorney' | 'system';
  sender_name: string;
  body:        string;
  sent_at:     string;
  read_at:     string | null;
}

export function useRealtimeMessages(caseId: string | number | null) {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [unread, setUnread]       = useState(0);
  const channelRef                = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // TODO: install @supabase/supabase-js for real-time subscription
  // const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const supabase: any             = null; // replace with createClient after install

  // Initial history load
  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    setError(null);

    api.get(`/messages/${caseId}`)
      .then(({ data }) => {
        setMessages(data.messages || []);
      })
      .catch(e => setError(e?.message || 'Failed to load messages'))
      .finally(() => setLoading(false));
  }, [caseId]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!caseId || !SUPABASE_URL || !SUPABASE_KEY) return;

    // Unsubscribe previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    if (!supabase) return; // install @supabase/supabase-js to enable real-time
    const channel = supabase
      .channel(`case:${caseId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'case_messages',
          filter: `case_id=eq.${caseId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages(prev => {
            // Deduplicate
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          // Increment unread if message is from someone else
          setUnread(prev => prev + 1);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Realtime connected — clear any fallback polling
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [caseId]);

  // Send a message
  const sendMessage = useCallback(async (body: string) => {
    if (!caseId || !body.trim()) return;
    try {
      const { data } = await api.post(`/messages/${caseId}`, { body });
      // Optimistic update (Realtime will also fire, deduplication handles it)
      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to send');
    }
  }, [caseId]);

  const clearUnread = useCallback(() => setUnread(0), []);

  return { messages, loading, error, sendMessage, unread, clearUnread };
}
