/**
 * routes/integrations/caldav.js — CalDAV Calendar Push Integration
 *
 * Pushes Justice Gavel docket deadlines to:
 *   - Any CalDAV server (RFC 4791) — Apple Calendar, Nextcloud, Fastmail, etc.
 *   - Google Calendar (via CalDAV endpoint or Google Calendar API)
 *   - Microsoft Outlook / Exchange (via EWS CalDAV or Graph API)
 *
 * Operations:
 *   POST /api/integrations/caldav/push/:entryId     — push single docket entry
 *   POST /api/integrations/caldav/push/matter/:id   — push all pending deadlines for matter
 *   DELETE /api/integrations/caldav/events/:uid     — delete calendar event
 *   GET  /api/integrations/caldav/events            — list pushed events
 *   GET  /api/integrations/caldav/ical/:firmId      — generate ICS feed for all firm deadlines
 *
 * iCal format (RFC 5545) is generated from scratch — no library needed.
 * CalDAV PUT creates events; DELETE removes them.
 * HMAC-SHA1 UID ensures events are stable across sync cycles.
 */

import { Router }     from 'express';
import { createHmac, randomUUID } from 'crypto';
import { getDb }      from '../../db/index.js';
import { authRequired } from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt, sanitizeStr } from '../../utils/routeHelpers.js';
import logger         from '../../utils/logger.js';
import { refreshTokenIfNeeded } from './index.js';

const router     = Router();
const calLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Calendar sync limit.' });

// ── iCal helpers ──────────────────────────────────────────────────────────────

/** Fold long lines per RFC 5545 §3.1 (max 75 octets, fold with CRLF + space) */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks = [];
  let pos = 0;
  while (pos < bytes.length) {
    if (pos === 0) {
      chunks.push(bytes.slice(0, 75).toString('utf8'));
      pos = 75;
    } else {
      chunks.push(' ' + bytes.slice(pos, pos + 74).toString('utf8'));
      pos += 74;
    }
  }
  return chunks.join('\r\n');
}

/** Format a JS Date or ISO string as iCal YYYYMMDD (all-day) */
function toICalDate(iso) {
  return String(iso || '').slice(0, 10).replace(/-/g, '');
}

/** Format as iCal datetime YYYYMMDDTHHMMSSZ */
function toICalDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

