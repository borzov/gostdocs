'use strict';

/**
 * meta.yaml metadata autofill.
 *
 * Derives the routine fields of `meta.metadata` from the project's own
 * state so the user never has to type them twice:
 *
 *   year         — current system year (always available)
 *   version      — git tag, or package.json version, or composer.json,
 *                  or pyproject.toml
 *   organization — package.json "author" or git config user.name
 *   responsible  — git config user.name (+ user.email as a parenthetical)
 *
 * Fields the user already filled in always win — this module NEVER
 * overwrites existing values; it only proposes fill-ins for missing ones.
 *
 * Pure: the caller injects `readFile` and a git runner. Jest can fully
 * exercise every branch without touching disk.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => resolve({ stdout, stderr, code: -1, error: err }));
    proc.on('close', (code) => resolve({ stdout: stdout.trim(), stderr, code }));
  });
}

function readIfExists(readFile, filePath) {
  try {
    return readFile(filePath);
  } catch {
    return null;
  }
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Very small TOML-like extractor for pyproject.toml `[project]` or
 * `[tool.poetry]` sections. Good enough for version + name.
 */
function extractFromPyproject(text) {
  if (!text) return {};
  const out = {};
  const projectBlock = text.match(/\[project\]([\s\S]*?)(?:\n\[|$)/);
  const poetryBlock = text.match(/\[tool\.poetry\]([\s\S]*?)(?:\n\[|$)/);
  const block = (projectBlock && projectBlock[1]) || (poetryBlock && poetryBlock[1]) || '';
  const readKey = (key) => {
    const m = block.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`));
    return m ? m[1] : null;
  };
  const version = readKey('version');
  const name = readKey('name');
  if (version) out.version = version;
  if (name) out.organization_hint = name;
  return out;
}

/**
 * Derive autofill candidates.
 *
 * @param {string} projectPath
 * @param {{
 *   now?: () => Date,
 *   readFile?: (p: string) => string,
 *   gitRun?: (args: string[], cwd: string) => Promise<{stdout:string, code:number}>,
 * }} [opts]
 * @returns {Promise<{ year: string, version?: string, organization?: string, responsible?: string, sources: Record<string, string> }>}
 */
async function deriveMetadata(projectPath, opts = {}) {
  const now = opts.now || (() => new Date());
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const gitRun = opts.gitRun || runGit;

  const sources = {};
  const year = String(now().getFullYear());
  sources.year = 'system-date';

  let version = null;
  let organization = null;
  let responsible = null;

  // 1. Version from git tag.
  try {
    const tagResult = await gitRun(['-C', projectPath, 'describe', '--tags', '--abbrev=0'], projectPath);
    if (tagResult && tagResult.code === 0 && tagResult.stdout) {
      version = tagResult.stdout.replace(/^v/, '');
      sources.version = 'git-tag';
    }
  } catch {
    /* ignore */
  }

  // 2. package.json / composer.json / pyproject.toml — also candidates for version.
  const pkgText = readIfExists(readFile, path.join(projectPath, 'package.json'));
  const pkg = parseJsonSafe(pkgText);
  if (pkg) {
    if (!version && typeof pkg.version === 'string') {
      version = pkg.version;
      sources.version = 'package.json';
    }
    if (!organization) {
      if (typeof pkg.author === 'string') { organization = pkg.author; sources.organization = 'package.json author'; }
      else if (pkg.author && typeof pkg.author.name === 'string') { organization = pkg.author.name; sources.organization = 'package.json author.name'; }
      else if (typeof pkg.name === 'string') { organization = pkg.name; sources.organization = 'package.json name'; }
    }
  }

  const composerText = readIfExists(readFile, path.join(projectPath, 'composer.json'));
  const composer = parseJsonSafe(composerText);
  if (composer) {
    if (!version && typeof composer.version === 'string') {
      version = composer.version;
      sources.version = 'composer.json';
    }
    if (!organization && typeof composer.name === 'string') {
      organization = composer.name;
      sources.organization = 'composer.json name';
    }
  }

  const pyprojectText = readIfExists(readFile, path.join(projectPath, 'pyproject.toml'));
  const py = extractFromPyproject(pyprojectText || '');
  if (!version && py.version) { version = py.version; sources.version = 'pyproject.toml'; }
  if (!organization && py.organization_hint) { organization = py.organization_hint; sources.organization = 'pyproject.toml name'; }

  // 3. Responsible from git config.
  try {
    const nameResult = await gitRun(['-C', projectPath, 'config', '--get', 'user.name'], projectPath);
    const emailResult = await gitRun(['-C', projectPath, 'config', '--get', 'user.email'], projectPath);
    const userName = nameResult && nameResult.code === 0 ? nameResult.stdout : null;
    const userEmail = emailResult && emailResult.code === 0 ? emailResult.stdout : null;
    if (userName) {
      responsible = userEmail ? `${userName} (${userEmail})` : userName;
      sources.responsible = 'git config';
      if (!organization) {
        organization = userName;
        sources.organization = 'git config user.name';
      }
    }
  } catch {
    /* ignore */
  }

  /** @type {{ year: string, version?: string, organization?: string, responsible?: string, sources: Record<string,string> }} */
  const out = { year, sources };
  if (version) out.version = version;
  if (organization) out.organization = organization;
  if (responsible) out.responsible = responsible;
  return out;
}

/**
 * Merge autofill results into an existing metadata object. Never
 * overwrites an existing non-empty field.
 *
 * @param {Record<string, any>} existing
 * @param {Awaited<ReturnType<typeof deriveMetadata>>} derived
 * @returns {{ merged: Record<string, any>, applied: string[] }}
 */
function mergeMetadata(existing, derived) {
  const merged = { ...(existing || {}) };
  const applied = [];
  for (const key of ['year', 'version', 'organization', 'responsible']) {
    const current = merged[key];
    if ((current === undefined || current === null || current === '') && derived[key]) {
      merged[key] = derived[key];
      applied.push(key);
    }
  }
  return { merged, applied };
}

module.exports = {
  deriveMetadata,
  mergeMetadata,
  extractFromPyproject,
};
