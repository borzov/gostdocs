'use strict';

/**
 * Stack-agnostic role + login-endpoint scanner.
 *
 * Purpose: before screenshots, discover the full set of user roles a project
 * declares AND candidate login API endpoints. Output feeds the interactive
 * parameter collection ("you have roles X, Y, Z — which ones need screenshots?")
 * and is re-used later by the Phase 4 research coverage report.
 *
 * The scanner is intentionally simple:
 *   - only walks files whose names match known patterns (seeders, role tables,
 *     RBAC configs, route definitions, auth controllers)
 *   - only reads the first 100 KB of any file
 *   - never executes code (no child_process, no eval)
 *
 * For stacks this module does not know about, users can still pass an
 * explicit role list via meta.yaml — the scanner is advisory.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_BYTES = 100 * 1024;
const DEFAULT_MAX_FILES = 2000;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'target',
  'vendor',
  '.next',
  '.nuxt',
  'coverage',
  '.playwright-cache',
]);

const ROLE_FILE_PATTERNS = [
  /seed/i,
  /seeder/i,
  /fixture/i,
  /factory/i,
  /roles?\.[^/]+$/i,
  /rbac/i,
  /permission/i,
  /enum/i,
];

const AUTH_FILE_PATTERNS = [
  /routes?\.[^/]+$/i,
  /urls?\.py$/,
  /controllers?\//i,
  /auth/i,
  /login/i,
  /session/i,
];

const SCAN_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.php', '.rb', '.go', '.java', '.kt',
  '.sql',
]);

const ROLE_LITERAL_WHITELIST = [
  'admin', 'superadmin', 'super_admin', 'superuser',
  'user', 'member', 'customer',
  'moderator', 'operator', 'manager', 'editor', 'viewer', 'guest',
  'owner', 'analyst', 'reporter', 'reviewer',
  'organizer', 'instructor', 'student',
];

const LOGIN_PATH_RE = /['"`](\/(?:api\/)?(?:v\d+\/)?(?:auth\/)?(?:login|signin|sign-in|session(?:s)?|token|authenticate)(?:\/[a-z0-9_-]*)?)['"`]/gi;

function confidenceRank(c) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

/**
 * Extract role candidates from a chunk of source text.
 * @param {string} content
 * @param {string} source absolute path used only for the `source` field
 * @returns {Array<{ role: string, source: string, confidence: 'high'|'medium'|'low', context: string }>}
 */
function scanRolesInContent(content, source) {
  if (typeof content !== 'string') return [];
  const base = path.basename(source).toLowerCase();
  const isSeed = /seed|seeder|fixture|factory/i.test(base);
  const isRbac = /role|rbac|permission|enum/i.test(base);
  const baseConfidence = isSeed ? 'high' : isRbac ? 'medium' : 'low';
  /** @type {Array<{ role: string, source: string, confidence: string, context: string }>} */
  const out = [];
  const seen = new Set();

  const push = (role, ctx, confidence) => {
    if (typeof role !== 'string') return;
    const normalised = role.trim().toLowerCase();
    if (!normalised || normalised.length > 40) return;
    if (!/^[a-z][a-z0-9_\-\s]*$/.test(normalised)) return;
    if (seen.has(normalised)) return;
    seen.add(normalised);
    out.push({ role: normalised, source, confidence, context: ctx });
  };

  // 1. Whitelisted role literals in strings: 'admin', "moderator"
  const literalRe = new RegExp(
    `['"\`](${ROLE_LITERAL_WHITELIST.join('|')})['"\`]`,
    'gi',
  );
  for (const m of content.matchAll(literalRe)) {
    push(m[1], m[0], baseConfidence);
  }

  // 2. enum Role { Admin, User }
  const enumRe = /enum\s+(?:User)?Roles?\s*\{([^}]+)\}/gi;
  for (const m of content.matchAll(enumRe)) {
    const body = m[1];
    for (const part of body.split(/[,\n]/)) {
      const name = part.replace(/[=:].*/, '').trim();
      if (!name) continue;
      push(name, m[0].slice(0, 60), 'high');
    }
  }

  // 3. type UserRole = 'a' | 'b'
  const typeRe = /type\s+(?:User)?Roles?\s*=\s*([^;\n]+)/gi;
  for (const m of content.matchAll(typeRe)) {
    const body = m[1];
    const lit = /['"`]([a-z0-9_-]+)['"`]/gi;
    for (const sub of body.matchAll(lit)) push(sub[1], m[0].slice(0, 60), 'high');
  }

  // 4. const ROLES = ['admin', 'user']
  const constRe = /(?:const|let|var)\s+(?:ROLES?|USER_ROLES?)\s*=\s*(\[[^\]]+\])/g;
  for (const m of content.matchAll(constRe)) {
    const lit = /['"`]([a-z0-9_-]+)['"`]/gi;
    for (const sub of m[1].matchAll(lit)) push(sub[1], m[0].slice(0, 60), 'high');
  }

  return out;
}

