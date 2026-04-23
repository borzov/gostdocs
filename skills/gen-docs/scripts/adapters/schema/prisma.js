'use strict';

/**
 * Prisma schema parser.
 *
 * Reads a `schema.prisma` file and produces the normalized schema shape
 * used by `scripts/lib/schema-model.js`. The implementation is a pure
 * string parser — no dependency on Prisma's own engines, no JS code eval,
 * no child_process.
 *
 * Supported Prisma features:
 *   - model blocks with field declarations
 *   - scalar fields (Int, String, Boolean, DateTime, Float, Decimal, Json, Bytes)
 *   - optional fields (`String?`), list fields (`Post[]`)
 *   - @id, @unique, @default(...), @relation(...), @map(...), /// comments
 *   - @@index([cols]), @@unique([cols]), @@map("...")
 *
 * Intentionally NOT supported:
 *   - enum -> stored as scalar column type; enum contents ignored
 *   - composite types, views, native types beyond the type name
 *   - onDelete/onUpdate beyond literal string capture
 */

const SCALAR_TYPES = new Set([
  'Int', 'BigInt', 'String', 'Boolean',
  'DateTime', 'Float', 'Decimal', 'Json', 'Bytes',
]);

function stripComments(source) {
  return source
    .replace(/\/\/\/[^\n]*\n/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Split a Prisma schema into top-level `model` / `enum` blocks. Implemented
 * as a manual scan (no stateful regex) so brace nesting is handled without
 * regex pitfalls.
 */
function splitBlocks(source) {
  const blocks = [];
  const re = /(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  for (const m of source.matchAll(re)) {
    const kind = m[1];
    const name = m[2];
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    const body = source.slice(bodyStart, i - 1);
    blocks.push({ kind, name, body });
  }
  return blocks;
}

/**
 * Parse Prisma attributes like `@default(autoincrement())` or
 * `@relation(fields: [authorId], references: [id], onDelete: Cascade)`.
 *
 * Manual scan so balanced nested parens inside args are preserved
 * (e.g. `@default(autoincrement())`, `@default(dbgenerated("gen_random_uuid()"))`).
 */
function parseAttributes(attributeText) {
  if (!attributeText) return [];
  const attrs = [];
  const src = attributeText;
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '@') { i += 1; continue; }
    const block = src[i + 1] === '@';
    const nameStart = block ? i + 2 : i + 1;
    let j = nameStart;
    while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
    const name = src.slice(nameStart, j);
    let argsRaw = '';
    if (src[j] === '(') {
      let depth = 1;
      const start = j + 1;
      let k = start;
      while (k < src.length && depth > 0) {
        if (src[k] === '(') depth += 1;
        else if (src[k] === ')') depth -= 1;
        if (depth > 0) k += 1;
      }
      argsRaw = src.slice(start, k);
      j = k + 1;
    }
    if (name) attrs.push({ name, block, argsRaw });
    i = j;
  }
  return attrs;
}

function extractList(text) {
  const match = text && text.match(/\[(.*?)\]/);
  if (!match) return [];
  return match[1].split(',').map((s) => s.trim()).filter(Boolean);
}

function firstMatch(pattern, text) {
  const m = text.match(pattern);
  return m ? m[1] : null;
}

function parseFieldLine(line, warnings) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const name = tokens[0];
  const typeRaw = tokens[1];
  const nullable = typeRaw.endsWith('?');
  const isList = typeRaw.endsWith('[]');
  const type = typeRaw.replace(/[?[\]]/g, '');
  const attrText = line.slice(line.indexOf(typeRaw) + typeRaw.length);
  const attrs = parseAttributes(attrText);

  const col = {
    name,
    type,
    nullable,
    default: null,
    primary: false,
    unique: false,
    comment: null,
  };
  let foreignKey = null;
  let mappedName = null;

  for (const attr of attrs) {
    if (attr.block) continue;
    switch (attr.name) {
      case 'id':
        col.primary = true;
        col.nullable = false;
        break;
      case 'unique':
        col.unique = true;
        break;
      case 'default':
        col.default = attr.argsRaw.trim() || null;
        break;
      case 'map':
        mappedName = attr.argsRaw.replace(/['"]/g, '').trim() || null;
        break;
      case 'relation': {
        const fieldsMatch = attr.argsRaw.match(/fields:\s*\[([^\]]+)\]/);
        const referencesMatch = attr.argsRaw.match(/references:\s*\[([^\]]+)\]/);
        if (fieldsMatch && referencesMatch) {
          foreignKey = {
            columns: fieldsMatch[1].split(',').map((s) => s.trim()),
            references_table: type,
            references_columns: referencesMatch[1].split(',').map((s) => s.trim()),
            on_delete: firstMatch(/onDelete:\s*([A-Za-z]+)/, attr.argsRaw),
            on_update: firstMatch(/onUpdate:\s*([A-Za-z]+)/, attr.argsRaw),
          };
        }
        break;
      }
      default:
        warnings.push(`ignored Prisma attribute @${attr.name} on ${name}`);
    }
  }

  // Prisma relation-side fields (`author User @relation(...)`) are not
  // stored columns; their FK columns are recorded on the scalar side.
  // We still return the foreignKey so the caller can collect it.
  if (!SCALAR_TYPES.has(type)) return { skip: true, foreignKey };

  // Prisma list fields (one-to-many from the parent) are virtual.
  if (isList) return { skip: true, foreignKey };

  if (mappedName) col.comment = `stored as "${mappedName}"`;
  return { column: col, foreignKey };
}

