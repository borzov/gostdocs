'use strict';

/**
 * Capture matrix generator.
 *
 * Turns the declarative config (pages, roles, viewports, themes, locales,
 * states, journeys) into a flat, deterministic list of capture tuples. The
 * capture phase executes this list — there is no further planning after
 * this point.
 *
 * Matrix rules:
 *   - guest role: any axis combination is allowed, but pages with
 *     accessMap[id] === 'auth_required' are skipped.
 *   - non-guest roles: all pages are considered.
 *   - viewport / theme / locale: empty axis collapses to [null]. One tuple
 *     per axis value, in declaration order.
 *   - states: applied only to pages that set `apply_states: true`.
 *   - journeys: emitted separately as action-sequence captures (one tuple
 *     per step that has `screenshot: true`).
 *
 * Pure module.
 */

const manifest = require('./manifest');

/** @typedef {{ id: string, path: string, name?: string, title?: string, fullPage?: boolean,
 *              apply_states?: boolean, actions?: any, component_kind?: string,
 *              parametrize?: Record<string, unknown>,
 *              show_filter_demo?: boolean, filter_sample?: string, filter_wait_ms?: number,
 *              sample_size?: number }} PageCfg */

/** @typedef {{ role: string, credentials: null | Record<string, unknown>, [k:string]: any }} RoleCfg */

/**
 * @param {unknown[]} axis
 * @returns {unknown[]} axis, or [null] when empty/undefined
 */
function axisOrNull(axis) {
  return Array.isArray(axis) && axis.length > 0 ? axis : [null];
}

/**
 * Build a stable capture tuple id that encodes every axis.
 */
function buildTupleId({ role, pageId, viewport, theme, locale, state, action, journey }) {
  const parts = [role, pageId, viewport];
  if (theme) parts.push(`t-${theme}`);
  if (locale) parts.push(`l-${locale}`);
  if (state) parts.push(`s-${state}`);
  if (action) parts.push(`a-${action}`);
  if (journey) parts.push(`j-${journey.name}-${journey.step}`);
  return parts.join('__');
}

/**
 * @param {{ pages: PageCfg[], meta: Record<string, any>, journeys?: { journeys: any[] },
 *           accessMap?: Record<string, 'public'|'auth_required'>,
 *           componentShots?: Array<Record<string, any>> }} input
 * @returns {{ plan: Array<Record<string, any>>, skipped: Array<Record<string, any>> }}
 */
function buildMatrix(input) {
  const meta = input.meta || {};
  const pages = [...(input.pages || []), ...(input.componentShots || [])];
  const accessMap = input.accessMap || {};
  const journeysFile = input.journeys || { journeys: [] };

  const roles = ((meta.auth && meta.auth.roles) || []).length > 0
    ? meta.auth.roles
    : [{ role: 'guest', credentials: null }];
  const viewports = axisOrNull((meta.capture && meta.capture.viewports) || []);
  const themes = axisOrNull((meta.capture && meta.capture.themes) || []);
  const locales = axisOrNull((meta.capture && meta.capture.locales) || []);
  const globalStates = axisOrNull(meta.states || []);

  /** @type {Array<Record<string, any>>} */
  const plan = [];
  /** @type {Array<Record<string, any>>} */
  const skipped = [];

  for (const role of roles) {
    const roleName = role.role || 'guest';
    const isGuest = role.credentials === null || (!role.username && !role.api_endpoint);
    for (const viewport of viewports) {
      const viewportName = viewport && viewport.name ? viewport.name : 'default';
      for (const theme of themes) {
        for (const locale of locales) {
          for (const page of pages) {
            // Honor page.access_role — the user's explicit pin between role
            // and page. Both `guest` and `guest-only` (login/register-style
            // pages that are accessible only without auth) map to the
            // anonymous role.
            if (page.access_role) {
              const wantGuest = page.access_role === 'guest' || page.access_role === 'guest-only';
              const matches = wantGuest ? isGuest : roleName === page.access_role;
              if (!matches) {
                skipped.push({
                  reason: `access_role=${page.access_role} does not match role=${roleName}`,
                  role: roleName,
                  pageId: page.id,
                });
                continue;
              }
            }
            const access = accessMap[page.id] || 'public';
            if (isGuest && access === 'auth_required') {
              skipped.push({
                reason: 'auth_required for guest role',
                role: roleName,
                pageId: page.id,
              });
              continue;
            }
            const states = page.apply_states ? globalStates : [page.state || null];
            for (const state of states) {
              const filename = manifest.buildFilename({
                id: page.id,
                role: roleName,
                viewport: viewportName,
                theme: theme || null,
                locale: locale || null,
                state: state || null,
                component_kind: page.component_kind || null,
              });
              plan.push({
                tupleId: buildTupleId({
                  role: roleName, pageId: page.id,
                  viewport: viewportName, theme, locale, state,
                  action: null, journey: null,
                }),
                kind: 'page',
                role: roleName,
                pageId: page.id,
                path: page.path,
                viewport: viewport || null,
                theme: theme || null,
                locale: locale || null,
                state: state || null,
                component_kind: page.component_kind || null,
                title: page.title || page.name || null,
                fullPage: Boolean(page.fullPage),
                actions: page.actions || null,
                parametrize: page.parametrize || null,
                query_params: page.query_params || null,
                interactions: page.interactions || null,
                showFilterDemo: Boolean(page.show_filter_demo),
                filterSample: page.filter_sample || null,
                filterWaitMs: Number(page.filter_wait_ms) || 0,
                sampleSize: Math.max(1, Number(page.sample_size) || 1),
                section: page.section || null,
                access,
                file: filename,
              });
            }
          }
        }
      }
    }
  }

  // Journeys — separate axis; one tuple per screenshot-marked step.
  for (const journey of journeysFile.journeys || []) {
    const viewport = viewports.find((v) => v && v.name === journey.viewport) || viewports[0];
    const viewportName = viewport && viewport.name ? viewport.name : 'default';
    const theme = journey.theme || themes[0] || null;
    const locale = journey.locale || locales[0] || null;
    for (const step of journey.steps) {
      if (!step.screenshot) continue;
      const pageId = step.id || `${journey.name}__${step.index}`;
      const filename = manifest.buildFilename({
        id: pageId,
        role: journey.role,
        viewport: viewportName,
        theme: theme || null,
        locale: locale || null,
      });
      plan.push({
        tupleId: buildTupleId({
          role: journey.role, pageId,
          viewport: viewportName, theme, locale, state: null,
          action: null, journey: { name: journey.name, step: step.index },
        }),
        kind: 'journey',
        role: journey.role,
        pageId,
        path: step.goto || null,
        viewport: viewport || null,
        theme: theme || null,
        locale: locale || null,
        state: null,
        component_kind: null,
        title: step.caption || step.title || `${journey.name} — шаг ${step.index}`,
        fullPage: false,
        actions: [step],
        access: 'public',
        journey: { name: journey.name, step: step.index },
        file: filename,
      });
    }
  }

  // Dedupe by filename — last occurrence wins (useful when components
  // introduce a shot that meta.yaml also declares).
  /** @type {Map<string, Record<string, any>>} */
  const byFile = new Map();
  for (const tuple of plan) byFile.set(tuple.file, tuple);

  return { plan: [...byFile.values()], skipped };
}

module.exports = {
  buildMatrix,
  buildTupleId,
  axisOrNull,
};
