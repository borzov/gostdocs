'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const loader = require('../skills/gen-docs/scripts/lib/template-loader');
const dm = require('../skills/gen-docs/scripts/lib/doc-model');

describe('DIRECTIVE_REGEX', () => {
  test('exposes a regex', () => {
    expect(loader.DIRECTIVE_REGEX).toBeInstanceOf(RegExp);
  });

  test('captures directive name and attrs', () => {
    const m = '<!-- GEN:mermaid source="arch" title="Схема" -->'.match(loader.DIRECTIVE_REGEX);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('mermaid');
    expect(m[2]).toBe('source="arch" title="Схема"');
  });

  test('ignores unrelated comments', () => {
    expect('<!-- AGENT: fill this -->'.match(loader.DIRECTIVE_REGEX)).toBeNull();
    expect('<!-- GOST mode: strict -->'.match(loader.DIRECTIVE_REGEX)).toBeNull();
  });
});

describe('parseAttrs', () => {
  test('parses quoted values with spaces', () => {
    const attrs = loader.parseAttrs('source="arch" title="Схема архитектуры"');
    expect(attrs).toEqual({ source: 'arch', title: 'Схема архитектуры' });
  });

  test('parses unquoted values', () => {
    expect(loader.parseAttrs('role=user level=2')).toEqual({ role: 'user', level: '2' });
  });

  test('treats bare key as flag=true', () => {
    expect(loader.parseAttrs('all')).toEqual({ all: true });
  });

  test('empty input returns empty object', () => {
    expect(loader.parseAttrs('')).toEqual({});
    expect(loader.parseAttrs('   ')).toEqual({});
  });

  test('handles escaped quotes inside values', () => {
    expect(loader.parseAttrs('title="She said \\"hi\\""')).toEqual({ title: 'She said "hi"' });
  });
});

