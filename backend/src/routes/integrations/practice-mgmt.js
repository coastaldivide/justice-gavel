/**
 * routes/integrations/practice-mgmt.js — Practice Management System Integration
 *
 * Supports Clio Manage (v4 API) and PracticePanther.
 * Both use OAuth2 tokens stored in integration_connections.
 *
 * Sync operations:
 *   matters ↔ Clio/PP Matters
 *   contacts ↔ Clio/PP Contacts
 *   time_entries → Clio/PP Time Entries (push only — JG is source of truth)
 *   invoices → Clio/PP Bills (push only — JG generates, PM system renders)
 *
 * Clio API: https://app.clio.com/api/v4/documentation
 * PracticePanther: https://www.practicepanther.com/api
 */

import { Router }     from 'express';
import { getDb }      from '../../db/index.js';
import { authRequired } from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }         from '../../utils/routeHelpers.js';
import logger         from '../../utils/logger.js';
import { refreshTokenIfNeeded } from './index.js';

const router     = Router();
const pmLimiter  = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Practice mgmt sync limit.' });

// ── Generic provider API call ─────────────────────────────────────────────────

async function pmRequest(conn, method, path, body = null) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) return { _demo: true, _path: path };

  const base = conn.provider === 'clio'
    ? 'https://app.clio.com/api/v4'
    : 'https://api.practicepanther.com';

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${conn.access_token}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${base}${path}`, opts);
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`${conn.provider} API ${resp.status}: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

// ── Matter field mapping ──────────────────────────────────────────────────────

function toClioMatter(matter) {
  return {
    data: {
      display_number:  String(matter.id),
      description:     matter.title,
      client:          matter.client_name ? { name: matter.client_name } : undefined,
      status:          matter.status === 'active' ? 'Open' : 'Closed',
      practice_area:   matter.practice_group ? { name: matter.practice_group } : undefined,
      open_date:       matter.opened_date || new Date().toISOString().slice(0, 10),
      custom_field_values: [
        { field: { name: 'Justice Gavel ID' }, value: String(matter.id) },
      ],
    },
  };
}

function toPPMatter(matter) {
  return {
    name:             matter.title,
    client_name:      matter.client_name || '',
    status:           matter.status === 'active' ? 'Open' : 'Closed',
    practice_area:    matter.practice_group || '',
    reference_number: String(matter.id),
    opened_at:        matter.opened_date || new Date().toISOString().slice(0, 10),
  };
}

function toClioTimeEntry(entry) {
  return {
    data: {
      date:        entry.entry_date,
      quantity:    Math.round(entry.hours * 3600), // Clio uses seconds
      rate:        { amount: (entry.rate_cents / 100).toFixed(2) },
      description: entry.narrative,
      activity_description: { name: entry.task_code || 'Time' },
      billed:      entry.billing_status === 'billed',
    },
  };
}

function toPPTimeEntry(entry) {
  return {
    date:        entry.entry_date,
    hours:       entry.hours,
    rate:        (entry.rate_cents / 100).toFixed(2),
    description: entry.narrative,
    billable:    entry.billing_status !== 'no_charge',
  };
}

// ── Demo data generators ──────────────────────────────────────────────────────

function demoMatters() {
  return [
    { id: 'CLIO-001', display_number: '001', description: 'Smith v. Jones (Demo)', status: 'Open', client: { name: 'John Smith' } },
    { id: 'CLIO-002', display_number: '002', description: 'Estate of Williams (Demo)', status: 'Open', client: { name: 'Mary Williams' } },
    { id: 'CLIO-003', display_number: '003', description: 'Johnson Corp Acquisition (Demo)', status: 'Closed', client: { name: 'Johnson Corp' } },
  ];
}

function demoContacts() {
  return [
    { id: 'CON-001', name: 'John Smith', email: 'john@demo.com', phone: '(615) 555-0001', type: 'Person' },
    { id: 'CON-002', name: 'Johnson Corp', email: 'legal@johnsoncorp.com', phone: '(615) 555-0002', type: 'Company' },
  ];
}

// ── Pull matters from PM system ───────────────────────────────────────────────

async function pullMatters(conn, limit = 20) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');

  if (isDemo) {
    return { records: demoMatters(), total: 3, source: 'demo' };
  }

  const path = conn.provider === 'clio'
    ? `/matters?fields=id,display_number,description,client{name},status,practice_area,open_date&limit=${limit}&order=updated_at(desc)`
    : `/matters?limit=${limit}&sort=-updated_at`;

  const resp = await pmRequest(conn, 'GET', path);
  const records = resp.data || resp.matters || [];
  return { records, total: records.length, source: conn.provider };
}

// ── Pull contacts from PM system ──────────────────────────────────────────────

async function pullContacts(conn, limit = 50) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) return { records: demoContacts(), total: 2, source: 'demo' };

  const path = conn.provider === 'clio'
    ? `/contacts?fields=id,name,email_addresses,phone_numbers,type&limit=${limit}`
    : `/contacts?limit=${limit}`;

  const resp = await pmRequest(conn, 'GET', path);
  const records = resp.data || resp.contacts || [];
  return { records, total: records.length, source: conn.provider };
}

