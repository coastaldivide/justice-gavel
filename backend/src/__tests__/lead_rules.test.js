/**
 * lead_rules.test.js — state-by-state lead rules (services/leadRules.js, docs/LEAD_FEE_RULES.md).
 */
import { leadRuleFor, allowsPerLeadPayment, allowsCredits, sellableStates, STATE_LEAD_RULES, CREDIT_PACKS, CREDIT_CENTS, LEAD_DISCLOSURE } from '../services/leadRules.js';
import { attorneyLeadFeeCents, attorneyLeadCredits } from '../routes/billing/attorneyLeadFee.js';

const TYPES = ['personal_injury', 'medical', 'civil_rights', 'employment', 'ice_detention'];

describe('lead rules by state', () => {
  test('Tennessee: prepaid credit packs only (Op. 2018-F-165)', () => {
    expect(leadRuleFor('TN', {})).toMatchObject({ mode: 'credits', source: 'Tenn. Formal Ethics Op. 2018-F-165' });
    expect(allowsPerLeadPayment('TN', {})).toBe(false);
    expect(allowsCredits('TN', {})).toBe(true);
  });
  test('New York and Washington allow per-lead payment', () => {
    for (const s of ['NY', 'WA']) {
      expect(allowsPerLeadPayment(s, {})).toBe(true);
      expect(allowsCredits(s, {})).toBe(true);
    }
  });
  test('Texas is subscription only, so no per-lead or credit sale', () => {
    expect(leadRuleFor('TX', {}).mode).toBe('subscription');
    expect(allowsCredits('TX', {})).toBe(false);
  });
  test('Colorado bans lead generation outright (SB 26-174)', () => {
    expect(leadRuleFor('CO', {}).mode).toBe('directory_only');
    expect(allowsCredits('CO', { LEAD_REG_CA_CERTIFIED_LRS: '1', LEAD_REG_FL_QUALIFYING_PROVIDER: '1' })).toBe(false);
  });
  test('Florida and California open only after the registration is recorded', () => {
    expect(leadRuleFor('FL', {}).mode).toBe('directory_only');
    expect(leadRuleFor('FL', { LEAD_REG_FL_QUALIFYING_PROVIDER: '1' }).mode).toBe('credits');
    expect(leadRuleFor('CA', {}).mode).toBe('directory_only');
    expect(leadRuleFor('CA', { LEAD_REG_CA_CERTIFIED_LRS: '1' }).mode).toBe('credits');
    expect(leadRuleFor('CA', { LEAD_REG_CA_CERTIFIED_LRS: 'yes' }).mode).toBe('directory_only');
  });
  test('Avvo-opinion states take flat fees (credits), never per-matter fees', () => {
    for (const s of ['NJ', 'OH', 'PA', 'SC']) expect(leadRuleFor(s, {}).mode).toBe('credits');
  });
  test('unlisted states use the ABA default (credits); input is case-insensitive', () => {
    expect(leadRuleFor('ga', {})).toMatchObject({ state: 'GA', mode: 'credits' });
    expect(leadRuleFor('', {}).mode).toBe('credits');
  });
  test('every listed rule cites a source', () => {
    for (const [st, r] of Object.entries(STATE_LEAD_RULES)) expect([st, typeof r.source, r.source.length > 5]).toEqual([st, 'string', true]);
  });
  test('sellable states exclude the closed ones', () => {
    const s = sellableStates({});
    expect(s).toEqual(expect.arrayContaining(['TN', 'NY', 'WA', 'GA']));
    for (const closed of ['CO', 'TX', 'CA', 'FL']) expect(s).not.toContain(closed);
    expect(s.length).toBe(51 - 4);
  });
  test('the disclosure says there is no recommendation and the price never depends on hiring', () => {
    expect(LEAD_DISCLOSURE).toMatch(/does not recommend or endorse/);
    expect(LEAD_DISCLOSURE).toMatch(/never depends on whether you hire/);
  });
});

describe('credits', () => {
  test('every flat fee is a whole number of $25 credits', () => {
    expect(CREDIT_CENTS).toBe(2500);
    for (const t of TYPES) {
      expect(attorneyLeadFeeCents(t) % CREDIT_CENTS).toBe(0);
      expect(attorneyLeadCredits(t) * CREDIT_CENTS).toBe(attorneyLeadFeeCents(t));
    }
    expect(attorneyLeadCredits('personal_injury')).toBe(10);
    expect(attorneyLeadCredits('ice_detention')).toBe(3);
  });
  test('packs are a fixed price per credit', () => {
    for (const p of Object.values(CREDIT_PACKS)) expect(p.cents).toBe(p.credits * CREDIT_CENTS);
  });
});