describe('parseTemplate — frontmatter', () => {
  test('extracts YAML frontmatter', () => {
    const src = [
      '---',
      'title: "Руководство пользователя"',
      'lang: ru-RU',
      '---',
      '',
      '# Введение',
      '',
      'Текст введения.',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    expect(skel.frontmatter.title).toBe('Руководство пользователя');
    expect(skel.frontmatter.lang).toBe('ru-RU');
    expect(skel.sections).toHaveLength(1);
    expect(skel.sections[0].heading).toBe('Введение');
  });

  test('handles template without frontmatter', () => {
    const skel = loader.parseTemplate('# Only heading\n\ntext');
    expect(skel.frontmatter).toEqual({});
    expect(skel.sections).toHaveLength(1);
  });
});

describe('parseTemplate — sections and elements', () => {
  test('nests H2 sections under preceding H1', () => {
    const src = [
      '# Раздел 1',
      '',
      'Параграф.',
      '',
      '## Подраздел 1.1',
      '',
      'Ещё параграф.',
      '',
      '# Раздел 2',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    expect(skel.sections).toHaveLength(2);
    expect(skel.sections[0].children).toHaveLength(1);
    expect(skel.sections[0].children[0].heading).toBe('Подраздел 1.1');
    expect(skel.sections[0].children[0].level).toBe(2);
  });

  test('preserves pipe-table as raw element', () => {
    const src = [
      '# Таблица',
      '',
      '| А | Б |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    const els = skel.sections[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].kind).toBe('raw');
    expect(els[0].content).toContain('| А | Б |');
  });

  test('treats fenced code block as raw', () => {
    const src = ['# C', '', '```js', 'console.log(1)', '```'].join('\n');
    const skel = loader.parseTemplate(src);
    const els = skel.sections[0].elements;
    expect(els[0].kind).toBe('raw');
    expect(els[0].content).toContain('```js');
    expect(els[0].content).toContain('```');
  });

  test('bash fences containing "#" comment lines do not become headings', () => {
    // Regression — admin-guide templates have ```bash blocks whose lines start
    // with `#` (shell comments). The loader must keep them inside the raw
    // element, NOT split them into new H1 sections that would later
    // duplicate or break section structure.
    const src = [
      '# Восстановление',
      '',
      '```bash',
      '# Остановка',
      'docker compose down',
      '',
      '# Запуск',
      'docker compose up -d',
      '```',
      '',
      '# Следующая глава',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    expect(skel.sections).toHaveLength(2);
    expect(skel.sections[0].heading).toBe('Восстановление');
    expect(skel.sections[1].heading).toBe('Следующая глава');
    const raw = skel.sections[0].elements.find((e) => e.kind === 'raw');
    expect(raw).toBeDefined();
    expect(raw.content).toContain('# Остановка');
    expect(raw.content).toContain('# Запуск');
  });

  test('produces paragraph elements between headings', () => {
    const src = '# H\n\nпервый параграф\n\nвторой параграф\n';
    const skel = loader.parseTemplate(src);
    const els = skel.sections[0].elements;
    expect(els.filter((e) => e.kind === 'paragraph')).toHaveLength(2);
  });
});

describe('parseTemplate — directive handling', () => {
  test('GEN:* comment becomes directive element', () => {
    const src = '# H\n\n<!-- GEN:mermaid source="arch" title="Arch" -->\n';
    const skel = loader.parseTemplate(src);
    const els = skel.sections[0].elements;
    const dir = els.find((e) => e.kind === 'directive');
    expect(dir).toBeDefined();
    expect(dir.name).toBe('mermaid');
    expect(dir.attrs).toEqual({ source: 'arch', title: 'Arch' });
  });

  test('AGENT: comments are discarded', () => {
    const src = '# H\n\n<!-- AGENT: do nothing -->\n\nтекст\n';
    const skel = loader.parseTemplate(src);
    const kinds = skel.sections[0].elements.map((e) => e.kind);
    expect(kinds).not.toContain('agent');
    expect(kinds).toContain('paragraph');
  });

  test('multi-line AGENT comments are discarded as a single block', () => {
    const src = [
      '# H',
      '',
      '<!-- AGENT: Specify hardware requirements.',
      'Source: doc-researcher DEPLOYMENT.',
      'MUST include CPU, RAM, disk.',
      '-->',
      '',
      'Реальный параграф.',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    const els = skel.sections[0].elements;
    // Only one paragraph survives — the multi-line agent comment is dropped.
    expect(els).toHaveLength(1);
    expect(els[0]).toEqual({ kind: 'paragraph', text: 'Реальный параграф.' });
    // No leftover `<!--` tokens leak into any element.
    for (const el of els) {
      const text = el.text || el.content || '';
      expect(text).not.toContain('<!--');
      expect(text).not.toContain('AGENT:');
    }
  });

  test('LaTeX \\newpage becomes pagebreak directive', () => {
    const src = '# H\n\n\\newpage\n';
    const skel = loader.parseTemplate(src);
    const dir = skel.sections[0].elements.find((e) => e.kind === 'directive');
    expect(dir).toBeDefined();
    expect(dir.name).toBe('pagebreak');
  });

  test('LaTeX \\begin{center} / \\end{center} map to centered-block / end-centered', () => {
    const src = '# H\n\n\\begin{center}\n\nТекст\n\n\\end{center}\n';
    const skel = loader.parseTemplate(src);
    const names = skel.sections[0].elements
      .filter((e) => e.kind === 'directive')
      .map((e) => e.name);
    expect(names).toEqual(['centered-block', 'end-centered']);
  });

  test('LaTeX \\vspace and \\vfill are ignored', () => {
    const src = '# H\n\n\\vspace{2cm}\n\n\\vfill\n';
    const skel = loader.parseTemplate(src);
    const dirs = skel.sections[0].elements.filter((e) => e.kind === 'directive');
    expect(dirs).toHaveLength(0);
  });
});

describe('expandSkeleton', () => {
  test('invokes expanders and produces valid Doc-Model', async () => {
    const src = [
      '---',
      'title: "Пилот"',
      'lang: ru-RU',
      '---',
      '',
      '# Введение',
      '',
      '<!-- GEN:metadata key="organization" -->',
      '',
      '## Подраздел',
      '',
      'Текст.',
    ].join('\n');
    const skel = loader.parseTemplate(src);
    const expanders = {
      metadata: (attrs) =>
        attrs.key === 'organization'
          ? { type: 'paragraph', text: 'ООО «Пилот»' }
          : null,
    };
    const doc = await loader.expandSkeleton(skel, expanders, {});
    const v = dm.validate(doc);
    expect(v.title).toBe('Пилот');
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0].heading).toBe('Введение');
    expect(v.sections[0].elements[0]).toEqual({ type: 'paragraph', text: 'ООО «Пилот»' });
    expect(v.sections[0].children).toHaveLength(1);
    expect(v.sections[0].children[0].heading).toBe('Подраздел');
  });

  test('unknown directive records a warning and is skipped', async () => {
    const src = '# H\n\n<!-- GEN:bogus -->\n';
    const skel = loader.parseTemplate(src);
    const warnings = [];
    const ctx = { warnings };
    const doc = await loader.expandSkeleton(skel, {}, ctx);
    expect(doc.sections[0].elements).toHaveLength(0);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'template', message: expect.stringMatching(/bogus/) }),
      ]),
    );
  });

  test('expander returning null skips the element', async () => {
    const src = '# H\n\n<!-- GEN:metadata key="missing" -->\n';
    const skel = loader.parseTemplate(src);
    const doc = await loader.expandSkeleton(
      skel,
      { metadata: () => null },
      {},
    );
    expect(doc.sections[0].elements).toHaveLength(0);
  });

  test('expander returning { kind: "section", section } splices subtree in place', async () => {
    const src = '# Top\n\n<!-- GEN:journey role="user" -->\n';
    const skel = loader.parseTemplate(src);
    const expanders = {
      journey: () => ({
        kind: 'section',
        section: dm.newSection({
          heading: 'Сценарий',
          level: 2,
          elements: [{ type: 'paragraph', text: 'Шаг 1.' }],
        }),
      }),
    };
    const doc = await loader.expandSkeleton(skel, expanders, {});
    expect(doc.sections[0].children).toHaveLength(1);
    expect(doc.sections[0].children[0].heading).toBe('Сценарий');
  });

  test('expander returning array of elements appends each one', async () => {
    const src = '# H\n\n<!-- GEN:feature-list source="x" -->\n';
    const skel = loader.parseTemplate(src);
    const expanders = {
      'feature-list': () => [
        { type: 'paragraph', text: 'one' },
        { type: 'paragraph', text: 'two' },
      ],
    };
    const doc = await loader.expandSkeleton(skel, expanders, {});
    expect(doc.sections[0].elements).toHaveLength(2);
  });

  test('paragraph text from the template survives as paragraph elements', async () => {
    const src = '# H\n\nпервый параграф из шаблона\n';
    const skel = loader.parseTemplate(src);
    const doc = await loader.expandSkeleton(skel, {}, {});
    expect(doc.sections[0].elements[0]).toEqual({
      type: 'paragraph',
      text: 'первый параграф из шаблона',
    });
  });

  test('raw element (table/fenced code) passes through', async () => {
    const src = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const skel = loader.parseTemplate(src);
    const doc = await loader.expandSkeleton(skel, {}, {});
    const els = doc.sections[0].elements;
    expect(els[0].type).toBe('raw');
    expect(els[0].content).toContain('| a | b |');
  });
});

describe('loadTemplate', () => {
  test('reads template from disk', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-loader-'));
    try {
      const p = path.join(tmp, 'sample.md');
      fs.writeFileSync(
        p,
        [
          '---',
          'title: Пример',
          '---',
          '',
          '# H',
          '',
          'abc',
        ].join('\n'),
      );
      const skel = loader.loadTemplate(p);
      expect(skel.frontmatter.title).toBe('Пример');
      expect(skel.sections[0].heading).toBe('H');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
