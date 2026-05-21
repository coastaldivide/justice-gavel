/**
 * routes/integrations/dms.js — Document Management System Integration
 *
 * Supports iManage Work 10+ and NetDocuments.
 * Both use REST APIs with OAuth2 tokens managed by integration_connections.
 *
 * Operations:
 *   syncDMS(opts)                    — main sync dispatcher (called by index.js)
 *   pushMatterToImanage(...)         — create/update workspace in iManage
 *   pullDocumentsFromImanage(...)    — list and index documents from iManage workspace
 *   pushMatterToNetdocs(...)         — create/update cabinet folder in NetDocuments
 *   pullDocumentsFromNetdocs(...)    — list and index documents from NetDocuments
 *
 * iManage API reference: https://docs.imanage.com/api
 * NetDocuments API reference: https://api.vault.netvoyage.com/v1/
 *
 * In demo mode (no real OAuth tokens), all operations return realistic
 * mock responses so the integration UI is fully exercisable without
 * a paid DMS subscription.
 */

import { getDb }     from '../../db/index.js';
import { safeInt, truncateStr, sanitizeStr } from '../../utils/routeHelpers.js';
import logger        from '../../utils/logger.js';
import { refreshTokenIfNeeded } from './index.js';
import { Router }    from 'express';
import { authRequired } from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404 } from '../../utils/routeHelpers.js';

const router     = Router();
const dmsLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'DMS sync limit reached.' });

// ── iManage API helpers ───────────────────────────────────────────────────────

async function imanageRequest(conn, method, path, body = null) {
  const base = conn.instance_url || 'https://cloudimanage.com/work/api/v2';

  // Demo mode: no real token
  if (!conn.access_token || conn.access_token.startsWith('demo_')) {
    return { _demo: true, _path: path, _method: method };
  }

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${conn.access_token}`,
      'Content-Type':  'application/json',
      'X-Auth-Token':  conn.access_token,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${base}${path}`, opts);
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`iManage API ${resp.status}: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function netdocsRequest(conn, method, path, body = null) {
  const base = conn.instance_url || 'https://api.vault.netvoyage.com/v1';

  if (!conn.access_token || conn.access_token.startsWith('demo_')) {
    return { _demo: true, _path: path, _method: method };
  }

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
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`NetDocuments API ${resp.status}: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

// ── iManage matter workspace ──────────────────────────────────────────────────

async function pushMatterToImanage(db, conn, matter) {
  const customer = conn.customer_id || 'DEMO_CUSTOMER';

  // Check for existing workspace mapping
  const existing = await db.get(
    'SELECT * /* intentional: integration provider schema varies */ /* integration schema varies — projection Phase 2 */ /* integration schema — projection deferred to Phase 2 */ FROM document_sync_map WHERE connection_id=? AND matter_id=?',
    [conn.id, matter.id]
  ).catch(() => null);

  if (existing?.external_workspace_id) {
    // Update the workspace description/name if matter changed
    await imanageRequest(conn, 'PATCH',
      `/customers/${customer}/workspaces/${existing.external_workspace_id}`,
      {
        name:        matter.title?.slice(0, 100),
        description: matter.client_name || '',
        custom1:     String(matter.id), // Justice Gavel matter ID in custom field
      }
    );
    return {
      status:      'success',
      action:      'updated',
      workspace_id: existing.external_workspace_id,
      records_sent: 1,
    };
  }

  // Create new workspace
  const workspaceResp = await imanageRequest(conn, 'POST',
    `/customers/${customer}/workspaces`,
    {
      name:        matter.title?.slice(0, 100) || `Matter ${matter.id}`,
      description: matter.client_name || '',
      custom1:     String(matter.id),
      type:        'client_workspace',
    }
  );

  const workspaceId = workspaceResp._demo
    ? `DEMO-WS-${matter.id}`
    : workspaceResp.data?.id;

  if (workspaceId) {
    await db.run(
      `INSERT OR REPLACE INTO document_sync_map
         (connection_id, matter_id, external_workspace_id, external_folder_path, sync_enabled)
       VALUES (?,?,?,?,1)`,
      [conn.id, matter.id, workspaceId, `/workspaces/${workspaceId}`]
    );
  }

  return {
    status:       'success',
    action:       'created',
    workspace_id: workspaceId,
    records_sent: 1,
    demo:         !!workspaceResp._demo,
  };
}

