import { Router } from 'express';
import historyRouter  from './history.js';
import generateRouter from './generate.js';
import reviewRouter  from './review.js';
import exportRouter  from './export.js';

const router = Router();
router.use('/', generateRouter);
router.use('/', historyRouter);
router.use('/', reviewRouter);
router.use('/export', exportRouter);

export default router;
