/**
 * route-walker.mjs — enumerate every route the Express app actually mounts,
 * with the middleware chain that guards it.
 *
 * Used by:
 *   - backend/scripts/generate-openapi.mjs  (emits /openapi.json)
 *   - backend/src/__tests__/openapi_drift.test.js  (fails CI when the spec
 *     and the mounted routes drift apart)
 *   - scripts/generate-openapi.mjs at the repo root (thin wrapper)
 *
 * How it works: Express routers register routes through Router.prototype.route
 * and mount children through Router.prototype.use. Both are patched BEFORE
 * src/app.js is imported, so every call is recorded with an ordinal. The tree
 * is then walked from app.router, accumulating the mount prefix and every
 * named middleware that guards each route:
 *   - middleware attached to the route itself (route.stack handler names),
 *   - router-level `router.use(fn)` calls made before the route was defined,
 *   - middleware passed alongside a child router in the same use() call
 *     (`app.use('/x', authRequired, router)`),
 *   - everything inherited from ancestor mounts.
 *
 * collectRoutes() may only be called once per process (app.js is cached).
 */
import express from 'express';

/** Middleware names that mean "valid Bearer JWT required". */
export const AUTH_MIDDLEWARE = new Set(['authRequired', 'authMiddleware', 'requireAuth']);
/** Middleware names that additionally require a staff/admin account. */
export const STAFF_MIDDLEWARE = new Set([
  'requireSuperAdmin', 'requireAdmin', 'requireStaff', 'requireRole', 'adminOnly', 'staffOnly',
]);

export async function collectRoutes() {
  let RouterProto = Object.getPrototypeOf(express.Router());
  while (RouterProto && !Object.prototype.hasOwnProperty.call(RouterProto, 'route')) {
    RouterProto = Object.getPrototypeOf(RouterProto);
  }

  const routes = new Map();   // router → [{ path, route, ordinal }]
  const mounts = new Map();   // router → [{ prefix, child, ordinal, gateNames }]
  const uses   = new Map();   // router → [{ ordinal, names }] (plain middleware on the router)
  let counter  = 0;

  const origRoute = RouterProto.route;
  RouterProto.route = function (path) {
    const r = origRoute.call(this, path);
    if (!routes.has(this)) routes.set(this, []);
    routes.get(this).push({ path, route: r, ordinal: counter++ });
    return r;
  };
  const origUse = RouterProto.use;
  RouterProto.use = function (...args) {
    let prefix = '/';
    let fns = args;
    if (typeof args[0] === 'string' || Array.isArray(args[0])) { prefix = args[0]; fns = args.slice(1); }
    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    const flat = fns.flat(Infinity);
    const ordinal = counter++;
    const gateNames = flat
      .filter(f => typeof f === 'function' && !Array.isArray(f.stack))
      .map(f => f.name)
      .filter(Boolean);
    let mountedChild = false;
    for (const fn of flat) {
      if (typeof fn === 'function' && Array.isArray(fn.stack)) {   // a Router
        mountedChild = true;
        if (!mounts.has(this)) mounts.set(this, []);
        for (const p of prefixes) mounts.get(this).push({ prefix: p, child: fn, ordinal, gateNames });
      }
    }
    // Plain middleware applied to this router. Express 5's app.use() splits
    // `app.use(path, fn, router)` into one router.use(path, …) call per
    // argument, so the prefix must be kept: a use('/api/chat', mw) call only
    // guards paths under /api/chat, not the whole router.
    if (!mountedChild && gateNames.length) {
      if (!uses.has(this)) uses.set(this, []);
      for (const p of prefixes) uses.get(this).push({ ordinal, names: gateNames, prefix: p });
    }
    return origUse.apply(this, args);
  };

  let app;
  try {
    app = (await import('../../src/app.js')).default;
  } finally {
    RouterProto.route = origRoute;
    RouterProto.use   = origUse;
  }

  const join = (a, b) =>
    '/' + [a, b].map(s => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

  const found = new Map();   // "METHOD path" → { method, path, middleware: Set }
  function record(method, path, middleware) {
    const key = `${method} ${path}`;
    if (!found.has(key)) found.set(key, { method, path, middleware: new Set() });
    for (const m of middleware) found.get(key).middleware.add(m);
  }

  // Does a use(prefix, mw) call guard this router-relative path?
  const guards = (usePrefix, target) => {
    if (usePrefix === '/' || usePrefix === '') return true;
    const t = '/' + String(target).replace(/^\/+/, '');
    const u = '/' + String(usePrefix).replace(/^\/+|\/+$/g, '');
    return t === u || t.startsWith(u + '/');
  };

  function walk(router, prefix, inheritedGates, seen = new Set()) {
    if (seen.has(router)) return;
    seen.add(router);
    for (const { path, route, ordinal } of routes.get(router) || []) {
      const stackNames = (route.stack || [])
        .map(l => l.handle && l.handle.name)
        .filter(Boolean);
      const paths = Array.isArray(path) ? path : [path];
      for (const p of paths) {
        const routerGates = (uses.get(router) || [])
          .filter(u => u.ordinal < ordinal && guards(u.prefix, p))
          .flatMap(u => u.names);
        const gates = [...inheritedGates, ...routerGates, ...stackNames];
        for (const m of Object.keys(route.methods || {})) {
          if (m === '_all') continue;
          record(m.toUpperCase(), join(prefix, p), gates);
        }
      }
    }
    for (const { prefix: p, child, ordinal, gateNames } of mounts.get(router) || []) {
      const routerGates = (uses.get(router) || [])
        .filter(u => u.ordinal < ordinal && guards(u.prefix, p))
        .flatMap(u => u.names);
      walk(child, join(prefix, p), [...inheritedGates, ...routerGates, ...gateNames], new Set(seen));
    }
  }
  walk(app.router, '/', []);

  return [...found.values()]
    .map(r => {
      const mw = [...r.middleware];
      return {
        method: r.method,
        path: r.path,
        middleware: mw,
        auth:  mw.some(n => AUTH_MIDDLEWARE.has(n)),
        staff: mw.some(n => STAFF_MIDDLEWARE.has(n)),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Express path → OpenAPI path (`/api/cases/:id` → `/api/cases/{id}`). */
export function toOpenApiPath(expressPath) {
  return expressPath
    .replace(/:([A-Za-z0-9_]+)\?/g, '{$1}')     // optional params (rare)
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\(\.\*\)|\*/g, '{wildcard}');
}
