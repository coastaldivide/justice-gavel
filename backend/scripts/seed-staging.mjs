#!/usr/bin/env node
/**
 * seed-staging.mjs — demo data for STAGING (docs/STAGING.md). Run by scripts/staging-setup.sh.
 *
 *   APP_ENV=staging DATABASE_URL=<staging db> node scripts/seed-staging.mjs [--reset]
 *
 * Creates, through the app's real API (the Express app is started inside this process on
 * 127.0.0.1 against DATABASE_URL — the same validation, encryption and reminder planning as
 * a person using the app), plus SQL only where an operator would act:
 *   - a demo consumer with a case, 2 future court dates (each with its reminder plan) and
 *     text reminders switched on,
 *   - a demo Bond Desk agency: owner (Starter plan row, as Stripe would write it) + 1 staff
 *     seat (invited and accepted through the API), 2 bonds, one with an indemnitor,
 *   - a demo public-defender office (services/publicDefender, as the admin screen does) with
 *     the owner of the office as its admin and 2 clients, each with a future court date.
 *
 * Contact details: phones come from STAGING_ALLOWED_PHONES and e-mails from
 * STAGING_ALLOWED_EMAILS (an @domain → jg-staging-demo-<role>@domain; an address →
 * its plus-address you+jg-staging-demo-<role>@…). When a list is empty the demo uses clearly
 * fake values (+1 615 555 01xx, @example.com), which the staging guard never sends to.
 *
 * Marker: every demo account's e-mail contains "jg-staging-demo-"; every other demo row hangs
 * off those accounts or carries "(staging demo)" in its name. Re-running finds them and adds
 * nothing twice (it re-sets the demo password and prints the logins again).
 * --reset removes ONLY demo rows: the demo office by name, then each demo account through
 * DELETE /api/auth/account (services/accountDeletion.js removes everything they own).
 *
 * Password: STAGING_DEMO_PASSWORD, or a new random one per run (printed at the end).
 * Refuses to run unless APP_ENV=staging (or --allow-test with APP_ENV=test, for the test suite).
 */
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const RESET = argv.includes('--reset');
const QUIET = argv.includes('--quiet');
const appEnv = String(process.env.APP_ENV || '').trim().toLowerCase();
if (!(appEnv === 'staging' || (appEnv === 'test' && argv.includes('--allow-test')))) {
  console.error('seed-staging: refusing to run — APP_ENV must be "staging" (this script writes demo accounts).');
  process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error('seed-staging: DATABASE_URL is required.'); process.exit(2); }

export const MARKER = 'jg-staging-demo-';
export const NAME_TAG = '(staging demo)';

// Only this process: the seed signs up a handful of accounts from 127.0.0.1.
process.env.REGISTER_RATE_LIMIT = process.env.REGISTER_RATE_LIMIT_SEED || '1000';
process.env.AUTH_RATE_LIMIT = process.env.AUTH_RATE_LIMIT_SEED || '1000';

const log = (...a) => { if (!QUIET) console.log(...a); };

