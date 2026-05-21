// JUSTICE GAVEL — BRUTAL TRIALS v149
// TARGET: billing/bondsman(6) + push(5) + firms(5) + hague(5) + time(5)
//         + recap(5) + caldav(5) + practice-mgmt(4) + checkins(4)
//         + integrations/index(4) + bot_admin(4) + contracts/review(4)

import { jest } from '@jest/globals';
let encrypt, decrypt, BUSINESS_CONSTANTS;
beforeAll(async () => {
  const enc=await import('../services/encryption.js');
  encrypt=enc.encrypt; decrypt=enc.decrypt;
  const rh=await import('../utils/routeHelpers.js');
  BUSINESS_CONSTANTS=rh.BUSINESS_CONSTANTS;
});

describe('BND_B. billing/bondsman.js — 6 Routes → ≥15', () => {
  test('BND_B-01: GET/POST bondsman/verified-badge + cancel', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(s).toContain("router.get('/bondsman/verified-badge/status'");
    expect(s).toContain("router.post('/bondsman/verified-badge/subscribe'");
    expect(s).toContain("router.post('/bondsman/verified-badge/cancel'");
    // Verified badge subscription: monthly fee for trust indicator on listing
  });
  test('BND_B-02: GET/POST bondsman/profile + POST /leads/:id/accept', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(s).toContain("router.get('/bondsman/profile'");
    expect(s).toContain("router.post('/bondsman/profile'");
    expect(s).toContain("router.post('/leads/:id/accept'");
  });
});

describe('PSH_B. push.js — 5 Routes → ≥15', () => {
  test('PSH_B-01: POST /d7-reengage + POST /receipts + GET/POST /preferences', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/push.js','utf8');
    expect(s).toContain("router.post('/d7-reengage'");
    expect(s).toContain("router.post('/receipts'");
    expect(s).toContain("router.get('/preferences'");
    expect(s).toContain("router.post('/preferences'");
    // receipts: Expo push receipt check (delivery confirmation)
  });
  test('PSH_B-02: POST /retention/post-purchase — post-purchase retention push', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/push.js','utf8');
    expect(s).toContain("router.post('/retention/post-purchase'");
    // Sends onboarding sequence after first consultation purchase
  });
});

describe('FRM_A. firms.js — 5 Routes → ≥15', () => {
  test('FRM_A-01: POST invite + POST accept-invite + DELETE/PATCH /:id/members/:uid', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firms.js','utf8');
    expect(s).toContain("router.post('/:id/members/invite'");
    expect(s).toContain("router.post('/accept-invite'");
    expect(s).toContain("router.delete('/:id/members/:uid'");
    expect(s).toContain("router.patch('/:id/members/:uid'");
    // Full member lifecycle: invite → accept → update role → remove
  });
  test('FRM_A-02: GET /:id/audit — firm audit trail', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firms.js','utf8');
    expect(s).toContain("router.get('/:id/audit'");
    // Firm-level audit log: all member actions + matter changes
  });
});

describe('HAG_B. hague_contacts + time + recap + caldav → ≥15', () => {
  test('HAG_B-01: hague all 5 routes', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js','utf8');
    expect(s).toContain("router.get('/us-resources'");
    expect(s).toContain("router.get('/member-states'");
    expect(s).toContain("router.post('/report-intake'");
    expect(s).toContain("router.get('/central-authority/:countryCode'");
    expect(s).toContain("router.get('/intake/:caseId'");
  });
  test('HAG_B-02: time invoices pdf + billing-summary + aba-codes + invoices CRUD', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/time.js','utf8');
    expect(s).toContain("router.get('/invoices/:id/pdf'");
    expect(s).toContain("router.get('/matter/:matterId/billing-summary'");
    expect(s).toContain("router.get('/aba-codes'");
    expect(s).toContain("router.get('/invoices/:id'");
    expect(s).toContain("router.put('/invoices/:id'");
  });
  test('HAG_B-03: recap all 5 routes', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(s).toContain("router.get('/status/:matterId'");
    expect(s).toContain("router.delete('/unlink/:matterId'");
    expect(s).toContain("router.post('/link'");
    expect(s).toContain("router.post('/refresh/:matterId'");
    expect(s).toContain("router.post('/import/:matterId'");
  });
  test('HAG_B-04: caldav ical-token + push/matter + ical + DELETE events + push entryId', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/integrations/caldav.js','utf8');
    expect(s).toContain("router.get('/ical-token/:firmId'");
    expect(s).toContain("router.post('/push/matter/:matterId'");
    expect(s).toContain("router.get('/ical/:firmId'");
    expect(s).toContain("router.delete('/events/:uid'");
    expect(s).toContain("router.post('/push/:entryId'");
  });
});

describe('MISC_C. practice-mgmt + checkins + integrations-index + bot_admin + review → ≥15', () => {
  test('MISC_C-01: practice-mgmt contacts + invoices + matters + time push', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/integrations/practice-mgmt.js','utf8');
    expect(s).toContain("router.get('/contacts'");
    expect(s).toContain("router.post('/invoices/:invoiceId/push'");
    expect(s).toContain("router.post('/matters/:matterId/push'");
    expect(s).toContain("router.post('/time/:matterId/push'");
  });
  test('MISC_C-02: checkins history + status + enrollments + my', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js','utf8');
    expect(s).toContain("router.get('/history/:enrollmentId'");
    expect(s).toContain("router.get('/status/:enrollmentId'");
    expect(s).toContain("router.put('/enrollments/:id'");
    expect(s).toContain("router.get('/my/:enrollmentId'");
  });
  test('MISC_C-03: integrations/index catalogue + oauth + sync/log + sync', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/integrations/index.js','utf8');
    expect(s).toContain("router.get('/catalogue'");
    expect(s).toContain("router.get('/oauth/callback'");
    expect(s).toContain("router.get('/:provider/sync/log'");
    expect(s).toContain("router.post('/:provider/sync'");
  });
  test('MISC_C-04: bot_admin revenue + opt-outs + expire-links + opt-out', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/bot_admin.js','utf8');
    expect(s).toContain("router.get('/revenue'");
    expect(s).toContain("router.get('/opt-outs'");
    expect(s).toContain("router.post('/expire-links'");
    expect(s).toContain("router.post('/opt-out'");
    // opt-out: TCPA manual opt-out override by admin
  });
  test('MISC_C-05: contracts/review redline + history + negotiate + review/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/contracts/review.js','utf8');
    expect(s).toContain("router.get('/redline/:id'");
    expect(s).toContain("router.get('/review/history'");
    expect(s).toContain("router.post('/:id/negotiate'");
    expect(s).toContain("router.get('/review/:id'");
    // negotiate: counter-proposal in AI contract negotiation flow
  });
});

describe('Regression v149', () => {
  test('R-01: 500K encrypt', () => {
    let e=0;
    for (let i=0;i<500000;i++) if(decrypt(encrypt(`v149_${i}`))!==`v149_${i}`) e++;
    expect(e).toBe(0);
  });
});
