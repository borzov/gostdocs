const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../skills/gostdocs/scripts/lib/inspection-store');
const schema = require('../skills/gostdocs/scripts/lib/inspection-schema');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-insp-'));
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

describe('title de-duplication on write', () => {
  test('appends URL suffix when same-slice title already exists', () => {
    const project = tmpProject();
    const a = schema.empty('admin/desktop/verify-email.png', 'admin', 'desktop');
    a.title = 'Подтверждение email';
    store.write(project, 'admin/desktop/verify-email.png', a);

    const b = schema.empty('admin/desktop/verification-notice.png', 'admin', 'desktop');
    b.title = 'Подтверждение email';
    const warnings = [];
    store.write(project, 'admin/desktop/verification-notice.png', b, { warnings });

    const written = store.read(project, 'admin/desktop/verification-notice.png');
    expect(written.title).not.toBe('Подтверждение email');
    expect(written.title.startsWith('Подтверждение email — /')).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].scope).toBe('inspection:title-dedup');
  });

  test('leaves title untouched when collision is in a different role slice', () => {
    const project = tmpProject();
    const a = schema.empty('admin/desktop/home.png', 'admin', 'desktop');
    a.title = 'Главная страница';
    store.write(project, 'admin/desktop/home.png', a);

    const b = schema.empty('user/desktop/home.png', 'user', 'desktop');
    b.title = 'Главная страница';
    store.write(project, 'user/desktop/home.png', b);

    const written = store.read(project, 'user/desktop/home.png');
    expect(written.title).toBe('Главная страница');
  });

  test('skipDedupe option preserves the original title verbatim', () => {
    const project = tmpProject();
    const a = schema.empty('admin/desktop/a.png', 'admin', 'desktop');
    a.title = 'Отчёт';
    store.write(project, 'admin/desktop/a.png', a);
    const b = schema.empty('admin/desktop/b.png', 'admin', 'desktop');
    b.title = 'Отчёт';
    store.write(project, 'admin/desktop/b.png', b, { skipDedupe: true });
    const written = store.read(project, 'admin/desktop/b.png');
    expect(written.title).toBe('Отчёт');
  });
});
