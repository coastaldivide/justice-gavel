/**
 * The free AI chat allowance is enforced in routes/chat/_helpers.js; the shared
 * constant in utils/routeHelpers.js must say the same number (it once said 5
 * while the server allowed 3).
 */
import { FREE_CHAT_MESSAGES_PER_DAY } from '../routes/chat/_helpers.js';
import * as helpers from '../utils/routeHelpers.js';

test('MAX_FREE_AI_MSGS equals the enforced free chat limit', () => {
  const consts = Object.values(helpers).find(v => v && typeof v === 'object' && 'MAX_FREE_AI_MSGS' in v);
  expect(consts).toBeTruthy();
  expect(consts.MAX_FREE_AI_MSGS).toBe(FREE_CHAT_MESSAGES_PER_DAY);
});
