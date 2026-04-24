'use strict';

/**
 * Per-page interaction helpers used during the capture phase.
 *
 * - `buildUrlWithQuery` appends `meta.pages[].query_params` onto the resolved
 *   URL so the user can capture filtered list views like
 *   `/events?format=online&sort=-starts_at` without inventing extra page IDs.
 *
 * - `interactionToActionStep` / `interactionsToActionSteps` translate the
 *   declarative `meta.pages[].interactions[]` shape into the existing
 *   action-executor step format. Keeping the conversion here means
 *   `capture.js` reuses the battle-tested executor instead of growing a
 *   second runtime for "almost the same thing".
 */

/**
 * @param {string} baseUrl
 * @param {Record<string, string> | null | undefined} queryParams
 * @returns {string}
 */
function buildUrlWithQuery(baseUrl, queryParams) {
  if (!queryParams || typeof queryParams !== 'object') return baseUrl;
  const keys = Object.keys(queryParams);
  if (keys.length === 0) return baseUrl;
  const url = new URL(baseUrl);
  for (const key of keys) {
    url.searchParams.append(key, String(queryParams[key]));
  }
  return url.href;
}

/**
 * @param {{ action?: string, selector?: string, value?: string, ms?: number }} interaction
 * @returns {Record<string, unknown> | null}
 */
function interactionToActionStep(interaction) {
  if (!interaction || typeof interaction !== 'object') return null;
  switch (interaction.action) {
    case 'click':
    case 'expand':
      return interaction.selector ? { click: interaction.selector } : null;
    case 'fill':
      if (!interaction.selector) return null;
      return { fill: { [interaction.selector]: interaction.value == null ? '' : String(interaction.value) } };
    case 'wait_for':
      return interaction.selector ? { wait_for: interaction.selector } : null;
    case 'wait_ms':
      return interaction.ms && interaction.ms > 0 ? { wait_ms: interaction.ms } : null;
    case 'scroll':
      // Action-executor has no native "scroll" step; settling for wait_for is
      // a graceful fallback that confirms the selector exists before the
      // screenshot. Ad-hoc smooth-scrolling lives in the project's own
      // before-screenshot hook if needed.
      return interaction.selector ? { wait_for: interaction.selector } : null;
    default:
      return null;
  }
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} interactions
 * @returns {Array<Record<string, unknown>>}
 */
function interactionsToActionSteps(interactions) {
  if (!Array.isArray(interactions)) return [];
  const out = [];
  for (const item of interactions) {
    const step = interactionToActionStep(item);
    if (step) out.push(step);
  }
  return out;
}

/**
 * Build a sequence of action-executor steps that demonstrate the filter /
 * search behaviour of a list page WITHOUT the author having to hand-write
 * selectors. The steps chain the common CSS selectors used by React / Vue
 * / Laravel admin panels and GOST consumer portals into one comma-separated
 * pattern — the capture executor picks the first selector that exists on
 * the page, fills it with `sample` text, and waits for the UI to debounce
 * the filter query before the screenshot fires.
 *
 * @param {{ sample?: string, waitMs?: number }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
function buildFilterInteractionsForList(opts = {}) {
  const sample = opts.sample == null ? 'test' : String(opts.sample);
  const waitMs = Number(opts.waitMs) > 0 ? Number(opts.waitMs) : 600;
  const selector = [
    'input[type="search"]',
    'input[name*="search" i]',
    'input[placeholder*="Поиск" i]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="Поиск" i]',
    'input[aria-label*="Search" i]',
    'input[role="searchbox"]',
  ].join(', ');
  return [
    { wait_for: selector },
    { fill: { [selector]: sample } },
    { wait_ms: waitMs },
  ];
}

module.exports = {
  buildUrlWithQuery,
  interactionToActionStep,
  interactionsToActionSteps,
  buildFilterInteractionsForList,
};
