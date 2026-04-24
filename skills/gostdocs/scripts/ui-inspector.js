#!/usr/bin/env node

/**
 * ui-inspector — Phase 5B entry script.
 *
 * Iterates every capture in `docs/screenshots/manifest.json` and produces
 * the matching inspection JSON under `docs/generated/_inspection/`.
 *
 * Two provider paths:
 *   - `vision.provider=openai` + `OPENAI_API_KEY` → direct gpt-4o HTTP call
 *   - `vision.provider=claude` → the script writes a `_inspection/_pending.jsonl`
 *      file listing (file, prompt) pairs. The SKILL.md contract then tells
 *      Claude Code to iterate that list via its Agent tool, reading each
 *      PNG and returning structured JSON. The orchestrator finalises the
 *      Claude path separately.
 *
 * In both paths, shots flagged `is_login_form=true` in an authenticated
 * role are collected into `warnings[]` and surfaced in the final output.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, assertConsistent, help } = require('./lib/cli');
const metaLib = require('./lib/meta');
const manifestLib = require('./lib/manifest');
const inspectionStore = require('./lib/inspection-store');
const inspectionPrompt = require('./lib/inspection-prompt');
const openaiAdapter = require('./adapters/vision/openai');

function manifestPath(metaData) {
  return path.resolve(metaData.project_path || process.cwd(), 'docs', 'screenshots', 'manifest.json');
}

function screenshotRoot(metaData) {
  return path.resolve(metaData.project_path || process.cwd(), 'docs', 'screenshots');
}

function pendingPath(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs', 'generated', '_inspection', '_pending.jsonl',
  );
}

function summariseCapture(capture) {
  return {
    file: capture.file,
    role: capture.role,
    viewport: capture.viewport,
    theme: capture.theme,
    locale: capture.locale,
    path: capture.path,
    component_kind: capture.component_kind,
  };
}

function warnsForAuthedLogin(capture, parsed) {
  if (!parsed) return [];
  if (parsed.is_login_form && capture.role && capture.role !== 'guest') {
    return [{
      scope: 'is_login_form',
      file: capture.file,
      role: capture.role,
      message: `authenticated role "${capture.role}" landed on a login form — capture ${capture.file} is likely stale`,
    }];
  }
  return [];
}

async function runInspectorOpenAI({ manifest, metaData, opts }) {
  const root = screenshotRoot(metaData);
  const warnings = [];
  const errors = [];
  const written = [];
  const lang = (metaData.output && metaData.output.languages && metaData.output.languages[0] === 'en') ? 'en' : 'ru';

  for (const capture of manifest.captures) {
    const pngPath = path.join(root, capture.file);
    if (!fs.existsSync(pngPath)) {
      errors.push({ file: capture.file, stage: 'readFile', message: 'png not found' });
      continue;
    }
    const prompt = inspectionPrompt.buildPrompt(capture, { lang });
    const result = await openaiAdapter.inspect(pngPath, prompt, {
      fetchImpl: opts.fetchImpl,
      apiKey: opts.apiKey,
      endpoint: opts.endpoint,
      model: opts.model,
    });
    if (!result.ok || !result.parsed) {
      errors.push({ file: capture.file, stage: 'vision', message: result.error || 'no JSON' });
      continue;
    }
    const record = {
      version: '1.0',
      file: capture.file,
      role: capture.role,
      viewport: capture.viewport,
      theme: capture.theme,
      locale: capture.locale,
      inspector: 'openai',
      captured_at: new Date().toISOString(),
      ...result.parsed,
    };
    try {
      inspectionStore.write(metaData.project_path, capture.file, record);
      written.push(capture.file);
    } catch (err) {
      errors.push({ file: capture.file, stage: 'store', message: err.message });
      continue;
    }
    warnings.push(...warnsForAuthedLogin(capture, result.parsed));
  }

  return { provider: 'openai', written, errors, warnings };
}

function writePendingClaudeJobs({ manifest, metaData }) {
  const lang = (metaData.output && metaData.output.languages && metaData.output.languages[0] === 'en') ? 'en' : 'ru';
  const out = pendingPath(metaData);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const root = screenshotRoot(metaData);
  const rows = [];
  for (const capture of manifest.captures) {
    rows.push(JSON.stringify({
      capture: summariseCapture(capture),
      png_path: path.join(root, capture.file),
      target_json: inspectionStore.resolveJsonPath(metaData.project_path, capture.file),
      prompt: inspectionPrompt.buildPrompt(capture, { lang }),
    }));
  }
  fs.writeFileSync(out, rows.join('\n') + '\n', 'utf8');
  return { provider: 'claude', pending_file: out, count: rows.length };
}

async function runInspector(metaData, opts = {}) {
  const file = opts.manifestPath || manifestPath(metaData);
  const manifest = manifestLib.read(file);
  const provider = (metaData.vision && metaData.vision.provider) || 'claude';
  if (provider === 'openai') {
    return runInspectorOpenAI({ manifest, metaData, opts });
  }
  return writePendingClaudeJobs({ manifest, metaData });
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
  if (cli.visionProvider) data.vision = { ...(data.vision || {}), provider: cli.visionProvider };

  if (cli.dryRun) {
    const file = manifestPath(data);
    const manifest = manifestLib.read(file);
    process.stdout.write(`[ui-inspector] Dry run — ${manifest.captures.length} captures, provider=${(data.vision && data.vision.provider) || 'claude'}\n`);
    return;
  }

  const result = await runInspector(data);
  if (result.provider === 'openai') {
    process.stdout.write(
      `[ui-inspector] OpenAI: wrote ${result.written.length} inspections, ${result.warnings.length} warnings, ${result.errors.length} errors\n`,
    );
    for (const w of result.warnings) process.stderr.write(`  warn: ${w.message}\n`);
  } else {
    process.stdout.write(
      `[ui-inspector] Claude: wrote ${result.count} pending jobs to ${result.pending_file}\n`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[ui-inspector] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  runInspector,
  runInspectorOpenAI,
  writePendingClaudeJobs,
  warnsForAuthedLogin,
};
