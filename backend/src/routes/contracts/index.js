/**
 * contracts/index.js — Contract module router
 *
 * Mounts:
 *   /api/contracts/types         → draft.js (contract type catalog)
 *   /api/contracts/draft         → draft.js (generate)
 *   /api/contracts/review        → review.js (risk analysis)
 *   /api/contracts/redline       → review.js (comparison)
 *   /api/contracts/expiring      → execution.js (expiry alerts)
 *   /api/contracts/dashboard     → execution.js (stats)
 *   /api/contracts/:id           → draft.js (CRUD)
 *   /api/contracts/:id/sign      → execution.js (signature tracking)
 *   /api/contracts/:id/signers   → execution.js
 *   /api/contracts/:id/negotiate → review.js (negotiation strategy)
 */

import { Router } from 'express';
import draftRouter     from './draft.js';
import reviewRouter    from './review.js';
import executionRouter from './execution.js';

const router = Router();

// Order matters — more specific paths first
router.use('/', reviewRouter);     // /review, /redline (before /:id)
router.use('/', executionRouter);  // /expiring, /dashboard (before /:id)
router.use('/', draftRouter);      // /:id CRUD and /types and /draft

export default router;