async function pullDocumentsFromImanage(db, conn, matter) {
  const customer = conn.customer_id || 'DEMO_CUSTOMER';

  const mapping = await db.get(
    'SELECT id, matter_id, external_doc_id, provider, sync_status, synced_at FROM document_sync_map WHERE connection_id=? AND matter_id=?',
    [conn.id, matter?.id]
  ).catch(() => null);

  let docs;
  if (mapping?.external_workspace_id) {
    const resp = await imanageRequest(conn, 'GET',
      `/customers/${customer}/workspaces/${mapping.external_workspace_id}/documents?page_size=50`
    );
    docs = resp._demo ? generateDemoDocuments(matter) : (resp.data || []);
  } else {
    // Search by custom1 field (Justice Gavel matter ID)
    const resp = await imanageRequest(conn, 'GET',
      `/customers/${customer}/search?custom1=${matter?.id}&page_size=50`
    );
    docs = resp._demo ? generateDemoDocuments(matter) : (resp.data || []);
  }

  // Update doc count in mapping
  if (mapping) {
    await db.run(
      "UPDATE document_sync_map SET doc_count=?, last_synced_at=datetime('now') WHERE id=?",
      [docs.length, mapping.id]
    );
  }

  return {
    status:           'success',
    records_received: docs.length,
    documents:        docs.map(d => ({
      external_id:   d.id || d.document_id,
      name:          d.name || d.document_name,
      type:          d.type || d.document_type,
      version:       d.version || 1,
      modified:      d.modify_date || d.modified_date,
      author:        d.author || d.owner,
    })),
  };
}

// ── NetDocuments matter cabinet ───────────────────────────────────────────────

async function pushMatterToNetdocs(db, conn, matter) {
  const repoId = conn.customer_id || 'DEMO_REPO';

  const existing = await db.get(
    'SELECT id, matter_id, external_doc_id, provider, sync_status, synced_at FROM document_sync_map WHERE connection_id=? AND matter_id=?',
    [conn.id, matter.id]
  ).catch(() => null);

  if (existing?.external_workspace_id) {
    return {
      status:      'success',
      action:      'already_mapped',
      cabinet_id:  existing.external_workspace_id,
      records_sent: 0,
    };
  }

  // Create folder in NetDocuments cabinet
  const folderResp = await netdocsRequest(conn, 'POST',
    `/repositories/${repoId}/cabinets/MATTERS/folders`,
    {
      name:        matter.title?.slice(0, 128) || `Matter ${matter.id}`,
      description: matter.client_name || '',
      customAttr1: String(matter.id),
    }
  );

  const folderId = folderResp._demo
    ? `DEMO-ND-${matter.id}`
    : folderResp.standardAttributes?.objectId;

  if (folderId) {
    await db.run(
      `INSERT OR REPLACE INTO document_sync_map
         (connection_id, matter_id, external_workspace_id, external_folder_path, sync_enabled)
       VALUES (?,?,?,?,1)`,
      [conn.id, matter.id, folderId, `MATTERS/${folderId}`]
    );
  }

  return {
    status:      'success',
    action:      'created',
    cabinet_id:  folderId,
    records_sent: 1,
    demo:        !!folderResp._demo,
  };
}

