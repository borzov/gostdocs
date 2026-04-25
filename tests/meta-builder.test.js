'use strict';

const { buildMeta, propose } = require('../skills/gostdocs/scripts/lib/meta-builder');

const MIN_EXISTING = {
  project_path: '/p',
  doc_types: ['user-guide'],
  gost_mode: 'strict',
  app: { url: 'http://localhost:3000', launch: 'url' },
};

describe('propose — defaults from introspect', () => {
  test('uses meta.app.url-derived port and system_url', () => {
    const out = propose({}, {
      projectPath: '/tmp/myapp',
      introspect: {
        derived: { port: '5173', system_url: 'localhost:5173', project_dir: 'myapp', db_user: 'app', db_name: 'app', service_name: 'backend', migration_command: 'make migrate', seed_command: 'make seed', repo_url: 'git@github.com:org/myapp.git' },
        framework: 'laravel',
      },
      routes: [],
    });
    expect(out.metadata.port).toBe('5173');
    expect(out.metadata.system_url).toBe('localhost:5173');
    expect(out.metadata.db_user).toBe('app');
    expect(out.metadata.repo_url).toBe('git@github.com:org/myapp.git');
    expect(out.metadata.migration_command).toBe('make migrate');
  });

  test('proposes pages from routes (id, path, title, access_role)', () => {
    const out = propose({}, {
      projectPath: '/p',
      introspect: { derived: {}, framework: null },
      routes: [
        { id: 'home', path: '/', title: 'Главная', access_role: 'guest' },
        { id: 'admin', path: '/admin', title: 'Админка', access_role: 'admin' },
      ],
    });
    expect(out.pages).toEqual([
      expect.objectContaining({ id: 'home', path: '/', access_role: 'guest' }),
      expect.objectContaining({ id: 'admin', path: '/admin', access_role: 'admin' }),
    ]);
  });

  test('proposes auth.roles from discovered roles list', () => {
    const out = propose({}, {
      projectPath: '/p',
      introspect: { derived: {}, framework: null },
      routes: [],
      roles: ['guest', 'user', 'admin'],
    });
    const roleNames = out.auth.roles.map((r) => r.role);
    expect(roleNames).toEqual(['guest', 'user', 'admin']);
    // Guest role has no credentials
    const guest = out.auth.roles.find((r) => r.role === 'guest');
    expect(guest.credentials).toBeNull();
  });

  test('preserves existing user-set fields over proposed values', () => {
    const existing = {
      project_path: '/p',
      doc_types: ['admin-guide'],
      gost_mode: 'lite',
      app: { url: 'http://prod.example.com', launch: 'url' },
      metadata: { system_name: 'Custom Name', port: '9999' },
    };
    const out = propose(existing, {
      projectPath: '/p',
      introspect: { derived: { port: '5173', system_url: 'localhost:5173' }, framework: null },
      routes: [],
    });
    // existing port wins
    expect(out.metadata.port).toBe('9999');
    expect(out.metadata.system_name).toBe('Custom Name');
    expect(out.app.url).toBe('http://prod.example.com');
    // but introspect-only fields fill in
    expect(out.metadata.system_url).toBe('localhost:5173');
  });
});

describe('buildMeta — final assembly + validation', () => {
  test('produces a meta object that passes the current schema', () => {
    const meta = buildMeta({
      existing: MIN_EXISTING,
      introspect: { derived: { port: '3000' }, framework: null },
      routes: [{ id: 'home', path: '/', title: 'Home', access_role: 'guest' }],
      roles: ['guest'],
      answers: { 'metadata.organization': 'ACME', 'metadata.system_name': 'MyApp' },
    });
    expect(meta.metadata.organization).toBe('ACME');
    expect(meta.metadata.system_name).toBe('MyApp');
    expect(meta.pages).toHaveLength(1);
    expect(meta.skill_version).toBe('1.0.0');
  });

  test('answers can fill credentials per role via dotted path', () => {
    const meta = buildMeta({
      existing: MIN_EXISTING,
      introspect: { derived: {}, framework: null },
      routes: [],
      roles: ['admin'],
      answers: {
        'auth.roles[admin].username': 'admin@example.com',
        'auth.roles[admin].password': 'secret123',
      },
    });
    const admin = meta.auth.roles.find((r) => r.role === 'admin');
    expect(admin.username).toBe('admin@example.com');
    expect(admin.password).toBe('secret123');
  });

  test('throws on schema validation failure (missing required app.url)', () => {
    expect(() => buildMeta({
      existing: { project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict' },
      introspect: { derived: {}, framework: null },
      routes: [],
      roles: [],
      answers: {},
    })).toThrow();
  });

  test('answer for metadata.repo_url with the literal "—" persists as such', () => {
    const meta = buildMeta({
      existing: MIN_EXISTING,
      introspect: { derived: {}, framework: null },
      routes: [],
      roles: [],
      answers: { 'metadata.repo_url': '—' },
    });
    expect(meta.metadata.repo_url).toBe('—');
  });
});
