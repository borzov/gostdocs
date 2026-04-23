#!/usr/bin/env node

/**
 * plan-capture — Phase 3 entry script.
 *
 * Reads meta.yaml (+ journeys.yaml if present), optionally augments pages[]
 * with component-detector suggestions, and writes the deterministic capture
 * plan to `docs/generated/_captures/plan.json`.
 *
 * No browser is used here. The plan is access-agnostic — the subsequent
 * `capture.js` phase runs a guest probe and filters out guest tuples for
 * auth_required routes at execution time.
 *
 * Usage:
 *   node scripts/plan-capture.js --config ./docs/meta.yaml
 *   node scripts/plan-capture.js --config ./docs/meta.yaml --dry-run
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, assertConsistent, help } = require('./lib/cli');
const meta = require('./lib/meta');
const journeys = require('./lib/journeys');
const matrix = require('./lib/matrix');
const componentDetector = require('./adapters/component-detector/scanner');

function resolveConfigPath(cli) {
  if (cli.config) return path.resolve(cli.config);
  return path.resolve(process.cwd(), 'docs', 'meta.yaml');
}

function planOutputPath(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs',
    'generated',
    '_captures',
    'plan.json',
  );
}

/**
 * Derive extra pages from component detector, merged with meta.pages[]
 * without duplicating ids.
 */
function augmentPagesWithComponents(metaData) {
  if (!metaData.project_path) return { pages: metaData.pages || [], componentShots: [], components: [] };

  const scan = componentDetector.scanProject(metaData.project_path);
  const known = new Set((metaData.pages || []).map((p) => p.id));
  const componentShots = [];
  for (const component of scan.components) {
    for (const shot of componentDetector.suggestedShots(component)) {
      if (!known.has(shot.id)) componentShots.push(shot);
    }
  }
  return {
    pages: metaData.pages || [],
    componentShots,
    components: scan.components,
  };
}

async function runPlanCapture(metaData, opts = {}) {
  const journeysPath = journeys.resolvePath(metaData);
  const journeysFile = journeys.load(journeysPath);

  const { pages, componentShots, components } = augmentPagesWithComponents(metaData);

  const { plan, skipped } = matrix.buildMatrix({
    pages,
    componentShots,
    meta: metaData,
    journeys: journeysFile,
    accessMap: opts.accessMap || {},
  });

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: metaData.app && metaData.app.url,
    roles: (metaData.auth && metaData.auth.roles ? metaData.auth.roles.map((r) => r.role) : []),
    viewports: (metaData.capture && metaData.capture.viewports ? metaData.capture.viewports.map((v) => v.name) : []),
    themes: (metaData.capture && metaData.capture.themes) || [],
    locales: (metaData.capture && metaData.capture.locales) || [],
    states: metaData.states || [],
    counts: {
      tuples: plan.length,
      skipped: skipped.length,
      pages_declared: pages.length,
      pages_from_components: componentShots.length,
      journeys: (journeysFile.journeys || []).length,
    },
    components_detected: components.length,
  };

  return { plan, skipped, summary, journeys: journeysFile };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  assertConsistent(cli);

  const configPath = resolveConfigPath(cli);
  const { data, log } = meta.load(configPath);
  for (const line of log) process.stderr.write(`[meta-migrate] ${line}\n`);

  const { plan, skipped, summary } = await runPlanCapture(data);

  const outPath = planOutputPath(data);
  if (cli.dryRun) {
    process.stdout.write(`[plan-capture] Dry run — would write ${plan.length} tuples to ${outPath}\n`);
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ summary, plan, skipped }, null, 2),
    'utf8',
  );
  process.stdout.write(`[plan-capture] Wrote ${plan.length} tuples to ${outPath}\n`);
  process.stdout.write(
    `  roles=${summary.roles.length} viewports=${summary.viewports.length} themes=${summary.themes.length} locales=${summary.locales.length} journeys=${summary.counts.journeys} skipped=${skipped.length}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[plan-capture] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  runPlanCapture,
  augmentPagesWithComponents,
  planOutputPath,
};
