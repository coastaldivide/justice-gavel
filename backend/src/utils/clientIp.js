/**
 * clientIp.js — what the app believes the caller's IP is, and why.
 *
 * Rate limits and guest report keys use req.ip, which Express derives from the
 * socket peer and X-Forwarded-For according to the 'trust proxy' setting
 * (TRUST_PROXY, app.js). The proxy chain in front of the app depends on the
 * host and is not documented by Render, so the owner measures it after a
 * deploy: GET /api/admin/diagnostics/client-ip (admin role + X-Admin-Key)
 * returns this report, and `candidates` shows which IP each TRUST_PROXY hop
 * count would pick. Pick the count whose IP is the caller's real public IP
 * (RUNBOOK "Client IP / TRUST_PROXY").
 */
import { HOST_PLATFORM, INSTANCE_ID } from './version.js';

const header = (req, name) => {
  const v = req.headers[name];
  return v === undefined ? null : (Array.isArray(v) ? v.join(', ') : String(v));
};

/** JSON-safe view of the Express 'trust proxy' setting. */
function describeTrust(setting) {
  if (typeof setting === 'function') return 'custom function';
  return setting ?? false;
}

export function clientIpReport(req) {
  const xff = header(req, 'x-forwarded-for');
  const forwarded = xff ? xff.split(',').map(s => s.trim()).filter(Boolean) : [];
  const peer = req.socket?.remoteAddress ?? null;
  // Nearest first: the socket peer, then X-Forwarded-For from right to left.
  // Express with trust proxy = N (hop count) returns entry N of this list
  // (or the last one when N is larger than the chain).
  const chain = [peer, ...forwarded.slice().reverse()];
  return {
    ip: req.ip ?? null,
    ips: req.ips ?? [],
    x_forwarded_for: xff,
    socket_remote_address: peer,
    other_headers: {
      'x-real-ip': header(req, 'x-real-ip'),
      'true-client-ip': header(req, 'true-client-ip'),
      'cf-connecting-ip': header(req, 'cf-connecting-ip'),
    },
    trust_proxy: {
      env: process.env.TRUST_PROXY ?? null,
      effective: describeTrust(req.app?.get('trust proxy')),
    },
    candidates: chain.map((ip, hops) => ({ trust_proxy: hops, ip })),
    platform: HOST_PLATFORM,
    instance: INSTANCE_ID,
  };
}

export default clientIpReport;
