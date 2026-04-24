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

/**
 * Compute character ranges that fall inside fenced code blocks (``` or ~~~).
 * Used by checks that must ignore legitimate `{key}`, `-->`, pipe-tables,
 * and English prose embedded in code samples.
 */
function fenceRanges(content) {
  const ranges = [];
  const lines = content.split('\n');
  let offset = 0;
  let inFence = false;
  let fenceStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inFence) {
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        ranges.push({ start: fenceStart, end: offset + line.length });
        inFence = false;
      }
    } else if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = true;
      fenceStart = offset;
    }
    offset += line.length + 1;
  }
  if (inFence) ranges.push({ start: fenceStart, end: content.length });
  return ranges;
}

function isInRanges(ranges, index) {
  for (const r of ranges) if (index >= r.start && index <= r.end) return true;
  return false;
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

/**
 * Pandoc renders pipe-tables as monospace text when they are wrapped in a
 * fenced code block — symptom of agent post-processing accidentally pasting
 * a section inside a ```bash``` fence. We deliberately do NOT lint for
 * "headings inside fences" because bash comments (`# 1. Клонирование`)
 * legitimately look like markdown H1.
 */
function checkFencedCodeIntegrity(content) {
  const out = [];
  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = null;
  let fenceStartLine = 0;
  let fenceLang = '';
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (inFence) {
      if (fenceMarker && trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
        fenceLang = '';
        continue;
      }
      // Only flag pipe-tables; do NOT flag heading-shaped lines because
      // shell comments inside ```bash``` legitimately start with `# `.
      if (/^\|.*\|$/.test(trimmed) && fenceLang !== 'markdown') {
        out.push({
          severity: 'warning',
          code: 'fence-leak',
          line: i + 1,
          message: `pipe-table row found inside fenced code block opened at line ${fenceStartLine}; pandoc will render it as monospace text`,
        });
      }
      continue;
    }
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1][0] === '`' ? '```' : '~~~';
      fenceLang = fenceMatch[2].trim().toLowerCase();
      fenceStartLine = i + 1;
    }
  }
  return out;
}

function checkUnresolvedPlaceholders(content) {
  const out = [];
  const ranges = fenceRanges(content);
  const re = /(?<!\\)\{([a-z_][a-z0-9_]*)\}/g;
  for (const m of content.matchAll(re)) {
    if (isInRanges(ranges, m.index)) continue;
    out.push({
      severity: 'error',
      code: 'unresolved-placeholder',
      line: lineOf(content, m.index),
      message: `unresolved placeholder {${m[1]}}; add it to meta.metadata or adjust the template`,
    });
  }
  return out;
}

function checkEmDashArrow(content) {
  const out = [];
  const ranges = fenceRanges(content);
  const re = /–>/g;
  for (const m of content.matchAll(re)) {
    if (isInRanges(ranges, m.index)) continue;
    out.push({
      severity: 'error',
      code: 'em-dash-arrow',
      line: lineOf(content, m.index),
      message: 'stray "–>" (en-dash arrow) outside code block; likely a comment tail that leaked into prose',
    });
  }
  return out;
}

function checkUnresolvedDirectives(content) {
  const out = [];
  const re = /<!--\s*UNRESOLVED-DIRECTIVE:([\w-]+)\s*-->/g;
  for (const m of content.matchAll(re)) {
    out.push({
      severity: 'error',
      code: 'unresolved-directive',
      line: lineOf(content, m.index),
      message: `unresolved directive GEN:${m[1]} — register a handler in buildExpanders() or remove the directive`,
    });
  }
  return out;
}

function checkEmptySections(content) {
  const out = [];
  const ranges = fenceRanges(content);
  const lines = content.split('\n');
  const headings = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m && !isInRanges(ranges, offset)) {
      headings.push({ level: m[1].length, title: m[2], line: i + 1, offset, endOffset: offset + line.length });
    }
    offset += line.length + 1;
  }
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    // Container detection: if the very next heading is a child (level > h.level),
    // then this heading is a container and the real "content check" applies
    // to that child — skip the parent.
    const nextHeading = headings[i + 1];
    if (nextHeading && nextHeading.level > h.level) continue;
    // Leaf: body spans until the next heading at same-or-higher level.
    const bodyStart = h.endOffset;
    const bodyEnd = nextHeading ? nextHeading.offset : content.length;
    let body = content.slice(bodyStart, bodyEnd);
    body = body.replace(/<!--[\s\S]*?-->/g, '');
    const meaningful = body.replace(/\s+/g, '').length;
    if (meaningful === 0) {
      out.push({
        severity: 'error',
        code: 'empty-section',
        line: h.line,
        message: `heading "${h.title}" has no content before the next heading`,
      });
    }
  }
  return out;
}

