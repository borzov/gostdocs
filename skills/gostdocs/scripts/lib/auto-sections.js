'use strict';

/**
 * Auto-derived document sections powered by observed project state.
 * See individual builder JSDoc for inputs and failure modes.
 */

const fs = require('fs');
const path = require('path');

function todoAdmonition(text) {
  return [{ type: 'admonition', kind: 'todo', text }];
}

function paragraph(text) {
  return { type: 'paragraph', text };
}

function bulletList(items) {
  const lines = items.filter(Boolean).map((s) => `- ${String(s).trim()}`);
  return { type: 'raw', format: 'markdown', content: `${lines.join('\n')}\n` };
}

function safeReadDirSync(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pluralizeRu(count, singular, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return singular;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const EXT_POINT_DIRS = new Set([
  'adapters', 'plugins', 'modules', 'extensions', 'hooks',
  'listeners', 'subscribers', 'observers', 'providers', 'handlers',
  'middleware', 'middlewares', 'strategies', 'drivers', 'integrations',
]);

const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', '.git', '.github', 'dist', 'build', 'tmp',
  'cache', 'runtime', 'logs', 'storage', 'coverage', '.next', '.nuxt',
  'public', 'static', 'assets', 'docs',
]);

function findExtensionPoints(projectPath) {
  const hits = [];
  const rootEntries = safeReadDirSync(projectPath);
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (EXT_POINT_DIRS.has(lower)) {
      hits.push({
        rel: entry.name,
        kind: lower,
        children: safeReadDirSync(path.join(projectPath, entry.name)).filter((e) => !e.name.startsWith('.')).length,
      });
    }
    const sub = safeReadDirSync(path.join(projectPath, entry.name));
    for (const s of sub) {
      if (!s.isDirectory()) continue;
      const slower = s.name.toLowerCase();
      if (!EXT_POINT_DIRS.has(slower)) continue;
      hits.push({
        rel: `${entry.name}/${s.name}`,
        kind: slower,
        children: safeReadDirSync(path.join(projectPath, entry.name, s.name)).filter((e) => !e.name.startsWith('.')).length,
      });
    }
  }
  return hits;
}

function buildExtensionPoints(ctx, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const hits = findExtensionPoints(ctx.projectPath);
  if (hits.length === 0) {
    return todoAdmonition(lang === 'en'
      ? 'No conventional extension-point directories (adapters/, plugins/, modules/, …) were detected. If the system supports extension through another mechanism, describe it manually.'
      : 'Общепринятых директорий точек расширения (adapters/, plugins/, modules/ и т. п.) в проекте не обнаружено. Если система поддерживает расширение через иной механизм, опишите его вручную.');
  }
  const heading = lang === 'en'
    ? 'The project exposes the following extension points in its source tree:'
    : 'Исходное дерево проекта содержит следующие точки расширения:';
  const items = hits.map((h) => {
    const countWord = lang === 'en'
      ? `${h.children} item${h.children === 1 ? '' : 's'}`
      : `${h.children} ${pluralizeRu(h.children, 'элемент', 'элемента', 'элементов')}`;
    return `\`${h.rel}/\` — ${h.kind} (${countWord})`;
  });
  return [paragraph(heading), bulletList(items)];
}

function buildDistributionComposition(ctx, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const introspect = ctx.introspect || {};
  const services = Array.isArray(introspect.services) ? introspect.services : [];
  const env = introspect.env || {};
  const envKeys = Array.isArray(env.keys) ? env.keys : (env.vars ? Object.keys(env.vars) : []);
  const envSource = env.source || null;
  const derived = introspect.derived || {};
  const parts = [];

  if (services.length > 0) {
    parts.push(lang === 'en'
      ? `The docker-compose file declares ${services.length} service(s): ${services.join(', ')}.`
      : `Файл docker-compose.yml содержит ${services.length} ${pluralizeRu(services.length, 'сервис', 'сервиса', 'сервисов')}: ${services.join(', ')}.`);
  }
  if (envKeys.length > 0 && envSource) {
    parts.push(lang === 'en'
      ? `Template ${envSource} declares ${envKeys.length} configuration variable(s); copy it to .env before first launch.`
      : `Шаблон ${envSource} содержит ${envKeys.length} ${pluralizeRu(envKeys.length, 'переменную конфигурации', 'переменные конфигурации', 'переменных конфигурации')}; перед первым запуском скопируйте его в файл .env.`);
  }
  if (derived.migration_command) {
    parts.push(lang === 'en'
      ? `Schema migration command: \`${derived.migration_command}\`.`
      : `Команда миграции схемы: \`${derived.migration_command}\`.`);
  }
  if (derived.seed_command) {
    parts.push(lang === 'en'
      ? `Demo-data seeder: \`${derived.seed_command}\`.`
      : `Заполнение демонстрационными данными: \`${derived.seed_command}\`.`);
  }
  if (derived.repo_url) {
    parts.push(lang === 'en'
      ? `Source repository: ${derived.repo_url}.`
      : `Репозиторий исходного кода: ${derived.repo_url}.`);
  }
  if (parts.length === 0) {
    return todoAdmonition(lang === 'en'
      ? 'No docker-compose, env template, Makefile or git remote was detected — describe the distribution composition manually.'
      : 'Не обнаружено ни docker-compose, ни шаблона переменных окружения, ни Makefile, ни git-remote — опишите состав дистрибутива вручную.');
  }
  return [paragraph(parts.join(' '))];
}

