'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const introspect = require('../skills/gen-docs/scripts/lib/project-introspect');

function makeTmpProject(layout = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'introspect-'));
  for (const [rel, contents] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function rm(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const noopGit = async () => ({ stdout: '', code: -1 });

describe('detectFramework', () => {
  test('Laravel via artisan file', () => {
    const root = makeTmpProject({ artisan: '#!/usr/bin/env php\n', 'composer.json': '{}' });
    try { expect(introspect.detectFramework(root).framework).toBe('laravel'); } finally { rm(root); }
  });

  test('Yii via yii file', () => {
    const root = makeTmpProject({ yii: '#!/usr/bin/env php\n', 'composer.json': '{}' });
    try { expect(introspect.detectFramework(root).framework).toBe('yii'); } finally { rm(root); }
  });

  test('Symfony via bin/console', () => {
    const root = makeTmpProject({ 'bin/console': '#!/usr/bin/env php\n', 'composer.json': '{}' });
    try { expect(introspect.detectFramework(root).framework).toBe('symfony'); } finally { rm(root); }
  });

  test('Django via manage.py', () => {
    const root = makeTmpProject({ 'manage.py': '#!/usr/bin/env python\n' });
    try { expect(introspect.detectFramework(root).framework).toBe('django'); } finally { rm(root); }
  });

  test('Rails via bin/rails', () => {
    const root = makeTmpProject({ 'bin/rails': '#!/usr/bin/env ruby\n', Gemfile: '' });
    try { expect(introspect.detectFramework(root).framework).toBe('rails'); } finally { rm(root); }
  });

  test('Next.js via next.config.js', () => {
    const root = makeTmpProject({
      'next.config.js': 'module.exports = {}',
      'package.json': JSON.stringify({ dependencies: { next: '^14' } }),
    });
    try { expect(introspect.detectFramework(root).framework).toBe('next'); } finally { rm(root); }
  });

  test('Nuxt via nuxt.config.ts', () => {
    const root = makeTmpProject({ 'nuxt.config.ts': '', 'package.json': '{}' });
    try { expect(introspect.detectFramework(root).framework).toBe('nuxt'); } finally { rm(root); }
  });

  test('SvelteKit via svelte.config.js + @sveltejs/kit', () => {
    const root = makeTmpProject({
      'svelte.config.js': '',
      'package.json': JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2' } }),
    });
    try { expect(introspect.detectFramework(root).framework).toBe('sveltekit'); } finally { rm(root); }
  });

  test('Express by dependency in package.json', () => {
    const root = makeTmpProject({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
    });
    try { expect(introspect.detectFramework(root).framework).toBe('express'); } finally { rm(root); }
  });

  test('returns null when nothing matches', () => {
    const root = makeTmpProject({ 'README.md': '# x' });
    try { expect(introspect.detectFramework(root).framework).toBeNull(); } finally { rm(root); }
  });
});

describe('extractEnvVars', () => {
  test('parses .env.example with comments and quoted values', () => {
    const root = makeTmpProject({
      '.env.example': [
        '# Database',
        'DB_HOST=db',
        'DB_PORT=5432',
        'DB_NAME="my_app"',
        "DB_USER='app_user'",
        'DB_PASSWORD=changeme',
        '',
        'APP_PORT=8080',
      ].join('\n'),
    });
    try {
      const vars = introspect.extractEnvVars(root);
      expect(vars.DB_HOST).toBe('db');
      expect(vars.DB_NAME).toBe('my_app');
      expect(vars.DB_USER).toBe('app_user');
      expect(vars.APP_PORT).toBe('8080');
    } finally { rm(root); }
  });

  test('falls back to .env.template / .env.dist', () => {
    const r1 = makeTmpProject({ '.env.template': 'DB_NAME=tpl\n' });
    const r2 = makeTmpProject({ '.env.dist': 'DB_NAME=dist\n' });
    try {
      expect(introspect.extractEnvVars(r1).DB_NAME).toBe('tpl');
      expect(introspect.extractEnvVars(r2).DB_NAME).toBe('dist');
    } finally { rm(r1); rm(r2); }
  });

  test('returns empty object when no env file present', () => {
    const root = makeTmpProject({ 'README.md': 'x' });
    try { expect(introspect.extractEnvVars(root)).toEqual({}); } finally { rm(root); }
  });
});

describe('extractDockerCompose', () => {
  test('returns service names from docker-compose.yml', () => {
    const root = makeTmpProject({
      'docker-compose.yml': [
        'services:',
        '  app:',
        '    image: php:8.2',
        '  db:',
        '    image: postgres:16',
        '  redis:',
        '    image: redis:7',
      ].join('\n'),
    });
    try {
      const out = introspect.extractDockerCompose(root);
      expect(out.services).toEqual(['app', 'db', 'redis']);
      expect(out.primary_service).toBe('app');
    } finally { rm(root); }
  });

  test('picks "app"/"web"/"backend" as primary, in that order', () => {
    const root = makeTmpProject({
      'docker-compose.yml': 'services:\n  db:\n  web:\n  worker:\n',
    });
    try { expect(introspect.extractDockerCompose(root).primary_service).toBe('web'); } finally { rm(root); }
  });

  test('falls back to first service when no canonical name present', () => {
    const root = makeTmpProject({
      'docker-compose.yml': 'services:\n  api:\n  cache:\n',
    });
    try { expect(introspect.extractDockerCompose(root).primary_service).toBe('api'); } finally { rm(root); }
  });

  test('returns empty when file missing', () => {
    const root = makeTmpProject({ 'README.md': 'x' });
    try {
      const out = introspect.extractDockerCompose(root);
      expect(out.services).toEqual([]);
      expect(out.primary_service).toBeNull();
    } finally { rm(root); }
  });
});

describe('inferMigrationCommands', () => {
  test('Laravel defaults', () => {
    const cmds = introspect.inferMigrationCommands('laravel', {});
    expect(cmds.migration_command).toBe('php artisan migrate');
    expect(cmds.seed_command).toBe('php artisan db:seed');
  });

  test('Django defaults', () => {
    const cmds = introspect.inferMigrationCommands('django', {});
    expect(cmds.migration_command).toBe('python manage.py migrate');
    expect(cmds.seed_command).toBeNull(); // Django has no seed convention
  });

  test('Yii defaults', () => {
    const cmds = introspect.inferMigrationCommands('yii', {});
    expect(cmds.migration_command).toBe('php yii migrate');
  });

  test('Symfony defaults (Doctrine)', () => {
    const cmds = introspect.inferMigrationCommands('symfony', {});
    expect(cmds.migration_command).toBe('php bin/console doctrine:migrations:migrate');
  });

  test('Rails defaults', () => {
    const cmds = introspect.inferMigrationCommands('rails', {});
    expect(cmds.migration_command).toBe('bin/rails db:migrate');
    expect(cmds.seed_command).toBe('bin/rails db:seed');
  });

  test('package.json scripts win over framework defaults', () => {
    const cmds = introspect.inferMigrationCommands('laravel', {
      packageJsonScripts: { migrate: 'npx prisma migrate deploy', seed: 'npm run seed:db' },
    });
    expect(cmds.migration_command).toBe('npm run migrate');
    expect(cmds.seed_command).toBe('npm run seed');
  });

  test('Makefile targets win over framework defaults', () => {
    const cmds = introspect.inferMigrationCommands('django', {
      makefileTargets: ['migrate', 'seed', 'test'],
    });
    expect(cmds.migration_command).toBe('make migrate');
    expect(cmds.seed_command).toBe('make seed');
  });

  test('null framework + no manifests → all null', () => {
    expect(introspect.inferMigrationCommands(null, {})).toEqual({
      migration_command: null,
      seed_command: null,
    });
  });
});

describe('extractMakefileTargets', () => {
  test('lists target names from a Makefile', () => {
    const root = makeTmpProject({
      Makefile: [
        '.PHONY: migrate seed test',
        '',
        'migrate:',
        '\tdocker compose exec app php artisan migrate',
        '',
        'seed:',
        '\tdocker compose exec app php artisan db:seed',
        '',
        'test:',
        '\tphpunit',
      ].join('\n'),
    });
    try {
      expect(introspect.extractMakefileTargets(root).sort()).toEqual(['migrate', 'seed', 'test']);
    } finally { rm(root); }
  });

  test('returns empty array when Makefile missing', () => {
    const root = makeTmpProject({});
    try { expect(introspect.extractMakefileTargets(root)).toEqual([]); } finally { rm(root); }
  });
});

describe('deriveProjectMetadata — end-to-end', () => {
  test('recognises Laravel-style DB_DATABASE / DB_USERNAME aliases', async () => {
    const root = makeTmpProject({
      artisan: '#!/usr/bin/env php\n',
      '.env.example': 'DB_HOST=db\nDB_PORT=5432\nDB_DATABASE=acme_db\nDB_USERNAME=acme_usr\nDB_PASSWORD=changeme\n',
    });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.derived.db_name).toBe('acme_db');
      expect(out.derived.db_user).toBe('acme_usr');
    } finally { rm(root); }
  });

  test('Laravel + docker-compose + .env.example → full coverage', async () => {
    const root = makeTmpProject({
      artisan: '#!/usr/bin/env php\n',
      'composer.json': JSON.stringify({ name: 'acme/myapp', version: '1.2.3' }),
      'docker-compose.yml': [
        'services:',
        '  app:',
        '    build: .',
        '    ports: ["8080:8080"]',
        '  db:',
        '    image: postgres:16',
      ].join('\n'),
      '.env.example': 'DB_HOST=db\nDB_PORT=5432\nDB_NAME=acme\nDB_USER=acme_user\nDB_PASSWORD=changeme\nAPP_PORT=8080\n',
    });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.framework).toBe('laravel');
      expect(out.derived.db_user).toBe('acme_user');
      expect(out.derived.db_name).toBe('acme');
      expect(out.derived.db_host).toBe('db');
      expect(out.derived.service_name).toBe('app');
      expect(out.derived.migration_command).toBe('php artisan migrate');
      expect(out.derived.seed_command).toBe('php artisan db:seed');
      // Sources are recorded so the orchestrator can show provenance to the user.
      expect(out.sources.framework).toBe('artisan');
      expect(out.sources.db_user).toBe('.env.example');
      expect(out.sources.migration_command).toMatch(/framework/);
    } finally { rm(root); }
  });

  test('repo_url comes from `git remote get-url origin` when available', async () => {
    const root = makeTmpProject({});
    const gitRun = async (args) => {
      const tail = args.slice(-3).join(' ');
      if (tail === 'remote get-url origin') return { stdout: 'git@github.com:acme/myapp.git', code: 0 };
      return { stdout: '', code: -1 };
    };
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun });
      expect(out.derived.repo_url).toBe('git@github.com:acme/myapp.git');
      expect(out.sources.repo_url).toBe('git remote');
    } finally { rm(root); }
  });

  test('completely unknown project: derived is empty, no error', async () => {
    const root = makeTmpProject({ 'README.md': 'x' });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.framework).toBeNull();
      expect(out.derived).toEqual({});
      expect(out.sources).toEqual({});
    } finally { rm(root); }
  });
});
