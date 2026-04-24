'use strict';

/**
 * Live-DB schema extraction via `pg_dump --schema-only`.
 *
 * Enabled only when the user passes `--live-db` to the research / schema
 * commands. Credentials are read from process env (PGHOST / PGPORT /
 * PGUSER / PGPASSWORD / PGDATABASE) or a single `connectionString`. The
 * connection string can also be a libpq URI; Postgres parses both.
 *
 * The dump is parsed by pure-string `parseSchemaDump(output)` so the core
 * logic is unit-testable without a live database.
 *
 * Subprocess is spawned via `child_process.spawn` with an argv array — no
 * shell interpretation, no injection surface for connection strings with
 * unusual characters.
 */

const { spawn } = require('child_process');

/**
 * Parse a pg_dump --schema-only output into the normalized schema shape.
 *
 * @param {string} output
 * @param {{ sourcePath?: string, schema?: string }} [opts]
 * @returns {{ source: string, tables: Array<object>, warnings: string[] }}
 */
function parseSchemaDump(output, opts = {}) {
  const sourcePath = opts.sourcePath || 'pg_dump';
  const schema = opts.schema || 'public';
  const warnings = [];
  if (typeof output !== 'string' || !output.trim()) {
    warnings.push('empty pg_dump output');
    return { source: sourcePath, tables: [], warnings };
  }

  /** @type {Map<string, { name: string, columns: any[], foreign_keys: any[], indexes: any[], comment: string|null }>} */
  const tables = new Map();

  const createRe = new RegExp(`CREATE TABLE ${schema}\\.(\\w+)\\s*\\(([\\s\\S]*?)\\n\\);`, 'g');
  for (const m of output.matchAll(createRe)) {
    const name = m[1];
    const body = m[2];
    const columns = [];
    for (const raw of body.split(/,\s*\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const colName = parts[0].replace(/"/g, '');
      const typeTokens = parts.slice(1);
      const notNull = /NOT\s+NULL/i.test(line);
      const defaultMatch = line.match(/DEFAULT\s+(.+?)(?:\s+NOT NULL|\s*$)/i);
      const type = typeTokens.join(' ').replace(/NOT\s+NULL/i, '').replace(/DEFAULT\s+.*$/i, '').trim();
      columns.push({
        name: colName,
        type: type || 'unknown',
        nullable: !notNull,
        default: defaultMatch ? defaultMatch[1].trim() : null,
        primary: false,
        unique: false,
        comment: null,
      });
    }
    tables.set(name, { name, columns, foreign_keys: [], indexes: [], comment: null });
  }

  // PRIMARY KEY constraints
  const pkRe = new RegExp(
    `ALTER TABLE ONLY ${schema}\\.(\\w+)\\s+ADD CONSTRAINT\\s+\\w+\\s+PRIMARY KEY\\s*\\(([^)]+)\\);`,
    'g',
  );
  for (const m of output.matchAll(pkRe)) {
    const table = tables.get(m[1]);
    if (!table) continue;
    const pkCols = m[2].split(',').map((c) => c.trim().replace(/"/g, ''));
    for (const col of table.columns) {
      if (pkCols.includes(col.name)) {
        col.primary = true;
        col.nullable = false;
      }
    }
  }

  // FOREIGN KEY constraints
  const fkRe = new RegExp(
    `ALTER TABLE ONLY ${schema}\\.(\\w+)\\s+ADD CONSTRAINT\\s+\\w+\\s+FOREIGN KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+${schema}\\.(\\w+)\\s*\\(([^)]+)\\)(?:\\s+ON DELETE\\s+([A-Z ]+))?(?:\\s+ON UPDATE\\s+([A-Z ]+))?;`,
    'g',
  );
  for (const m of output.matchAll(fkRe)) {
    const table = tables.get(m[1]);
    if (!table) continue;
    table.foreign_keys.push({
      columns: m[2].split(',').map((c) => c.trim().replace(/"/g, '')),
      references_table: m[3],
      references_columns: m[4].split(',').map((c) => c.trim().replace(/"/g, '')),
      on_delete: m[5] ? m[5].trim() : null,
      on_update: m[6] ? m[6].trim() : null,
    });
  }

  // UNIQUE constraints
  const uniqueRe = new RegExp(
    `ALTER TABLE ONLY ${schema}\\.(\\w+)\\s+ADD CONSTRAINT\\s+\\w+\\s+UNIQUE\\s*\\(([^)]+)\\);`,
    'g',
  );
  for (const m of output.matchAll(uniqueRe)) {
    const table = tables.get(m[1]);
    if (!table) continue;
    table.indexes.push({
      name: null,
      columns: m[2].split(',').map((c) => c.trim().replace(/"/g, '')),
      unique: true,
    });
  }

  // Indexes
  const idxRe = new RegExp(
    `CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(\\w+)\\s+ON\\s+${schema}\\.(\\w+)\\s+USING\\s+\\w+\\s*\\(([^)]+)\\);`,
    'g',
  );
  for (const m of output.matchAll(idxRe)) {
    const table = tables.get(m[3]);
    if (!table) continue;
    table.indexes.push({
      name: m[2],
      columns: m[4].split(',').map((c) => c.trim().replace(/"/g, '')),
      unique: Boolean(m[1]),
    });
  }

  return {
    source: sourcePath,
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

function runSubprocess(bin, args, spawnOptions) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { ...spawnOptions, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (err) => resolve({ stdout, stderr, code: -1, error: err }));
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/**
 * Run pg_dump --schema-only and return parsed schema.
 *
 * Env variables are read in the standard libpq order; individual fields on
 * `opts` override them. A connection string (URL) can be passed as a
 * single positional argument via `opts.connectionString`.
 *
 * @param {{ connectionString?: string, env?: Record<string,string>, pgDumpPath?: string, timeoutMs?: number, schema?: string }} [opts]
 * @returns {Promise<{ source: string, tables: Array<object>, warnings: string[] }>}
 */
async function runPgDump(opts = {}) {
  const bin = opts.pgDumpPath || 'pg_dump';
  const args = ['--schema-only', '--no-owner', '--no-privileges'];
  if (opts.schema) args.push('--schema', opts.schema);
  if (opts.connectionString) args.push(opts.connectionString);

  const spawnOptions = {
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeoutMs || 60000,
  };

  const result = await runSubprocess(bin, args, spawnOptions);
  if (result.error) {
    return {
      source: 'pg_dump',
      tables: [],
      warnings: [`pg_dump not available: ${result.error.message}`],
    };
  }
  if (result.code !== 0) {
    return {
      source: 'pg_dump',
      tables: [],
      warnings: [`pg_dump exited with code ${result.code}: ${result.stderr.trim()}`],
    };
  }
  return parseSchemaDump(result.stdout, { sourcePath: 'pg_dump', schema: opts.schema || 'public' });
}

module.exports = {
  parseSchemaDump,
  runPgDump,
  runSubprocess,
};
