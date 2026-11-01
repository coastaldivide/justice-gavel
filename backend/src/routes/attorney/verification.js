/**
 * attorney/verification.js — an attorney submits a bar number for review.
 *
 *   POST /api/attorney/verify-bar { bar_number, state }
 *
 * The bar number is stored on the attorney's own account as pending; the badge
 * is granted only by an admin who checked it on the state bar's official site
 * (GET/POST /api/admin/queue/bar — routes/admin/queue.js). Submitting a
 * different number after verification removes the badge until it is checked
 * again. The directory listing (lawyers) is never written.
 *
 * IMPORTANT: The verified badge MUST NOT be granted automatically. People facing
 * criminal charges rely on it to assess an attorney; an automated grant would be
 * deceptive.
 */
import { escapeHtml, safeUrl } from '../../utils/html.js';
import { Router }       from 'express';
import { authRequired, invalidateUserCache } from '../../middleware/auth.js';
import logger           from '../../utils/logger.js';
import { STATE_BAR_LOOKUP, requireAttorney } from './_helpers.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { normalizeState } from '../../services/rightsContent.js';
import { audit } from '../../utils/audit.js';

const routeLimiter = makeUserLimiter({ windowMs: 60_000, max: 10 });
const router = Router();

router.post('/verify-bar', authRequired, routeLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { bar_number, state } = req.body || {};
    const st = normalizeState(state);
    if (!st) return res.status(400).json({ error: msg(lang, 'attorney.err.bar_state'), code: 'bad_state' });
    const cleanBar = String(bar_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (cleanBar.length < 3 || cleanBar.length > 20) {
      return res.status(400).json({ error: msg(lang, 'attorney.err.bar_format'), code: 'bad_bar_number' });
    }
    const { db, user } = ctx;
    const current = await db.get('SELECT bar_number, bar_state, bar_verified, pending_bar_verification FROM users WHERE id = ?', [req.user.id]);
    if (Number(current?.bar_verified) === 1 && current.bar_number === cleanBar && current.bar_state === st) {
      return res.json({ ok: true, status: 'already_verified', message: msg(lang, 'attorney.msg.bar_already_verified') });
    }
    if (Number(current?.pending_bar_verification) === 1 && current.bar_number === cleanBar && current.bar_state === st) {
      return res.json({ ok: true, status: 'pending_review', message: msg(lang, 'attorney.msg.bar_pending'), bar_number: cleanBar, state: st });
    }
    await db.run(
      `UPDATE users SET bar_number = ?, bar_state = ?, pending_bar_verification = 1, bar_verified = 0,
              bar_submitted_at = NOW(), bar_rejection_reason = NULL
        WHERE id = ?`, [cleanBar, st, req.user.id]);
    invalidateUserCache(req.user.id);   // the badge is gone now, not after the 60 s principal cache
    await audit('attorney.bar_submitted', { userId: req.user.id, req, entityType: 'user', entityId: req.user.id, metadata: { state: st, was_verified: Number(current?.bar_verified) === 1 } });

    const lookupUrl = STATE_BAR_LOOKUP[st] || 'https://www.americanbar.org/groups/legal_services/flh-home/';
    const { sendEmail } = await import('../../services/email.js');
    await sendEmail({
      to: process.env.ADMIN_EMAIL || 'admin@justicegavel.app',
      subject: `[Bar verification] ${cleanBar} (${st}) from ${user.email}`,
      text: [
        `Attorney e-mail: ${user.email}`, `Bar number: ${cleanBar}`, `State: ${st}`, `Submitted: ${new Date().toISOString()}`, '',
        `1. Look it up at the official state bar: ${lookupUrl}`,
        '   Confirm ACTIVE / IN GOOD STANDING and that the name matches.',
        '2. Approve or reject in the app: Settings → Admin review → Bar numbers.',
      ].join('\n'),
      html: `<p>Attorney: ${escapeHtml(user.email)}<br>Bar number: ${escapeHtml(cleanBar)}<br>State: ${escapeHtml(st)}</p>
<p><a href="${safeUrl(lookupUrl)}">Look up ${escapeHtml(cleanBar)} at the ${escapeHtml(st)} state bar</a></p>
<p>Approve or reject in the app: Settings → Admin review → Bar numbers.</p>`,
    }).catch(err => logger.error('[bar-verify email]', err.message));

    return res.json({ ok: true, status: 'pending_review', message: msg(lang, 'attorney.msg.bar_submitted'), bar_number: cleanBar, state: st });
  } catch (e) {
    logger.error('[attorney/verify-bar]', e.message);
    return res.status(500).json({ error: msg(lang, 'attorney.err.server'), code: 'server_error' });
  }
});

export default router;
