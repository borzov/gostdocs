'use strict';

/**
 * Normalise and validate page titles produced by vision-inspection agents.
 *
 * Background: vision agents sometimes copy the page `id` into the `title`
 * field (`event-detail`, `admin-queue`), return the English marketing name
 * (`Event Management System`), or leave it `null`. The generator then
 * renders the unfit value as a Russian H3, creating the impression of an
 * unfinished draft.
 *
 * This module provides two entry points:
 *   - `isAcceptableRussianTitle(text)` — soft validator that returns `true`
 *     for titles matching the expected shape (a Russian, human-readable
 *     phrase 2–8 words long).
 *   - `fallbackTitleFromId(pageId, lang)` — last-resort translator that
 *     converts common English slugs (`admin-queue`, `event-detail`) into
 *     a readable Russian phrase using a stack-agnostic dictionary.
 *
 * The dictionary is intentionally small and generic — it covers patterns
 * that appear in most admin panels and content systems. Project-specific
 * terms are expected to arrive from the vision agent.
 */

// Accepts titles that start with a capitalised Cyrillic letter and may
// include Latin fragments (e.g. a disambiguator URL suffix "— /templates/42"
// or an English product name in parentheses).
const ACCEPTABLE_RU_RE = /^[А-ЯЁ][А-Яа-яЁёA-Za-z0-9\s«»"'().,\-–—/:_]{1,119}$/;
const ACCEPTABLE_EN_RE = /^[A-Z][A-Za-z0-9\s"'().,\-–—/]{1,119}$/;

function isAcceptableRussianTitle(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 3 || s.length > 120) return false;
  if (ACCEPTABLE_RU_RE.test(s)) return true;
  return false;
}

function isAcceptableEnglishTitle(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 3 || s.length > 120) return false;
  return ACCEPTABLE_EN_RE.test(s);
}

function isAcceptableTitle(raw, lang = 'ru') {
  return lang === 'en' ? isAcceptableEnglishTitle(raw) : isAcceptableRussianTitle(raw);
}

/**
 * Heuristics to recognise "bad" titles the agent should not have emitted.
 * Used to decide whether to apply the fallback dictionary.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
function looksLikeBadTitle(raw) {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== 'string') return true;
  const s = raw.trim();
  if (!s) return true;
  // Pure slug (no spaces, dashes/underscores as separators) is the most
  // common regression we want to catch: 'event-detail', 'admin_queue'.
  if (/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(s)) return true;
  // All-lowercase single-word English label, still rejected as a title.
  if (/^[a-z]+$/.test(s)) return true;
  // Extremely short fragments — titles shorter than 3 characters are
  // almost always placeholder debris.
  if (s.length < 3) return true;
  return false;
}

// Stack-agnostic id-to-label dictionary. The matcher walks each page-id
// word-by-word (split on /_-\//) and concatenates translated parts; any
// unknown segment is passed through capitalised.
const WORD_MAP_RU = {
  admin:           'Администрирование',
  login:           'Вход',
  logout:          'Выход',
  register:        'Регистрация',
  signin:          'Вход',
  signup:          'Регистрация',
  dashboard:       'Панель управления',
  home:            'Главная страница',
  profile:         'Профиль',
  settings:        'Настройки',
  users:           'Пользователи',
  user:            'Пользователь',
  roles:           'Роли',
  role:            'Роль',
  permissions:     'Разрешения',
  events:          'Мероприятия',
  event:           'Мероприятие',
  categories:      'Категории',
  category:        'Категория',
  orders:          'Заказы',
  order:           'Заказ',
  products:        'Товары',
  product:         'Товар',
  posts:           'Публикации',
  post:            'Публикация',
  pages:           'Страницы',
  page:            'Страница',
  notifications:   'Уведомления',
  notification:    'Уведомление',
  templates:       'Шаблоны',
  template:        'Шаблон',
  reports:         'Отчёты',
  report:          'Отчёт',
  analytics:       'Аналитика',
  statistics:      'Статистика',
  logs:            'Журнал',
  audit:           'Аудит',
  certificates:    'Сертификаты',
  certificate:     'Сертификат',
  files:           'Файлы',
  file:            'Файл',
  faq:             'Частые вопросы',
  search:          'Поиск',
  filter:          'Фильтр',
  list:            'Список',
  detail:          'Карточка',
  details:         'Подробности',
  new:             'Создание',
  create:          'Создание',
  edit:            'Редактирование',
  update:          'Обновление',
  delete:          'Удаление',
  view:            'Просмотр',
  verify:          'Подтверждение',
  verification:    'Подтверждение',
  confirm:         'Подтверждение',
  reset:           'Сброс',
  password:        'Пароль',
  email:           'Email',
  notice:          'Уведомление',
  queue:           'Очередь',
  queues:          'Очереди',
  health:          'Состояние',
  error:           'Ошибка',
  errors:          'Ошибки',
  public:          'Открытая',
  private:         'Закрытая',
};

const WORD_MAP_EN = new Proxy({}, { get: (_, k) => {
  const s = String(k);
  return s.charAt(0).toUpperCase() + s.slice(1);
} });

function splitPageId(id) {
  return String(id || '')
    .replace(/^\/+|\/+$/g, '')
    .split(/[-_/]+/)
    .filter(Boolean);
}

/**
 * Convert a page identifier into a readable title by walking dictionary
 * entries. Unknown tokens are capitalised; numeric path segments (id slots)
 * are discarded.
 *
 * @param {string} pageId
 * @param {'ru'|'en'} [lang='ru']
 * @returns {string|null}
 */
function fallbackTitleFromId(pageId, lang = 'ru') {
  const parts = splitPageId(pageId).filter((p) => !/^\d+$/.test(p) && !/^:id$|^\{id\}$/.test(p));
  if (parts.length === 0) return null;
  const dict = lang === 'en' ? WORD_MAP_EN : WORD_MAP_RU;
  const words = parts.map((p) => {
    const lower = p.toLowerCase();
    if (dict[lower]) return dict[lower];
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  return words.join(' ');
}

/**
 * Resolve a display title: prefer the vision agent's value when it is
 * acceptable, fall back to the id-based translator otherwise. Returns null
 * only when both the agent value and the id produce nothing usable.
 *
 * @param {string|null|undefined} rawTitle
 * @param {string|null|undefined} pageId
 * @param {'ru'|'en'} [lang='ru']
 * @returns {{ title: string|null, source: 'agent'|'fallback'|'none' }}
 */
function resolveDisplayTitle(rawTitle, pageId, lang = 'ru') {
  const trimmed = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (trimmed && isAcceptableTitle(trimmed, lang) && !looksLikeBadTitle(trimmed)) {
    return { title: trimmed, source: 'agent' };
  }
  const fallback = fallbackTitleFromId(pageId, lang);
  if (fallback) return { title: fallback, source: 'fallback' };
  return { title: null, source: 'none' };
}

module.exports = {
  isAcceptableTitle,
  isAcceptableRussianTitle,
  isAcceptableEnglishTitle,
  looksLikeBadTitle,
  fallbackTitleFromId,
  resolveDisplayTitle,
  splitPageId,
  WORD_MAP_RU,
};
