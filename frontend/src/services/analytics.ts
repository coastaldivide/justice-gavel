/**
 * analytics.ts — Conversion event tracking
 *
 * Instruments the 6 key conversion events the PM needs to track:
 *   1. sign_up        — user creates account
 *   2. first_ai_msg   — sends first AI chat message
 *   3. lawyer_view    — views a lawyer profile
 *   4. booking        — books a consultation
 *   5. subscribe      — completes subscription purchase
 *   6. refer          — shares a referral link
 *
 * SETUP:
 *   1. Set EXPO_PUBLIC_MIXPANEL_TOKEN in frontend/.env
 *   2. Run: npx expo install mixpanel-react-native
 *   3. Uncomment the Mixpanel init block below
 *
 * Until Mixpanel is installed, all events log to console.info in dev
 * and are silently no-ops in production (no crash risk).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Event schema ───────────────────────────────────────────────────────────────
type EventName =
  | 'sign_up'
  | 'first_ai_message'
  | 'lawyer_view'
  | 'consultation_booked'
  | 'subscription_started'
  | 'referral_shared'
  | 'case_created'
  | 'motion_generated'
  | 'document_analyzed'
  | 'emergency_alert_sent'
  | 'onboarding_completed'
  | 'login';

type EventProps = Record<string, string | number | boolean | null>;

// ── Analytics backend abstraction ─────────────────────────────────────────────
// Swap the implementation block to use Mixpanel, Amplitude, PostHog, etc.
// The call sites never need to change.

let _distinctId: string | null = null;

async function getDistinctId(): Promise<string> {
  if (_distinctId) return _distinctId;
  let id = await AsyncStorage.getItem('analytics_id').catch(() => null);
  if (!id) {
    // Use crypto.getRandomValues for unpredictable anonymous IDs
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    id = 'anon_' + Array.from(buf, n => n.toString(36)).join('') + Date.now().toString(36);
    await AsyncStorage.setItem('analytics_id', id).catch(() => {});
  }
  _distinctId = id;
  return id;
}

// ── Core track function ────────────────────────────────────────────────────────
export async function track(event: EventName, props: EventProps = {}): Promise<void> {
  try {
    const id = await getDistinctId();
    const payload = {
      event,
      distinct_id: id,
      timestamp: new Date().toISOString(),
      ...props,
    };

    if (__DEV__) {
      console.info('[analytics]', event, payload);
      return;
    }

    // ── Mixpanel (uncomment after: npx expo install mixpanel-react-native) ────
    // import { Mixpanel } from 'mixpanel-react-native';
    // const mp = new Mixpanel(process.env.EXPO_PUBLIC_MIXPANEL_TOKEN!, true);
    // mp.track(event, props);

    // ── PostHog (uncomment after: npx expo install posthog-react-native) ──────
    // import PostHog from 'posthog-react-native';
    // posthog.capture(event, props);

    // ── Fallback: send to own backend for basic event logging ─────────────────
    const token = await AsyncStorage.getItem('token').catch(() => null);
    fetch((process.env.EXPO_PUBLIC_API_BASE || '') + '/analytics/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {}); // fire-and-forget, never crash on analytics failure
  } catch {
    // analytics must never crash the app
  }
}

// ── Identify user after login/signup ──────────────────────────────────────────
export async function identify(userId: string, traits: EventProps = {}): Promise<void> {
  _distinctId = String(userId);
  await AsyncStorage.setItem('analytics_id', _distinctId).catch(() => {});
  await track('login', { user_id: userId, ...traits });
}

// ── Convenience wrappers for the 6 conversion events ─────────────────────────
export const Analytics = {
  signUp: (method: 'email' | 'google' | 'apple') =>
    track('sign_up', { method }),

  firstAiMessage: (mode: 'consumer' | 'defender', state: string) =>
    track('first_ai_message', { mode, state }),

  lawyerView: (lawyerId: number, city: string, specialties: string) =>
    track('lawyer_view', { lawyer_id: lawyerId, city, specialties }),

  consultationBooked: (lawyerName: string, durationMin: number, feeCents: number) =>
    track('consultation_booked', { lawyer_name: lawyerName, duration_min: durationMin, fee_cents: feeCents }),

  subscriptionStarted: (tier: string, interval: 'monthly' | 'annual', amount: number) =>
    track('subscription_started', { tier, interval, amount_cents: amount }),

  referralShared: (code: string, method: 'sms' | 'copy' | 'native_share') =>
    track('referral_shared', { code, method }),

  caseCreated: (chargeType: string, state: string) =>
    track('case_created', { charge_type: chargeType, state }),

  motionGenerated: (motionType: string) =>
    track('motion_generated', { motion_type: motionType }),

  documentAnalyzed: (docType: string, isPro: boolean) =>
    track('document_analyzed', { doc_type: docType, is_pro: isPro }),

  emergencyAlertSent: (contactCount: number) =>
    track('emergency_alert_sent', { contact_count: contactCount }),

  onboardingCompleted: (skipped: boolean) =>
    track('onboarding_completed', { skipped }),
};

export default Analytics;
