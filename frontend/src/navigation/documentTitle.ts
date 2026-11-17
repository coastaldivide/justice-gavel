/**
 * documentTitle.ts — the browser tab title on the web (NavigationContainer documentTitle).
 *
 * React Navigation's default is the screen's `title` option or, when a screen has none, its
 * route name: Home showed "MoreHome" in the browser tab (sandbox review 2026-11-17,
 * finding 10). Now a screen's title is followed by the app name, and a screen without one
 * shows just the app name — never an internal route name.
 */
export function documentTitleFor(options: { title?: unknown } | undefined, appName: string): string {
  const title = typeof options?.title === 'string' ? options.title.trim() : '';
  return title && title !== appName ? `${title} · ${appName}` : appName;
}
