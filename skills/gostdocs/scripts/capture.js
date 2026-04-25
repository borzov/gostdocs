#!/usr/bin/env node

/**
 * capture — Phase 3B / Phase 4 entry script.
 *
 * Consumes `docs/generated/_captures/plan.json` (produced by plan-capture.js)
 * and executes every capture tuple, producing PNGs under `docs/screenshots/`
 * and a manifest v2 under `docs/screenshots/manifest.json`.
 *
 * Flow:
 *   1. load plan + meta
 *   2. launch a single browser
 *   3. guest probe — classify routes as public / auth_required
 *   4. group tuples by (role, viewport, theme, locale) and iterate:
 *        - prepare BrowserContext via auth adapter (API-login primary)
 *        - open a page, run blocking healthcheck (verifyAuth)
 *        - for each tuple: resolve ids, substitute path, navigate,
 *          dismiss pop-overs, run actions, screenshot
 *   5. write manifest v2
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, assertConsistent, help } = require('./lib/cli');
const metaLib = require('./lib/meta');
const manifestLib = require('./lib/manifest');
const routes = require('./lib/routes');
const dismiss = require('./lib/dismiss');
const actionExecutor = require('./lib/action-executor');
const interactions = require('./lib/interactions');
const listScrape = require('./lib/list-scrape');
const idResolver = require('./adapters/id-resolver');
const authAdapter = require('./adapters/auth');
const errorPageDetector = require('./lib/error-page-detector');

const BROWSERS_PATH = path.resolve(__dirname, '..', '.playwright-cache');
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || BROWSERS_PATH;

function loadPlaywright() {
  // Resolved lazily so --help and --dry-run don't require the sandbox to be
  // bootstrapped.
  return require(path.resolve(__dirname, '..', 'node_modules', 'playwright'));
}

function planPath(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs',
    'generated',
    '_captures',
    'plan.json',
  );
}

function manifestPath(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs',
    'screenshots',
    'manifest.json',
  );
}

function outputRoot(metaData) {
  return path.resolve(
    metaData.project_path || process.cwd(),
    'docs',
    'screenshots',
  );
}

function groupKey(tuple) {
  const viewportName = tuple.viewport && tuple.viewport.name ? tuple.viewport.name : 'default';
  return `${tuple.role}|${viewportName}|${tuple.theme || '-'}|${tuple.locale || '-'}`;
}

function groupTuples(plan) {
  const groups = new Map();
  for (const tuple of plan) {
    const key = groupKey(tuple);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tuple);
  }
  return groups;
}

function filterPlan(plan, cli) {
  if (cli.rerunRoles && cli.rerunRoles.length > 0) {
    return plan.filter((t) => cli.rerunRoles.includes(t.role));
  }
  return plan;
}

function roleConfig(metaData, roleName) {
  const roles = (metaData.auth && metaData.auth.roles) || [];
  return roles.find((r) => r.role === roleName) || { role: roleName, credentials: null };
}

/**
 * Guest probe — for each unique public/potentially-public path in the plan,
 * run a guest fetch-ish HEAD via the browser to classify as public vs
 * auth_required. Result feeds skipping in capture.
 */
async function probeAccess(browser, metaData, plan) {
  const paths = new Map();
  for (const tuple of plan) {
    if (!tuple.path || paths.has(tuple.path)) continue;
    paths.set(tuple.path, tuple.pageId);
  }
  /** @type {Record<string, 'public'|'auth_required'>} */
  const access = {};
  if (paths.size === 0) return access;

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const [template, pageId] of paths.entries()) {
      try {
        const url = new URL(routes.substitute(template, {}, { allowMissing: true }), metaData.app.url).href;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const finalPath = new URL(page.url()).pathname;
        const requestedPath = new URL(url).pathname;
        const redirected = finalPath !== requestedPath && finalPath !== `${requestedPath}/`;
        const hasPassword = (await page.$('input[type=password]')) !== null;
        access[pageId] = redirected || hasPassword ? 'auth_required' : 'public';
      } catch {
        access[pageId] = 'public';
      }
    }
  } finally {
    await context.close();
  }
  return access;
}

async function probeUrlOk(url, fetchImpl, authHeaders) {
  if (!fetchImpl || !url) return { ok: null, status: null };
  // HEAD first (cheap), fall back to GET — many stacks return 405 on HEAD.
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetchImpl(url, { method, headers: authHeaders || {}, redirect: 'follow' });
      const status = typeof res.status === 'number' ? res.status : null;
      if (status === 405 && method === 'HEAD') continue;
      return { ok: status !== null && status >= 200 && status < 400, status };
    } catch {
      /* try next method */
    }
  }
  return { ok: null, status: null };
}

