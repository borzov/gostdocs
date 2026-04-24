'use strict';

/**
 * Extract sections from research markdown files.
 *
 * The research subagents (doc-researcher, spec-reader, role-discovery, …)
 * emit free-form markdown with conventional H1/H2/H3 headings like
 * "Обзор системы", "Архитектура", "Развёртывание", "Аутентификация".
 * The architecture and deployment-guide templates surface those sections
 * as-is via `GEN:research-section`, so the expert-facing documents reuse
 * the agent's prose instead of restating it or leaving placeholders.
 *
 * The module is pure: it takes a string (the MD body) and a heading key
 * and returns the trimmed section body. Matching is case/insensitive,
 * whitespace-collapsed, and tolerant to H2 vs H3 nesting.
 */

function normaliseHeading(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Iterate headings in the markdown, yielding `{ level, text, start, end }`
 * for every `#` / `##` / `###` line. `start` is the line number of the
 * heading itself; `end` is the line number of the next heading of same or
 * shallower level (or the end of the file).
 *
 * @param {string} md
 * @returns {Array<{level:number,text:string,start:number,end:number}>}
 */
function listHeadings(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split('\n');
  const out = [];
  const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(HEADING_RE);
    if (m) out.push({ level: m[1].length, text: m[2], start: i, end: lines.length });
  }
  // Back-fill `end`: for each heading, find the next one with same or
  // shallower level; use its `start` as the current heading's end.
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      if (out[j].level <= out[i].level) {
        out[i].end = out[j].start;
        break;
      }
    }
  }
  return out;
}

/**
 * Extract the body of a heading by its text. Supports fuzzy matching:
 * "Развёртывание" also matches "Развертывание" (no ё) and case-insensitive
 * variants. Returns null when no heading matches.
 *
 * @param {string} md
 * @param {string|string[]} headings — single heading or list of aliases
 * @param {{ maxWords?: number }} [opts]
 * @returns {string|null}
 */
function extractSection(md, headings, opts = {}) {
  if (!md || typeof md !== 'string') return null;
  const list = Array.isArray(headings) ? headings : [headings];
  const wanted = list.map((h) => normaliseHeading(h).replace(/ё/g, 'е'));
  const all = listHeadings(md);
  const lines = md.split('\n');
  for (const h of all) {
    const normalised = normaliseHeading(h.text).replace(/ё/g, 'е');
    if (!wanted.some((w) => normalised === w || normalised.startsWith(`${w} `))) continue;
    const body = lines.slice(h.start + 1, h.end).join('\n').trim();
    if (!body) return null;
    if (opts.maxWords && Number(opts.maxWords) > 0) {
      // Count words across the whole body but keep the source's line
      // structure intact. We walk line-by-line, adding tokens until the
      // cap is reached; the last line is truncated if needed, and the
      // rest of the document is dropped with an ellipsis marker.
      const max = Number(opts.maxWords);
      const outLines = [];
      let count = 0;
      for (const line of body.split('\n')) {
        if (count >= max) break;
        const tokens = line.split(/[^\S\n]+/).filter(Boolean);
        if (count + tokens.length <= max) {
          outLines.push(line);
          count += tokens.length;
          continue;
        }
        // Truncate this line at the word boundary.
        const take = max - count;
        const truncated = tokens.slice(0, take).join(' ');
        // Preserve leading whitespace (indented list items look like "- …").
        const indent = line.match(/^(\s*)/)[1] || '';
        outLines.push(`${indent}${truncated}…`);
        count = max;
        break;
      }
      if (count >= max) return outLines.join('\n');
    }
    return body;
  }
  return null;
}

/**
 * Extract a list-style section: returns an array of bullet-list items
 * parsed from the section body. Useful when the template needs a bullet
 * list rather than free-form prose.
 *
 * @param {string} md
 * @param {string|string[]} headings
 * @returns {string[]}
 */
function extractSectionAsBullets(md, headings) {
  const body = extractSection(md, headings);
  if (!body) return [];
  const items = [];
  const BULLET_RE = /^[\s]*[-*]\s+(.+)$/;
  for (const line of body.split('\n')) {
    const m = line.match(BULLET_RE);
    if (m) items.push(m[1].trim());
  }
  return items;
}

module.exports = {
  extractSection,
  extractSectionAsBullets,
  listHeadings,
  normaliseHeading,
};
