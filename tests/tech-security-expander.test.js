'use strict';

const { buildTechSecurity } = require('../skills/gostdocs/scripts/lib/tech-security-expander');

const EMPTY_SCAN = {
  deps_found: 0,
  authentication: {},
  password_hashing: {},
  authorization: {},
  network_security: {},
  data_protection: {},
  auditing: {},
  tls_hints: [],
  audit_tables: [],
};

describe('buildTechSecurity', () => {
  test('emits 5 subsections with defaults on an empty scan', () => {
    const sections = buildTechSecurity(EMPTY_SCAN, { lang: 'ru' });
    expect(sections.map((s) => s.heading)).toEqual([
      'Аутентификация',
      'Авторизация',
      'Защита данных',
      'Сетевая безопасность',
      'Журналирование событий безопасности',
    ]);
    for (const s of sections) {
      expect(s.level).toBe(2);
      expect(s.elements.length).toBeGreaterThan(0);
      expect(s.elements.every((e) => e.type === 'paragraph')).toBe(true);
    }
  });

  test('JWT + bcrypt detection replaces default narrative', () => {
    const sections = buildTechSecurity({
      ...EMPTY_SCAN,
      authentication: { jwt: ['jsonwebtoken'] },
      password_hashing: { bcrypt: ['bcrypt'] },
    }, { lang: 'ru' });
    const auth = sections.find((s) => s.heading === 'Аутентификация');
    const joined = auth.elements.map((e) => e.text).join(' ');
    expect(joined).toMatch(/JWT/);
    expect(joined).toMatch(/jsonwebtoken/);
    expect(joined).toMatch(/bcrypt/);
    expect(joined).not.toMatch(/подлежит уточнению/);
  });

  test('RBAC intro appears when authorization is detected', () => {
    const sections = buildTechSecurity({
      ...EMPTY_SCAN,
      authorization: { rbac: ['spatie/laravel-permission'] },
    }, { lang: 'ru' });
    const authz = sections.find((s) => s.heading === 'Авторизация');
    expect(authz.elements[0].text).toMatch(/RBAC/);
    expect(authz.elements.some((e) => /spatie\/laravel-permission/.test(e.text))).toBe(true);
  });

  test('network subsection lists helmet / cors / rate-limit', () => {
    const sections = buildTechSecurity({
      ...EMPTY_SCAN,
      network_security: {
        helmet: ['helmet'],
        cors: ['cors'],
        rate_limit: ['express-rate-limit'],
      },
    }, { lang: 'ru' });
    const net = sections.find((s) => s.heading === 'Сетевая безопасность');
    const text = net.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/Helmet/);
    expect(text).toMatch(/CORS/);
    expect(text).toMatch(/rate-limit/);
  });

  test('audit subsection surfaces detected tables and packages', () => {
    const sections = buildTechSecurity({
      ...EMPTY_SCAN,
      auditing: { table_name: ['audit_log'] },
      audit_tables: ['2024_create_audit_log.sql', '2024_create_action_logs.sql'],
    }, { lang: 'ru' });
    const audit = sections.find((s) => s.heading === 'Журналирование событий безопасности');
    const text = audit.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/journal|журнал/i);
    expect(text).toMatch(/2024_create_audit_log\.sql/);
  });

  test('English mode emits English headings and defaults', () => {
    const sections = buildTechSecurity(EMPTY_SCAN, { lang: 'en' });
    expect(sections.map((s) => s.heading)).toEqual([
      'Authentication',
      'Authorisation',
      'Data protection',
      'Network security',
      'Security event logging',
    ]);
    expect(sections[0].elements[0].text).toMatch(/to be confirmed/);
  });

  test('security_facts.auth overrides the default narrative with concrete data', () => {
    const sections = buildTechSecurity(EMPTY_SCAN, {
      lang: 'ru',
      facts: {
        auth: {
          scheme: 'JWT (Bearer)',
          notes: 'access 1h + refresh 30d',
          parameters: { access_ttl: '1h', refresh_ttl: '30d' },
        },
        password_policy: { algorithm: 'bcrypt', cost: 12, min_length: 10 },
      },
    });
    const auth = sections.find((s) => s.heading === 'Аутентификация');
    const text = auth.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/JWT \(Bearer\)/);
    expect(text).toMatch(/access_ttl=1h/);
    expect(text).toMatch(/bcrypt/);
    expect(text).toMatch(/cost factor 12/);
    expect(text).not.toMatch(/реализована средствами фреймворка приложения: при входе/);
  });

  test('security_facts.rbac overrides authz default with concrete role list', () => {
    const sections = buildTechSecurity(EMPTY_SCAN, {
      lang: 'ru',
      facts: {
        rbac: { model: 'RBAC', roles: ['admin', 'user', 'guest'], permissions_count: 47 },
      },
    });
    const authz = sections.find((s) => s.heading === 'Авторизация');
    const text = authz.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/RBAC/);
    expect(text).toMatch(/admin, user, guest/);
    expect(text).toMatch(/разрешений — 47/);
  });

  test('security_facts.audit_log with disabled flag emits a factual "not deployed" line', () => {
    const sections = buildTechSecurity(EMPTY_SCAN, {
      lang: 'ru',
      facts: { audit_log: { enabled: false } },
    });
    const audit = sections.find((s) => s.heading === 'Журналирование событий безопасности');
    const text = audit.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/не развёрнут/);
  });
});
