// JUSTICE GAVEL — BRUTAL TRIALS v146
// TARGET: hague_contacts(4) + checkins(4) + practice-mgmt(4) + push(3)
//         arrests(3) + billing/bondsman(3) + caldav(3) + integrations/index(3)
//         webhooks/outbound(3) + contracts/review(3) + research(2)
//         audit(2) + firms(2) + messages(2) + lessons(2)

import { jest } from '@jest/globals';
let encrypt, decrypt, BUSINESS_CONSTANTS, CONFIG;
beforeAll(async () => {
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const rh = await import('../utils/routeHelpers.js');
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

describe('HAG_A. hague_contacts.js — 4 Routes PUSH ≥10', () => {
  test('HAG_A-01: GET /us-resources + GET /member-states', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js','utf8');
    expect(s).toContain("router.get('/us-resources'");
    expect(s).toContain("router.get('/member-states'");
    // us-resources: US Central Authority + support orgs for Hague cases
    // member-states: all Hague Convention signatory countries
  });
  test('HAG_A-02: GET /central-authority/:countryCode + GET /intake/:caseId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js','utf8');
    expect(s).toContain("router.get('/central-authority/:countryCode'");
    expect(s).toContain("router.get('/intake/:caseId'");
  });
});

describe('CHK_A. checkins.js — 4 Routes PUSH ≥10', () => {
  test('CHK_A-01: GET /history/:enrollmentId + GET /status/:enrollmentId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js','utf8');
    expect(s).toContain("router.get('/history/:enrollmentId'");
    expect(s).toContain("router.get('/status/:enrollmentId'");
    // Pretrial check-in history: GPS log + compliance record
  });
  test('CHK_A-02: PUT /enrollments/:id + GET /my/:enrollmentId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js','utf8');
    expect(s).toContain("router.put('/enrollments/:id'");
    expect(s).toContain("router.get('/my/:enrollmentId'");
  });
});

describe('PM_A. integrations/practice-mgmt.js — 4 Routes PUSH ≥10', () => {
  test('PM_A-01: GET /contacts + POST /invoices/:invoiceId/push', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/practice-mgmt.js','utf8');
    expect(s).toContain("router.get('/contacts'");
    expect(s).toContain("router.post('/invoices/:invoiceId/push'");
    // contacts: sync contacts from PM; invoice push: send invoice to PM billing
  });
  test('PM_A-02: POST /matters/:matterId/push + POST /time/:matterId/push', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/practice-mgmt.js','utf8');
    expect(s).toContain("router.post('/matters/:matterId/push'");
    expect(s).toContain("router.post('/time/:matterId/push'");
  });
});

describe('PSH_A. push.js — 3 Routes PUSH ≥10', () => {
  test('PSH_A-01: POST /d7-reengage + GET/POST /preferences', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/push.js','utf8');
    expect(s).toContain("router.post('/d7-reengage'");
    expect(s).toContain("router.get('/preferences'");
    expect(s).toContain("router.post('/preferences'");
    // d7-reengage: day-7 lapsed user re-engagement push campaign
    // preferences: manage push notification opt-ins per category
  });
});

describe('ARR_A. arrests.js — 3 Routes PUSH ≥10', () => {
  test('ARR_A-01: POST /send-alerts + GET /stats/county/:county', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/arrests.js','utf8');
    expect(s).toContain("router.post('/send-alerts'");
    expect(s).toContain("router.get('/stats/county/:county'");
    // send-alerts: manually trigger arrest notification to bondsmen
    // stats: county arrest stats for bondsman market analysis
  });
  test('ARR_A-02: DELETE /monitors/:id — remove arrest monitor', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/arrests.js','utf8');
    expect(s).toContain("router.delete('/monitors/:id'");
  });
});

describe('BND_A. billing/bondsman.js — 3 Routes PUSH ≥10', () => {
  test('BND_A-01: GET/POST /bondsman/verified-badge + POST /cancel', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(s).toContain("router.get('/bondsman/verified-badge/status'");
    expect(s).toContain("router.post('/bondsman/verified-badge/subscribe'");
    expect(s).toContain("router.post('/bondsman/verified-badge/cancel'");
    // Verified badge: premium bondsman listing with trust indicator
  });
});

