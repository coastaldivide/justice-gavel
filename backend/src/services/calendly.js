/**
 * services/calendly.js — Calendly API integration for real attorney availability
 *
 * Replaces the stub availability system with live calendar data.
 *
 * Setup per attorney:
 *   1. Attorney connects Calendly account via OAuth in their dashboard
 *   2. We store their calendly_uri + access_token in attorney_profiles
 *   3. All slot queries hit Calendly's scheduling API in real time
 *
 * Calendly API docs: https://developer.calendly.com/api-docs
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const CALENDLY_BASE = 'https://api.calendly.com';
const PERSONAL_ACCESS = process.env.CALENDLY_PERSONAL_TOKEN; // platform token

/**
 * Fetch available time slots for a given attorney.
 * Falls back to our DB schedule if attorney hasn't connected Calendly.
 *
 * @param {string} calendlyUri - e.g. https://calendly.com/attorney-jane
 * @param {string} startTime   - ISO 8601
 * @param {string} endTime     - ISO 8601
 * @returns {Array} Available slot objects with start_time, end_time, invitee_limit
 */
export async function getAvailableSlots(calendlyUri, startTime, endTime) {
  if (!calendlyUri || !PERSONAL_ACCESS) {
    logger.warn('[calendly] No calendlyUri or token — using DB fallback');
    return null; // signal to caller to use DB schedule
  }

  try {
    // Get the event type URI for consultations
    const userRes = await axios.get(`${CALENDLY_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${PERSONAL_ACCESS}` },
      timeout: 8000,
    });

    const userUri = userRes.data.resource.uri;

    // List available times
    const availRes = await axios.get(`${CALENDLY_BASE}/event_type_available_times`, {
      headers: { Authorization: `Bearer ${PERSONAL_ACCESS}` },
      params: {
        event_type: calendlyUri,
        start_time:  startTime,
        end_time:    endTime,
      },
      timeout: 8000,
    });

    const slots = availRes.data.collection ?? [];
    logger.info({ msg: '[calendly] slots fetched', count: slots.length, uri: calendlyUri });

    return slots.map(s => ({
      start_time:     s.start_time,
      end_time:       new Date(new Date(s.start_time).getTime() + 30 * 60000).toISOString(),
      invitee_limit:  s.invitees_remaining ?? 1,
      status:         'available',
      source:         'calendly',
    }));

  } catch (err) {
    logger.error({ msg: '[calendly] API error — falling back to DB', error: err.message });
    return null; // graceful fallback
  }
}

/**
 * Create a Calendly scheduling event (book a slot).
 * @returns {object} scheduling_url to send to the client
 */
export async function createSchedulingLink(calendlyUri, inviteeName, inviteeEmail) {
  if (!calendlyUri || !PERSONAL_ACCESS) return null;

  try {
    const res = await axios.post(
      `${CALENDLY_BASE}/scheduling_links`,
      {
        max_event_count: 1,
        owner:           calendlyUri,
        owner_type:      'EventType',
      },
      {
        headers: {
          Authorization:  `Bearer ${PERSONAL_ACCESS}`,
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    );

    return {
      booking_url:    res.data.resource.booking_url,
      expires_at:     res.data.resource.owner,  // Calendly link is single-use
      source:         'calendly',
    };
  } catch (err) {
    logger.error({ msg: '[calendly] createSchedulingLink failed', error: err.message });
    return null;
  }
}

/**
 * Webhook handler: Calendly fires events when bookings are created/cancelled.
 * Register at: https://calendly.com/integrations/webhooks
 * Events: invitee.created, invitee.canceled
 */
export function handleCalendlyWebhook(payload) {
  const { event, payload: eventPayload } = payload;
  logger.info({ msg: '[calendly] webhook', event });

  switch (event) {
    case 'invitee.created':
      return {
        action:         'booking_confirmed',
        invitee_email:  eventPayload.email,
        invitee_name:   eventPayload.name,
        start_time:     eventPayload.scheduled_event?.start_time,
        end_time:       eventPayload.scheduled_event?.end_time,
        cancel_url:     eventPayload.cancel_url,
        reschedule_url: eventPayload.reschedule_url,
      };
    case 'invitee.canceled':
      return {
        action:        'booking_cancelled',
        invitee_email: eventPayload.email,
        cancel_reason: eventPayload.cancellation?.reason,
      };
    default:
      return { action: 'unknown', event };
  }
}
