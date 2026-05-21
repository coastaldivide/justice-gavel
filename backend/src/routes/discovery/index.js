/**
 * discovery/index.js — Document analysis module entry point
 *
 *   _helpers.js  — File validation, AI analysis, DB schema
 *   analyze.js   — POST /analyze (document upload + AI analysis)
 *   history.js   — GET /history, GET /analysis/:id, DELETE, GET /status
 */
import { Router } from 'express';
import analyzeRouter from './analyze.js';
import historyRouter from './history.js';

const router = Router();
router.use('/', analyzeRouter);
router.use('/', historyRouter);

export default router;
