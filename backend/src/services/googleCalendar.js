/**
 * services/googleCalendar.js — Google Calendar court date sync
 *
 * Uses the Google Calendar MCP (connected in this session) to sync
 * matter court dates to attorney Google Calendars automatically.
 *
 * Called from:
 *   routes/matters.js  — on matter creation / court_date update
 *   routes/cases.js    — on case court_date update
 *
 * This is a server-side integration. The MCP is connected externally;
 * in production, this calls the Calendar API via the OAuth token
 * stored per attorney in the database.
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   (OAuth tokens stored per-user in attorneys.google_refresh_token)
 */


// Fetch with timeout — prevents hanging external API calls
async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

import logger from '../utils/logger.js';

/**
 * Create a Google Calendar event for a court date.
 * @param {string} refreshToken  — attorney's stored Google OAuth refresh token
 * @param {object} details       — event details
 */
export async function createCourtDateEvent(refreshToken, {
  title,
  courtDate,         // ISO string e.g. '2024-03-15T09:00:00Z'
  durationMinutes = 240,  // default 4-hour block
  location,
  description,
  attendeeEmails = [],
  caseNumber,
}) {
  if (!refreshToken) {
    logger.warn('[googleCalendar] no refresh token — Calendar sync skipped');
    return null;
  }

  try {
    // Exchange refresh token for access token
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token, error: tokenErr } = await tokenRes.json();
    if (tokenErr || !access_token) {
      logger.warn('[googleCalendar] token refresh failed:', tokenErr);
      return null;
    }

    const start   = new Date(courtDate);
    const end     = new Date(start.getTime() + durationMinutes * 60_000);

    const event = {
      summary:     `⚖️ ${title}${caseNumber ? ` [${caseNumber}]` : ''}`,
      location:    location || '',
      description: [
        description,
        caseNumber ? `Case #: ${caseNumber}` : null,
        `Created by Justice Gavel`,
      ].filter(Boolean).join('\n'),
      start:  { dateTime: start.toISOString(), timeZone: 'America/New_York' },
      end:    { dateTime: end.toISOString(),   timeZone: 'America/New_York' },
      attendees: attendeeEmails.map(email => ({ email })),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 }, // 24hr
          { method: 'popup', minutes: 60 },        // 1hr
          { method: 'email', minutes: 24 * 60 },   // 24hr email
        ],
      },
      colorId: '3', // sage green — distinguishable from personal events
    };

    const res = await fetchWithTimeout(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      logger.warn('[googleCalendar] event creation failed:', data?.error?.message);
      return null;
    }

    logger.info('[googleCalendar] court date event created', {
      eventId: data.id, title: event.summary.slice(0, 40),
    });
    return { eventId: data.id, htmlLink: data.htmlLink };

  } catch (err) {
    logger.error('[googleCalendar] createCourtDateEvent error:', err?.message);
    return null;
  }
}

/** Update an existing calendar event (e.g. hearing rescheduled) */
export async function updateCourtDateEvent(refreshToken, eventId, updates) {
  if (!refreshToken || !eventId) return null;
  try {
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method:  'PATCH',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );
    const data = await res.json();
    return res.ok ? { eventId: data.id } : null;
  } catch (err) {
    logger.error('[googleCalendar] updateCourtDateEvent error:', err?.message);
    return null;
  }
}

/** Delete a calendar event (case dismissed, hearing cancelled) */
export async function deleteCourtDateEvent(refreshToken, eventId) {
  if (!refreshToken || !eventId) return null;
  try {
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;

    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${access_token}` } }
    );
    return true;
  } catch (err) {
    logger.error('[googleCalendar] deleteCourtDateEvent error:', err?.message);
    return null;
  }
}
