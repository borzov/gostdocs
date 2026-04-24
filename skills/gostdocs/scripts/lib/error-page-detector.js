'use strict';

/**
 * Detect whether a post-navigation Playwright page landed on an error
 * page (HTTP 4xx/5xx, 404, login redirect loop, etc.).
 *
 * The v0.3 pipeline previously took screenshots of whatever the browser
 * happened to render after `page.goto()` — even if the target route
 * 404'd or the backend returned a plain error page. Those screenshots
 * then flowed through the vision inspector and into the generated
 * guides, so users saw error pages where they expected product pages.
 *
 * This module surfaces a single decision — "is this an error page?" —
 * from three cheap signals:
 *
 *   1. Response HTTP status (≥ 400 is a hard error).
 *   2. Final URL path matches a known error / auth marker
 *      (`/404`, `/not-found`, `/forbidden`, `/500`, `login?redirect=`…).
 *   3. `<title>` / visible body text matches a language-independent
 *      list of error phrases ("404", "not found", "страница не найдена",
 *      "ошибка", "forbidden", "requires authentication", …).
 *
 * Pure helpers — network calls live in capture.js which wires them to
 * a real Playwright Page. Unit tests pass plain objects.
 */

const ERROR_URL_PATTERNS = [
  /\/404(\b|$)/i,
  /\/not[-_]?found(\b|$)/i,
  /\/500(\b|$)/i,
  /\/error(\b|$)/i,
  /\/forbidden(\b|$)/i,
  /\/unauthorized(\b|$)/i,
];

const ERROR_TITLE_PATTERNS = [
  /\b404\b/,
  /not\s+found/i,
  /\b500\b/,
  /server\s+error/i,
  /forbidden/i,
  /access\s+denied/i,
  /unauthori[sz]ed/i,
  /страница\s+не\s+найдена/i,
  /не\s+найдено/i,
  /нет\s+доступа/i,
  /запрещ[её]н/i,
  /требуется\s+(авторизация|аутентификация)/i,
  /внутренняя\s+ошибка/i,
];

function statusOf(response) {
  if (!response) return null;
  if (typeof response.status === 'function') return response.status();
  if (typeof response.status === 'number') return response.status;
  return null;
}

function matchesAny(text, patterns) {
  if (!text) return null;
  for (const p of patterns) {
    if (p.test(text)) return p.source;
  }
  return null;
}

/**
 * Inspect a completed navigation and return null (all good) or a report
 * object with `reason`, `status`, `url`, and `title` fields.
 *
 * @param {{ response?: any, url: string, title?: string, expectedPath?: string, role?: string }} ctx
 * @returns {null | { reason: string, status: number|null, url: string, title: string|null }}
 */
function detectErrorPage(ctx) {
  const url = ctx.url || '';
  const title = (ctx.title || '').trim();
  const status = statusOf(ctx.response);

  if (status !== null && status >= 400) {
    return { reason: `http-status:${status}`, status, url, title: title || null };
  }

  const urlHit = matchesAny(url, ERROR_URL_PATTERNS);
  if (urlHit) {
    return { reason: `url-pattern:${urlHit}`, status, url, title: title || null };
  }

  const titleHit = matchesAny(title, ERROR_TITLE_PATTERNS);
  if (titleHit) {
    return { reason: `title-pattern:${titleHit}`, status, url, title };
  }

  // Login-redirect trap: the page ended up on /login?redirect=... for a
  // role that should have been authenticated. Guest access to an
  // auth_required page is handled upstream by probeAccess, so we only
  // flag this when the tuple's role is NOT guest.
  if (ctx.role && ctx.role !== 'guest' && /\/login(\?|$|\/)/i.test(url) && /redirect=|next=|returnUrl=/i.test(url)) {
    return { reason: 'auth-redirect-trap', status, url, title: title || null };
  }

  return null;
}

// DOM selectors that commonly appear on in-app error/empty states — i.e.
// the backend returned 200 but the frontend rendered a "Not found" block.
// Most of these patterns are stack-agnostic: admin panels / React / Vue /
// Laravel apps all wire similar role/data attributes on their error cards.
const DOM_ERROR_SELECTORS = [
  '[data-error]',
  '[data-testid="empty-state"]',
  '[data-testid="error-state"]',
  '[data-testid="not-found"]',
  '[role="alert"]',
  '.page-not-found',
  '.empty-state',
  '.error-page',
  'h1:text-is("404")',
  'h1:text-is("Page Not Found")',
  'h1:text-is("Страница не найдена")',
  'h1:text-is("Не найдено")',
  'h1:text-is("Ошибка")',
];

/**
 * Run a DOM-level probe after `page.goto()` has resolved and the dismiss
 * routines have run. Returns `null` when the DOM looks healthy, or a
 * small report object when the page is clearly an error/empty state.
 *
 * We run each selector in isolation so one broken pseudo-selector (e.g.
 * `:text-is`) cannot take the whole probe down on older Playwright builds
 * — a throw from `page.$` is interpreted as "selector unsupported, skip".
 *
 * @param {any} page — Playwright Page instance
 * @returns {Promise<null | { reason: string, selector: string }>}
 */
async function detectDomErrorState(page) {
  if (!page || typeof page.$ !== 'function') return null;
  for (const selector of DOM_ERROR_SELECTORS) {
    try {
      const handle = await page.$(selector);
      if (handle) {
        try { await handle.dispose(); } catch { /* ignore */ }
        return { reason: `dom-marker:${selector}`, selector };
      }
    } catch {
      // Selector not supported by this Playwright build — skip.
    }
  }
  return null;
}

module.exports = {
  detectErrorPage,
  detectDomErrorState,
  DOM_ERROR_SELECTORS,
  ERROR_URL_PATTERNS,
  ERROR_TITLE_PATTERNS,
};
