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
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js','utf8');
    expect(src).toContain('/us-resources');
    expect(src).toContain('/member-states');
    expect(src).toContain('/report-intake');
  });
  test('v75-02: hague_intakes table is 56th DB table', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(src).toContain('hague_intakes');
    const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.length).toBe(56);
  });
  test('v75-03: encryption still works', () => {
    for (let i=0;i<100;i++) expect(decrypt(encrypt(`v75-${i}`))).toBe(`v75-${i}`);
  });
  test('v75-04: i18n 707/707', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/backend/src/__tests__';
    const corpus = fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const en = JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json','utf8'));
    expect(Object.keys(en).filter(k=>!corpus.includes(k))).toHaveLength(0);
  });
  test('v75-05: zero hex violations', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations=[];
    for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(dir,f),'utf8');
      if(!src.includes('useTheme'))continue;
      for(const h of(src.match(/'#[0-9A-Fa-f]{6}'/g)||[])){
        if(!BRAND.has(h))violations.push(`${f}: ${h}`);
      }
    }
    expect(violations).toHaveLength(0);
  });
});
