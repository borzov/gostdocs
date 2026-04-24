'use strict';

/**
 * Render the five GOST security subsections for a technical description
 * from a security-scan.scanSecurity() result. The expander is invoked by
 * generate.js via `<!-- GEN:tech-security headingLevel="2" -->`.
 *
 * For each subsection we mix three content sources, in order:
 *   1. Detected evidence (library name, middleware, audit table name).
 *   2. A short narrative sentence describing what the evidence means.
 *   3. A placeholder line when nothing was detected — so the reader sees
 *      "данные не обнаружены, уточнить при аудите" instead of a blank.
 *
 * Output is an array of Doc-Model subsection objects returned as
 * `{ kind: 'section', section }` entries by the caller — see
 * generate.js buildExpanders() for how they are spliced into the
 * surrounding "# Безопасность" section.
 */

const STRINGS = {
  ru: {
    auth_title:     'Аутентификация',
    authz_title:    'Авторизация',
    data_title:     'Защита данных',
    network_title:  'Сетевая безопасность',
    audit_title:    'Журналирование событий безопасности',
    auth_default:   'Аутентификация реализована средствами фреймворка приложения: при входе пользователь предъявляет учётные данные, которые сервер проверяет по хранилищу идентификационной информации и выдаёт в ответ идентификатор сессии или токен доступа. Конкретный механизм (форма + серверная сессия, JWT, OAuth2, SSO) и параметры срока действия токена подлежат уточнению при аудите кода и согласовании с политикой безопасности оператора системы.',
    authz_default:  'Авторизация реализована средствами фреймворка и выполняется на каждом защищённом эндпоинте после успешной аутентификации. Проверка прав доступа построена на модели ролей и разрешений, закреплённых за учётной записью пользователя. Выбор конкретной модели (RBAC, ACL или ABAC) и распределение ответственности между слоями приложения подлежат уточнению при аудите кода.',
    data_default:   'Передача данных между клиентом и сервером защищена протоколом TLS (HTTPS). Пароли пользователей хранятся в виде криптографических хешей — восстановление исходного пароля из хеша невозможно. Чувствительные параметры конфигурации (секреты подключения к БД, ключи внешних API) вынесены из исходного кода и передаются через переменные окружения или централизованное хранилище секретов. Алгоритмы шифрования на уровне хранилища и требования к защите резервных копий подлежат уточнению при аудите инфраструктуры.',
    network_default:'Сетевая защита строится на уровне reverse-proxy и средств фреймворка. На входе в приложение применяются заголовки безопасности (Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options), контроль источников запросов (CORS) и ограничение частоты вызовов (rate limiting) для противодействия перебору учётных данных. Защита от подделки межсайтовых запросов (CSRF) настраивается для изменяющих состояние операций. Конкретные пороги и списки разрешённых источников определяются при аудите конфигурации.',
    audit_default:  'Журнал событий безопасности фиксирует действия, меняющие состояние системы: успешные и неуспешные попытки аутентификации, изменения настроек, операции над пользователями и ролями, экспорт данных. Запись в журнал содержит идентификатор пользователя, время события, исходный IP-адрес и тип операции, что позволяет расследовать инциденты и соответствовать требованиям регуляторов. Конкретные таблицы, срок хранения журнала и механизмы выгрузки подлежат уточнению при аудите кода и согласованию с оператором системы.',
    detected:       'Технологии и библиотеки:',
    audit_tables:   'Миграции журнала:',
    tls_hints:      'Инфраструктурные индикаторы TLS:',
    auth_intro: {
      jwt:       'Аутентификация выполняется по JWT-токену, передаваемому в заголовке Authorization как Bearer-токен.',
      session:   'Используется серверный механизм сессий: идентификатор сессии хранится в cookie, данные — на стороне сервера.',
      laravel:   'Применяются пакеты Laravel-экосистемы для аутентификации (Sanctum / Passport / JWT-Auth).',
      framework: 'Используются встроенные средства аутентификации фреймворка.',
      oauth2:    'Внешняя аутентификация строится на OAuth2 / OpenID Connect.',
      ldap:      'Реализована интеграция с каталогом LDAP / Active Directory.',
      sso:       'Поддерживается единый вход (SSO).',
    },
    authz_intro: {
      rbac:    'Авторизация выполняется централизованно по модели ролей и разрешений (RBAC).',
      policies:'Проверка прав основана на политиках (policy-based): CASL, Oso и аналогичные инструменты.',
    },
    network_intro: {
      helmet:        'Подключены HTTP-защитные заголовки (Helmet).',
      cors:          'Настроен CORS-контроль источников запросов.',
      csrf:          'Подключена защита от CSRF-атак.',
      rate_limit:    'Настроено ограничение частоты запросов (rate-limit).',
      csp:           'Используется Content-Security-Policy.',
      secure_cookies:'Cookies сессий помечены флагами HttpOnly / Secure / SameSite.',
    },
    data_intro: {
      tls:    'Транспорт защищён TLS / HTTPS — соответствующие настройки присутствуют в конфигурации и зависимостях.',
      secrets:'Секреты управляются специализированными инструментами (dotenv / Vault / SOPS или аналогичные).',
      crypto: 'Для работы с чувствительными данными применяются криптографические библиотеки.',
    },
    password_intro: {
      bcrypt: 'Пароли хешируются алгоритмом bcrypt.',
      argon2: 'Пароли хешируются алгоритмом argon2.',
      scrypt: 'Пароли хешируются алгоритмом scrypt.',
      pbkdf2: 'Пароли хешируются алгоритмом PBKDF2.',
    },
    audit_intro: {
      table_name: 'Операции, изменяющие состояние системы, фиксируются в отдельной таблице журнала действий (audit-log).',
      model:      'Для журнала активности пользователей используются специализированные пакеты (activity-log / audit-log).',
    },
  },
  en: {
    auth_title:     'Authentication',
    authz_title:    'Authorisation',
    data_title:     'Data protection',
    network_title:  'Network security',
    audit_title:    'Security event logging',
    auth_default:   'Authentication is implemented by the application framework. The specific mechanism is to be confirmed during code review.',
    authz_default:  'Authorisation is implemented by the framework; the specific model (RBAC/ACL/ABAC) is to be confirmed during code review.',
    data_default:   'Data is transported over HTTPS; secret storage and at-rest encryption are to be confirmed during infrastructure review.',
    network_default:'Network defences rely on the reverse proxy and framework; specific measures are to be confirmed during configuration review.',
    audit_default:  'The security event log must be configured according to operator policy; specific tables and mechanisms are to be confirmed during code review.',
    detected:       'Detected technologies and libraries:',
    audit_tables:   'Detected audit-log migrations:',
    tls_hints:      'Infrastructure TLS hints:',
    auth_intro: {
      jwt:       'A JWT library is present; bearer tokens are carried in the Authorization header.',
      session:   'Server-side session middleware is present; clients receive a session cookie.',
      laravel:   'Laravel authentication packages detected (Sanctum / Passport / JWT-Auth).',
      framework: 'Framework-native authentication is in use.',
      oauth2:    'OAuth2 / OpenID Connect libraries detected for external authentication.',
      ldap:      'LDAP / Active Directory integration detected.',
      sso:       'Single sign-on tooling detected.',
    },
    authz_intro: {
      rbac:     'RBAC libraries detected: role and permission checks are centralised.',
      policies: 'Policy-based authorisation packages detected (CASL, Oso, and similar).',
    },
    network_intro: {
      helmet:         'HTTP security headers are applied (Helmet).',
      cors:           'CORS origin control is configured.',
      csrf:           'CSRF protection middleware is enabled.',
      rate_limit:     'Rate limiting is configured.',
      csp:            'Content-Security-Policy is configured.',
      secure_cookies: 'Session cookies are marked HttpOnly / Secure / SameSite.',
    },
    data_intro: {
      tls:     'TLS / HTTPS detected in configuration or dependencies.',
      secrets: 'Secret-management tools detected (dotenv / Vault / SOPS and similar).',
      crypto:  'Cryptographic libraries detected for user data.',
    },
    password_intro: {
      bcrypt: 'Passwords are hashed with bcrypt.',
      argon2: 'Passwords are hashed with argon2.',
      scrypt: 'Passwords are hashed with scrypt.',
      pbkdf2: 'Passwords are hashed with PBKDF2.',
    },
    audit_intro: {
      table_name: 'Audit-log / action-log migrations detected — state-changing operations are recorded in a dedicated table.',
      model:      'Activity-log / audit-log packages detected.',
    },
  },
};

