const { lintMarkdown, countWords, sectionSplit } = require('../skills/gostdocs/scripts/lib/md-lint');

describe('countWords', () => {
  test('counts markdown-stripped words', () => {
    expect(countWords('# Hello\n\nWorld one two.')).toBe(4);
  });

  test('skips code fences', () => {
    expect(countWords('Hi\n```js\nconsole.log(1)\n```\nBye')).toBe(2);
  });

  test('skips image refs', () => {
    expect(countWords('word ![alt](x.png) another')).toBe(2);
  });
});

describe('sectionSplit', () => {
  test('splits by H2 lines', () => {
    const sections = sectionSplit('# Title\n## A\nbody A\n## B\nbody B');
    expect(sections.filter((s) => s.heading).map((s) => s.heading)).toEqual(['A', 'B']);
  });
});

describe('lintMarkdown — fenced code integrity', () => {
  test('flags pipe-tables inside fenced code blocks (warning)', () => {
    const src = ['## H', '', 'body text.', '', '```bash',
                 '| a | b |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    const leak = r.issues.find((i) => i.code === 'fence-leak');
    expect(leak).toBeDefined();
    expect(leak.severity).toBe('warning');
  });

  test('does NOT flag bash-style numbered comments that look like headings', () => {
    // Regression: `# 1. Шаг` inside ```bash``` is a legitimate shell
    // comment, not a markdown heading. The lint rule must not paint
    // legitimate bash comments as heading leaks.
    const src = ['## H', '', 'body.', '', '```bash',
                 '# 1. Клонирование репозитория',
                 'git clone https://example.com/repo',
                 '```'].join('\n');
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'fence-leak')).toBeUndefined();
  });
});

describe('lintMarkdown — placeholders', () => {
  test('flags AGENT: markers', () => {
    const r = lintMarkdown('## S\n\nAGENT: write me', { minWordsPerH2: 0 });
    expect(r.passed).toBe(false);
    expect(r.issues.find((i) => i.code === 'placeholder' && /AGENT/.test(i.message))).toBeDefined();
  });

  test('flags TODO and HTML comments', () => {
    const r = lintMarkdown('## S\n\n<!-- note -->\nTODO something', { minWordsPerH2: 0 });
    const codes = r.issues.map((i) => i.message);
    expect(codes.some((m) => /TODO/.test(m))).toBe(true);
    expect(codes.some((m) => /html-comment/.test(m))).toBe(true);
  });

  test('clean content passes', () => {
    const r = lintMarkdown('## S\n\nreal content here.', { minWordsPerH2: 3 });
    expect(r.passed).toBe(true);
    expect(r.errors).toBe(0);
  });
});

describe('lintMarkdown — image refs', () => {
  test('flags missing image files', () => {
    const fileExists = jest.fn((ref) => ref === 'exists.png');
    const r = lintMarkdown('## S\n\n![a](missing.png)\n![b](exists.png)\nmore text', {
      fileExists, minWordsPerH2: 0,
    });
    const broken = r.issues.filter((i) => i.code === 'broken-image');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toMatch(/missing\.png/);
  });

  test('ignores http(s) and data URIs', () => {
    const r = lintMarkdown('## S\n\n![a](https://x/y.png)\n![b](data:image/png;base64,xx)', {
      fileExists: () => false, minWordsPerH2: 0,
    });
    expect(r.issues.filter((i) => i.code === 'broken-image')).toHaveLength(0);
  });
});

describe('lintMarkdown — min words per H2', () => {
  test('flags short sections', () => {
    const r = lintMarkdown('## S1\n\nshort\n## S2\n\n' + 'word '.repeat(100), { minWordsPerH2: 50 });
    expect(r.issues.find((i) => i.code === 'short-section' && /S1/.test(i.message))).toBeDefined();
    expect(r.issues.find((i) => i.code === 'short-section' && /S2/.test(i.message))).toBeUndefined();
  });
});

describe('lintMarkdown — unresolved placeholders {key}', () => {
  test('flags an unresolved single-brace token outside code fences', () => {
    const r = lintMarkdown('## S\n\nПользователь «{role}» выполняет задачи.', { minWordsPerH2: 0 });
    const hit = r.issues.find((i) => i.code === 'unresolved-placeholder');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('error');
    expect(hit.message).toMatch(/\{role\}/);
  });

  test('leaves {key} inside fenced code untouched', () => {
    const src = ['## S', '', '```bash', 'docker run -e PORT={port} image', '```'].join('\n');
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'unresolved-placeholder')).toBeUndefined();
  });

  test('ignores Cyrillic-in-braces noise', () => {
    const r = lintMarkdown('## S\n\nПример {Название роли} справочник.', { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'unresolved-placeholder')).toBeUndefined();
  });
});

