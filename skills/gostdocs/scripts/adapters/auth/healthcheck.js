'use strict';

/**
 * Post-login healthcheck.
 *
 * Verifies that authentication actually took effect before any screenshot is
 * taken. Failure aborts the role session — no "successfully captured" shots
 * of a disguised login page.
 *
 * Three checks run in order (all configurable, none silently skipped):
 *   1. URL check    — after navigating to `app.url`, current pathname is not
 *                     the login path (loginUrl from role config)
 *   2. Storage      — when storage is not 'cookie', the configured token key
 *                     is present in the expected storage
 *   3. /me endpoint — `auth.healthcheck_path` returns 2xx. Cookie-based auth
 *                     uses `page.request.get`; token-based adds an
 *                     `Authorization: Bearer <token>` header.
 *
 * The module is written against a narrow `PageLike` interface so unit tests
 * can supply a simple mock — see tests/healthcheck.test.js.
 */

/**
 * @typedef {Object} PageLike
 * @property {(url: string, opts?: any) => Promise<any>} goto
 * @property {() => string} url
 * @property {(fn: any, arg?: any) => Promise<any>} evaluate
 * @property {{ get: (url: string, opts?: any) => Promise<{ ok: () => boolean, status: () => number }> }} request
 */

/**
 * @typedef {Object} AuthCtx
 * @property {string} role
 * @property {'api'|'form'|'none'} method
 * @property {'cookie'|'localStorage'|'sessionStorage'|'mixed'} storage
 * @property {string|null} tokenKey
 * @property {string|null} tokenValue
 * @property {string|undefined} loginUrl
 */

function loginPaths(authCtx, meta) {
  const candidates = new Set();
  const push = (u) => {
    if (!u) return;
    try {
      candidates.add(new URL(u, meta.app.url).pathname);
    } catch {
      /* ignore malformed values */
    }
  };
  push(authCtx.loginUrl);
  push(meta.auth && meta.auth.default_login_url);
  push('/login');
  push('/signin');
  push('/sign-in');
  return [...candidates];
}

function isLoginPath(pathname, paths) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** @returns {Promise<{name:string,passed:boolean,detail:string}>} */
async function checkUrl(page, authCtx, meta) {
  try {
    await page.goto(meta.app.url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    return { name: 'url', passed: false, detail: `navigation failed: ${err.message}` };
  }
  const current = new URL(page.url()).pathname;
  const paths = loginPaths(authCtx, meta);
  const onLogin = isLoginPath(current, paths);
  return {
    name: 'url',
    passed: !onLogin,
    detail: onLogin
      ? `landed on login page (${current}); login did not stick`
      : `url=${current}`,
  };
}

/** @returns {Promise<{name:string,passed:boolean,detail:string,skipped?:boolean}>} */
async function checkStorage(page, authCtx) {
  if (authCtx.storage === 'cookie' || authCtx.method !== 'api') {
    return { name: 'storage', passed: true, detail: 'skipped (cookie or non-api method)', skipped: true };
  }
  if (!authCtx.tokenKey) {
    return { name: 'storage', passed: true, detail: 'skipped (no token_key expected)', skipped: true };
  }
  const storageName = authCtx.storage === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
  let value;
  try {
    value = await page.evaluate(
      ({ storageName: s, key }) => window[s].getItem(key),
      { storageName, key: authCtx.tokenKey },
    );
  } catch (err) {
    return { name: 'storage', passed: false, detail: `evaluate failed: ${err.message}` };
  }
  const present = typeof value === 'string' && value.length > 0;
  return {
    name: 'storage',
    passed: present,
    detail: present
      ? `${storageName}.${authCtx.tokenKey} is set`
      : `${storageName}.${authCtx.tokenKey} is missing`,
  };
}

/** @returns {Promise<{name:string,passed:boolean,detail:string,skipped?:boolean}>} */
async function checkMeEndpoint(page, authCtx, meta) {
  const path = (meta.auth && meta.auth.healthcheck_path) || null;
  if (!path) {
    return { name: 'me', passed: true, detail: 'skipped (auth.healthcheck_path not set)', skipped: true };
  }
  const url = new URL(path, meta.app.url).href;
  const headers = {};
  if (authCtx.method === 'api' && authCtx.tokenValue && authCtx.storage !== 'cookie') {
    const scheme = (meta.auth && meta.auth.authorization_scheme) || 'Bearer';
    headers.Authorization = `${scheme} ${authCtx.tokenValue}`;
  }
  try {
    const response = await page.request.get(url, { headers });
    const status = typeof response.status === 'function' ? response.status() : response.status;
    const okFn = typeof response.ok === 'function' ? response.ok() : status >= 200 && status < 300;
    return {
      name: 'me',
      passed: Boolean(okFn),
      detail: `${path} -> HTTP ${status}`,
    };
  } catch (err) {
    return { name: 'me', passed: false, detail: `${path} unreachable: ${err.message}` };
  }
}

/**
 * @param {PageLike} page
 * @param {AuthCtx} authCtx
 * @param {Record<string, any>} meta
 * @returns {Promise<{ passed: boolean, checks: Array<{name:string,passed:boolean,detail:string,skipped?:boolean}> }>}
 */
async function verifyAuth(page, authCtx, meta) {
  const checks = [];
  checks.push(await checkUrl(page, authCtx, meta));
  checks.push(await checkStorage(page, authCtx));
  checks.push(await checkMeEndpoint(page, authCtx, meta));
  return { passed: checks.every((c) => c.passed), checks };
}

module.exports = {
  verifyAuth,
  checkUrl,
  checkStorage,
  checkMeEndpoint,
  loginPaths,
  isLoginPath,
};