describe('CAL_A. integrations/caldav.js — 3 Routes PUSH ≥10', () => {
  test('CAL_A-01: GET /ical-token/:firmId + POST /push/matter/:matterId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/caldav.js','utf8');
    expect(s).toContain("router.get('/ical-token/:firmId'");
    expect(s).toContain("router.post('/push/matter/:matterId'");
    // ical-token: generates iCal feed token for calendar subscription
    // push/matter: syncs all matter deadlines to calendar
  });
  test('CAL_A-02: GET /ical/:firmId — iCal feed endpoint', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/caldav.js','utf8');
    expect(s).toContain("router.get('/ical/:firmId'");
    // Returns .ics file subscribed to by Apple/Google/Outlook
  });
});

describe('INT_A. integrations/index.js — 3 Routes PUSH ≥10', () => {
  test('INT_A-01: GET /catalogue + GET /oauth/callback + GET /:provider/sync/log', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/index.js','utf8');
    expect(s).toContain("router.get('/catalogue'");
    expect(s).toContain("router.get('/oauth/callback'");
    expect(s).toContain("router.get('/:provider/sync/log'");
    // catalogue: all available integrations + connection status
    // oauth/callback: handles OAuth return from DMS/PM systems
    // sync/log: integration sync history per provider
  });
});

describe('WBO_A. webhooks/outbound.js — 3 Routes PUSH ≥10', () => {
  test('WBO_A-01: GET /deliveries/:subId + POST /deliveries/:id/retry', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(s).toContain("router.get('/deliveries/:subId'");
    expect(s).toContain("router.post('/deliveries/:id/retry'");
  });
  test('WBO_A-02: POST /subscriptions/:id/test — test-fire webhook', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(s).toContain("router.post('/subscriptions/:id/test'");
  });
});

describe('CRV_A. contracts/review.js — 3 Routes PUSH ≥10', () => {
  test('CRV_A-01: GET /redline/:id + GET /review/history + GET /review/:id', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/review.js','utf8');
    expect(s).toContain("router.get('/redline/:id'");
    expect(s).toContain("router.get('/review/history'");
    expect(s).toContain("router.get('/review/:id'");
    // redline: tracked-changes version of AI-reviewed contract
  });
});

describe('RES_A. research.js — 2 Routes PUSH ≥10', () => {
  test('RES_A-01: DELETE /session/:id + GET /session/:id', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/research.js','utf8');
    expect(s).toContain("router.delete('/session/:id'");
    expect(s).toContain("router.get('/session/:id'");
    // research sessions: AI legal research conversation history
  });
});

describe('MISC_A. audit(2) + firms(2) + messages(2) + lessons(2) PUSH ≥10', () => {
  test('MISC_A-01: audit.js GET /contract/:id + GET /user/:id', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/audit.js','utf8');
    expect(s).toContain("router.get('/contract/:id'");
    expect(s).toContain("router.get('/user/:id'");
    // Audit trails: contract change history + user action log
  });
  test('MISC_A-02: firms.js POST /:id/members/invite + POST /accept-invite', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/firms.js','utf8');
    expect(s).toContain("router.post('/:id/members/invite'");
    expect(s).toContain("router.post('/accept-invite'");
    // Firm membership: invite + accept flow
  });
  test('MISC_A-03: messages.js POST /:caseId/read + POST /attachment', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/messages.js','utf8');
    expect(s).toContain("router.post('/:caseId/read'");
    expect(s).toContain("router.post('/attachment'");
    // read: mark messages as read; attachment: upload file to thread
  });
  test('MISC_A-04: lessons.js GET /progress/:userId + GET /progress/me', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/lessons.js','utf8');
    expect(s).toContain("router.get('/progress/:userId'");
    expect(s).toContain("router.get('/progress/me'");
    // Know Your Rights progress tracking per user
  });
});

describe('Regression', () => {
  test('R-01: 500K encrypt', () => {
    let e=0;
    for (let i=0;i<500000;i++) if(decrypt(encrypt(`v146_${i}`))!==`v146_${i}`) e++;
    expect(e).toBe(0);
  });
});
