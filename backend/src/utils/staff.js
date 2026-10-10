/**
 * utils/staff.js — server-side staff / admin check.
 *
 * The role claim inside a JWT can be up to 30 days old, so anything that edits
 * shared records (arrest takedowns, dispositions, admin indexing) re-reads the
 * user's role from the database. Fails closed: no row or a DB error → not staff.
 */
export const STAFF_ROLES = Object.freeze(['admin', 'super_admin', 'staff']);

export async function isStaff(db, user) {
  if (!user?.id) return false;
  try {
    const row = await db.get('SELECT role, is_admin FROM users WHERE id = ?', [user.id]);
    if (!row) return false;
    return STAFF_ROLES.includes(String(row.role || '')) || Number(row.is_admin) === 1;
  } catch {
    return false;
  }
}

/** Express middleware: 403 unless the signed-in user is staff (use after authRequired). */
export function requireStaff(getDb) {
  return async (req, res, next) => {
    const db = await getDb();
    if (await isStaff(db, req.user)) return next();
    return res.status(403).json({ error: 'Staff access required.', code: 'forbidden' });
  };
}
