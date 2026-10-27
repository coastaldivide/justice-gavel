/**
 * services/bondDesk/zip.js — a small streaming ZIP writer (PKWARE APPNOTE 6.3: local file headers,
 * deflate (method 8) or store (method 0), CRC-32, central directory, end record). No dependency:
 * node:zlib deflateRawSync does the compression. Each entry is written as soon as it is added, so
 * memory holds one file at a time; names are UTF-8 (general purpose bit 11).
 *
 * Limits (no ZIP64): fewer than 65,535 entries and under 4 GiB in total — addEntry throws before
 * a limit would be crossed.
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), as ZIP uses it. */
export function crc32(buf, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time of a Date (local fields as UTC — ZIP has no zone). */
function dosTime(d) {
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const MAX = 0xffffffff;

export class ZipWriter {
  /** write(buffer) → Promise (wait for drain) — e.g. an Express response. */
  constructor(write, { now = new Date() } = {}) {
    this.write = write;
    this.offset = 0;
    this.entries = [];
    this.names = new Set();
    this.dos = dosTime(now);
    this.closed = false;
  }

  async _out(buf) { this.offset += buf.length; await this.write(buf); }

  /** Add one file. `data` Buffer|string. Already-compressed data (PDF, ZIP) can be stored. */
  async addEntry(name, data, { store = false } = {}) {
    if (this.closed) throw new Error('zip closed');
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
    if (!clean) throw new Error('empty zip entry name');
    let unique = clean; let n = 2;
    while (this.names.has(unique)) { const dot = clean.lastIndexOf('.'); unique = dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`; n += 1; }
    this.names.add(unique);
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(raw);
    let method = 0; let body = raw;
    if (!store && raw.length > 0) {
      const d = zlib.deflateRawSync(raw, { level: 6 });
      if (d.length < raw.length) { method = 8; body = d; }
    }
    if (this.entries.length >= 65534 || this.offset + body.length + 1024 >= MAX || raw.length >= MAX) throw new Error('zip too large (no ZIP64)');
    const nameBuf = Buffer.from(unique, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);                 // version needed: 2.0
    h.writeUInt16LE(0x0800, 6);             // UTF-8 names
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(this.dos.time, 10);
    h.writeUInt16LE(this.dos.date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    const at = this.offset;
    await this._out(Buffer.concat([h, nameBuf]));
    await this._out(body);
    this.entries.push({ nameBuf, method, crc, csize: body.length, size: raw.length, at });
    return unique;
  }

  /** Central directory + end record. */
  async finish() {
    if (this.closed) return;
    this.closed = true;
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(0x031e, 4);           // made by: UNIX, 3.0
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(this.dos.time, 12);
      c.writeUInt16LE(this.dos.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
      c.writeUInt32LE((0o100644 << 16) >>> 0, 38);   // -rw-r--r--
      c.writeUInt32LE(e.at, 42);
      await this._out(Buffer.concat([c, e.nameBuf]));
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    end.writeUInt16LE(0, 20);
    await this._out(end);
  }
}

/** Read a ZIP made by ZipWriter (or any store/deflate ZIP without ZIP64) → [{ name, data }]. For tests and checks. */
export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(at + 26);
    const lxlen = buf.readUInt16LE(at + 28);
    const body = buf.subarray(at + 30 + lnlen + lxlen, at + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`crc mismatch: ${name}`);
    out.push({ name, data });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
