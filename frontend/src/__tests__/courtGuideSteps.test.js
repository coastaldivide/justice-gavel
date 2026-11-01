/**
 * courtGuideSteps.test.js — "Going to court: how to dress and act" and "Your case, step by step"
 * (constants/courtGuide.ts, constants/caseSteps.ts, constants/guideSources.ts, services/caseSteps.ts).
 *
 *   content   every section / stage / item has its words in all eight languages
 *   sources   every section and stage names sources; each is an official https page with a checked
 *             date (or the app's own sourced content); every source is used
 *   no rules  no number with a time unit (no invented deadline), no dollar figure, no "orange",
 *             nothing saying clothes change how a case turns out
 *   buttons   every stage button opens a screen the app has and the consumer app shows
 *   guest     progress saved on the phone and read back; court dates on the phone tick their items
 *   push      the day-before reminder opens the guide for its court date
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  const api = {
    getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k, v) => { store[k] = v; }),
    removeItem: jest.fn(async (k) => { delete store[k]; }),
    clear: jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
  };
  return { __esModule: true, default: api };
});
jest.mock('../services/api', () => ({ api: { get: jest.fn(), put: jest.fn() } }));

const fs = require('fs');
const path = require('path');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const { COURT_GUIDE, guideItemKeys, COVER_KEYS } = require('../constants/courtGuide');
const { CASE_STAGES, ACTION_TARGETS, AUTO_ITEMS, ALL_ITEM_IDS } = require('../constants/caseSteps');
const { GUIDE_SOURCES } = require('../constants/guideSources');
const { PARKED_SCREENS, PRO_SCREENS } = require('../constants/features');
const steps = require('../services/caseSteps');
const { api } = require('../services/api');

const LANGS = ['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl'];
const files = Object.fromEntries(LANGS.map(l => [l, JSON.parse(fs.readFileSync(path.join(__dirname, `../i18n/${l}.json`), 'utf8'))]));

const guideKeys = () => COURT_GUIDE.flatMap(s => [`cgd_${s.id}_title`, ...guideItemKeys(s), ...(s.noteKey ? [s.noteKey] : [])]);
const stageKeys = () => CASE_STAGES.flatMap(s => [`cst_${s.id}_title`, `cst_${s.id}_body`, ...s.items.map(i => `cst_${s.id}_${i}`)]);

describe('content in every language', () => {
  it('eight guide sections in the order the person needs them, 2–6 items each', () => {
    expect(COURT_GUIDE.map(s => s.id)).toEqual(['wear', 'bring', 'security', 'inside', 'say', 'children', 'late', 'after']);
    for (const s of COURT_GUIDE) { expect(s.count).toBeGreaterThanOrEqual(2); expect(s.count).toBeLessThanOrEqual(6); }
  });
  it('nine stages from arrest to clearing a record, 3–6 items each', () => {
    expect(CASE_STAGES.map(s => s.id)).toEqual(['arrest', 'release', 'first', 'lawyer', 'pretrial', 'plea', 'sentence', 'probation', 'record']);
    for (const s of CASE_STAGES) { expect(s.items.length).toBeGreaterThanOrEqual(3); expect(s.items.length).toBeLessThanOrEqual(6); }
    for (const a of AUTO_ITEMS) expect(ALL_ITEM_IDS).toContain(a);
  });
  it.each(LANGS)('%s: every guide and stage string exists and is not empty', (l) => {
    const keys = [...guideKeys(), ...stageKeys(), ...Object.values(COVER_KEYS), ...Object.values(ACTION_TARGETS).map(a => a.label),
      'cgd_title', 'cgd_label', 'cst_title', 'cst_label', 'cgd_sources', 'cgd_checked', 'cdp_item_clothes', 'home_tile_CaseSteps', 'ja_what_next'];
    const missing = keys.filter(k => typeof files[l][k] !== 'string' || !files[l][k].trim());
    expect(missing).toEqual([]);
    if (l !== 'en') expect(keys.filter(k => files[l][k] === files.en[k])).toEqual([]);
  });
  it('the label says general information, not legal advice, not reviewed by a lawyer', () => {
    expect(files.en.cgd_label).toMatch(/General information — not legal advice — not reviewed by a lawyer/);
    expect(files.en.cst_label).toMatch(/General information — not legal advice — not reviewed by a lawyer/);
  });
});

describe('sources', () => {
  const used = new Set([...COURT_GUIDE.flatMap(s => s.sources), ...CASE_STAGES.flatMap(s => s.sources)]);
  it('every section and stage names at least one source, and each source is real', () => {
    for (const s of [...COURT_GUIDE, ...CASE_STAGES]) {
      expect([s.id, s.sources.length > 0]).toEqual([s.id, true]);
      for (const id of s.sources) expect([s.id, id, !!GUIDE_SOURCES[id]]).toEqual([s.id, id, true]);
    }
  });
  it('each source is an official https page (or the app\'s own sourced content) with the date it was checked', () => {
    for (const [id, s] of Object.entries(GUIDE_SOURCES)) {
      expect([id, s.checked]).toEqual([id, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
      if (s.labelKey) { for (const l of LANGS) expect(typeof files[l][s.labelKey]).toBe('string'); expect(s.url).toBeNull(); continue; }
      expect([id, s.url]).toEqual([id, expect.stringMatching(/^https:\/\/[^/]+\.(gov|org|us|com)\//)]);
      expect(s.org.length).toBeGreaterThan(3); expect(s.page.length).toBeGreaterThan(3);
    }
  });
  it('no source is listed but unused', () => {
    expect(Object.keys(GUIDE_SOURCES).filter(id => !used.has(id))).toEqual([]);
  });
});

describe('no invented rules', () => {
  const texts = (l) => [...guideKeys(), ...stageKeys()].map(k => files[l][k]);
  it.each(LANGS)('%s: no number with a time unit, no money amount, no percentage', (l) => {
    for (const s of texts(l)) {
      expect(s).not.toMatch(/\d+\s*(minutes?|hours?|days?|weeks?|months?|years?|minutos?|horas?|días|dias|semanas?|meses|años|anos|phút|giờ|ngày|tuần|tháng|năm|minit|èdtan|jou|semèn|mwa|lane|minuto|oras|araw|linggo|buwan|taon)\b/i);
      expect(s).not.toMatch(/\d+\s*(分钟|小时|天|周|个月|年|دقيقة|دقائق|ساعة|ساعات|يوم|أيام|أسبوع|شهر|أشهر|سنة|سنوات)/);
      expect(s).not.toMatch(/[$€]\s*\d|\d+\s*%/);
    }
  });
  it('English: no "orange", nothing saying clothes change the outcome', () => {
    const all = texts('en').join(' ');
    expect(all).not.toMatch(/orange/i);
    expect(all).not.toMatch(/outcome|win your case|helps? you win|judge will (like|favor)|better result|look innocent/i);
    expect(files.en.cgd_wear_1).toMatch(/do not need to buy/);
  });
});

describe('stage buttons', () => {
  const nav = fs.readFileSync(path.join(__dirname, '../navigation/AppNavigator.tsx'), 'utf8');
  it('every button opens a registered screen (or tab) that the consumer app shows', () => {
    for (const s of CASE_STAGES) {
      for (const a of s.actions) {
        const t = ACTION_TARGETS[a];
        expect([a, !!t]).toEqual([a, true]);
        if (t.tab) { expect(nav).toContain(`name="${t.screen}"`); continue; }
        expect([a, nav.includes(`name="${t.screen}"`)]).toEqual([a, true]);
        expect([a, PARKED_SCREENS.has(t.screen) || PRO_SCREENS.has(t.screen)]).toEqual([a, false]);
      }
    }
  });
  it('the new screens are registered with their links', () => {
    expect(nav).toMatch(/name="CourtGuide"/);
    expect(nav).toMatch(/name="CaseSteps"/);
    const { linking } = require('../navigation/linking');
    const more = linking.config.screens.MainTabs.screens.MoreTab.screens;
    expect([more.CourtGuide, more.CaseSteps]).toEqual(['court-guide', 'case-steps']);
  });
});

describe('guest progress on the phone', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });
  it('saves and reads back the stage and ticks, dropping unknown and automatic items', async () => {
    expect(await steps.loadGuestSteps()).toMatchObject({ stage: null, checked: {}, auto: {} });
    await steps.saveGuestSteps({ stage: 'pretrial', checked: { 'pretrial.calls': true, 'pretrial.next_date': true, 'nope.x': true } });
    const p = await steps.loadGuestSteps();
    expect(p.stage).toBe('pretrial');
    expect(p.checked).toEqual({ 'pretrial.calls': true });
    expect(JSON.parse(await AsyncStorage.getItem(steps.GUEST_STEPS_KEY)).stage).toBe('pretrial');
  });
  it('a court date saved on the phone ticks "first court date saved" and, while upcoming, "next court date"', async () => {
    const now = new Date(2026, 10, 1, 12, 0, 0);
    await AsyncStorage.setItem('guest_court_dates_v1', JSON.stringify([{ id: 'g1', court_date: '2026-11-20', court_time: null, place: null, notification_ids: [], created_at: now.toISOString() }]));
    expect((await steps.loadGuestSteps(now)).auto).toEqual({ 'first.date_saved': true, 'pretrial.next_date': true });
    expect((await steps.loadGuestSteps(new Date(2026, 11, 1))).auto).toEqual({ 'first.date_saved': true });
  });
  it('a bad saved value reads as no progress', async () => {
    await AsyncStorage.setItem(steps.GUEST_STEPS_KEY, '{not json');
    expect(await steps.loadGuestSteps()).toMatchObject({ stage: null, checked: {} });
  });
});

describe('account progress', () => {
  it('reads and writes /case-steps/:caseId and keeps only known values', async () => {
    api.get.mockResolvedValueOnce({ data: { stage: 'plea', checked: { 'plea.guide': true, 'x.y': true }, auto: { 'pretrial.next_date': true, 'x': true }, share_stage: true } });
    const p = await steps.loadCaseSteps(7);
    expect(api.get).toHaveBeenCalledWith('/case-steps/7');
    expect(p).toMatchObject({ stage: 'plea', checked: { 'plea.guide': true }, auto: { 'pretrial.next_date': true }, share_stage: true });
    api.put.mockResolvedValueOnce({ data: { stage: 'appeal', checked: {}, auto: {}, share_stage: false } });
    expect((await steps.saveCaseSteps(7, { stage: 'sentence' })).stage).toBeNull();   // an unknown stage from anywhere is shown as none
    expect(api.put).toHaveBeenCalledWith('/case-steps/7', { stage: 'sentence' });
  });
});

describe('the day-before reminder', () => {
  const { notificationTarget } = require('../services/notificationRoute');
  it('opens the guide for its court date; other reminders still open the court date', () => {
    expect(notificationTarget({ type: 'court_reminder', screen: 'Cases', court_date_id: 12, guide: 'court', days_before: 1 }))
      .toEqual({ screen: 'CourtGuide', params: { courtDateId: 12 } });
    expect(notificationTarget({ type: 'court_reminder', screen: 'Cases', court_date_id: 12, days_before: 3 }))
      .toEqual({ screen: 'CourtDateDetail', params: { id: 12 } });
  });
});
