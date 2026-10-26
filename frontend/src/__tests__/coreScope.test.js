/**
 * coreScope.test.js — the consumer app is the core path (constants/features.ts).
 */
const fs = require('fs');
const path = require('path');
const f = require('../constants/features');

const SRC = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('feature scope', () => {
  it('is core-only unless EXPO_PUBLIC_FULL_APP=1', () => {
    expect(f.CORE_ONLY).toBe(process.env.EXPO_PUBLIC_FULL_APP !== '1');
  });

  it('keeps the whole core path open to everyone, signed in or not', () => {
    for (const s of ['JustArrested', 'RightsCard', 'HelpNow', 'CourtDates', 'CourtDateDetail', 'Expungement',
      'EmergencyShare', 'Bail', 'LawyerProfile', 'CrisisResources', 'Booking', 'ConsumerSubscription']) {
      expect(f.isScreenEnabled(s, '')).toBe(true);
      expect(f.isScreenEnabled(s, 'user')).toBe(true);
    }
  });

  it('parks bar prep, firm tools and unsourced features for everyone', () => {
    for (const s of ['BarPrepHome', 'FirmAcquisition', 'GoldenGavel', 'Insurance', 'ChildSupport', 'ArrestMonitor']) {
      expect(f.isScreenEnabled(s, 'user')).toBe(!f.CORE_ONLY);
      expect(f.isScreenEnabled(s, 'attorney')).toBe(!f.CORE_ONLY);
    }
  });

  it('shows professional tools to professional accounts only', () => {
    for (const s of ['AttorneyDashboard', 'BondDesk', 'BondsmanDashboard', 'LegalResearch']) {
      expect(f.isScreenEnabled(s, 'user')).toBe(!f.CORE_ONLY);
      expect(f.isScreenEnabled(s, 'attorney')).toBe(true);
    }
    expect(f.isScreenEnabled('BondDesk', 'bail_agent')).toBe(true);
  });

  it('every parked / pro screen name is a registered screen', () => {
    const nav = read('navigation/AppNavigator.tsx');
    for (const s of [...f.PARKED_SCREENS, ...f.PRO_SCREENS]) {
      expect(nav).toMatch(new RegExp(`name="${s}"`));
    }
  });

  it('the tab bar is Home, My rights, Get help, Court dates, More', () => {
    const nav = read('navigation/AppNavigator.tsx');
    const visible = [...nav.matchAll(/<Tab\.Screen name="(\w+)"[^\n]*/g)]
      .filter(m => !/tabBarButton: \(\) => null/.test(m[0])).map(m => m[1]);
    expect(visible).toEqual(['HomeTab', 'RightsTab', 'HelpTab', 'CourtTab', 'MoreTab']);
    expect(nav).toMatch(/screenLayout=\{\(\{ children, route \}\) => <CoreOnlyGate/);
  });

  it('every tab has a link path (a tab missing from linking.ts ignores presses on the web)', () => {
    const nav = read('navigation/AppNavigator.tsx');
    const linking = read('navigation/linking.ts');
    for (const m of nav.matchAll(/<Tab\.Screen name="(\w+)"/g)) expect(linking).toMatch(new RegExp(`\\b${m[1]}:`));
  });

  it('the four large Home tiles are the core path', () => {
    const home = read('screens/HomeScreen.tsx');
    const primary = [...home.matchAll(/\{ key: '(\w+)'[^\n]*primary: true/g)].map(m => m[1]);
    expect(primary).toEqual(['Rights', 'GetHelp', 'CourtDates', 'Expunge']);
    expect(home).toMatch(/isScreenEnabled\(tileScreen\(tile\.nav\), role\)/);
  });

  it('tileScreen maps Home tile targets to screen names', () => {
    expect(f.tileScreen('More:BarPrepHome')).toBe('BarPrepHome');
    expect(f.tileScreen('LawyersTab')).toBe('LawyersTab');
  });
});
