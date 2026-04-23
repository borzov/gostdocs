const fs = require('fs');
const os = require('os');
const path = require('path');

const manifest = require('../skills/gen-docs/scripts/lib/manifest');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-manifest-'));
}

describe('buildFilename', () => {
  test('collapses missing axes', () => {
    expect(manifest.buildFilename({
      id: 'home', role: 'admin', viewport: 'desktop',
    })).toBe('admin/desktop/home.png');
  });

  test('includes theme / locale / state', () => {
    expect(manifest.buildFilename({
      id: 'home', role: 'admin', viewport: 'desktop',
      theme: 'dark', locale: 'ru', state: 'empty',
    })).toBe('admin/desktop/dark/ru/home__empty.png');
  });

  test('sanitises unsafe characters', () => {
    expect(manifest.buildFilename({
      id: 'page/with/slashes', role: 'ad min', viewport: 'desktop',
    })).toBe('ad-min/desktop/page-with-slashes.png');
  });
});

describe('emptyManifest + validate', () => {
  test('empty manifest validates', () => {
    const m = manifest.emptyManifest('http://localhost:3000');
    const out = manifest.validate(m);
    expect(out.version).toBe('2.0');
    expect(out.captures).toEqual([]);
  });

  test('rejects unknown top-level keys', () => {
    expect(() => manifest.validate({
      version: '2.0', generated_at: 't', base_url: 'u', captures: [], foo: 1,
    })).toThrow();
  });
});

describe('upsertCapture', () => {
  test('adds new capture and role', () => {
    const m = manifest.emptyManifest('http://x');
    manifest.upsertCapture(m, {
      id: 'home', path: '/', role: 'admin', viewport: 'desktop',
      file: 'admin/desktop/home.png', success: true, access: 'public',
    });
    expect(m.captures).toHaveLength(1);
    expect(m.roles).toEqual(['admin']);
  });

  test('replaces entry with same file', () => {
    const m = manifest.emptyManifest('http://x');
    manifest.upsertCapture(m, {
      id: 'home', path: '/', role: 'admin', viewport: 'desktop',
      file: 'admin/desktop/home.png', success: false, access: 'public',
    });
    manifest.upsertCapture(m, {
      id: 'home', path: '/', role: 'admin', viewport: 'desktop',
      file: 'admin/desktop/home.png', success: true, access: 'public',
    });
    expect(m.captures).toHaveLength(1);
    expect(m.captures[0].success).toBe(true);
  });

  test('rejects malformed capture', () => {
    const m = manifest.emptyManifest('http://x');
    expect(() => manifest.upsertCapture(m, { id: 'x' })).toThrow();
  });
});

describe('read / write', () => {
  test('roundtrip', () => {
    const dir = tmp();
    const file = path.join(dir, 'manifest.json');
    const m = manifest.emptyManifest('http://x');
    manifest.upsertCapture(m, {
      id: 'home', path: '/', role: 'admin', viewport: 'desktop',
      file: 'admin/desktop/home.png', success: true, access: 'public',
    });
    manifest.write(file, m);
    const readBack = manifest.read(file);
    expect(readBack.captures).toHaveLength(1);
    expect(readBack.roles).toEqual(['admin']);
  });
});
