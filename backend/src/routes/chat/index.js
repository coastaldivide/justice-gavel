/**
 * chat/index.js — AI Chat module entry point
 *
 *   _prompts.js  — System prompts, disclaimer footer (edit AI persona here)
 *   _helpers.js  — callClaude(), getHistory(), saveMessage(), detectLawyerHandoff()
 *   ask.js       — POST /ask (main chat)
 *   stream.js    — POST /stream (streaming)
 *   history.js   — GET|DELETE /history/:sessionId
 */
import { Router }     from 'express';
import askRouter      from './ask.js';
import streamRouter   from './stream.js';
import historyRouter  from './history.js';

const router = Router();
router.use('/', askRouter);
router.use('/', streamRouter);
router.use('/', historyRouter);

export default router;
