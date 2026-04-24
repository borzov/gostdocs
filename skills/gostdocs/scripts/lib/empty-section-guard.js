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
  ru: 'Раздел не удалось автоматически заполнить — исследование кода не нашло соответствующей функциональности. Проверьте, реализована ли эта возможность в системе: если реализована — опишите её вручную, если нет — удалите раздел.',
  en: 'This section could not be auto-populated — code research did not find corresponding functionality. Verify whether the feature exists in the system: if yes — describe it manually, if not — drop this section.',
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
  const placeholderAdmonition = () => ({ type: 'admonition', kind: 'todo', text: PLACEHOLDER_TEXT[lang] });
  const gostMode = ctx && ctx.meta && ctx.meta.gost_mode;
  const strict = gostMode === 'strict';
  const touched = [];
  const dropped = [];

  // Post-order walk. Returns true if the section should be kept in the tree.
  // In lite mode, empty leaves are removed entirely so the document stops
  // advertising functionality that the system does not have. In strict mode
  // we preserve the structural section but inject a visible TODO admonition
  // so the reader can trace why it is blank and decide what to do.
  const visit = (section, ancestors) => {
    const childAncestors = [...ancestors, section];
    if (Array.isArray(section.children)) {
      section.children = section.children.filter((child) => visit(child, childAncestors));
    }
    const hasOwnContent = (section.elements || []).some(elementCountsAsContent);
    const hasLiveChildren = (section.children || []).some(sectionHasContent);
    if (hasOwnContent || hasLiveChildren) return true;

    const label = pathOf(ancestors, section);
    if (!strict) {
      dropped.push(label);
      (ctx.warnings = ctx.warnings || []).push({
        scope: 'empty-section',
        message: `"${label}" dropped — no research data (gost_mode=lite)`,
      });
      return false;
    }
    section.elements.push(placeholderAdmonition());
    touched.push(label);
    (ctx.blockers = ctx.blockers || []).push({
      scope: 'empty-section',
      message: `"${label}" has no research data; TODO admonition inserted`,
    });
    return true;
  };

  if (Array.isArray(doc.sections)) {
    doc.sections = doc.sections.filter((s) => visit(s, []));
  }

  return { touchedSections: touched, droppedSections: dropped };
}

module.exports = {
  applyEmptySectionGuard,
  sectionHasContent,
  elementCountsAsContent,
  PLACEHOLDER_TEXT,
};
