/**
 * app.config.js — dynamic layer over app.json (Expo reads both).
 *
 * - Firebase config files are owner-supplied and not in the repo. Only
 *   reference them when they exist, so `expo prebuild` / EAS builds don't fail
 *   before the owner adds them (push notifications on Android need
 *   google-services.json; iOS APNs works without GoogleService-Info.plist).
 * - Runtime values come from EXPO_PUBLIC_* environment variables (EAS env /
 *   .env), never from committed keys. Stripe is optional: with an empty
 *   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY the app runs with payments disabled.
 */
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const exists = (rel) => !!rel && fs.existsSync(path.resolve(__dirname, rel));

  const ios = { ...config.ios };
  if (!exists(ios.googleServicesFile)) delete ios.googleServicesFile;

  const android = { ...config.android };
  if (!exists(android.googleServicesFile)) delete android.googleServicesFile;

  // Apple Pay / Google Pay config (merchant ID entitlement) is only added once
  // Stripe is actually configured; until then payments show "coming soon".
  const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  const plugins = (config.plugins || []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return stripeKey || name !== '@stripe/stripe-react-native';
  });

  // EAS project: `extra.eas.projectId` is a placeholder until the owner runs
  // `eas init`. Until then OTA updates are disabled (no valid update URL), and
  // local `expo start` / `expo export` / prebuild work normally.
  const projectId = config.extra?.eas?.projectId;
  const hasEasProject = !!projectId && !String(projectId).startsWith('PENDING');
  const updates = hasEasProject
    ? { ...config.updates, url: `https://u.expo.dev/${projectId}` }
    : { ...config.updates, enabled: false };
  if (!hasEasProject) delete updates.url;
  const extraEas = hasEasProject ? config.extra.eas : { ...config.extra?.eas, projectId: undefined };

  return {
    ...config,
    updates,
    ios,
    android,
    plugins,
    extra: {
      ...config.extra,
      eas: extraEas,
      apiBase: process.env.EXPO_PUBLIC_API_BASE || config.extra?.apiBase || 'https://api.justicegavel.app/api',
      stripePublishableKey: stripeKey,
    },
  };
};
