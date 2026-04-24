'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const autoSections = require('../skills/gostdocs/scripts/lib/auto-sections');

function mkProj(layout = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  for (const rel of Object.keys(layout)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(abs, { recursive: true });
  }
  return root;
}

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

describe('buildExtensionPoints', () => {
  test('detects top-level adapter / plugin / modules directories', () => {
    const root = mkProj({
      'adapters/openapi': {},
      'plugins/foo': {},
      'plugins/bar': {},
    });
    try {
      const out = autoSections.buildExtensionPoints({ projectPath: root });
      const text = out.map((e) => e.text || e.content || '').join('\n');
      expect(text).toMatch(/`adapters\/`/);
      expect(text).toMatch(/`plugins\/`/);
      expect(text).toMatch(/2 элемента/); // 2 plugins
    } finally { rm(root); }
  });

  test('walks one level deep into subdirectories', () => {
    const root = mkProj({
      'backend/modules/user': {},
      'backend/modules/event': {},
      'src/hooks/before-save': {},
    });
    try {
      const out = autoSections.buildExtensionPoints({ projectPath: root });
      const text = out.map((e) => e.text || e.content || '').join('\n');
      expect(text).toMatch(/`backend\/modules\/`/);
      expect(text).toMatch(/`src\/hooks\/`/);
    } finally { rm(root); }
  });

  test('returns a TODO admonition when no conventional dir exists', () => {
    const root = mkProj({ 'src/something': {} });
    try {
      const out = autoSections.buildExtensionPoints({ projectPath: root });
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('admonition');
      expect(out[0].kind).toBe('todo');
    } finally { rm(root); }
  });

  test('ignores node_modules, vendor, .git, docs', () => {
    const root = mkProj({
      'node_modules/adapters': {},
      'vendor/plugins': {},
      'docs/hooks': {},
    });
    try {
      const out = autoSections.buildExtensionPoints({ projectPath: root });
      expect(out[0].type).toBe('admonition');
    } finally { rm(root); }
  });
});

describe('buildDistributionComposition', () => {
  test('summarises services + env + migration + seed when all present', () => {
    const ctx = {
      introspect: {
        services: ['nginx', 'backend', 'db', 'redis'],
        env: { keys: ['APP_URL', 'DB_URL', 'REDIS_URL'], source: '.env.example' },
        derived: {
          migration_command: 'php yii migrate',
          seed_command: 'php yii seed',
          repo_url: 'git@github.com:acme/project.git',
        },
      },
    };
    const [para] = autoSections.buildDistributionComposition(ctx, { lang: 'ru' });
    expect(para.text).toMatch(/4 сервиса/);
    expect(para.text).toMatch(/nginx, backend, db, redis/);
    expect(para.text).toMatch(/3 переменные конфигурации/);
    expect(para.text).toMatch(/php yii migrate/);
    expect(para.text).toMatch(/github\.com:acme/);
  });

  test('returns TODO when nothing is known', () => {
    const out = autoSections.buildDistributionComposition({ introspect: {} });
    expect(out[0].type).toBe('admonition');
  });
});

describe('buildSmokeScenarios', () => {
  test('emits one scenario per role with credentials', () => {
    const meta = {
      app: { url: 'http://localhost:5173' },
      auth: { roles: [
        { role: 'guest' },
        { role: 'admin', username: 'a@x.com', password: 'p' },
        { role: 'user',  username: 'u@x.com', password: 'p' },
      ] },
      pages: [
        { id: 'home', path: '/', access_role: 'guest' },
        { id: 'settings', path: '/admin/settings', access_role: 'admin' },
      ],
    };
    const out = autoSections.buildSmokeScenarios({ meta });
    const text = out.map((e) => e.text || e.content || '').join('\n');
    expect(text).toMatch(/Сценарий для роли admin/);
    expect(text).toMatch(/Сценарий для роли user/);
    expect(text).toMatch(/a@x\.com/);
    expect(text).not.toMatch(/Сценарий для роли guest/);
  });

  test('TODO when no roles have credentials', () => {
    const out = autoSections.buildSmokeScenarios({ meta: { auth: { roles: [{ role: 'guest' }] } } });
    expect(out[0].type).toBe('admonition');
  });
});

describe('buildCommonIssues', () => {
  test('expands templates for detected services', () => {
    const out = autoSections.buildCommonIssues({
      introspect: { services: ['db', 'redis', 'backend'] },
    }, { lang: 'ru' });
    const text = out.map((e) => e.text).join(' ');
    expect(text).toMatch(/database system is ready/);
    expect(text).toMatch(/6379/);
    expect(text).toMatch(/port is already allocated/);
  });

  test('always includes the generic port-conflict entry', () => {
    const out = autoSections.buildCommonIssues({ introspect: { services: [] } }, { lang: 'ru' });
    const text = out.map((e) => e.text).join(' ');
    expect(text).toMatch(/port is already allocated/);
  });
});

describe('buildMaintenanceContacts', () => {
  test('derives issue-tracker URL from github remote', () => {
    const ctx = {
      meta: { metadata: {} },
      introspect: { derived: { repo_url: 'git@github.com:borzov/gostdocs.git' } },
    };
    const [para] = autoSections.buildMaintenanceContacts(ctx);
    expect(para.text).toMatch(/https:\/\/github\.com\/borzov\/gostdocs\/issues/);
  });

  test('prefers explicit meta.metadata.responsible', () => {
    const ctx = {
      meta: { metadata: { responsible: 'ООО «Рувентс»', support_email: 'ops@ruvents.ru' } },
      introspect: { derived: {} },
    };
    const [para] = autoSections.buildMaintenanceContacts(ctx);
    expect(para.text).toMatch(/ООО «Рувентс»/);
    expect(para.text).toMatch(/ops@ruvents\.ru/);
  });

  test('TODO when nothing is available', () => {
    const out = autoSections.buildMaintenanceContacts({ meta: {}, introspect: { derived: {} } });
    expect(out[0].type).toBe('admonition');
  });
});