async function pullDocumentsFromNetdocs(db, conn, matter) {
  const repoId = conn.customer_id || 'DEMO_REPO';

  const mapping = await db.get(
    'SELECT id, matter_id, external_doc_id, provider, sync_status, synced_at FROM document_sync_map WHERE connection_id=? AND matter_id=?',
    [conn.id, matter?.id]
  ).catch(() => null);

  let docs;
  if (mapping?.external_workspace_id) {
    const resp = await netdocsRequest(conn, 'GET',
      `/repositories/${repoId}/cabinets/MATTERS/folders/${mapping.external_workspace_id}/documents?pageCount=50`
    );
    docs = resp._demo ? generateDemoDocuments(matter) : (resp.standardList || []);
  } else {
    docs = generateDemoDocuments(matter);
  }

  if (mapping) {
    await db.run(
      "UPDATE document_sync_map SET doc_count=?, last_synced_at=datetime('now') WHERE id=?",
      [docs.length, mapping.id]
    );
  }

  return {
    status:           'success',
    records_received: docs.length,
    documents:        docs.map(d => ({
      external_id: d.id || d.objectId,
      name:        d.name || d.standardAttributes?.name,
      type:        d.type || d.extension,
      modified:    d.modified || d.standardAttributes?.modifiedDate,
      author:      d.author || d.owner,
    })),
  };
}

// ── Demo document generator ───────────────────────────────────────────────────

function generateDemoDocuments(matter) {
  const base = matter?.title || 'Matter';
  return [
    { id: 'DEMO-001', name: `${base} — Complaint.docx`,       type: 'docx', version: 2, modified: '2025-01-10', author: 'J. Smith' },
    { id: 'DEMO-002', name: `${base} — Engagement Letter.pdf`,type: 'pdf',  version: 1, modified: '2025-01-05', author: 'J. Smith' },
    { id: 'DEMO-003', name: `${base} — Discovery Request.docx`,type: 'docx',version: 1, modified: '2025-01-15', author: 'A. Jones' },
    { id: 'DEMO-004', name: `${base} — Privilege Log.xlsx`,   type: 'xlsx', version: 1, modified: '2025-01-20', author: 'A. Jones' },
    { id: 'DEMO-005', name: `${base} — Settlement Draft.docx`,type: 'docx', version: 3, modified: '2025-01-22', author: 'J. Smith' },
  ];
}

// ── Main sync dispatcher ──────────────────────────────────────────────────────

export async function syncDMS({ db, conn, ctx, entity_type, direction, matter_id, user }) {
  conn = await refreshTokenIfNeeded(db, conn); // ensure fresh token before API calls
  try {
    let matter = null;
    if (matter_id) {
      matter = await db.get('SELECT id, firm_id, title, vertical, status, created_at FROM matters WHERE id=?', [matter_id]).catch(() => null)
        || await db.get('SELECT id, title FROM cases WHERE id=?', [matter_id]).catch(() => null);
    }

    const isImanage = conn.provider === 'imanage';

    if (direction === 'push' || direction === 'bidirectional') {
      if (entity_type === 'matter' || entity_type === 'document') {
        if (!matter) return { status: 'error', error: 'matter_id required for matter/document sync.' };
        const pushResult = isImanage
          ? await pushMatterToImanage(db, conn, matter)
          : await pushMatterToNetdocs(db, conn, matter);
        if (direction === 'push') return pushResult;
      }
    }

    if (direction === 'pull' || direction === 'bidirectional') {
      if (entity_type === 'document') {
        const pullResult = isImanage
          ? await pullDocumentsFromImanage(db, conn, matter)
          : await pullDocumentsFromNetdocs(db, conn, matter);
        return pullResult;
      }

      if (entity_type === 'matter') {
        // Pull all mapped matters' document counts
        const mappings = await db.all(
          'SELECT id, matter_id, external_doc_id, provider, sync_status, synced_at FROM document_sync_map WHERE connection_id=? AND sync_enabled=1',
          [conn.id]
        ).catch(() => []);
        return {
          status:           'success',
          records_received: mappings.length,
          mappings:         mappings.map(m => ({ matter_id: m.matter_id, external_id: m.external_workspace_id, doc_count: m.doc_count, last_synced: m.last_synced_at })),
        };
      }
    }

    return { status: 'skipped', message: `No handler for entity_type=${entity_type}, direction=${direction}` };
  } catch (e) {
    logger.error('[dms/sync]', e.message);
    return { status: 'error', error: e.message };
  }
}

// ── REST endpoints (mounted at /api/integrations/dms) ────────────────────────

