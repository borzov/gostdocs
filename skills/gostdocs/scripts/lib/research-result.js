'use strict';

/**
 * Research-result schema + aggregator.
 *
 * Each research agent (doc-researcher, spec-reader, schema-adapter,
 * openapi-adapter, role-discovery) writes:
 *   - one or more topic files under `docs/generated/_research/*.md`
 *   - a machine-readable `<agent>.summary.json` with the coverage report
 *
 * The orchestrator reads every summary.json and builds a single coverage
 * overview used by Phase 6 (generation) and Phase 7 (REPORT.md).
 *
 * Schema is intentionally flat and vendor-neutral so any subagent can
 * produce valid output.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');

const CURRENT_VERSION = '1.0';

const coverageItemSchema = z.object({
  section: z.string().min(1),
  found: z.boolean(),
  source: z.string().nullable().default(null),
  size: z.number().int().nonnegative().default(0),
  missing: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
});

const fileItemSchema = z.object({
  path: z.string().min(1),
  section: z.string().min(1),
  bytes: z.number().int().nonnegative().default(0),
});

const warningSchema = z.object({
  scope: z.string().min(1),
  message: z.string().min(1),
});

const summarySchema = z
  .object({
    version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
    agent: z.string().min(1),
    generated_at: z.string(),
    coverage: z.array(coverageItemSchema).default([]),
    files: z.array(fileItemSchema).default([]),
    warnings: z.array(warningSchema).default([]),
  })
  .strict();

function emptySummary(agent) {
  return {
    version: CURRENT_VERSION,
    agent,
    generated_at: new Date().toISOString(),
    coverage: [],
    files: [],
    warnings: [],
  };
}

function validate(obj) {
  return summarySchema.parse(obj);
}

function readSummary(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return validate(JSON.parse(raw));
}

function writeSummary(filePath, summary) {
  const validated = validate(summary);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf8');
}

/**
 * Aggregate multiple summaries into a single overview. A section is marked
 * "found" when at least one summary reports it as found.
 *
 * @param {Array<ReturnType<typeof validate>>} summaries
 * @returns {{ agents: string[],
 *             totalFiles: number,
 *             sections: Array<{ section: string, found: boolean, agents: string[], sources: string[] }>,
 *             missingSections: string[],
 *             warnings: Array<{ agent: string, scope: string, message: string }> }}
 */
function aggregate(summaries) {
  /** @type {Map<string, { section: string, found: boolean, agents: Set<string>, sources: Set<string> }>} */
  const sections = new Map();
  const warnings = [];
  const agents = new Set();
  let totalFiles = 0;

  for (const s of summaries) {
    agents.add(s.agent);
    totalFiles += s.files.length;
    for (const w of s.warnings) warnings.push({ agent: s.agent, scope: w.scope, message: w.message });
    for (const item of s.coverage) {
      if (!sections.has(item.section)) {
        sections.set(item.section, {
          section: item.section,
          found: false,
          agents: new Set(),
          sources: new Set(),
        });
      }
      const entry = sections.get(item.section);
      if (item.found) entry.found = true;
      entry.agents.add(s.agent);
      if (item.source) entry.sources.add(item.source);
    }
  }

  const sectionsArr = [...sections.values()]
    .map((e) => ({
      section: e.section,
      found: e.found,
      agents: [...e.agents].sort(),
      sources: [...e.sources].sort(),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));

  return {
    agents: [...agents].sort(),
    totalFiles,
    sections: sectionsArr,
    missingSections: sectionsArr.filter((s) => !s.found).map((s) => s.section),
    warnings,
  };
}

module.exports = {
  CURRENT_VERSION,
  schema: summarySchema,
  emptySummary,
  validate,
  readSummary,
  writeSummary,
  aggregate,
};
