const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = require('../skills/gostdocs/scripts/lib/cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-cache-'));
}

describe('stableStringify + computeHash', () => {
  test('same keys in different order yield same hash', () => {
    const a = cache.computeHash({ foo: 1, bar: 2 });
    const b = cache.computeHash({ bar: 2, foo: 1 });
    expect(a).toBe(b);
  });

  test('different values yield different hashes', () => {
    expect(cache.computeHash({ foo: 1 })).not.toBe(cache.computeHash({ foo: 2 }));
  });

  test('nested objects are stable', () => {
    const a = cache.computeHash({ nested: { a: 1, b: 2 } });
    const b = cache.computeHash({ nested: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  test('_files entries hash file contents not paths', () => {
    const dir = tmpRoot();
    const f1 = path.join(dir, 'a.txt');
    const f2 = path.join(dir, 'b.txt');
    fs.writeFileSync(f1, 'hello');
    fs.writeFileSync(f2, 'hello');
    const h1 = cache.computeHash({ source_files: [f1] });
    const h2 = cache.computeHash({ source_files: [f2] });
    expect(h1).toBe(h2);

    fs.writeFileSync(f2, 'world');
    const h3 = cache.computeHash({ source_files: [f2] });
    expect(h3).not.toBe(h1);
  });
});

describe('get / set / invalidate', () => {
  test('miss when key absent', () => {
    const root = tmpRoot();
    const r = cache.get(root, 'x', { a: 1 });
    expect(r.hit).toBe(false);
  });

  test('hit after set', () => {
    const root = tmpRoot();
    cache.set(root, 'x', { a: 1 }, { result: 'ok' });
    const r = cache.get(root, 'x', { a: 1 });
    expect(r.hit).toBe(true);
    expect(r.value).toEqual({ result: 'ok' });
  });

  test('miss when input changes', () => {
    const root = tmpRoot();
    cache.set(root, 'x', { a: 1 }, { result: 'ok' });
    const r = cache.get(root, 'x', { a: 2 });
    expect(r.hit).toBe(false);
  });

  test('invalidate removes entry', () => {
    const root = tmpRoot();
    cache.set(root, 'x', { a: 1 }, { v: 1 });
    cache.invalidate(root, 'x');
    expect(cache.get(root, 'x', { a: 1 }).hit).toBe(false);
  });

  test('rejects invalid key names', () => {
    const root = tmpRoot();
    expect(() => cache.set(root, '../evil', {}, {})).toThrow(/Invalid cache key/);
    expect(() => cache.get(root, 'has space', {})).toThrow(/Invalid cache key/);
  });

  test('clear wipes directory', () => {
    const root = tmpRoot();
    cache.set(root, 'a', {}, {});
    cache.set(root, 'b', {}, {});
    cache.clear(root);
    expect(cache.get(root, 'a', {}).hit).toBe(false);
    expect(cache.get(root, 'b', {}).hit).toBe(false);
  });
});
