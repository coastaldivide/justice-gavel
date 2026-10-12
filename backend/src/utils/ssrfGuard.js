/**
 * utils/ssrfGuard.js — outbound HTTP to user-supplied URLs without SSRF (H9).
 *
 * Firm webhook subscriptions make the server POST to a URL a customer typed in.
 * Without care that reaches localhost, the private network and cloud metadata
 * (169.254.169.254 / fd00:ec2::254). The defences here:
 *
 *   1. validateOutboundUrl(): https only in production (http allowed in dev/test),
 *      no userinfo, no internal-looking host names, literal IPs must be public.
 *   2. isBlockedAddress(): every non-public IPv4/IPv6 range (loopback, RFC1918,
 *      CGNAT, link-local/metadata, multicast, reserved, ULA, NAT64/6to4/Teredo
 *      and IPv4-mapped forms are unwrapped and re-checked).
 *   3. safePost(): resolves the host and checks EVERY resolved address AT SEND
 *      TIME inside the socket's own `lookup` — the connection is made to the
 *      exact address that was checked, so DNS rebinding between "validate" and
 *      "connect" is impossible. Redirects are never followed (a 3xx is returned
 *      as a failed delivery), the response body is capped, and there is a hard
 *      timeout.
 *
 * Tests may allow specific CIDRs with setSsrfTestAllowList() (refused in
 * production) so a local receiver can prove the happy path end to end.
 */
import dns   from 'dns';
import net   from 'net';
import http  from 'http';
import https from 'https';

const IS_PROD = () => process.env.NODE_ENV === 'production';

const BLOCK_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];
const BLOCK_V6 = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 32], ['2001:2::', 48], ['2001:db8::', 32], ['2001:10::', 28],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];

const blockList = new net.BlockList();
for (const [a, p] of BLOCK_V4) blockList.addSubnet(a, p, 'ipv4');
for (const [a, p] of BLOCK_V6) blockList.addSubnet(a, p, 'ipv6');

// Test-only escape hatch so the integration suite can prove a real delivery to a
// local receiver. It is set programmatically (no environment variable) and is
// refused in production.
let _testAllow = null;
export function setSsrfTestAllowList(cidrs) {
  if (IS_PROD()) throw new Error('setSsrfTestAllowList is not available in production');
  if (!cidrs || !cidrs.length) { _testAllow = null; return; }
  const l = new net.BlockList();
  for (const c of cidrs) {
    const [addr, bits] = String(c).split('/');
    const fam = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    l.addSubnet(addr, Number(bits ?? (fam === 'ipv6' ? 128 : 32)), fam);
  }
  _testAllow = l;
}
function allowList() {
  return IS_PROD() ? null : _testAllow;
}

