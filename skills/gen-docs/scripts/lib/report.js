'use strict';

/**
 * REPORT.md builder.
 *
 * Purpose (per v0.3 requirement 6.2): the user must see a single file that
 * summarises every gap, warning, and blocker from the run — before opening
 * the DOCX. This module assembles such a report from the inputs produced
 * by all prior phases:
 *
 *   - manifest      : docs/screenshots/manifest.json               (Phase 3/4 capture)
 *   - coverage      : docs/generated/_research/coverage.json       (Phase 4 research)
 *   - inspections   : docs/generated/_inspection/**.json           (Phase 5 vision)
 *   - duplicates    : result of file-hash.detectDuplicates(...)    (Phase 7)
 *   - mdLintResults : [{ file, result }] from md-lint.lintMarkdown (Phase 6)
 *   - docs          : [{ name, path, bytes, pages? }]              (Phase 6 output)
 *
 * Pure function: no I/O. Caller assembles inputs and writes the output.
 */

const STRINGS = {
  ru: {
    title: 'Отчёт о генерации документации',
    overview: 'Сводка',
    documents: 'Документы',
    coverage: 'Покрытие',
    routes: 'Маршруты (скриншоты)',
    roles: 'Роли',
    missing: 'Пропуски и предупреждения',
    blockers: 'Блокеры',
    suspicious: 'Подозрительные снимки',
    duplicates: 'Дубликаты снимков',
    aiArtifacts: 'Артефакты ИИ в исходниках',
    linter: 'Результаты markdown-валидации',
    none: 'Нет',
    file: 'файл', bytes: 'размер', role: 'роль', viewport: 'viewport',
    status: 'статус', success: 'успех', errors: 'ошибок', warnings: 'предупр.',
    emptyLogin: 'is_login_form=true в авторизованной роли',
    confidence: 'уверенность', reasons: 'причины',
  },
  en: {
    title: 'Documentation generation report',
    overview: 'Overview',
    documents: 'Documents',
    coverage: 'Coverage',
    routes: 'Routes (screenshots)',
    roles: 'Roles',
    missing: 'Gaps and warnings',
    blockers: 'Blockers',
    suspicious: 'Suspicious screenshots',
    duplicates: 'Duplicate screenshots',
    aiArtifacts: 'AI-generated markdown in sources',
    linter: 'Markdown validation results',
    none: 'None',
    file: 'file', bytes: 'size', role: 'role', viewport: 'viewport',
    status: 'status', success: 'ok', errors: 'errors', warnings: 'warnings',
    emptyLogin: 'is_login_form=true on an authenticated role',
    confidence: 'confidence', reasons: 'reasons',
  },
};

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function selectLang(lang) {
  return String(lang || '').startsWith('en') ? 'en' : 'ru';
}

function overviewSection(input, t) {
  const docCount = (input.docs || []).length;
  const captureCount = input.manifest && input.manifest.captures ? input.manifest.captures.length : 0;
  const errorCount = input.manifest && input.manifest.errors ? input.manifest.errors.length : 0;
  const warningCount = input.manifest && input.manifest.warnings ? input.manifest.warnings.length : 0;
  const lines = [`## ${t.overview}`, ''];
  lines.push(`- ${t.documents}: ${docCount}`);
  lines.push(`- ${t.routes}: ${captureCount}`);
  lines.push(`- ${t.errors}: ${errorCount}`);
  lines.push(`- ${t.warnings}: ${warningCount}`);
  return lines.join('\n');
}

function documentsSection(input, t) {
  if (!input.docs || input.docs.length === 0) return '';
  const lines = [`## ${t.documents}`, ''];
  lines.push(`| ${t.file} | ${t.bytes} |`, '|---|---|');
  for (const d of input.docs) {
    lines.push(`| ${escapeCell(d.path || d.name)} | ${d.bytes ?? ''} |`);
  }
  return lines.join('\n');
}

function coverageSection(input, t) {
  if (!input.manifest || !input.manifest.captures) return '';
  /** @type {Map<string, { role: string, success: number, failed: number }>} */
  const byRole = new Map();
  for (const c of input.manifest.captures) {
    if (!byRole.has(c.role)) byRole.set(c.role, { role: c.role, success: 0, failed: 0 });
    const entry = byRole.get(c.role);
    if (c.success) entry.success += 1; else entry.failed += 1;
  }
  const lines = [`## ${t.coverage}`, ''];
  lines.push(`| ${t.role} | ${t.success} | ${t.errors} |`, '|---|---|---|');
  for (const entry of [...byRole.values()].sort((a, b) => a.role.localeCompare(b.role))) {
    lines.push(`| ${escapeCell(entry.role)} | ${entry.success} | ${entry.failed} |`);
  }
  return lines.join('\n');
}

