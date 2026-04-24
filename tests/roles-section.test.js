'use strict';

const rolesSection = require('../skills/gostdocs/scripts/lib/roles-section');

describe('labelFor', () => {
  test('uses the localized label for known slugs', () => {
    expect(rolesSection.labelFor('admin', 'ru')).toBe('Администратор');
    expect(rolesSection.labelFor('guest', 'ru')).toBe('Неавторизованный посетитель');
    expect(rolesSection.labelFor('admin', 'en')).toBe('Administrator');
  });

  test('capitalises unknown slugs gracefully', () => {
    expect(rolesSection.labelFor('custom_role', 'ru')).toBe('Custom role');
    expect(rolesSection.labelFor('', 'ru')).toBe('');
  });
});

describe('parseRoleDiscoveryTable', () => {
  test('extracts (role, description) rows from the role-discovery markdown', () => {
    const md = [
      '# Роли',
      '',
      '| Роль | Источник | Комментарий |',
      '|------|----------|-----------|',
      '| admin | RoleSeeder.php | Администратор |',
      '| moderator | RoleSeeder.php | Модератор контента |',
      '',
      'Текст после таблицы игнорируется.',
    ].join('\n');
    const parsed = rolesSection.parseRoleDiscoveryTable(md);
    expect(parsed.get('admin')).toEqual({ description: 'Администратор' });
    expect(parsed.get('moderator')).toEqual({ description: 'Модератор контента' });
  });

  test('returns empty map when no role table is present', () => {
    const parsed = rolesSection.parseRoleDiscoveryTable('# Нет таблицы');
    expect(parsed.size).toBe(0);
  });

  test('handles English header', () => {
    const md = [
      '| Role | Source | Comment |',
      '|------|--------|---------|',
      '| admin | seeder | Administrator |',
    ].join('\n');
    const parsed = rolesSection.parseRoleDiscoveryTable(md);
    expect(parsed.get('admin')).toEqual({ description: 'Administrator' });
  });
});

describe('buildRolesSections', () => {
  const meta = {
    auth: {
      roles: [
        { role: 'guest' },
        { role: 'user' },
        { role: 'admin' },
        { role: 'guest-only' },   // synthetic — must be skipped
      ],
    },
  };

  test('emits one section per real role using localized labels', () => {
    const sections = rolesSection.buildRolesSections(meta, '', { lang: 'ru', headingLevel: 3 });
    expect(sections.map((s) => s.heading)).toEqual([
      'Неавторизованный посетитель',
      'Пользователь',
      'Администратор',
    ]);
    expect(sections.every((s) => s.level === 3)).toBe(true);
    expect(sections.every((s) => s.slug.startsWith('role-'))).toBe(true);
  });

  test('inserts research description when role-discovery provides one', () => {
    const md = [
      '| Роль | Источник | Комментарий |',
      '|------|----------|-------------|',
      '| admin | seeder.php | Администратор с полным доступом |',
    ].join('\n');
    const sections = rolesSection.buildRolesSections(meta, md, { lang: 'ru' });
    const admin = sections.find((s) => s.heading === 'Администратор');
    const firstParagraph = admin.elements.find((e) => e.type === 'paragraph');
    expect(firstParagraph.text).toBe('Администратор с полным доступом');
  });

  test('emits placeholder paragraphs when research is empty', () => {
    const sections = rolesSection.buildRolesSections(meta, '', { lang: 'ru' });
    const user = sections.find((s) => s.heading === 'Пользователь');
    const texts = user.elements.map((e) => e.text);
    expect(texts.some((t) => /Виды деятельности/.test(t))).toBe(true);
    expect(texts.some((t) => /подлежит уточнению/i.test(t))).toBe(true);
  });

  test('English mode produces English strings', () => {
    const sections = rolesSection.buildRolesSections(meta, '', { lang: 'en' });
    const admin = sections.find((s) => s.heading === 'Administrator');
    expect(admin.elements.some((e) => /Activities/.test(e.text))).toBe(true);
    expect(admin.elements.some((e) => /to be confirmed/.test(e.text))).toBe(true);
  });

  test('returns empty array when no roles are configured', () => {
    const out = rolesSection.buildRolesSections({ auth: { roles: [] } }, '');
    expect(out).toEqual([]);
  });
});