/** Expand an IPv6 string to 8 hextets (numbers). */
function v6Hextets(ip) {
  let [head, tail] = ip.split('::');
  const parse = (s) => (s ? s.split(':') : []);
  let h = parse(head), t = parse(tail);
  // embedded dotted IPv4 at the end
  const fix = (arr) => {
    const last = arr[arr.length - 1];
    if (last && last.includes('.')) {
      const o = last.split('.').map(Number);
      arr.splice(arr.length - 1, 1, ((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16));
    }
    return arr;
  };
  h = fix(h); t = fix(t);
  const fill = tail === undefined ? [] : new Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map(x => parseInt(x || '0', 16));
}

/** IPv4 embedded in mapped / NAT64 / 6to4 / Teredo IPv6 forms, else null. */
function embeddedV4(ip) {
  const h = v6Hextets(ip.toLowerCase().split('%')[0]);
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (h.slice(0, 5).every(x => x === 0) && h[5] === 0xffff) return v4(h[6], h[7]);   // ::ffff:a.b.c.d
  if (h.slice(0, 6).every(x => x === 0) && (h[6] || h[7])) return v4(h[6], h[7]);    // ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b) return v4(h[6], h[7]);                        // NAT64
  if (h[0] === 0x2002) return v4(h[1], h[2]);                                          // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return v4(h[6] ^ 0xffff, h[7] ^ 0xffff);         // Teredo client
  return null;
}

/** True when the address must never be contacted. Unparseable → blocked. */
export function isBlockedAddress(ip) {
  const addr = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const fam = net.isIP(addr);
  if (!fam) return true;
  const allow = allowList();
  if (fam === 4) {
    if (allow?.check(addr, 'ipv4')) return false;
    return blockList.check(addr, 'ipv4');
  }
  if (allow?.check(addr, 'ipv6')) return false;
  const v4 = embeddedV4(addr);
  if (v4 && isBlockedAddress(v4)) return true;
  return blockList.check(addr, 'ipv6');
}

const INTERNAL_NAME = /(^|\.)(localhost|localdomain|local|internal|intranet|lan|home|corp|metadata|metadata\.google\.internal)$/i;

/**
 * Static validation of a user-supplied URL. Returns { ok: true, url } or
 * { ok: false, reason }. Does NOT resolve DNS (resolution happens at send time).
 */
export function validateOutboundUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, reason: 'Invalid URL.' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !IS_PROD())) {
    return { ok: false, reason: IS_PROD() ? 'Webhook URL must use https.' : 'Webhook URL must use http(s).' };
  }
  if (u.username || u.password) return { ok: false, reason: 'Credentials in the URL are not allowed.' };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'Invalid host.' };
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'Webhook URL points to a private or reserved address.' };
  } else {
    if (!host.includes('.') || INTERNAL_NAME.test(host)) {
      return { ok: false, reason: 'Webhook URL host must be a public domain name.' };
    }
    // Decimal / hex / octal IPv4 shorthands ("2130706433", "0x7f.1") are never valid public hosts.
    if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) {
      return { ok: false, reason: 'Webhook URL host must be a public domain name.' };
    }
  }
  return { ok: true, url: u };
}

/** Best-effort resolve-and-check (used at subscription create/update; send time re-checks). */
export async function assertResolvesPublic(hostname, { resolver = dns.promises.lookup } = {}) {
  const host = String(hostname).replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !isBlockedAddress(host);
  let addrs;
  try { addrs = await resolver(host, { all: true, verbatim: true }); } catch { return null; }   // unknown now
  if (!addrs?.length) return null;
  return addrs.every(a => !isBlockedAddress(a.address));
}

/**
 * dns.lookup-compatible function that refuses to hand back a blocked address.
 * Used as the socket `lookup`, so the address checked is the address connected to.
 */
export function guardedLookup(resolver = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolver(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
      if (err) return callback(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
      if (!list.length) return callback(Object.assign(new Error('no addresses'), { code: 'ENOTFOUND' }));
      const bad = list.find(a => isBlockedAddress(a.address));
      if (bad) {
        return callback(Object.assign(new Error(`Blocked destination address ${bad.address}`), { code: 'ESSRFBLOCKED' }));
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

/**
 * POST a body to a user-supplied URL with SSRF protection.
 * Resolves { status, ok, body } or throws (ESSRFBLOCKED, timeout, network).
 */
export function safePost(rawUrl, { headers = {}, body = '', timeoutMs = 10_000, maxResponseBytes = 64 * 1024, resolver } = {}) {
  const v = validateOutboundUrl(rawUrl);
  if (!v.ok) return Promise.reject(Object.assign(new Error(v.reason), { code: 'ESSRFBLOCKED' }));
  const u = v.url;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const lib = u.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: u.protocol,
      hostname: host,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     `${u.pathname}${u.search}`,
      method:   'POST',
      headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
      // Literal IPs skip DNS; validateOutboundUrl already rejected blocked literals.
      // Host names are resolved AND checked here, at connect time.
      lookup:   guardedLookup(resolver),
      servername: net.isIP(host) ? undefined : host,
      timeout:  timeoutMs,
      agent:    false,
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size <= maxResponseBytes) chunks.push(c);
        else res.destroy();
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        // Redirects are not followed — a 3xx to an internal address must not be chased.
        resolve({ status, ok: status >= 200 && status < 300, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('close', () => resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Webhook delivery timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}
