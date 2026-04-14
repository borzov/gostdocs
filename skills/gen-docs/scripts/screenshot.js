#!/usr/bin/env node

/**
 * Playwright screenshot automation script for documentation generation.
 *
 * Usage:
 *   node screenshot.js --config config.json --output ./screenshots
 *   cat config.json | node screenshot.js --output ./screenshots
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { config: null, output: './screenshots' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      result.config = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      result.output = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: screenshot.js [--config <path>] [--output <dir>]');
      console.log('  --config  Path to JSON config file (or pipe via stdin)');
      console.log('  --output  Output directory for screenshots (default: ./screenshots)');
      process.exit(0);
    }
  }

  return result;
}

async function readConfig(configPath) {
  if (configPath) {
    const raw = fs.readFileSync(path.resolve(configPath), 'utf-8');
    return JSON.parse(raw);
  }

  // Read from stdin
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      reject(new Error('Timeout reading config from stdin (5s). Use --config flag or pipe JSON.'));
    }, 5000);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid JSON from stdin: ${err.message}`));
      }
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    process.stdin.resume();
  });
}

/**
 * Authenticate a browser context using role credentials.
 * Opens a temporary page for login, fills the form, submits, then closes the page.
 * Auth cookies are stored in the context and reused for all subsequent pages.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {{role: string, login_url?: string, username: string, password: string,
 *          username_field?: string, password_field?: string, submit_button?: string}} roleConfig
 * @param {{baseUrl: string, timeout?: number}} config
 */
async function authenticate(context, roleConfig, config) {
  const loginUrl = new URL(roleConfig.login_url || '/login', config.baseUrl).href;
  const timeout = config.timeout || 30000;

  console.log(`  [${roleConfig.role}] Authenticating at ${loginUrl}...`);

  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout });

  let usernameSelector = roleConfig.username_field || null;
  let passwordSelector = roleConfig.password_field || null;
  let submitSelector = roleConfig.submit_button || null;

  if (!usernameSelector || !passwordSelector || !submitSelector) {
    const detected = await autoDetectFormFields(page);
    if (!detected) {
      await page.close();
      throw new Error(`No login form found at ${loginUrl}`);
    }
    usernameSelector = usernameSelector || detected.usernameSelector;
    passwordSelector = passwordSelector || detected.passwordSelector;
    submitSelector = submitSelector || detected.submitSelector;
  }

  if (!usernameSelector || !passwordSelector || !submitSelector) {
    await page.close();
    throw new Error(`Could not resolve all form fields at ${loginUrl}. Provide explicit selectors in auth_roles config.`);
  }

  await page.fill(usernameSelector, roleConfig.username);
  await page.fill(passwordSelector, roleConfig.password);
  await page.click(submitSelector);
  await page.waitForLoadState('networkidle', { timeout });
  await page.close();

  console.log(`  [${roleConfig.role}] Authentication complete.`);
}

/**
 * Auto-detect login form field selectors from the current page DOM.
 * Returns null if no password field is found (not a login page).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{usernameSelector: string, passwordSelector: string, submitSelector: string}|null>}
 */
async function autoDetectFormFields(page) {
  const hasPassword = await page.$('input[type=password]');
  if (!hasPassword) return null;

  const passwordSelector = await page.evaluate(() => {
    const el = document.querySelector('input[type=password]');
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    if (el.name) return `input[name="${el.name}"]`;
    return 'input[type=password]';
  });

  const usernameSelector = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll('input[type=text], input[type=email]')
    );
    const el = inputs[inputs.length - 1]; // last text/email input is typically the username field
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    if (el.name) return `input[name="${el.name}"]`;
    return 'input[type=email], input[type=text]';
  });

  const submitSelector = await page.evaluate(() => {
    const btn = document.querySelector('button[type=submit], input[type=submit]');
    if (!btn) return null;
    if (btn.id) return `#${btn.id}`;
    return 'button[type=submit]';
  });

  return { usernameSelector, passwordSelector, submitSelector };
}

/**
 * Probe all routes in a clean (unauthenticated) browser context.
 * Classifies each route as "public" or "auth_required".
 *
 * @param {Array<{id: string, path: string}>} pages
 * @param {{baseUrl: string, timeout?: number, viewport?: object}} config
 * @param {import('playwright').Browser} browser
 * @returns {Promise<Record<string, 'public'|'auth_required'>>}
 */
async function probeRoutes(pages, config, browser) {
  const viewport = config.viewport || { width: 1280, height: 800 };
  const timeout = config.timeout || 30000;
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const accessMap = {};

  for (const pageConfig of pages) {
    const requestedUrl = new URL(pageConfig.path, config.baseUrl).href;
    try {
      await page.goto(requestedUrl, { waitUntil: 'networkidle', timeout });
      const finalPath = new URL(page.url()).pathname;
      const requestedPath = new URL(requestedUrl).pathname;
      const wasRedirected = finalPath !== requestedPath && finalPath !== requestedPath + '/';
      const hasPasswordField = (await page.$('input[type=password]')) !== null;
      accessMap[pageConfig.id] = (wasRedirected || hasPasswordField) ? 'auth_required' : 'public';
    } catch (err) {
      console.warn(`  [probe] Could not reach ${pageConfig.path}: ${err.message} — treating as public`);
      accessMap[pageConfig.id] = 'public';
    }
  }

  await context.close();
  return accessMap;
}

/**
 * Capture a single page screenshot, saving to `outputDir/{filename}`.
 *
 * @param {import('playwright').Page} page
 * @param {{id: string, path: string, name: string, title?: string, fullPage?: boolean}} pageConfig
 * @param {{baseUrl: string, waitAfterNavigation?: number, timeout?: number}} config
 * @param {string} outputDir  - already includes the role subdir
 * @param {string} role
 * @param {'public'|'auth_required'} access
 * @returns {Promise<object>} screenshot result entry
 */
