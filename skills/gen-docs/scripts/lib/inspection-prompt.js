'use strict';

/**
 * Vision-prompt builder for the UI inspector.
 *
 * The same prompt template works for Claude and OpenAI (gpt-4o) — both
 * produce structured JSON for the same schema (see inspection-schema.js).
 *
 * Callers pass the manifest entry; the prompt describes the shape we
 * expect back and tags screens that need special handling (Builder /
 * Editor / Wizard get an extra "list the tools" paragraph; login pages
 * get a flag instructing the model to stop short of any deep layout).
 *
 * Pure function: no I/O, no network.
 */

function baseInstruction(lang) {
  if (lang === 'en') {
    return [
      'You are a UI inspector. Analyse the screenshot and return a SINGLE JSON object describing the visible interface.',
      'Do not include any prose outside the JSON. No code fences unless unavoidable.',
      'If a field is not visible or not applicable, use null or an empty array.',
      '',
      'LANGUAGE DISCIPLINE — all string values (title, breadcrumb entries, top_buttons[].label, filters[].label, filters[].options, table.columns[].header, row_actions, bulk_actions, modals_visible, component_kind_notes) MUST be in English. If the UI shows text in another language, transliterate or describe it in English. Borrowed acronyms (API, UI, CRUD) are acceptable.',
      'WRONG: "component_kind_notes": "Главная страница со списком мероприятий"',
      'RIGHT: "component_kind_notes": "Public landing with event cards"',
    ];
  }
  return [
    'Ты инспектор пользовательских интерфейсов. Проанализируй скриншот и верни ОДИН JSON-объект, описывающий видимый интерфейс.',
    'Никакого текста вне JSON. Фенсы ```json``` допустимы, но только если иначе нельзя.',
    'Если поле не видно или неприменимо, используй null или пустой массив.',
    '',
    'ЯЗЫКОВАЯ ДИСЦИПЛИНА — все строковые значения (title, элементы breadcrumb, top_buttons[].label, filters[].label, filters[].options, table.columns[].header, row_actions, bulk_actions, modals_visible, component_kind_notes) ДОЛЖНЫ быть ТОЛЬКО на русском. Если на экране надпись на другом языке — транслитерируй или опиши её по-русски. Общепринятые англоязычные аббревиатуры (API, UI, CRUD, CTA, JWT) допустимы ТОЛЬКО внутри скобок или как имена собственные.',
    'НЕПРАВИЛЬНО: "component_kind_notes": "Public landing page with hero banner and CTA buttons"',
    'ПРАВИЛЬНО:   "component_kind_notes": "Публичная главная страница с баннером-героем и кнопками призыва к действию (CTA)"',
  ];
}

function schemaBlock(lang) {
  const comments = lang === 'en'
    ? {
      title: 'page title as shown, not the route',
      breadcrumb: 'ordered list of breadcrumb links',
      layout: 'high-level layout (e.g. "two-column with sidebar")',
      top_buttons: 'primary action buttons visible above the fold',
      filters: 'search / filter controls',
      table: 'table or list data — columns, row actions, pagination',
      modals: 'currently open modals / dialogs',
      flags: 'set is_login_form=true ONLY if this looks like a credential form',
    }
    : {
      title: 'заголовок страницы как он показан (не URL)',
      breadcrumb: 'цепочка «хлебных крошек» по порядку',
      layout: 'общая композиция ("две колонки с сайдбаром")',
      top_buttons: 'основные кнопки действий над контентом',
      filters: 'поисковые и фильтрующие контролы',
      table: 'таблица или список — столбцы, действия в строке, пагинация',
      modals: 'открытые модальные окна / диалоги',
      flags: 'is_login_form=true ТОЛЬКО если экран похож на форму входа',
    };
  return [
    '{',
    `  "title": string|null,            // ${comments.title}`,
    `  "breadcrumb": string[],          // ${comments.breadcrumb}`,
    `  "layout": string|null,           // ${comments.layout}`,
    `  "top_buttons": [                 // ${comments.top_buttons}`,
    '    { "label": string, "location": "top-bar"|"sidebar"|"row"|"modal"|"floating"|"other", "icon_only": bool }',
    '  ],',
    `  "filters": [                     // ${comments.filters}`,
    '    { "label": string, "control": "text"|"select"|"date"|"toggle"|"checkbox"|"range"|"other", "options": string[] }',
    '  ],',
    `  "table": {                       // ${comments.table}`,
    '    "columns": [ { "header": string, "example": string|null } ],',
    '    "row_actions": string[],',
    '    "bulk_actions": string[],',
    '    "has_pagination": bool',
    '  } | null,',
    `  "modals_visible": string[],     // ${comments.modals}`,
    '  "is_login_form": bool,',
    '  "is_error_page": bool,',
    '  "is_empty_state": bool,',
    `  "component_kind_notes": string|null    // ${comments.flags}`,
    '}',
  ].join('\n');
}

