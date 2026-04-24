const fs = require('fs');
const os = require('os');
const path = require('path');

const detect = require('../skills/gostdocs/scripts/adapters/schema/detect');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-sd-'));
}

function touch(root, relative, content = '') {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('detect', () => {
  test('finds schema.prisma -> prisma (supported)', () => {
    const root = tmpProject();
    touch(root, 'prisma/schema.prisma', '');
    const r = detect.detect(root);
    expect(r.framework).toBe('prisma');
    expect(r.supported).toBe(true);
  });

  test('finds alembic.ini -> alembic (unsupported)', () => {
    const root = tmpProject();
    touch(root, 'alembic.ini', '');
    const r = detect.detect(root);
    expect(r.framework).toBe('alembic');
    expect(r.supported).toBe(false);
  });

  test('finds manage.py -> django (unsupported)', () => {
    const root = tmpProject();
    touch(root, 'manage.py', '');
    const r = detect.detect(root);
    expect(r.framework).toBe('django');
  });

  test('finds knexfile.ts -> knex', () => {
    const root = tmpProject();
    touch(root, 'knexfile.ts', '');
    const r = detect.detect(root);
    expect(r.framework).toBe('knex');
  });

  test('finds .sequelizerc -> sequelize', () => {
    const root = tmpProject();
    touch(root, '.sequelizerc', '');
    const r = detect.detect(root);
    expect(r.framework).toBe('sequelize');
  });

  test('no markers returns null with remediation hint', () => {
    const root = tmpProject();
    const r = detect.detect(root);
    expect(r.framework).toBeNull();
    expect(r.hints.join(' ')).toMatch(/--live-db/);
  });

  test('skips node_modules', () => {
    const root = tmpProject();
    touch(root, 'node_modules/lib/schema.prisma', '');
    const r = detect.detect(root);
    expect(r.framework).toBeNull();
  });
});
