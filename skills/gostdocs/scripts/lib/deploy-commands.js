'use strict';

/**
 * Render ready-to-run shell commands for the deployment-guide document.
 *
 * The renderer consumes:
 *   - `introspect.services[]`       from project-introspect (docker-compose)
 *   - `introspect.derived.migration_command` / `seed_command`
 *   - `meta.app.url` for the post-start smoke link
 *
 * Output is a sequence of Doc-Model elements (paragraphs + fenced code)
 * that the generator splices into the template. Every command line is
 * emitted as its own `code` element so the DOCX postprocess keeps the
 * monospace formatting and newlines exactly — important for a reviewer
 * copy-pasting into a terminal.
 *
 * The helper is stack-agnostic: when a field is missing it skips the
 * corresponding block. Where possible it suggests generic commands
 * (`docker compose up -d`) without pretending they came from the repo.
 */

const STRINGS = {
  ru: {
    prereq_title: 'Предварительные требования',
    prereq_items: [
      'Установлены **Docker** 24+ и **Docker Compose** v2.20+.',
      'На порту приложения, указанном в `docker-compose.yml`, нет других сервисов.',
      'Свободно не менее **4 ГБ оперативной памяти** и **10 ГБ дискового пространства**.',
    ],
    start_intro: 'Запустите контейнеры в фоновом режиме:',
    stop_intro: 'После завершения тестирования остановите контейнеры:',
    migrate_intro: 'Примените миграции схемы базы данных:',
    seed_intro: 'Заполните базу тестовыми данными:',
    verify_intro: 'Убедитесь, что приложение отвечает:',
    logs_intro: 'При ошибках посмотрите журналы:',
    no_compose: 'Файл docker-compose.yml в проекте не обнаружен. Замените команды ниже на способ запуска, поддерживаемый вашим дистрибутивом.',
  },
  en: {
    prereq_title: 'Prerequisites',
    prereq_items: [
      'Docker **24+** and **Docker Compose v2.20+** are installed.',
      'The application port declared in `docker-compose.yml` is free.',
      'At least **4 GB RAM** and **10 GB disk space** available.',
    ],
    start_intro: 'Start the containers in detached mode:',
    stop_intro: 'Shut the containers down after testing:',
    migrate_intro: 'Apply database schema migrations:',
    seed_intro: 'Seed the database with demo data:',
    verify_intro: 'Verify that the application responds:',
    logs_intro: 'Inspect logs when anything looks wrong:',
    no_compose: 'No docker-compose.yml was found in the project. Replace the commands below with the startup path supported by your distribution.',
  },
};

function pickLang(lang) {
  return lang === 'en' ? 'en' : 'ru';
}

function bulletList(items) {
  const clean = items.filter(Boolean).map((s) => `- ${String(s).trim()}`);
  return { type: 'raw', format: 'markdown', content: `${clean.join('\n')}\n` };
}

function codeBlock(command, langHint = 'bash') {
  return { type: 'code', lang: langHint, code: String(command).trim() };
}

/**
 * Suggest a container-aware exec variant of a command when a service name
 * is known. Rails/Laravel/Django migrations typically run inside the app
 * container, not from the host, so the reviewer-facing command should be
 * prefixed with `docker compose exec <svc>` rather than a bare invocation.
 */
function wrapExec(command, service) {
  if (!service || !command) return command;
  const trimmed = String(command).trim();
  // Avoid double-wrapping when the command already runs inside compose.
  if (/^docker\s+compose\s+(exec|run)/.test(trimmed)) return trimmed;
  return `docker compose exec ${service} ${trimmed}`;
}

function pickAppService(services) {
  if (!Array.isArray(services)) return null;
  const preferred = ['app', 'backend', 'api', 'web', 'server'];
  for (const name of preferred) {
    if (services.includes(name)) return name;
  }
  return services[0] || null;
}

/**
 * Build the Doc-Model elements for GEN:deploy-commands.
 *
 * @param {{
 *   introspect?: { services?: string[], derived?: { migration_command?: string, seed_command?: string, service_name?: string } },
 *   meta?: { app?: { url?: string } }
 * }} ctx
 * @param {{ lang?: 'ru'|'en' }} [opts]
 * @returns {Array<object>}
 */
function buildDeployCommands(ctx = {}, opts = {}) {
  const t = STRINGS[pickLang(opts.lang)];
  const introspect = ctx.introspect || {};
  const services = Array.isArray(introspect.services) ? introspect.services : [];
  const appService = pickAppService(services)
    || (introspect.derived && introspect.derived.service_name)
    || null;
  const migrationCmd = introspect.derived && introspect.derived.migration_command;
  const seedCmd = introspect.derived && introspect.derived.seed_command;
  const appUrl = (ctx.meta && ctx.meta.app && ctx.meta.app.url) || 'http://localhost:8080';

  const out = [];
  out.push({ type: 'paragraph', text: `**${t.prereq_title}**` });
  out.push(bulletList(t.prereq_items));

  if (services.length === 0) {
    out.push({ type: 'admonition', kind: 'todo', text: t.no_compose });
  }

  out.push({ type: 'paragraph', text: t.start_intro });
  out.push(codeBlock('docker compose up -d'));

  if (migrationCmd) {
    out.push({ type: 'paragraph', text: t.migrate_intro });
    out.push(codeBlock(wrapExec(migrationCmd, appService)));
  }
  if (seedCmd) {
    out.push({ type: 'paragraph', text: t.seed_intro });
    out.push(codeBlock(wrapExec(seedCmd, appService)));
  }

  out.push({ type: 'paragraph', text: t.verify_intro });
  out.push(codeBlock(`curl -fsSL "${appUrl}" >/dev/null && echo OK`));

  if (appService) {
    out.push({ type: 'paragraph', text: t.logs_intro });
    out.push(codeBlock(`docker compose logs -f ${appService}`));
  }

  out.push({ type: 'paragraph', text: t.stop_intro });
  out.push(codeBlock('docker compose down'));

  return out;
}

module.exports = {
  buildDeployCommands,
  pickAppService,
  wrapExec,
  STRINGS,
};
