'use strict';

/**
 * Template loader — parses GOST-compliant markdown templates with GEN:*
 * directives into a skeleton, then expands each directive through a caller-
 * provided expander map into a validated Doc-Model.
 *
 * Skeleton shape:
 *   {
 *     frontmatter: Record<string, any>,
 *     sections: Array<{
 *       heading: string,
 *       level: 1..4,
 *       elements: Array<
 *         | { kind: 'paragraph', text: string }
 *         | { kind: 'raw', content: string }
 *         | { kind: 'directive', name: string, attrs: Record<string, string|true>, sourceLine: number }
 *       >,
 *       children: Section[],
 *     }>,
 *   }
 *
 * Unknown directives in expandSkeleton record a warning under
 * ctx.warnings = [{ scope: 'template', message }, ...] and the element is
 * dropped — templates keep parsing, generation keeps going.
 */

const fs = require('fs');
const path = require('path');

const dm = require('./doc-model');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const YAML = resolveModule('yaml');

const DIRECTIVE_REGEX = /<!--\s*GEN:([\w-]+)\s*(.*?)\s*-->/s;
const AGENT_COMMENT_REGEX = /^<!--\s*(AGENT|GOST|Reference):[\s\S]*?-->\s*$/;
const AGENT_COMMENT_OPENER = /^<!--\s*(AGENT|GOST|Reference):/;

const LATEX_MAP = [
  [/^\\newpage\s*$/, 'pagebreak'],
  [/^\\begin\{center\}\s*$/, 'centered-block'],
  [/^\\end\{center\}\s*$/, 'end-centered'],
];
const LATEX_DROP = [/^\\vspace\*?\{[^}]*\}\s*$/, /^\\vfill\s*$/];

function parseAttrs(raw) {
  const out = {};
  if (!raw) return out;
  const text = String(raw).trim();
  if (!text) return out;
  const re = /(\w[\w-]*)(?:=(?:"((?:\\.|[^"\\])*)"|([^\s]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    if (m[2] !== undefined) {
      out[key] = m[2].replace(/\\(.)/g, '$1');
    } else if (m[3] !== undefined) {
      out[key] = m[3];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseFrontmatter(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { data: {}, rest: lines };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return { data: {}, rest: lines };
  const body = lines.slice(1, end).join('\n');
  const data = body.trim() ? YAML.parse(body) || {} : {};
  return { data, rest: lines.slice(end + 1) };
}

function matchHeading(line) {
  const m = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
  if (!m) return null;
  return { level: m[1].length, heading: m[2] };
}

/**
 * Compute a Set of line indexes that fall *inside* fenced code blocks
 * (between an opening and closing ``` / ~~~ marker). The opening and
 * closing fence lines themselves are NOT included — they are not headings.
 *
 * Used to skip "headings" like `# Остановка` that are actually shell
 * comments inside ```bash``` blocks (a regression that, in v0.3, caused
 * admin-guide templates to split into bogus sections).
 */
function fenceMaskedLines(lines) {
  const masked = new Set();
  let inFence = false;
  let fenceMarker = null;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (inFence) {
      if (fenceMarker && trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      } else {
        masked.add(i);
      }
      continue;
    }
    if (trimmed.startsWith('```')) {
      inFence = true;
      fenceMarker = '```';
    } else if (trimmed.startsWith('~~~')) {
      inFence = true;
      fenceMarker = '~~~';
    }
  }
  return masked;
}

function buildDirective(name, attrs, lineNumber) {
  return { kind: 'directive', name, attrs, sourceLine: lineNumber };
}

function tryLatexDirective(line) {
  const trimmed = line.trim();
  for (const re of LATEX_DROP) if (re.test(trimmed)) return { drop: true };
  for (const [re, name] of LATEX_MAP) if (re.test(trimmed)) return { name };
  return null;
}

function isBlockStarter(line) {
  const t = line.trimStart();
  return (
    t.startsWith('|') ||
    t.startsWith('- ') ||
    t.startsWith('* ') ||
    /^\d+\.\s/.test(t) ||
    t.startsWith(': ') ||
    t.startsWith('> ') ||
    t.startsWith('::: ') || t.startsWith(':::')
  );
}

function collectUntilSeparator(lines, start) {
  const out = [];
  let i = start;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (matchHeading(line)) break;
    if (line.trim().startsWith('```')) break;
    if (DIRECTIVE_REGEX.test(line) || AGENT_COMMENT_REGEX.test(line.trim())) break;
    if (tryLatexDirective(line)) break;
    out.push(line);
  }
  return { block: out, next: i };
}

function collectFencedCode(lines, start) {
  const fence = lines[start].trim().slice(0, 3);
  const out = [lines[start]];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    out.push(lines[i]);
    if (lines[i].trim().startsWith(fence)) { i += 1; break; }
  }
  return { block: out, next: i };
}