function pickLang(lang) {
  return lang === 'en' ? 'en' : 'ru';
}

function slugify(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function sectionOf(heading, level, elements) {
  return {
    heading,
    level,
    slug: slugify(`security-${heading}`),
    elements,
    children: [],
  };
}

function mergeIntroWithLibs(intro, libs) {
  const clean = (libs || []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  if (clean.length === 0) return intro;
  const trimmed = intro.replace(/\s*[.;]?\s*$/, '');
  return `${trimmed} (${clean.join(', ')}).`;
}

function buildFromMap(scanMap, introMap, tail) {
  const intros = [];
  for (const [k, v] of Object.entries(scanMap || {})) {
    const intro = introMap[k];
    if (intro) {
      intros.push({ type: 'paragraph', text: mergeIntroWithLibs(intro, v) });
    } else if (Array.isArray(v) && v.length > 0) {
      tail.push({ type: 'paragraph', text: `${v.join(', ')}.` });
    }
  }
  return intros;
}

function buildAuth(scan, t) {
  const tail = [];
  const authIntros = buildFromMap(scan.authentication, t.auth_intro, tail);
  const pwIntros = buildFromMap(scan.password_hashing, t.password_intro, tail);
  const intros = [...authIntros, ...pwIntros];
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.auth_default }];
  }
  return [...intros, ...tail];
}

