'use strict';

/**
 * Disk layout for inspection JSON files.
 *
 * Each capture PNG gets a matching JSON at the mirror path under
 * `docs/generated/_inspection/`. The mirror keeps role/viewport/theme
 * structure identical to `docs/screenshots/` so pairs are trivial to look
 * up.
 *
 *   docs/screenshots/admin/desktop/ru/home.png
 *   docs/generated/_inspection/admin/desktop/ru/home.json
 *
 * This module does read/write only — schema validation is owned by
 * `inspection-schema.js`.
 */

const fs = require('fs');
const path = require('path');

const schema = require('./inspection-schema');

function inspectionRoot(projectPath) {
  return path.resolve(projectPath || process.cwd(), 'docs', 'generated', '_inspection');
}

/**
 * @param {string} projectPath
 * @param {string} captureFile  — relative path from manifest (e.g. "admin/desktop/home.png")
 * @returns {string} absolute path to the matching .json file
 */
function resolveJsonPath(projectPath, captureFile) {
  if (!captureFile || typeof captureFile !== 'string') {
    throw new Error('captureFile must be a non-empty string');
  }
  const withoutExt = captureFile.replace(/\.png$/i, '');
  return path.join(inspectionRoot(projectPath), `${withoutExt}.json`);
}

function exists(projectPath, captureFile) {
  return fs.existsSync(resolveJsonPath(projectPath, captureFile));
}

function read(projectPath, captureFile) {
  const filePath = resolveJsonPath(projectPath, captureFile);
  const raw = fs.readFileSync(filePath, 'utf8');
  return schema.validate(JSON.parse(raw));
}

/**
 * When a newly-written inspection shares the same (role, viewport, locale,
 * title) triple as an existing JSON, append the URL path as a disambiguator
 * so the generator does not fail on duplicate H3 headings. This is a
 * defensive measure: agents sometimes emit "Подтверждение email" for both
 * `/verify-email` and `/verification-notice`, and md-lint catches the
 * duplicate only after the DOCX is already written.
 *
 * Returns the (possibly-amended) data plus an optional warning record so
 * the caller can surface the rename in phase-7 REPORT.md.
 *
 * @returns {{ data: object, warning: { scope: string, message: string }|null }}
 */
function dedupeTitleIfCollides(projectPath, captureFile, data) {
  if (!data || !data.title) return { data, warning: null };
  // Title missing or blank — nothing to clash with.
  const title = String(data.title).trim();
  if (!title) return { data, warning: null };
  // Walk the sibling inspections in the same (role, viewport, locale) slice.
  const existing = listAll(projectPath).filter((entry) => {
    if (!entry.data || entry.data.file === data.file) return false;
    if (entry.data.role !== data.role) return false;
    if (entry.data.viewport !== data.viewport) return false;
    if ((entry.data.locale || null) !== (data.locale || null)) return false;
    return String(entry.data.title || '').trim() === title;
  });
  if (existing.length === 0) return { data, warning: null };
  // Derive a short suffix from the capture file so the disambiguator is
  // stack-agnostic — `/admin/users/42.png` → "— /admin/users/42".
  const suffix = String(captureFile || '')
    .replace(/\.png$/i, '')
    .replace(/[/\\]/g, '/')
    .split('/')
    .slice(-3)
    .join('/');
  const amended = { ...data, title: `${title} — /${suffix}` };
  return {
    data: amended,
    warning: {
      scope: 'inspection:title-dedup',
      message: `duplicate title "${title}" collided with ${existing.length} prior capture(s); renamed to "${amended.title}"`,
    },
  };
}

function write(projectPath, captureFile, data, opts = {}) {
  const filePath = resolveJsonPath(projectPath, captureFile);
  // Disambiguate the title BEFORE Zod validation so the final on-disk
  // record already carries the amended value. Opting out via
  // `skipDedupe:true` is useful for tests that bootstrap fixture data
  // where collisions are intentional.
  const { data: effective, warning } = opts.skipDedupe
    ? { data, warning: null }
    : dedupeTitleIfCollides(projectPath, captureFile, data);
  const validated = schema.validate(effective);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf8');
  if (warning && Array.isArray(opts.warnings)) {
    opts.warnings.push(warning);
  }
  return { path: filePath, warning };
}

/**
 * List every inspection JSON under the project. Useful for Phase 7
 * REPORT.md to highlight shots flagged as login-form or error-page.
 *
 * @param {string} projectPath
 * @returns {Array<{ file: string, data: ReturnType<typeof schema.validate> }>}
 */
function listAll(projectPath) {
  const root = inspectionRoot(projectPath);
  if (!fs.existsSync(root)) return [];
  /** @type {Array<{ file: string, data: any }>} */
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = schema.validate(JSON.parse(fs.readFileSync(full, 'utf8')));
          out.push({ file: full, data });
        } catch {
          /* skip malformed files; they'll be flagged elsewhere */
        }
      }
    }
  }
  return out;
}

module.exports = {
  inspectionRoot,
  resolveJsonPath,
  exists,
  read,
  write,
  listAll,
};
