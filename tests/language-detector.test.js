'use strict';

const { detect, matchesTargetLanguage } = require('../skills/gen-docs/scripts/lib/language-detector');

describe('detect', () => {
  test('pure Cyrillic text returns dominant=cyrillic', () => {
    const info = detect('Это полностью русское предложение для проверки детектора.');
    expect(info.dominant).toBe('cyrillic');
    expect(info.cyrillic).toBeGreaterThan(info.latin);
  });

  test('pure Latin text returns dominant=latin', () => {
    const info = detect('This is an entirely English sentence for the detector test.');
    expect(info.dominant).toBe('latin');
    expect(info.latin).toBeGreaterThan(info.cyrillic);
  });

  test('mixed text returns dominant=mixed', () => {
    const info = detect('Public landing page с баннером и кнопками CTA.');
    expect(info.dominant).toBe('mixed');
  });

  test('empty or non-string input returns dominant=none', () => {
    expect(detect('').dominant).toBe('none');
    expect(detect(null).dominant).toBe('none');
    expect(detect(undefined).dominant).toBe('none');
    expect(detect(42).dominant).toBe('none');
  });
});

describe('matchesTargetLanguage', () => {
  test('accepts a Russian paragraph when target=ru', () => {
    expect(matchesTargetLanguage(
      'Публичная главная страница с баннером-героем и кнопками регистрации.',
      'ru',
    )).toBe(true);
  });

  test('rejects an English paragraph when target=ru', () => {
    expect(matchesTargetLanguage(
      'Public landing page with a hero banner and call-to-action buttons.',
      'ru',
    )).toBe(false);
  });

  test('accepts an English paragraph when target=en', () => {
    expect(matchesTargetLanguage(
      'Public landing page with a hero banner and call-to-action buttons.',
      'en',
    )).toBe(true);
  });

  test('is tolerant to short strings (< 10 letters)', () => {
    expect(matchesTargetLanguage('CTA', 'ru')).toBe(true);
    expect(matchesTargetLanguage('API', 'ru')).toBe(true);
  });

  test('threshold can be tightened', () => {
    const mixed = 'Публичная landing page hero banner with CTA buttons';
    expect(matchesTargetLanguage(mixed, 'ru', 0.2)).toBe(true);
    expect(matchesTargetLanguage(mixed, 'ru', 0.8)).toBe(false);
  });
});
