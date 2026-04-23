'use strict';

/**
 * Component detector — finds complex UI primitives that documentation must
 * cover with multiple shots (empty / in-progress / done states).
 *
 * Target names (case-insensitive suffixes): Builder, Editor, Wizard,
 * Constructor, Designer, Composer. These names are conventional in most
 * stacks and reliably indicate multi-step or drag-and-drop surfaces.
 *
 * Output feeds Phase 3B capture planning: each component gets a required
 * set of shots (empty / in-progress / done) that the orchestrator injects
 * into the capture matrix.
 *
 * Stack-agnostic — only filename patterns and light route-reference matching
 * are used; no AST parsing.
 */

const fs = require('fs');
const path = require('path');

const COMPONENT_PATTERNS = [
  { kind: 'builder',     re: /([A-Z][A-Za-z0-9]*)Builder\.(?:tsx?|jsx?|vue)$/ },
  { kind: 'editor',      re: /([A-Z][A-Za-z0-9]*)Editor\.(?:tsx?|jsx?|vue)$/ },
  { kind: 'wizard',      re: /([A-Z][A-Za-z0-9]*)Wizard\.(?:tsx?|jsx?|vue)$/ },
  { kind: 'constructor', re: /([A-Z][A-Za-z0-9]*)Constructor\.(?:tsx?|jsx?|vue)$/ },
  { kind: 'designer',    re: /([A-Z][A-Za-z0-9]*)Designer\.(?:tsx?|jsx?|vue)$/ },
  { kind: 'composer',    re: /([A-Z][A-Za-z0-9]*)Composer\.(?:tsx?|jsx?|vue)$/ },
];

const ROUTE_REFERENCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.py']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', 'vendor', '.next', '.nuxt',
  'coverage', '.playwright-cache',
]);

/**
 * @returns {'builder'|'editor'|'wizard'|'constructor'|'designer'|'composer'|null}
 */
function classifyByName(basename) {
  for (const { kind, re } of COMPONENT_PATTERNS) {
    if (re.test(basename)) return kind;
  }
  return null;
}

function extractComponentName(basename) {
  for (const { re } of COMPONENT_PATTERNS) {
    const match = basename.match(re);
    if (match) return match[0].replace(/\.[^.]+$/, '');
  }
  return null;
}

function* walk(root, maxDepth, maxFiles) {
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
 * Walk the project collecting:
 *   1. component files matching known suffixes
 *   2. best-effort route associations: any scanned file that mentions a
 *      component name near a quoted route literal contributes that route.
 *
 * @param {string} root project root (absolute)
 * @param {{ maxDepth?: number, maxBytes?: number, maxFiles?: number }} [opts]
 * @returns {{ components: Array<{ name: string, kind: string, source: string, routes: string[] }>, warnings: string[] }}
 */
function scanProject(root, opts = {}) {
  const maxDepth = opts.maxDepth || 6;
  const maxBytes = opts.maxBytes || 100 * 1024;
  const maxFiles = opts.maxFiles || 2000;
  const warnings = [];

  if (!fs.existsSync(root)) {
    warnings.push(`scan root does not exist: ${root}`);
    return { components: [], warnings };
  }

  /** @type {Map<string, { name: string, kind: string, source: string, routes: Set<string> }>} */
  const byName = new Map();
  /** @type {Array<{ path: string, content: string }>} */
  const referenceable = [];

  for (const file of walk(root, maxDepth, maxFiles)) {
    const basename = path.basename(file);
    const kind = classifyByName(basename);
    if (kind) {
      const name = extractComponentName(basename);
      if (name && !byName.has(name)) {
        byName.set(name, { name, kind, source: file, routes: new Set() });
      }
    }
    const ext = path.extname(file);
    if (ROUTE_REFERENCE_EXTENSIONS.has(ext)) {
      try {
        referenceable.push({ path: file, content: readHead(file, maxBytes) });
      } catch (err) {
        warnings.push(`could not read ${file}: ${err.message}`);
      }
    }
  }

  // Second pass: find "path: '/x'" and "<ComponentName" within the same
  // 400-char window, or "component: ComponentName" on the same line as a path.
  for (const { content } of referenceable) {
    for (const [name, record] of byName.entries()) {
      const nameRe = new RegExp(`\\b${name}\\b`, 'g');
      for (const match of content.matchAll(nameRe)) {
        const idx = match.index;
        const window = content.slice(Math.max(0, idx - 400), idx + 400);
        for (const r of window.matchAll(/['"`](\/[^'"`\s]{1,80})['"`]/g)) {
          const candidate = r[1];
          if (!/^\/$/.test(candidate)) record.routes.add(candidate);
        }
      }
    }
  }

  const components = [...byName.values()]
    .map((c) => ({ name: c.name, kind: c.kind, source: c.source, routes: [...c.routes].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { components, warnings };
}

/**
 * For a detected component, build a suggested capture plan of 3 shots.
 * These are advisory: meta.yaml `pages[]` can override.
 *
 * @param {{ name: string, kind: string, routes: string[] }} component
 * @returns {Array<{ id: string, path: string, component_kind: string, state: string, title: string }>}
 */
function suggestedShots(component) {
  const route = component.routes[0];
  if (!route) return [];
  const base = component.name.toLowerCase();
  return [
    { id: `${base}__empty`,       path: route, component_kind: component.kind, state: 'empty',    title: `${component.name} — пустое состояние` },
    { id: `${base}__inprogress`,  path: route, component_kind: component.kind, state: null,       title: `${component.name} — в процессе работы` },
    { id: `${base}__done`,        path: route, component_kind: component.kind, state: null,       title: `${component.name} — завершённое состояние` },
  ];
}

module.exports = {
  scanProject,
  suggestedShots,
  classifyByName,
  extractComponentName,
  COMPONENT_PATTERNS,
  SKIP_DIRS,
};
