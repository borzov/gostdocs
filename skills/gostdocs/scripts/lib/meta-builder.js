'use strict';

/**
 * meta.yaml assembler.
 *
 * Combines four input layers (later layers WIN over earlier ones):
 *   1. schema defaults (skill_version, capture, output, vision, ...)
 *   2. introspect-derived values (project-introspect.deriveProjectMetadata)
 *   3. existing meta.yaml (preserves anything the user already typed)
 *   4. orchestrator-collected user answers (AskUserQuestion results, dotted-path keys)
 *
 * Pure module, no I/O. The init-meta CLI handles disk reads and writes.
 *
 * Two public entry points:
 *   - propose(existing, ctx) returns a meta-shaped object with proposed
 *     values WITHOUT validation. Useful for the "report" pass that shows
 *     the user what we extracted before any answers.
 *   - buildMeta({ existing, introspect, routes, roles, answers }) runs
 *     propose then merges answers (dotted paths) and validates against
 *     the v0.3 zod schema. Throws on schema failure.
 */

const path = require('path');
const meta = require('./meta');

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

function setIfMissing(obj, key, value) {
  if (isEmpty(obj[key]) && !isEmpty(value)) obj[key] = value;
}

function basename(p) {
  if (typeof p !== 'string' || !p) return null;
  return path.basename(p);
}

function applyDerivedMetadata(target, derived) {
  if (!derived) return;
  if (!target.metadata) target.metadata = {};
  for (const [k, v] of Object.entries(derived)) {
    setIfMissing(target.metadata, k, v);
  }
}

function defaultRolesFromList(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  return roles.map((roleName) => {
    const isGuest = String(roleName).toLowerCase() === 'guest';
    if (isGuest) return { role: 'guest', credentials: null };
    return { role: roleName };
  });
}

function buildPagesFromRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  return routes.map((r) => {
    const out = {};
    if (r.id) out.id = r.id;
    if (r.path) out.path = r.path;
    if (r.title) out.title = r.title;
    if (r.access_role) out.access_role = r.access_role;
    if (r.section) out.section = r.section;
    if (r.query_params) out.query_params = r.query_params;
    if (r.interactions) out.interactions = r.interactions;
    return out;
  });
}

function propose(existing, ctx = {}) {
  const introspect = ctx.introspect || {};
  const projectPath = ctx.projectPath || existing.project_path || null;

  const proposed = JSON.parse(JSON.stringify(existing || {}));

  setIfMissing(proposed, 'skill_version', meta.CURRENT_VERSION);
  if (projectPath) setIfMissing(proposed, 'project_path', projectPath);
  setIfMissing(proposed, 'gost_mode', 'strict');
  if (!Array.isArray(proposed.doc_types) || proposed.doc_types.length === 0) {
    proposed.doc_types = ['user-guide', 'admin-guide', 'technical-description'];
  }

  if (!proposed.app) proposed.app = { url: '', launch: 'url' };
  if (!proposed.app.launch) proposed.app.launch = 'url';

  if (!proposed.auth) {
    proposed.auth = { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [] };
  }
  if (!Array.isArray(proposed.auth.roles)) proposed.auth.roles = [];
  if (proposed.auth.roles.length === 0 && Array.isArray(ctx.roles) && ctx.roles.length > 0) {
    proposed.auth.roles = defaultRolesFromList(ctx.roles);
    if (proposed.auth.method === 'none') proposed.auth.method = 'api';
  }

  if (!Array.isArray(proposed.pages) || proposed.pages.length === 0) {
    proposed.pages = buildPagesFromRoutes(ctx.routes);
  }

  applyDerivedMetadata(proposed, introspect.derived);

  if (proposed.metadata && isEmpty(proposed.metadata.project_dir) && projectPath) {
    proposed.metadata.project_dir = basename(projectPath);
  }
  if (!proposed.metadata) proposed.metadata = {};

  return proposed;
}

function applyAnswer(target, dottedPath, value) {
  if (value === undefined || value === null) return;
  const roleMatch = /^auth\.roles\[([^\]]+)\]\.(.+)$/.exec(dottedPath);
  if (roleMatch) {
    const [, roleName, attr] = roleMatch;
    if (!target.auth) target.auth = { method: 'api', storage: 'auto', dismiss_selectors: [], roles: [] };
    if (!Array.isArray(target.auth.roles)) target.auth.roles = [];
    let role = target.auth.roles.find((r) => r.role === roleName);
    if (!role) {
      role = { role: roleName };
      target.auth.roles.push(role);
    }
    role[attr] = value;
    return;
  }
  const parts = dottedPath.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function buildMeta(input = {}) {
  const proposed = propose(input.existing || {}, {
    projectPath: input.projectPath,
    introspect: input.introspect,
    routes: input.routes,
    roles: input.roles,
  });
  for (const [dotted, value] of Object.entries(input.answers || {})) {
    applyAnswer(proposed, dotted, value);
  }
  return meta.validate(proposed);
}

module.exports = {
  propose,
  buildMeta,
  applyAnswer,
  applyDerivedMetadata,
  defaultRolesFromList,
  buildPagesFromRoutes,
};
