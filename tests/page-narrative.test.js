'use strict';

const { buildPageNarrative } = require('../skills/gen-docs/scripts/lib/page-narrative');

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

  test('assembles a sentence from top_buttons and filters when notes are empty', () => {
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
    expect(out).toContain('Доступные действия: «Создать мероприятие», «Импорт».');
    expect(out).toContain('Можно отфильтровать список по полям: «Категория», «Статус».');
    expect(out).toContain('колонки');
    expect(out).toContain('«Название»');
  });

  test('mentions modal windows and empty state when present', () => {
    const out = buildPageNarrative({
      title: 'Отчёты',
      modals_visible: [{ title: 'Подтверждение удаления' }],
      is_empty_state: true,
    }, 'ru');
    expect(out).toContain('пустого состояния');
    expect(out).toContain('Подтверждение удаления');
  });

  test('detects a login form and produces a focused single sentence', () => {
    const out = buildPageNarrative({
      title: 'Вход',
      is_login_form: true,
    }, 'ru');
    expect(out).toMatch(/форма входа/i);
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