function blockersSection(input, t) {
  const lines = [`## ${t.blockers}`, ''];
  const blockers = (input.coverage && input.coverage.nfr && input.coverage.nfr.blockers) || [];
  if (blockers.length === 0) {
    lines.push(`_${t.none}_`);
  } else {
    for (const b of blockers) lines.push(`- **${b.scope}**: ${b.message}`);
  }
  return lines.join('\n');
}

function warningsSection(input, t) {
  const lines = [`## ${t.missing}`, ''];
  const all = [];
  for (const w of (input.manifest && input.manifest.warnings) || []) {
    all.push({ scope: w.scope, message: w.message, origin: 'capture' });
  }
  for (const w of (input.coverage && input.coverage.nfr && input.coverage.nfr.warnings) || []) {
    all.push({ scope: w.scope, message: w.message, origin: 'nfr' });
  }
  for (const entry of input.mdLintResults || []) {
    for (const issue of entry.result.issues || []) {
      if (issue.severity !== 'warning') continue;
      all.push({ scope: `md-lint:${issue.code}`, message: `${entry.file}: ${issue.message}`, origin: 'md-lint' });
    }
  }
  if (all.length === 0) lines.push(`_${t.none}_`);
  else for (const w of all) lines.push(`- **${w.scope}** _(${w.origin})_: ${w.message}`);
  return lines.join('\n');
}

function suspiciousSection(input, t) {
  const lines = [`## ${t.suspicious}`, ''];
  /** @type {string[]} */
  const entries = [];
  for (const insp of input.inspections || []) {
    const role = insp.data && insp.data.role;
    if (!role || role === 'guest') continue;
    if (insp.data && insp.data.is_login_form) {
      entries.push(`- ${t.emptyLogin}: ${insp.data.file} (${t.role}=${role})`);
    }
  }
  if (entries.length === 0) lines.push(`_${t.none}_`);
  else lines.push(...entries);
  return lines.join('\n');
}

function duplicatesSection(input, t) {
  const lines = [`## ${t.duplicates}`, ''];
  const dups = (input.duplicates && input.duplicates.duplicates) || [];
  if (dups.length === 0) {
    lines.push(`_${t.none}_`);
  } else {
    for (const g of dups) {
      lines.push(`- ${g.hash.slice(0, 10)}…: ${g.files.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function aiArtifactsSection(input, t) {
  const lines = [`## ${t.aiArtifacts}`, ''];
  const items = (input.coverage && input.coverage.ai_artifacts) || [];
  if (items.length === 0) {
    lines.push(`_${t.none}_`);
  } else {
    for (const item of items) {
      lines.push(`- ${item.path} (${t.confidence}: ${item.confidence})`);
      if (Array.isArray(item.reasons) && item.reasons.length > 0) {
        lines.push(`  - ${t.reasons}: ${item.reasons.join('; ')}`);
      }
    }
  }
  return lines.join('\n');
}

function linterSection(input, t) {
  if (!input.mdLintResults || input.mdLintResults.length === 0) return '';
  const lines = [`## ${t.linter}`, ''];
  for (const entry of input.mdLintResults) {
    lines.push(`- ${entry.file}: errors=${entry.result.errors}, warnings=${entry.result.warnings}`);
    for (const issue of (entry.result.issues || []).filter((i) => i.severity === 'error')) {
      lines.push(`  - L${issue.line ?? '?'}: ${issue.message}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build the full REPORT.md string.
 *
 * @param {{
 *   manifest?: { captures: Array<any>, warnings?: Array<any>, errors?: Array<any> },
 *   coverage?: { nfr?: { blockers?: Array<any>, warnings?: Array<any> }, ai_artifacts?: Array<any> },
 *   inspections?: Array<{ data: any, file: string }>,
 *   duplicates?: { duplicates: Array<{ hash: string, files: string[] }> },
 *   mdLintResults?: Array<{ file: string, result: any }>,
 *   docs?: Array<{ name?: string, path?: string, bytes?: number }>,
 * }} input
 * @param {{ lang?: 'ru'|'en' }} [opts]
 * @returns {string}
 */
function buildReport(input, opts = {}) {
  const lang = selectLang(opts.lang);
  const t = STRINGS[lang];
  const blocks = [`# ${t.title}`, ''];
  for (const section of [
    overviewSection, documentsSection, coverageSection, blockersSection,
    warningsSection, suspiciousSection, duplicatesSection, aiArtifactsSection, linterSection,
  ]) {
    const out = section(input, t);
    if (out && out.trim()) {
      blocks.push(out);
      blocks.push('');
    }
  }
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = {
  buildReport,
  STRINGS,
};
