'use strict';

/**
 * Build a short Russian (or English) narrative paragraph from a UI inspection
 * JSON record.
 *
 * The previous implementation embedded a raw QA checklist
 * (`[V] heading: …`, `[ ] breadcrumb`, `[ ] top_buttons (2)`) into end-user
 * documentation. That is technical noise — readers of a GOST user guide need
 * a sentence describing the screen, not an English-keyed completeness audit.
 *
 * Strategy:
 *   1. If the vision agent produced fluent prose in `component_kind_notes`,
 *      use it as the spine of the description and append structured sentences
 *      for top-level actions / filters / table columns / modals.
 *   2. Otherwise assemble the paragraph entirely from structured fields.
 *   3. If absolutely nothing is known about the page, return null and let
 *      the caller decide on a fallback caption.
 *
 * The output never contains English field keys, checkbox markers, or other
 * QA artefacts.
 */

// Prose templates use varied phrasing so the rendered guide reads like a
// technical writer's prose and not a mechanical list dump. Each helper
// returns a single complete sentence (ends with a period).
const STRINGS = {
  ru: {
    breadcrumb: (path) => `Навигационная цепочка: ${path}.`,
    loginForm: 'На экране отображается форма входа в систему.',
    errorPage: 'Экран показан в состоянии ошибки.',
    emptyState: 'Экран показан в состоянии «нет данных».',
    actionsOne:  (label)  => `В верхней части экрана размещена кнопка ${label}.`,
    actionsMany: (labels) => `В верхней части экрана размещены кнопки ${labels}.`,
    filtersOne:  (label)  => `Над списком расположен фильтр ${label}.`,
    filtersMany: (labels) => `Над списком расположены фильтры ${labels}.`,
    tableColumns:  (cols) => `Список оформлен в виде таблицы со столбцами ${cols}`,
    tableRow:      (acts) => `для каждой строки доступны действия ${acts}`,
    tableBulk:     (acts) => `для пакетной обработки доступны действия ${acts}`,
    tablePagination:        'предусмотрена постраничная навигация',
    modalsOne:   (label)  => `Из экрана открывается модальное окно ${label}.`,
    modalsMany:  (labels) => `Из экрана открываются модальные окна ${labels}.`,
    fallback: (title) => `На рисунке показан внешний вид экрана «${title}».`,
  },
  en: {
    breadcrumb: (path) => `Breadcrumb: ${path}.`,
    loginForm: 'The screen renders the login form.',
    errorPage: 'The screen is shown in an error state.',
    emptyState: 'The screen is shown in an empty state.',
    actionsOne:  (label)  => `The top of the screen exposes the ${label} button.`,
    actionsMany: (labels) => `The top of the screen exposes the buttons ${labels}.`,
    filtersOne:  (label)  => `Above the list, the ${label} filter is available.`,
    filtersMany: (labels) => `Above the list, filters by ${labels} are available.`,
    tableColumns:  (cols) => `The list is rendered as a table with columns ${cols}`,
    tableRow:      (acts) => `every row exposes the actions ${acts}`,
    tableBulk:     (acts) => `bulk-select actions include ${acts}`,
    tablePagination:        'paginated navigation is provided',
    modalsOne:   (label)  => `The screen opens the ${label} dialog.`,
    modalsMany:  (labels) => `The screen opens the dialogs ${labels}.`,
    fallback: (title) => `The figure shows the «${title}» screen.`,
  },
};

function selectLang(lang) {
  return lang && /^en/i.test(lang) ? 'en' : 'ru';
}

function quoteList(items) {
  return items.map((s) => `«${String(s).trim()}»`).join(', ');
}

/**
 * Conjoin a list of already-quoted items: «А», «Б», «В» → «А», «Б» и «В».
 * Single-item: «А». Empty: ''.
 */
function quoteAnd(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return `«${items[0]}»`;
  const head = items.slice(0, -1).map((s) => `«${s}»`).join(', ');
  return `${head} и «${items[items.length - 1]}»`;
}

