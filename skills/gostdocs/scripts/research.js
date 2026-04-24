#!/usr/bin/env node

/**
 * research — Phase 4 orchestrator CLI.
 *
 * This script does NOT invoke subagents directly — that is the LLM's job,
 * driven by the subagent contract in SKILL.md. What this script does is
 * consume the artifacts subagents have already written:
 *
 *   docs/generated/_research/<agent>.summary.json     per-agent coverage
 *   docs/generated/_research/*.md                     prose outputs
 *
 * It produces:
 *   docs/generated/_research/coverage.json            aggregated coverage
 *                                                     + NFR directives
 *                                                     + AI-artifact flags
 *
 * Stages:
 *   1. read every *.summary.json
 *   2. aggregate via research-result
 *   3. apply NFR policy (strict vs lite)
 *   4. optionally run schema adapter if no schema agent wrote results
 *   5. optionally run openapi adapter if spec file is configured
 *   6. scan _research/*.md for AI-artifact markers (never cited later)
 *   7. write coverage.json summary
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, assertConsistent, help } = require('./lib/cli');
const metaLib = require('./lib/meta');
const researchResult = require('./lib/research-result');
const nfrPolicy = require('./lib/nfr-policy');
const aiFilter = require('./lib/ai-artifact-filter');
const schemaAdapter = require('./adapters/schema');
const openapi = require('./adapters/openapi');

function researchDir(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs',
    'generated',
    '_research',
  );
}

function listSummaryFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.summary.json'))
    .map((f) => path.join(root, f));
}

function listMarkdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(root, f));
}

function readMarkdownSources(root) {
  return listMarkdownFiles(root).map((file) => ({
    path: file,
    content: fs.readFileSync(file, 'utf8'),
  }));
}

function schemaAgentPresent(summaries) {
  return summaries.some((s) => /schema/i.test(s.agent));
}

function openapiAgentPresent(summaries) {
  return summaries.some((s) => /openapi|swagger/i.test(s.agent));
}

/**
 * @param {{ project_path: string, gost_mode: 'strict'|'lite', output?: any }} metaData
 * @param {{ liveDb?: boolean, openapiPath?: string, writeOutput?: boolean }} [opts]
 */
async function runResearch(metaData, opts = {}) {
  const root = researchDir(metaData);
  const summaryFiles = listSummaryFiles(root);
  const summaries = summaryFiles.map((f) => researchResult.readSummary(f));

  // Run schema adapter if no schema agent contributed.
  let schema = null;
  if (!schemaAgentPresent(summaries)) {
    schema = await schemaAdapter.extractSchema(metaData.project_path, {
      liveDb: Boolean(opts.liveDb),
    });
  }

  // Run openapi adapter if a spec path is configured and no openapi agent contributed.
  let openApiDoc = null;
  if (opts.openapiPath && !openapiAgentPresent(summaries)) {
    openApiDoc = openapi.loadAndNormalise(opts.openapiPath);
  }

  const aggregate = researchResult.aggregate(summaries);
  const gostMode = metaData.gost_mode;
  const lang = (metaData.output && metaData.output.languages && metaData.output.languages[0] === 'en') ? 'en' : 'ru';
  const nfr = nfrPolicy.applyNfrPolicy(aggregate, gostMode, { lang });

  const aiArtifacts = aiFilter.partition(readMarkdownSources(root));
  const aiFlagged = aiArtifacts.ai.map((entry) => ({
    path: entry.path,
    confidence: entry.detection.confidence,
    reasons: entry.detection.reasons,
  }));

  const coverageReport = {
    generated_at: new Date().toISOString(),
    gost_mode: gostMode,
    aggregate,
    nfr: {
      directives: nfr.directives,
      warnings: nfr.warnings,
      blockers: nfr.blockers,
    },
    schema: schema ? {
      source: schema.schema.source,
      framework: schema.framework,
      supported: schema.supported,
      tables_count: schema.schema.tables.length,
      warnings: schema.warnings,
    } : null,
    openapi: openApiDoc ? {
      endpoints_count: openApiDoc.endpoints.length,
      info: openApiDoc.info,
      warnings: openApiDoc.warnings,
    } : null,
    ai_artifacts: aiFlagged,
  };

  if (opts.writeOutput) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'coverage.json'),
      JSON.stringify(coverageReport, null, 2),
      'utf8',
    );
    // Persist the normalised OpenAPI document so the generator can render a
    // detailed endpoints section without re-parsing the original spec.
    if (openApiDoc) {
      fs.writeFileSync(
        path.join(root, 'openapi.json'),
        JSON.stringify(openApiDoc, null, 2),
        'utf8',
      );
    }
  }

  return coverageReport;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  assertConsistent(cli);

  const configPath = cli.config
    ? path.resolve(cli.config)
    : path.resolve(process.cwd(), 'docs', 'meta.yaml');
  const { data, log } = metaLib.load(configPath);
  for (const line of log) process.stderr.write(`[meta-migrate] ${line}\n`);

  const openapiPath = cli.extras
    .map((v, i, arr) => (v === '--openapi' ? arr[i + 1] : null))
    .filter(Boolean)[0] || null;

  const report = await runResearch(data, {
    liveDb: cli.liveDb,
    openapiPath,
    writeOutput: !cli.dryRun,
  });

  const nfr = report.nfr;
  const blockers = nfr.blockers.length;
  const warnings = nfr.warnings.length;
  process.stdout.write(
    `[research] agents=${report.aggregate.agents.length} sections=${report.aggregate.sections.length} missing=${report.aggregate.missingSections.length} ai_flagged=${report.ai_artifacts.length} blockers=${blockers} warnings=${warnings}\n`,
  );
  if (blockers > 0 && data.gost_mode === 'strict') {
    for (const b of nfr.blockers) process.stderr.write(`[research] BLOCKER ${b.scope}: ${b.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[research] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  runResearch,
  researchDir,
};
