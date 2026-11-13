/**
 * planFeatures.test.js — plan cards list only features this build shows
 * (sandbox review 2026-11-12, review item B). The default build is the consumer
 * core path (EXPO_PUBLIC_FULL_APP unset), which parks bar prep and the arrest monitor.
 */
jest.mock('../services/api', () => ({ unwrapList: (b, k) => (Array.isArray(b) ? b : (b && b[k]) || []) }));
jest.mock('../i18n', () => ({ t: (k) => k }));

const { shownFeatures, consumerPlansFrom } = require('../services/plans');

const ALL = ['ai_chat_unlimited', 'legal_research', 'bar_prep', 'interpreter', 'audio_transcription', 'video_consultation', 'arrest_monitor'];

describe('plan features in the core build', () => {
  it('drops bar prep and the arrest monitor, keeps the rest in order', () => {
    expect(shownFeatures(ALL)).toEqual(['ai_chat_unlimited', 'legal_research', 'interpreter', 'audio_transcription', 'video_consultation']);
  });
  it('plan cards built from the server list use the filtered features', () => {
    const body = { tiers: [{ key: 'legal_pro', audience: 'consumer', billing: 'monthly', name: 'Legal Pro', display_price: '$19.99/mo', monthly_cents: 1999, trial_days: 7, features: ALL }] };
    const [plan] = consumerPlansFrom(body);
    expect(plan.features).not.toContain('bar_prep');
    expect(plan.features).not.toContain('arrest_monitor');
    expect(plan.features).toContain('video_consultation');
  });
});
