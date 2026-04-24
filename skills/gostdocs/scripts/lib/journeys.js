'use strict';

/**
 * journeys.yaml — narrated step-by-step flows where each step optionally
 * produces a screenshot. Rendered by Phase 6 as numbered "step -> figure"
 * sequences in the final document.
 *
 * Stored in a separate file (not meta.yaml) per the v0.3 architecture
 * decisions: journeys grow large and are edited independently of the
 * otherwise-stable meta.yaml. Default path is `journeys.yaml` at the
 * project root, overridden via meta.yaml `journeys_file`.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');
const YAML = resolveModule('yaml');

const stepSchema = z
  .object({
    title: z.string().optional(),
    goto: z.string().optional(),
    click: z.string().optional(),
    fill: z.record(z.string()).optional(),
    wait_for: z.string().optional(),
    wait_ms: z.number().int().nonnegative().optional(),
    dismiss: z.array(z.string()).optional(),
    screenshot: z.boolean().default(false),
    caption: z.string().optional(),
  })
  .refine(
    (s) => s.goto || s.click || s.fill || s.wait_for || s.wait_ms || s.dismiss || s.screenshot,
    { message: 'step must perform at least one action' },
  );

const journeySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  role: z.string().min(1),
  viewport: z.string().optional(),
  theme: z.string().optional(),
  locale: z.string().optional(),
  steps: z.array(stepSchema).min(1),
});

const fileSchema = z
  .object({
    version: z.literal('1.0').default('1.0'),
    journeys: z.array(journeySchema).default([]),
  })
  .strict();

/**
 * Normalise a journey: assign stable step ids, default-fill screenshot
 * fields, sort steps in the declared order (no silent reordering).
 */
function normaliseJourney(j) {
  const journey = { ...j, steps: [] };
  for (let i = 0; i < j.steps.length; i++) {
    const step = { ...j.steps[i] };
    step.index = i + 1;
    step.id = `${j.name}__${String(i + 1).padStart(2, '0')}`;
    journey.steps.push(step);
  }
  return journey;
}

/** Validate a parsed object. @returns normalised journey file. */
function validate(obj) {
  const parsed = fileSchema.parse(obj);
  return {
    ...parsed,
    journeys: parsed.journeys.map(normaliseJourney),
  };
}

/**
 * Load journeys.yaml from disk. Returns `{ version: '1.0', journeys: [] }`
 * when the file is absent (journeys are optional).
 *
 * @param {string} filePath
 * @returns {{ version: string, journeys: Array<ReturnType<typeof normaliseJourney>> }}
 */
function load(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: '1.0', journeys: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw) || { journeys: [] };
  return validate(parsed);
}

/** Resolve `journeys_file` (meta.yaml field) against project_path. */
function resolvePath(meta) {
  const name = meta.journeys_file || 'journeys.yaml';
  if (path.isAbsolute(name)) return name;
  return path.resolve(meta.project_path || process.cwd(), name);
}

module.exports = {
  schema: fileSchema,
  journeySchema,
  stepSchema,
  load,
  validate,
  normaliseJourney,
  resolvePath,
};
