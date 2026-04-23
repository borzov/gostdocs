'use strict';

/**
 * Gap collector — diff a (proposed) meta object against the v0.3 schema and
 * the orchestrator's UX expectations, return a list of fields the user
 * still needs to fill.
 *
 * Each gap is shaped for direct use in an AskUserQuestion call:
 *   {
 *     field: 'metadata.system_name',
 *     question: 'Как называется система?',
 *     header: 'System name',
 *     default: 'my-cool-app',
 *     default_source: 'package.json name',
 *     importance: 'critical' | 'high' | 'medium' | 'optional',
 *     secret: false,
 *   }
 *
 * The orchestrator (Claude reading SKILL.md) groups gaps into
 * AskUserQuestion calls, supplying the `default` as a pre-filled hint.
 *
 * Pure module — no I/O. The init-meta CLI is the only consumer.
 */

const isEmpty = (v) => v === undefined || v === null || v === '';

function defaultUrlFromPort(port) {
  if (!port) return null;
  return `http://localhost:${port}`;
}

function isGuestRole(role) {
  return role && (String(role.role).toLowerCase() === 'guest' || role.credentials === null);
}

/**
 * @param {Record<string, any>} proposed  meta-shaped object (typically from meta-builder.propose)
 * @param {{
 *   introspect?: { derived?: Record<string,string> },
 *   packageName?: string,
 * }} [ctx]
 * @returns {Array<{
 *   field: string,
 *   question: string,
 *   header: string,
 *   default: any,
 *   default_source: string|null,
 *   importance: 'critical'|'high'|'medium'|'optional',
 *   secret: boolean,
 * }>}
 */
function collectGaps(proposed, ctx = {}) {
  const introspect = ctx.introspect || {};
  const derived = introspect.derived || {};
  const gaps = [];

  // app.url — required by schema. Try to derive a default from the port.
  if (!proposed.app || isEmpty(proposed.app.url)) {
    gaps.push({
      field: 'app.url',
      question: 'Какой URL приложения для снятия скриншотов?',
      header: 'App URL',
      default: defaultUrlFromPort(derived.port) || 'http://localhost:3000',
      default_source: derived.port ? '.env (APP_PORT)' : null,
      importance: 'critical',
      secret: false,
    });
  }

  // pages — without these capture has nothing to do.
  if (!Array.isArray(proposed.pages) || proposed.pages.length === 0) {
    gaps.push({
      field: 'pages',
      question: 'Не удалось автоматически извлечь список страниц приложения. Запустите анализ репозитория (research) или укажите пути вручную.',
      header: 'Pages',
      default: null,
      default_source: null,
      importance: 'critical',
      secret: false,
    });
  }

  // Per-role credentials — auth.method != 'none' AND role != guest.
  const roles = (proposed.auth && Array.isArray(proposed.auth.roles)) ? proposed.auth.roles : [];
  for (const role of roles) {
    if (isGuestRole(role)) continue;
    if (isEmpty(role.username)) {
      gaps.push({
        field: `auth.roles[${role.role}].username`,
        question: `Логин пользователя с ролью «${role.role}»?`,
        header: `${role.role} login`,
        default: `${role.role}@example.com`,
        default_source: null,
        importance: 'critical',
        secret: false,
      });
    }
    if (isEmpty(role.password)) {
      gaps.push({
        field: `auth.roles[${role.role}].password`,
        question: `Пароль пользователя с ролью «${role.role}»? (Будет сохранён в meta.yaml; файл автоматически добавляется в .gitignore.)`,
        header: `${role.role} pwd`,
        default: null,
        default_source: null,
        importance: 'critical',
        secret: true,
      });
    }
  }

  // Metadata — system_name, organization, doc_code, version.
  const md = proposed.metadata || {};

  if (isEmpty(md.system_name)) {
    gaps.push({
      field: 'metadata.system_name',
      question: 'Как называется система? (Будет фигурировать в заголовках документов.)',
      header: 'System name',
      default: ctx.packageName || (proposed.metadata && proposed.metadata.project_dir) || null,
      default_source: ctx.packageName ? 'package.json name' : (proposed.metadata && proposed.metadata.project_dir ? 'project_path basename' : null),
      importance: 'high',
      secret: false,
    });
  }

  if (isEmpty(md.organization)) {
    gaps.push({
      field: 'metadata.organization',
      question: 'Название организации-владельца системы? (Указывается на титульном листе и в реквизитах.)',
      header: 'Organization',
      default: null,
      default_source: null,
      importance: 'medium',
      secret: false,
    });
  }

  if (proposed.gost_mode === 'strict' && isEmpty(md.doc_code)) {
    gaps.push({
      field: 'metadata.doc_code',
      question: 'Код документа по ГОСТ (например, «АБВ.00001-01 34 01»)? Можно указать «—», если код ещё не присвоен.',
      header: 'Doc code',
      default: '—',
      default_source: null,
      importance: 'medium',
      secret: false,
    });
  }

  if (isEmpty(md.version)) {
    gaps.push({
      field: 'metadata.version',
      question: 'Версия системы? (Например, «1.0.0».)',
      header: 'Version',
      default: derived.version || '1.0',
      default_source: derived.version ? 'git tag / package.json' : null,
      importance: 'high',
      secret: false,
    });
  }

  if (isEmpty(md.repo_url)) {
    gaps.push({
      field: 'metadata.repo_url',
      question: 'URL git-репозитория проекта? («—», если не используется.)',
      header: 'Repo URL',
      default: derived.repo_url || '—',
      default_source: derived.repo_url ? 'git remote' : null,
      importance: 'optional',
      secret: false,
    });
  }

  return gaps;
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, optional: 3 };

function batchGaps(gaps, perBatch = 4) {
  // Sort by importance to ensure critical questions are asked first.
  const sorted = [...gaps].sort((a, b) =>
    (PRIORITY_ORDER[a.importance] ?? 9) - (PRIORITY_ORDER[b.importance] ?? 9));
  const batches = [];
  for (let i = 0; i < sorted.length; i += perBatch) {
    batches.push(sorted.slice(i, i + perBatch));
  }
  return batches;
}

module.exports = {
  collectGaps,
  batchGaps,
  defaultUrlFromPort,
};
