#!/usr/bin/env node

/**
 * Precheck — blocking environment verification before any capture.
 *
 * Checks (composable, skipped when not configured):
 *   baseUrl      GET <app.url> must return non-5xx within timeout
 *   health       GET <app.url><precheck.health_endpoint> must return 2xx
 *   authLogin    api-login per role reaches 2xx (Phase 2 will plug this in)
 *   minEntities  count resource rows meets threshold (Phase 4 will plug this in)
 *
 * Exits 0 on pass, 1 on fail. Prints remediation hints next to each failure.
 *
 * Usage:
 *   node scripts/precheck.js --config ./docs/meta.yaml
 *
 * Programmatic:
 *   const { runPrecheck } = require('./precheck');
 *   const result = await runPrecheck(meta, { fetchImpl });
 */

'use strict';

const path = require('path');
const { parseArgs, assertConsistent, help } = require('./lib/cli');
const meta = require('./lib/meta');
const authAdapter = require('./adapters/auth');

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * @typedef {{ name: string, passed: boolean, detail: string, remediation?: string, skipped?: boolean }} CheckResult
 */

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<CheckResult>} */
async function checkBaseUrl(metaData, ctx) {
  const url = metaData.app.url;
  try {
    const response = await fetchWithTimeout(ctx.fetchImpl, url, { redirect: 'manual' }, ctx.timeoutMs);
    const passed = response.status < 500;
    return {
      name: 'baseUrl',
      passed,
      detail: `${url} -> HTTP ${response.status}`,
      remediation: passed
        ? undefined
        : `Server returned ${response.status}. Start the app (e.g., "docker compose up -d") or check <app.url> in meta.yaml.`,
    };
  } catch (err) {
    return {
      name: 'baseUrl',
      passed: false,
      detail: `${url} unreachable: ${err.message}`,
      remediation: `Verify the application is running and <app.url> in meta.yaml points at it. Current value: ${url}`,
    };
  }
}

/** @returns {Promise<CheckResult>} */
async function checkHealth(metaData, ctx) {
  const endpoint = metaData.precheck && metaData.precheck.health_endpoint;
  if (!endpoint) return { name: 'health', passed: true, detail: 'skipped (not configured)', skipped: true };

  const url = new URL(endpoint, metaData.app.url).href;
  try {
    const response = await fetchWithTimeout(ctx.fetchImpl, url, {}, ctx.timeoutMs);
    const passed = response.status >= 200 && response.status < 300;
    return {
      name: 'health',
      passed,
      detail: `${url} -> HTTP ${response.status}`,
      remediation: passed
        ? undefined
        : `Health endpoint returned ${response.status}. Fix the underlying service or update precheck.health_endpoint.`,
    };
  } catch (err) {
    return {
      name: 'health',
      passed: false,
      detail: `${url} unreachable: ${err.message}`,
      remediation: 'Verify the health endpoint path; most frameworks expose /health or /healthz.',
    };
  }
}

/**
 * Uses the shared auth adapter to exercise api-login per role. Form-login
 * requires a browser and is reported as "deferred to capture phase".
 *
 * @returns {Promise<CheckResult[]>}
 */
