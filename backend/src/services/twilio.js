/**
 * services/twilio.js — NOT IN USE
 *
 * Twilio is not used in Justice Gavel. SMS alerts are handled via:
 *   - Expo Push (APNs / FCM) for in-app notifications  → services/pushDelivery.js
 *   - Resend email                                      → services/email.js
 *
 * This file is kept as a stub so existing imports in push.js and
 * alerts.js do not throw. Do not add Twilio dependencies.
 *
 * Future SMS vendor (if needed): evaluate Vonage, Sinch, or Bandwidth.
 */

export const sendSMS         = async () => null;
export const sendCourtReminder = async () => null;
export const sendBailAlert     = async () => null;
export const sendCheckInMissed = async () => null;
export const sendFamilyAlert   = async () => null;
