'use strict';

const { extractSection, extractSectionAsBullets, listHeadings } = require('../skills/gostdocs/scripts/lib/research-extract');

const SAMPLE = [
  '# Документация',
  '## Обзор системы',
  '',
  'Система позволяет организовывать мероприятия.',
  '',
  '### Пользователи',
  '- Гость',
  '- Пользователь',
  '- Администратор',
  '',
  '## Архитектура',
  '',
  'Backend: PHP / Yii2. Frontend: Vue 3.',
  '',
  '## Развёртывание',
  '',
  'Docker Compose из 8 сервисов.',
  '',
].join('\n');

describe('listHeadings', () => {
  test('returns start/end line numbers for each heading', () => {
    const heads = listHeadings(SAMPLE);
    expect(heads.map((h) => [h.level, h.text])).toEqual([
      [1, 'Документация'],
      [2, 'Обзор системы'],
      [3, 'Пользователи'],
      [2, 'Архитектура'],
      [2, 'Развёртывание'],
    ]);
  });

  test('caps a section at the next same-or-shallower heading', () => {
    const heads = listHeadings(SAMPLE);
    const overview = heads.find((h) => h.text === 'Обзор системы');
    expect(overview.end).toBeLessThan(heads.find((h) => h.text === 'Архитектура').start + 1);
  });
});

describe('extractSection', () => {
  test('returns the body of a heading, trimmed', () => {
    expect(extractSection(SAMPLE, 'Архитектура')).toBe('Backend: PHP / Yii2. Frontend: Vue 3.');
  });

  test('case-insensitive match', () => {
    expect(extractSection(SAMPLE, 'архитектура')).toContain('Yii2');
  });

  test('yo/ye tolerance (ё ↔ е)', () => {
    expect(extractSection(SAMPLE, 'Развертывание')).toContain('Docker');
    expect(extractSection(SAMPLE, 'развёртывание')).toContain('Docker');
  });

  test('accepts an array of aliases', () => {
    expect(extractSection(SAMPLE, ['Overview', 'Обзор системы'])).toContain('Система');
  });

  test('returns null when no heading matches', () => {
    expect(extractSection(SAMPLE, 'No such section')).toBeNull();
  });

  test('respects maxWords cap with ellipsis', () => {
    const short = extractSection(SAMPLE, 'Обзор системы', { maxWords: 3 });
    expect(short.split(/\s+/)).toHaveLength(3);
    expect(short.endsWith('…')).toBe(true);
  });

  test('includes nested subsection content', () => {
    const body = extractSection(SAMPLE, 'Обзор системы');
    expect(body).toContain('### Пользователи');
    expect(body).toContain('- Гость');
  });
});

describe('extractSectionAsBullets', () => {
  test('parses a bulleted subsection', () => {
    expect(extractSectionAsBullets(SAMPLE, 'Пользователи')).toEqual(['Гость', 'Пользователь', 'Администратор']);
  });

  test('returns [] when the section has no bullets', () => {
    expect(extractSectionAsBullets(SAMPLE, 'Архитектура')).toEqual([]);
  });
});