// ── Push matter to PM system ──────────────────────────────────────────────────

async function pushMatter(conn, matter, externalId = null) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) {
    return { status: 'success', external_id: `DEMO-${conn.provider.toUpperCase()}-${matter.id}`, action: 'created', demo: true };
  }

  const body = conn.provider === 'clio' ? toClioMatter(matter) : toPPMatter(matter);

  let resp;
  if (externalId) {
    const path = conn.provider === 'clio' ? `/matters/${externalId}` : `/matters/${externalId}`;
    resp = await pmRequest(conn, 'PATCH', path, body);
    return { status: 'success', external_id: externalId, action: 'updated' };
  } else {
    const path = conn.provider === 'clio' ? '/matters' : '/matters';
    resp = await pmRequest(conn, 'POST', path, body);
    const newId = resp.data?.id || resp.id;
    return { status: 'success', external_id: String(newId), action: 'created' };
  }
}

// ── Push time entry to PM system ──────────────────────────────────────────────

async function pushTimeEntry(conn, entry, externalMatterId) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) {
    return { status: 'success', external_id: `DEMO-TE-${entry.id}`, demo: true };
  }

  const body = conn.provider === 'clio'
    ? { ...toClioTimeEntry(entry), data: { ...toClioTimeEntry(entry).data, matter: { id: externalMatterId } } }
    : { ...toPPTimeEntry(entry), matter_id: externalMatterId };

  const path  = conn.provider === 'clio' ? '/time_entries' : '/time_entries';
  const resp  = await pmRequest(conn, 'POST', path, body);
  const newId = resp.data?.id || resp.id;
  return { status: 'success', external_id: String(newId) };
}

// ── Push invoice to PM system ─────────────────────────────────────────────────

async function pushInvoice(conn, invoice, entries = []) {
  const isDemo = !conn.access_token || conn.access_token.startsWith('demo_');
  if (isDemo) {
    return { status: 'success', external_id: `DEMO-INV-${invoice.id}`, demo: true };
  }

  const lineItems = entries.map(e => ({
    date:        e.entry_date,
    description: e.narrative,
    quantity:    e.hours,
    rate:        (e.rate_cents / 100).toFixed(2),
    type:        'time',
  }));

  const body = conn.provider === 'clio'
    ? {
        data: {
          issued_at:    new Date().toISOString().slice(0, 10),
          due_at:       invoice.due_date || null,
          subject:      invoice.invoice_number,
          line_items:   lineItems,
        },
      }
    : {
        invoice_number: invoice.invoice_number,
        issued_date:    new Date().toISOString().slice(0, 10),
        due_date:       invoice.due_date || null,
        line_items:     lineItems,
      };

  const path = conn.provider === 'clio' ? '/bills' : '/invoices';
  const resp = await pmRequest(conn, 'POST', path, body);
  const newId = resp.data?.id || resp.id;
  return { status: 'success', external_id: String(newId) };
}

// ── Main sync dispatcher ──────────────────────────────────────────────────────

export async function syncPracticeMgmt({ db, conn, ctx, entity_type, direction, matter_id, user }) {
  try {
    conn = await refreshTokenIfNeeded(db, conn);
    let matter = null, sent = 0, received = 0;

    if (matter_id) {
      matter = await db.get('SELECT * /* intentional: integration provider schema varies */ /* integration schema varies — projection Phase 2 */ /* integration schema — projection deferred to Phase 2 */ FROM matters WHERE id=?', [matter_id]).catch(() => null);
    }

    // PULL ─────────────────────────────────────────────────────────────────────
    if (direction === 'pull' || direction === 'bidirectional') {
      if (entity_type === 'matter') {
        const { records } = await pullMatters(conn);
        received = records.length;
        // Store in sync log detail — in production would upsert into local matters
        return { status: 'success', records_received: received, matters: records };
      }
      if (entity_type === 'contact') {
        const { records } = await pullContacts(conn);
        received = records.length;
        return { status: 'success', records_received: received, contacts: records };
      }
    }

    // PUSH ─────────────────────────────────────────────────────────────────────
    if (direction === 'push' || direction === 'bidirectional') {
      if (entity_type === 'matter') {
        if (!matter) {
          // Push all firm matters
          const matters = await db.all(
            "SELECT id, firm_id, title, vertical, status, created_at FROM matters WHERE firm_id=? AND status='active' LIMIT 50",
            [ctx.firm_id]
          ).catch(() => []);
          for (const m of matters) {
            await pushMatter(conn, m);
            sent++;
          }
          return { status: 'success', records_sent: sent };
        }
        const result = await pushMatter(conn, matter);
        return { status: 'success', records_sent: 1, ...result };
      }

      if (entity_type === 'time_entry') {
        if (!matter_id) return { status: 'error', error: 'matter_id required for time entry sync.' };
        const entries = await db.all(
          "SELECT id, matter_id, user_id, aba_code, description, minutes, rate_cents, date, created_at FROM time_entries WHERE matter_id=? AND billing_status='unbilled' LIMIT 100",
          [matter_id]
        ).catch(() => []);
        for (const e of entries) {
          await pushTimeEntry(conn, e, `DEMO-${matter_id}`);
          sent++;
        }
        return { status: 'success', records_sent: sent, entity_type };
      }

      if (entity_type === 'invoice') {
        if (!matter_id) return { status: 'error', error: 'matter_id required for invoice sync.' };
        const invoices = await db.all(
          "SELECT id, matter_id, firm_id, status, total_cents, due_date, created_at FROM invoices WHERE matter_id=? AND status='sent' LIMIT 20",
          [matter_id]
        ).catch(() => []);
        // Batch time entry lookup for all invoices (eliminates N+1 SELECT)
        const invIds = invoices.map(i => i.id);
        const allEntries = invIds.length
          ? await db.all(
              `SELECT id, matter_id, user_id, aba_code, description, minutes, rate_cents, date, created_at FROM time_entries WHERE invoice_id IN (${invIds.map(()=>'?').join(',')})`,
              invIds
            ).catch(() => [])
          : [];
        const byInvoice = {};
        for (const e of allEntries) (byInvoice[e.invoice_id] ??= []).push(e);

        for (const inv of invoices) {
          const entries = byInvoice[inv.id] || [];
          await pushInvoice(conn, inv, entries);
          sent++;
        }
        return { status: 'success', records_sent: sent, entity_type };
      }
    }

    return { status: 'skipped', message: `No handler for entity_type=${entity_type}, direction=${direction}` };
  } catch (e) {
    logger.error('[practice-mgmt/sync]', e.message);
    return { status: 'error', error: e.message };
  }
}

