#!/usr/bin/env node

/**
 * Bootstrap the skill runtime sandbox.
 *
 * Idempotent. On first run installs pinned dependencies into the skill's own
 * `node_modules/` and downloads the Chromium revision matching the pinned
 * Playwright version into `.playwright-cache/`. Also writes a puppeteer
 * config that points `@mermaid-js/mermaid-cli` at the same Chromium so we
 * do not double-download a headless browser. On subsequent runs verifies
 * presence and exits quickly.
 *
 * Environment:
 *   PLAYWRIGHT_BROWSERS_PATH exported into the skill cache.
 *   PUPPETEER_SKIP_DOWNLOAD=true during `npm ci` to prevent Puppeteer from
 *   pulling its own Chromium.
 *
 * Usage:
 *   node scripts/bootstrap.js            # install if missing
 *   node scripts/bootstrap.js --force    # reinstall even if present
 *   node scripts/bootstrap.js --check    # exit 0 if ready, non-zero otherwise
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const PKG_PATH = path.join(SKILL_DIR, 'package.json');
const NODE_MODULES = path.join(SKILL_DIR, 'node_modules');
const BROWSERS_PATH = path.join(SKILL_DIR, '.playwright-cache');
const PUPPETEER_CONFIG_FILENAME = '.puppeteer-config.json';
const DEFAULT_PUPPETEER_CFG = path.join(SKILL_DIR, PUPPETEER_CONFIG_FILENAME);
const MMDC_BIN_PATH = path.join(NODE_MODULES, '.bin', 'mmdc');

function readPinnedVersions() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const deps = pkg.dependencies || {};
  return {
    playwright: deps.playwright || '',
    mmdc: deps['@mermaid-js/mermaid-cli'] || '',
  };
}

function installedPlaywrightVersion() {
  const manifest = path.join(NODE_MODULES, 'playwright', 'package.json');
  if (!fs.existsSync(manifest)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function installedMmdcVersion() {
  const manifest = path.join(NODE_MODULES, '@mermaid-js', 'mermaid-cli', 'package.json');
  if (!fs.existsSync(manifest)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: SKILL_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH,
      PUPPETEER_SKIP_DOWNLOAD: 'true',
    },
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function installNodeModules() {
  const hasLockfile = fs.existsSync(path.join(SKILL_DIR, 'package-lock.json'));
  const npmCmd = hasLockfile ? ['ci'] : ['install', '--omit=dev'];
  process.stderr.write(`[bootstrap] Installing node_modules (npm ${npmCmd.join(' ')})...\n`);
  run('npm', npmCmd);
}

function chromiumExecutable() {
  try {
    const playwright = require(path.join(NODE_MODULES, 'playwright'));
    return playwright.chromium.executablePath();
  } catch {
    return null;
  }
}

function installChromium() {
  process.stderr.write('[bootstrap] Installing Chromium browser into sandbox...\n');
  run('npx', ['--no-install', 'playwright', 'install', 'chromium']);
}

function mmdcBinary() {
  return fs.existsSync(MMDC_BIN_PATH) ? MMDC_BIN_PATH : null;
}

function puppeteerConfigPath() {
  return DEFAULT_PUPPETEER_CFG;
}

function writePuppeteerConfig(executablePath, opts = {}) {
  if (!executablePath) return null;
  const outDir = opts.outDir || SKILL_DIR;
  const outPath = path.join(outDir, PUPPETEER_CONFIG_FILENAME);
  const config = {
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  return outPath;
}

function ensureRuntime({ force = false } = {}) {
  const pinned = readPinnedVersions();
  if (!pinned.playwright) {
    throw new Error('skills/gen-docs/package.json has no pinned playwright version');
  }
  if (!pinned.mmdc) {
    throw new Error('skills/gen-docs/package.json has no pinned @mermaid-js/mermaid-cli version');
  }

  const installedPw = installedPlaywrightVersion();
  const installedMmdc = installedMmdcVersion();
  if (force || installedPw !== pinned.playwright || installedMmdc !== pinned.mmdc || !mmdcBinary()) {
    installNodeModules();
  }

  const exePath = chromiumExecutable();
  if (force || !exePath || !fs.existsSync(exePath)) {
    installChromium();
  }

  const resolvedExe = chromiumExecutable();
  if (resolvedExe && fs.existsSync(resolvedExe)) {
    writePuppeteerConfig(resolvedExe);
  } else {
    process.stderr.write('[bootstrap] Warning: Playwright Chromium not found — mmdc will download its own browser on first render.\n');
  }

  if (!mmdcBinary()) {
    throw new Error('mmdc binary missing after npm install — check @mermaid-js/mermaid-cli installation');
  }
}

function checkRuntime() {
  const pinned = readPinnedVersions();
  if (installedPlaywrightVersion() !== pinned.playwright) return false;
  if (installedMmdcVersion() !== pinned.mmdc) return false;
  const exe = chromiumExecutable();
  if (!exe || !fs.existsSync(exe)) return false;
  if (!mmdcBinary()) return false;
  if (!fs.existsSync(DEFAULT_PUPPETEER_CFG)) return false;
  return true;
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const checkOnly = argv.includes('--check');

  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;

  if (checkOnly) {
    const ready = checkRuntime();
    process.stdout.write(ready ? 'ready\n' : 'missing\n');
    process.exit(ready ? 0 : 1);
  }

  try {
    ensureRuntime({ force });
    process.stdout.write('[bootstrap] Runtime ready.\n');
  } catch (err) {
    process.stderr.write(`[bootstrap] Failed: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureRuntime,
  checkRuntime,
  readPinnedVersions,
  installedPlaywrightVersion,
  installedMmdcVersion,
  chromiumExecutable,
  mmdcBinary,
  writePuppeteerConfig,
  puppeteerConfigPath,
  BROWSERS_PATH,
  SKILL_DIR,
  MMDC_BIN_PATH,
  DEFAULT_PUPPETEER_CFG,
};
