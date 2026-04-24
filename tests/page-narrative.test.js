'use strict';

const { buildPageNarrative } = require('../skills/gostdocs/scripts/lib/page-narrative');

describe('buildPageNarrative — ru (default)', () => {
  test('prefers component_kind_notes when it is non-empty Russian prose', () => {
    const out = buildPageNarrative({
      title: 'Профиль',
      component_kind_notes: 'Страница профиля пользователя: карточка с аватаром, именем и email; ниже карточка смены пароля.',
      top_buttons: [{ label: 'Изменить' }],
    }, 'ru');
    expect(out).toContain('Страница профиля пользователя');
    expect(out).toContain('Изменить'); // top_buttons appended as a "Доступные действия" sentence
  });

  test('assembles varied sentences from top_buttons and filters when notes are empty', () => {
    const out = buildPageNarrative({
      title: 'Список мероприятий',
      breadcrumb: ['Главная', 'Мероприятия'],
      top_buttons: [
        { label: 'Создать мероприятие' },
        { label: 'Импорт' },
      ],
      filters: [
        { label: 'Категория' },
        { label: 'Статус' },
      ],
      table: { columns: [{ name: 'Название' }, { name: 'Дата' }], has_pagination: true },
    }, 'ru');
    // Plural-aware: "размещены кнопки X и Y" (not "Доступные действия:")
    expect(out).toContain('размещены кнопки «Создать мероприятие» и «Импорт».');
    expect(out).toContain('расположены фильтры «Категория» и «Статус».');
    expect(out).toContain('таблицы со столбцами «Название» и «Дата»');
    expect(out).toContain('постраничная навигация');
  });

  test('uses singular phrasing when there is only one button / filter / modal', () => {
    const out = buildPageNarrative({
      title: 'Профиль',
      top_buttons: [{ label: 'Изменить' }],
      filters: [{ label: 'Дата' }],
      modals_visible: [{ title: 'Подтверждение' }],
    }, 'ru');
    expect(out).toContain('размещена кнопка «Изменить».');
    expect(out).toContain('расположен фильтр «Дата».');
    expect(out).toContain('открывается модальное окно «Подтверждение».');
  });

  test('deduplicates repeated button labels (case-insensitive)', () => {
    const out = buildPageNarrative({
      title: 'Главная',
      top_buttons: [
        { label: 'Регистрация' },
        { label: 'Вход' },
        { label: 'РЕГИСТРАЦИЯ' },
        { label: 'вход' },
      ],
    }, 'ru');
    // Each label appears exactly once in the rendered narrative.
    expect((out.match(/«Регистрация»/g) || []).length).toBe(1);
    expect((out.match(/«Вход»/g) || []).length).toBe(1);
  });

  test('mentions modal windows and empty state when present', () => {
    const out = buildPageNarrative({
      title: 'Отчёты',
      modals_visible: [{ title: 'Подтверждение удаления' }],
      is_empty_state: true,
    }, 'ru');
    expect(out).toContain('состоянии «нет данных».');
    expect(out).toContain('«Подтверждение удаления»');
  });

  test('detects a login form and produces a focused single sentence', () => {
    const out = buildPageNarrative({
      title: 'Вход',
      is_login_form: true,
    }, 'ru');
    expect(out).toMatch(/форма входа/i);
  });

  test('uses → as breadcrumb separator (cleaner than slash)', () => {
    const out = buildPageNarrative({
      title: 'Раздел',
      breadcrumb: ['Главная', 'Раздел', 'Подраздел'],
    }, 'ru');
    expect(out).toContain('Главная → Раздел → Подраздел');
  });

  test('falls back to a generic single-sentence description when nothing is known', () => {
    const out = buildPageNarrative({ title: 'Какая-то страница' }, 'ru');
    expect(out).toContain('страница');
    // Should always end with a period (well-formed sentence)
    expect(out.trim().endsWith('.')).toBe(true);
  });

  test('returns null/empty for completely empty inspection (caller decides fallback)', () => {
    expect(buildPageNarrative({}, 'ru')).toBeNull();
    expect(buildPageNarrative(null, 'ru')).toBeNull();
  });
});

describe('buildPageNarrative — language sanitisation', () => {
  test('drops component_kind_notes when it is English prose in RU mode', () => {
    const warnings = [];
    const out = buildPageNarrative({
      title: 'Главная',
      component_kind_notes: 'Public landing page with hero banner, CTA buttons and info blocks below.',
      top_buttons: [{ label: 'Вход' }, { label: 'Регистрация' }],
    }, 'ru', { warnings, file: 'guest/desktop/home.png' });
    // English spine must not survive.
    expect(out).not.toMatch(/Public landing/i);
    expect(out).not.toMatch(/hero banner/i);
    // Structured RU sentences do survive.
    expect(out).toContain('кнопки «Вход» и «Регистрация»');
    // Warning was recorded on drop.
    expect(warnings.some((w) => /language mismatch/i.test(w.message))).toBe(true);
  });

  test('keeps RU notes untouched and does not emit a warning', () => {
    const warnings = [];
    const out = buildPageNarrative({
      title: 'Главная',
      component_kind_notes: 'Публичная главная страница с баннером-героем и блоками информации.',
      top_buttons: [{ label: 'Вход' }],
    }, 'ru', { warnings });
    expect(out).toContain('Публичная главная страница');
    expect(warnings).toHaveLength(0);
  });

  test('drops RU notes when lang=en and records a warning', () => {
    const warnings = [];
    const out = buildPageNarrative({
      title: 'Home',
      component_kind_notes: 'Публичная главная страница с баннером-героем и блоками информации.',
      top_buttons: [{ label: 'Sign in' }],
    }, 'en', { warnings, file: 'x.png' });
    expect(out).not.toMatch(/Публичная/);
    expect(out).toContain('Sign in');
    expect(warnings.some((w) => /language mismatch/i.test(w.message))).toBe(true);
  });
});

describe('buildPageNarrative — en', () => {
  test('emits English text when lang === "en"', () => {
    const out = buildPageNarrative({
      title: 'Events',
      top_buttons: [{ label: 'Create event' }],
    }, 'en');
    expect(out).toContain('Create event');
    // Russian markers must NOT leak into English output
    expect(out).not.toMatch(/[а-яА-Я]/);
  });
});

describe('buildPageNarrative — does not emit English checklist artifacts', () => {
  test('output never contains "[V]" / "[ ]" markers or English field keys', () => {
    const out = buildPageNarrative({
      title: 'Профиль',
      breadcrumb: ['Главная', 'Профиль'],
      top_buttons: [{ label: 'Изменить' }],
      filters: [{ label: 'Дата' }],
      table: { columns: [{ name: 'A' }], has_pagination: true },
    }, 'ru');
    expect(out).not.toMatch(/\[V\]/);
    expect(out).not.toMatch(/\[ \]/);
    expect(out).not.toMatch(/\bbreadcrumb\b/);
    expect(out).not.toMatch(/\btop_buttons\b/);
    expect(out).not.toMatch(/\bfilters\b/);
    expect(out).not.toMatch(/\bcolumns\b/);
    expect(out).not.toMatch(/\brow_actions\b/);
  });
});
