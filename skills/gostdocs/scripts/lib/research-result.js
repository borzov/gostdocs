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
  severity: z.enum(['info', 'warn', 'error']).optional(),
});

// Structured role model emitted by the role-discovery agent. Each entry
// feeds `GEN:role-activities` and `GEN:rbac-matrix` so the user-guide gets
// genuine activity lists instead of the template fallback "исследование
// ролей не вернуло данных".
const roleModelEntry = z.object({
  role: z.string().min(1),
  label: z.string().optional(),
  activities: z.array(z.string()).default([]),
  functions: z.array(z.string()).default([]),
  limits: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
});

// RBAC permission matrix for `GEN:rbac-matrix`. Every cell is a short label
// (e.g. "CRUD", "read-only", "—") — the renderer does not interpret them.
const rbacMatrixSchema = z.object({
  domains: z.array(z.string()).default([]),
  rows: z.array(z.object({
    role: z.string().min(1),
    cells: z.record(z.string()).default({}),
  })).default([]),
});

// Concrete security facts extracted from code, configuration, and specs.
// Every field is optional; expanders emit a factual paragraph whenever a
// field is present and otherwise fall back to the generic placeholder.
const securityFactsSchema = z.object({
  auth: z.object({
    scheme: z.string().optional(),
    notes: z.string().optional(),
    parameters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  }).optional(),
  password_policy: z.object({
    algorithm: z.string().optional(),
    cost: z.number().optional(),
    min_length: z.number().optional(),
    requires: z.array(z.string()).optional(),
  }).optional(),
  rbac: z.object({
    model: z.string().optional(),
    roles: z.array(z.string()).default([]).optional(),
    permissions_count: z.number().optional(),
    notes: z.string().optional(),
  }).optional(),
  audit_log: z.object({
    enabled: z.boolean().optional(),
    tables: z.array(z.string()).default([]).optional(),
    retention: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
  transport: z.object({
    tls_version: z.string().optional(),
    hsts: z.boolean().optional(),
    security_headers: z.array(z.string()).default([]).optional(),
    notes: z.string().optional(),
  }).optional(),
}).partial();

// Multistack manifest from project-introspect. Lets the tech-stack table
// distinguish backend and frontend in monorepo layouts instead of
// overwriting one with the other.
const stackManifestSchema = z.object({
  backend_stack: z.object({
    language: z.string().optional(),
    framework: z.string().optional(),
    version: z.string().optional(),
    manifest: z.string().optional(),
  }).optional(),
  frontend_stack: z.object({
    language: z.string().optional(),
    framework: z.string().optional(),
    version: z.string().optional(),
    manifest: z.string().optional(),
  }).optional(),
  containers: z.array(z.object({
    name: z.string(),
    image: z.string(),
    version: z.string().optional(),
  })).default([]).optional(),
}).partial();

const summarySchema = z
  .object({
    version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
    agent: z.string().min(1),
    generated_at: z.string(),
    coverage: z.array(coverageItemSchema).default([]),
    files: z.array(fileItemSchema).default([]),
    warnings: z.array(warningSchema).default([]),
    // Optional structured facts. When an agent produces these the generator
    // consumes them to replace template fallbacks with concrete prose.
    role_model: z.array(roleModelEntry).optional(),
    rbac_matrix: rbacMatrixSchema.optional(),
    security_facts: securityFactsSchema.optional(),
    stack_manifest: stackManifestSchema.optional(),
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

  // Merged structured facts. Later summaries override earlier ones on key
  // conflict so project-introspect can override an initial spec-reader guess.
  let roleModel = null;
  let rbacMatrix = null;
  let securityFacts = null;
  let stackManifest = null;

  for (const s of summaries) {
    agents.add(s.agent);
    totalFiles += s.files.length;
    for (const w of s.warnings) {
      warnings.push({ agent: s.agent, scope: w.scope, message: w.message, severity: w.severity || 'warn' });
    }
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
    if (Array.isArray(s.role_model) && s.role_model.length > 0) roleModel = s.role_model;
    if (s.rbac_matrix) rbacMatrix = s.rbac_matrix;
    if (s.security_facts) {
      securityFacts = { ...(securityFacts || {}), ...s.security_facts };
    }
    if (s.stack_manifest) {
      stackManifest = { ...(stackManifest || {}), ...s.stack_manifest };
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
    role_model: roleModel,
    rbac_matrix: rbacMatrix,
    security_facts: securityFacts,
    stack_manifest: stackManifest,
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
