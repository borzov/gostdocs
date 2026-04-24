'use strict';

/**
 * File-hashing utility for duplicate-capture detection.
 *
 * v0.3 requirement 6.1: after screenshot capture we must flag shots that
 * are suspiciously identical to each other — most commonly this is the
 * login page being silently re-shot for every auth-required route.
 *
 * A full perceptual-hash implementation requires image decoding. We take
 * the cheap path here: SHA-256 over the file bytes. Two screenshots with
 * the exact same rendered output produce the same hash; two visually
 * similar but byte-different shots do not, and that residual is caught by
 * the vision inspector's `is_login_form` flag (Phase 5).
 *
 * Pure — accepts a `readFile` override so tests can avoid disk.
 */

const fs = require('fs');
const crypto = require('crypto');

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * @param {string} filePath
 * @param {{ readFile?: (p: string) => Buffer }} [opts]
 * @returns {string}
 */
function sha256File(filePath, opts = {}) {
  const readFile = opts.readFile || ((p) => fs.readFileSync(p));
  return sha256Buffer(readFile(filePath));
}

/**
 * Hash every file; return a map from hash -> list of paths that share it,
 * restricted to hashes with 2+ members. Missing files are reported in
 * `warnings`.
 *
 * @param {string[]} paths
 * @param {{ readFile?: (p: string) => Buffer }} [opts]
 * @returns {{ duplicates: Array<{ hash: string, files: string[] }>, warnings: string[] }}
 */
function detectDuplicates(paths, opts = {}) {
  const readFile = opts.readFile || ((p) => fs.readFileSync(p));
  /** @type {Map<string, string[]>} */
  const byHash = new Map();
  const warnings = [];
  for (const p of paths || []) {
    let buf;
    try {
      buf = readFile(p);
    } catch (err) {
      warnings.push(`cannot hash ${p}: ${err.message}`);
      continue;
    }
    const h = sha256Buffer(buf);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(p);
  }
  const duplicates = [];
  for (const [hash, files] of byHash.entries()) {
    if (files.length >= 2) duplicates.push({ hash, files: [...files].sort() });
  }
  duplicates.sort((a, b) => (b.files.length - a.files.length) || a.hash.localeCompare(b.hash));
  return { duplicates, warnings };
}

module.exports = {
  sha256Buffer,
  sha256File,
  detectDuplicates,
};
