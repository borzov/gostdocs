'use strict';

/**
 * Empty-section guard.
 *
 * Post-order walk of a Doc-Model tree. A section is "empty" when it has
 * neither a content-bearing element (paragraph, list, table with data,
 * figure, admonition, code, checklist-result, page-description, title-page,
 * raw markdown) nor a non-empty child section. Empty leaves get a
 * localised "подлежит заполнению" placeholder paragraph inserted so the
 * reader sees WHY the section is blank, and the guard records a blocker
 * (strict) or warning (lite) for observability.
 *
 * The guard is called AFTER all expanders run but BEFORE md-lint, so
 * mode=strict surfaces the gap via ctx.blockers while the rendered
 * Markdown still contains a human-readable explanation.
 */

const PLACEHOLDER_TEXT = {
  ru: '_(Раздел подлежит заполнению — исследование не вернуло данных для этой темы.)_',
  en: '_(This section is pending — research produced no data for this topic.)_',
};

const CONTENT_ELEMENT_TYPES = new Set([
  'paragraph',
  'figure',
  'table',
  'admonition',
  'checklist-result',
  'code',
  'raw',
  'page-description',
  'title-page',
]);

function tableHasData(el) {
  return el && el.type === 'table' && Array.isArray(el.rows) && el.rows.length > 0;
}

function rawHasContent(el) {
  if (!el || el.type !== 'raw') return false;
  const content = String(el.content || '').trim();
  if (!content) return false;
  return content !== '<!-- UNRESOLVED-DIRECTIVE -->' && !/^<!--[\s\S]*-->$/.test(content);
}

function elementCountsAsContent(el) {
  if (!el || !el.type) return false;
  if (el.type === 'table') return tableHasData(el);
  if (el.type === 'raw') return rawHasContent(el);
  return CONTENT_ELEMENT_TYPES.has(el.type);
}

function sectionHasContent(section) {
  if (!section) return false;
  for (const el of section.elements || []) {
    if (elementCountsAsContent(el)) return true;
  }
  for (const child of section.children || []) {
    if (sectionHasContent(child)) return true;
  }
  return false;
}

function pathOf(ancestors, section) {
  return [...ancestors, section].map((s) => s.heading).join(' › ');
}

/**
 * Walk `doc.sections`, insert a placeholder paragraph into any empty leaf
 * section, and record findings in `ctx.warnings` / `ctx.blockers`.
 *
 * @param {object} doc — validated Doc-Model
 * @param {object} ctx — expander context (ctx.warnings, ctx.blockers, ctx.meta.gost_mode, ctx.lang)
 * @returns {{ touchedSections: string[] }}
 */
function applyEmptySectionGuard(doc, ctx) {
  const lang = ctx && ctx.lang === 'en' ? 'en' : 'ru';
  const placeholder = { type: 'paragraph', text: PLACEHOLDER_TEXT[lang] };
  const gostMode = ctx && ctx.meta && ctx.meta.gost_mode;
  const strict = gostMode === 'strict';
  const touched = [];

  const visit = (section, ancestors) => {
    const hasChildren = Array.isArray(section.children) && section.children.length > 0;
    const childAncestors = [...ancestors, section];
    // Walk children first so nested empties get filled before we decide
    // whether the parent section is empty overall.
    for (const child of section.children || []) {
      visit(child, childAncestors);
    }
    // A section with populated children is fine even if its own elements
    // are empty — container headings legitimately delegate content.
    const hasOwnContent = (section.elements || []).some(elementCountsAsContent);
    if (hasOwnContent) return;
    if (hasChildren && section.children.some(sectionHasContent)) return;
    // Pure leaf: inject the placeholder and record the finding.
    section.elements.push({ ...placeholder });
    const label = pathOf(ancestors, section);
    touched.push(label);
    const entry = {
      scope: 'empty-section',
      message: `"${label}" has no research data; placeholder inserted`,
    };
    if (strict) {
      (ctx.blockers = ctx.blockers || []).push(entry);
    } else {
      (ctx.warnings = ctx.warnings || []).push(entry);
    }
  };

  for (const section of doc.sections || []) {
    visit(section, []);
  }

  return { touchedSections: touched };
}

module.exports = {
  applyEmptySectionGuard,
  sectionHasContent,
  elementCountsAsContent,
  PLACEHOLDER_TEXT,
};
