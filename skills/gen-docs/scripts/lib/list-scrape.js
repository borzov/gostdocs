'use strict';

/**
 * DOM-based fallback id resolver.
 *
 * When `GET <list>?limit=1` isn't available (no list API, or the API needs
 * auth the resolver cannot reuse), we navigate to the list page with the
 * authenticated context and pick an id off a row in the rendered DOM.
 *
 * Strategies tried in order:
 *   1. `rowSelector` element with `idAttribute` (default `data-id`)
 *   2. `rowSelector` element with an inline `id="..."` attribute
 *   3. first `<a href="..." />` whose trailing segment is purely numeric or
 *      a common-looking id shape (uuid / slug)
 *
 * All failures are soft — the function returns `null` and the caller decides
 * whether to fail the run (strict) or skip the page (lenient).
 *
 * Page-like interface is used so tests can supply a lightweight mock.
 */

const DEFAULT_ROW_SELECTOR = '[data-id], tr[data-id], a[href*="/"]';
const DEFAULT_ID_ATTR = 'data-id';

function looksLikeId(value) {
  if (!value || typeof value !== 'string') return false;
  if (/^\d+$/.test(value)) return true;
  if (/^[0-9a-fA-F-]{8,}$/.test(value)) return true;      // uuid-ish
  if (/^[a-z0-9][a-z0-9-_]{2,}$/i.test(value)) return true;   // slug-ish
  return false;
}

function idFromHref(href) {
  if (typeof href !== 'string') return null;
  // Take the last non-empty segment of the pathname.
  let pathname = href;
  try {
    pathname = new URL(href, 'http://placeholder').pathname;
  } catch {
    /* already a path */
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  return looksLikeId(last) ? last : null;
}

/**
 * Scrape an id from the current page's DOM.
 *
 * @param {import('playwright').Page} page — assumed already navigated to list
 * @param {{ rowSelector?: string, idAttribute?: string, maxCandidates?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function scrapeId(page, opts = {}) {
  const rowSelector = opts.rowSelector || DEFAULT_ROW_SELECTOR;
  const idAttribute = opts.idAttribute || DEFAULT_ID_ATTR;
  const maxCandidates = opts.maxCandidates || 20;

  const candidates = await page.evaluate(
    ({ rowSelector: sel, idAttribute: attr, maxCandidates: max }) => {
      const out = [];
      const els = Array.from(document.querySelectorAll(sel)).slice(0, max);
      for (const el of els) {
        out.push({
          attrId: el.getAttribute(attr),
          elementId: el.getAttribute('id'),
          href: el.getAttribute('href'),
        });
      }
      return out;
    },
    { rowSelector, idAttribute, maxCandidates },
  );

  for (const row of candidates) {
    if (row.attrId && looksLikeId(row.attrId)) return row.attrId;
  }
  for (const row of candidates) {
    if (row.elementId && looksLikeId(row.elementId)) return row.elementId;
  }
  for (const row of candidates) {
    const fromHref = idFromHref(row.href);
    if (fromHref) return fromHref;
  }
  return null;
}

module.exports = {
  scrapeId,
  looksLikeId,
  idFromHref,
  DEFAULT_ROW_SELECTOR,
  DEFAULT_ID_ATTR,
};