function uniqueByLowercase(items) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of items) {
    const k = String(raw).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(raw).trim());
  }
  return out;
}

function nonEmptyArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pickLabels(items) {
  const all = nonEmptyArray(items)
    .map((entry) => {
      if (entry == null) return null;
      if (typeof entry === 'string') return entry.trim() || null;
      const candidate = entry.label || entry.title || entry.name || entry.text;
      return candidate ? String(candidate).trim() : null;
    })
    .filter(Boolean);
  return uniqueByLowercase(all);
}

function pickColumnNames(columns) {
  return nonEmptyArray(columns)
    .map((c) => (c && (c.name || c.label)) || null)
    .filter(Boolean)
    .map(String);
}

function buildSentences(inspection, lang) {
  const t = STRINGS[lang];
  const sentences = [];

  const breadcrumb = nonEmptyArray(inspection.breadcrumb).map(String).filter(Boolean);
  if (breadcrumb.length > 1) {
    sentences.push(t.breadcrumb(breadcrumb.join(' → ')));
  }

  if (inspection.is_login_form) sentences.push(t.loginForm);
  if (inspection.is_error_page) sentences.push(t.errorPage);
  if (inspection.is_empty_state) sentences.push(t.emptyState);

  const buttons = pickLabels(inspection.top_buttons);
  if (buttons.length === 1) sentences.push(t.actionsOne(`«${buttons[0]}»`));
  else if (buttons.length > 1) sentences.push(t.actionsMany(quoteAnd(buttons)));

  const filters = pickLabels(inspection.filters);
  if (filters.length === 1) sentences.push(t.filtersOne(`«${filters[0]}»`));
  else if (filters.length > 1) sentences.push(t.filtersMany(quoteAnd(filters)));

  const table = inspection.table;
  if (table && typeof table === 'object') {
    const cols = pickColumnNames(table.columns);
    const tableParts = [];
    if (cols.length > 0) tableParts.push(t.tableColumns(quoteAnd(cols)));
    const rowActions = pickLabels(table.row_actions);
    if (rowActions.length > 0) tableParts.push(t.tableRow(quoteAnd(rowActions)));
    const bulkActions = pickLabels(table.bulk_actions);
    if (bulkActions.length > 0) tableParts.push(t.tableBulk(quoteAnd(bulkActions)));
    if (table.has_pagination) tableParts.push(t.tablePagination);
    if (tableParts.length > 0) sentences.push(`${tableParts.join('; ')}.`);
  }

  const modals = pickLabels(inspection.modals_visible);
  if (modals.length === 1) sentences.push(t.modalsOne(`«${modals[0]}»`));
  else if (modals.length > 1) sentences.push(t.modalsMany(quoteAnd(modals)));

  return sentences;
}

/**
 * @param {Record<string, any> | null | undefined} inspection
 * @param {string} [lang]
 * @returns {string | null}
 */
function buildPageNarrative(inspection, lang) {
  if (!inspection || typeof inspection !== 'object') return null;
  const lng = selectLang(lang);
  const t = STRINGS[lng];

  const notes = nonEmptyString(inspection.component_kind_notes);
  const structured = buildSentences(inspection, lng);

  // 1. Vision-agent prose wins when present, plus we still append structured
  // sentences (e.g. action button list) so concrete UI details are explicit.
  if (notes) {
    const head = notes.endsWith('.') || notes.endsWith('!') || notes.endsWith('?') ? notes : `${notes}.`;
    return [head, ...structured].join(' ');
  }

  // 2. Pure structured assembly.
  if (structured.length > 0) return structured.join(' ');

  // 3. Bare-minimum fallback so the rendered figure has at least one sentence.
  const title = nonEmptyString(inspection.title);
  if (title) return t.fallback(title);

  return null;
}

module.exports = {
  buildPageNarrative,
  STRINGS,
};
