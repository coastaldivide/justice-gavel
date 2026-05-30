/**
 * discovery/index.js — Document analysis module entry point
 *
 *   _helpers.js  — File validation, AI analysis, DB schema
 *   analyze.js   — POST /analyze (document upload + AI analysis)
 *   history.js   — GET /history, GET /analysis/:id, DELETE, GET /status
 */
import { Router } from 'express';
import logger from '../../utils/logger.js';
import analyzeRouter from './analyze.js';
import historyRouter from './history.js';


if (!process.env.ANTHROPIC_API_KEY) {
  logger.error('[discovery] ANTHROPIC_API_KEY not set — AI discovery disabled');
}

const router = Router();
router.use('/', analyzeRouter);
router.use('/', historyRouter);

export default router;
