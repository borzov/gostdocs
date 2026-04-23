'use strict';

/**
 * Normalized schema representation + Markdown emitter.
 *
 * The shape is the lingua-franca between framework-specific parsers
 * (Prisma, Alembic, pg_dump, ...) and the documentation generator. Every
 * parser must produce this shape so downstream phases don't need to know
 * where the data came from.
 *
 * Markdown emitter produces the "Структура данных" / "Database schema"
 * section of the technical description: one H3 per table with a column
 * table. Foreign keys, indexes, and comments get their own sub-rows so the
 * DOCX output reads like a proper reference.
 */

const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean().default(true),
  default: z.string().nullable().default(null),
  primary: z.boolean().default(false),
  unique: z.boolean().default(false),
  comment: z.string().nullable().default(null),
});

const foreignKeySchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  references_table: z.string().min(1),
  references_columns: z.array(z.string().min(1)).min(1),
  on_delete: z.string().nullable().default(null),
  on_update: z.string().nullable().default(null),
});

const indexSchema = z.object({
  name: z.string().min(1).nullable().default(null),
  columns: z.array(z.string().min(1)).min(1),
  unique: z.boolean().default(false),
});

const tableSchema = z.object({
  name: z.string().min(1),
  comment: z.string().nullable().default(null),
  columns: z.array(columnSchema).default([]),
  foreign_keys: z.array(foreignKeySchema).default([]),
  indexes: z.array(indexSchema).default([]),
});

const schemaModelSchema = z.object({
  source: z.string().min(1),
  tables: z.array(tableSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

function validate(obj) {
  return schemaModelSchema.parse(obj);
}

function empty(source) {
  return { source, tables: [], warnings: [] };
}

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function columnTypeWithModifiers(col) {
  const flags = [];
  if (col.primary) flags.push('PK');
  if (col.unique && !col.primary) flags.push('UNIQUE');
  if (!col.nullable) flags.push('NOT NULL');
  if (col.default !== null && col.default !== undefined) flags.push(`default ${col.default}`);
  return flags.length > 0 ? `${col.type} (${flags.join(', ')})` : col.type;
}

/**
 * Emit a Markdown section for the schema.
 *
 * Each table gets an H3 header, an optional description line, a column
 * table, and — when present — two extra bullet lists for foreign keys and
 * indexes.
 *
 * @param {ReturnType<typeof validate>} schema
 * @param {{ headingLevel?: number, lang?: 'ru'|'en' }} [opts]
 * @returns {string}
 */
function buildMarkdown(schema, opts = {}) {
  const level = opts.headingLevel || 3;
  const hash = '#'.repeat(level);
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const t = lang === 'ru'
    ? { col: 'Столбец', type: 'Тип', desc: 'Описание', fk: 'Внешние ключи', idx: 'Индексы' }
    : { col: 'Column', type: 'Type', desc: 'Description', fk: 'Foreign keys', idx: 'Indexes' };

  if (!schema || !Array.isArray(schema.tables) || schema.tables.length === 0) {
    return '';
  }

  const out = [];
  for (const table of schema.tables) {
    out.push(`${hash} ${table.name}`);
    if (table.comment) {
      out.push('');
      out.push(table.comment);
    }
    out.push('');
    out.push(`| ${t.col} | ${t.type} | ${t.desc} |`);
    out.push('|---|---|---|');
    for (const col of table.columns) {
      out.push(
        `| ${escapeCell(col.name)} | ${escapeCell(columnTypeWithModifiers(col))} | ${escapeCell(col.comment)} |`,
      );
    }
    if (table.foreign_keys.length > 0) {
      out.push('');
      out.push(`**${t.fk}:**`);
      for (const fk of table.foreign_keys) {
        const cols = fk.columns.join(', ');
        const refCols = fk.references_columns.join(', ');
        const extras = [];
        if (fk.on_delete) extras.push(`ON DELETE ${fk.on_delete}`);
        if (fk.on_update) extras.push(`ON UPDATE ${fk.on_update}`);
        const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
        out.push(`- ${cols} → ${fk.references_table}(${refCols})${suffix}`);
      }
    }
    if (table.indexes.length > 0) {
      out.push('');
      out.push(`**${t.idx}:**`);
      for (const idx of table.indexes) {
        const uniqueTag = idx.unique ? ' (UNIQUE)' : '';
        const name = idx.name ? `${idx.name}: ` : '';
        out.push(`- ${name}${idx.columns.join(', ')}${uniqueTag}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trim() + '\n';
}

module.exports = {
  schema: schemaModelSchema,
  tableSchema,
  columnSchema,
  foreignKeySchema,
  indexSchema,
  validate,
  empty,
  buildMarkdown,
  columnTypeWithModifiers,
};
