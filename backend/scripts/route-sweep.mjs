#!/usr/bin/env node
/**
 * route-sweep.mjs — enumerate every mounted Express route and hit each
 * parameter-free GET route with a logged-in user's token.
 *
 * Usage (from backend/):
 *   node scripts/route-sweep.mjs <baseUrl> [--list] [--json out.json]
 *
 * Route discovery imports src/app.js in THIS process (with the same env you
 * start the server with — DATABASE_URL etc.) to read the router tree, then the
 * requests go to <baseUrl> (a running server). A fresh user is registered for
 * the run and deleted afterwards.
 */
import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const BASE = (argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:4000').replace(/\/+$/, '');
const LIST_ONLY = argv.includes('--list');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

// ── Record the router tree while app.js is being built ────────────────────────
let RouterProto = Object.getPrototypeOf(express.Router());
while (RouterProto && !Object.prototype.hasOwnProperty.call(RouterProto, "route")) RouterProto = Object.getPrototypeOf(RouterProto);
const routes = new Map();   // router → [{ path, methods }]
const mounts = new Map();   // router → [{ prefix, child }]
const origRoute = RouterProto.route;
RouterProto.route = function (path) {
  const r = origRoute.call(this, path);
  if (!routes.has(this)) routes.set(this, []);
  routes.get(this).push({ path, route: r });
  return r;
};
const origUse = RouterProto.use;
RouterProto.use = function (...args) {
  let prefix = '/';
  let fns = args;
  if (typeof args[0] === 'string' || Array.isArray(args[0])) { prefix = args[0]; fns = args.slice(1); }
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  for (const fn of fns.flat()) {
    if (typeof fn === 'function' && Array.isArray(fn.stack)) {
      if (!mounts.has(this)) mounts.set(this, []);
      for (const p of prefixes) mounts.get(this).push({ prefix: p, child: fn });
    }
  }
  return origUse.apply(this, args);
};

const { default: app } = await import('../src/app.js');
const join = (a, b) => ('/' + [a, b].map(s => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'));

const all = [];
function walk(router, prefix, seen = new Set()) {
  if (seen.has(router)) return;
  seen.add(router);
  for (const { path, route } of routes.get(router) || []) {
    const paths = Array.isArray(path) ? path : [path];
    for (const p of paths) {
      for (const m of Object.keys(route.methods || {})) {
        if (m === '_all') continue;
        all.push({ method: m.toUpperCase(), path: join(prefix, p) });
      }
    }
  }
  for (const { prefix: p, child } of mounts.get(router) || []) walk(child, join(prefix, p), new Set(seen));
}
walk(app.router, '/');

const uniq = [...new Map(all.map(r => [`${r.method} ${r.path}`, r])).values()]
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const byMethod = uniq.reduce((acc, r) => ((acc[r.method] = (acc[r.method] || 0) + 1), acc), {});
console.log(`Discovered ${uniq.length} routes:`, byMethod);
if (LIST_ONLY) { uniq.forEach(r => console.log(`${r.method.padEnd(6)} ${r.path}`)); process.exit(0); }

// ── Log in a fresh user ───────────────────────────────────────────────────────
async function call(method, path, { body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text };
}
const email = `sweep+${Date.now()}_${crypto.randomBytes(3).toString('hex')}@example.com`;
const password = 'Sweep!' + crypto.randomBytes(6).toString('hex');
const reg = await call('POST', '/api/auth/register', { body: { identifier: email, password, displayName: 'Route Sweep' } });
if (reg.status >= 300) { console.error('register failed', reg.status, reg.text); process.exit(1); }
const token = JSON.parse(reg.text).token;
await call('POST', '/api/auth/disclaimer/accept', { token, body: {} });

const targets = uniq.filter(r => r.method === 'GET' && !/[:*]/.test(r.path));
const out = [];
for (const r of targets) {
  const res = await call('GET', r.path, { token });
  out.push({ ...r, status: res.status, body: res.text.slice(0, 300) });
}
await call('DELETE', '/api/auth/account', { token, body: { password } });

const buckets = out.reduce((acc, r) => {
  const k = r.status >= 500 ? '5xx' : r.status >= 400 ? `${r.status}` : r.status >= 300 ? '3xx' : '2xx';
  acc[k] = (acc[k] || 0) + 1; return acc;
}, {});
console.log(`\nSwept ${out.length} parameter-free GET routes:`, buckets);
for (const r of out.filter(r => r.status >= 500)) console.log(`  5xx ${r.status} GET ${r.path} → ${r.body.slice(0, 160)}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ total: uniq.length, byMethod, swept: out }, null, 2));
process.exit(0);
