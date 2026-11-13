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

  it('Home opens its own links in its own stack (only a queued start screen goes to MoreTab)', () => {
    const toMore = home.match(/navigate\(\s*'MoreTab'[^\n]*/g) || [];
    expect(toMore).toHaveLength(1);
    expect(toMore[0]).toContain('screen: p.screen');
  });

  it('tab buttons drop the web href (a link made every tap reload the app; Resources reloaded onto Home)', () => {
    expect(nav).toMatch(/function TabButton\(\{ href: _href, \.\.\.props \}: any\)/);
    for (const id of ['home-tab', 'rights-tab', 'help-tab', 'court-tab', 'more-tab']) {
      expect(nav).toContain(`<TabButton testID="${id}" {...props} />`);
    }
    expect(nav).not.toMatch(/tabBarButton: \(props: any\) => <TouchableOpacity/);
  });
});
