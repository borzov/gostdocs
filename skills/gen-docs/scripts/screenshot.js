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

async function authenticate(page, config) {
  const { auth, baseUrl } = config;
  if (!auth) return;

  const loginUrl = new URL(auth.loginUrl, baseUrl).href;
  console.log(`  Authenticating at ${loginUrl}...`);

  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: config.timeout || 30000 });

  await page.fill(auth.usernameField, auth.username);
  await page.fill(auth.passwordField, auth.password);
  await page.click(auth.submitButton);

  await page.waitForLoadState('networkidle', { timeout: config.timeout || 30000 });
  console.log('  Authentication complete.');
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
    const el = inputs[inputs.length - 1];
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
    } catch {
      accessMap[pageConfig.id] = 'public';
    }
  }

  await context.close();
  return accessMap;
}

async function captureScreenshot(page, pageConfig, config, outputDir) {
  const url = new URL(pageConfig.path, config.baseUrl).href;
  const filename = `${pageConfig.id}_${pageConfig.name}.png`;
  const filepath = path.join(outputDir, filename);
  const waitMs = config.waitAfterNavigation || 2000;
  const timeout = config.timeout || 30000;

  console.log(`  [${pageConfig.id}] Navigating to ${url}...`);

  await page.goto(url, { waitUntil: 'networkidle', timeout });
  await page.waitForTimeout(waitMs);

  const screenshotOptions = { path: filepath };
  if (pageConfig.fullPage) {
    screenshotOptions.fullPage = true;
  }

  await page.screenshot(screenshotOptions);
  console.log(`  [${pageConfig.id}] Saved ${filename}`);

  return {
    id: pageConfig.id,
    name: pageConfig.name,
    file: filename,
    title: pageConfig.title || pageConfig.name,
    success: true,
  };
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

  const viewport = config.viewport || { width: 1280, height: 800 };
  const timeout = config.timeout || 30000;

  const manifest = {
    generated_at: new Date().toISOString(),
    base_url: config.baseUrl,
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

  const context = await browser.newContext({
    viewport,
    locale: 'ru-RU',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  // Authenticate if auth config is present
  const needsAuth = config.auth && config.pages.some((p) => !p.skipAuth);
  if (needsAuth) {
    try {
      await authenticate(page, config);
    } catch (err) {
      console.error(`Authentication failed: ${err.message}`);
      manifest.errors.push({
        stage: 'auth',
        message: err.message,
      });
      // Continue — some pages with skipAuth may still work
    }
  }

  // Capture screenshots for each page
  for (const pageConfig of config.pages) {
    try {
      const result = await captureScreenshot(page, pageConfig, config, outputDir);
      manifest.screenshots.push(result);
    } catch (err) {
      console.error(`  [${pageConfig.id}] Error: ${err.message}`);
      manifest.screenshots.push({
        id: pageConfig.id,
        name: pageConfig.name,
        file: null,
        title: pageConfig.title || pageConfig.name,
        success: false,
      });
      manifest.errors.push({
        id: pageConfig.id,
        name: pageConfig.name,
        message: err.message,
      });
    }
  }

  await browser.close();

  // Write manifest
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nManifest written to ${manifestPath}`);

  const successCount = manifest.screenshots.filter((s) => s.success).length;
  const totalCount = manifest.screenshots.length;
  console.log(`Done: ${successCount}/${totalCount} screenshots captured.`);

  if (manifest.errors.length > 0) {
    console.log(`Errors: ${manifest.errors.length}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

// Export functions for unit testing
if (require.main !== module) {
  module.exports = { autoDetectFormFields, probeRoutes };
}