async function resolveTupleUrl(tuple, metaData, { page, fetchImpl, authHeaders, onWarning }) {
  if (!tuple.path) return null;
  if (!routes.isParametrized(tuple.path)) {
    return new URL(tuple.path, metaData.app.url).href;
  }
  const plan = idResolver.planResolution({
    id: tuple.pageId,
    path: tuple.path,
    parametrize: tuple.parametrize,
    list_endpoint: tuple.list_endpoint,
    list_selector: tuple.list_selector,
    id_attribute: tuple.id_attribute,
  });

  const values = { ...(tuple.parametrize || {}) };
  for (const step of plan.steps) {
    if (step.kind === 'explicit') {
      Object.assign(values, step.values);
      continue;
    }
    if (step.kind === 'collection' && fetchImpl) {
      try {
        const url = new URL(step.endpoint, metaData.app.url).href;
        const res = await fetchImpl(url, { headers: authHeaders || {} });
        if (res.ok || (res.status >= 200 && res.status < 300)) {
          const body = await res.json().catch(() => null);
          const id = idResolver.extractIdFromBody(body, step.idPath);
          if (id !== null && id !== undefined) {
            values[plan.missingParams[0]] = id;
            break;
          }
        }
      } catch {
        /* try next step */
      }
    }
    if (step.kind === 'list_scrape' && page) {
      try {
        const listUrl = new URL(step.listRoute, metaData.app.url).href;
        await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
        const id = await listScrape.scrapeId(page, {
          rowSelector: step.rowSelector,
          idAttribute: step.idAttribute,
        });
        if (id) {
          values[plan.missingParams[0]] = id;
          break;
        }
      } catch {
        /* give up */
      }
    }
  }

  let finalUrl;
  try {
    finalUrl = new URL(routes.substitute(tuple.path, values), metaData.app.url).href;
  } catch {
    return null;
  }

  // Probe the resolved URL when the caller supplied a fetch. The capture
  // phase will catch a 4xx / 5xx via error-page-detector anyway, but
  // this surfaces the root cause ("parametrize value doesn't resolve")
  // BEFORE the browser actually opens the page, so the REPORT tells the
  // user "update meta.yaml seed id" instead of the less actionable
  // "screenshot shows error page".
  if (fetchImpl && typeof onWarning === 'function') {
    const probe = await probeUrlOk(finalUrl, fetchImpl, authHeaders);
    if (probe.ok === false) {
      const explicitUsed = Object.keys(tuple.parametrize || {}).length > 0;
      const hint = explicitUsed
        ? `update meta.yaml pages[id=${tuple.pageId}].parametrize or add precheck.min_entities for the entity`
        : `no automatic id could be resolved — add meta.yaml pages[id=${tuple.pageId}].parametrize or seed the database`;
      onWarning({
        scope: `id-resolver:${tuple.pageId}`,
        message: `parametrized URL probe returned ${probe.status} for ${finalUrl}; ${hint}`,
      });
    }
  }

  return finalUrl;
}

