'use strict';

/**
 * Single-brace mustache resolver for templates.
 *
 * Replaces every `{key}` token (lowercase ASCII letters, digits, underscores)
 * with the corresponding value from `vars`. Unknown keys are preserved
 * verbatim and reported through the optional `onUnknown(key, lineNo)`
 * callback so the caller can warn or block.
 *
 * Why single-brace and not Mustache `{{key}}`:
 *   - Existing GOST templates (admin-guide.md, user-guide.md, …) already use
 *     `{system_name}` / `{port}` / `{db_user}` style placeholders. Migrating
 *     them to `{{...}}` breaks compatibility.
 *
 * Safety:
 *   - The token regex `/(?<!\$)\{([a-z][a-z0-9_]*)\}/g` skips `${shell}`
 *     expansions, ignores cyrillic-in-braces (`{Название роли}`), and ignores
 *     anything that has spaces / punctuation between `{` and `}`
 *     (`{"status":"ok"}`, `{a, b}`, etc).
 *   - By default tokens inside fenced code blocks ARE expanded — admin-guide
 *     templates intentionally use `{port}`, `{db_user}` inside ```bash``` to
 *     give users copy-pasteable commands. Pass `expandInsideCode: false` to
 *     suppress that behaviour.
 */

const TOKEN_REGEX = /(?<!\$)\{([a-z][a-z0-9_]*)\}/g;
const FENCE_REGEX = /^\s*(`{3,}|~{3,})/;
const HTML_COMMENT_OPEN = /<!--/;
const HTML_COMMENT_CLOSE = /-->/;

/**
 * @param {string} content
 * @param {Record<string, unknown>} vars
 * @param {{ expandInsideCode?: boolean, onUnknown?: (key: string, lineNo: number) => void }} [opts]
 * @returns {string}
 */
function resolveMustache(content, vars, opts = {}) {
  if (content === null || content === undefined) return '';
  const text = String(content);
  if (text === '') return '';

  const expandInsideCode = opts.expandInsideCode !== false; // default true
  const onUnknown = typeof opts.onUnknown === 'function' ? opts.onUnknown : null;
  const safeVars = vars && typeof vars === 'object' ? vars : {};

  const lines = text.split('\n');
  const out = new Array(lines.length);
  let inFence = false;
  let fenceMarker = null;
  let inHtmlComment = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_REGEX);

    // Multi-line HTML comment continuation. The template loader strips such
    // comments downstream; substituting `{key}` inside them would only emit
    // spurious "unresolved" warnings for tokens that never reach the
    // rendered Markdown.
    if (inHtmlComment) {
      out[i] = line;
      if (HTML_COMMENT_CLOSE.test(line)) inHtmlComment = false;
      continue;
    }

    if (inFence) {
      if (fenceMatch && fenceMarker
          && fenceMatch[1][0] === fenceMarker[0]
          && fenceMatch[1].length >= fenceMarker.length) {
        inFence = false;
        fenceMarker = null;
        out[i] = line; // closing fence verbatim
        continue;
      }
      out[i] = expandInsideCode ? expandLine(line, safeVars, onUnknown, i + 1) : line;
      continue;
    }

    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1];
      out[i] = line; // opening fence verbatim (info string preserved)
      continue;
    }

    // Walk the line piecewise: expand prose, carry HTML-comment ranges
    // verbatim. A `<!--` without a matching `-->` on the same line opens
    // multi-line comment mode for subsequent iterations.
    let pieces = '';
    let pos = 0;
    let openIdx = line.indexOf('<!--');
    while (openIdx >= 0) {
      pieces += expandLine(line.slice(pos, openIdx), safeVars, onUnknown, i + 1);
      const closeIdx = line.indexOf('-->', openIdx + 4);
      if (closeIdx < 0) {
        pieces += line.slice(openIdx);
        inHtmlComment = true;
        pos = line.length;
        break;
      }
      pieces += line.slice(openIdx, closeIdx + 3);
      pos = closeIdx + 3;
      openIdx = line.indexOf('<!--', pos);
    }
    pieces += expandLine(line.slice(pos), safeVars, onUnknown, i + 1);
    out[i] = pieces;
  }

  return out.join('\n');
}

/**
 * @param {string} line
 * @param {Record<string, unknown>} vars
 * @param {((key: string, lineNo: number) => void) | null} onUnknown
 * @param {number} lineNo
 * @returns {string}
 */
function expandLine(line, vars, onUnknown, lineNo) {
  return line.replace(TOKEN_REGEX, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      if (onUnknown) onUnknown(key, lineNo);
      return match;
    }
    const value = vars[key];
    if (value === null || value === undefined) {
      if (onUnknown) onUnknown(key, lineNo);
      return match;
    }
    return String(value);
  });
}

module.exports = {
  resolveMustache,
  TOKEN_REGEX,
};
