// JUSTICE GAVEL - BRUTAL TRIALS v78 (rebuilt - corpus repaired after Hague addition)
// Original tests preserved in spirit; file rebuilt after corruption from route-count replacements.
import { jest } from '@jest/globals';

describe('v78. Corpus integrity (rebuilt)', () => {
  test('v78-01: hague_contacts route is mounted', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/app.js', 'utf8');
    expect(src).toContain('/api/hague-contacts');
  });
  test('v78-02: hague_intakes table exists', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    expect(src).toContain('hague_intakes');
  });
  test('v78-03: 56 DB tables total', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.length).toBe(56);
  });
});
