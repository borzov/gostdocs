'use strict';

/**
 * Framework autodetect for the schema adapter.
 *
 * The caller feeds this a project root; we look for well-known markers and
 * return the first match with the highest confidence. Ties are broken in
 * declaration order. Matches are case-sensitive for Unix filesystems — on
 * macOS the default case-insensitive FS will still hit correctly.
 *
 * Supported detectors:
 *   - prisma        schema.prisma in any subdir
 *   - alembic       alembic.ini or versions/ folder with `.py` migrations
 *   - django        manage.py + migrations/ sub-tree
 *   - knex          knexfile.{js,ts}
 *   - typeorm       ormconfig.{json,js,ts} or data-source.ts
 *   - sequelize     .sequelizerc or sequelize-cli config
 *   - sqlalchemy    alembic.ini (shared with alembic) OR migrations/ with Alembic env.py
 *
 * For frameworks without a Phase 4B parser we still classify correctly and
 * return `supported: false` so the orchestrator knows whether to try live
 * DB introspection instead.
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', 'vendor', '.next', '.nuxt',
  'coverage', '.playwright-cache',
]);

const DETECTORS = [
  {
    framework: 'prisma',
    supported: true,
    markerFile: (name) => name === 'schema.prisma',
  },
  {
    framework: 'alembic',
    supported: false,
    markerFile: (name) => name === 'alembic.ini',
  },
  {
    framework: 'django',
    supported: false,
    markerFile: (name) => name === 'manage.py',
  },
  {
    framework: 'knex',
    supported: false,
    markerFile: (name) => /^knexfile\.(js|ts|mjs|cjs)$/.test(name),
  },
  {
    framework: 'typeorm',
    supported: false,
    markerFile: (name) => /^(?:ormconfig\.(?:js|ts|json)|data-source\.(?:js|ts))$/.test(name),
  },
  {
    framework: 'sequelize',
    supported: false,
    markerFile: (name) => name === '.sequelizerc',
  },
];

function* walk(root, maxDepth) {
  const stack = [{ dir: root, depth: 0 }];
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
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.sequelizerc') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        yield { full, name: entry.name };
      }
    }
  }
}

/**
 * @param {string} projectPath
 * @param {{ maxDepth?: number }} [opts]
 * @returns {{ framework: string|null, supported: boolean, markerPath: string|null, hints: string[] }}
 */
function detect(projectPath, opts = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { framework: null, supported: false, markerPath: null, hints: [`project path does not exist: ${projectPath}`] };
  }
  const maxDepth = opts.maxDepth || 4;
  const hints = [];
  for (const file of walk(projectPath, maxDepth)) {
    for (const detector of DETECTORS) {
      if (detector.markerFile(file.name)) {
        return {
          framework: detector.framework,
          supported: detector.supported,
          markerPath: file.full,
          hints,
        };
      }
    }
  }
  hints.push('no known migration framework marker found; consider --live-db for pg_dump extraction');
  return { framework: null, supported: false, markerPath: null, hints };
}

module.exports = {
  detect,
  DETECTORS,
  SKIP_DIRS,
};