function checkEmptyTables(content) {
  const out = [];
  const ranges = fenceRanges(content);
  const lines = content.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!isInRanges(ranges, offset) && /^\|.+\|$/.test(trimmed)) {
      const sep = lines[i + 1] ? lines[i + 1].trim() : '';
      const third = lines[i + 2] ? lines[i + 2].trim() : '';
      if (/^\|[\s:|-]+\|$/.test(sep) && !/^\|.+\|$/.test(third)) {
        out.push({
          severity: 'error',
          code: 'empty-table',
          line: i + 1,
          message: 'table has only header and separator; no data rows produced',
        });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

function checkDuplicateHeadings(content) {
  const out = [];
  const ranges = fenceRanges(content);
  const lines = content.split('\n');
  const seen = new Map();
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m && !isInRanges(ranges, offset)) {
      const key = `${m[1].length}::${m[2].toLowerCase()}`;
      if (seen.has(key)) {
        out.push({
          severity: 'error',
          code: 'duplicate-heading',
          line: i + 1,
          message: `heading "${m[2]}" duplicates line ${seen.get(key)}`,
        });
      } else {
        seen.set(key, i + 1);
      }
    }
    offset += line.length + 1;
  }
  return out;
}

function checkLatinProseInRuDoc(content, lang) {
  if (lang && String(lang).toLowerCase().startsWith('en')) return [];
  const out = [];
  const ranges = fenceRanges(content);
  const lines = content.split('\n');
  const paragraphs = [];
  let current = { text: '', startLine: 0, offset: 0 };
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isBlockStart = line.trim() === ''
      || /^#{1,6}\s+/.test(line)
      || /^\s*[|>]/.test(line)
      || /^\s*[-*]\s/.test(line)
      || /^\s*\d+\.\s/.test(line);
    if (isBlockStart) {
      if (current.text.trim().length > 0) paragraphs.push(current);
      current = { text: '', startLine: i + 2, offset: offset + line.length + 1 };
    } else {
      if (!current.text) { current.startLine = i + 1; current.offset = offset; }
      current.text += (current.text ? ' ' : '') + line;
    }
    offset += line.length + 1;
  }
  if (current.text.trim().length > 0) paragraphs.push(current);
  for (const p of paragraphs) {
    if (p.text.length < 100) continue;
    if (isInRanges(ranges, p.offset)) continue;
    const letters = p.text.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    if (letters.length < 50) continue;
    const cyrillic = (letters.match(/[А-Яа-яЁё]/g) || []).length;
    if (cyrillic / letters.length < 0.15) {
      out.push({
        severity: 'warning',
        code: 'latin-prose-in-ru',
        line: p.startLine,
        message: `paragraph is <15% Cyrillic; likely English bled from vision: "${p.text.slice(0, 80).trim()}…"`,
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
 *   lang?: string,
 * }} [opts]
 * @returns {{ passed: boolean, errors: number, warnings: number, issues: Array<{severity,code,line,message}> }}
 */
function lintMarkdown(content, opts = {}) {
  const fileExists = opts.fileExists || (() => true);
  const manifestFiles = opts.manifestFiles || [];
  const excluded = opts.excluded || [];
  const minWords = opts.minWordsPerH2 || DEFAULT_MIN_WORDS_PER_H2;
  const lang = opts.lang || 'ru';

  /** @type {Array<{severity:string,code:string,line:number|null,message:string}>} */
  const issues = [];
  issues.push(...checkPlaceholders(content));
  issues.push(...checkUnresolvedPlaceholders(content));
  issues.push(...checkUnresolvedDirectives(content));
  issues.push(...checkEmDashArrow(content));
  issues.push(...checkImageRefs(content, fileExists));
  issues.push(...checkFencedCodeIntegrity(content));
  issues.push(...checkEmptySections(content));
  issues.push(...checkEmptyTables(content));
  issues.push(...checkDuplicateHeadings(content));
  issues.push(...checkLatinProseInRuDoc(content, lang));
  issues.push(...checkMinWordsPerH2(content, minWords));
  issues.push(...checkManifestCoverage(content, manifestFiles, excluded));

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return { passed: errors === 0, errors, warnings, issues };
}

module.exports = {
  lintMarkdown,
  checkPlaceholders,
  checkUnresolvedPlaceholders,
  checkUnresolvedDirectives,
  checkEmDashArrow,
  checkImageRefs,
  checkFencedCodeIntegrity,
  checkEmptySections,
  checkEmptyTables,
  checkDuplicateHeadings,
  checkLatinProseInRuDoc,
  checkMinWordsPerH2,
  checkManifestCoverage,
  countWords,
  sectionSplit,
  fenceRanges,
  PLACEHOLDER_PATTERNS,
  DEFAULT_MIN_WORDS_PER_H2,
};
