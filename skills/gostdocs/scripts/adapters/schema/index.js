'use strict';

/**
 * Schema adapter registry.
 *
 * Entry point for the "Структура данных" research phase. Detects the
 * project's migration framework, dispatches to the matching parser, and
 * falls back to live-DB extraction when the user passes `--live-db`.
 *
 * Frameworks without a Phase 4B parser (alembic, django, knex, typeorm,
 * sequelize) return an empty schema + a warning suggesting --live-db.
 */

const fs = require('fs');
const path = require('path');

const detect = require('./detect');
const prisma = require('./prisma');
const pgDump = require('./pg-dump');

const PARSERS = {
  prisma: (markerPath) => {
    const source = fs.readFileSync(markerPath, 'utf8');
    return prisma.parse(source, { sourcePath: markerPath });
  },
};

/**
 * Extract schema for a project.
 *
 * @param {string} projectPath
 * @param {{ liveDb?: boolean, connectionString?: string, schema?: string, pgDumpPath?: string }} [opts]
 * @returns {Promise<{ schema: { source: string, tables: Array<object>, warnings: string[] }, framework: string|null, supported: boolean, warnings: string[] }>}
 */
async function extractSchema(projectPath, opts = {}) {
  const warnings = [];
  const detection = detect.detect(projectPath);

  if (opts.liveDb) {
    const dump = await pgDump.runPgDump({
      connectionString: opts.connectionString,
      schema: opts.schema,
      pgDumpPath: opts.pgDumpPath,
    });
    return {
      schema: dump,
      framework: detection.framework,
      supported: true,
      warnings: [...warnings, ...dump.warnings, '--live-db used; parser detection overridden by pg_dump'],
    };
  }

  if (detection.framework && PARSERS[detection.framework]) {
    try {
      const schema = PARSERS[detection.framework](detection.markerPath);
      return {
        schema,
        framework: detection.framework,
        supported: true,
        warnings: [...warnings, ...schema.warnings],
      };
    } catch (err) {
      warnings.push(`parser for ${detection.framework} failed: ${err.message}`);
    }
  }

  if (detection.framework) {
    warnings.push(
      `migration framework "${detection.framework}" detected but no parser is implemented; pass --live-db with a configured connection to extract via pg_dump`,
    );
  } else {
    warnings.push(
      'no migration framework detected; pass --live-db with a configured connection to extract via pg_dump',
    );
  }

  return {
    schema: { source: path.join(projectPath, 'schema'), tables: [], warnings: [] },
    framework: detection.framework,
    supported: Boolean(detection.framework && PARSERS[detection.framework]),
    warnings: [...warnings, ...detection.hints],
  };
}

module.exports = {
  extractSchema,
  detect: detect.detect,
  PARSERS,
};