async function checkAuthLogin(metaData, ctx) {
  const auth = metaData.auth || {};
  if (auth.method === 'none' || !Array.isArray(auth.roles) || auth.roles.length === 0) {
    return [{ name: 'authLogin', passed: true, detail: 'skipped (auth not configured)', skipped: true }];
  }
  if (auth.method === 'form') {
    return [
      {
        name: 'authLogin',
        passed: true,
        detail: 'deferred — form-login is verified during capture phase (browser required)',
        skipped: true,
      },
    ];
  }

  /** @type {CheckResult[]} */
  const results = [];
  for (const role of auth.roles) {
    if (role.credentials === null) {
      results.push({
        name: `authLogin:${role.role}`,
        passed: true,
        detail: 'skipped (guest role)',
        skipped: true,
      });
      continue;
    }
    if (!role.api_endpoint || !role.username || !role.password) {
      results.push({
        name: `authLogin:${role.role}`,
        passed: true,
        detail: 'skipped (role missing api_endpoint or credentials)',
        skipped: true,
      });
      continue;
    }
    try {
      const login = await authAdapter.apiLoginRequest(role, metaData, {
        fetchImpl: ctx.fetchImpl,
        timeoutMs: ctx.timeoutMs,
      });
      const detail = `${role.api_endpoint} -> HTTP ${login.status}${
        login.tokenKey ? `, storage=${login.storage}, token_key=${login.tokenKey}` : ''
      }`;
      results.push({
        name: `authLogin:${role.role}`,
        passed: login.ok,
        detail,
        remediation: login.ok
          ? undefined
          : `API login for role "${role.role}" returned ${login.status || 'no response'}${
              login.error ? ` (${login.error})` : ''
            }. Verify credentials, api_endpoint, and login_body shape.`,
      });
    } catch (err) {
      results.push({
        name: `authLogin:${role.role}`,
        passed: false,
        detail: `adapter error: ${err.message}`,
        remediation: `Auth adapter raised for role "${role.role}". Re-check meta.yaml shape.`,
      });
    }
  }
  return results;
}

/**
 * Phase 4 will replace this with a real schema-adapter check.
 * For now it is a placeholder that reports the configured thresholds and marks
 * itself as skipped — enforcing would require project-specific endpoints.
 *
 * @returns {Promise<CheckResult[]>}
 */
async function checkMinEntities(metaData /* , ctx */) {
  const min = metaData.precheck && metaData.precheck.min_entities;
  if (!min || Object.keys(min).length === 0) {
    return [{ name: 'minEntities', passed: true, detail: 'skipped (not configured)', skipped: true }];
  }
  const entries = Object.entries(min).map(([k, v]) => `${k}>=${v}`).join(', ');
  return [
    {
      name: 'minEntities',
      passed: true,
      detail: `declared thresholds: ${entries} (enforcement arrives in Phase 4)`,
      skipped: true,
    },
  ];
}

/**
 * Run all checks against a validated meta object.
 * @param {Record<string, unknown>} metaData
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
async function runPrecheck(metaData, opts = {}) {
  const ctx = {
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
  };
  if (typeof ctx.fetchImpl !== 'function') {
    throw new Error('fetch is not available; run on Node >= 18.17 or provide fetchImpl');
  }

  const checks = [];
  checks.push(await checkBaseUrl(metaData, ctx));
  checks.push(await checkHealth(metaData, ctx));
  checks.push(...(await checkAuthLogin(metaData, ctx)));
  checks.push(...(await checkMinEntities(metaData, ctx)));

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

function formatResult(result) {
  const lines = [];
  for (const c of result.checks) {
    const tag = c.skipped ? '-' : c.passed ? 'OK' : 'FAIL';
    lines.push(`[${tag}] ${c.name}: ${c.detail}`);
    if (!c.passed && c.remediation) lines.push(`       hint: ${c.remediation}`);
  }
  lines.push('');
  lines.push(result.passed ? 'Precheck passed.' : 'Precheck FAILED. Fix issues above and re-run.');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const cli = parseArgs(argv);
  if (cli.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  assertConsistent(cli);

  const configPath = path.resolve(
    cli.config || path.join(process.cwd(), 'docs', 'meta.yaml'),
  );
  const { data, log } = meta.load(configPath);
  for (const line of log) process.stderr.write(`[meta-migrate] ${line}\n`);

  const result = await runPrecheck(data);
  process.stdout.write(`${formatResult(result)}\n`);
  process.exit(result.passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[precheck] Fatal: ${err.message}\n`);
    process.exit(2);
  });
}

module.exports = {
  runPrecheck,
  checkBaseUrl,
  checkHealth,
  checkAuthLogin,
  checkMinEntities,
  formatResult,
};
