#!/usr/bin/env node
'use strict';

/**
 * Phase 7.5 — finalisation scan.
 *
 * Runs after `generate.js` has written `docs/generated/*.md` but before the
 * author hands the DOCX to a reviewer. Greps for common template leftovers
 * that the earlier validators let slip:
 *   - "подлежит уточнению" (unresolved agent placeholder)
 *   - "ТРЕБУЕТСЯ УТОЧНЕНИЕ" (intentional TODO — worth surfacing again)
 *   - "реализовано средствами фреймворка …" (security fallback that should
 *     have been replaced by `security_facts` data)
 *   - ASCII-only `### headings` inside Russian sections (low-quality titles)
 *   - "**Детальное описание.**" placeholder sentinels
 *
 * Emits `docs/generated/FINALIZATION_REPORT.md` with file:line references and
 * a short remediation hint per class of hit so the author can fix the right
 * upstream data instead of hand-patching the rendered markdown.
 */

const fs = require('fs');
const path = require('path');

const cli = require('./lib/cli');

/**
 * Each pattern knows how to detect a concrete defect class and how to
 * describe the fix in one sentence. The regex is applied PER LINE so we can
 * cite line numbers; a handler can look at the full file when the context
 * around the match matters.
 */
const PATTERNS = [
  {
    id: 'placeholder',
    severity: 'warn',
    label: 'Незакрытый плейсхолдер "подлежит уточнению"',
    regex: /подлежит уточнению/i,
    hint: 'Заполните раздел вручную из `_research/*.md` либо добавьте соответствующий факт в summary.json исследующего агента.',
  },
  {
    id: 'todo-admonition',
    severity: 'warn',
    label: 'TODO-admonition "ТРЕБУЕТСЯ УТОЧНЕНИЕ"',
    regex: /ТРЕБУЕТСЯ УТОЧНЕНИЕ/,
    hint: 'Раздел помечен пустым — проверьте роль исследующего агента и либо добавьте данные, либо удалите раздел из шаблона.',
  },
  {
    id: 'framework-fallback',
    severity: 'info',
    label: 'Шаблонная фраза "реализовано средствами фреймворка"',
    regex: /реализован(а|о) средствами фреймворка/i,
    hint: 'Добавьте концентрированные факты в `security_facts` исследующего агента (auth.scheme, password_policy, rbac.model, audit_log.tables, transport.tls_version) — экспандер подменит текст.',
  },
  {
    id: 'auth-fallback',
    severity: 'info',
    label: 'Fallback-текст "подлежит уточнению при аудите"',
    regex: /подлежит уточнению при аудите/i,
    hint: 'Заполните недостающее поле в `security_facts` или `role_model` исследующего агента.',
  },
  {
    id: 'ascii-h3',
    severity: 'info',
    label: 'ASCII-заголовок уровня H3 в русском документе',
    regex: /^###\s+([A-Za-z][A-Za-z0-9\s\-_]{2,})$/,
    hint: 'Vision-агент вернул английское значение `title`; расширьте словарь `title-normalizer.fallbackTitleFromId` или поправьте prompt агента.',
  },
  {
    id: 'short-h2',
    severity: 'info',
    label: 'Подозрительно короткий заголовок (менее трёх слов)',
    regex: /^(##|###)\s+(\S+)$/,
    hint: 'Проверьте — возможно, заголовок попал из page.id. Дополните словарь title-normalizer или заголовок в шаблоне.',
  },
];

function collectMarkdownFiles(generatedDir) {
  if (!fs.existsSync(generatedDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(generatedDir)) {
    if (name.startsWith('_')) continue;
    if (name === 'FINALIZATION_REPORT.md') continue;
    const abs = path.join(generatedDir, name);
    const stat = fs.statSync(abs);
    if (stat.isFile() && name.endsWith('.md')) out.push(abs);
  }
  return out;
}

/**
 * Run every pattern against every line of every file. Each hit is a
 * `{ file, line, patternId, label, severity, snippet, hint }` record so the
 * final report can group by category AND by file.
 */
function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        hits.push({
          file: path.relative(process.cwd(), filePath),
          line: i + 1,
          patternId: pattern.id,
          label: pattern.label,
          severity: pattern.severity,
          snippet: line.trim().slice(0, 160),
          hint: pattern.hint,
        });
      }
    }
  }
  return hits;
}

