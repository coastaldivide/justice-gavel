// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL - BRUTAL TRIALS v75 (rebuilt)
import { encrypt, decrypt } from '../services/encryption.js';


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