/** Escape iCal text values (commas, semicolons, backslashes, newlines) */
function escapeIcal(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/** Generate a stable iCal UID from matter+entry data */
function generateUID(firmId, entryId) {
  const hash = createHmac('sha256', String(firmId || 'jg'))
    .update(String(entryId || randomUUID()))
    .digest('hex')
    .slice(0, 32);
  return `jg-${hash}@justicegavel.app`;
}

/** Build a VEVENT block for a docket entry */
function buildVEvent(entry, uid, now) {
  const dtStamp = toICalDateTime(now || new Date().toISOString());
  const dtStart = `DTSTART;VALUE=DATE:${toICalDate(entry.due_date)}`;
  const dtEnd   = `DTEND;VALUE=DATE:${toICalDate(addCalDays(entry.due_date, 1))}`;

  const priority = {
    critical: '1',
    high:     '3',
    normal:   '5',
    low:      '7',
  }[entry.priority] || '5';

  const alarm = entry.reminder_days > 0
    ? [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:Deadline reminder: ${escapeIcal(entry.title)}`,
        `TRIGGER:-P${entry.reminder_days}D`,
        'END:VALARM',
      ].join('\r\n')
    : '';

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    dtStart,
    dtEnd,
    foldLine(`SUMMARY:${escapeIcal(entry.title)}`),
    entry.description ? foldLine(`DESCRIPTION:${escapeIcal(entry.description)}`) : '',
    entry.rule_citation ? foldLine(`COMMENT:Rule: ${escapeIcal(entry.rule_citation)}`) : '',
    entry.court ? foldLine(`LOCATION:${escapeIcal(entry.court)}`) : '',
    `PRIORITY:${priority}`,
    `STATUS:${entry.status === 'completed' ? 'COMPLETED' : 'CONFIRMED'}`,
    `CATEGORIES:${entry.entry_type?.toUpperCase() || 'DEADLINE'}`,
    `X-JUSTICE-GAVEL-ID:${entry.id}`,
    `X-JUSTICE-GAVEL-PRIORITY:${entry.priority || 'normal'}`,
    alarm,
    'END:VEVENT',
  ].filter(Boolean);

  return lines.join('\r\n');
}

function addCalDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build a complete VCALENDAR from an array of VEVENT blocks */
function buildVCalendar(events, prodId = '-//Justice Gavel//Legal Docket//EN', name = 'Justice Gavel Deadlines') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcal(name)}`,
    'X-WR-TIMEZONE:UTC',
    ...events,
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// ── CalDAV PUT helper ──────────────────────────────────────────────────────────

async function caldavPut(conn, uid, ical) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) return { demo: true, uid, href: `demo://${uid}.ics` };

  const meta      = (() => { try { return JSON.parse(conn.metadata || '{}'); } catch { return {}; } })();
  const calendarUrl = meta.calendar_url || conn.instance_url;
  if (!calendarUrl) throw new Error('No calendar URL configured. Set calendar_url in connection metadata.');

  const resourceUrl = `${calendarUrl.replace(/\/$/, '')}/${uid}.ics`;

  // Determine auth header
  let authHeader;
  if (conn.provider === 'google_calendar') {
    authHeader = `Bearer ${conn.access_token}`;
  } else if (conn.provider === 'outlook') {
    authHeader = `Bearer ${conn.access_token}`;
  } else {
    // CalDAV basic auth (token is base64(username:password))
    authHeader = `Basic ${conn.access_token}`;
  }

  const resp = await fetch(resourceUrl, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type':  'text/calendar; charset=utf-8',
      'If-None-Match': '*', // Create only — use '*' to allow updates too
    },
    body: ical,
  });

  if (!resp.ok && resp.status !== 204 && resp.status !== 201) {
    const err = await resp.text().catch(() => '');
    throw new Error(`CalDAV PUT failed ${resp.status}: ${err.slice(0, 200)}`);
  }

  const href = resp.headers.get('location') || resourceUrl;
  return { demo: false, uid, href, status: resp.status };
}

async function caldavDelete(conn, href) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) return { demo: true, deleted: true };

  let authHeader;
  if (conn.provider === 'google_calendar' || conn.provider === 'outlook') {
    authHeader = `Bearer ${conn.access_token}`;
  } else {
    authHeader = `Basic ${conn.access_token}`;
  }

  const resp = await fetch(href, {
    method: 'DELETE',
    headers: { 'Authorization': authHeader },
  });

  return { demo: false, deleted: resp.ok || resp.status === 204, status: resp.status };
}

// ── Main sync dispatcher ──────────────────────────────────────────────────────

