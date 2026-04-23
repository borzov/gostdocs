'use strict';

/**
 * Doc-Model — structured document representation used as the intermediate
 * between research/inspection inputs and the final Markdown.
 *
 * Shape:
 *   {
 *     title, subtitle, lang, frontmatter,
 *     sections: [
 *       {
 *         heading: string, level: 1..4,
 *         slug: string,           // stable anchor
 *         elements: [
 *           { type: 'paragraph', text: string },
 *           { type: 'figure', caption: string, file: string, alt?: string },
 *           { type: 'table', caption: string, headers: string[], rows: string[][] },
 *           { type: 'admonition', kind: 'note|warning|danger|tip', text: string },
 *           { type: 'checklist-result', title: string, items: [{label, filled, source}] },
 *           { type: 'code', lang: string, code: string },
 *           { type: 'raw', format: 'markdown', content: string },
 *         ],
 *         children: Section[]      // nested subsections
 *       }
 *     ]
 *   }
 *
 * The renderer (`doc-model-md.js`) walks this tree. Because it is a tree
 * with explicit element types, the validator can assert per-section
 * completeness without scanning the rendered text.
 */

const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');

const CURRENT_VERSION = '1.0';

const baseElement = z.object({ type: z.string().min(1) });

const paragraph = baseElement.extend({
  type: z.literal('paragraph'),
  text: z.string().min(1),
});

const figure = baseElement.extend({
  type: z.literal('figure'),
  caption: z.string().min(1),
  file: z.string().min(1),
  alt: z.string().optional(),
});

const table = baseElement.extend({
  type: z.literal('table'),
  caption: z.string().optional(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).default([]),
});

const admonition = baseElement.extend({
  type: z.literal('admonition'),
  kind: z.enum(['note', 'warning', 'danger', 'tip']),
  text: z.string().min(1),
});

const checklistItem = z.object({
  label: z.string().min(1),
  filled: z.boolean(),
  source: z.string().nullable().default(null),
});

const checklistResult = baseElement.extend({
  type: z.literal('checklist-result'),
  title: z.string().min(1),
  items: z.array(checklistItem).default([]),
});

const code = baseElement.extend({
  type: z.literal('code'),
  lang: z.string().optional(),
  code: z.string().min(1),
});

const raw = baseElement.extend({
  type: z.literal('raw'),
  format: z.enum(['markdown']).default('markdown'),
  content: z.string().min(1),
});

const pageChecklistItem = z.object({
  label: z.string().min(1),
  filled: z.boolean(),
  value: z.any().nullable().optional(),
  count: z.number().int().nullable().optional(),
  source: z.enum(['inspection', 'manual']).default('inspection'),
});

const pageDescription = baseElement.extend({
  type: z.literal('page-description'),
  page_id: z.string().min(1),
  title: z.string().min(1),
  file: z.string().min(1),
  // Markdown heading depth for the per-page sub-heading. Default 2 so that a
  // page-description nested under an H1 chapter ("# Описание операций")
  // becomes "## Главная" → numbering 4.1 (not "### …" → 4.0.1).
  level: z.number().int().min(1).max(6).optional(),
  // Russian narrative paragraph generated from the inspection JSON; used by
  // end-user guides instead of the QA-style English checklist.
  narrative: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checklist: z.array(pageChecklistItem).default([]),
});

const element = z.discriminatedUnion('type', [
  paragraph, figure, table, admonition, checklistResult, code, raw, pageDescription,
]);

/** @type {any} */
const sectionSchema = z.lazy(() =>
  z.object({
    heading: z.string().min(1),
    level: z.number().int().min(1).max(4),
    slug: z.string().min(1),
    elements: z.array(element).default([]),
    children: z.array(sectionSchema).default([]),
  }),
);

const documentSchema = z
  .object({
    version: z.literal(CURRENT_VERSION).default(CURRENT_VERSION),
    title: z.string().min(1),
    subtitle: z.string().nullable().default(null),
    lang: z.string().min(2).default('ru-RU'),
    frontmatter: z.record(z.any()).default({}),
    sections: z.array(sectionSchema).default([]),
  })
  .strict();

function slugify(input) {
  const src = String(input || '').toLowerCase().trim();
  const cyr = src
    .replace(/ё/g, 'е').replace(/ъ/g, '').replace(/ь/g, '')
    .replace(/й/g, 'j').replace(/а/g, 'a').replace(/б/g, 'b').replace(/в/g, 'v')
    .replace(/г/g, 'g').replace(/д/g, 'd').replace(/е/g, 'e').replace(/ж/g, 'zh')
    .replace(/з/g, 'z').replace(/и/g, 'i').replace(/к/g, 'k').replace(/л/g, 'l')
    .replace(/м/g, 'm').replace(/н/g, 'n').replace(/о/g, 'o').replace(/п/g, 'p')
    .replace(/р/g, 'r').replace(/с/g, 's').replace(/т/g, 't').replace(/у/g, 'u')
    .replace(/ф/g, 'f').replace(/х/g, 'h').replace(/ц/g, 'ts').replace(/ч/g, 'ch')
    .replace(/ш/g, 'sh').replace(/щ/g, 'sch').replace(/ы/g, 'y').replace(/э/g, 'e')
    .replace(/ю/g, 'yu').replace(/я/g, 'ya');
  return cyr
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function newDocument({ title, subtitle = null, lang = 'ru-RU', frontmatter = {} } = {}) {
  if (!title || typeof title !== 'string') throw new Error('document title is required');
  return {
    version: CURRENT_VERSION,
    title,
    subtitle,
    lang,
    frontmatter: { ...frontmatter },
    sections: [],
  };
}

function newSection({ heading, level = 1, slug = null, elements = [], children = [] }) {
  if (!heading) throw new Error('section heading is required');
  return {
    heading,
    level,
    slug: slug || slugify(heading),
    elements,
    children,
  };
}

function addSection(document, section) {
  document.sections.push(section);
  return section;
}

function addElement(section, element_) {
  section.elements.push(element_);
  return element_;
}

function walkSections(document, visit, depth = 0) {
  for (const section of document.sections) {
    visit(section, depth);
    if (section.children && section.children.length > 0) {
      walkSections({ sections: section.children }, visit, depth + 1);
    }
  }
}

function countElements(document, predicate) {
  let count = 0;
  walkSections(document, (s) => {
    for (const el of s.elements) if (predicate(el)) count += 1;
  });
  return count;
}

function validate(doc) {
  return documentSchema.parse(doc);
}

module.exports = {
  CURRENT_VERSION,
  schema: documentSchema,
  sectionSchema,
  element,
  newDocument,
  newSection,
  addSection,
  addElement,
  walkSections,
  countElements,
  slugify,
  validate,
};