/**
 * Extract candidate login endpoints from source text.
 * @param {string} content
 * @param {string} source
 */
function scanLoginEndpointsInContent(content, source) {
  if (typeof content !== 'string') return [];
  const found = new Set();
  for (const m of content.matchAll(LOGIN_PATH_RE)) found.add(m[1]);
  return [...found].map((path_) => ({
    path: path_,
    source,
    confidence: /controller|routes?|urls?|auth/i.test(source) ? 'high' : 'medium',
  }));
}

function* walk(root, { maxDepth, maxFiles }) {
  if (!fs.existsSync(root)) return;
  const stack = [{ dir: root, depth: 0 }];
  let count = 0;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        count += 1;
        yield full;
      }
    }
  }
}

function looksLikeRoleFile(filePath) {
  return ROLE_FILE_PATTERNS.some((re) => re.test(filePath));
}

function looksLikeAuthFile(filePath) {
  return AUTH_FILE_PATTERNS.some((re) => re.test(filePath));
}

function readHead(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytes = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.slice(0, bytes).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Scan a project directory for roles and login endpoints.
 *
 * @param {string} root project root (absolute)
 * @param {{ maxDepth?: number, maxBytes?: number, maxFiles?: number }} [opts]
 * @returns {{ roles: Array<{role:string,source:string,confidence:string}>, loginEndpoints: Array<{path:string,source:string,confidence:string}>, warnings: string[] }}
 */
function scanProject(root, opts = {}) {
  const maxDepth = opts.maxDepth || DEFAULT_MAX_DEPTH;
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  const maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;
  /** @type {Map<string, { role: string, source: string, confidence: string }>} */
  const roles = new Map();
  /** @type {Map<string, { path: string, source: string, confidence: string }>} */
  const logins = new Map();
  const warnings = [];

  if (!fs.existsSync(root)) {
    warnings.push(`scan root does not exist: ${root}`);
    return { roles: [], loginEndpoints: [], warnings };
  }

  for (const file of walk(root, { maxDepth, maxFiles })) {
    const ext = path.extname(file).toLowerCase();
    if (!SCAN_EXTENSIONS.has(ext)) continue;

    const isRoleFile = looksLikeRoleFile(file);
    const isAuthFile = looksLikeAuthFile(file);
    if (!isRoleFile && !isAuthFile) continue;

    let content;
    try {
      content = readHead(file, maxBytes);
    } catch (err) {
      warnings.push(`could not read ${file}: ${err.message}`);
      continue;
    }

    if (isRoleFile) {
      for (const hit of scanRolesInContent(content, file)) {
        const existing = roles.get(hit.role);
        if (!existing || confidenceRank(hit.confidence) > confidenceRank(existing.confidence)) {
          roles.set(hit.role, { role: hit.role, source: hit.source, confidence: hit.confidence });
        }
      }
    }

    if (isAuthFile) {
      for (const hit of scanLoginEndpointsInContent(content, file)) {
        const existing = logins.get(hit.path);
        if (!existing || confidenceRank(hit.confidence) > confidenceRank(existing.confidence)) {
          logins.set(hit.path, hit);
        }
      }
    }
  }

  return {
    roles: [...roles.values()].sort((a, b) => a.role.localeCompare(b.role)),
    loginEndpoints: [...logins.values()].sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}

module.exports = {
  scanProject,
  scanRolesInContent,
  scanLoginEndpointsInContent,
  looksLikeRoleFile,
  looksLikeAuthFile,
  SKIP_DIRS,
  ROLE_LITERAL_WHITELIST,
};
