const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../skills/gen-docs/scripts/lib/inspection-store');
const schema = require('../skills/gen-docs/scripts/lib/inspection-schema');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-insp-'));
}

describe('resolveJsonPath', () => {
  test('mirrors capture path under _inspection/', () => {
    const p = store.resolveJsonPath('/tmp/p', 'admin/desktop/ru/home.png');
    expect(p).toBe('/tmp/p/docs/generated/_inspection/admin/desktop/ru/home.json');
  });

  test('rejects empty capture file', () => {
    expect(() => store.resolveJsonPath('/tmp/p', '')).toThrow();
  });
});

describe('write + read', () => {
  test('roundtrip', () => {
    const project = tmpProject();
    const captureFile = 'admin/desktop/home.png';
    const data = schema.empty(captureFile, 'admin', 'desktop');
    data.title = 'Admin home';
    data.breadcrumb = ['Home'];
    store.write(project, captureFile, data);
    const readBack = store.read(project, captureFile);
    expect(readBack.title).toBe('Admin home');
    expect(store.exists(project, captureFile)).toBe(true);
  });
});

describe('listAll', () => {
  test('walks tree and returns valid records', () => {
    const project = tmpProject();
    const a = schema.empty('admin/desktop/a.png', 'admin', 'desktop');
    a.is_login_form = true;
    store.write(project, 'admin/desktop/a.png', a);
    store.write(project, 'user/desktop/b.png', schema.empty('user/desktop/b.png', 'user', 'desktop'));
    const all = store.listAll(project);
    expect(all).toHaveLength(2);
    const loginOnes = all.filter((e) => e.data.is_login_form);
    expect(loginOnes).toHaveLength(1);
  });

  test('returns [] when directory missing', () => {
    expect(store.listAll('/nonexistent/abc')).toEqual([]);
  });
});
