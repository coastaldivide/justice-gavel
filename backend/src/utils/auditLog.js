import { getDb } from '../db/index.js';
import logger    from './logger.js';

export async function auditLog({ userId, action, entityType, entityId, meta = {}, req }) {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO audit_log
         (user_id, action, entity_type, entity_id, ip_address, user_agent, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [ userId || null, String(action).slice(0, 100), entityType || null,
        entityId || null, req?.ip || null,
        String(req?.headers?.['user-agent'] || '').slice(0, 200),
        JSON.stringify(meta) ]
    );
  } catch (err) { logger.error('[audit] write failed:', err?.message); }
}
