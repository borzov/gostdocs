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

function write(projectPath, captureFile, data) {
  const filePath = resolveJsonPath(projectPath, captureFile);
  const validated = schema.validate(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf8');
  return filePath;
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