function buildSmokeScenarios(ctx, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const meta = ctx.meta || {};
  const roles = (meta.auth && Array.isArray(meta.auth.roles)) ? meta.auth.roles : [];
  const pages = Array.isArray(meta.pages) ? meta.pages : [];
  const appUrl = meta.app && meta.app.url;

  const testable = roles.filter((r) => r && r.role
    && r.role !== 'guest' && r.role !== 'guest-only'
    && r.username && r.password);
  if (testable.length === 0) {
    return todoAdmonition(lang === 'en'
      ? 'No roles with declared credentials were found in meta.auth.roles — add smoke scenarios manually.'
      : 'В meta.auth.roles не объявлено ролей с логинами и паролями — добавьте сценарии проверки вручную.');
  }
  const out = [];
  for (const role of testable) {
    const rolePages = pages.filter((p) => p && (p.access_role === role.role || !p.access_role)).slice(0, 3);
    const list = [];
    list.push(lang === 'en'
      ? `Open ${appUrl || 'the application URL'} and log in as **${role.role}** (${role.username}).`
      : `Откройте адрес ${appUrl || 'приложения'} и выполните вход под ролью **${role.role}** (${role.username}).`);
    if (rolePages.length > 0) {
      for (const page of rolePages) {
        list.push(lang === 'en'
          ? `Navigate to \`${page.path}\`${page.title ? ` (${page.title})` : ''} and verify the page renders without errors.`
          : `Перейдите на страницу \`${page.path}\`${page.title ? ` (${page.title})` : ''} и убедитесь, что она отображается без ошибок.`);
      }
    } else {
      list.push(lang === 'en'
        ? 'Navigate through the main menu and open each primary section.'
        : 'Пройдите по основному меню и откройте каждый ключевой раздел.');
    }
    list.push(lang === 'en'
      ? 'Log out and verify the session is terminated.'
      : 'Выйдите из системы и убедитесь, что сеанс завершён.');
    out.push(paragraph(lang === 'en'
      ? `**Scenario for the ${role.role} role.**`
      : `**Сценарий для роли ${role.role}.**`));
    out.push(bulletList(list));
  }
  return out;
}

const ISSUE_TEMPLATES_RU = {
  db: [
    { symptom: 'Приложение падает при старте с ошибкой соединения с БД.',
      cause: 'Контейнер базы данных ещё инициализируется (первый запуск).',
      fix: 'Дождитесь сообщения `database system is ready to accept connections` в логах сервиса БД и перезапустите сервис приложения командой `docker compose restart backend`.' },
  ],
  postgres: 'db',
  postgresql: 'db',
  mysql: 'db',
  mariadb: 'db',
  redis: [
    { symptom: 'Страницы грузятся медленно, в логах приложения предупреждения о Redis.',
      cause: 'Контейнер Redis не поднялся или занят порт 6379.',
      fix: 'Проверьте `docker compose ps redis`. Если сервис не запущен — освободите порт 6379 на хосте или измените маппинг порта в docker-compose.yml.' },
  ],
  cache: 'redis',
  memcached: 'redis',
  nginx: [
    { symptom: 'По адресу приложения открывается страница 502 Bad Gateway.',
      cause: 'nginx поднялся раньше backend-сервиса.',
      fix: 'Подождите 30–60 секунд и обновите страницу; при повторении выполните `docker compose restart nginx`.' },
  ],
  backend: [
    { symptom: 'Интерфейс открывается, но API возвращает 500 по всем запросам.',
      cause: 'Миграции БД не применены или отсутствует обязательная переменная окружения.',
      fix: 'Запустите команду миграции из раздела «Процедура развёртывания» и проверьте файл .env на наличие всех ключей из .env.example.' },
  ],
  worker: [
    { symptom: 'Фоновые задачи (отправка email, генерация сертификатов) не выполняются.',
      cause: 'Контейнер worker не поднялся или очередь заблокирована.',
      fix: 'Проверьте `docker compose logs worker` и при необходимости перезапустите сервис командой `docker compose restart worker`.' },
  ],
};