function parseSectionBody(lines, startIndex, endIndex) {
  const elements = [];
  let i = startIndex;
  while (i < endIndex) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { i += 1; continue; }
    if (AGENT_COMMENT_REGEX.test(trimmed)) { i += 1; continue; }
    // Multi-line AGENT/GOST/Reference comments — gobble through the closing
    // `-->`. Without this, the second and subsequent lines of a multi-line
    // <!-- AGENT: … --> block leak into the rendered Markdown as either
    // raw text or stray `<!--` tokens that md-lint then flags as
    // unresolved placeholders.
    if (AGENT_COMMENT_OPENER.test(trimmed) && !/-->\s*$/.test(trimmed)) {
      let j = i + 1;
      while (j < endIndex && !/-->/.test(lines[j])) j += 1;
      i = (j < endIndex) ? j + 1 : endIndex;
      continue;
    }

    const dirMatch = trimmed.match(DIRECTIVE_REGEX);
    if (dirMatch && trimmed === dirMatch[0]) {
      elements.push(buildDirective(dirMatch[1], parseAttrs(dirMatch[2]), i + 1));
      i += 1;
      continue;
    }

    const latex = tryLatexDirective(line);
    if (latex) {
      if (!latex.drop) elements.push(buildDirective(latex.name, {}, i + 1));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const res = collectFencedCode(lines, i);
      elements.push({ kind: 'raw', content: res.block.join('\n') });
      i = res.next;
      continue;
    }

    if (isBlockStarter(line)) {
      const res = collectUntilSeparator(lines, i);
      elements.push({ kind: 'raw', content: res.block.join('\n') });
      i = res.next;
      continue;
    }

    const res = collectUntilSeparator(lines, i);
    const text = res.block.join(' ').replace(/\s+/g, ' ').trim();
    if (text) elements.push({ kind: 'paragraph', text });
    i = res.next;
  }
  return elements;
}

function parseTemplate(content, _opts = {}) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const fm = parseFrontmatter(lines);
  const rest = fm.rest;

  const masked = fenceMaskedLines(rest);
  const flat = [];
  let cursor = 0;
  while (cursor < rest.length) {
    if (masked.has(cursor)) { cursor += 1; continue; }
    const heading = matchHeading(rest[cursor]);
    if (!heading) { cursor += 1; continue; }
    let end = rest.length;
    for (let j = cursor + 1; j < rest.length; j += 1) {
      if (masked.has(j)) continue;
      if (matchHeading(rest[j])) { end = j; break; }
    }
    const elements = parseSectionBody(rest, cursor + 1, end);
    flat.push({ level: heading.level, heading: heading.heading, elements, children: [] });
    cursor = end;
  }

  const roots = [];
  const stack = [];
  for (const s of flat) {
    while (stack.length > 0 && stack[stack.length - 1].level >= s.level) stack.pop();
    if (stack.length === 0) roots.push(s);
    else stack[stack.length - 1].children.push(s);
    stack.push(s);
  }

  return { frontmatter: fm.data, sections: roots };
}

function loadTemplate(templatePath, opts = {}) {
  const content = fs.readFileSync(templatePath, 'utf8');
  return parseTemplate(content, opts);
}

function pushWarning(ctx, scope, message) {
  if (ctx && Array.isArray(ctx.warnings)) {
    ctx.warnings.push({ scope, message });
  }
}

function coerceArray(arr) {
  const elements = [];
  const sections = [];
  for (const item of arr) {
    if (item == null) continue;
    if (item.kind === 'section' && item.section) sections.push(item.section);
    else if (item.type) elements.push(item);
  }
  return { elements, sections };
}

function coerceElements(result) {
  if (result == null) return { elements: [], sections: [] };
  if (Array.isArray(result)) return coerceArray(result);
  if (result.kind === 'section' && result.section) {
    return { elements: [], sections: [result.section] };
  }
  if (result.type) return { elements: [result], sections: [] };
  return { elements: [], sections: [] };
}

async function expandElement(element, expanders, ctx) {
  if (element.kind === 'paragraph') {
    return { elements: [{ type: 'paragraph', text: element.text }], sections: [] };
  }
  if (element.kind === 'raw') {
    const content = String(element.content || '').trim();
    if (!content) return { elements: [], sections: [] };
    return {
      elements: [{ type: 'raw', format: 'markdown', content }],
      sections: [],
    };
  }
  if (element.kind === 'directive') {
    const expander = expanders && expanders[element.name];
    if (typeof expander !== 'function') {
      pushWarning(ctx, 'template', `unknown directive: ${element.name}`);
      return { elements: [], sections: [] };
    }
    const result = await expander(element.attrs || {}, ctx, element);
    return coerceElements(result);
  }
  return { elements: [], sections: [] };
}

async function expandSection(skelSection, expanders, ctx) {
  const section = dm.newSection({
    heading: skelSection.heading,
    level: skelSection.level,
  });

  for (const el of skelSection.elements || []) {
    const produced = await expandElement(el, expanders, ctx);
    for (const e of produced.elements) section.elements.push(e);
    for (const s of produced.sections) section.children.push(s);
  }

  for (const child of skelSection.children || []) {
    const childSection = await expandSection(child, expanders, ctx);
    section.children.push(childSection);
  }

  return section;
}

async function expandSkeleton(skeleton, expanders, context) {
  const ctx = context || {};
  const fm = skeleton.frontmatter || {};
  const title = fm.title || ctx.title || 'Untitled';
  const lang = fm.lang || ctx.lang || 'ru-RU';
  const doc = dm.newDocument({ title, lang, frontmatter: { ...fm } });

  for (const s of skeleton.sections || []) {
    const built = await expandSection(s, expanders || {}, ctx);
    doc.sections.push(built);
  }
  return doc;
}

module.exports = {
  DIRECTIVE_REGEX,
  parseAttrs,
  parseTemplate,
  loadTemplate,
  expandSkeleton,
};
