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
import { msg, resolveLang } from '../i18n/index.js';

// ── Reusable field types ─────────────────────────────────────────────────
const nonEmptyStr  = (max=500) => z.string().trim().min(1).max(max);
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
    // The mobile/web app sends { identifier, password, displayName?, isAttorney?, ... }
    // where identifier is an email OR phone number. Legacy clients may send
    // { email } or { phone } instead of identifier — accepted and normalised.
    register: z.object({
      identifier:  z.string().trim().min(3).max(254).optional(),
      email:       z.string().trim().max(254).optional(),
      phone:       z.string().trim().max(30).optional(),
      password:    z.string().min(8, 'Password must be at least 8 characters').max(200),
      displayName: z.string().trim().max(200).optional(),
      name:        z.string().trim().max(200).optional(),
      isAttorney:  z.boolean().optional(),
      accountType: z.enum(['consumer', 'attorney', 'bail_agent']).optional(),
      barNumber:   z.string().trim().max(30).optional().nullable(),
      barState:    z.string().trim().max(3).optional().nullable(),
      firmName:    z.string().trim().max(200).optional().nullable(),
    }).refine(d => !!(d.identifier || d.email || d.phone), {
      message: 'identifier (email or phone) is required', path: ['identifier'],
    }),
    login: z.object({
      identifier: z.string().trim().min(1).max(254).optional(),
      email:      z.string().trim().max(254).optional(),
      phone:      z.string().trim().max(30).optional(),
      password:   z.string().min(1).max(200),
    }).refine(d => !!(d.identifier || d.email || d.phone), {
      message: 'identifier (email or phone) is required', path: ['identifier'],
    }),
    refresh: z.object({
      refreshToken: z.string().min(1).optional(),
    }),
  },

  bail: {
    calculate: z.object({
      state:        z.string().trim().min(2).max(20),
      charge_type:  z.string().trim().max(50),
      severity:     z.enum(['low','medium','high','extreme']).optional(),
      prior_record: z.enum(['none','minor','significant','extensive']).optional(),
      flight_risk:  z.enum(['low','medium','high']).optional(),
      employed:     z.boolean().optional(),
      ice_hold:     z.boolean().optional(),
      violent:      z.boolean().optional(),
      bailAmount:   bailAmount.optional(),
      county:       z.string().max(100).optional(),
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
      // a 2-letter state, or '' / 'ALL' / omitted = any state
      state:      z.union([stateCode, z.literal(''), z.literal('ALL'), z.literal('all')]).optional(),
    }),
    warrant_check: z.object({
      name:  z.string().trim().min(2).max(200),
      state: stateCode,
      dob:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },

  cases: {
    // Matches what the app sends: { title, status: 'Open'|'Active'|..., next_court_date, notes, state? }
    create: z.object({
      title:           nonEmptyStr(500),
      status:          z.string().trim().max(30).optional().nullable(),
      charge:          z.string().max(500).optional().nullable(),
      state:           z.string().trim().max(20).optional().nullable(),
      description:     z.string().max(5000).optional().nullable(),
      notes:           z.string().max(10000).optional().nullable(),
      next_court_date: z.string().max(40).optional().nullable(),
      court_date:      z.string().max(40).optional().nullable(),
    }),
    update: z.object({
      title:           nonEmptyStr(500).optional(),
      status:          z.string().trim().max(30).optional().nullable(),
      state:           z.string().trim().max(20).optional().nullable(),
      description:     z.string().max(5000).optional().nullable(),
      notes:           z.string().max(10000).optional().nullable(),
      next_court_date: z.string().max(40).optional().nullable(),
      court_date:      z.string().max(40).optional().nullable(),
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
    // Matches what BookingScreen actually sends:
    //   { lawyer_id: number|null, lawyer_name, lawyer_phone?, duration_min: 15|30|60,
    //     date_slot: 'YYYY-MM-DD', time_slot: '9:00 AM' (the format /slots returns), notes? }
    // The old schema ('HH:MM' 24h time_slot, string-enum duration, required
    // numeric lawyer_id, no lawyer_name) rejected every real app booking.
    book: z.object({
      lawyer_id:    z.preprocess(
        v => (v === null || v === undefined || v === '' ? null : Number(v)),
        z.number().int().positive().nullable()
      ).optional(),
      lawyer_name:  nonEmptyStr(200),
      lawyer_phone: z.string().trim().max(40).optional(),
      date_slot:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time_slot:    z.string().trim().regex(/^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[AaPp][Mm])?$/,
        'time_slot must be H:MM AM/PM or HH:MM'),
      duration_min: z.coerce.number()
        .refine(v => [15, 30, 60].includes(v), 'duration_min must be 15, 30 or 60')
        .default(30),
      notes:        z.string().max(2000).optional(),
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
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const errors = (result.error.issues || result.error.errors || []).map(e => ({
        field:   e.path.join('.'),
        message: e.message,
        code:    e.code,
      }));
      return res.status(400).json({
        error:  'Validation failed',
        // What the app shows the person, in the request's language.
        message: msg(resolveLang(req), 'validation.failed'),
        errors,
        hint:   'Check the request body against the API documentation.',
      });
    }
    // Merge parsed+coerced fields over the original body. Zod strips unknown
    // keys, and many handlers read fields the schema does not list.
    req.body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
      ? { ...req.body, ...result.data }
      : result.data;
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
        errors: (result.error.issues || result.error.errors || []).map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    Object.defineProperty(req, 'query', { value: { ...req.query, ...result.data }, writable: true, configurable: true, enumerable: true });
    next();
  };
}

export const createReviewSchema = z.object({
  rating:  z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
}).passthrough();