function parseModelBody(body, warnings) {
  const columns = [];
  const foreignKeys = [];
  const indexes = [];
  let tableName = null;
  const tableComment = null;

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('@@')) {
      for (const attr of parseAttributes(line)) {
        if (attr.name === 'map') {
          tableName = attr.argsRaw.replace(/['"]/g, '').trim() || null;
        } else if (attr.name === 'index') {
          const cols = extractList(attr.argsRaw);
          if (cols.length > 0) indexes.push({ name: null, columns: cols, unique: false });
        } else if (attr.name === 'unique') {
          const cols = extractList(attr.argsRaw);
          if (cols.length > 0) indexes.push({ name: null, columns: cols, unique: true });
        } else if (attr.name === 'id') {
          const cols = extractList(attr.argsRaw);
          for (const col of columns) if (cols.includes(col.name)) col.primary = true;
        }
      }
      continue;
    }
    const parsed = parseFieldLine(line, warnings);
    if (!parsed) continue;
    if (parsed.foreignKey) foreignKeys.push(parsed.foreignKey);
    if (parsed.skip) continue;
    columns.push(parsed.column);
  }

  return { tableName, tableComment, columns, foreignKeys, indexes };
}

/**
 * Parse schema.prisma text into the normalized schema shape.
 *
 * @param {string} source
 * @param {{ sourcePath?: string }} [opts]
 * @returns {{ source: string, tables: Array<object>, warnings: string[] }}
 */
function parse(source, opts = {}) {
  const warnings = [];
  const sourcePath = opts.sourcePath || 'schema.prisma';
  if (typeof source !== 'string' || !source.trim()) {
    warnings.push('empty schema.prisma');
    return { source: sourcePath, tables: [], warnings };
  }

  const cleaned = stripComments(source);
  const blocks = splitBlocks(cleaned);
  const tables = [];

  for (const block of blocks) {
    if (block.kind !== 'model') continue;
    const parsed = parseModelBody(block.body, warnings);
    tables.push({
      name: parsed.tableName || block.name,
      comment: parsed.tableComment,
      columns: parsed.columns,
      foreign_keys: parsed.foreignKeys,
      indexes: parsed.indexes,
    });
  }

  return { source: sourcePath, tables, warnings };
}

module.exports = {
  parse,
  parseFieldLine,
  parseModelBody,
  parseAttributes,
  splitBlocks,
  SCALAR_TYPES,
};
