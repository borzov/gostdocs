'use strict';

/**
 * Content-hash research cache.
 *
 * Each cache entry is stored as JSON with a deterministic hash of its
 * inputs. A read returns a hit only when the recomputed hash matches —
 * any change to source files or config invalidates the entry
 * automatically, without explicit versioning.
 *
 * Used by research / schema / openapi / role-discovery adapters to avoid
 * re-running expensive subagents when their inputs have not changed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Stable JSON stringify with sorted keys — hash is reproducible across processes. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

/**
 * Hash a descriptor of inputs. Accepts any shape; if a field ends with
 * `_files` and holds an array of paths, the file contents (not the path)
 * are hashed so renames do not falsely invalidate.
 */
function computeHash(input) {
  const prepared = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (k.endsWith('_files') && Array.isArray(v)) {
      prepared[k] = v.map((p) => {
        try {
          return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        } catch {
          return `missing:${p}`;
        }
      });
    } else {
      prepared[k] = v;
    }
  }
  return crypto.createHash('sha256').update(stableStringify(prepared)).digest('hex');
}

function entryPath(cacheRoot, key) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
    throw new Error(`Invalid cache key: ${key}`);
  }
  return path.join(cacheRoot, `${key}.json`);
}

/**
 * Read cache entry. Returns { hit: true, value } on match, { hit: false } on miss
 * or hash mismatch. Never throws for missing/corrupt files; logs nothing.
 */
function get(cacheRoot, key, input) {
  const file = entryPath(cacheRoot, key);
  if (!fs.existsSync(file)) return { hit: false };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { hit: false };
  }
  const expected = computeHash(input);
  if (parsed.hash !== expected) return { hit: false };
  return { hit: true, value: parsed.value };
}

function set(cacheRoot, key, input, value) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const entry = {
    hash: computeHash(input),
    timestamp: new Date().toISOString(),
    value,
  };
  fs.writeFileSync(entryPath(cacheRoot, key), JSON.stringify(entry, null, 2), 'utf8');
}

function invalidate(cacheRoot, key) {
  const file = entryPath(cacheRoot, key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function clear(cacheRoot) {
  if (!fs.existsSync(cacheRoot)) return;
  for (const entry of fs.readdirSync(cacheRoot)) {
    if (entry.endsWith('.json')) fs.unlinkSync(path.join(cacheRoot, entry));
  }
}

module.exports = {
  computeHash,
  get,
  set,
  invalidate,
  clear,
  stableStringify,
};
