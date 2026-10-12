/**
 * legalGate.ts — app-wide signal that the user must (re)accept the legal terms.
 *
 * The backend answers AI endpoints with HTTP 451 `disclaimer_required` until
 * the current disclaimer version is accepted. The API client calls
 * notifyDisclaimerRequired() on any 451; App.tsx subscribes and shows the
 * TermsAcceptanceModal, which records both the ToS and the AI disclaimer.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onDisclaimerRequired(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function notifyDisclaimerRequired(): void {
  listeners.forEach(fn => { try { fn(); } catch { /* listener errors never break requests */ } });
}