describe('lintMarkdown — em-dash arrow', () => {
  test('flags stray "–>" outside code fences', () => {
    const r = lintMarkdown('## S\n\nОшибка –> замечание.', { minWordsPerH2: 0 });
    const hit = r.issues.find((i) => i.code === 'em-dash-arrow');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('error');
  });

  test('ignores "–>" inside code fences', () => {
    const src = ['## S', '', '```text', 'foo –> bar', '```'].join('\n');
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'em-dash-arrow')).toBeUndefined();
  });
});

describe('lintMarkdown — unresolved directives', () => {
  test('flags UNRESOLVED-DIRECTIVE breadcrumb', () => {
    const r = lintMarkdown('## S\n\n<!-- UNRESOLVED-DIRECTIVE:foo-bar --> rest', { minWordsPerH2: 0 });
    const hit = r.issues.find((i) => i.code === 'unresolved-directive');
    expect(hit).toBeDefined();
    expect(hit.message).toMatch(/foo-bar/);
  });
});

describe('lintMarkdown — empty sections', () => {
  test('flags heading followed by nothing before the next heading', () => {
    const src = '## Пустой раздел\n\n## Следующий\n\nсодержимое.';
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    const hit = r.issues.find((i) => i.code === 'empty-section' && /Пустой/.test(i.message));
    expect(hit).toBeDefined();
  });

  test('section with a code block is not empty', () => {
    const src = ['## Раздел', '', '```js', 'foo', '```', '', '## next', '', 'ok.'].join('\n');
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'empty-section' && /Раздел/.test(i.message))).toBeUndefined();
  });
});

describe('lintMarkdown — empty tables', () => {
  test('flags header-only table', () => {
    const src = '## S\n\n| Col1 | Col2 |\n|------|------|\n\nboth columns are empty';
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'empty-table')).toBeDefined();
  });

  test('table with data rows passes', () => {
    const src = '## S\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'empty-table')).toBeUndefined();
  });
});

describe('lintMarkdown — duplicate headings', () => {
  test('flags two identical same-level headings', () => {
    const src = '# A\n\nтекст\n\n# A\n\nещё текст.';
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    const hit = r.issues.find((i) => i.code === 'duplicate-heading');
    expect(hit).toBeDefined();
  });

  test('headings differing by level are NOT duplicates', () => {
    const src = '# Тема\n\nвступление\n\n## Тема\n\nподраздел.';
    const r = lintMarkdown(src, { minWordsPerH2: 0 });
    expect(r.issues.find((i) => i.code === 'duplicate-heading')).toBeUndefined();
  });
});

describe('lintMarkdown — latin prose in RU doc', () => {
  test('flags a long mostly-English paragraph when lang=ru', () => {
    const para = 'Public landing page with a hero banner showing the main CTA buttons and a section below it with various information blocks for visitors.';
    const r = lintMarkdown(`## S\n\n${para}\n\nДальше по-русски.`, { minWordsPerH2: 0, lang: 'ru' });
    const hit = r.issues.find((i) => i.code === 'latin-prose-in-ru');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('warning');
  });

  test('does not flag RU-dominant prose with a few English acronyms', () => {
    const para = 'Пользователь выполняет вход через REST API с использованием токена JWT. Система выдаёт ответ в формате JSON согласно внутренним стандартам.';
    const r = lintMarkdown(`## S\n\n${para}`, { minWordsPerH2: 0, lang: 'ru' });
    expect(r.issues.find((i) => i.code === 'latin-prose-in-ru')).toBeUndefined();
  });

  test('disables check when lang=en', () => {
    const para = 'Public landing page with a hero banner showing the main CTA buttons and a section below it with various information blocks for visitors.';
    const r = lintMarkdown(`## S\n\n${para}`, { minWordsPerH2: 0, lang: 'en' });
    expect(r.issues.find((i) => i.code === 'latin-prose-in-ru')).toBeUndefined();
  });
});

describe('lintMarkdown — manifest coverage', () => {
  test('flags unreferenced manifest captures', () => {
    const content = '## S\n\n![a](admin/desktop/home.png)\n' + 'w '.repeat(100);
    const r = lintMarkdown(content, {
      manifestFiles: ['admin/desktop/home.png', 'admin/desktop/settings.png'],
      minWordsPerH2: 0,
    });
    const unused = r.issues.filter((i) => i.code === 'manifest-unused');
    expect(unused).toHaveLength(1);
    expect(unused[0].message).toMatch(/settings\.png/);
  });

  test('excluded files do not trigger', () => {
    const content = '## S\n\n' + 'w '.repeat(100);
    const r = lintMarkdown(content, {
      manifestFiles: ['admin/desktop/home.png'],
      excluded: ['admin/desktop/home.png'],
      minWordsPerH2: 0,
    });
    expect(r.issues.filter((i) => i.code === 'manifest-unused')).toHaveLength(0);
  });
});
