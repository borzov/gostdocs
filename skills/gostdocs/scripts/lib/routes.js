'use strict';

/**
 * Route parser and parameter substitution.
 *
 * Supports the four common parametrized-route dialects:
 *   - Express / Koa / NestJS:   /users/:id/edit
 *   - Rails / Laravel / Vue:    /users/:id/edit        (same as above)
 *   - Next.js / Nuxt:           /users/[id]/edit
 *   - Django URLconf:           /users/<int:id>/edit   or  /users/<id>/edit
 *
 * Pure module — no I/O, safe to use from any phase.
 */

/** @typedef {{ name: string, type: string|null, required: boolean, syntax: 'colon'|'bracket'|'angle' }} Param */

/**
 * Parse a route template. Angle (`<type:name>`) and bracket (`[name]`)
 * syntaxes are matched before the colon syntax so they do not collide with
 * each other (e.g. `:id` must not be found inside `<int:id>`).
 *
 * @param {string} template
 * @returns {{ template: string, params: Param[], segments: string[] }}
 */
function parseRoute(template) {
  if (typeof template !== 'string' || template.length === 0) {
    throw new Error('route template must be a non-empty string');
  }
  /** @type {Param[]} */
  const params = [];
  const seen = new Set();

  const push = (name, type, required, syntax) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    params.push({ name, type: type || null, required, syntax });
  };

  let remaining = template;

  // 1. <type:name> or <name>
  remaining = remaining.replace(
    /<(?:([a-zA-Z_][a-zA-Z0-9_]*):)?([a-zA-Z_][a-zA-Z0-9_]*)>/g,
    (_, type, name) => {
      push(name, type || null, true, 'angle');
      return '';
    },
  );

  // 2. [name] or [...name]
  remaining = remaining.replace(
    /\[\.{0,3}([a-zA-Z_][a-zA-Z0-9_]*)\]/g,
    (_, name) => {
      push(name, null, true, 'bracket');
      return '';
    },
  );

  // 3. :name or :name?
  for (const m of remaining.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g)) {
    push(m[1], null, !m[2], 'colon');
  }

  const segments = template.split('/').filter((s) => s.length > 0);
  return { template, params, segments };
}

/** Check whether a route template has parameters. */
function isParametrized(template) {
  return parseRoute(template).params.length > 0;
}

function encodeSegment(value) {
  return encodeURIComponent(String(value));
}

/**
 * Substitute parameter values into a route template. Throws on missing
 * required params when `allowMissing` is false (default).
 *
 * @param {string} template
 * @param {Record<string, string|number>} values
 * @param {{ allowMissing?: boolean }} [opts]
 * @returns {string}
 */
function substitute(template, values, opts = {}) {
  const parsed = parseRoute(template);
  const provided = values || {};
  const missing = [];

  let result = template;

  // Angle first, so `:name` inside `<int:name>` is not mis-interpreted.
  result = result.replace(
    /<(?:[a-zA-Z_][a-zA-Z0-9_]*:)?([a-zA-Z_][a-zA-Z0-9_]*)>/g,
    (full, name) => {
      if (provided[name] !== undefined && provided[name] !== null) {
        return encodeSegment(provided[name]);
      }
      missing.push(name);
      return full;
    },
  );

  // [name] / [...name]
  result = result.replace(/\[(\.{0,3})([a-zA-Z_][a-zA-Z0-9_]*)\]/g, (full, spread, name) => {
    if (provided[name] !== undefined && provided[name] !== null) {
      if (spread && Array.isArray(provided[name])) {
        return provided[name].map(encodeSegment).join('/');
      }
      return encodeSegment(provided[name]);
    }
    missing.push(name);
    return full;
  });

  // :name(?)
  result = result.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g, (full, name, optional) => {
    if (provided[name] !== undefined && provided[name] !== null) {
      return encodeSegment(provided[name]);
    }
    if (optional) return '';
    missing.push(name);
    return full;
  });

  if (missing.length > 0 && !opts.allowMissing) {
    throw new Error(
      `missing values for required params: ${missing.join(', ')} in ${template}`,
    );
  }
  return result;
}

/**
 * Infer a plausible list-endpoint from a detail route. E.g.:
 *   /users/:id/edit  -> /users
 *   /projects/[id]   -> /projects
 *   /api/v1/users/<int:id>/ -> /api/v1/users
 *
 * Returns null when the last-before-last segment does not look like a
 * resource name.
 */
function inferCollectionPath(template) {
  const parsed = parseRoute(template);
  if (parsed.params.length === 0) return null;
  // Find the first segment that contains a parameter; use everything before it.
  const segments = template.split('/');
  const firstParamIdx = segments.findIndex(
    (s) => /:[a-zA-Z_]|\[[a-zA-Z_]|<(?:[a-zA-Z_]+:)?[a-zA-Z_]/.test(s),
  );
  if (firstParamIdx <= 0) return null;
  const collection = segments.slice(0, firstParamIdx).join('/');
  return collection || null;
}

module.exports = {
  parseRoute,
  isParametrized,
  substitute,
  inferCollectionPath,
};