function componentExtras(capture, lang) {
  const kind = capture && capture.component_kind;
  if (!kind) return '';
  const en = lang === 'en';
  const map = {
    builder:     en ? 'List the drag-and-drop palette items, drop zones, and preview panel state.'   : 'Перечисли элементы палитры (drag-and-drop), зоны для дропа и состояние панели предпросмотра.',
    editor:      en ? 'List the toolbar groups, panes (editor / preview), and active tool.'          : 'Перечисли группы инструментов тулбара, панели (редактор / превью), активный инструмент.',
    wizard:      en ? 'State the wizard step number, total steps, and step title.'                   : 'Укажи номер шага визарда, общее число шагов и название текущего шага.',
    constructor: en ? 'List the construct slots, constraints, and any validation messages visible.'  : 'Перечисли слоты конструктора, ограничения и видимые сообщения валидации.',
    designer:    en ? 'List the canvas tools, layers, and inspector panel state.'                    : 'Перечисли инструменты холста, слои и состояние панели-инспектора.',
    composer:    en ? 'List available blocks / templates and current composition outline.'           : 'Перечисли доступные блоки/шаблоны и текущий план композиции.',
  };
  return `\n\nExtra (${kind}): ${map[kind] || ''}`;
}

function roleHint(capture, lang) {
  const role = capture && capture.role ? capture.role : 'unknown';
  const en = lang === 'en';
  const authed = role !== 'guest';
  if (authed) {
    return en
      ? `\nThe user is authenticated as "${role}". A visible login form means authentication failed — set is_login_form=true only then.`
      : `\nПользователь авторизован как "${role}". Видимая форма входа означает, что авторизация не сработала — только в этом случае is_login_form=true.`;
  }
  return en
    ? `\nThe user is the guest role. A login form is expected for protected pages; do not flag it as an error.`
    : `\nПользователь — гость. Форма входа для защищённых страниц ожидаема, не помечай её как ошибку.`;
}

/**
 * Build the full prompt string.
 *
 * @param {{ id?: string, path?: string, role: string, viewport?: string,
 *           theme?: string|null, locale?: string|null,
 *           component_kind?: string|null, state?: string|null }} capture
 * @param {{ lang?: 'ru'|'en' }} [opts]
 * @returns {string}
 */
function buildPrompt(capture, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const header = baseInstruction(lang);
  const body = [
    ...header,
    '',
    lang === 'en'
      ? `Target page: ${capture.path || '(unknown)'}`
      : `Страница: ${capture.path || '(неизвестна)'}`,
    roleHint(capture, lang),
    '',
    lang === 'en' ? 'Return a JSON object with this shape:' : 'Верни JSON такой формы:',
    schemaBlock(lang),
    componentExtras(capture, lang),
  ];
  return body.join('\n');
}

module.exports = {
  buildPrompt,
  baseInstruction,
  schemaBlock,
  componentExtras,
  roleHint,
};
