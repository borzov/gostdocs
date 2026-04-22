const fs = require('fs');
const os = require('os');
const path = require('path');

const scanner = require('../skills/gen-docs/scripts/adapters/role-discovery/scanner');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-scan-'));
}

function write(root, relative, content) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

describe('scanRolesInContent', () => {
  test('picks up whitelisted role literals', () => {
    const hits = scanner.scanRolesInContent(
      `const seed = [{role: 'admin'}, {role: 'moderator'}]`,
      '/fake/seeder.js',
    );
    const roles = hits.map((h) => h.role).sort();
    expect(roles).toEqual(expect.arrayContaining(['admin', 'moderator']));
  });

  test('parses TypeScript enum bodies', () => {
    const hits = scanner.scanRolesInContent(
      `export enum UserRole { Admin = 'admin', Editor = 'editor', Viewer = 'viewer' }`,
      '/fake/enum.ts',
    );
    const roles = hits.map((h) => h.role);
    expect(roles).toEqual(expect.arrayContaining(['admin', 'editor', 'viewer']));
  });

  test('parses const ROLES arrays', () => {
    const hits = scanner.scanRolesInContent(
      `const ROLES = ['admin', 'owner', 'analyst']`,
      '/fake/roles.js',
    );
    expect(hits.map((h) => h.role)).toEqual(expect.arrayContaining(['admin', 'owner', 'analyst']));
  });

  test('parses TS union types', () => {
    const hits = scanner.scanRolesInContent(
      `type UserRole = 'admin' | 'manager' | 'operator'`,
      '/fake/types.ts',
    );
    expect(hits.map((h) => h.role)).toEqual(expect.arrayContaining(['admin', 'manager', 'operator']));
  });

  test('deduplicates and assigns higher confidence for seeder files', () => {
    const hits = scanner.scanRolesInContent(
      `['admin','admin','admin']`,
      '/fake/DatabaseSeeder.php',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].confidence).toBe('high');
  });

  test('rejects non-string or overlong entries', () => {
    const bigName = 'x'.repeat(100);
    const hits = scanner.scanRolesInContent(
      `['${bigName}', 'admin']`,
      '/fake/seed.js',
    );
    expect(hits.map((h) => h.role)).toEqual(['admin']);
  });
});

describe('scanLoginEndpointsInContent', () => {
  test('detects login paths in router definitions', () => {
    const hits = scanner.scanLoginEndpointsInContent(
      `router.post('/api/auth/login', loginHandler); router.post('/auth/token', ...)`,
      '/fake/auth/router.js',
    );
    const paths = hits.map((h) => h.path);
    expect(paths).toEqual(expect.arrayContaining(['/api/auth/login', '/auth/token']));
  });

  test('assigns high confidence for auth-named files', () => {
    const hits = scanner.scanLoginEndpointsInContent(
      `path('/login/', views.login)`,
      '/fake/accounts/urls.py',
    );
    expect(hits[0].confidence).toBe('high');
  });

  test('returns empty for content without login paths', () => {
    expect(scanner.scanLoginEndpointsInContent(`get('/profile')`, '/x.js')).toEqual([]);
  });
});

describe('scanProject', () => {
  test('walks project tree and discovers roles + logins', () => {
    const root = tmpProject();
    write(root, 'database/seeders/UserSeeder.php', "['admin','user','operator']");
    write(root, 'src/enums/role.ts', `enum UserRole { Admin='admin', Manager='manager' }`);
    write(root, 'src/auth/routes.ts', `router.post('/api/login', loginHandler)`);
    write(root, 'node_modules/pkg/seeder.js', "['skipme']"); // inside skip dir
    write(root, 'README.md', '# docs');

    const result = scanner.scanProject(root);
    const roles = result.roles.map((r) => r.role);
    expect(roles).toEqual(expect.arrayContaining(['admin', 'user', 'operator', 'manager']));
    expect(roles).not.toContain('skipme');
    expect(result.loginEndpoints.some((l) => l.path === '/api/login')).toBe(true);
  });

  test('returns warning for missing root', () => {
    const result = scanner.scanProject('/nonexistent/path/abc123xyz');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.roles).toEqual([]);
  });
});
