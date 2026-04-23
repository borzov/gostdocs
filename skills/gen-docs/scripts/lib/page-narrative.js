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

const STRINGS = {
  ru: {
    actions: 'Доступные действия',
    filters: 'Можно отфильтровать список по полям',
    columnsHas: 'Таблица содержит колонки',
    rowActions: 'для каждой строки доступны действия',
    bulkActions: 'для массового выбора доступны действия',
    pagination: 'предусмотрена постраничная навигация',
    modals: 'Из этого экрана открываются модальные окна',
    emptyState: 'Экран показан в виде пустого состояния',
    errorPage: 'Экран отображает страницу ошибки',
    loginForm: 'На экране отображается форма входа в систему',
    breadcrumb: 'Хлебные крошки указывают путь',
    fallback: (title) => `На рисунке приведён внешний вид экрана «${title}».`,
  },
  en: {
    actions: 'Available actions',
    filters: 'The list can be filtered by',
    columnsHas: 'The table has columns',
    rowActions: 'each row exposes the actions',
    bulkActions: 'bulk-selection actions are',
    pagination: 'paginated navigation is provided',
    modals: 'Modal dialogs that can be opened from this screen',
    emptyState: 'The screen is shown in an empty state',
    errorPage: 'The screen shows an error page',
    loginForm: 'The screen renders a login form',
    breadcrumb: 'Breadcrumb path',
    fallback: (title) => `The figure shows the «${title}» screen.`,
  },
};

function selectLang(lang) {
  return lang && /^en/i.test(lang) ? 'en' : 'ru';
}

function quoteList(items, lang) {
  // For ru and en alike we use guillemets «» — the surrounding doc style is
  // already Russian-leaning and pandoc preserves them in DOCX output.
  return items.map((s) => `«${String(s).trim()}»`).join(', ');
}

function nonEmptyArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pickLabels(items) {
  return nonEmptyArray(items)
    .map((entry) => {
      if (entry == null) return null;
      if (typeof entry === 'string') return entry.trim() || null;
      const candidate = entry.label || entry.title || entry.name || entry.text;
      return candidate ? String(candidate).trim() : null;
    })
    .filter(Boolean);
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
    sentences.push(`${t.breadcrumb}: ${breadcrumb.join(' / ')}.`);
  }

  if (inspection.is_login_form) {
    sentences.push(`${t.loginForm}.`);
  }
  if (inspection.is_error_page) {
    sentences.push(`${t.errorPage}.`);
  }
  if (inspection.is_empty_state) {
    sentences.push(`${t.emptyState}.`);
  }

  const buttons = pickLabels(inspection.top_buttons);
  if (buttons.length > 0) {
    sentences.push(`${t.actions}: ${quoteList(buttons, lang)}.`);
  }

  const filters = pickLabels(inspection.filters);
  if (filters.length > 0) {
    sentences.push(`${t.filters}: ${quoteList(filters, lang)}.`);
  }

  const table = inspection.table;
  if (table && typeof table === 'object') {
    const cols = pickColumnNames(table.columns);
    const tableParts = [];
    if (cols.length > 0) {
      tableParts.push(`${t.columnsHas}: ${quoteList(cols, lang)}`);
    }
    const rowActions = pickLabels(table.row_actions);
    if (rowActions.length > 0) {
      tableParts.push(`${t.rowActions}: ${quoteList(rowActions, lang)}`);
    }
    const bulkActions = pickLabels(table.bulk_actions);
    if (bulkActions.length > 0) {
      tableParts.push(`${t.bulkActions}: ${quoteList(bulkActions, lang)}`);
    }
    if (table.has_pagination) {
      tableParts.push(t.pagination);
    }
    if (tableParts.length > 0) {
      sentences.push(`${tableParts.join('; ')}.`);
    }
  }

  const modals = pickLabels(inspection.modals_visible);
  if (modals.length > 0) {
    sentences.push(`${t.modals}: ${quoteList(modals, lang)}.`);
  }

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
