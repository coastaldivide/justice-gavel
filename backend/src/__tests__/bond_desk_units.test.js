/**
 * bond_desk_units.test.js — Bond Desk pure logic: the ledger (whole cents, voids, plan
 * coverage), dates, names, form values, and the consent wording the certificate prints
 * being exactly the English text the signing page shows.
 */
import { readFileSync } from 'fs';
import { planStatus, bondMoney, planError, isDate, money, usDate, liveTotal } from '../services/bondDesk/money.js';
import { sameName, dataValues, fieldValues, signatureValues, questionsFor, CONSENT_LINES, DATA_KEYS, SIGNATURE_KEYS } from '../services/bondDesk/core.js';

describe('ledger', () => {
  test('voided rows never count; only whole cents', () => {
    expect(liveTotal([{ amount_cents: 100 }, { amount_cents: 250, voided_at: '2026-01-01' }, { amount_cents: '5' }])).toBe(105);
    expect(() => liveTotal([{ amount_cents: 1.5 }])).toThrow();
  });
  test('payments cover installments oldest first; due today is not overdue', () => {
    const inst = [{ id: 2, due_on: '2026-03-01', amount_cents: 100 }, { id: 1, due_on: '2026-02-01', amount_cents: 100 }, { id: 3, due_on: '2026-04-01', amount_cents: 100 }];
    expect(planStatus(inst, 150, '2026-03-01').map((i) => [i.due_on, i.status, i.covered_cents]))
      .toEqual([['2026-02-01', 'paid', 100], ['2026-03-01', 'partial', 50], ['2026-04-01', 'due', 0]]);
    expect(planStatus(inst, 150, '2026-03-02')[1].status).toBe('overdue');
    expect(planStatus(inst, 0, '2026-01-01').every((i) => i.status === 'due')).toBe(true);
    expect(planStatus(inst, 999, '2030-01-01').every((i) => i.status === 'paid')).toBe(true);
  });
  test('money block', () => {
    const m = bondMoney({ charges: [{ amount_cents: 300 }, { amount_cents: 50, voided_at: 'x' }], payments: [{ amount_cents: 120 }],
      installments: [{ due_on: '2026-01-01', amount_cents: 150 }, { due_on: '2026-02-01', amount_cents: 150 }], planChargedCents: 300 }, '2026-01-15');
    expect(m).toMatchObject({ charged_cents: 300, paid_cents: 120, balance_cents: 180, overdue_cents: 30, plan_in_sync: true, plan_scheduled_cents: 300 });
    expect(m.next_due).toMatchObject({ due_on: '2026-01-01', covered_cents: 120 });
    expect(bondMoney({ charges: [{ amount_cents: 400 }], payments: [], installments: [{ due_on: '2026-01-01', amount_cents: 300 }], planChargedCents: 300 }, '2026-01-01').plan_in_sync).toBe(false);
  });
  test('plan validation', () => {
    expect(planError([{ due_on: '2026-01-01', amount_cents: 100 }], 100)).toBeNull();
    expect(planError([], 100)).toBeNull();
    expect(planError([{ due_on: '2026-01-01', amount_cents: 99 }], 100)).toBe('plan_total');
    expect(planError([{ due_on: '2026-02-30', amount_cents: 100 }], 100)).toBe('bad_plan');
    expect(planError([{ due_on: '2026-01-01', amount_cents: 0 }], 0)).toBe('bad_plan');
    expect(planError([{ due_on: '2026-01-01', amount_cents: 50 }, { due_on: '2026-01-01', amount_cents: 50 }], 100)).toBe('bad_plan');
    expect(planError('x', 100)).toBe('bad_plan');
  });
  test('formatting', () => {
    expect([money(0), money(5), money(123456), money(100000000), money(-250)]).toEqual(['$0.00', '$0.05', '$1,234.56', '$1,000,000.00', '-$2.50']);
    expect([usDate('2026-02-28'), usDate('2026-02-29'), usDate(null)]).toEqual(['02/28/2026', '', '']);
    expect([isDate('2024-02-29'), isDate('2023-02-29'), isDate('2026-13-01'), isDate('26-01-01')]).toEqual([true, false, false, false]);
  });
});

describe('signing', () => {
  test('typed name: case and spaces ignored, accents kept', () => {
    expect(sameName('  maría   LÓPEZ ', 'María López')).toBe(true);
    expect(sameName('Maria Lopez', 'María López')).toBe(false);
    expect(sameName('', '')).toBe(false);
  });
  test('form values: answers first, then the record; signature keys only on the signed copy', () => {
    const v = dataValues({
      bond: { defendant_name: 'Sam Doe', bond_amount_cents: 1000000, court_date: '2026-11-03', state: 'TN', defendant_address: 'Jail' },
      agency: { agency: 'Alpha', agent_name: 'Al', license: 'L1', phone: '1', email: 'a@x' },
      signer: { role: 'indemnitor', name: 'Pat Doe', phone: '+16155550100', answers: { address: '2 Oak', dob: '1980-01-02' } },
      indemnitor: { relationship: 'Mother', address: 'old', employer: 'Acme' }, premiumCents: 100000, powerNumber: 'AS1', today: '2026-10-26',
    });
    expect(v).toMatchObject({ 'bond.bond_amount': '$10,000.00', 'bond.court_date': '11/03/2026', 'bond.premium': '$1,000.00', 'bond.power_number': 'AS1',
      'signer.full_name': 'Pat Doe', 'signer.address': '2 Oak', 'signer.dob': '01/02/1980', 'signer.relationship': 'Mother', 'signer.employer': 'Acme',
      'signer.role': 'Indemnitor', 'date.today': '10/26/2026' });
    expect(Object.keys(v).sort()).toEqual(DATA_KEYS.filter((k) => !SIGNATURE_KEYS.includes(k)).sort());
    expect(fieldValues({ A: 'signer.full_name', S: 'signature.name', D: 'signature.date' }, v)).toEqual({ A: 'Pat Doe' });
    expect(signatureValues({ A: 'signer.full_name', S: 'signature.name', D: 'signature.date' }, { typedName: 'pat doe', signedDate: '2026-10-26' }))
      .toEqual({ S: '/s/ pat doe', D: '10/26/2026' });
  });
  test('questions', () => {
    expect(questionsFor({ questions: 'none', custom_questions: [] }, 'defendant')).toEqual([]);
    const q = questionsFor({ questions: 'full', custom_questions: ['Car color?'] }, 'indemnitor');
    expect(q[0]).toEqual({ key: 'relationship', label_key: 'sgn_q_relationship', label: null, required: true });
    expect(q.at(-1)).toEqual({ key: 'custom_1', label_key: null, label: 'Car color?', required: true });
    expect(q.map((x) => x.key)).toContain('reference_1');
  });
  test('the certificate prints exactly the English consent text the signing page shows', () => {
    const en = JSON.parse(readFileSync(new URL('../../../frontend/src/i18n/en.json', import.meta.url), 'utf8'));
    expect(CONSENT_LINES).toEqual([en.sgn_esign_consent, en.sgn_agree_esign, en.sgn_agree_terms]);
    for (const q of questionsFor({ questions: 'full', custom_questions: [] }, 'indemnitor')) expect(typeof en[q.label_key]).toBe('string');
  });
  test('no drawn signature anywhere: the signing page has no canvas / signature pad', () => {
    const src = readFileSync(new URL('../../../frontend/src/screens/SignPacketScreen.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/canvas|signature-pad|SignatureCanvas|react-native-signature|PanResponder/i);
  });
});
