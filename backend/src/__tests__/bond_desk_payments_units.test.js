/**
 * bond_desk_payments_units.test.js — the pure parts of Bond Desk card payments, import / export
 * and seats (docs/BOND_DESK.md): the ZIP writer (CRC-32, deflate, readable by `unzip`), CSV money
 * and row checks, the automatic-payment consent text in every language, the ⚖ flag, the pay-page
 * form rules, the fee and seat numbers, and that every new English text fits 2 SMS segments.
 * The database paths are in integration/bond_desk_payments.int.test.js.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { crc32, ZipWriter, readZip } from '../services/bondDesk/zip.js';
import { parseMoney, parseDay, checkCsv, templateCsv, COLUMNS, MAX_ROWS } from '../services/bondDesk/csvImport.js';
import { consentText, autopayEnabled, feeFor, scheduleFrom, AUTOPAY_CONSENT_VERSION } from '../services/bondDesk/autopay.js';
import { payForm } from '../services/bondDesk/payLink.js';
import { seatsFor } from '../services/bondDesk/staff.js';
import { BONDSMAN_TIERS, AUTOPAY_FEE_CENTS, PAY_LINK_MIN_CENTS, PAY_LINK_MAX_CENTS } from '../routes/billing/plans.js';
import { msg, SUPPORTED_LANGS } from '../i18n/index.js';
import { fitSms, smsSegments } from '../services/smsText.js';

const zipOf = async (files, opts) => {
  const parts = [];
  const z = new ZipWriter(async (b) => { parts.push(b); }, opts);
  for (const [name, data, o] of files) await z.addEntry(name, data, o);
  await z.finish();
  return Buffer.concat(parts);
};

describe('ZIP writer', () => {
  test('CRC-32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test('stored and deflated entries read back byte for byte; names are unique and safe', async () => {
    const big = Buffer.from('Receipt R-000001,100.00\r\n'.repeat(2000));
    const bin = Buffer.from([0, 1, 2, 3, 255, 254]);
    const buf = await zipOf([['reports/a.csv', big], ['../../etc/x.pdf', bin, { store: true }], ['reports/a.csv', 'second'], ['ñandú/é.txt', 'utf-8 name'], ['empty.txt', '']]);
    const out = readZip(buf);
    expect(out.map((e) => e.name)).toEqual(['reports/a.csv', 'etc/x.pdf', 'reports/a (2).csv', 'ñandú/é.txt', 'empty.txt']);
    expect(out[0].data.equals(big)).toBe(true);
    expect(out[1].data.equals(bin)).toBe(true);
    expect(out[2].data.toString()).toBe('second');
    expect(out[4].data.length).toBe(0);
    expect(buf.length).toBeLessThan(big.length / 4);   // deflate worked
  });

  test('the unzip tool accepts it (CRC and directory checked) when installed', async () => {
    let have = true;
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { have = false; }
    const buf = await zipOf([['README.txt', 'hello\r\n'], ['receipts/R-000001.pdf', Buffer.from('%PDF-1.4 test'), { store: true }], ['big.csv', 'x,y\r\n'.repeat(5000)]]);
    if (!have) { expect(readZip(buf)).toHaveLength(3); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipunit-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.zip'), buf);
      expect(execFileSync('unzip', ['-t', path.join(dir, 'a.zip')]).toString()).toMatch(/No errors detected in compressed data/);
      execFileSync('unzip', ['-q', path.join(dir, 'a.zip'), '-d', path.join(dir, 'o')]);
      expect(fs.readFileSync(path.join(dir, 'o', 'README.txt'), 'utf8')).toBe('hello\r\n');
      expect(fs.readFileSync(path.join(dir, 'o', 'big.csv'), 'utf8')).toBe('x,y\r\n'.repeat(5000));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a closed ZIP takes no more entries', async () => {
    const z = new ZipWriter(async () => {});
    await z.finish();
    await expect(z.addEntry('a', 'b')).rejects.toThrow('zip closed');
  });
});

describe('CSV import checks', () => {
  test('money is parsed to whole cents exactly', () => {
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('$1,234.5')).toBe(123450);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('19.99')).toBe(1999);   // never 1998.9999
    expect(parseMoney('100')).toBe(10000);
    expect(parseMoney('')).toBeNull();
    for (const bad of ['12.345', '-5', '1,23', 'abc', '1.2.3', '$', '1e3', '12,34.00']) expect(parseMoney(bad)).toBeNaN();
  });

  test('dates: ISO or US, real calendar days only', () => {
    expect(parseDay('2026-02-28')).toBe('2026-02-28');
    expect(parseDay('3/7/2026')).toBe('2026-03-07');
    expect(parseDay('2026-02-30')).toBeNaN();
    expect(parseDay('13/1/2026')).toBeNaN();
    expect(parseDay(' ')).toBeNull();
  });

  test('template header = the column list; required columns and limits', () => {
    expect(templateCsv().trim()).toBe(COLUMNS.map(([n]) => n).join(','));
    const r = checkCsv(Buffer.from('defendant_name\nA'), { today: '2026-10-27' });
    expect(r.file_errors).toEqual([{ code: 'missing_column', column: 'bond_amount' }]);
    const many = checkCsv(Buffer.from(['defendant_name,bond_amount', ...Array.from({ length: MAX_ROWS + 1 }, () => 'A,1')].join('\n')), { today: '2026-10-27' });
    expect(many.file_errors).toEqual([{ code: 'too_many_rows', max: MAX_ROWS }]);
    expect(checkCsv(Buffer.from(''), { today: '2026-10-27' }).file_errors).toEqual([{ code: 'no_rows' }]);
    expect(checkCsv(Buffer.from('a,"b'), { today: '2026-10-27' }).file_errors[0].code).toBe('bad_csv');
  });

  test('per-row errors: dates, phones, unique power numbers, formula text kept as text', () => {
    const csv = ['Defendant,Bond,Surety,Power,DOB,Phone,Posted On,State',
      'A,100,S1,P-1,1990-01-01,615-555-0100,2026-01-01,tn',
      'B,100,S1,p-1,,,,',
      'C,100,,P-2,2030-01-01,12,2099-01-01,Tenn',
      '=cmd,100,,,,,,'].join('\n');
    const r = checkCsv(Buffer.from(csv), { today: '2026-10-27', existingPowers: new Set() });
    expect(r).toMatchObject({ total: 4, valid: 2, invalid: 2 });
    expect(r.rows[0]).toMatchObject({ errors: [], values: { bond_amount: 10000, state: 'TN', defendant_phone: '+16155550100' } });
    expect(r.rows[1].errors).toEqual([{ field: 'power_number', code: 'power_duplicate', line: 2 }]);
    expect(r.rows[2].errors.map((e) => `${e.field}:${e.code}`)).toEqual(expect.arrayContaining([
      'defendant_dob:bad_date', 'defendant_phone:bad_phone', 'state:bad_state', 'surety:power_needs_surety', 'posted_on:future_date']));
    expect(r.rows[3]).toMatchObject({ errors: [], values: { defendant_name: '=cmd' } });   // stored as text; CSV exports neutralise it
  });
});

describe('automatic payments', () => {
  const schedule = [{ due_on: '2026-11-01', amount_cents: 12500 }, { due_on: '2026-12-01', amount_cents: 10000 }];
  test.each(SUPPORTED_LANGS)('consent text (%s): amounts, dates, how to stop, all payments final', (lang) => {
    const t = consentText(lang, { agency: 'Alpha Bail', phone: '615-555-0199', defendant: 'Jordan Rivers', schedule });
    for (const part of ['Alpha Bail', 'Jordan Rivers', '11/01/2026', '$125.00', '12/01/2026', '$100.00', '615-555-0199']) expect(t).toContain(part);
    expect(t).toContain(msg(lang, 'bd.autopay.consent_final'));
    expect(t).toContain(msg(lang, 'bd.autopay.consent_stop', { agency: 'Alpha Bail', phone: '615-555-0199' }));
    expect(t.split('\n')).toHaveLength(2 + schedule.length + 3);
  });

  test('the English wording (report: owner decision)', () => {
    expect(consentText('en', { agency: 'Alpha Bail', phone: '615-555-0199', defendant: 'Jordan Rivers', schedule: schedule.slice(0, 1) })).toBe([
      'I authorize Alpha Bail to charge my card for the payment plan on the bail bond for Jordan Rivers, on these dates and in these amounts:',
      '• 11/01/2026: $125.00',
      'Each amount is charged on its date. A charge is never more than the balance owed on the bond; if part is already paid, only the rest is charged. If a charge does not go through, it is tried once more 3 days later and you are told by text or e-mail. Other dates or amounts need a new link and your agreement.',
      'To stop automatic payments at any time, tap "Stop automatic payments" on this page or contact Alpha Bail at 615-555-0199. Stopping does not change what is owed.',
      'Your card is kept by Stripe for Alpha Bail; Justice Gavel never sees your card number. Payments go to Alpha Bail.',
      'All payments are final.',
    ].join('\n'));
    expect(AUTOPAY_CONSENT_VERSION).toBe('autopay-2026-10');
  });

  test('schedule: the unpaid part of installments due today or later', () => {
    const plan = [{ id: 1, due_on: '2026-10-01', amount_cents: 100, covered_cents: 100, status: 'paid' },
      { id: 2, due_on: '2026-10-20', amount_cents: 100, covered_cents: 0, status: 'overdue' },
      { id: 3, due_on: '2026-10-27', amount_cents: 100, covered_cents: 40, status: 'partial' },
      { id: 4, due_on: '2026-11-27', amount_cents: 100, covered_cents: 0, status: 'due' }];
    expect(scheduleFrom(plan, '2026-10-27')).toEqual([{ due_on: '2026-10-27', amount_cents: 60, installment_cents: 100 }, { due_on: '2026-11-27', amount_cents: 100, installment_cents: 100 }]);
  });

  test('⚖ flag: explicit wins; unset is off in production only', () => {
    expect(autopayEnabled({ flag: 'true', appEnv: 'production' })).toBe(true);
    expect(autopayEnabled({ flag: '0', appEnv: 'development' })).toBe(false);
    expect(autopayEnabled({ flag: '', appEnv: 'production' })).toBe(false);
    expect(autopayEnabled({ flag: '', appEnv: '', nodeEnv: 'production' })).toBe(false);
    expect(autopayEnabled({ flag: undefined, appEnv: 'staging', nodeEnv: 'test' })).toBe(true);
  });

  test('fee: 99¢ per charge of $1 or more', () => {
    expect(AUTOPAY_FEE_CENTS).toBe(99);
    expect(feeFor(100)).toBe(99);
    expect(feeFor(99)).toBe(0);
  });
});

describe('pay page form', () => {
  const ok = { amount_cents: 2500, payer_name: ' Pat ', payer_phone: '(615) 555-0100', payer_email: 'PAT@EXAMPLE.COM', defendant_name: 'Sam', agree_final: true };
  test('valid input is cleaned', () => {
    expect(payForm(ok)).toEqual({ amount: 2500, payer: 'Pat', defendant: 'Sam', phone: '+16155550100', email: 'pat@example.com', smsOk: false });
    expect(payForm({ ...ok, receipt_by_text: true }).smsOk).toBe(true);
    expect(payForm({ ...ok, payer_phone: '', receipt_by_text: true }).smsOk).toBe(false);
  });
  test.each([
    [{ amount_cents: PAY_LINK_MIN_CENTS - 1 }, 'pay_amount'], [{ amount_cents: PAY_LINK_MAX_CENTS + 1 }, 'pay_amount'], [{ amount_cents: 10.5 }, 'pay_amount'],
    [{ amount_cents: '12.00' }, 'pay_amount'], [{ payer_name: '' }, 'required'], [{ defendant_name: ' ' }, 'required'], [{ payer_phone: '12' }, 'bad_phone'],
    [{ payer_email: 'x@' }, 'bad_email'], [{ payer_phone: null, payer_email: null }, 'contact_required'], [{ agree_final: 'yes' }, 'consent_required'],
  ])('%j → %s', (patch, code) => {
    expect(() => payForm({ ...ok, ...patch })).toThrow(expect.objectContaining({ code }));
  });
  test('limits are $1 – $50,000', () => {
    expect([PAY_LINK_MIN_CENTS, PAY_LINK_MAX_CENTS]).toEqual([100, 5000000]);
    expect(payForm({ ...ok, amount_cents: 5000000 }).amount).toBe(5000000);
  });
});

describe('seats per plan', () => {
  test('Starter 3, Pro 10, Market 20 (the owner counts)', () => {
    expect(Object.fromEntries(Object.entries(BONDSMAN_TIERS).map(([k, t]) => [k, t.seats]))).toEqual({ starter: 3, pro: 10, market: 20 });
    expect([seatsFor('starter'), seatsFor('pro'), seatsFor('market'), seatsFor(null)]).toEqual([3, 10, 20, 0]);
  });
});

describe('texts', () => {
  const long = { agency: 'Alpha & Omega Bail Bonds of Middle Tennessee', defendant: 'Christopher Montgomery-Washington', amount: '$1,250.00',
    retry: '10/30/2026', phone: '615-555-0199', link: `https://justicegavel.app/autopay/${'A'.repeat(43)}`, payer: 'Elizabeth Montgomery-Washington',
    receipt: 'R-000123', date: '10/27/2026' };
  const keys = ['bd.sms.autopay_link', 'bd.sms.autopay_failed_retry', 'bd.sms.autopay_failed_final', 'bd.sms.autopay_action', 'bd.sms.receipt'];
  test.each(keys)('English %s fits 2 segments (GSM-7) with long names and keeps the link', (key) => {
    const t = fitSms((f) => msg('en', key, f), long, [['defendant', 6], ['agency', 12]]);
    expect(smsSegments(t)).toMatchObject({ encoding: 'GSM-7' });
    expect(smsSegments(t).segments).toBeLessThanOrEqual(2);
    if (msg('en', key, long).includes(long.link)) expect(t).toContain(long.link);
  });
  test.each(['bd.sms.autopay_agent_failed_retry', 'bd.sms.autopay_agent_failed_final'])('agent text %s fits 2 segments', (key) => {
    const t = fitSms((f) => msg('en', key, f), long, [['defendant', 6], ['payer', 6]]);
    expect(smsSegments(t).segments).toBeLessThanOrEqual(2);
  });
  test.each(SUPPORTED_LANGS.filter((l) => l !== 'en'))('%s texts keep their accents within 6 segments', (lang) => {
    for (const key of keys) {
      const t = fitSms((f) => msg(lang, key, f), long, [['defendant', 6], ['agency', 12]], { lang });
      expect(smsSegments(t).segments).toBeLessThanOrEqual(6);
    }
  });
});
