/**
 * useStoredUser — the signed-in account saved at login (secureStorage 'user').
 * `ready` turns true once storage was read; `user` is null when signed out.
 * Role checks here only choose what to SHOW; the server decides what is allowed.
 */
import { useEffect, useState } from 'react';
import { getItem } from '../utils/secureStorage';
import type { SessionUser } from '../services/session';

export type StoredUser = SessionUser & { is_admin?: number | boolean };

export async function readStoredUser(): Promise<StoredUser | null> {
  try {
    const raw = await getItem('user');
    const u = raw ? JSON.parse(raw) : null;
    return u && typeof u === 'object' ? (u as StoredUser) : null;
  } catch { return null; }
}

export const isAttorneyUser = (u: StoredUser | null) => !!u && (u.accountType === 'attorney' || ['attorney', 'defender', 'admin', 'super_admin'].includes(String(u.role)));
export const isBailAgentUser = (u: StoredUser | null) => !!u && u.accountType === 'bail_agent';
export const isAdminUser = (u: StoredUser | null) => !!u && ['admin', 'super_admin'].includes(String(u.role));

export function useStoredUser(): { user: StoredUser | null; ready: boolean } {
  const [state, setState] = useState<{ user: StoredUser | null; ready: boolean }>({ user: null, ready: false });
  useEffect(() => {
    let live = true;
    readStoredUser().then(user => { if (live) setState({ user, ready: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
