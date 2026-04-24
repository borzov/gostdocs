'use strict';

/**
 * Mermaid diagram renderer with graceful fallback.
 *
 * v0.3 policy: diagrams in Markdown must ship as images in the DOCX.
 * If `@mermaid-js/mermaid-cli` (binary name `mmdc`) is available, this
 * module renders each diagram to SVG/PNG and returns a Doc-Model figure
 * element pointing at the rendered file. If `mmdc` is missing or the
 * render fails, we degrade to a fenced plaintext block plus a warning so
 * the orchestrator surfaces it in REPORT.md.
 *
 * Subprocess is spawned via `child_process.spawn` (no shell) with argv
 * arguments; nothing from the diagram source reaches the shell.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const LOCAL_MMDC = path.join(SKILL_DIR, 'node_modules', '.bin', 'mmdc');
const DEFAULT_PUPPETEER_CFG = path.join(SKILL_DIR, '.puppeteer-config.json');

const DEFAULT_BIN = 'mmdc';
const DEFAULT_TIMEOUT_MS = 60000;

function resolveMmdcBin() {
  return fs.existsSync(LOCAL_MMDC) ? LOCAL_MMDC : DEFAULT_BIN;
}

function resolvePuppeteerConfig(explicit) {
  if (explicit === null) return null;
  if (typeof explicit === 'string') {
    return fs.existsSync(explicit) ? explicit : null;
  }
  return fs.existsSync(DEFAULT_PUPPETEER_CFG) ? DEFAULT_PUPPETEER_CFG : null;
}

function runSubprocess(bin, args, spawnOptions) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { ...spawnOptions, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (err) => resolve({ stdout, stderr, code: -1, error: err }));
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

let _checkCache = null;
async function isAvailable(binPath = DEFAULT_BIN, { runSub = runSubprocess } = {}) {
  if (_checkCache && _checkCache.bin === binPath) return _checkCache.available;
  const result = await runSub(binPath, ['--version'], { timeout: 5000 });
  const available = !result.error && result.code === 0;
  _checkCache = { bin: binPath, available };
  return available;
}

function resetAvailabilityCache() {
  _checkCache = null;
}

/**
 * Check whether `mmdc` is installed and report the version. Used by the
 * bootstrap `--check` path.
 *
 * @param {string} [binPath]
 * @param {{ runSub?: typeof runSubprocess }} [opts]
 * @returns {Promise<{ ok: boolean, version: string | null, error: string | null }>}
 */
async function verifyInstallation(binPath = resolveMmdcBin(), { runSub = runSubprocess } = {}) {
  const result = await runSub(binPath, ['--version'], { timeout: 5000 });
  if (result.error || result.code !== 0) {
    return { ok: false, version: null, error: result.error ? result.error.message : `exit ${result.code}` };
  }
  const version = (result.stdout || '').trim().split('\n').pop() || null;
  return { ok: true, version, error: null };
}

/**
 * Render a mermaid diagram to `outPath`. Format inferred from extension
 * (`.svg` or `.png`).
 *
 * @param {string} diagramSource
 * @param {string} outPath
 * @param {{
 *   binPath?: string,
 *   timeoutMs?: number,
 *   runSub?: typeof runSubprocess,
 *   writeFile?: (p: string, data: string) => void,
 *   puppeteerConfigPath?: string | null,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, path: string|null, warning: string|null, error: string|null }>}
 */
async function renderMermaid(diagramSource, outPath, opts = {}) {
  const binPath = opts.binPath || resolveMmdcBin();
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const runSub = opts.runSub || runSubprocess;
  const writeFile = opts.writeFile || ((p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data, 'utf8');
  });
  const puppeteerConfig = resolvePuppeteerConfig(
    Object.prototype.hasOwnProperty.call(opts, 'puppeteerConfigPath')
      ? opts.puppeteerConfigPath
      : undefined,
  );

  if (typeof diagramSource !== 'string' || !diagramSource.trim()) {
    return { ok: false, path: null, warning: null, error: 'empty diagram source' };
  }

  const available = await isAvailable(binPath, { runSub });
  if (!available) {
    return {
      ok: false,
      path: null,
      warning: `mmdc (mermaid-cli) not installed; diagram will be embedded as plaintext (${outPath})`,
      error: null,
    };
  }

  const tempSrc = `${outPath}.mmd`;
  try {
    writeFile(tempSrc, diagramSource);
  } catch (err) {
    return { ok: false, path: null, warning: null, error: `cannot write temp source: ${err.message}` };
  }

  const renderArgs = ['--input', tempSrc, '--output', outPath, '--quiet'];
  if (puppeteerConfig) {
    renderArgs.push('--puppeteerConfigFile', puppeteerConfig);
  }

  const result = await runSub(binPath, renderArgs, { timeout });
  if (result.error || result.code !== 0) {
    return {
      ok: false,
      path: null,
      warning: `mmdc failed (code ${result.code}); falling back to plaintext`,
      error: result.stderr || (result.error ? result.error.message : `exit ${result.code}`),
    };
  }
  return { ok: true, path: outPath, warning: null, error: null };
}

/**
 * Produce a Doc-Model element for a diagram. When rendering succeeds we
 * emit a figure; otherwise a fenced plaintext code block so the text
 * stays intact.
 */
async function renderToDocModelElement(input, opts = {}) {
  const result = await renderMermaid(input.source, input.outPath, opts);
  if (result.ok) {
    return {
      element: {
        type: 'figure',
        caption: input.caption,
        file: input.outPath,
      },
      warnings: [],
    };
  }
  const warnings = [];
  if (result.warning) warnings.push(result.warning);
  if (result.error) warnings.push(`mmdc error: ${result.error}`);
  return {
    element: {
      type: 'code',
      lang: 'mermaid',
      code: input.source.trim(),
    },
    warnings,
  };
}

module.exports = {
  isAvailable,
  renderMermaid,
  renderToDocModelElement,
  resetAvailabilityCache,
  resolveMmdcBin,
  verifyInstallation,
  runSubprocess,
  DEFAULT_BIN,
  DEFAULT_PUPPETEER_CFG,
  LOCAL_MMDC,
};
