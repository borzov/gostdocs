'use strict';

/**
 * Pre-pandoc Markdown linter.
 *
 * v0.3 requirement: no leftover placeholders may reach the DOCX. This
 * module checks a single Markdown file for:
 *   - stray `AGENT:`, `TODO`, `FIXME`, `XXX`, and HTML comments marked
 *     with `<!--` (these are generator placeholders that never appear in
 *     finished documents)
 *   - image references that point at non-existent files relative to the
 *     resource directory
 *   - minimum word count per H2 section (default 80)
 *   - manifest coverage: every file in the provided manifest must be
 *     either referenced at least once OR appear in the `excluded[]` list
 *
 * Pure function: the caller supplies file content, disk-existence
 * predicate, manifest, and exclusion list. No direct I/O.
 */

const PLACEHOLDER_PATTERNS = [
  { tag: 'AGENT',      re: /AGENT:/g },
  { tag: 'TODO',       re: /\bTODO\b/g },
  { tag: 'FIXME',      re: /\bFIXME\b/g },
  { tag: 'XXX',        re: /\bXXX\b/g },
  { tag: 'html-comment', re: /<!--/g },
];

const DEFAULT_MIN_WORDS_PER_H2 = 80;

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content[i] === '\n') line += 1;
  return line;
}

function checkPlaceholders(content) {
  const out = [];
  for (const { tag, re } of PLACEHOLDER_PATTERNS) {
    for (const m of content.matchAll(re)) {
      out.push({
        severity: 'error',
        code: 'placeholder',
        line: lineOf(content, m.index),
        message: `placeholder "${tag}" found; replace before DOCX conversion`,
      });
    }
  }
  return out;
}

function checkImageRefs(content, fileExists) {
  const out = [];
  // Match ![alt](path) even across multiple lines
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = m[1].trim();
    if (/^https?:/.test(ref) || /^data:/.test(ref)) continue;
    if (!fileExists(ref)) {
      out.push({
        severity: 'error',
        code: 'broken-image',
        line: lineOf(content, m.index),
        message: `image reference does not resolve: ${ref}`,
      });
    }
  }
  return out;
}

function sectionSplit(content) {
  const lines = content.split('\n');
  /** @type {Array<{ start: number, heading: string|null, body: string[] }>} */
  const sections = [{ start: 1, heading: null, body: [] }];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m) {
      sections.push({ start: i + 1, heading: m[1], body: [] });
    } else {
      sections[sections.length - 1].body.push(lines[i]);
    }
  }
  return sections;
}

function countWords(text) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_`|>-]/g, ' ');
  return stripped.split(/\s+/).filter(Boolean).length;
}

function checkMinWordsPerH2(content, minWords) {
  const out = [];
  for (const section of sectionSplit(content)) {
    if (!section.heading) continue;
    const text = section.body.join('\n');
    const words = countWords(text);
    if (words < minWords) {
      out.push({
        severity: 'warning',
        code: 'short-section',
        line: section.start,
        message: `H2 "${section.heading}" has ${words} words (minimum ${minWords})`,
      });
    }
  }
  return out;
}

function checkManifestCoverage(content, manifestFiles, excluded) {
  const referenced = new Set();
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    referenced.add(m[1].trim());
  }
  const excludedSet = new Set(excluded || []);
  const out = [];
  for (const file of manifestFiles || []) {
    if (excludedSet.has(file)) continue;
    if (![...referenced].some((r) => r.endsWith(file) || r.includes(file))) {
      out.push({
        severity: 'warning',
        code: 'manifest-unused',
        line: null,
        message: `manifest capture "${file}" is not referenced in this document; add it or list it in excluded[]`,
      });
    }
  }
  return out;
}

/**
 * @param {string} content
 * @param {{
 *   fileExists?: (ref: string) => boolean,
 *   manifestFiles?: string[],
 *   excluded?: string[],
 *   minWordsPerH2?: number,
 * }} [opts]
 * @returns {{ passed: boolean, errors: number, warnings: number, issues: Array<{severity,code,line,message}> }}
 */
function lintMarkdown(content, opts = {}) {
  const fileExists = opts.fileExists || (() => true);
  const manifestFiles = opts.manifestFiles || [];
  const excluded = opts.excluded || [];
  const minWords = opts.minWordsPerH2 || DEFAULT_MIN_WORDS_PER_H2;

  /** @type {Array<{severity:string,code:string,line:number|null,message:string}>} */
  const issues = [];
  issues.push(...checkPlaceholders(content));
  issues.push(...checkImageRefs(content, fileExists));
  issues.push(...checkMinWordsPerH2(content, minWords));
  issues.push(...checkManifestCoverage(content, manifestFiles, excluded));

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return { passed: errors === 0, errors, warnings, issues };
}

module.exports = {
  lintMarkdown,
  checkPlaceholders,
  checkImageRefs,
  checkMinWordsPerH2,
  checkManifestCoverage,
  countWords,
  sectionSplit,
  PLACEHOLDER_PATTERNS,
  DEFAULT_MIN_WORDS_PER_H2,
};
