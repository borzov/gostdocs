'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const finalize = require('../skills/gostdocs/scripts/finalize');

function mkProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-'));
  const generatedDir = path.join(root, 'docs', 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(generatedDir, name), content, 'utf8');
  }
  return root;
}

function rm(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

describe('finalize scan', () => {
  test('emits empty report when there are no findings', () => {
    const root = mkProject({
      'user-guide.md': '# Введение\n\nКачественный текст без плейсхолдеров.\n',
    });
    try {
      const result = finalize.collectMarkdownFiles(path.join(root, 'docs', 'generated'));
      expect(result).toHaveLength(1);
      const hits = finalize.scanFile(result[0]);
      expect(hits).toEqual([]);
    } finally { rm(root); }
  });

  test('catches placeholder remnants and reports them by category', () => {
    const root = mkProject({
      'technical-description.md': [
        '# Безопасность',
        '',
        'Аутентификация реализована средствами фреймворка.',
        'Конкретный механизм подлежит уточнению при аудите.',
        '',
        '### event-detail',
        '',
      ].join('\n'),
    });
    try {
      const [file] = finalize.collectMarkdownFiles(path.join(root, 'docs', 'generated'));
      const hits = finalize.scanFile(file);
      const ids = hits.map((h) => h.patternId).sort();
      expect(ids).toContain('placeholder');
      expect(ids).toContain('framework-fallback');
      expect(ids).toContain('auth-fallback');
      expect(ids).toContain('ascii-h3');
    } finally { rm(root); }
  });

  test('renderReport groups hits by pattern id and includes remediation hints', () => {
    const hits = [
      { file: 'docs/generated/a.md', line: 10, patternId: 'placeholder', label: 'x', severity: 'warn', snippet: '...', hint: 'do X' },
      { file: 'docs/generated/a.md', line: 20, patternId: 'placeholder', label: 'x', severity: 'warn', snippet: '...', hint: 'do X' },
      { file: 'docs/generated/b.md', line: 5, patternId: 'todo-admonition', label: 'y', severity: 'warn', snippet: '...', hint: 'do Y' },
    ];
    const md = finalize.renderReport(hits, { generatedAt: '2026-04-24T00:00:00Z' });
    expect(md).toMatch(/Найдено замечаний: 3/);
    expect(md).toMatch(/## x — 2 шт/);
    expect(md).toMatch(/## y — 1 шт/);
    expect(md).toMatch(/do X/);
    expect(md).toMatch(/docs\/generated\/a\.md:10/);
  });

  test('runFinalize writes FINALIZATION_REPORT.md under docs/generated/', async () => {
    const root = mkProject({
      'user-guide.md': 'Раздел подлежит уточнению.\n',
    });
    try {
      const docsDir = path.join(root, 'docs');
      const res = await finalize.runFinalize({ docsDir });
      expect(res.hits).toBeGreaterThan(0);
      expect(res.reportPath).toBe(path.join(docsDir, 'generated', 'FINALIZATION_REPORT.md'));
      const body = fs.readFileSync(res.reportPath, 'utf8');
      expect(body).toMatch(/Отчёт финализации/);
    } finally { rm(root); }
  });

  test('skips files whose name begins with underscore (research directories)', () => {
    const root = mkProject({
      '_research-note.md': 'плейсхолдер подлежит уточнению',
      'user-guide.md': 'чистый текст',
    });
    try {
      const list = finalize.collectMarkdownFiles(path.join(root, 'docs', 'generated'));
      expect(list.map((p) => path.basename(p))).toEqual(['user-guide.md']);
    } finally { rm(root); }
  });
});
