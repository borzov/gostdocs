'use strict';

/**
 * Manifest v2 — the structured record of every screenshot captured during a
 * run. Consumed by later phases: Phase 5 (ui-inspection), Phase 6 (generation),
 * Phase 7 (validation / REPORT.md).
 *
 * The shape is intentionally flat: one array of `captures`, each describing
 * a single PNG by (role, viewport, theme, locale, state, action, journey).
 * Filenames are emitted by a deterministic template so reruns overwrite the
 * same file.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');

const CURRENT_VERSION = '2.0';

const captureSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  role: z.string().min(1),
  viewport: z.string().min(1),
  theme: z.string().nullable().default(null),
  locale: z.string().nullable().default(null),
  state: z.enum(['empty', 'error', 'permission-denied']).nullable().default(null),
  action_sequence: z.array(z.string()).nullable().default(null),
  component_kind: z.enum(['builder', 'editor', 'wizard', 'constructor']).nullable().default(null),
  journey: z
    .object({ name: z.string().min(1), step: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  title: z.string().nullable().default(null),
  access: z.enum(['public', 'auth_required']).default('public'),
  url: z.string().nullable().default(null),
  file: z.string().min(1),
  sha256: z.string().nullable().default(null),
  captured_at: z.string().nullable().default(null),
  success: z.boolean().default(true),
});

const errorSchema = z.object({
  role: z.string().nullable().default(null),
  capture_id: z.string().nullable().default(null),
  stage: z.string().min(1),
  message: z.string().min(1),
});

const warningSchema = z.object({
  scope: z.string().min(1),
  message: z.string().min(1),
});

const manifestSchema = z
  .object({
    version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
    generated_at: z.string(),
    base_url: z.string(),
    roles: z.array(z.string()).default([]),
    captures: z.array(captureSchema).default([]),
    errors: z.array(errorSchema).default([]),
    warnings: z.array(warningSchema).default([]),
  })
  .strict();

/**
 * Build a filesystem-safe relative path under `screenshots/` for a capture.
 *
 * Template (default): `{role}/{viewport}/{theme}/{locale}/{id}{state_suffix}{action_suffix}.png`
 * Missing axes collapse (no empty `/` in path). Keeps PNG files organised
 * per role/role-less rollups.
 *
 * @param {{ id: string, role: string, viewport: string, theme?: string|null,
 *           locale?: string|null, state?: string|null, action?: string|null,
 *           component_kind?: string|null }} spec
 * @returns {string}
 */
function buildFilename(spec) {
  const safe = (v) => String(v).replace(/[^a-zA-Z0-9_.-]/g, '-');
  const parts = [safe(spec.role)];
  if (spec.viewport) parts.push(safe(spec.viewport));
  if (spec.theme) parts.push(safe(spec.theme));
  if (spec.locale) parts.push(safe(spec.locale));
  let leaf = safe(spec.id);
  if (spec.state) leaf += `__${safe(spec.state)}`;
  if (spec.action) leaf += `__${safe(spec.action)}`;
  return `${parts.join('/')}/${leaf}.png`;
}

function emptyManifest(baseUrl) {
  return {
    version: CURRENT_VERSION,
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    roles: [],
    captures: [],
    errors: [],
    warnings: [],
  };
}

function validate(manifest) {
  return manifestSchema.parse(manifest);
}

function read(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return validate(parsed);
}

function write(filePath, manifest) {
  const validated = validate(manifest);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf8');
}

/**
 * Push a capture, replacing any earlier entry with the same `file` path
 * (same filename = same logical shot, last write wins).
 */
function upsertCapture(manifest, capture) {
  const parsed = captureSchema.parse(capture);
  const idx = manifest.captures.findIndex((c) => c.file === parsed.file);
  if (idx >= 0) manifest.captures[idx] = parsed;
  else manifest.captures.push(parsed);
  if (!manifest.roles.includes(parsed.role)) manifest.roles.push(parsed.role);
  return parsed;
}

module.exports = {
  CURRENT_VERSION,
  schema: manifestSchema,
  captureSchema,
  emptyManifest,
  validate,
  read,
  write,
  upsertCapture,
  buildFilename,
};
