/**
 * crash_proof.test.js — Zero-crash guarantee for the legal engine
 *
 * These tests ensure the legal engine never throws an exception regardless
 * of what input it receives. In a legal app, a crash could mean a defendant
 * doesn't get critical information at the moment they need it most.
 *
 * POLICY: All public functions in the legal engine must handle:
 *   - null and undefined
 *   - Wrong types (number, boolean, object, array)
 *   - Empty strings and whitespace
 *   - Extremely long strings
 *   - SQL injection strings
 *   - XSS strings
 *   - Prototype pollution strings
 *   - Unicode edge cases
 *   - Numeric extremes (NaN, Infinity, negative)
 *
 * There are no acceptable crashes. Ever.
 */

import { classifyCharge, getEligibility, STATE_RULES } from '../routes/expungement/rules.js';
import { calcLeadFee }                                   from '../routes/billing/_shared.js';

const BAD_INPUTS   = [null, undefined, '', '   ', 0, -1, false, true, {}, [], NaN, Infinity, 9999999];
const STATES       = [...Object.keys(STATE_RULES), 'XX', '', null, undefined];
const CHARGE_TYPES = ['felony','misdemeanor','dui','domestic','sexual','dismissed','','invalid',null,undefined];
const INJECTIONS   = [
  'DROP TABLE charges; --',
  '<script>alert("xss")</script>',
  '../../../etc/passwd',
  '\0\0\0',
  'A'.repeat(50000),
  '{"__proto__":{"admin":true}}',
  '${7*7}',
  'eval("process.exit(1)")',
  'constructor.constructor("return process")().exit(1)',
];

describe('CRASH PROOF — Legal Engine', () => {

  describe('classifyCharge()', () => {
    test('handles all bad input types without throwing', () => {
      for (const input of BAD_INPUTS) {
        expect(() => classifyCharge(input)).not.toThrow();
        const result = classifyCharge(input);
        expect(typeof result).toBe('string');
        expect(['felony','misdemeanor','dui','domestic','sexual','dismissed']).toContain(result);
      }
    });

    test('handles injection strings without throwing', () => {
      for (const inj of INJECTIONS) {
        expect(() => classifyCharge(inj)).not.toThrow();
      }
    });

    test('returns conservative default (misdemeanor) for unrecognized input', () => {
      expect(classifyCharge(null)).toBe('misdemeanor');
      expect(classifyCharge(undefined)).toBe('misdemeanor');
      expect(classifyCharge('')).toBe('misdemeanor');
      expect(classifyCharge('gibberish xyz 123')).toBe('misdemeanor');
    });

    test('correctly classifies all known charge types', () => {
      const expected = [
        ['DUI first offense 0.12 BAC',                     'dui'],
        ['murder in the first degree',                     'felony'],
        ['domestic battery — first offense',               'domestic'],
        ['sexual assault — rape first degree',             'sexual'],
        ['case dismissed — not guilty',                    'dismissed'],
        ['simple assault — class C misdemeanor',           'misdemeanor'],
        ['tax evasion — offshore accounts',                'felony'],
        ['money laundering — real estate',                 'felony'],
        ['RICO conspiracy continuing criminal enterprise', 'felony'],
        ['wire fraud 18 U.S.C. § 1343',                   'felony'],
        ['ransomware cyberattack',                         'felony'],
        ['human trafficking minors',                       'felony'],
        ['identity theft 18 U.S.C. § 1028A',              'felony'],
        ['securities fraud insider trading',               'felony'],
        ['healthcare fraud Medicare billing',              'felony'],
      ];
      for (const [charge, exp] of expected) {
        const got = classifyCharge(charge);
        expect(got).toBe(exp);
      }
    });
  });

  describe('getEligibility()', () => {
    test('handles null/undefined state without throwing', () => {
      expect(() => getEligibility(null, 'felony')).not.toThrow();
      expect(() => getEligibility(undefined, 'felony')).not.toThrow();
      expect(() => getEligibility('', 'felony')).not.toThrow();
    });

    test('handles null/undefined charge type without throwing', () => {
      expect(() => getEligibility('CA', null)).not.toThrow();
      expect(() => getEligibility('CA', undefined)).not.toThrow();
      expect(() => getEligibility('CA', '')).not.toThrow();
    });

    test('handles all known states × all charge types without throwing', () => {
      let total = 0;
      for (const state of STATES) {
        for (const charge of CHARGE_TYPES) {
          expect(() => getEligibility(state, charge)).not.toThrow();
          total++;
        }
      }
      expect(total).toBeGreaterThan(200);
    });

    test('returns an object with eligible property for all valid combinations', () => {
      for (const state of Object.keys(STATE_RULES)) {
        for (const charge of ['felony','misdemeanor','dui','dismissed']) {
          const result = getEligibility(state, charge);
          expect(typeof result).toBe('object');
          expect(result).not.toBeNull();
          expect(['boolean','string']).toContain(typeof result.eligible); // 'conditional' is valid for some states
        }
      }
    });
  });

  describe('calcLeadFee()', () => {
    test('never returns a negative number for any input', () => {
      for (const input of BAD_INPUTS) {
        const fee = calcLeadFee(input);
        expect(fee).toBeGreaterThanOrEqual(0);
      }
    });

    test('returns 0 for OR release (bail = 0)', () => {
      expect(calcLeadFee(0)).toBe(0);
      expect(calcLeadFee(-100)).toBe(0);
      expect(calcLeadFee(null)).toBe(0);
      expect(calcLeadFee(undefined)).toBe(0);
      expect(calcLeadFee(NaN)).toBe(0);
    });

    test('returns scaled fee for positive bail amounts', () => {
      expect(calcLeadFee(5000)).toBeGreaterThan(0);
      expect(calcLeadFee(100000)).toBeGreaterThan(calcLeadFee(5000));
    });
  });

});