async function captureGroup({ browser, metaData, tuples, authCtxCache, manifest, outRoot, fetchImpl }) {
  const roleName = tuples[0].role;
  const viewport = tuples[0].viewport || (metaData.capture && metaData.capture.viewports && metaData.capture.viewports[0]);
  const theme = tuples[0].theme;
  const locale = tuples[0].locale;

  const role = roleConfig(metaData, roleName);
  let prepared;
  try {
    prepared = await authAdapter.preparePlaywrightContext(browser, role, metaData, {
      fetchImpl,
      viewport: viewport ? { width: viewport.width, height: viewport.height } : undefined,
      locale: locale || undefined,
    });
  } catch (err) {
    manifest.errors.push({ role: roleName, capture_id: null, stage: 'auth', message: err.message });
    return;
  }
  for (const warning of prepared.warnings) {
    manifest.warnings.push({ scope: `auth:${roleName}`, message: warning });
  }

  const page = await prepared.context.newPage();
  page.setDefaultTimeout((metaData.capture && metaData.capture.timeout) || 30000);

  // Healthcheck for non-guest roles.
  if (prepared.authCtx.method !== 'none') {
    try {
      const health = await authAdapter.verifyAuth(page, prepared.authCtx, metaData);
      if (!health.passed) {
        manifest.errors.push({
          role: roleName, capture_id: null, stage: 'healthcheck',
          message: health.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join('; '),
        });
        await prepared.context.close();
        return;
      }
    } catch (err) {
      manifest.errors.push({ role: roleName, capture_id: null, stage: 'healthcheck', message: err.message });
      await prepared.context.close();
      return;
    }
  }

  const authHeaders = {};
  if (prepared.authCtx.tokenValue && prepared.authCtx.storage !== 'cookie') {
    const scheme = (metaData.auth && metaData.auth.authorization_scheme) || 'Bearer';
    authHeaders.Authorization = `${scheme} ${prepared.authCtx.tokenValue}`;
  }

  authCtxCache.set(roleName, prepared.authCtx);

  const waitMs = (metaData.capture && metaData.capture.wait_after_navigation) || 2000;
  const globalDismiss = (metaData.auth && metaData.auth.dismiss_selectors) || [];

  for (const tuple of tuples) {
    try {
      const url = await resolveTupleUrl(tuple, metaData, {
        page,
        fetchImpl,
        authHeaders,
        onWarning: (w) => manifest.warnings.push(w),
      });
      if (!url) {
        manifest.errors.push({ role: roleName, capture_id: tuple.pageId, stage: 'resolve', message: `could not resolve ${tuple.path}` });
        continue;
      }

      const finalUrl = interactions.buildUrlWithQuery(url, tuple.query_params);
      const navResponse = await page.goto(finalUrl, { waitUntil: 'networkidle' });
      await dismiss.applyDismiss(page, [...globalDismiss, ...((tuple.actions || []).flatMap((a) => a.dismiss || []))]);
      await page.waitForTimeout(waitMs);

      // After navigation has settled, check whether the browser actually
      // landed on the expected page. If the backend returned 4xx/5xx, the
      // URL redirected to an error route, or the title screams "Not
      // found / Ошибка / Forbidden", we must not take a screenshot —
      // the guide would otherwise render the error page as the product
      // screen.
      let pageTitle = '';
      try { pageTitle = await page.title(); } catch { /* title is optional */ }
      const errReport = errorPageDetector.detectErrorPage({
        response: navResponse,
        url: page.url ? page.url() : finalUrl,
        title: pageTitle,
        role: roleName,
      });
      if (errReport) {
        manifest.errors.push({
          role: roleName,
          capture_id: tuple.pageId,
          stage: 'error-page',
          message: errReport.reason,
          status: errReport.status,
          url: errReport.url,
          title: errReport.title,
        });
        continue;
      }

      // Optional DOM-level verification for parametrized detail pages.
      // When meta.capture.verify_detail_pages is enabled, scan the DOM for
      // error/empty-state markers. This catches the case where the backend
      // returned 200 but the frontend renders a "Not found" card — which
      // would otherwise slip through the title-based check above and end
      // up captured as "valid" documentation content.
      const verifyEnabled = metaData.capture && metaData.capture.verify_detail_pages === true;
      if (verifyEnabled) {
        const domReport = await errorPageDetector.detectDomErrorState(page);
        if (domReport) {
          manifest.errors.push({
            role: roleName,
            capture_id: tuple.pageId,
            stage: 'dom-verify',
            message: domReport.reason,
            url: page.url ? page.url() : finalUrl,
          });
          manifest.warnings.push({
            scope: 'capture:dom-verify',
            message: `page ${tuple.pageId} (${tuple.path}) rendered an error/empty state in the DOM (${domReport.selector}); skipping screenshot`,
          });
          continue;
        }
      }

      // Per-page interactions (FAQ accordion expansion, search field fill,
      // filter button click) run BEFORE actions so the action-driven multi-
      // shot loop sees the prepared state.
      //
      // A page that declares `show_filter_demo: true` in meta.yaml gets an
      // auto-generated search demo prepended here so the documentation
      // includes a "filter in action" screenshot without hand-written
      // selectors. The demo returns action-executor steps directly (no
      // translation needed); explicit interactions still run afterwards.
      const autoFilterSteps = tuple.showFilterDemo
        ? interactions.buildFilterInteractionsForList({ sample: tuple.filterSample, waitMs: tuple.filterWaitMs })
        : [];
      const interactionSteps = [
        ...autoFilterSteps,
        ...interactions.interactionsToActionSteps(tuple.interactions),
      ];
      if (interactionSteps.length > 0) {
        const ir = await actionExecutor.executeActions(page, interactionSteps, {
          dismissFn: (selectors) => dismiss.applyDismiss(page, selectors),
        });
        for (const err of ir.errors) {
          manifest.warnings.push({
            scope: `interactions:${tuple.pageId}`,
            message: `${err.stage} step ${err.step}: ${err.message}`,
          });
        }
      }

      // Actions (modals, filters applied, etc.) — produce either the final
      // shot (default) or multiple shots when steps set `screenshot: true`.
      let actionScreenshots = 0;
      if (Array.isArray(tuple.actions) && tuple.actions.length > 0) {
        const result = await actionExecutor.executeActions(page, tuple.actions, {
          dismissFn: (selectors) => dismiss.applyDismiss(page, selectors),
          screenshotFn: async (id) => {
            actionScreenshots += 1;
            const file = tuple.file.replace(/\.png$/, `__${id || `act${actionScreenshots}`}.png`);
            const absPath = path.join(outRoot, file);
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            await page.screenshot({ path: absPath, fullPage: Boolean(tuple.fullPage) });
            manifestLib.upsertCapture(manifest, {
              id: `${tuple.pageId}__${id || `act${actionScreenshots}`}`,
              path: tuple.path,
              role: roleName,
              viewport: viewport && viewport.name ? viewport.name : 'default',
              theme: theme || null,
              locale: locale || null,
              state: tuple.state || null,
              action_sequence: [id || `act${actionScreenshots}`],
              component_kind: tuple.component_kind || null,
              title: tuple.title || null,
              access: tuple.access || 'public',
              url,
              file,
              captured_at: new Date().toISOString(),
              success: true,
            });
          },
        });
        for (const err of result.errors) {
          manifest.errors.push({ role: roleName, capture_id: tuple.pageId, stage: `action:${err.stage}`, message: err.message });
        }
      }

      if (actionScreenshots === 0) {
        const absPath = path.join(outRoot, tuple.file);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        await page.screenshot({ path: absPath, fullPage: Boolean(tuple.fullPage) });
        manifestLib.upsertCapture(manifest, {
          id: tuple.pageId,
          path: tuple.path,
          role: roleName,
          viewport: viewport && viewport.name ? viewport.name : 'default',
          theme: theme || null,
          locale: locale || null,
          state: tuple.state || null,
          action_sequence: null,
          component_kind: tuple.component_kind || null,
          journey: tuple.journey || null,
          title: tuple.title || null,
          access: tuple.access || 'public',
          url,
          file: tuple.file,
          captured_at: new Date().toISOString(),
          success: true,
        });
      }
    } catch (err) {
      manifest.errors.push({ role: roleName, capture_id: tuple.pageId, stage: 'capture', message: err.message });
    }
  }

  await prepared.context.close();
}