// ── contact details ───────────────────────────────────────────────────────────
const phones = String(process.env.STAGING_ALLOWED_PHONES || '').split(',').map((x) => x.trim()).filter((x) => /^\+\d{8,15}$/.test(x));
const FAKE_PHONES = ['+16155550161', '+16155550162', '+16155550163', '+16155550164', '+16155550165'];
const phoneFor = (i) => phones.length ? phones[i % phones.length] : FAKE_PHONES[i % FAKE_PHONES.length];
const emailEntries = String(process.env.STAGING_ALLOWED_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const domainEntry = emailEntries.find((x) => /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(x));
const addressEntry = emailEntries.find((x) => /^[^@\s+]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(x));
function emailFor(role) {
  if (domainEntry) return `${MARKER}${role}${domainEntry}`;
  if (addressEntry) { const [l, d] = addressEntry.split('@'); return `${l}+${MARKER}${role}@${d}`; }
  return `${MARKER}${role}@example.com`;
}
const PASSWORD = process.env.STAGING_DEMO_PASSWORD || `Demo-${crypto.randomBytes(6).toString('hex')}!`;
if (PASSWORD.length < 10) { console.error('seed-staging: STAGING_DEMO_PASSWORD must be at least 10 characters.'); process.exit(2); }

// ── the real app, in-process ──────────────────────────────────────────────────
const { default: app } = await import('../src/app.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const bcrypt = (await import('bcryptjs')).default;
const db = await getDb();
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const BASE = `http://127.0.0.1:${server.address().port}`;

async function api(method, path, { token, body } = {}) {
  const h = { Accept: 'application/json', 'X-Timezone': 'America/Chicago' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
function must(r, ok, what) {
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${String(r.text).slice(0, 300)}`);
  return r.json;
}
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** The demo account for a role: created if missing, password (re)set, signed in. */
async function account(role, { displayName, accountType = 'consumer' }) {
  const email = emailFor(role);
  let row = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
  let created = false;
  if (!row) {
    must(await api('POST', '/api/auth/register', { body: { identifier: email, password: PASSWORD, displayName, accountType } }), [200, 201], `sign up ${role}`);
    row = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    created = true;
  } else {
    await db.run('UPDATE users SET password_hash = ?, failed_login_attempts = 0, lock_until = NULL WHERE id = ?', [await bcrypt.hash(PASSWORD, 12), row.id]);
  }
  const l = must(await api('POST', '/api/auth/login', { body: { identifier: email, password: PASSWORD } }), [200], `sign in ${role}`);
  return { role, email, id: Number(row.id), token: l.token, created };
}

const summary = { created: [], kept: [] };
const note = (what, created) => (created ? summary.created : summary.kept).push(what);

async function seedConsumer() {
  const u = await account('consumer', { displayName: 'Demo Consumer' });
  note('consumer account', u.created);
  // text reminders on, to the first allowed number (users.phone is unique: skip if taken)
  const p = await api('PUT', '/api/court-dates/preferences', { token: u.token, body: { sms_reminders: true, phone: phoneFor(0) } });
  if (p.status !== 200) log(`  note: text reminders not switched on for the demo consumer (${p.status} ${p.json?.code || ''})`);
  const title = `Demo case ${NAME_TAG}`;
  const cases = must(await api('GET', '/api/cases', { token: u.token }), [200], 'list cases');
  const list = Array.isArray(cases) ? cases : (cases.cases || cases.data || []);
  let c = list.find((x) => x.title === title);
  if (!c) c = must(await api('POST', '/api/cases', { token: u.token, body: { title, state: 'TN', description: 'Demo data for staging.' } }), [201], 'create case');
  note('consumer case', !list.find((x) => x.title === title));
  const dates = must(await api('GET', `/api/court-dates?case_id=${c.id}`, { token: u.token }), [200], 'list court dates');
  const have = [...(dates.upcoming || []), ...(dates.past || [])].length;
  for (const [i, n] of [[0, 10], [1, 24]].slice(have)) {
    const r = must(await api('POST', '/api/court-dates', { token: u.token, body: { case_id: c.id, court_date: day(n), court_time: i === 0 ? '09:00' : '13:30', state: 'TN', location: 'Davidson County General Sessions' } }), [201], 'add court date');
    if (!(r.reminders || []).length) throw new Error('court date created without reminders');
  }
  note('2 consumer court dates + reminders', have === 0);
  return u;
}

async function seedBondDesk() {
  const owner = await account('agent', { displayName: 'Demo Bail Agent', accountType: 'bail_agent' });
  note('Bond Desk owner account', owner.created);
  must(await api('POST', '/api/billing/bondsman/profile', { token: owner.token, body: { company_name: `Demo Bail Bonds ${NAME_TAG}`, license_number: 'DEMO-0001', license_state: 'TN', states: ['TN'], counties: ['Davidson'] } }), [200, 201], 'bondsman profile');
  // The plan row Stripe's webhook would write (staging must not take a real payment for demo data).
  const sub = await db.get('SELECT id FROM bondsman_subscriptions WHERE user_id = ?', [owner.id]);
  if (!sub) await db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', ?, 9900)`, [owner.id, `${MARKER}sub-${owner.id}`]);
  note('Bond Desk Starter plan row', !sub);
  const bd = (m, p, who = owner, body) => api(m, `/api/bond-desk${p}`, { token: who.token, body });

  const staff = await account('staff', { displayName: 'Demo Staff Member' });
  const st = must(await bd('GET', '/staff'), [200], 'list staff');
  const isStaff = (st.staff || []).some((s) => Number(s.user_id ?? s.id) === staff.id);
  if (!isStaff) {
    const pending = (st.invites || []).find((i) => String(i.email).toLowerCase() === staff.email);
    if (pending) must(await bd('DELETE', `/staff/invites/${pending.id}`), [200, 204], 'withdraw old invite');
    const inv = must(await bd('POST', '/staff/invites', owner, { email: staff.email }), [201], 'invite staff');
    const token = String(inv.link).split('/bond-desk/join/')[1];
    must(await bd('POST', '/staff/accept', staff, { token }), [200], 'accept staff invite');
  }
  note('Bond Desk staff seat', !isStaff);

  const bonds = must(await bd('GET', `/bonds?q=${encodeURIComponent(NAME_TAG)}`), [200], 'list bonds').bonds;
  const want = [
    { defendant_name: `Jordan Demo ${NAME_TAG}`, bond_amount_cents: 500000, state: 'TN', county: 'Davidson', court_name: 'Davidson County General Sessions', court_date: day(17), case_number: 'DEMO-GS-1', defendant_phone: phoneFor(0), indemnitor: { full_name: 'Casey Demo', relationship: 'Sister', phone: phoneFor(1) } },
    { defendant_name: `Riley Demo ${NAME_TAG}`, bond_amount_cents: 250000, state: 'TN', county: 'Davidson', court_name: 'Davidson County Criminal Court', court_date: day(31), case_number: 'DEMO-CC-2', defendant_phone: phoneFor(1) },
  ];
  for (const w of want) {
    const { indemnitor, ...fields } = w;
    let b = bonds.find((x) => x.defendant_name === w.defendant_name);
    note(`bond ${w.case_number}`, !b);
    if (!b) b = must(await bd('POST', '/bonds', owner, fields), [201], 'create bond').bond;
    if (indemnitor) {
      const full = must(await bd('GET', `/bonds/${b.id}`), [200], 'load bond');
      const inds = full.indemnitors || full.bond?.indemnitors || [];
      if (!inds.some((i) => i.full_name === indemnitor.full_name)) must(await bd('POST', `/bonds/${b.id}/indemnitors`, owner, indemnitor), [201], 'add indemnitor');
      note(`indemnitor on ${w.case_number}`, !inds.some((i) => i.full_name === indemnitor.full_name));
    }
  }
  return { owner, staff };
}

async function seedPublicDefender() {
  const u = await account('pd', { displayName: 'Demo Public Defender' });
  note('public defender account', u.created);
  const pd = await import('../src/services/publicDefender/offices.js');
  const clients = await import('../src/services/publicDefender/clients.js');
  const name = `Demo Public Defender Office ${NAME_TAG}`;
  let office = await db.get('SELECT id FROM pd_offices WHERE name = ?', [name]);
  note('public defender office', !office);
  if (!office) {
    // As the Justice Gavel admin screen does (POST /api/admin/pd-offices); the demo account is its admin.
    const { invite } = await pd.createOffice(db, { adminId: u.id, body: { name, county: 'Davidson', state: 'TN', phone: phoneFor(2), seat_limit: 3, admin_email: u.email }, lang: 'en' });
    const token = String(invite.link).split('/pd/join/')[1];
    await pd.acceptInvite(db, { token, user: { id: u.id, email: u.email } });
    office = await db.get('SELECT id FROM pd_offices WHERE name = ?', [name]);
  }
  const officeId = Number(office.id);
  const member = await db.get('SELECT 1 FROM pd_staff WHERE office_id = ? AND user_id = ?', [officeId, u.id]);
  if (!member) await db.run(`INSERT INTO pd_staff (office_id, user_id, role, added_by) VALUES (?, ?, 'admin', ?)`, [officeId, u.id, u.id]);
  const has = await db.get('SELECT consent_basis_at FROM pd_offices WHERE id = ?', [officeId]);
  if (!has.consent_basis_at) await pd.recordConsent(db, { officeId, userId: u.id, agree: true });
  for (const [i, c] of [
    { name: 'Morgan Demo', case_number: 'DEMO-PD-1', court_dates: [{ court_date: day(12), court_time: '09:00', court_name: 'General Sessions' }] },
    { name: 'Taylor Demo', case_number: 'DEMO-PD-2', court_dates: [{ court_date: day(26), court_time: '10:30', court_name: 'Criminal Court' }] },
  ].entries()) {
    try {
      await clients.addClient(db, { officeId, userId: u.id, body: { ...c, phone: phoneFor(i + 2), lang: 'en' } });
      note(`PD client ${c.case_number}`, true);
    } catch (e) {
      if (e?.code === 'duplicate_client' || e?.status === 409) note(`PD client ${c.case_number}`, false);
      else throw e;
    }
  }
  return u;
}

async function reset() {
  const removed = [];
  const off = await db.all('SELECT id FROM pd_offices WHERE name LIKE ?', [`%${NAME_TAG}`]);
  for (const o of off) { await db.run('DELETE FROM pd_offices WHERE id = ?', [o.id]); removed.push(`pd office ${o.id}`); }
  const users = await db.all(`SELECT id, email FROM users WHERE LOWER(email) LIKE ?`, [`%${MARKER}%`]);
  for (const u of users) {
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(PASSWORD, 12), u.id]);
    const l = must(await api('POST', '/api/auth/login', { body: { identifier: u.email, password: PASSWORD } }), [200], `sign in ${u.email}`);
    must(await api('DELETE', '/api/auth/account', { token: l.token, body: { password: PASSWORD } }), [200], `delete ${u.email}`);
    removed.push(`account ${u.id}`);
  }
  console.log(removed.length ? `Removed ${removed.length} demo item(s): ${removed.join(', ')}` : 'No demo data found — nothing removed.');
  return removed;
}

let code = 0;
try {
  if (RESET) await reset();
  else {
    const consumer = await seedConsumer();
    const { owner, staff } = await seedBondDesk();
    const pdUser = await seedPublicDefender();
    console.log(`\nStaging demo data ready — ${summary.created.length} created, ${summary.kept.length} already there.`);
    if (summary.created.length) log(`  created: ${summary.created.join('; ')}`);
    console.log(`\nLogins (password for all: ${PASSWORD}${process.env.STAGING_DEMO_PASSWORD ? ' — from STAGING_DEMO_PASSWORD' : ' — new this run'}):`);
    for (const [what, u] of [['Consumer (case + 2 court dates)', consumer], ['Bond Desk owner', owner], ['Bond Desk staff', staff], ['Public defender office admin', pdUser]]) {
      console.log(`  ${what.padEnd(34)} ${u.email}`);
    }
    console.log(`\nTexts go to: ${phones.length ? phones.join(', ') : 'nobody (fake +1615555016x numbers; STAGING_ALLOWED_PHONES is empty)'}`);
    if (!/^(true|1)$/i.test(String(process.env.PUBLIC_DEFENDER_CHANNEL_ENABLED || ''))) {
      console.log('Note: the public defender screens stay hidden until PUBLIC_DEFENDER_CHANNEL_ENABLED=true on the staging service (⚖, off by default under NODE_ENV=production).');
    }
  }
} catch (e) {
  console.error(`seed-staging failed: ${e.message}`);
  code = 1;
} finally {
  await new Promise((r) => { server.close(r); });
  await closeDb?.().catch?.(() => {});
}
process.exit(code);
