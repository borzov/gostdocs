'use strict';

/**
 * Storage adapter for auth tokens.
 *
 * Responsibilities:
 *  - detect which storage mechanism the backend uses (cookie / localStorage /
 *    sessionStorage / mixed) from a probe login response
 *  - build a `context.addInitScript` payload that injects a token into
 *    storage before the first page navigation
 *  - extract a token value from a login response using a configured or
 *    autodetected key
 *
 * Pure module — no browser dependency, fully unit-testable.
 */

/** Common keys used by backends to return a session token. */
const COMMON_TOKEN_KEYS = Object.freeze([
  'access_token',
  'accessToken',
  'token',
  'jwt',
  'auth_token',
  'authToken',
  'id_token',
  'idToken',
]);

/**
 * Pick the token value from a login response body using a configured key.
 * Falls back to a list of common keys. Walks nested objects one level deep
 * (common shape `{ data: { access_token: ... } }`).
 *
 * @param {unknown} body
 * @param {string|undefined} preferredKey
 * @returns {{ key: string, value: string }|null}
 */
function extractToken(body, preferredKey) {
  if (!body || typeof body !== 'object') return null;
  const keys = preferredKey
    ? [preferredKey, ...COMMON_TOKEN_KEYS.filter((k) => k !== preferredKey)]
    : [...COMMON_TOKEN_KEYS];

  for (const key of keys) {
    if (typeof body[key] === 'string' && body[key].length > 0) {
      return { key, value: body[key] };
    }
  }
  // one level of nesting (data, result, payload)
  for (const outer of ['data', 'result', 'payload']) {
    const nested = body[outer];
    if (nested && typeof nested === 'object') {
      const found = extractToken(nested, preferredKey);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Detect which storage mechanism to use given a login response.
 *
 *  - Explicit mode (anything other than 'auto') wins
 *  - If the response set cookies AND a token is in the body -> 'mixed'
 *  - If only cookies -> 'cookie'
 *  - If only body token -> 'localStorage' (typical SPA default)
 *
 * @param {'auto'|'cookie'|'localStorage'|'sessionStorage'|'mixed'} declared
 * @param {{ cookies: string[], tokenFound: boolean }} observed
 * @returns {'cookie'|'localStorage'|'sessionStorage'|'mixed'}
 */
function detectStorage(declared, observed) {
  if (declared && declared !== 'auto') return declared;
  const hasCookies = Array.isArray(observed.cookies) && observed.cookies.length > 0;
  if (hasCookies && observed.tokenFound) return 'mixed';
  if (hasCookies) return 'cookie';
  return 'localStorage';
}

/**
 * Build a `context.addInitScript` body that seeds storage with a token before
 * the first navigation. Returns `null` for cookie-only storage (no init script
 * needed; cookies are set directly on the context).
 *
 * @param {{ storage: 'cookie'|'localStorage'|'sessionStorage'|'mixed',
 *          tokenKey: string, tokenValue: string }} opts
 * @returns {string|null}
 */
function buildInitScript({ storage, tokenKey, tokenValue }) {
  if (storage === 'cookie') return null;
  if (!tokenKey || typeof tokenValue !== 'string') return null;

  const jsKey = JSON.stringify(tokenKey);
  const jsVal = JSON.stringify(tokenValue);
  const stmts = [];
  if (storage === 'localStorage' || storage === 'mixed') {
    stmts.push(`window.localStorage.setItem(${jsKey}, ${jsVal});`);
  }
  if (storage === 'sessionStorage') {
    stmts.push(`window.sessionStorage.setItem(${jsKey}, ${jsVal});`);
  }
  if (stmts.length === 0) return null;
  return `(function(){ try { ${stmts.join(' ')} } catch (e) { /* storage unavailable */ } })();`;
}

/**
 * Read a `Set-Cookie` header (possibly multiple values) and turn it into the
 * cookie descriptors Playwright accepts on a `BrowserContext`.
 *
 * Only the fields Playwright needs are produced; everything else is ignored
 * (SameSite is left to the browser default).
 *
 * @param {string[]|string|undefined} setCookieHeaders
 * @param {string} baseUrl
 * @returns {Array<{name: string, value: string, url?: string, domain?: string, path?: string, expires?: number, httpOnly?: boolean, secure?: boolean}>}
 */
function parseSetCookie(setCookieHeaders, baseUrl) {
  if (!setCookieHeaders) return [];
  const items = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const out = [];
  for (const raw of items) {
    if (typeof raw !== 'string' || !raw) continue;
    const parts = raw.split(';').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const [kv, ...attrs] = parts;
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    const name = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    if (!name) continue;
    const cookie = { name, value, url: baseUrl };
    for (const attr of attrs) {
      const [k, v] = attr.split('=').map((s) => s && s.trim());
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk === 'path' && v) cookie.path = v;
      else if (lk === 'domain' && v) cookie.domain = v;
      else if (lk === 'httponly') cookie.httpOnly = true;
      else if (lk === 'secure') cookie.secure = true;
    }
    out.push(cookie);
  }
  return out;
}

module.exports = {
  COMMON_TOKEN_KEYS,
  extractToken,
  detectStorage,
  buildInitScript,
  parseSetCookie,
};
