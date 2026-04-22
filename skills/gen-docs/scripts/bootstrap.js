#!/usr/bin/env node

/**
 * Bootstrap the skill runtime sandbox.
 *
 * Idempotent. On first run installs pinned dependencies into the skill's own
 * `node_modules/` and downloads the Chromium revision matching the pinned
 * Playwright version into `.playwright-cache/`. On subsequent runs verifies
 * presence and exits quickly.
 *
 * Environment:
 *   PLAYWRIGHT_BROWSERS_PATH is exported pointing at the sandbox cache so the
 *   skill never pollutes or depends on the user's global browser installation.
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

/** @returns {{playwright: string}} */
function readPinnedVersions() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  return { playwright: pkg.dependencies?.playwright || '' };
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

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: SKILL_DIR,
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
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
  const playwright = require(path.join(NODE_MODULES, 'playwright'));
  try {
    return playwright.chromium.executablePath();
  } catch (err) {
    return null;
  }
}

function installChromium() {
  process.stderr.write('[bootstrap] Installing Chromium browser into sandbox...\n');
  run('npx', ['--no-install', 'playwright', 'install', 'chromium']);
}

function ensureRuntime({ force = false } = {}) {
  const pinned = readPinnedVersions();
  if (!pinned.playwright) {
    throw new Error('skills/gen-docs/package.json has no pinned playwright version');
  }

  const installed = installedPlaywrightVersion();
  if (force || installed !== pinned.playwright) {
    installNodeModules();
  }

  const exePath = chromiumExecutable();
  if (force || !exePath || !fs.existsSync(exePath)) {
    installChromium();
  }
}

function checkRuntime() {
  const pinned = readPinnedVersions();
  const installed = installedPlaywrightVersion();
  if (installed !== pinned.playwright) return false;
  const exe = chromiumExecutable();
  return Boolean(exe && fs.existsSync(exe));
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
  chromiumExecutable,
  BROWSERS_PATH,
  SKILL_DIR,
};