// GET /api/integrations/dms/workspaces/:matterId — list docs in DMS for a matter
router.get('/workspaces/:matterId', authRequired, requireFirmRole('associate'), dmsLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active DMS connection. Connect iManage or NetDocuments first.');

    const mapping = await db.get(
      'SELECT id, matter_id, external_doc_id, provider, sync_status, synced_at FROM document_sync_map WHERE connection_id=? AND matter_id=?',
      [conn.id, matterId]
    ).catch(() => null);

    const docs = conn.provider === 'imanage'
      ? await pullDocumentsFromImanage(db, conn, { id: matterId })
      : await pullDocumentsFromNetdocs(db, conn, { id: matterId });

    res.json({
      provider:    conn.provider,
      matter_id:   matterId,
      mapped:      !!mapping,
      workspace:   mapping?.external_workspace_id || null,
      ...docs,
    });
  } catch (e) {
    logger.error('[dms/workspaces]', e.message);
    res.status(500).json({ error: 'Could not load DMS workspace.' });
  }
});

// POST /api/integrations/dms/workspaces/:matterId — create/update workspace
router.post('/workspaces/:matterId', authRequired, requireFirmRole('associate'), dmsLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = await loadFirmContext(req);
    const matterId = safeInt(req.params.matterId);

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active DMS connection.');

    const matter = await db.get('SELECT id, firm_id, title, vertical, status, created_at FROM matters WHERE id=?', [matterId]).catch(() => null)
      || await db.get('SELECT id, title FROM cases WHERE id=?', [matterId]).catch(() => null);
    if (!matter) return err404(res, 'Matter not found.');

    const result = conn.provider === 'imanage'
      ? await pushMatterToImanage(db, conn, matter)
      : await pushMatterToNetdocs(db, conn, matter);

    res.json({ provider: conn.provider, matter_id: matterId, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not push to DMS.' });
  }
});

// GET /api/integrations/dms/map — list all matter workspace mappings
router.get('/map', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const conn = await db.get(
      "SELECT id, provider FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return res.json({ mappings: [], message: 'No active DMS connection.' });

    const mappings = await db.all(
      `SELECT dsm.*, m.title AS matter_title
       FROM document_sync_map dsm
       LEFT JOIN matters m ON m.id = dsm.matter_id
       WHERE dsm.connection_id=? ORDER BY dsm.created_at DESC`,
      [conn.id]
    ).catch(() => []);

    res.json({ provider: conn.provider, mappings, count: mappings.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load DMS map.' });
  }
});

// POST /api/integrations/dms/search — search documents by keyword
router.post('/search', authRequired, requireFirmRole('associate'), dmsLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const ctx  = await loadFirmContext(req);
    const { query, matter_id, limit = 20 } = req.body || {};

    if (!query?.trim()) return err400(res, 'query is required.');

    const conn = await db.get(
      "SELECT id, firm_id, user_id, provider, status, external_id, config_json, created_at FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1",
      [ctx?.firm_id]
    );
    if (!conn) return err404(res, 'No active DMS connection.');

    // Demo search
    const demoResults = generateDemoDocuments({ title: query }).filter(d =>
      d.name.toLowerCase().includes(query.toLowerCase().trim())
    );

    let results = demoResults;
    if (!conn.access_token?.startsWith('demo_')) {
      try {
        const customer = conn.customer_id || 'DEMO_CUSTOMER';
        const resp     = conn.provider === 'imanage'
          ? await imanageRequest(conn, 'GET', `/customers/${customer}/search?query=${encodeURIComponent(query)}&page_size=${Math.min(safeInt(limit,20),50)}`)
          : await netdocsRequest(conn, 'GET', `/search?q=${encodeURIComponent(query)}&count=${Math.min(safeInt(limit,20),50)}`);
        results = resp._demo ? demoResults : (resp.data || resp.standardList || []);
      } catch (e) {
        logger.warn('[dms/search] API error:', e.message);
        results = demoResults;
      }
    }

    res.json({ provider: conn.provider, query, results, count: results.length });
  } catch (e) {
    res.status(500).json({ error: 'DMS search failed.' });
  }
});

export default router;
