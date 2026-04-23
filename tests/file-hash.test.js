const fs = require('fs');
const os = require('os');
const path = require('path');

const fileHash = require('../skills/gen-docs/scripts/lib/file-hash');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-fh-'));
}

describe('sha256Buffer', () => {
  test('stable across same inputs', () => {
    expect(fileHash.sha256Buffer(Buffer.from([1, 2, 3])))
      .toBe(fileHash.sha256Buffer(Buffer.from([1, 2, 3])));
  });

  test('differs for different inputs', () => {
    expect(fileHash.sha256Buffer(Buffer.from([1, 2, 3])))
      .not.toBe(fileHash.sha256Buffer(Buffer.from([1, 2, 4])));
  });
});

describe('sha256File', () => {
  test('hashes an on-disk file', () => {
    const dir = tmp();
    const f = path.join(dir, 'a');
    fs.writeFileSync(f, 'hello');
    expect(fileHash.sha256File(f)).toBe(fileHash.sha256Buffer(Buffer.from('hello')));
  });

  test('readFile override skips disk', () => {
    const h = fileHash.sha256File('/nonexistent', { readFile: () => Buffer.from('x') });
    expect(h).toBe(fileHash.sha256Buffer(Buffer.from('x')));
  });
});

describe('detectDuplicates', () => {
  test('groups identical-content files', () => {
    const readFile = (p) => ({
      '/a': Buffer.from('x'),
      '/b': Buffer.from('x'),
      '/c': Buffer.from('y'),
    }[p]);
    const { duplicates, warnings } = fileHash.detectDuplicates(['/a', '/b', '/c'], { readFile });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].files).toEqual(['/a', '/b']);
    expect(warnings).toEqual([]);
  });

  test('reports missing files', () => {
    const readFile = (p) => {
      if (p === '/exists') return Buffer.from('x');
      throw new Error('missing');
    };
    const { warnings } = fileHash.detectDuplicates(['/exists', '/missing'], { readFile });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/missing/);
  });

  test('empty list returns empty result', () => {
    expect(fileHash.detectDuplicates([])).toEqual({ duplicates: [], warnings: [] });
  });
});