async function runCapture(metaData, opts = {}) {
  const planFile = opts.planPath || planPath(metaData);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')).plan;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const outRoot = opts.outputRoot || outputRoot(metaData);
  const manifest = manifestLib.emptyManifest(metaData.app.url);

  const playwright = opts.playwright || loadPlaywright();
  const browser = opts.browser || await playwright.chromium.launch({ headless: true });

  try {
    const access = opts.accessMap || await probeAccess(browser, metaData, plan);
    for (const tuple of plan) {
      if (tuple.access === 'auth_required') continue;
      tuple.access = access[tuple.pageId] || 'public';
    }
    // Skip guest tuples for auth_required pages.
    const filtered = plan.filter((tuple) => {
      if (tuple.role === 'guest' && tuple.access === 'auth_required') {
        manifest.warnings.push({ scope: `capture:guest`, message: `skipped ${tuple.pageId} (auth_required)` });
        return false;
      }
      return true;
    });

    const authCtxCache = new Map();
    const groups = groupTuples(filtered);
    for (const tuples of groups.values()) {
      await captureGroup({ browser, metaData, tuples, authCtxCache, manifest, outRoot, fetchImpl });
    }
  } finally {
    if (!opts.browser) await browser.close();
  }

  fs.mkdirSync(path.dirname(manifestPath(metaData)), { recursive: true });
  manifestLib.write(manifestPath(metaData), manifest);
  return manifest;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  assertConsistent(cli);

  if (cli.skipScreenshots) {
    process.stdout.write('[capture] --skip-screenshots set; nothing to do\n');
    return;
  }

  const configPath = cli.config
    ? path.resolve(cli.config)
    : path.resolve(process.cwd(), 'docs', 'meta.yaml');
  const { data, log } = metaLib.load(configPath);
  for (const line of log) process.stderr.write(`[meta-migrate] ${line}\n`);

  const plan = JSON.parse(fs.readFileSync(planPath(data), 'utf8')).plan;
  const filtered = filterPlan(plan, cli);
  if (cli.dryRun) {
    process.stdout.write(`[capture] Dry run — would capture ${filtered.length} tuples\n`);
    return;
  }

  const manifest = await runCapture(data);
  process.stdout.write(
    `[capture] Wrote ${manifest.captures.length} screenshots; ${manifest.errors.length} errors; ${manifest.warnings.length} warnings\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[capture] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  runCapture,
  captureGroup,
  probeAccess,
  resolveTupleUrl,
  groupTuples,
};
