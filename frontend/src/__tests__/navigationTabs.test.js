/**
 * navigationTabs.test.js — tab wiring (sandbox review 2026-11-12, bug 1).
 *
 * The Resources tab used to open on HomeScreen, so two tabs showed the same page,
 * and screens opened from Home were pushed onto the Resources tab (which then
 * looked selected). These checks keep the fix in place.
 */
const fs = require('fs');
const path = require('path');

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const nav = src('navigation/AppNavigator.tsx');
const home = src('screens/HomeScreen.tsx');

describe('bottom tabs', () => {
  it('the Resources tab (MoreTab) opens on the Resources screen, not Home', () => {
    expect(nav).toMatch(/function MoreNavigator\(\)\s*\{\s*return <SectionStack initial="Resources" \/>/);
    expect(nav).toMatch(/<Tab\.Screen name="MoreTab"\s+component=\{MoreNavigator\}/);
  });

  it('the Home tab is a stack that opens on HomeScreen', () => {
    expect(nav).toMatch(/function HomeNavigator\(\)\s*\{\s*return <SectionStack initial="MoreHome" \/>/);
    expect(nav).toMatch(/<Tab\.Screen name="HomeTab"\s+component=\{HomeNavigator\}/);
    expect(nav).toMatch(/name="MoreHome"\s+component=\{HomeScreen\}/);
  });

  it('a Resources screen is registered in the shared stack', () => {
    expect(nav).toMatch(/<MoreStack\.Screen name="Resources"\s+component=\{ResourcesScreen\}/);
  });

  it('Home opens its screens in its own stack, never on the Resources tab', () => {
    expect(home).not.toMatch(/navigate\(\s*'MoreTab'/);
  });
});
