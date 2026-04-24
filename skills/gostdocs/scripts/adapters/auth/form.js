'use strict';

/**
 * Form-login adapter (fallback path).
 *
 * When `auth.method` is `form` (or an api-login attempt failed and
 * `auth.fallback_to_form` is true), this adapter drives a real page to submit
 * the login form. Requires a Playwright `BrowserContext` — intentionally
 * cannot run in precheck.
 *
 * A warning flag is always returned so the orchestrator can surface it in the
 * final REPORT.md: form-login is less reliable than API-login for SPAs.
 */

/**
 * Auto-detect the three fields of a classic login form from the current page.
 *
 * Returns null when no password input is present (page is not a login form).
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
      document.querySelectorAll('input[type=text], input[type=email]'),
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
 * Drive the login form.
 *
 * Cookies persist on the supplied `context` — pages opened later in the same
 * context inherit the authenticated session.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, any>} role
 * @param {Record<string, any>} meta
 * @returns {Promise<{ ok: boolean, warning: string, error: string|null, loginUrl: string, finalUrl: string|null }>}
 */
async function authenticateViaForm(context, role, meta) {
  const loginUrl = new URL(role.login_url || '/login', meta.app.url).href;
  const timeout = (meta.capture && meta.capture.timeout) || 30000;
  const warning =
    'form-login is less reliable than API-login for modern SPAs — consider configuring auth.method=api';

  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout });

    let usernameSelector = role.username_field || null;
    let passwordSelector = role.password_field || null;
    let submitSelector = role.submit_button || null;

    if (!usernameSelector || !passwordSelector || !submitSelector) {
      const detected = await autoDetectFormFields(page);
      if (!detected) {
        return {
          ok: false,
          warning,
          error: `No login form found at ${loginUrl}`,
          loginUrl,
          finalUrl: page.url(),
        };
      }
      usernameSelector = usernameSelector || detected.usernameSelector;
      passwordSelector = passwordSelector || detected.passwordSelector;
      submitSelector = submitSelector || detected.submitSelector;
    }

    if (!usernameSelector || !passwordSelector || !submitSelector) {
      return {
        ok: false,
        warning,
        error: `Could not resolve all form fields at ${loginUrl} — provide explicit selectors in role config`,
        loginUrl,
        finalUrl: page.url(),
      };
    }

    await page.fill(usernameSelector, role.username);
    await page.fill(passwordSelector, role.password);
    await page.click(submitSelector);
    await page.waitForLoadState('networkidle', { timeout });
    const finalUrl = page.url();
    return { ok: true, warning, error: null, loginUrl, finalUrl };
  } catch (err) {
    return {
      ok: false,
      warning,
      error: err.message,
      loginUrl,
      finalUrl: null,
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  autoDetectFormFields,
  authenticateViaForm,
};
