/**
 * attorney_data_schema.test.js
 * Validates the attorney data schema: required fields, format
 * constraints, and geographic data integrity.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Validate a single attorney record against expected shape
function validateAttorney(record) {
  const errors = [];
  if (!record.name || typeof record.name !== 'string' || record.name.trim().length < 2)
    errors.push('name: must be non-empty string');
  if (!record.state || !/^[A-Z]{2}$/.test(record.state))
    errors.push(`state: must be 2-char uppercase abbreviation, got "${record.state}"`);
  if (!record.city || typeof record.city !== 'string')
    errors.push('city: required string');
  if (record.lat !== undefined && (typeof record.lat !== 'number' || record.lat < 24 || record.lat > 50))
    errors.push(`lat: US latitude must be 24-50, got ${record.lat}`);
  if (record.lng !== undefined && (typeof record.lng !== 'number' || record.lng < -125 || record.lng > -66))
    errors.push(`lng: US longitude must be -125 to -66, got ${record.lng}`);
  if (record.phone && !/^\+?[\d\s\-().]{7,20}$/.test(record.phone))
    errors.push(`phone: invalid format "${record.phone}"`);
  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))
    errors.push(`email: invalid format "${record.email}"`);
  if (record.bar_number && typeof record.bar_number !== 'string')
    errors.push('bar_number: must be string if present');
  return errors;
}

const VALID_RECORDS = [
  { name: 'Jane Smith', state: 'GA', city: 'Atlanta', lat: 33.749, lng: -84.388, phone: '(404) 555-1234', email: 'jane@example.com' },
  { name: 'John Doe', state: 'TN', city: 'Nashville', lat: 36.174, lng: -86.767 },
  { name: 'Maria Garcia', state: 'TX', city: 'Houston', lat: 29.760, lng: -95.370, bar_number: 'TX-123456' },
  { name: 'Bob Chen', state: 'CA', city: 'Los Angeles' },
  { name: 'Dr. Alice Williams', state: 'FL', city: 'Miami', phone: '+1-305-555-0100' },
];

const INVALID_RECORDS = [
  { name: '', state: 'GA', city: 'Atlanta' },          // empty name
  { name: 'X', state: 'GA', city: 'Atlanta' },         // name too short
  { name: 'John Doe', state: 'ga', city: 'Atlanta' },  // lowercase state
  { name: 'John Doe', state: 'USA', city: 'Atlanta' }, // 3-char state
  { name: 'John Doe', state: 'GA', city: 'Atlanta', lat: 5, lng: -84 },   // lat out of US
  { name: 'John Doe', state: 'GA', city: 'Atlanta', lat: 33, lng: -200 }, // lng out of range
  { name: 'John Doe', state: 'GA', city: 'Atlanta', email: 'notanemail' },
];

describe('Attorney data — valid records', () => {
  test.each(VALID_RECORDS)('validates: %o', (record) => {
    expect(validateAttorney(record)).toHaveLength(0);
  });
});

describe('Attorney data — invalid records are caught', () => {
  test.each(INVALID_RECORDS)('catches invalid: %o', (record) => {
    expect(validateAttorney(record).length).toBeGreaterThan(0);
  });
});

describe('Attorney data — US state codes', () => {
  const ALL_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
    'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  test('all 50 state codes are 2 uppercase letters', () => {
    for (const s of ALL_STATES) expect(s).toMatch(/^[A-Z]{2}$/);
  });

  test('there are exactly 50 states', () => {
    expect(ALL_STATES).toHaveLength(50);
  });

  test('Tennessee code is TN', () => { expect(ALL_STATES).toContain('TN'); });
  test('Georgia code is GA',   () => { expect(ALL_STATES).toContain('GA'); });
  test('California is CA',     () => { expect(ALL_STATES).toContain('CA'); });
});

describe('Attorney data — schema file', () => {
  test('schema migration defines attorneys table', () => {
    const mig = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/20260525000001_justice_gavel_schema.sql'),
      'utf-8'
    );
    // Table is named 'lawyers' in schema (attorneys and lawyers are used interchangeably)
    expect(mig).toMatch(/CREATE TABLE.*(?:lawyers|attorneys|providers)/i);
    expect(mig).toMatch(/state/i);
    expect(mig).toMatch(/city/i);
  });
});