function renderReport(hits, opts = {}) {
  const grouped = new Map();
  for (const h of hits) {
    if (!grouped.has(h.patternId)) grouped.set(h.patternId, []);
    grouped.get(h.patternId).push(h);
  }
  const lines = [
    '# Отчёт финализации документации',
    '',
    `Сгенерирован: ${opts.generatedAt || new Date().toISOString()}`,
    '',
    `Найдено замечаний: ${hits.length}. Отчёт построен скриптом `
      + '`skills/gostdocs/scripts/finalize.js`; используйте его перед '
      + 'передачей DOCX рецензенту — каждая строка ниже указывает файл, '
      + 'номер строки и короткий совет по устранению.',
    '',
  ];
  if (hits.length === 0) {
    lines.push('Документы не содержат типовых остатков шаблона — финализация пройдена.');
    return lines.join('\n') + '\n';
  }
  const sortedIds = [...grouped.keys()].sort();
  for (const id of sortedIds) {
    const entries = grouped.get(id);
    const first = entries[0];
    lines.push(`## ${first.label} — ${entries.length} шт.`);
    lines.push('');
    lines.push(`_${first.hint}_`);
    lines.push('');
    for (const h of entries.slice(0, 50)) {
      lines.push(`- \`${h.file}:${h.line}\` — ${h.snippet}`);
    }
    if (entries.length > 50) {
      lines.push(`- … и ещё ${entries.length - 50} похожих строк.`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function help() {
  return `Usage: finalize.js --config docs/meta.yaml

Scans docs/generated/*.md for template remnants and emits
docs/generated/FINALIZATION_REPORT.md.

  --config PATH   path to meta.yaml (required — only used to locate docs/)
  --dry-run       print the report to stdout, do not write file
`;
}

async function runFinalize(opts) {
  const docsDir = opts.docsDir || path.resolve(process.cwd(), 'docs');
  const generatedDir = path.join(docsDir, 'generated');
  const files = collectMarkdownFiles(generatedDir);
  const hits = files.flatMap((f) => scanFile(f));
  const report = renderReport(hits, { generatedAt: opts.generatedAt });
  const reportPath = path.join(generatedDir, 'FINALIZATION_REPORT.md');
  if (opts.dryRun) {
    process.stdout.write(report);
  } else {
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(reportPath, report, 'utf8');
  }
  return {
    files: files.length,
    hits: hits.length,
    reportPath: opts.dryRun ? null : reportPath,
    hitsByCategory: Object.fromEntries(
      [...new Set(hits.map((h) => h.patternId))].map((id) => [id, hits.filter((h) => h.patternId === id).length]),
    ),
  };
}

async function main() {
  const args = cli.parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const configPath = args.config
    ? path.resolve(args.config)
    : path.resolve(process.cwd(), 'docs', 'meta.yaml');
  const docsDir = path.dirname(configPath);
  const result = await runFinalize({ docsDir, dryRun: Boolean(args.dryRun) });
  const summary = Object.entries(result.hitsByCategory)
    .map(([id, count]) => `${id}=${count}`)
    .join(' ');
  const line = `[finalize] files=${result.files} hits=${result.hits}${summary ? ` (${summary})` : ''}`;
  process.stderr.write(`${line}\n`);
  if (result.reportPath) {
    process.stderr.write(`[finalize] wrote ${path.relative(process.cwd(), result.reportPath)}\n`);
  }
}

module.exports = {
  PATTERNS,
  scanFile,
  renderReport,
  runFinalize,
  collectMarkdownFiles,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[finalize] fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
