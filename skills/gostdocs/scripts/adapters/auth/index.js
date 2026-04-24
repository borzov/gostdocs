'use strict';

/**
 * Auth adapter registry and public entry points.
 *
 * External callers should only use this module — never import api.js or
 * form.js directly. The registry makes it possible to add more methods
 * (oauth-dev, SAML IdP stubs) later without touching call sites.
 *
 * Public surface:
 *   selectAdapter(meta)                    -> 'api'|'form'|'none'
 *   apiLoginRequest(role, meta, opts)      -> fetch-only login (precheck)
 *   preparePlaywrightContext(browser, role, meta, opts)
 *                                          -> { context, authCtx, warnings }
 *   verifyAuth(page, authCtx, meta)        -> healthcheck result
 */

const api = require('./api');
const form = require('./form');
const healthcheck = require('./healthcheck');

/**
 * @param {Record<string, any>} meta
 * @returns {'api'|'form'|'none'}
 */
function selectAdapter(meta) {
  const method = (meta.auth && meta.auth.method) || 'none';
  if (method !== 'api' && method !== 'form' && method !== 'none') {
    throw new Error(`Unknown auth.method "${method}"; expected api | form | none`);
  }
  return method;
}

/**
 * Create a Playwright BrowserContext with authentication applied before the
 * first navigation. Guest roles get a clean context with no prelude.
 *
 * Contract: the returned context is ready to be used. Cookies are applied
 * via `addCookies`; token storage is seeded via `addInitScript`. If api-login
 * fails and `meta.auth.fallback_to_form` is true, form-login is attempted
 * transparently and a warning is recorded.
 *
 * @param {import('playwright').Browser} browser
 * @param {Record<string, any>} role
 * @param {Record<string, any>} meta
 * @param {{ fetchImpl?: typeof fetch, viewport?: any, locale?: string }} [opts]
 * @returns {Promise<{
 *   context: import('playwright').BrowserContext,
 *   authCtx: {
 *     role: string,
 *     method: 'api'|'form'|'none',
 *     storage: 'cookie'|'localStorage'|'sessionStorage'|'mixed',
 *     tokenKey: string|null,
 *     tokenValue: string|null,
 *     loginUrl: string|undefined
 *   },
 *   warnings: string[]
 * }>}
 */
async function preparePlaywrightContext(browser, role, meta, opts = {}) {
  const method = selectAdapter(meta);
  const warnings = [];
  const contextOptions = {
    viewport: opts.viewport || (meta.capture && meta.capture.viewports && meta.capture.viewports[0]) || undefined,
    locale: opts.locale || (meta.capture && meta.capture.locales && meta.capture.locales[0]) || undefined,
  };

  // Guest role (no credentials) — skip auth entirely.
  const isGuest = !role || role.credentials === null || (!role.username && !role.api_endpoint);
  if (method === 'none' || isGuest) {
    const context = await browser.newContext(contextOptions);
    return {
      context,
      authCtx: {
        role: role ? role.role : 'guest',
        method: 'none',
        storage: 'cookie',
        tokenKey: null,
        tokenValue: null,
        loginUrl: role ? role.login_url : undefined,
      },
      warnings,
    };
  }

  if (method === 'api') {
    const login = await api.apiLoginRequest(role, meta, opts);
    if (!login.ok) {
      const fallback = meta.auth && meta.auth.fallback_to_form;
      if (!fallback) {
        throw new Error(
          `API login failed for role "${role.role}" (HTTP ${login.status || 'n/a'}${login.error ? `, ${login.error}` : ''}). Set auth.fallback_to_form=true to try form-login.`,
        );
      }
      warnings.push(`api-login failed for role "${role.role}" (${login.error || login.status}); falling back to form-login`);
      return preparePlaywrightContextForm(browser, role, meta, contextOptions, warnings);
    }

    const prelude = api.toPrelude(login);
    const context = await browser.newContext(contextOptions);
    if (prelude.cookies && prelude.cookies.length > 0) {
      await context.addCookies(prelude.cookies);
    }
    if (prelude.addInitScript) {
      await context.addInitScript(prelude.addInitScript);
    }
    return {
      context,
      authCtx: {
        role: role.role,
        method: 'api',
        storage: prelude.storage,
        tokenKey: prelude.tokenKey,
        tokenValue: prelude.tokenValue,
        loginUrl: role.login_url,
      },
      warnings,
    };
  }

  // method === 'form'
  return preparePlaywrightContextForm(browser, role, meta, contextOptions, warnings);
}

async function preparePlaywrightContextForm(browser, role, meta, contextOptions, warnings) {
  const context = await browser.newContext(contextOptions);
  const result = await form.authenticateViaForm(context, role, meta);
  if (result.warning) warnings.push(result.warning);
  if (!result.ok) {
    await context.close();
    throw new Error(`Form login failed for role "${role.role}": ${result.error}`);
  }
  return {
    context,
    authCtx: {
      role: role.role,
      method: 'form',
      storage: 'cookie',
      tokenKey: null,
      tokenValue: null,
      loginUrl: role.login_url,
    },
    warnings,
  };
}

module.exports = {
  selectAdapter,
  apiLoginRequest: api.apiLoginRequest,
  preparePlaywrightContext,
  verifyAuth: healthcheck.verifyAuth,
};
