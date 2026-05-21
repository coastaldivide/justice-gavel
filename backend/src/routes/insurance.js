import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router }    from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired } from '../middleware/auth.js';

const router = Router();
const insuranceLimiter = rateLimit({ windowMs: 60*1000,    max: 20, message: { error: 'Too many requests. Please slow down.' } });

const PLANS = {
  basic:  { monthly: 9.99,  annual: 99.99,  name: 'Basic',  features: ['Unlimited Q&A', 'Document review (2/mo)', 'Legal hotline'] },
  pro:    { monthly: 19.99, annual: 199.99, name: 'Pro',    features: ['Everything in Basic', 'Attorney consultations', 'Court date reminders', 'AI lawyer matching'] },
  family: { monthly: 24.99, annual: 249.99, name: 'Family', features: ['Everything in Pro', 'Covers spouse + dependents', 'Priority support'] },
};

router.post('/quote', insuranceLimiter, authRequired, async (req, res) => {
  try {
    const { plan = 'basic', city = 'your area' } = req.body || {};
    const p = PLANS[plan] || PLANS.basic;
    res.json({
      plan,
      city,
      monthly: p.monthly,
      annual: p.annual,
      name: p.name,
      features: p.features,
      provider: 'LegalProtect Inc. (demo)',
      legalese: 'This is a demonstration quote only. Actual coverage terms, pricing, and availability vary by state. Not a binding insurance offer.',
    });
  } catch (e) {
    logger.error({ msg: '[insurance]', error: e?.message });
    res.status(500).json({ error: 'Could not generate quote' });
  }
});

router.get('/plans', async (req, res) => {
  try {
    res.json(Object.entries(PLANS).map(([key, p]) => ({ key, ...p })));
  } catch (e) {
    logger.error({ msg: '[insurance]', error: e?.message }); res.status(500).json({ error: 'Could not load plans' }); }
});

export default router;
