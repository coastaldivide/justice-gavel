/**
 * middleware/validate.js — Zod request validation
 *
 * All POST/PUT endpoints declare their schema here.
 * Invalid requests get 422 with field-level errors — never 500.
 * This prevents malformed data from reaching the database layer.
 */

import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
        code:    e.code,
      }));
      return res.status(422).json({
        error:  'Validation failed.',
        code:   'validation_error',
        errors,
      });
    }
    req.validated = result.data;
    next();
  };
}

// ── Auth schemas ─────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  identifier:  z.string().min(3).max(120).trim(),
  password:    z.string().min(8).max(128)
                 .regex(/[A-Z]/, 'Must contain uppercase letter')
                 .regex(/[0-9]/, 'Must contain a number'),
  displayName: z.string().min(1).max(60).trim().optional(),
});

export const loginSchema = z.object({
  identifier: z.string().min(1).max(120).trim(),
  password:   z.string().min(1).max(128),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(20).max(200),
  password: z.string().min(8).max(128)
              .regex(/[A-Z]/, 'Must contain uppercase letter')
              .regex(/[0-9]/, 'Must contain a number'),
});

// ── Case schemas ─────────────────────────────────────────────────────────────
export const createCaseSchema = z.object({
  title:           z.string().min(1).max(200).trim(),
  description:     z.string().max(5000).trim().optional(),
  status:          z.enum(['open','closed','pending','active']).default('open'),
  charge_type:     z.string().max(100).trim().optional(),
  jurisdiction:    z.string().max(100).trim().optional(),
  court_date:      z.string().datetime().optional().nullable(),
  attorney_id:     z.number().int().positive().optional().nullable(),
});

// ── Bail schemas ─────────────────────────────────────────────────────────────
export const bailCalculateSchema = z.object({
  state:        z.string().length(2).toUpperCase(),
  charge_type:  z.enum(['felony','misdemeanor','dui','domestic','sexual','dismissed']),
  severity:     z.enum(['low','medium','high','extreme']).default('medium'),
  prior_record: z.enum(['none','minor','significant','extensive']).default('none'),
  flight_risk:  z.enum(['low','medium','high']).default('low'),
  employed:     z.boolean().default(true),
  ice_hold:     z.boolean().default(false),
  violent:      z.boolean().default(false),
});

// ── Review schemas ────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  entity_type: z.enum(['lawyer','bail_agent','bondsman','provider']),
  entity_id:   z.number().int().positive(),
  rating:      z.number().int().min(1).max(5),
  comment:     z.string().max(2000).trim().optional(),
  anonymous:   z.boolean().default(false),
});

// ── Chat schemas ──────────────────────────────────────────────────────────────
export const chatMessageSchema = z.object({
  message:    z.string().min(1).max(4000).trim(),
  session_id: z.string().max(100).optional().nullable(),
  case_id:    z.number().int().positive().optional().nullable(),
  mode:       z.enum(['consumer','defender']).default('consumer'),
});

// ── Subscription schemas ──────────────────────────────────────────────────────
export const subscribeSchema = z.object({
  tier:         z.enum(['legal_radar','advisor','legal_pro','esquire',
                         'advisor_annual','pro_annual','esquire_annual']),
  payment_method_id: z.string().min(2).max(200).optional(),
});
