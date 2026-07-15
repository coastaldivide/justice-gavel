/**
 * validation/schemas.js — Zod schemas for all API inputs
 *
 * Every POST/PUT endpoint validates its body against one of these schemas.
 * Invalid input returns 400 with field-level errors before any DB call.
 *
 * Usage:
 *   import { validate, schemas } from '../validation/schemas.js';
 *   router.post('/calculate', validate(schemas.bail.calculate), async (req, res) => {...});
 */

import { z } from 'zod';

// ── Reusable field types ─────────────────────────────────────────────────
const nonEmptyStr  = (max=500) => z.string().trim().min(1).max(max);
const emailField   = z.string().email().toLowerCase().trim();
const phoneField   = z.string().regex(/^[+\d\s\-().]{7,20}$/).optional();
const stateCode    = z.string().length(2).toUpperCase();
const tierEnum     = z.enum(['free','legal_radar','advisor','legal_pro','esquire']);
const bailAmount   = z.number().positive().max(10_000_000);
const paginationQ  = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).partial();

// ── Schema groups ────────────────────────────────────────────────────────
export const schemas = {
  auth: {
    register: z.object({
      name:     nonEmptyStr(200),
      email:    emailField,
      password: z.string().min(8).max(200),
      phone:    phoneField,
      role:     z.enum(['consumer','attorney','bondsman','firm_admin']).default('consumer'),
    }),
    login: z.object({
      email:    emailField,
      password: z.string().min(1).max(200),
    }),
    refresh: z.object({
      refreshToken: z.string().min(1),
    }),
  },

  bail: {
    calculate: z.object({
      bailAmount:  bailAmount,
      chargeType:  z.string().max(200).optional(),
      state:       stateCode.optional(),
      county:      z.string().max(100).optional(),
    }),
    bondsman_payment: z.object({
      arrest_id:  z.number().int().positive(),
      amount:     bailAmount,
    }),
  },

  arrests: {
    create_monitor: z.object({
      watch_name: nonEmptyStr(200),
      county:     z.string().max(100).default('All'),
      state:      stateCode.default('TN'),
    }),
    warrant_check: z.object({
      name:  z.string().trim().min(2).max(200),
      state: stateCode,
      dob:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },

  cases: {
    create: z.object({
      title:       nonEmptyStr(500),
      charge:      nonEmptyStr(500).optional(),
      state:       stateCode.optional(),
      description: z.string().max(5000).optional(),
      court_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    update: z.object({
      title:       nonEmptyStr(500).optional(),
      status:      z.enum(['active','closed','pending','archived']).optional(),
      description: z.string().max(5000).optional(),
      court_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).partial(),
  },

  checkins: {
    create: z.object({
      schedule: z.enum(['daily','weekly','biweekly']).default('weekly'),
      notes:    z.string().max(1000).optional(),
    }),
    submit: z.object({
      location:   z.string().max(200).optional(),
      note:       z.string().max(1000).optional(),
      lat:        z.number().min(-90).max(90).optional(),
      lng:        z.number().min(-180).max(180).optional(),
    }),
  },

  subscription: {
    subscribe: z.object({
      tier:          tierEnum,
      payment_method_id: z.string().min(1).optional(),
    }),
  },

  consultations: {
    book: z.object({
      lawyer_id:    z.number().int().positive(),
      date_slot:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time_slot:    z.string().regex(/^\d{2}:\d{2}$/),
      duration_min: z.enum(['15','30','60']).transform(Number),
      notes:        z.string().max(1000).optional(),
    }),
  },

  pi_leads: {
    submit: z.object({
      type:        z.enum(['personal_injury','civil_rights','employment','ice_detention','other']),
      severity:    z.enum(['minor','moderate','serious','catastrophic']).optional(),
      description: nonEmptyStr(5000),
      state:       stateCode,
      incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },

  providers: {
    search: z.object({
      lat:       z.coerce.number().min(-90).max(90).optional(),
      lng:       z.coerce.number().min(-180).max(180).optional(),
      specialty: z.string().max(200).optional(),
      state:     stateCode.optional(),
      radius_km: z.coerce.number().min(1).max(500).default(50),
    }).partial(),
  },

  child_support: {
    calculate: z.object({
      parent1_income: z.number().positive().max(10_000_000),
      parent2_income: z.number().positive().max(10_000_000),
      children:       z.number().int().min(1).max(10),
      custody_pct:    z.number().min(0).max(100).default(70),
      state:          stateCode.optional(),
    }),
  },

  pagination: paginationQ,
};

// ── Validate middleware factory ──────────────────────────────────────────
/**
 * validate(schema) — middleware that validates req.body against a Zod schema.
 * On error: returns 400 with field-level errors. On success: calls next().
 *
 * Usage:
 *   router.post('/endpoint', validate(schemas.auth.login), asyncRoute(async (req, res) => {
 *     const { email, password } = req.body; // already validated + typed
 *   }));
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
        code:    e.code,
      }));
      return res.status(400).json({
        error:  'Validation failed',
        errors,
        hint:   'Check the request body against the API documentation.',
      });
    }
    // Replace req.body with parsed+coerced data
    req.body = result.data;
    next();
  };
}

/**
 * validateQuery(schema) — same as validate but for req.query
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error:  'Invalid query parameters',
        errors: result.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    req.query = result.data;
    next();
  };
}

export const ratingSchema = z.object({ rating: z.number().min(1).max(5), comment: z.string().max(500).optional() });

export const matterUpdateSchema = z.object({ status: z.enum(["active","pending","closed"]).optional(), note: z.string().max(1000).optional() });

export const messageSchema = z.object({ message_type: z.enum(["text","system","media"]).default("text") });

export const docketEntrySchema = z.object({ due_date: z.string().datetime().optional() });

export const alertSchema = z.object({ category: z.enum(["arrest","warrant","court","general"]) });
