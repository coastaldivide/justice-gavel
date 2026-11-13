/**
 * webPaths.test.tsx — web URLs for the Home stack (sandbox review 2026-11-12).
 * Home became a stack so screens opened from it stay on the Home tab; its screens
 * get "/home/…" paths, while the Resources tab keeps the plain ones.
 */
import { getStateFromPath, getPathFromState } from '@react-navigation/native';
import { linking } from '../../navigation/linking';

const config = linking.config as any;
const tabs = config.screens.MainTabs.screens;
const leaf = (st: any): string[] => {
  let r = st.routes[st.index ?? st.routes.length - 1];
  const names = [r.name];
  while (r.state) { r = r.state.routes[r.state.index ?? r.state.routes.length - 1]; names.push(r.name); }
  return names;
};

describe('web paths', () => {
  it('the Home stack has its own paths: "/" and "/home/…"', () => {
    expect(tabs.HomeTab.path).toBe('');
    expect(tabs.HomeTab.screens.MoreHome).toBe('');
    expect(tabs.HomeTab.screens.QuickConnect).toBe('home/quick-connect');
    expect(tabs.HomeTab.screens.Resources).toBe('home/resources');
  });

  it('"/resources" opens the Resources tab; "/home/quick-connect" stays on Home', () => {
    expect(leaf(getStateFromPath('/resources', config))).toEqual(['MainTabs', 'MoreTab', 'Resources']);
    expect(leaf(getStateFromPath('/quick-connect', config))).toEqual(['MainTabs', 'MoreTab', 'QuickConnect']);
    expect(leaf(getStateFromPath('/home/quick-connect', config))).toEqual(['MainTabs', 'HomeTab', 'QuickConnect']);
    expect(leaf(getStateFromPath('/', config))).toEqual(['MainTabs', 'HomeTab', 'MoreHome']);
  });

  it('Quick Connect opened from Home gets a /home/… URL', () => {
    const state: any = { routes: [{ name: 'MainTabs', state: { routes: [{ name: 'HomeTab', state: { index: 1, routes: [{ name: 'MoreHome' }, { name: 'QuickConnect' }] } }] } }] };
    expect(getPathFromState(state, config)).toBe('/home/quick-connect');
  });
});
