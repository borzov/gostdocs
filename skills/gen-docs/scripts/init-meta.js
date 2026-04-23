#!/usr/bin/env node

/**
 * init-meta — interactive (orchestrator-driven) meta.yaml builder.
 *
 * Modes:
 *
 *   --report                  Run introspect + route-discover, propose a meta
 *                             object, list gaps. Print a JSON envelope to
 *                             stdout for the orchestrator (Claude reading
 *                             SKILL.md) to feed into AskUserQuestion calls.
 *
 *   --apply <answers.json>    Read user answers (dotted-path map) and merge
 *                             into the proposed meta. Validate, write to
 *                             docs/meta.yaml, append to .gitignore.
 *
 *   --dry-run                 With --apply, print the merged meta to stdout
 *                             instead of writing to disk.
 *
 * Common flags:
 *   --project-path <dir>      Defaults to CWD.
 *   --config <path>           Path to existing meta.yaml; defaults to
 *                             <project>/docs/meta.yaml. Loaded if exists.
 *
 * The orchestrator workflow:
 *   1. node scripts/init-meta.js --report > /tmp/report.json
 *   2. orchestrator parses report.json, AskUserQuestion for each gap
 *   3. write { "metadata.system_name": "...", "auth.roles[admin].password": "..." } as answers.json
 *   4. node scripts/init-meta.js --apply /tmp/answers.json
 *   5. proceed with the rest of the pipeline (research, plan-capture, ...)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const yaml = require(path.resolve(__dirname, '..', 'node_modules', 'yaml'));
const meta = require('./lib/meta');
const projectIntrospect = require('./lib/project-introspect');
const routeDiscover = require('./lib/route-discover');
const metaBuilder = require('./lib/meta-builder');
const gapCollector = require('./lib/gap-collector');

function parseFlags(argv) {
  const flags = { report: false, apply: null, dryRun: false, projectPath: null, config: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--report') flags.report = true;
    else if (a === '--apply') flags.apply = argv[++i];
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--project-path') flags.projectPath = argv[++i];
    else if (a === '--config') flags.config = argv[++i];
    else if (a === '--help' || a === '-h') flags.help = true;
  }
  return flags;
}

function help() {
  return [
    'Usage:',
    '  node scripts/init-meta.js --report [--project-path DIR] [--config PATH]',
    '  node scripts/init-meta.js --apply ANSWERS.json [--project-path DIR] [--config PATH] [--dry-run]',
    '',
    '  --report  emits JSON {proposed_meta, gaps, sources, framework} to stdout',
    '  --apply   merges dotted-path answers, validates, writes docs/meta.yaml',
  ].join('\n');
}

function loadExistingMeta(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return yaml.parse(raw) || {};
  } catch {
    return null;
  }
}

function readPackageName(projectPath) {
  try {
    const p = path.join(projectPath, 'package.json');
    if (!fs.existsSync(p)) return null;
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    return pkg && typeof pkg.name === 'string' ? pkg.name : null;
  } catch { return null; }
}

async function reportGaps(opts) {
  const projectPath = path.resolve(opts.projectPath || process.cwd());
  const configPath = opts.config || path.join(projectPath, 'docs', 'meta.yaml');
  const existing = loadExistingMeta(configPath) || {};

  const introspect = await projectIntrospect.deriveProjectMetadata(projectPath);
  const routes = routeDiscover.discoverRoutes(projectPath);
  const roles = []; // role discovery is performed by the research phase; not run here

  const proposed = metaBuilder.propose(existing, {
    projectPath, introspect, routes, roles,
  });

  const gaps = gapCollector.collectGaps(proposed, {
    introspect,
    packageName: readPackageName(projectPath),
  });

  return {
    proposed_meta: proposed,
    gaps,
    sources: introspect.sources,
    framework: introspect.framework,
    routes_count: routes.length,
    config_path: configPath,
  };
}

function ensureGitignored(projectPath, relPath) {
  const giPath = path.join(projectPath, '.gitignore');
  let body = '';
  try { body = fs.readFileSync(giPath, 'utf8'); } catch { /* missing is fine */ }
  if (body.split('\n').map((s) => s.trim()).includes(relPath)) return false;
  const next = (body.endsWith('\n') || body === '' ? body : body + '\n') + relPath + '\n';
  fs.writeFileSync(giPath, next, 'utf8');
  return true;
}

async function applyAnswers(opts) {
  const projectPath = path.resolve(opts.projectPath || process.cwd());
  const configPath = opts.config || path.join(projectPath, 'docs', 'meta.yaml');
  const existing = loadExistingMeta(configPath) || {};
  const answers = JSON.parse(fs.readFileSync(opts.apply, 'utf8'));

  const introspect = await projectIntrospect.deriveProjectMetadata(projectPath);
  const routes = routeDiscover.discoverRoutes(projectPath);

  const built = metaBuilder.buildMeta({
    existing, introspect, routes, roles: [], answers, projectPath,
  });

  if (opts.dryRun) return { meta: built, written: null };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.stringify(built, { lineWidth: 0 }), 'utf8');
  const giAdded = ensureGitignored(projectPath, path.relative(projectPath, configPath));
  return { meta: built, written: configPath, gitignore_added: giAdded };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) { process.stdout.write(help() + '\n'); return 0; }

  if (flags.report) {
    const out = await reportGaps(flags);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }

  if (flags.apply) {
    const out = await applyAnswers(flags);
    if (flags.dryRun) {
      process.stdout.write(yaml.stringify(out.meta, { lineWidth: 0 }));
    } else {
      process.stdout.write(`[init-meta] wrote ${out.written}\n`);
      if (out.gitignore_added) process.stdout.write(`[init-meta] added ${path.relative(path.resolve(flags.projectPath || process.cwd()), out.written)} to .gitignore\n`);
    }
    return 0;
  }

  process.stderr.write('Specify --report or --apply ANSWERS.json. See --help.\n');
  return 1;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code || 0),
    (err) => {
      process.stderr.write(`[init-meta] fatal: ${err.stack || err.message}\n`);
      process.exit(1);
    },
  );
}

module.exports = { reportGaps, applyAnswers, parseFlags, ensureGitignored };
