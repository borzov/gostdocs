'use strict';

const { resolveMustache } = require('../skills/gen-docs/scripts/lib/mustache-resolve');

describe('resolveMustache', () => {
  test('replaces a single token in plain prose', () => {
    const out = resolveMustache('Система «{system_name}» версии {version}.', {
      system_name: 'Пилот',
      version: '1.0',
    });
    expect(out).toBe('Система «Пилот» версии 1.0.');
  });

  test('preserves an unknown token and reports it via onUnknown', () => {
    const seen = [];
    const out = resolveMustache('Параметр {missing} не задан.', { other: 'x' }, {
      onUnknown: (key, lineNo) => seen.push({ key, lineNo }),
    });
    expect(out).toBe('Параметр {missing} не задан.');
    expect(seen).toEqual([{ key: 'missing', lineNo: 1 }]);
  });

  test('expands tokens inside fenced bash code blocks (default behaviour)', () => {
    const src = [
      '```bash',
      'curl -f http://localhost:{port}/health',
      'pg_dump -U {db_user} {db_name}',
      '```',
    ].join('\n');
    const out = resolveMustache(src, { port: '5173', db_user: 'app', db_name: 'app' });
    expect(out).toContain('curl -f http://localhost:5173/health');
    expect(out).toContain('pg_dump -U app app');
  });

  test('expandInsideCode=false leaves fenced blocks untouched', () => {
    const src = ['Текст {system_name}.', '', '```bash', 'echo {system_name}', '```'].join('\n');
    const out = resolveMustache(src, { system_name: 'Пилот' }, { expandInsideCode: false });
    expect(out).toContain('Текст Пилот.');
    expect(out).toContain('echo {system_name}');
  });

  test('does not match cyrillic-in-braces or non-token shapes', () => {
    const out = resolveMustache(
      'Заголовок {Название роли} и `{"status":"ok"}` остаются.',
      { name: 'X' },
    );
    expect(out).toBe('Заголовок {Название роли} и `{"status":"ok"}` остаются.');
  });

  test('does not consume shell-variable expansion ${var}', () => {
    const out = resolveMustache('echo ${HOME} and {project_dir}', { project_dir: 'app' });
    expect(out).toBe('echo ${HOME} and app');
  });

  test('replaces multiple occurrences on the same line', () => {
    const out = resolveMustache('{a} → {a} ({b})', { a: '1', b: '2' });
    expect(out).toBe('1 → 1 (2)');
  });

  test('reports unknown keys with their line numbers (multi-line)', () => {
    const seen = [];
    const src = ['Title {a}', '', 'Body {b}'].join('\n');
    resolveMustache(src, {}, { onUnknown: (key, lineNo) => seen.push({ key, lineNo }) });
    expect(seen).toEqual(
      expect.arrayContaining([
        { key: 'a', lineNo: 1 },
        { key: 'b', lineNo: 3 },
      ]),
    );
  });

  test('treats null / undefined values as unknown (not "null")', () => {
    const seen = [];
    const out = resolveMustache('{a} {b}', { a: null, b: undefined }, {
      onUnknown: (key) => seen.push(key),
    });
    expect(out).toBe('{a} {b}');
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  test('returns the input unchanged when there are no tokens', () => {
    const src = 'Plain text without placeholders.';
    expect(resolveMustache(src, { irrelevant: 'X' })).toBe(src);
  });

  test('handles empty / nullish input gracefully', () => {
    expect(resolveMustache('', {})).toBe('');
    expect(resolveMustache(null, {})).toBe('');
    expect(resolveMustache(undefined, {})).toBe('');
  });

  test('ignores closing fences without an open fence', () => {
    const src = 'plain {a}';
    expect(resolveMustache(src, { a: 'X' })).toBe('plain X');
  });

  test('does not substitute tokens inside HTML comments (single line)', () => {
    const seen = [];
    const out = resolveMustache(
      '<!-- AGENT: see screenshots/{name}.png -->',
      {},
      { onUnknown: (k) => seen.push(k) },
    );
    expect(out).toBe('<!-- AGENT: see screenshots/{name}.png -->');
    expect(seen).toEqual([]);
  });

  test('does not substitute tokens inside HTML comments (multi-line)', () => {
    const src = [
      '<!-- AGENT: long instruction',
      'with {placeholder} that should NOT be substituted',
      'and another {x} inside.',
      '-->',
      'Real {key} here.',
    ].join('\n');
    const seen = [];
    const out = resolveMustache(src, { key: 'value' }, { onUnknown: (k) => seen.push(k) });
    expect(out).toContain('with {placeholder}');
    expect(out).toContain('Real value here.');
    // Only the in-prose `{key}` was inspected; comment tokens stayed silent.
    expect(seen).toEqual([]);
  });
});
