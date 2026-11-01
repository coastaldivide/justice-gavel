/**
 * case_steps_court_guide.test.js — unit checks for "Your case, step by step" and the court guide.
 *
 *   catalog   the server's stages / items are the app's (frontend constants/caseStepsCatalog.json)
 *   input     normalizeSteps refuses unknown stages, unknown items, the court-date items and bad types
 *   rules     court_rules.js: every row is an official https page with a checked date and known
 *             "covers"; matching by state + county (case and "County" suffix ignored); unlisted → []
 *   text      the new server strings exist in all eight languages; the day-before hint has no number
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { STAGES, STAGE_IDS, ITEM_IDS, AUTO_ITEMS, normalizeSteps, cleanChecked, StepsError } from '../services/caseSteps.js';
import { COURT_RULES, COVERS, courtRulesFor } from '../data/court_rules.js';
import { PLAN_ITEMS } from '../services/courtDayHelp.js';
import { SUPPORTED_LANGS, msg, CATALOGS } from '../i18n/index.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const appCatalog = JSON.parse(readFileSync(resolve(REPO, 'frontend/src/constants/caseStepsCatalog.json'), 'utf8'));
const app = Object.fromEntries(SUPPORTED_LANGS.map(l => [l, JSON.parse(readFileSync(resolve(REPO, `frontend/src/i18n/${l}.json`), 'utf8'))]));

const code = (fn) => { try { fn(); return null; } catch (e) { return e instanceof StepsError ? e.code : e.message; } };

describe('case steps catalog', () => {
  it('the server validates exactly the stages and items the app shows', () => {
    expect(STAGES.map(s => ({ id: s.id, items: [...s.items] }))).toEqual(appCatalog.stages);
    expect([...AUTO_ITEMS]).toEqual(appCatalog.auto);
  });
  it('nine stages from arrest to clearing a record, 3–6 items each; every automatic item is a real item', () => {
    expect(STAGE_IDS).toEqual(['arrest', 'release', 'first', 'lawyer', 'pretrial', 'plea', 'sentence', 'probation', 'record']);
    for (const s of STAGES) { expect(s.items.length).toBeGreaterThanOrEqual(3); expect(s.items.length).toBeLessThanOrEqual(6); }
    for (const a of AUTO_ITEMS) expect(ITEM_IDS).toContain(a);
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
  });
  it('every stage and item has its words in all eight languages', () => {
    for (const l of SUPPORTED_LANGS) {
      for (const s of STAGES) {
        for (const k of [`cst_${s.id}_title`, `cst_${s.id}_body`, ...s.items.map(i => `cst_${s.id}_${i}`)]) {
          expect([l, k, typeof app[l][k]]).toEqual([l, k, 'string']);
          expect(app[l][k].trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('normalizeSteps', () => {
  it('accepts a stage, ticks and the share switch', () => {
    expect(normalizeSteps({ stage: 'plea', checked: { 'plea.guide': true, 'arrest.silent': false }, share_stage: true }))
      .toEqual({ stage: 'plea', checked: { 'plea.guide': true, 'arrest.silent': false }, share_stage: true });
    expect(normalizeSteps({ stage: null })).toEqual({ stage: null });
  });
  it('refuses unknown stages / items, the court-date items and wrong types', () => {
    expect(code(() => normalizeSteps({ stage: 'appeal' }))).toBe('bad_stage');
    expect(code(() => normalizeSteps({ checked: { 'plea.bribe': true } }))).toBe('bad_item');
    expect(code(() => normalizeSteps({ checked: { 'first.date_saved': true } }))).toBe('bad_item');
    expect(code(() => normalizeSteps({ checked: { 'plea.guide': 1 } }))).toBe('bad_steps');
    expect(code(() => normalizeSteps({ checked: ['plea.guide'] }))).toBe('bad_steps');
    expect(code(() => normalizeSteps({ share_stage: 'yes' }))).toBe('bad_steps');
    expect(code(() => normalizeSteps({}))).toBe('bad_steps');
    expect(code(() => normalizeSteps(null))).toBe('bad_steps');
  });
  it('a stored list keeps only known, hand-ticked items', () => {
    expect(cleanChecked({ 'plea.guide': true, 'x.y': true, 'pretrial.next_date': true, 'arrest.silent': false })).toEqual({ 'plea.guide': true });
    expect(cleanChecked(null)).toEqual({});
  });
});

describe('court posted rules', () => {
  it('every row is the court\'s own https page with a checked date and known topics', () => {
    expect(COURT_RULES.length).toBeGreaterThan(0);
    for (const r of COURT_RULES) {
      expect(r.url).toMatch(/^https:\/\/[a-z.]+\.(gov|org)\//);
      expect(r.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.court.length).toBeGreaterThan(5);
      expect(r.covers.length).toBeGreaterThan(0);
      for (const c of r.covers) expect(COVERS).toContain(c);
      // the app shows each topic in the person's language
      for (const l of SUPPORTED_LANGS) for (const c of r.covers) expect(typeof app[l][`cgd_cover_${c}`]).toBe('string');
    }
    expect(new Set(COURT_RULES.map(r => r.id)).size).toBe(COURT_RULES.length);
  });
  it('matches by state and county; unlisted courts and court dates without a courthouse get none', () => {
    expect(courtRulesFor({ state: 'TN', county: 'Davidson' }).map(r => r.id)).toEqual([
      'tn-davidson-general-sessions-dress', 'tn-davidson-general-sessions-security', 'tn-davidson-trial-courts-dress']);
    expect(courtRulesFor({ state: 'tn', county: 'davidson county' }).length).toBe(3);
    expect(courtRulesFor({ state: 'TN', county: 'Knox' }).map(r => r.id)).toEqual(['tn-knox-general-sessions']);
    expect(courtRulesFor({ state: 'OH', county: 'Hamilton' })).toEqual([]);   // same county name, other state
    expect(courtRulesFor({ state: 'TN', county: 'Shelby' })).toEqual([]);     // not verified: left out
    expect(courtRulesFor({ state: 'TN', county: 'Hamilton' })).toEqual([]);   // only civil guidelines found
    expect(courtRulesFor({ state: 'TN' })).toEqual([]);
    expect(courtRulesFor(null)).toEqual([]);
  });
  it('the court-day plan has "Clothes ready" in every language', () => {
    expect(PLAN_ITEMS).toContain('clothes');
    for (const l of SUPPORTED_LANGS) { expect(typeof app[l].cdp_item_clothes).toBe('string'); expect(typeof app[l].cdp_hint_clothes).toBe('string'); }
  });
});

describe('server text', () => {
  const KEYS = ['reminder.push.guide_hint', 'guidance.src.tn_dhs', 'cst.err.bad_case', 'cst.err.not_found', 'cst.err.bad_steps',
    'cst.err.bad_stage', 'cst.err.bad_item', 'cst.err.too_many', 'cst.err.server'];
  it.each(SUPPORTED_LANGS)('%s has every new string, translated', (l) => {
    for (const k of KEYS) {
      expect([l, k, typeof CATALOGS[l][k]]).toEqual([l, k, 'string']);
      if (l !== 'en') expect([l, k, msg(l, k) === msg('en', k)]).toEqual([l, k, false]);
    }
    expect(msg(l, 'reminder.push.guide_hint')).toContain('Justice Gavel');
    expect(msg(l, 'reminder.push.guide_hint')).not.toMatch(/\d/);
    // the wear line and its source are the app's words, and say nothing about colours
    expect(msg(l, 'guidance.wear.1')).toBe(app[l].cg_wear_1);
    expect(msg(l, 'guidance.src.tn_dhs')).toBe(app[l].cg_src_tn_dhs);
    expect(msg(l, 'guidance.wear.1')).not.toMatch(/orange|naranja|laranja|cam\b|zoranj|橙|البرتقالي/i);
  });
});
