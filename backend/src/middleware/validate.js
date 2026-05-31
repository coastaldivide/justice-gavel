/**
 * validate.js — Zod request validation middleware
 */
import { z } from 'zod';
export { z };

export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    const errors = {};
    if (body)   { const r = body.safeParse(req.body);     if (!r.success) errors.body   = r.error.flatten().fieldErrors; }
    if (query)  { const r = query.safeParse(req.query);   if (!r.success) errors.query  = r.error.flatten().fieldErrors; }
    if (params) { const r = params.safeParse(req.params); if (!r.success) errors.params = r.error.flatten().fieldErrors; }
    if (Object.keys(errors).length)
      return res.status(422).json({ error: 'Validation failed', code: 'validation_error', fields: errors });
    next();
  };
}

export const schemas = {
  id: z.object({ id: z.coerce.number().int().positive() }),
  pagination: z.object({
    limit:  z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  register: z.object({
    identifier:  z.string().min(3).max(120),
    password:    z.string().min(8).max(128)
                   .regex(/[A-Z]/, 'Must contain uppercase')
                   .regex(/[0-9]/, 'Must contain number'),
    displayName: z.string().max(80).optional(),
  }),
  login: z.object({
    identifier: z.string().min(3).max(120),
    password:   z.string().min(1).max(128),
  }),
  caseCreate: z.object({
    title:      z.string().min(1).max(200),
    case_type:  z.string().max(50).optional(),
    court_date: z.string().optional().nullable(),
    charges:    z.string().max(500).optional(),
    status:     z.enum(['active','pending','closed','dismissed']).default('active'),
  }),
  review: z.object({
    entity_type: z.string().max(30),
    entity_id:   z.coerce.number().int().positive(),
    rating:      z.number().int().min(1).max(5),
    comment:     z.string().max(1000).optional(),
    anonymous:   z.boolean().default(false),
  }),
};
