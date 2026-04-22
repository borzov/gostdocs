'use strict';

/**
 * Dismiss pop-over UI (cookie banners, onboarding tours, toast stacks)
 * before taking a screenshot.
 *
 * For each configured selector we try at most once per page: if the element
 * is not visible in the short polling window it is skipped. Failures never
 * abort capture — documentation screenshots should degrade gracefully when
 * the UI has changed.
 *
 * Inputs come from two sources that are concatenated at call time:
 *   - meta.auth.dismiss_selectors  (global, applied on every page)
 *   - page config `dismiss`        (per-page overrides, Phase 3 feature)
 */

/**
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {{ perSelectorTimeoutMs?: number, logger?: (msg: string) => void }} [opts]
 * @returns {Promise<{ clicked: string[], skipped: string[] }>}
 */
async function applyDismiss(page, selectors, opts = {}) {
  const clicked = [];
  const skipped = [];
  if (!Array.isArray(selectors) || selectors.length === 0) {
    return { clicked, skipped };
  }
  const timeout = opts.perSelectorTimeoutMs || 500;
  const log = opts.logger || (() => {});

  for (const selector of selectors) {
    if (typeof selector !== 'string' || selector.length === 0) {
      skipped.push(String(selector));
      continue;
    }
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      await locator.click({ timeout, trial: false });
      clicked.push(selector);
      log(`[dismiss] clicked ${selector}`);
    } catch (err) {
      skipped.push(selector);
      log(`[dismiss] skipped ${selector}: ${err.message || err}`);
    }
  }
  return { clicked, skipped };
}

/**
 * Compute the effective dismiss list for a page: globals first, then page
 * overrides. Duplicates are removed while preserving order (first wins).
 *
 * @param {{ auth?: { dismiss_selectors?: string[] } }} meta
 * @param {{ dismiss?: string[] }} [pageCfg]
 * @returns {string[]}
 */
function mergeSelectors(meta, pageCfg) {
  const global = (meta.auth && meta.auth.dismiss_selectors) || [];
  const local = (pageCfg && pageCfg.dismiss) || [];
  const seen = new Set();
  const out = [];
  for (const s of [...global, ...local]) {
    if (typeof s !== 'string') continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

module.exports = {
  applyDismiss,
  mergeSelectors,
};
