'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const introspect = require('../skills/gostdocs/scripts/lib/project-introspect');

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

  test('FastAPI via requirements.txt', () => {
    const root = makeTmpProject({
      'requirements.txt': 'fastapi==0.110\nuvicorn==0.27\n',
      'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('fastapi'); } finally { rm(root); }
  });

  test('FastAPI via pyproject.toml', () => {
    const root = makeTmpProject({
      'pyproject.toml': '[project]\nname = "x"\ndependencies = ["fastapi>=0.100"]\n',
      'main.py': '',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('fastapi'); } finally { rm(root); }
  });

  test('Flask via requirements.txt', () => {
    const root = makeTmpProject({
      'requirements.txt': 'Flask==3.0\n',
      'app.py': '',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('flask'); } finally { rm(root); }
  });

  test('Spring Boot via pom.xml', () => {
    const root = makeTmpProject({
      'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId></dependency></dependencies></project>',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('spring-boot'); } finally { rm(root); }
  });

  test('Spring Boot via build.gradle', () => {
    const root = makeTmpProject({
      'build.gradle': "plugins { id 'org.springframework.boot' version '3.2.0' }\n",
    });
    try { expect(introspect.detectFramework(root).framework).toBe('spring-boot'); } finally { rm(root); }
  });

  test('Phoenix via mix.exs', () => {
    const root = makeTmpProject({
      'mix.exs': 'defmodule MyApp.MixProject do\n  defp deps do\n    [{:phoenix, "~> 1.7"}]\n  end\nend\n',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('phoenix'); } finally { rm(root); }
  });

  test('Astro via astro.config.mjs', () => {
    const root = makeTmpProject({
      'astro.config.mjs': 'export default {}',
      'package.json': '{}',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('astro'); } finally { rm(root); }
  });

  test('Angular via angular.json', () => {
    const root = makeTmpProject({
      'angular.json': '{}',
      'package.json': JSON.stringify({ dependencies: { '@angular/core': '^17' } }),
    });
    try { expect(introspect.detectFramework(root).framework).toBe('angular'); } finally { rm(root); }
  });

  test('Remix via package.json @remix-run/react', () => {
    const root = makeTmpProject({
      'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '^2' } }),
    });
    try { expect(introspect.detectFramework(root).framework).toBe('remix'); } finally { rm(root); }
  });

  test('Go (Gin) via go.mod', () => {
    const root = makeTmpProject({
      'go.mod': 'module x\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('gin'); } finally { rm(root); }
  });

  test('Go (Echo) via go.mod', () => {
    const root = makeTmpProject({
      'go.mod': 'module x\n\nrequire github.com/labstack/echo/v4 v4.11\n',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('echo'); } finally { rm(root); }
  });

  test('.NET ASP.NET Core via .csproj', () => {
    const root = makeTmpProject({
      'MyApp.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
    });
    try { expect(introspect.detectFramework(root).framework).toBe('aspnet-core'); } finally { rm(root); }
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
  test('parses 12-factor DATABASE_URL into db_user/db_name/db_host/db_port', async () => {
    const root = makeTmpProject({
      '.env.example': 'DATABASE_URL=postgres://app_usr:app_pwd@db.local:5433/app_db\n',
    });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.derived.db_user).toBe('app_usr');
      expect(out.derived.db_name).toBe('app_db');
      expect(out.derived.db_host).toBe('db.local');
      expect(out.derived.db_port).toBe('5433');
    } finally { rm(root); }
  });

  test('parses MongoDB MONGODB_URI', async () => {
    const root = makeTmpProject({
      '.env.example': 'MONGODB_URI=mongodb://mongo_usr:secret@mongo:27017/myapp\n',
    });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.derived.db_user).toBe('mongo_usr');
      expect(out.derived.db_name).toBe('myapp');
      expect(out.derived.db_host).toBe('mongo');
      expect(out.derived.db_port).toBe('27017');
    } finally { rm(root); }
  });

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

describe('multistack detection', () => {
  test('monorepo with backend/composer.json + frontend/package.json returns both stacks', () => {
    const root = makeTmpProject({
      'backend/composer.json': JSON.stringify({ require: { 'yiisoft/yii2': '^2.0.50' } }),
      'frontend/package.json': JSON.stringify({
        dependencies: { vue: '^3.4.0', typescript: '^5.0.0' },
      }),
    });
    try {
      const manifest = introspect.buildStackManifest(root);
      expect(manifest.backend_stack).toEqual(expect.objectContaining({
        language: 'PHP', framework: 'Yii2', version: '2.0.50', manifest: 'backend/composer.json',
      }));
      expect(manifest.frontend_stack).toEqual(expect.objectContaining({
        language: 'TypeScript', framework: 'Vue', version: '3.4.0',
      }));
    } finally { rm(root); }
  });

  test('root workspaces-only package.json is skipped in favour of subdirs', () => {
    const root = makeTmpProject({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'frontend/package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    });
    try {
      const fe = introspect.detectFrontendStack(root);
      expect(fe.framework).toBe('React');
    } finally { rm(root); }
  });

  test('docker-compose image tags produce version records', () => {
    const root = makeTmpProject({
      'docker-compose.yml': [
        'services:',
        '  db:',
        '    image: postgres:14-alpine',
        '  cache:',
        '    image: "redis:7"',
        '  app:',
        '    build: .',
      ].join('\n'),
    });
    try {
      const manifest = introspect.buildStackManifest(root);
      const byName = Object.fromEntries(manifest.containers.map((c) => [c.name, c]));
      expect(byName.db.version).toBe('14-alpine');
      expect(byName.cache.version).toBe('7');
      expect(byName.app).toBeUndefined();
    } finally { rm(root); }
  });

  test('Python backend with Django detected via pyproject.toml', () => {
    const root = makeTmpProject({
      'backend/pyproject.toml': '[project]\ndependencies = ["django>=5.0.0"]\n',
    });
    try {
      const be = introspect.detectBackendStack(root);
      expect(be.language).toBe('Python');
      expect(be.framework).toBe('Django');
    } finally { rm(root); }
  });

  test('deriveProjectMetadata surfaces stack_manifest for monorepo layouts', async () => {
    const root = makeTmpProject({
      'backend/composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
      'frontend/package.json': JSON.stringify({ dependencies: { '@angular/core': '^17.0.0' } }),
    });
    try {
      const out = await introspect.deriveProjectMetadata(root, { gitRun: noopGit });
      expect(out.stack_manifest).toBeTruthy();
      expect(out.stack_manifest.backend_stack.framework).toBe('Laravel');
      expect(out.stack_manifest.frontend_stack.framework).toBe('Angular');
    } finally { rm(root); }
  });
});
