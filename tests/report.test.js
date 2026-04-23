const { buildReport, STRINGS } = require('../skills/gen-docs/scripts/lib/report');

const BASE = {
  manifest: {
    captures: [
      { role: 'guest', success: true },
      { role: 'admin', success: true },
      { role: 'admin', success: false },
    ],
    warnings: [{ scope: 'capture:guest', message: 'skipped /admin' }],
    errors: [],
  },
  coverage: {
    nfr: {
      blockers: [],
      warnings: [{ scope: 'nfr:NFR', message: 'placeholder inserted' }],
    },
    ai_artifacts: [],
  },
  inspections: [],
  duplicates: { duplicates: [] },
  mdLintResults: [],
  docs: [{ name: 'user-guide.docx', path: 'docs/output/user-guide.docx', bytes: 12345 }],
};

describe('buildReport', () => {
  test('ru report covers all sections', () => {
    const md = buildReport(BASE);
    expect(md).toMatch(/^# Отчёт о генерации документации/m);
    expect(md).toMatch(/## Сводка/);
    expect(md).toMatch(/## Покрытие/);
    expect(md).toMatch(/## Блокеры/);
    expect(md).toMatch(/## Пропуски и предупреждения/);
    expect(md).toMatch(/## Подозрительные снимки/);
    expect(md).toMatch(/## Дубликаты снимков/);
  });

  test('en report uses English headings', () => {
    const md = buildReport(BASE, { lang: 'en' });
    expect(md).toMatch(/# Documentation generation report/);
    expect(md).toMatch(/## Overview/);
    expect(md).toMatch(/## Coverage/);
  });

  test('coverage table aggregates success / fail per role', () => {
    const md = buildReport(BASE);
    // admin has 1 success, 1 fail
    expect(md).toMatch(/\| admin \| 1 \| 1 \|/);
    expect(md).toMatch(/\| guest \| 1 \| 0 \|/);
  });

  test('blockers section shows "None" when none', () => {
    const md = buildReport(BASE);
    const block = md.split('## Блокеры')[1].split('##')[0];
    expect(block).toMatch(/_Нет_/);
  });

  test('strict blocker surfaced when present', () => {
    const input = {
      ...BASE,
      coverage: {
        ...BASE.coverage,
        nfr: { ...BASE.coverage.nfr, blockers: [{ scope: 'nfr:NFR', message: 'missing' }] },
      },
    };
    const md = buildReport(input);
    expect(md).toMatch(/\*\*nfr:NFR\*\*: missing/);
  });

  test('suspicious is_login_form on authed role surfaced', () => {
    const input = {
      ...BASE,
      inspections: [
        { file: '/tmp/a.json', data: { role: 'admin', file: 'admin/desktop/home.png', is_login_form: true } },
        { file: '/tmp/b.json', data: { role: 'guest', file: 'guest/desktop/home.png', is_login_form: true } },
      ],
    };
    const md = buildReport(input);
    expect(md).toMatch(/admin\/desktop\/home\.png/);
    expect(md).not.toMatch(/guest\/desktop\/home\.png/);
  });

  test('duplicates section lists groups', () => {
    const input = {
      ...BASE,
      duplicates: { duplicates: [{ hash: 'abcdef0123456789', files: ['a.png', 'b.png'] }] },
    };
    const md = buildReport(input);
    expect(md).toMatch(/abcdef0123…: a\.png, b\.png/);
  });

  test('md-lint warnings appear in warnings section', () => {
    const input = {
      ...BASE,
      mdLintResults: [{
        file: 'user-guide.md',
        result: {
          errors: 0, warnings: 1, passed: true,
          issues: [{ severity: 'warning', code: 'short-section', line: 12, message: 'H2 "X" has few words' }],
        },
      }],
    };
    const md = buildReport(input);
    expect(md).toMatch(/md-lint:short-section/);
    expect(md).toMatch(/user-guide\.md: H2 "X" has few words/);
  });

  test('md-lint errors appear in linter section', () => {
    const input = {
      ...BASE,
      mdLintResults: [{
        file: 'user-guide.md',
        result: {
          errors: 1, warnings: 0, passed: false,
          issues: [{ severity: 'error', code: 'placeholder', line: 5, message: 'AGENT: found' }],
        },
      }],
    };
    const md = buildReport(input);
    expect(md).toMatch(/## Результаты markdown-валидации/);
    expect(md).toMatch(/errors=1/);
    expect(md).toMatch(/L5: AGENT: found/);
  });

  test('ai_artifacts block visible', () => {
    const input = {
      ...BASE,
      coverage: {
        ...BASE.coverage,
        ai_artifacts: [{ path: 'docs/TECHNICAL_SPECIFICATION.md', confidence: 'medium', reasons: ['filename', 'phrasing'] }],
      },
    };
    const md = buildReport(input);
    expect(md).toMatch(/TECHNICAL_SPECIFICATION\.md/);
    expect(md).toMatch(/filename; phrasing/);
  });
});
