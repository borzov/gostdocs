'use strict';

/**
 * ID substitution planner.
 *
 * For parametrized routes like `/users/:id/edit`, we need concrete ids to
 * hit during capture. Strategies, tried in order:
 *
 *   1. explicit     — meta.yaml provides `parametrize: { id: 42 }` for the page
 *   2. collection   — GET `<list_endpoint>?limit=1` and pick the first row;
 *                     list_endpoint falls back to `routes.inferCollectionPath`
 *   3. list_scrape  — navigate to the list page in the browser and pluck the
 *                     first row id from DOM (Phase 3B capture-time fallback)
 *
 * This module is pure: it produces a PLAN describing which requests to make,
 * in which order, and how to extract ids. The capture phase executes the plan
 * against a real fetch / browser.
 *
 * The plan is JSON-safe so it can be persisted in the capture matrix output.
 */

const routes = require('../lib/routes');

/**
 * @typedef {Object} ResolveStep
 * @property {'explicit'|'collection'|'list_scrape'} kind
 * @property {Record<string, unknown>} [values]        for 'explicit'
 * @property {string} [endpoint]                        for 'collection'
 * @property {string} [idPath]                          for 'collection'; dotted path e.g. 'data.0.id'
 * @property {string} [listRoute]                       for 'list_scrape'
 * @property {string} [rowSelector]                     for 'list_scrape'
 * @property {string} [idAttribute]                     for 'list_scrape'; default 'data-id'
 */

/**
 * @typedef {Object} ResolvePlan
 * @property {string} pageId
 * @property {string} template
 * @property {string[]} missingParams
 * @property {ResolveStep[]} steps   tried in order
 */

/**
 * Produce a resolution plan for a single page. `pageCfg.parametrize` can
 * supply values directly (wins immediately), partial values (merged with
 * resolved fallbacks), or be absent (full fallback chain).
 *
 * @param {{ id: string, path: string, parametrize?: Record<string, unknown>,
 *           list_endpoint?: string, list_selector?: string, id_attribute?: string }} pageCfg
 * @returns {ResolvePlan}
 */
function planResolution(pageCfg) {
  if (!pageCfg || typeof pageCfg.path !== 'string') {
    throw new Error('pageCfg.path is required');
  }
  const parsed = routes.parseRoute(pageCfg.path);
  const explicit = pageCfg.parametrize || {};
  const missing = parsed.params
    .filter((p) => p.required && explicit[p.name] === undefined)
    .map((p) => p.name);
  // `sample_size` lets the user ask for several resolved IDs so the capture
  // phase produces one screenshot per detail instance (e.g. three different
  // event cards). Clamp to [1, 10] — beyond that diminishing returns.
  const sampleSize = Math.max(1, Math.min(10, Number(pageCfg.sample_size) || 1));

  /** @type {ResolveStep[]} */
  const steps = [];

  if (Object.keys(explicit).length > 0) {
    steps.push({ kind: 'explicit', values: { ...explicit } });
  }

  if (missing.length > 0) {
    const collection = pageCfg.list_endpoint || routes.inferCollectionPath(pageCfg.path);
    if (collection) {
      steps.push({
        kind: 'collection',
        endpoint: `${collection}?limit=${sampleSize}`,
        idPath: 'data.0.id',
        sampleSize,
      });
    }
    steps.push({
      kind: 'list_scrape',
      listRoute: pageCfg.list_endpoint || routes.inferCollectionPath(pageCfg.path) || '/',
      rowSelector: pageCfg.list_selector || '[data-id], tr[data-id], a[href*="/"]',
      idAttribute: pageCfg.id_attribute || 'data-id',
      sampleSize,
    });
  }

  return {
    pageId: pageCfg.id || pageCfg.path,
    template: pageCfg.path,
    missingParams: missing,
    sampleSize,
    steps,
  };
}

/**
 * Read a dotted path from a nested object. Supports numeric indices.
 * `readPath({ a: { b: [{ id: 1 }] } }, 'a.b.0.id')` -> 1
 *
 * @param {unknown} obj
 * @param {string} dotted
 * @returns {unknown|undefined}
 */
function readPath(obj, dotted) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = dotted.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const key = /^\d+$/.test(part) ? Number(part) : part;
    current = current[key];
  }
  return current;
}

/**
 * Extract an id from a JSON body using heuristics:
 *   - explicit idPath when provided
 *   - common shapes: { data: [...] }, [...], { results: [...] }, { items: [...] }
 *   - each row's id / uuid / slug / pk
 *
 * @param {unknown} body
 * @param {string} [idPath]
 * @returns {string|number|null}
 */
function extractIdFromBody(body, idPath) {
  if (idPath) {
    const v = readPath(body, idPath);
    if (v !== undefined && v !== null) return v;
  }
  const candidates = [];
  if (Array.isArray(body)) candidates.push(body);
  if (body && typeof body === 'object') {
    for (const key of ['data', 'results', 'items', 'rows', 'records']) {
      if (Array.isArray(body[key])) candidates.push(body[key]);
    }
  }
  for (const list of candidates) {
    if (list.length === 0) continue;
    const row = list[0];
    for (const key of ['id', 'uuid', 'slug', 'pk']) {
      if (row && row[key] !== undefined && row[key] !== null) return row[key];
    }
  }
  return null;
}

/**
 * Return up to `count` ids from a collection response. Used when a page
 * declares `sample_size > 1` so we capture several detail instances.
 *
 * @param {unknown} body
 * @param {number} [count=1]
 * @returns {Array<string|number>}
 */
function extractIdsFromBody(body, count = 1) {
  const n = Math.max(1, Number(count) || 1);
  const candidates = [];
  if (Array.isArray(body)) candidates.push(body);
  if (body && typeof body === 'object') {
    for (const key of ['data', 'results', 'items', 'rows', 'records']) {
      if (Array.isArray(body[key])) candidates.push(body[key]);
    }
  }
  const out = [];
  for (const list of candidates) {
    for (const row of list) {
      if (out.length >= n) return out;
      for (const key of ['id', 'uuid', 'slug', 'pk']) {
        if (row && row[key] !== undefined && row[key] !== null) {
          out.push(row[key]);
          break;
        }
      }
    }
    if (out.length >= n) break;
  }
  return out;
}

module.exports = {
  planResolution,
  readPath,
  extractIdFromBody,
  extractIdsFromBody,
};
