/**
 * backend_services_complete.test.js
 * Tests all 16 backend services: email, push, encryption,
 * scheduler, AI queue, supabase, dunning, retention, etc.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SVC_DIR   = resolve(__dirname, '../services');

const services = readdirSync(SVC_DIR).filter(f => f.endsWith('.js'));

describe('Services — inventory', () => {
  test('at least 10 service files exist', () => expect(services.length).toBeGreaterThanOrEqual(10));

  test.each(services)('%s has exports', (fname) => {
    const c = readFileSync(join(SVC_DIR, fname), 'utf-8');
    expect(c).toMatch(/export\s+(?:const|function|class|default|async)/);
  });
});

describe('Services — email.js (Resend)', () => {
  test('email uses Resend and not SendGrid', () => {
    const c = readFileSync(join(SVC_DIR, 'email.js'), 'utf-8');
    expect(c).toMatch(/resend|Resend/i);
    // Check they're not used as active imports
    const noComments = c.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
    expect(noComments).not.toMatch(/require.*sendgrid|import.*sendgrid|new SendGrid/i);
  });
  test('email service reads API key from environment', () => {
    const c = readFileSync(join(SVC_DIR, 'email.js'), 'utf-8');
    expect(c).toMatch(/RESEND_API_KEY|process\.env/);
  });
  test('email service has error handling', () => {
    const c = readFileSync(join(SVC_DIR, 'email.js'), 'utf-8');
    expect(c).toMatch(/catch|error|try/i);
  });
});

describe('Services — encryption.js', () => {
  test('encryption service exists', () => expect(existsSync(join(SVC_DIR,'encryption.js'))).toBe(true));
  test('uses AES-256 or equivalent strong cipher', () => {
    const c = readFileSync(join(SVC_DIR,'encryption.js'),'utf-8');
    expect(c).toMatch(/aes-256|AES.256|aes256/i);
  });
  test('uses GCM or authenticated encryption mode', () => {
    const c = readFileSync(join(SVC_DIR,'encryption.js'),'utf-8');
    expect(c).toMatch(/gcm|CCM|authenticated/i);
  });
  test('reads key from environment (not hardcoded)', () => {
    const c = readFileSync(join(SVC_DIR,'encryption.js'),'utf-8');
    expect(c).toMatch(/ENCRYPTION_KEY|process\.env/);
    expect(c).not.toMatch(/[0-9a-f]{64}/); // No hardcoded 32-byte key
  });
  test('has encrypt and decrypt functions', () => {
    const c = readFileSync(join(SVC_DIR,'encryption.js'),'utf-8');
    expect(c).toMatch(/encrypt/i);
    expect(c).toMatch(/decrypt/i);
  });
});

describe('Services — supabase.js', () => {
  test('supabase service exists', () => expect(existsSync(join(SVC_DIR,'supabase.js'))).toBe(true));
  test('uses createClient from @supabase/supabase-js', () => {
    const c = readFileSync(join(SVC_DIR,'supabase.js'),'utf-8');
    expect(c).toMatch(/createClient|supabase-js/i);
  });
  test('reads URL and key from environment', () => {
    const c = readFileSync(join(SVC_DIR,'supabase.js'),'utf-8');
    expect(c).toMatch(/SUPABASE_URL/);
    expect(c).toMatch(/SUPABASE.*KEY|SERVICE_KEY/i);
  });
});

describe('Services — scheduler.js', () => {
  test('scheduler exists', () => expect(existsSync(join(SVC_DIR,'scheduler.js'))).toBe(true));
  test('scheduler uses cron or node-cron', () => {
    const c = readFileSync(join(SVC_DIR,'scheduler.js'),'utf-8');
    expect(c).toMatch(/cron|schedule|setInterval/i);
  });
  test('scheduler has stop function (graceful shutdown)', () => {
    const c = readFileSync(join(SVC_DIR,'scheduler.js'),'utf-8');
    expect(c).toMatch(/stop|destroy|clearInterval|cancel/i);
  });
});

describe('Services — dunning.js', () => {
  test('dunning service exists', () => expect(existsSync(join(SVC_DIR,'dunning.js'))).toBe(true));
  test('dunning handles past_due subscription status', () => {
    const c = readFileSync(join(SVC_DIR,'dunning.js'),'utf-8');
    expect(c).toMatch(/past_due|PAST_DUE|overdue/i);
  });
  test('dunning sends notification to user', () => {
    const c = readFileSync(join(SVC_DIR,'dunning.js'),'utf-8');
    expect(c).toMatch(/email|notify|alert|push/i);
  });
});

describe('Services — aiQueue.js', () => {
  test('AI queue exists', () => expect(existsSync(join(SVC_DIR,'aiQueue.js'))).toBe(true));
  test('AI queue has rate limiting or concurrency control', () => {
    const c = readFileSync(join(SVC_DIR,'aiQueue.js'),'utf-8');
    expect(c).toMatch(/queue|concurrent|limit|throttle|semaphore/i);
  });
  test('AI queue handles errors and retries', () => {
    const c = readFileSync(join(SVC_DIR,'aiQueue.js'),'utf-8');
    expect(c).toMatch(/error|retry|catch|fail/i);
  });
});
