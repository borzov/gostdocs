'use strict';

/**
 * Per-screenshot UI inspection record.
 *
 * Produced by the vision agent for every PNG in the manifest. Consumed by
 * Phase 6 generation: the checklist per screen (breadcrumb, top buttons,
 * filters, column headers, row actions, etc.) is filled from this JSON, not
 * inferred by the writer agent.
 *
 * Schema is deliberately narrow — vision models hallucinate less when the
 * shape is explicit. Unknown fields are stripped by `.strict()`.
 */

const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');

const CURRENT_VERSION = '1.0';

const buttonSchema = z.object({
  label: z.string().min(1),
  location: z.enum(['top-bar', 'sidebar', 'row', 'modal', 'floating', 'other']).default('other'),
  icon_only: z.boolean().default(false),
});

const filterSchema = z.object({
  label: z.string().min(1),
  control: z.enum(['text', 'select', 'date', 'toggle', 'checkbox', 'range', 'other']).default('other'),
  options: z.array(z.string()).default([]),
});

const tableSchema = z.object({
  columns: z.array(z.object({
    header: z.string().min(1),
    example: z.string().nullable().default(null),
  })).default([]),
  row_actions: z.array(z.string()).default([]),
  bulk_actions: z.array(z.string()).default([]),
  has_pagination: z.boolean().default(false),
});

const inspectionSchema = z
  .object({
    version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
    file: z.string().min(1),
    role: z.string().min(1),
    viewport: z.string().min(1),
    theme: z.string().nullable().default(null),
    locale: z.string().nullable().default(null),

    title: z.string().nullable().default(null),
    breadcrumb: z.array(z.string()).default([]),
    layout: z.string().nullable().default(null),

    top_buttons: z.array(buttonSchema).default([]),
    filters: z.array(filterSchema).default([]),
    table: tableSchema.nullable().default(null),
    modals_visible: z.array(z.string()).default([]),

    is_login_form: z.boolean().default(false),
    is_error_page: z.boolean().default(false),
    is_empty_state: z.boolean().default(false),

    component_kind_notes: z.string().nullable().default(null),
    inspector: z.enum(['claude', 'openai', 'manual']).default('claude'),
    captured_at: z.string().nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .strict();

function empty(file, role, viewport) {
  return {
    version: CURRENT_VERSION,
    file,
    role,
    viewport,
    theme: null,
    locale: null,
    title: null,
    breadcrumb: [],
    layout: null,
    top_buttons: [],
    filters: [],
    table: null,
    modals_visible: [],
    is_login_form: false,
    is_error_page: false,
    is_empty_state: false,
    component_kind_notes: null,
    inspector: 'claude',
    captured_at: null,
    notes: null,
  };
}

function validate(obj) {
  return inspectionSchema.parse(obj);
}

/**
 * Extract the first JSON object from a vision-model response. Tolerates
 * prose wrapping and code fences.
 *
 * @param {string} raw
 * @returns {unknown|null}
 */
function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();

  // Fenced ```json ... ``` blocks are most common.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }

  // Outer braces.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = {
  CURRENT_VERSION,
  schema: inspectionSchema,
  buttonSchema,
  filterSchema,
  tableSchema,
  empty,
  validate,
  extractJson,
};
