/**
 * services/attachmentStorage.js — where message attachments are kept.
 *
 * Backends (first match wins; ATTACHMENTS_STORAGE=off|local|supabase forces one):
 *   supabase  SUPABASE_URL + SUPABASE_SERVICE_KEY set → Supabase Storage bucket
 *             ATTACHMENTS_BUCKET (default 'case-documents', the bucket docket
 *             uploads already use), objects under messages/.
 *   local     ATTACHMENTS_DIR, default <backend>/data/attachments
 *             (= /app/data/attachments in the Docker image, which is writable by
 *             the runtime user). Only used when the directory can be created and
 *             written. On ephemeral hosts mount a volume there.
 *   none      → getAttachmentStorage() returns null; the route answers 503
 *             { error: 'storage_unavailable' }.
 *
 * Callers pass already-encrypted bytes; keys are server-generated
 * (YYYY/MM/<uuid>.bin) and never contain user input.
 */
import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, '../../data/attachments');

let _cached;           // undefined = not resolved yet; null = unavailable
let _warnedLocalProd = false;

export function newStorageKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}/${m}/${crypto.randomUUID()}.bin`;
}

function localBackend(dir) {
  const root = path.resolve(dir);
  const resolveKey = (key) => {
    if (!/^[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.bin$/.test(key)) throw new Error('invalid storage key');
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('invalid storage key');
    return p;
  };
  return {
    kind: 'local',
    async put(key, buf) {
      const p = resolveKey(key);
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      await fs.promises.writeFile(p, buf, { flag: 'wx', mode: 0o600 });
    },
    async get(key) { return await fs.promises.readFile(resolveKey(key)); },
    async remove(key) { await fs.promises.rm(resolveKey(key), { force: true }); },
  };
}

async function supabaseBackend() {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const bucket = process.env.ATTACHMENTS_BUCKET || 'case-documents';
  const objectPath = (key) => `messages/${key}`;
  return {
    kind: 'supabase',
    async put(key, buf) {
      const { error } = await client.storage.from(bucket)
        .upload(objectPath(key), buf, { contentType: 'application/octet-stream', upsert: false });
      if (error) throw new Error(`supabase upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await client.storage.from(bucket).download(objectPath(key));
      if (error) throw new Error(`supabase download failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(key) {
      await client.storage.from(bucket).remove([objectPath(key)]);
    },
  };
}

async function localDirUsable(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.access(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    logger.warn(`[attachments] local storage dir not writable (${dir}): ${e.message}`);
    return false;
  }
}

/** Resolve the storage backend once. Returns null when none is usable. */
export async function getAttachmentStorage() {
  if (_cached !== undefined) return _cached;
  const mode = (process.env.ATTACHMENTS_STORAGE || '').toLowerCase();
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  const dir = process.env.ATTACHMENTS_DIR || DEFAULT_DIR;

  if (mode === 'off' || mode === 'none') {
    _cached = null;
  } else if (mode === 'supabase' || (!mode && hasSupabase)) {
    _cached = hasSupabase ? await supabaseBackend() : null;
    if (!_cached) logger.warn('[attachments] ATTACHMENTS_STORAGE=supabase but SUPABASE_URL / SUPABASE_SERVICE_KEY are not set');
  } else {
    _cached = (await localDirUsable(dir)) ? localBackend(dir) : null;
    if (_cached && process.env.NODE_ENV === 'production' && !process.env.ATTACHMENTS_DIR && !_warnedLocalProd) {
      _warnedLocalProd = true;
      logger.warn(`[attachments] storing attachments on local disk (${dir}); mount a persistent volume there or configure Supabase Storage`);
    }
  }
  return _cached;
}

/** Test hook: re-read the environment on next use. */
export function resetAttachmentStorage() { _cached = undefined; }