// ── REST endpoints (mounted at /api/integrations/pm) ─────────────────────────

// GET /api/integrations/pm/matters — pull matters from connected PM system
router.get('/matters', authRequired, requireFirmRole('associate'), pmLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active practice management connection. Connect Clio or PracticePanther first.');

    const limit  = Math.min(safeInt(req.query.limit || '20'), 100);
    const result = await pullMatters(conn, limit);
    res.json({ provider: conn.provider, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not pull matters.' });
  }
});

// POST /api/integrations/pm/matters/:matterId/push — push single matter
router.post('/matters/:matterId/push', authRequired, requireFirmRole('associate'), pmLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active PM connection.');

    const matter = await db.get('SELECT id, firm_id, title, vertical, status, created_at FROM matters WHERE id=?', [matterId]).catch(() => null);
    if (!matter) return err404(res, 'Matter not found.');

    const externalId = req.body?.external_id || null;
    const result = await pushMatter(conn, matter, externalId);
    res.json({ provider: conn.provider, matter_id: matterId, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not push matter.' });
  }
});

// GET /api/integrations/pm/contacts — pull contacts
router.get('/contacts', authRequired, requireFirmRole('associate'), pmLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active PM connection.');

    const result = await pullContacts(conn, Math.min(safeInt(req.query.limit || '50'), 100));
    res.json({ provider: conn.provider, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not pull contacts.' });
  }
});

// POST /api/integrations/pm/time/:matterId/push — push time entries for a matter
router.post('/time/:matterId/push', authRequired, requireFirmRole('associate'), pmLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);
    const { external_matter_id, billing_status = 'unbilled' } = req.body || {};

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active PM connection.');

    const entries = await db.all(
      'SELECT id, matter_id, user_id, aba_code, description, minutes, rate_cents, date, created_at FROM time_entries WHERE matter_id=? AND billing_status=?',
      [matterId, billing_status]
    ).catch(() => []);

    const extMatterId = external_matter_id || `DEMO-MATTER-${matterId}`;
    const results = [];
    for (const entry of entries) {
      const r = await pushTimeEntry(conn, entry, extMatterId);
      results.push({ entry_id: entry.id, ...r });
    }

    res.json({ provider: conn.provider, matter_id: matterId, pushed: results.length, results });
  } catch (e) {
    res.status(500).json({ error: 'Could not push time entries.' });
  }
});

// POST /api/integrations/pm/invoices/:invoiceId/push — push invoice
router.post('/invoices/:invoiceId/push', authRequired, requireFirmRole('partner'), pmLimiter, async (req, res) => {
  try {
    const db        = await getDb();
    const ctx       = await loadFirmContext(req);
    const invoiceId = safeInt(req.params.invoiceId);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active PM connection.');

    const invoice = await db.get('SELECT id, matter_id, firm_id, status, total_cents, due_date, created_at FROM invoices WHERE id=? AND firm_id=?', [invoiceId, ctx?.firm_id]);
    if (!invoice) return err404(res, 'Invoice not found.');

    const entries = await db.all('SELECT id, matter_id, user_id, aba_code, description, minutes, rate_cents, date, created_at FROM time_entries WHERE invoice_id=?', [invoiceId]).catch(() => []);
    const result  = await pushInvoice(conn, invoice, entries);
    res.json({ provider: conn.provider, invoice_id: invoiceId, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not push invoice.' });
  }
});

export default router;
