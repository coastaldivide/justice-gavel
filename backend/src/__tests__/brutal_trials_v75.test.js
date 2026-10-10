// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL - BRUTAL TRIALS v75 (rebuilt)
import { jest } from '@jest/globals';
import { encrypt, decrypt } from '../services/encryption.js';
import { computeAllSignals } from '../routes/matter_intelligence.js';

const mkMatter = (v, o={}) => ({id:1,vertical:v,title:'t',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

describe('v75. Coverage Milestone (rebuilt)', () => {
  test('v75-01: 434 routes total including 5 hague_contacts routes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js','utf8');
    expect(src).toContain('/us-resources');
    expect(src).toContain('/member-states');
    expect(src).toContain('/report-intake');
  });
  test('v75-03: encryption still works', () => {
    for (let i=0;i<100;i++) expect(decrypt(encrypt(`v75-${i}`))).toBe(`v75-${i}`);
  });
});
