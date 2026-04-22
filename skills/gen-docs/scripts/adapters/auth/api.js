'use strict';

/**
 * API-login adapter (primary auth path for v0.3).
 *
 * Performs an HTTP login against `role.api_endpoint`, extracts a token from
 * the response body and cookies, then hands back a serialisable "prelude"
 * that a Playwright `BrowserContext` can consume before the first navigation.
 *
 * Used by:
 *  - precheck  (no browser, fetch-only): `apiLoginRequest`
 *  - capture   (with browser): `preparePrelude` + Playwright context factory
 *                              in `./index.js`
 *
 * Stack-agnostic: the request body shape is derived from `role.login_body`
 * when present, otherwise a best-effort `{ username|email, password }`.
 */

const storage = require('./storage');

/** Build the JSON body we send to the login endpoint. */
function buildLoginBody(role) {
  if (role.login_body && typeof role.login_body === 'object') {
    return role.login_body;
  }
  const body = { password: role.password };
  // Accept either 'username' or 'email' key, prefer explicit config.
  if (role.username_key) {
    body[role.username_key] = role.username;
  } else if (role.username && role.username.includes('@')) {
    body.email = role.username;
  } else {
    body.username = role.username;
  }
  return body;
}

/**
 * Collect `set-cookie` headers from a fetch Response in a shape-independent way.
 * node-fetch exposes `headers.raw()['set-cookie']`; undici/native fetch exposes
 * `headers.getSetCookie()`. We check both and fall back to `headers.get`.
 */
function readSetCookies(response) {
  const h = response.headers;
  if (!h) return [];
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  if (typeof h.raw === 'function') {
    const raw = h.raw()['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }
  const single = typeof h.get === 'function' ? h.get('set-cookie') : null;
  return single ? [single] : [];
}

async function safeJson(response) {
  const ct = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-type')
    : '';
  if (!ct || !ct.toLowerCase().includes('json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Perform the HTTP login. Does NOT touch Playwright — fetch-only.
 *
 * @param {Record<string, unknown>} role
 * @param {Record<string, unknown>} meta
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   tokenKey: string|null,
 *   tokenValue: string|null,
 *   storage: 'cookie'|'localStorage'|'sessionStorage'|'mixed',
 *   cookies: Array<{name:string,value:string,url:string,path?:string,domain?:string,httpOnly?:boolean,secure?:boolean}>,
 *   bodySnippet: string|null,
 *   error: string|null
 * }>}
 */
async function apiLoginRequest(role, meta, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available; run on Node >= 18.17 or provide fetchImpl');
  }
  if (!role.api_endpoint) {
    throw new Error(`role "${role.role}" has no api_endpoint — required for auth.method=api`);
  }

  const url = new URL(role.api_endpoint, meta.app.url).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 10000);

  let response;
  try {
    response = await fetchImpl(url, {
      method: role.login_method || 'POST',
      headers: { 'content-type': 'application/json', ...(role.login_headers || {}) },
      body: JSON.stringify(buildLoginBody(role)),
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      tokenKey: null,
      tokenValue: null,
      storage: (meta.auth && meta.auth.storage) || 'auto',
      cookies: [],
      bodySnippet: null,
      error: err.message,
    };
  }
  clearTimeout(timer);

  const ok = response.status >= 200 && response.status < 400;
  const setCookies = readSetCookies(response);
  const cookies = storage.parseSetCookie(setCookies, meta.app.url);
  const body = ok ? await safeJson(response) : null;
  const token = ok ? storage.extractToken(body, role.token_key) : null;
  const resolvedStorage = storage.detectStorage(
    (meta.auth && meta.auth.storage) || 'auto',
    { cookies: setCookies, tokenFound: Boolean(token) },
  );

  return {
    ok,
    status: response.status,
    tokenKey: token ? token.key : null,
    tokenValue: token ? token.value : null,
    storage: resolvedStorage,
    cookies,
    bodySnippet: body ? JSON.stringify(body).slice(0, 200) : null,
    error: ok ? null : `HTTP ${response.status}`,
  };
}

/**
 * Turn an `apiLoginRequest` result into a Playwright-consumable "prelude":
 *   - addInitScript (string|null) seeds localStorage/sessionStorage
 *   - cookies (array) is applied to the context via `context.addCookies`
 * @param {Awaited<ReturnType<typeof apiLoginRequest>>} login
 */
function toPrelude(login) {
  const initScript = storage.buildInitScript({
    storage: login.storage,
    tokenKey: login.tokenKey,
    tokenValue: login.tokenValue,
  });
  return {
    storage: login.storage,
    tokenKey: login.tokenKey,
    tokenValue: login.tokenValue,
    addInitScript: initScript,
    cookies: login.cookies || [],
  };
}

module.exports = {
  apiLoginRequest,
  toPrelude,
  buildLoginBody,
  readSetCookies,
};