function buildAuthz(scan, t) {
  const tail = [];
  const intros = buildFromMap(scan.authorization, t.authz_intro, tail);
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.authz_default }];
  }
  return [...intros, ...tail];
}

function buildDataProtection(scan, t) {
  const tail = [];
  const intros = buildFromMap(scan.data_protection, t.data_intro, tail);
  if ((scan.tls_hints || []).length > 0) {
    tail.push({ type: 'paragraph', text: `${t.tls_hints} ${scan.tls_hints.join(', ')}.` });
  }
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.data_default }];
  }
  return [...intros, ...tail];
}

function buildNetwork(scan, t) {
  const tail = [];
  const intros = buildFromMap(scan.network_security, t.network_intro, tail);
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.network_default }];
  }
  return [...intros, ...tail];
}

function buildAudit(scan, t) {
  const tail = [];
  const intros = buildFromMap(scan.auditing, t.audit_intro, tail);
  if ((scan.audit_tables || []).length > 0) {
    tail.push({ type: 'paragraph', text: `${t.audit_tables} ${scan.audit_tables.slice(0, 5).join('; ')}.` });
  }
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.audit_default }];
  }
  return [...intros, ...tail];
}

/**
 * Build an array of 5 H2-level sections that together describe the
 * technical security posture of the project.
 *
 * @param {ReturnType<import('./security-scan').scanSecurity>} scan
 * @param {{ lang?: 'ru'|'en', headingLevel?: number }} [opts]
 * @returns {Array<object>}
 */
function buildTechSecurity(scan, opts = {}) {
  const t = STRINGS[pickLang(opts.lang)];
  const level = Number(opts.headingLevel) > 0 ? Number(opts.headingLevel) : 2;
  return [
    sectionOf(t.auth_title,    level, buildAuth(scan,            t)),
    sectionOf(t.authz_title,   level, buildAuthz(scan,           t)),
    sectionOf(t.data_title,    level, buildDataProtection(scan,  t)),
    sectionOf(t.network_title, level, buildNetwork(scan,         t)),
    sectionOf(t.audit_title,   level, buildAudit(scan,           t)),
  ];
}

module.exports = {
  buildTechSecurity,
  STRINGS,
};
