/**
 * modules/index.js — Route module registry
 * Groups 101 route files into 10 logical modules for maintainability.
 */
export const MODULE_MAP = {
  auth:    ['auth','refresh_tokens'],
  cases:   ['cases','case_events','expungement'],
  matters: ['matters','conflicts','docket','checkins'],
  people:  ['lawyers','providers','bail','saved'],
  billing: ['billing/webhooks','billing/bondsman','billing/_shared'],
  ai:      ['chat/ask','chat/stream','chat/history','research'],
  firm:    ['firms','firm_members','firm_acquisition'],
  comms:   ['messages','alerts','push'],
  video:   ['video'],
  admin:   ['admin','analytics'],
};