function resolveIssueTemplate(serviceName) {
  const name = String(serviceName || '').toLowerCase();
  const entry = ISSUE_TEMPLATES_RU[name];
  if (!entry) return null;
  return Array.isArray(entry) ? entry : resolveIssueTemplate(entry);
}

function buildCommonIssues(ctx, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  if (lang === 'en') {
    return todoAdmonition('Populate the common-issues list manually (English templates are not bundled).');
  }
  const services = (ctx.introspect && Array.isArray(ctx.introspect.services)) ? ctx.introspect.services : [];
  const seen = new Set();
  const entries = [];
  for (const svc of services) {
    const tmpl = resolveIssueTemplate(svc);
    if (!tmpl) continue;
    if (seen.has(tmpl)) continue;
    seen.add(tmpl);
    for (const issue of tmpl) entries.push({ service: svc, ...issue });
  }
  entries.push({
    service: 'host',
    symptom: 'Команда запуска контейнеров завершается с ошибкой «port is already allocated».',
    cause: 'На хосте уже запущен другой сервис на том же порту (часто другая копия этого же стека).',
    fix: 'Найдите конфликтующий процесс командой `lsof -i :<порт>` или измените проброс порта в docker-compose.yml.',
  });
  if (entries.length === 0) {
    return todoAdmonition('Список типовых проблем не удалось собрать автоматически — добавьте его вручную.');
  }
  const out = [];
  for (const e of entries) {
    out.push(paragraph(`**${e.symptom}**`));
    out.push(paragraph(`Причина: ${e.cause}`));
    out.push(paragraph(`Решение: ${e.fix}`));
  }
  return out;
}

function buildMaintenanceContacts(ctx, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const meta = ctx.meta || {};
  const metadata = meta.metadata || {};
  const introspect = ctx.introspect || {};
  const derived = introspect.derived || {};

  const lines = [];
  if (metadata.responsible) {
    lines.push(lang === 'en'
      ? `Responsible organisation: ${metadata.responsible}.`
      : `Ответственная организация: ${metadata.responsible}.`);
  }
  if (metadata.support_email) {
    lines.push(lang === 'en'
      ? `Support email: ${metadata.support_email}.`
      : `Адрес технической поддержки: ${metadata.support_email}.`);
  }
  if (derived.repo_url) {
    let issuesUrl = null;
    const URL_RE = /^(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/;
    const match = derived.repo_url.match(URL_RE);
    if (match) {
      const [, host, owner, repoName] = match;
      if (/github|gitlab|bitbucket/.test(host)) {
        issuesUrl = `https://${host}/${owner}/${repoName}/issues`;
      }
    }
    if (issuesUrl) {
      lines.push(lang === 'en'
        ? `Issue tracker: ${issuesUrl}.`
        : `Трекер задач и замечаний: ${issuesUrl}.`);
    } else {
      lines.push(lang === 'en'
        ? `Source repository: ${derived.repo_url}.`
        : `Репозиторий исходного кода: ${derived.repo_url}.`);
    }
  }
  if (lines.length === 0) {
    return todoAdmonition(lang === 'en'
      ? 'No maintenance contact is declared in meta.metadata and no git remote was detected — add maintainer contacts manually.'
      : 'В meta.metadata не указан контакт сопровождения, git-remote не обнаружен — добавьте контакты сопровождения вручную.');
  }
  return [paragraph(lines.join(' '))];
}

module.exports = {
  buildExtensionPoints,
  buildDistributionComposition,
  buildSmokeScenarios,
  buildCommonIssues,
  buildMaintenanceContacts,
  findExtensionPoints,
  EXT_POINT_DIRS,
};
