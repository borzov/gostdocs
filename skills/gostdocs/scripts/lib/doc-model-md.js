'use strict';

/**
 * Doc-Model → Markdown renderer.
 *
 * GOST-compliant emission:
 *   - headings without manual numbers (`# Введение`, not `# 1 Введение`);
 *     pandoc `--number-sections` fills in 1, 1.1, 1.2 at conversion time
 *   - figures and tables numbered per top-level section:
 *     "Рисунок 4.1 — Caption" / "Figure 4.1 — Caption"
 *   - YAML frontmatter at the top (title / lang / any extra keys)
 *   - no horizontal rules, no emoji, plain `[V]` / `[ ]` checkbox markers
 *
 * The renderer is a pure function over a validated Doc-Model.
 */

const LANG_STRINGS = {
  ru: { fig: 'Рисунок', tbl: 'Таблица', checkYes: '[V]', checkNo: '[ ]', noteKinds: {
    note: 'Примечание', warning: 'Внимание', danger: 'Опасно', tip: 'Рекомендация',
  }},
  en: { fig: 'Figure', tbl: 'Table', checkYes: '[x]', checkNo: '[ ]', noteKinds: {
    note: 'Note', warning: 'Warning', danger: 'Danger', tip: 'Tip',
  }},
};

function selectLang(doc) {
  return doc && doc.lang && /^en/i.test(doc.lang) ? 'en' : 'ru';
}

function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return /[:\s]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  return JSON.stringify(value);
}

function emitFrontmatter(document) {
  const fm = { title: document.title, lang: document.lang, ...document.frontmatter };
  if (document.subtitle) fm.subtitle = document.subtitle;
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${stringifyValue(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderTable(element, counters, lang) {
  const lines = [];
  if (element.caption) {
    counters.tables += 1;
    const seq = `${counters.topSection}.${counters.tables}`;
    lines.push(`: ${LANG_STRINGS[lang].tbl} ${seq} — ${element.caption}`);
  }
  lines.push(`| ${element.headers.map(escapeCell).join(' | ')} |`);
  lines.push(`|${element.headers.map(() => '---').join('|')}|`);
  for (const row of element.rows) {
    const padded = element.headers.map((_, i) => escapeCell(row[i] || ''));
    lines.push(`| ${padded.join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderFigure(element, counters, lang) {
  counters.figures += 1;
  const seq = `${counters.topSection}.${counters.figures}`;
  const caption = `${LANG_STRINGS[lang].fig} ${seq} — ${element.caption}`;
  return `![${caption}](${element.file})`;
}

function renderChecklist(element, lang) {
  const lines = [`**${element.title}:**`, ''];
  for (const item of element.items) {
    const mark = item.filled ? LANG_STRINGS[lang].checkYes : LANG_STRINGS[lang].checkNo;
    const source = item.source ? ` _(source: ${item.source})_` : '';
    lines.push(`- ${mark} ${item.label}${source}`);
  }
  return lines.join('\n');
}

function renderAdmonition(element, lang) {
  const header = LANG_STRINGS[lang].noteKinds[element.kind] || element.kind;
  return `> **${header}.** ${element.text}`;
}

function renderCode(element) {
  const lang = element.lang ? element.lang : '';
  return '```' + lang + '\n' + element.code + '\n```';
}

function renderTitlePage(element) {
  const parts = [];
  parts.push('::: {.titlepage}');
  parts.push('');
  if (element.organization) parts.push(`**${element.organization}**`, '');
  if (element.approved_by) parts.push(element.approved_by, '');
  parts.push('\\vspace{3cm}', '');
  parts.push(`**${element.document_title}**`, '');
  if (element.system_name) {
    parts.push(`АС «${element.system_name}»`, '');
  }
  if (element.doc_code) parts.push(element.doc_code, '');
  if (element.version) parts.push(`Версия ${element.version}`, '');
  parts.push('\\vfill', '');
  const footer = [element.city, element.year].filter(Boolean).join(', ');
  if (footer) parts.push(footer, '');
  parts.push(':::');
  parts.push('');
  parts.push('\\newpage');
  return parts.join('\n');
}

function renderPageDescription(element, counters, lang) {
  const level = Math.max(1, Math.min(6, element.level || 2));
  const hash = '#'.repeat(level);
  const out = [`${hash} ${element.title}`];
  const figure = renderFigure({ caption: element.title, file: element.file }, counters, lang);
  out.push('', figure);
  if (element.narrative) {
    out.push('', element.narrative);
  }
  if (element.description) {
    out.push('', element.description);
  }
  // The English-keyed checklist is a QA artefact and intentionally NOT
  // emitted into end-user guides any more. It still renders here ONLY when
  // explicitly populated (e.g. by REPORT.md), so legacy callers keep
  // working but production page-descriptions now favour `narrative`.
  if (element.checklist && element.checklist.length > 0) {
    out.push('', `**${lang === 'en' ? 'Page checklist' : 'Проверочный список'}:**`, '');
    for (const item of element.checklist) {
      const mark = item.filled ? LANG_STRINGS[lang].checkYes : LANG_STRINGS[lang].checkNo;
      let suffix = '';
      if (item.count !== null && item.count !== undefined) suffix = ` (${item.count})`;
      else if (item.value !== null && item.value !== undefined && item.value !== '') {
        suffix = `: ${item.value}`;
      }
      out.push(`- ${mark} ${item.label}${suffix}`);
    }
  }
  return out.join('\n');
}

function renderElement(element, counters, lang) {
  switch (element.type) {
    case 'paragraph':       return element.text;
    case 'figure':          return renderFigure(element, counters, lang);
    case 'table':           return renderTable(element, counters, lang);
    case 'admonition':      return renderAdmonition(element, lang);
    case 'checklist-result': return renderChecklist(element, lang);
    case 'code':            return renderCode(element);
    case 'raw':             return element.content;
    case 'page-description': return renderPageDescription(element, counters, lang);
    case 'title-page':      return renderTitlePage(element);
    default:                return '';
  }
}

function renderSection(section, counters, lang, depth) {
  if (depth === 0) {
    counters.topSection += 1;
    counters.figures = 0;
    counters.tables = 0;
  }
  const level = Math.max(1, Math.min(4, section.level || (depth + 1)));
  const hash = '#'.repeat(level);
  const out = [`${hash} ${section.heading}`];

  for (const element of section.elements) {
    out.push('');
    out.push(renderElement(element, counters, lang));
  }

  for (const child of section.children || []) {
    out.push('');
    out.push(renderSection(child, counters, lang, depth + 1));
  }
  return out.join('\n');
}

/**
 * Render a validated Doc-Model to a Markdown string.
 *
 * @param {ReturnType<import('./doc-model').validate>} document
 * @returns {string}
 */
function render(document) {
  const lang = selectLang(document);
  const counters = { topSection: 0, figures: 0, tables: 0 };

  const blocks = [emitFrontmatter(document), ''];
  for (const element of document.preamble || []) {
    blocks.push(renderElement(element, counters, lang));
    blocks.push('');
  }
  for (const section of document.sections) {
    blocks.push(renderSection(section, counters, lang, 0));
    blocks.push('');
  }
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = {
  render,
  renderSection,
  renderElement,
  emitFrontmatter,
  LANG_STRINGS,
};