async function captureScreenshot(page, pageConfig, config, outputDir, role, access) {
  const url = new URL(pageConfig.path, config.baseUrl).href;
  const filename = `${pageConfig.id}_${pageConfig.name}.png`;
  const filepath = path.join(outputDir, filename);
  const waitMs = config.waitAfterNavigation || 2000;
  const timeout = config.timeout || 30000;

  console.log(`  [${role}][${pageConfig.id}] Navigating to ${url}...`);

  await page.goto(url, { waitUntil: 'networkidle', timeout });
  await page.waitForTimeout(waitMs);

  const screenshotOptions = { path: filepath };
  if (pageConfig.fullPage) screenshotOptions.fullPage = true;
  await page.screenshot(screenshotOptions);

  console.log(`  [${role}][${pageConfig.id}] Saved ${role}/${filename}`);

  return {
    id: pageConfig.id,
    role,
    name: pageConfig.name,
    file: `${role}/${filename}`,
    title: pageConfig.title || pageConfig.name,
    access,
    success: true,
  };
}

/**
 * Run a full screenshot session for one role.
 * Opens a BrowserContext, authenticates (if credentials provided),
 * captures all applicable routes, closes the context.
 *
 * @param {{role: string, credentials?: null|object, login_url?: string,
 *          username?: string, password?: string,
 *          username_field?: string, password_field?: string, submit_button?: string}} roleConfig
 * @param {Array<{id: string, path: string, name: string}>} pages
 * @param {Record<string, 'public'|'auth_required'>} accessMap
 * @param {object} config
 * @param {import('playwright').Browser} browser
 * @param {string} outputDir  - base screenshots dir (role subdir created inside)
 * @returns {Promise<{results: object[], errors: object[]}>}
 */
async function captureRoleScreenshots(roleConfig, pages, accessMap, config, browser, outputDir) {
  const viewport = config.viewport || { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport, locale: config.locale || 'ru-RU' });
  const results = [];
  const errors = [];

  if (roleConfig.credentials !== null && roleConfig.username) {
    try {
      await authenticate(context, roleConfig, config);
    } catch (err) {
      console.error(`  [${roleConfig.role}] Auth failed: ${err.message}`);
      errors.push({ role: roleConfig.role, stage: 'auth', message: err.message });
      await context.close();
      return { results, errors };
    }
  }

  const roleDir = path.join(outputDir, roleConfig.role);
  fs.mkdirSync(roleDir, { recursive: true });
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeout || 30000);

  for (const pageConfig of pages) {
    const access = accessMap[pageConfig.id] || 'public';
    if (roleConfig.role === 'guest' && access === 'auth_required') continue;

    try {
      const result = await captureScreenshot(page, pageConfig, config, roleDir, roleConfig.role, access);
      results.push(result);
    } catch (err) {
      console.error(`  [${roleConfig.role}][${pageConfig.id}] Error: ${err.message}`);
      results.push({
        id: pageConfig.id,
        role: roleConfig.role,
        name: pageConfig.name,
        file: null,
        title: pageConfig.title || pageConfig.name,
        access,
        success: false,
      });
      errors.push({ role: roleConfig.role, id: pageConfig.id, message: err.message });
    }
  }

  await context.close();
  return { results, errors };
}

async function run() {
  const args = parseArgs();

  let config;
  try {
    config = await readConfig(args.config);
  } catch (err) {
    console.error(`Error reading config: ${err.message}`);
    process.exit(1);
  }

  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = {
    generated_at: new Date().toISOString(),
    base_url: config.baseUrl,
    roles: [],
    screenshots: [],
    errors: [],
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`Failed to launch browser: ${err.message}`);
    process.exit(1);
  }

  // Stage 1: Probe routes (skip if no auth roles configured)
  const roles = config.auth_roles || [{ role: 'guest', credentials: null }];
  const hasAuthRoles = roles.some((r) => r.role !== 'guest' && r.username);
  let accessMap = {};

  if (hasAuthRoles) {
    console.log('\nProbing routes for authentication requirements...');
    try {
      accessMap = await probeRoutes(config.pages, config, browser);
      const authCount = Object.values(accessMap).filter((v) => v === 'auth_required').length;
      console.log(`Probe complete: ${authCount} protected routes, ${Object.keys(accessMap).length - authCount} public.`);
    } catch (err) {
      console.error(`Probe run failed: ${err.message}`);
      for (const p of config.pages) accessMap[p.id] = 'public';
    }
  } else {
    for (const p of config.pages) accessMap[p.id] = 'public';
  }

  // Stage 2: Parallel role sessions
  manifest.roles = roles.map((r) => r.role);
  console.log(`\nCapturing screenshots for ${roles.length} role(s): ${manifest.roles.join(', ')}`);

  const roleResults = await Promise.all(
    roles.map((roleConfig) =>
      captureRoleScreenshots(roleConfig, config.pages, accessMap, config, browser, outputDir)
    )
  );

  for (const { results, errors } of roleResults) {
    manifest.screenshots.push(...results);
    manifest.errors.push(...errors);
  }

  await browser.close();

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nManifest written to ${manifestPath}`);

  const successCount = manifest.screenshots.filter((s) => s.success).length;
  console.log(`Done: ${successCount}/${manifest.screenshots.length} screenshots captured.`);

  if (manifest.errors.length > 0) {
    console.log(`Errors: ${manifest.errors.length}`);
    process.exit(1);
  }
}

// Only run when executed directly (not when required for testing)
if (require.main === module) {
  run().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

// Export functions for unit testing
module.exports = { autoDetectFormFields, probeRoutes, authenticate, captureRoleScreenshots };
