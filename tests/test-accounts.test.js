'use strict';

const { buildTestAccounts, deriveLoginUrl } = require('../skills/gostdocs/scripts/lib/test-accounts');

function metaWithRoles(...roles) {
  return {
    app: { url: 'http://localhost:5173' },
    auth: {
      api_login: { url: '/api/auth/login' },
      roles,
    },
  };
}

describe('deriveLoginUrl', () => {
  test('resolves role-level login_url against meta.app.url', () => {
    const meta = metaWithRoles({ role: 'admin' });
    const url = deriveLoginUrl(meta, { role: 'admin', login_url: '/admin/login' });
    expect(url).toBe('http://localhost:5173/admin/login');
  });

  test('accepts legacy login_form_url as an alias', () => {
    const meta = metaWithRoles({ role: 'admin' });
    expect(deriveLoginUrl(meta, { role: 'admin', login_form_url: '/admin/login' }))
      .toBe('http://localhost:5173/admin/login');
  });

  test('falls back to meta.auth.api_login.url when role has none', () => {
    const meta = metaWithRoles({ role: 'admin' });
    expect(deriveLoginUrl(meta, { role: 'admin' })).toBe('http://localhost:5173/api/auth/login');
  });

  test('returns /login when neither path is defined', () => {
    const meta = { app: { url: 'http://localhost:5173' }, auth: { roles: [] } };
    expect(deriveLoginUrl(meta, { role: 'admin' })).toBe('http://localhost:5173/login');
  });
});

describe('buildTestAccounts', () => {
  test('renders a table using flat username/password fields', () => {
    const meta = metaWithRoles(
      { role: 'admin', username: 'admin@ex.com', password: 'Sekret123' },
      { role: 'user',  username: 'user@ex.com',  password: 'User123' },
    );
    const [table] = buildTestAccounts({ meta }, { lang: 'ru' });
    expect(table.type).toBe('table');
    expect(table.headers).toEqual(['Роль', 'Наименование', 'URL входа', 'Логин', 'Пароль']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual([
      'admin', 'Администратор', 'http://localhost:5173/api/auth/login', 'admin@ex.com', 'Sekret123',
    ]);
    expect(table.rows[1][3]).toBe('user@ex.com');
  });

  test('still accepts legacy nested credentials object', () => {
    const meta = metaWithRoles(
      { role: 'admin', credentials: { username: 'a', password: 'b' } },
    );
    const [table] = buildTestAccounts({ meta });
    expect(table.rows[0][3]).toBe('a');
    expect(table.rows[0][4]).toBe('b');
  });

  test('redacts passwords when includePasswords=false', () => {
    const meta = metaWithRoles(
      { role: 'admin', username: 'admin', password: 'Sekret' },
    );
    const [table] = buildTestAccounts({ meta }, { includePasswords: false });
    expect(table.rows[0][4]).toBe('●●●●●●●●');
  });

  test('skips guest roles and roles without any credentials', () => {
    const meta = metaWithRoles(
      { role: 'guest' },
      { role: 'user', username: 'u', password: 'p' },
      { role: 'operator' },
    );
    const [table] = buildTestAccounts({ meta });
    expect(table.rows.map((r) => r[0])).toEqual(['user']);
  });

  test('emits a TODO admonition when no real accounts are declared', () => {
    const meta = metaWithRoles({ role: 'guest' });
    const out = buildTestAccounts({ meta });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('admonition');
    expect(out[0].kind).toBe('todo');
  });
});
