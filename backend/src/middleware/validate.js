/**
 * middleware/validate.js — Typed request validation schemas
 */
function schemaValidator(schema) {
  return (req, res, next) => {
    const errors = [];
    const body   = req.body || {};
    for (const [field, rules] of Object.entries(schema)) {
      const val = body[field];
      if (rules.required && (val === undefined || val === null || val === ''))
        { errors.push({ field, error: `${field} is required` }); continue; }
      if (val === undefined || val === null) continue;
      if (rules.type === 'string'  && typeof val !== 'string')  errors.push({ field, error: `${field} must be a string` });
      if (rules.type === 'number'  && typeof val !== 'number')  errors.push({ field, error: `${field} must be a number` });
      if (rules.minLength && String(val).length < rules.minLength) errors.push({ field, error: `${field} min ${rules.minLength} chars` });
      if (rules.maxLength && String(val).length > rules.maxLength) errors.push({ field, error: `${field} max ${rules.maxLength} chars` });
      if (rules.min !== undefined && Number(val) < rules.min)  errors.push({ field, error: `${field} >= ${rules.min}` });
      if (rules.max !== undefined && Number(val) > rules.max)  errors.push({ field, error: `${field} <= ${rules.max}` });
      if (rules.enum && !rules.enum.includes(val)) errors.push({ field, error: `${field} must be: ${rules.enum.join('|')}` });
    }
    if (errors.length > 0) return res.status(400).json({ error: 'Validation failed', fields: errors });
    next();
  };
}

export const validate = (schema) => schemaValidator(schema);

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
  'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT',
  'NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','federal'];

export const createCaseSchema = {
  title:      { type: 'string', required: true, minLength: 2,  maxLength: 200 },
  charge:     { type: 'string', maxLength: 500 },
  state:      { type: 'string', enum: STATES },
  status:     { type: 'string', enum: ['open','closed','dismissed','pending','appealing'] },
};
export const createMatterSchema = {
  title:       { type: 'string', required: true, minLength: 2, maxLength: 200 },
  client_name: { type: 'string', required: true, minLength: 2, maxLength: 200 },
  matter_type: { type: 'string', enum: ['criminal','civil','MDL','bankruptcy','constitutional','IP','antitrust','immigration'] },
  notes:       { type: 'string', maxLength: 100_000 },  // full case notes
  jurisdiction:{ type: 'string', maxLength: 50 },
};
// body limit depends on message_type — validated in route handler
export const sendMessageSchema    = { body: { type: 'string', required: true, minLength: 1, maxLength: 50_000 } };
export const ragQuerySchema       = { query: { type: 'string', required: true, minLength: 5, maxLength: 500 } };
export const bailCalcSchema       = { bail_amount: { type: 'number', required: true, min: 0 }, months: { type: 'number', min: 1, max: 60 } };
export const videoSessionSchema   = { topic: { type: 'string', maxLength: 100 } };
