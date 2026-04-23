const { lintMarkdown, countWords, sectionSplit } = require('../skills/gen-docs/scripts/lib/md-lint');

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
