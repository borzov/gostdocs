const { deriveMetadata, mergeMetadata, extractFromPyproject } =
  require('../skills/gen-docs/scripts/lib/metadata-autofill');

function makeReadFile(files) {
  return (p) => {
    if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    return files[p];
  };
}

function makeGitRun(responses) {
  return async (args) => {
    const key = args.slice(-3).join(' ');  // last three tokens identify the call
    const r = responses[key];
    if (!r) return { stdout: '', code: -1, error: new Error('no such git call') };
    return { stdout: r, code: 0 };
  };
}

const NOW_2026 = () => new Date('2026-06-01T00:00:00Z');

describe('extractFromPyproject', () => {
  test('reads [project] version', () => {
    const txt = '[project]\nname = "x"\nversion = "1.2.3"\n';
    expect(extractFromPyproject(txt)).toEqual({ version: '1.2.3', organization_hint: 'x' });
  });

  test('falls back to [tool.poetry]', () => {
    const txt = '[tool.poetry]\nname = "poetry-pkg"\nversion = "2.0.0"\n';
    expect(extractFromPyproject(txt)).toMatchObject({ version: '2.0.0', organization_hint: 'poetry-pkg' });
  });

  test('empty input yields {}', () => {
    expect(extractFromPyproject('')).toEqual({});
  });
});

describe('deriveMetadata', () => {
  test('year always filled from now()', async () => {
    const result = await deriveMetadata('/x', {
      now: NOW_2026,
      readFile: () => { throw new Error('no fs'); },
      gitRun: async () => ({ stdout: '', code: -1 }),
    });
    expect(result.year).toBe('2026');
    expect(result.sources.year).toBe('system-date');
  });

  test('prefers git tag for version', async () => {
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: makeReadFile({ '/p/package.json': JSON.stringify({ version: '0.9.0' }) }),
      gitRun: makeGitRun({ 'describe --tags --abbrev=0': 'v1.0.0' }),
    });
    expect(result.version).toBe('1.0.0');
    expect(result.sources.version).toBe('git-tag');
  });

  test('falls back to package.json when no git tag', async () => {
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: makeReadFile({ '/p/package.json': JSON.stringify({ version: '2.1.0', name: 'my-pkg' }) }),
      gitRun: makeGitRun({}),
    });
    expect(result.version).toBe('2.1.0');
    expect(result.sources.version).toBe('package.json');
    expect(result.organization).toBe('my-pkg');
  });

  test('falls back to composer.json when no package.json version', async () => {
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: makeReadFile({
        '/p/composer.json': JSON.stringify({ version: '3.0.0', name: 'vendor/pkg' }),
      }),
      gitRun: makeGitRun({}),
    });
    expect(result.version).toBe('3.0.0');
    expect(result.sources.version).toBe('composer.json');
    expect(result.organization).toBe('vendor/pkg');
  });

  test('pyproject.toml fallback', async () => {
    const py = '[project]\nname = "app"\nversion = "0.5.0"\n';
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: makeReadFile({ '/p/pyproject.toml': py }),
      gitRun: makeGitRun({}),
    });
    expect(result.version).toBe('0.5.0');
    expect(result.sources.version).toBe('pyproject.toml');
  });

  test('responsible derived from git config when available', async () => {
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: () => { throw new Error('no fs'); },
      gitRun: makeGitRun({
        'config --get user.name': 'Alice Smith',
        'config --get user.email': 'alice@example.com',
      }),
    });
    expect(result.responsible).toBe('Alice Smith (alice@example.com)');
    expect(result.sources.responsible).toBe('git config');
  });

  test('author field with name in package.json', async () => {
    const pkg = JSON.stringify({ author: { name: 'ACME Corp' } });
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: makeReadFile({ '/p/package.json': pkg }),
      gitRun: makeGitRun({}),
    });
    expect(result.organization).toBe('ACME Corp');
  });

  test('nothing available — only year populated', async () => {
    const result = await deriveMetadata('/p', {
      now: NOW_2026,
      readFile: () => { throw new Error('no fs'); },
      gitRun: async () => ({ stdout: '', code: -1 }),
    });
    expect(result).toEqual({ year: '2026', sources: { year: 'system-date' } });
  });
});

describe('mergeMetadata', () => {
  test('fills only missing fields', () => {
    const existing = { year: '2022', version: '', responsible: null };
    const derived = { year: '2026', version: '1.0', organization: 'X', responsible: 'me' };
    const { merged, applied } = mergeMetadata(existing, derived);
    expect(merged.year).toBe('2022');          // existing wins
    expect(merged.version).toBe('1.0');        // empty string overwritten
    expect(merged.organization).toBe('X');     // absent filled
    expect(merged.responsible).toBe('me');     // null overwritten
    expect(applied.sort()).toEqual(['organization', 'responsible', 'version'].sort());
  });

  test('empty existing still works', () => {
    const { merged, applied } = mergeMetadata({}, { year: '2026' });
    expect(merged.year).toBe('2026');
    expect(applied).toEqual(['year']);
  });
});