export async function syncCalendar({ db, conn: _conn, ctx, entity_type, direction, matter_id, user }) {
  const conn = await refreshTokenIfNeeded(db, _conn);
  try {
    if (entity_type !== 'event') {
      return { status: 'skipped', message: 'Calendar sync only supports entity_type=event.' };
    }

    // Get docket entries for the matter (or all firm deadlines if no matter)
    let entries;
    if (matter_id) {
      entries = await db.all(
        "SELECT id, matter_id, firm_id, entry_date, description, filing_type, due_date, created_at FROM docket_entries WHERE matter_id=? AND status='pending' ORDER BY due_date ASC",
        [matter_id]
      ).catch(() => []);
    } else {
      entries = await db.all(
        "SELECT id, matter_id, firm_id, entry_date, description, filing_type, due_date, created_at FROM docket_entries WHERE firm_id=? AND status='pending' ORDER BY due_date ASC LIMIT 100",
        [ctx.firm_id]
      ).catch(() => []);
    }

    if (!entries.length) {
      return { status: 'skipped', message: 'No pending docket entries to sync.', records_sent: 0 };
    }

    let sent = 0, errors = 0;
    const now = new Date().toISOString();

    for (const entry of entries) {
      try {
        const uid   = generateUID(ctx.firm_id, entry.id);
        const vevent = buildVEvent(entry, uid, now);
        const ical  = buildVCalendar([vevent], undefined, `Matter ${matter_id || ctx.firm_id} Deadlines`);

        const result = await caldavPut(conn, uid, ical);

        // Upsert calendar_push_events
        const existing = await db.get('SELECT id FROM calendar_push_events WHERE external_uid=?', [uid]).catch(() => null);
        if (existing) {
          await db.run(
            "UPDATE calendar_push_events SET external_href=?, sync_status='synced', last_sync_at=datetime('now') WHERE id=?",
            [result.href, existing.id]
          );
        } else {
          const meta = (() => { try { return JSON.parse(conn.metadata || '{}'); } catch { return {}; } })();
          await db.run(
            `INSERT INTO calendar_push_events
               (connection_id, docket_entry_id, external_uid, external_href, calendar_url,
                summary, dtstart, dtend, status, sync_status, last_sync_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
            [
              conn.id, entry.id, uid, result.href,
              meta.calendar_url || conn.instance_url || null,
              entry.title,
              entry.due_date + 'T09:00:00Z',
              addCalDays(entry.due_date, 1) + 'T09:00:00Z',
              'confirmed', 'synced',
            ]
          );
        }
        sent++;
      } catch (e) {
        logger.warn(`[caldav/sync] entry ${entry.id}:`, e.message);
        errors++;
      }
    }

    return {
      status:       errors === entries.length ? 'error' : (errors > 0 ? 'partial' : 'success'),
      records_sent: sent,
      errors,
      total:        entries.length,
    };
  } catch (e) {
    logger.error('[caldav/sync]', e.message);
    return { status: 'error', error: e.message };
  }
}

// ── REST endpoints ────────────────────────────────────────────────────────────

// POST /api/integrations/caldav/push/:entryId — push single docket entry
router.post('/push/:entryId', authRequired, calLimiter, async (req, res) => {
  try {
    const db      = await getDb();
    const ctx     = await loadFirmContext(req);
    const entryId = safeInt(req.params.entryId);

    const conn = await db.get(
      "SELECT id, firm_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('caldav','google_calendar','outlook') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active calendar connection. Connect CalDAV, Google Calendar, or Outlook first.');

    const entry = await db.get('SELECT id, matter_id, firm_id, entry_date, description, docket_number, filing_type, due_date, completed FROM docket_entries WHERE id=?', [entryId]);
    if (!entry) return err404(res, 'Docket entry not found.');

    const now   = new Date().toISOString();
    const uid   = generateUID(ctx?.firm_id, entryId);
    const vevent = buildVEvent(entry, uid, now);
    const ical  = buildVCalendar([vevent]);

    const result = await caldavPut(conn, uid, ical);

    // Upsert record
    const existingEvt = await db.get('SELECT id FROM calendar_push_events WHERE docket_entry_id=? AND connection_id=?', [entryId, conn.id]).catch(() => null);
    const meta = (() => { try { return JSON.parse(conn.metadata || '{}'); } catch { return {}; } })();
    if (existingEvt) {
      await db.run(
        "UPDATE calendar_push_events SET external_href=?, sync_status='synced', last_sync_at=datetime('now') WHERE id=?",
        [result.href, existingEvt.id]
      );
    } else {
      await db.run(
        `INSERT INTO calendar_push_events
           (connection_id, docket_entry_id, external_uid, external_href, calendar_url,
            summary, dtstart, dtend, status, sync_status, last_sync_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [conn.id, entryId, uid, result.href, meta.calendar_url || conn.instance_url || null,
         entry.title, entry.due_date + 'T09:00:00Z', addCalDays(entry.due_date, 1) + 'T09:00:00Z',
         'confirmed', 'synced']
      );
    }

    res.json({
      provider:  conn.provider,
      entry_id:  entryId,
      uid,
      href:      result.href,
      demo:      !!result.demo,
      synced:    true,
    });
  } catch (e) {
    logger.error('[caldav/push]', e.message);
    res.status(500).json({ error: 'Calendar push failed.', detail: e.message });
  }
});

// POST /api/integrations/caldav/push/matter/:matterId — push all pending deadlines
router.post('/push/matter/:matterId', authRequired, calLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);

    const conn = await db.get(
      "SELECT id, firm_id, provider, status, config_json FROM integration_connections WHERE firm_id=? AND provider IN ('caldav','google_calendar','outlook') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active calendar connection.');

    const result = await syncCalendar({ db, conn, ctx, entity_type: 'event', direction: 'push', matter_id: matterId, user: req.user });
    res.json({ provider: conn.provider, matter_id: matterId, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Bulk calendar push failed.' });
  }
});

// DELETE /api/integrations/caldav/events/:uid — delete calendar event
router.delete('/events/:uid', authRequired, calLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    const uid = sanitizeStr(req.params.uid, 100);

    const evt = await db.get('SELECT id, matter_id, entry_id, external_uid, push_status, pushed_at FROM calendar_push_events WHERE external_uid=?', [uid]);
    if (!evt) return err404(res, 'Calendar event not found.');

    const conn = await db.get('SELECT id, firm_id, provider, status, external_id, config_json FROM integration_connections WHERE id=?', [evt.connection_id]);
    if (!conn || conn.firm_id !== ctx?.firm_id) return err403(res);

    if (evt.external_href) {
      await caldavDelete(conn, evt.external_href);
    }

    await db.run("UPDATE calendar_push_events SET sync_status='deleted', last_sync_at=datetime('now') WHERE id=?", [evt.id]);

    res.json({ ok: true, uid, deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete calendar event.' });
  }
});

// GET /api/integrations/caldav/events — list all pushed events
router.get('/events', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const events = await db.all(
      `SELECT cpe.*, de.title AS docket_title, de.due_date, de.priority,
              ic.provider
       FROM calendar_push_events cpe
       LEFT JOIN docket_entries de ON de.id = cpe.docket_entry_id
       LEFT JOIN integration_connections ic ON ic.id = cpe.connection_id
       WHERE ic.firm_id=?
       ORDER BY cpe.dtstart ASC`,
      [ctx?.firm_id]
    ).catch(() => []);

    res.json({ events, count: events.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load calendar events.' });
  }
});

// GET /api/integrations/caldav/ical/:firmId — generate ICS feed (for URL subscription)
// This endpoint is intentionally unauthenticated — the firmId + secret in URL is the auth
router.get('/ical/:firmId', async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = safeInt(req.params.firmId);

    // The ?token param is a HMAC-SHA256 of firm_id with webhook_secret or JWT_SECRET
    const token  = sanitizeStr(req.query.token || '', 100);
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const expected = createHmac('sha256', secret).update(String(firmId)).digest('hex').slice(0, 32);

    if (token !== expected && process.env.NODE_ENV === 'production') {
      return res.status(403).send('Invalid token');
    }

    const entries = await db.all(
      "SELECT id, matter_id, firm_id, description, filing_type, due_date FROM docket_entries WHERE firm_id=? AND status='pending' ORDER BY due_date ASC LIMIT 200",
      [firmId]
    ).catch(() => []);

    const firm = await db.get('SELECT name FROM firms WHERE id=?', [firmId]).catch(() => null);
    const now  = new Date().toISOString();

    const vevents = entries.map(entry => {
      const uid = generateUID(firmId, entry.id);
      return buildVEvent(entry, uid, now);
    });

    const ical = buildVCalendar(
      vevents,
      `-//Justice Gavel//Firm ${firmId}//EN`,
      `${firm?.name || 'Firm'} Legal Deadlines`
    );

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deadlines-firm-${firmId}.ics"`);
    res.send(ical);
  } catch (e) {
    res.status(500).send('Could not generate ICS feed.');
  }
});

// GET /api/integrations/caldav/ical-token/:firmId — get the ICS feed token (authenticated)
router.get('/ical-token/:firmId', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (ctx.firm_id !== firmId) return err403(res);

    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const token  = createHmac('sha256', secret).update(String(firmId)).digest('hex').slice(0, 32);
    const baseUrl = process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app';

    res.json({
      token,
      ics_url:      `${baseUrl}/api/integrations/caldav/ical/${firmId}?token=${token}`,
      instructions: 'Subscribe to this URL in Apple Calendar, Google Calendar, or Outlook to receive all firm deadlines.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not generate ICS token.' });
  }
});

export default router;
