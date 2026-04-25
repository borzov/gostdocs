const fs = require('fs');
const os = require('os');
const path = require('path');

const meta = require('../skills/gostdocs/scripts/lib/meta');

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-meta-'));
  const file = path.join(dir, 'meta.yaml');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

describe('semverCompare', () => {
  test.each([
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.2.0', 0],
    ['0.3.0', '0.2.0', 1],
    ['0.2.0', '0.3.0-dev', -1],
    ['0.3.0', '0.3.0-dev', 1],
  ])('%s vs %s = %i', (a, b, expected) => {
    expect(meta.semverCompare(a, b)).toBe(expected);
  });
});

describe('migrate v0.2 -> v0.3', () => {
  test('wraps top-level app_url/app_launch into app.*', () => {
    const { data, log } = meta.migrate({
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'lite',
      app_url: 'http://localhost:3000',
      app_launch: 'url',
      skill_version: '0.2.0',
    });
    expect(data.app).toEqual({ url: 'http://localhost:3000', launch: 'url' });
    expect(data.app_url).toBeUndefined();
    expect(log.some((l) => l.includes('app_url'))).toBe(true);
    expect(data.skill_version).toBe('1.0.0');
  });

  test('wraps auth_roles into auth.roles with form-login defaults', () => {
    const { data, log } = meta.migrate({
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'lite',
      app_url: 'http://localhost:3000',
      auth_roles: [
        { role: 'admin', login_url: '/login', username: 'a', password: 'b' },
      ],
      skill_version: '0.2.0',
    });
    expect(data.auth.method).toBe('form');
    expect(data.auth.storage).toBe('cookie');
    expect(data.auth.roles).toHaveLength(1);
    expect(data.auth.roles[0].role).toBe('admin');
    expect(log.some((l) => l.includes('auth_roles'))).toBe(true);
  });

  test('initialises missing blocks with defaults', () => {
    const { data } = meta.migrate({
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'lite',
      app_url: 'http://localhost:3000',
    });
    expect(data.capture.viewports).toHaveLength(1);
    expect(data.capture.viewports[0].name).toBe('desktop');
    expect(data.output.languages).toEqual(['ru']);
    expect(data.vision.provider).toBe('claude');
    expect(data.precheck).toEqual({ min_entities: {} });
  });

  test('already-current meta is not touched', () => {
    const input = {
      skill_version: '1.0.0',
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'lite',
      app: { url: 'http://x', launch: 'url' },
      auth: { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [] },
      capture: {
        viewports: [{ name: 'desktop', width: 1280, height: 800 }],
        themes: [],
        locales: [],
        wait_after_navigation: 2000,
        timeout: 30000,
      },
      output: { languages: ['ru'], formats: ['docx'] },
      vision: { provider: 'claude' },
      precheck: { min_entities: {} },
    };
    const { data, log } = meta.migrate(input);
    expect(log).toEqual([]);
    expect(data).toEqual(input);
  });

  test('rejects non-object input', () => {
    expect(() => meta.migrate(null)).toThrow(/mapping/);
    expect(() => meta.migrate('string')).toThrow(/mapping/);
  });
});

describe('validate', () => {
  test('minimal valid v0.3 passes', () => {
    const input = {
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'lite',
      app: { url: 'http://localhost:3000', launch: 'url' },
    };
    const out = meta.validate(input);
    expect(out.skill_version).toBe('1.0.0');
    expect(out.capture.viewports).toHaveLength(1);
    expect(out.output.languages).toEqual(['ru']);
  });

  test('rejects unknown top-level keys', () => {
    expect(() =>
      meta.validate({
        project_path: '/p',
        doc_types: ['x'],
        gost_mode: 'lite',
        app: { url: 'http://x', launch: 'url' },
        foo_bar: 1,
      }),
    ).toThrow();
  });

  test('rejects bad gost_mode', () => {
    expect(() =>
      meta.validate({
        project_path: '/p',
        doc_types: ['x'],
        gost_mode: 'banana',
        app: { url: 'http://x', launch: 'url' },
      }),
    ).toThrow();
  });
});

describe('load roundtrip', () => {
  test('reads v0.2 file and migrates', () => {
    const file = tmpFile(
      [
        'project_path: /tmp/p',
        'doc_types:',
        '  - user-guide',
        'gost_mode: lite',
        'app_url: http://localhost:3000',
        'app_launch: url',
        'skill_version: "0.2.0"',
      ].join('\n'),
    );
    const { data, log } = meta.load(file);
    expect(data.app.url).toBe('http://localhost:3000');
    expect(data.skill_version).toBe('1.0.0');
    expect(log.length).toBeGreaterThan(0);
  });

  test('save + load preserves shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-meta-'));
    const file = path.join(dir, 'meta.yaml');
    const obj = {
      project_path: '/p',
      doc_types: ['user-guide'],
      gost_mode: 'strict',
      app: { url: 'http://localhost:3000', launch: 'url' },
    };
    meta.save(file, obj);
    const { data } = meta.load(file);
    expect(data.project_path).toBe('/p');
    expect(data.app.url).toBe('http://localhost:3000');
    expect(data.gost_mode).toBe('strict');
  });
});
