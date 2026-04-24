'use strict';

const tn = require('../skills/gostdocs/scripts/lib/title-normalizer');

describe('looksLikeBadTitle', () => {
  test.each([
    [null, true],
    [undefined, true],
    ['', true],
    ['ab', true],
    ['event-detail', true],
    ['admin_queue', true],
    ['login', true],
    ['Подтверждение email', false],
    ['Event Management System', false],
    ['  Список мероприятий  ', false],
  ])('%s -> %s', (input, expected) => {
    expect(tn.looksLikeBadTitle(input)).toBe(expected);
  });
});

describe('isAcceptableRussianTitle', () => {
  test('accepts capitalised Russian phrases', () => {
    expect(tn.isAcceptableRussianTitle('Список мероприятий')).toBe(true);
    expect(tn.isAcceptableRussianTitle('Карточка мероприятия «Конференция»')).toBe(true);
    expect(tn.isAcceptableRussianTitle('Редактирование шаблона — /templates/42')).toBe(true);
  });

  test('rejects ASCII-only or lowercase titles', () => {
    expect(tn.isAcceptableRussianTitle('event detail')).toBe(false);
    expect(tn.isAcceptableRussianTitle('admin panel')).toBe(false);
    expect(tn.isAcceptableRussianTitle('event-detail')).toBe(false);
  });
});

describe('fallbackTitleFromId', () => {
  test('translates known single-word slugs', () => {
    expect(tn.fallbackTitleFromId('users')).toBe('Пользователи');
    expect(tn.fallbackTitleFromId('admin')).toBe('Администрирование');
    expect(tn.fallbackTitleFromId('login')).toBe('Вход');
  });

  test('translates multi-word slugs via dictionary join', () => {
    expect(tn.fallbackTitleFromId('admin-queue')).toBe('Администрирование Очередь');
    expect(tn.fallbackTitleFromId('event-detail')).toBe('Мероприятие Карточка');
    expect(tn.fallbackTitleFromId('certificates/new')).toBe('Сертификаты Создание');
  });

  test('drops numeric id segments', () => {
    expect(tn.fallbackTitleFromId('events/42/edit')).toBe('Мероприятия Редактирование');
  });

  test('capitalises unknown tokens instead of passing them through lowercase', () => {
    const out = tn.fallbackTitleFromId('widgets-gizmos');
    expect(out).toBe('Widgets Gizmos');
  });

  test('returns null for empty id', () => {
    expect(tn.fallbackTitleFromId('')).toBeNull();
    expect(tn.fallbackTitleFromId(null)).toBeNull();
  });

  test('English lang mode returns capitalised tokens (no translation)', () => {
    expect(tn.fallbackTitleFromId('admin-queue', 'en')).toBe('Admin Queue');
    expect(tn.fallbackTitleFromId('users', 'en')).toBe('Users');
  });
});

describe('resolveDisplayTitle', () => {
  test('prefers a good Russian title from the agent', () => {
    const out = tn.resolveDisplayTitle('Список мероприятий', 'events');
    expect(out).toEqual({ title: 'Список мероприятий', source: 'agent' });
  });

  test('falls back to id translation when agent title is bad', () => {
    const out = tn.resolveDisplayTitle('event-detail', 'event-detail');
    expect(out.source).toBe('fallback');
    expect(out.title).toMatch(/Мероприятие/);
  });

  test('returns none when both are unusable', () => {
    const out = tn.resolveDisplayTitle(null, '');
    expect(out).toEqual({ title: null, source: 'none' });
  });
});
