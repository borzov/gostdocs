'use strict';

/**
 * Universal project metadata extractor.
 *
 * Scans a project tree for the values that documentation templates need
 * (db credentials, ports, repo URL, framework-aware migration / seed
 * commands, docker-compose service name) so the user does NOT have to
 * type them into `meta.yaml` by hand.
 *
 * Detection layers (least specific to most specific; later layers win):
 *   1. Manifest (composer.json / package.json / pyproject.toml / Gemfile)
 *   2. Framework marker file (artisan / yii / bin/console / manage.py /
 *      bin/rails / next.config.* / nuxt.config.* / svelte.config.*)
 *   3. .env.example / .env.template / .env.dist (DB_*, APP_PORT, ...)
 *   4. docker-compose.yml (service names, ports)
 *   5. Makefile (`migrate:` / `seed:` targets) and package.json scripts
 *   6. `git remote get-url origin` (repo URL)
 *
 * The result includes a `sources` map so the orchestrator can show the
 * user *where* every value came from when collecting confirmations.
 *
 * Pure-ish: file/git access is injected via `opts.fs` and `opts.gitRun`
 * so unit tests can run without touching disk or processes.
 */

const fsDefault = require('fs');
const path = require('path');
const childProcess = require('child_process');

function defaultGitRun(args, cwd) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn('git', args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', () => resolve({ stdout: '', stderr, code: -1 }));
    proc.on('close', (code) => resolve({ stdout: stdout.trim(), stderr, code }));
  });
}

function exists(fs, p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readText(fs, p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function parseJsonSafe(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* ---------------------------------------------------------- framework -- */

const FRAMEWORK_MARKERS = [
  { framework: 'laravel',   files: ['artisan'] },
  { framework: 'yii',       files: ['yii'] },
  { framework: 'symfony',   files: ['bin/console'] },
  { framework: 'django',    files: ['manage.py'] },
  { framework: 'rails',     files: ['bin/rails'] },
  { framework: 'nuxt',      files: ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs'] },
  { framework: 'next',      files: ['next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { framework: 'sveltekit', files: ['svelte.config.js', 'svelte.config.ts'] },
];

function detectFramework(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  // Common monorepo subdirectories — same markers, different roots.
  const SUBDIRS = ['', 'backend/', 'frontend/', 'apps/backend/', 'apps/api/', 'apps/web/', 'apps/frontend/', 'server/', 'client/', 'web/'];
  for (const sub of SUBDIRS) {
    for (const marker of FRAMEWORK_MARKERS) {
      for (const file of marker.files) {
        if (exists(fs, path.join(projectPath, sub + file))) {
          return { framework: marker.framework, source: sub + file };
        }
      }
    }
  }
  // package.json fallback for Node frameworks that lack a config file (Express, NestJS, ...)
  const pkg = parseJsonSafe(readText(fs, path.join(projectPath, 'package.json')));
  if (pkg) {
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (all['@sveltejs/kit']) return { framework: 'sveltekit', source: 'package.json (@sveltejs/kit)' };
    if (all.next)             return { framework: 'next',      source: 'package.json (next)' };
    if (all.nuxt || all.nuxt3) return { framework: 'nuxt',     source: 'package.json (nuxt)' };
    if (all['@nestjs/core'])  return { framework: 'nestjs',    source: 'package.json (@nestjs/core)' };
    if (all.express)          return { framework: 'express',   source: 'package.json (express)' };
    if (all.fastify)          return { framework: 'fastify',   source: 'package.json (fastify)' };
  }
  return { framework: null, source: null };
}

/* ------------------------------------------------------------- env-vars -- */

const ENV_FILE_CANDIDATES = ['.env.example', '.env.template', '.env.dist', '.env.sample', '.env'];

function parseEnvFile(text) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!text) return out;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^﻿/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // strip inline comment after a non-quoted value
    const hashAt = value.indexOf(' #');
    if (hashAt >= 0) value = value.slice(0, hashAt).trim();
    out[m[1]] = value;
  }
  return out;
}

function extractEnvVars(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  for (const name of ENV_FILE_CANDIDATES) {
    const p = path.join(projectPath, name);
    if (exists(fs, p)) return parseEnvFile(readText(fs, p));
  }
  return {};
}

function envSourceFile(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  for (const name of ENV_FILE_CANDIDATES) {
    if (exists(fs, path.join(projectPath, name))) return name;
  }
  return null;
}

/* -------------------------------------------------------- docker-compose -- */

const COMPOSE_CANDIDATES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const PRIMARY_SERVICE_HINTS = ['app', 'web', 'backend', 'api', 'php', 'php-fpm'];

function parseComposeServices(text) {
  if (!text) return [];
  const lines = text.split('\n');
  let inServices = false;
  /** @type {string[]} */
  const services = [];
  let baseIndent = -1;
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*$/.test(line)) inServices = true;
      continue;
    }
    if (/^\S/.test(line)) break; // exited the services block
    const m = /^( +)([A-Za-z0-9_.-]+)\s*:\s*$/.exec(line);
    if (!m) continue;
    if (baseIndent === -1) baseIndent = m[1].length;
    if (m[1].length === baseIndent) services.push(m[2]);
  }
  return services;
}

function extractDockerCompose(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  let composeFile = null;
  for (const name of COMPOSE_CANDIDATES) {
    if (exists(fs, path.join(projectPath, name))) { composeFile = name; break; }
  }
  if (!composeFile) return { services: [], primary_service: null, file: null };
  const services = parseComposeServices(readText(fs, path.join(projectPath, composeFile)));
  let primary = null;
  for (const hint of PRIMARY_SERVICE_HINTS) {
    if (services.includes(hint)) { primary = hint; break; }
  }
  if (!primary && services.length > 0) primary = services[0];
  return { services, primary_service: primary, file: composeFile };
}

/* ---------------------------------------------------------- Makefile -- */

function extractMakefileTargets(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  const text = readText(fs, path.join(projectPath, 'Makefile')) || readText(fs, path.join(projectPath, 'makefile'));
  if (!text) return [];
  /** @type {Set<string>} */
  const targets = new Set();
  for (const line of text.split('\n')) {
    // Targets: name colon, no leading whitespace, no `=` (which would be a variable assignment).
    const m = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
    if (m && m[1] !== '.PHONY' && m[1] !== '.DEFAULT_GOAL') targets.add(m[1]);
  }
  // Also list .PHONY-declared names in case the targets are below conditional blocks.
  for (const line of text.split('\n')) {
    const m = /^\.PHONY\s*:\s*(.+)$/.exec(line);
    if (m) for (const name of m[1].split(/\s+/)) if (name) targets.add(name);
  }
  return [...targets];
}

/* -------------------------------------------- migration / seed inference -- */

const FRAMEWORK_DEFAULT_COMMANDS = {
  laravel: { migration_command: 'php artisan migrate', seed_command: 'php artisan db:seed' },
  yii:     { migration_command: 'php yii migrate',     seed_command: null },
  symfony: { migration_command: 'php bin/console doctrine:migrations:migrate', seed_command: null },
  django:  { migration_command: 'python manage.py migrate', seed_command: null },
  rails:   { migration_command: 'bin/rails db:migrate', seed_command: 'bin/rails db:seed' },
  next:    { migration_command: null, seed_command: null }, // Next.js itself has no migration story
  nuxt:    { migration_command: null, seed_command: null },
  sveltekit: { migration_command: null, seed_command: null },
  nestjs:  { migration_command: null, seed_command: null },
  express: { migration_command: null, seed_command: null },
  fastify: { migration_command: null, seed_command: null },
};

function inferMigrationCommands(framework, ctx = {}) {
  const targets = ctx.makefileTargets || [];
  const scripts = ctx.packageJsonScripts || {};
  const out = { migration_command: null, seed_command: null };

  // 1. Highest priority: Makefile targets.
  if (targets.includes('migrate')) out.migration_command = 'make migrate';
  if (targets.includes('seed'))    out.seed_command      = 'make seed';

  // 2. Fallback: package.json scripts named "migrate" / "seed".
  if (!out.migration_command && scripts.migrate) out.migration_command = 'npm run migrate';
  if (!out.seed_command      && scripts.seed)    out.seed_command      = 'npm run seed';

  // 3. Last resort: framework defaults.
  const defaults = (framework && FRAMEWORK_DEFAULT_COMMANDS[framework]) || null;
  if (defaults) {
    if (!out.migration_command && defaults.migration_command) out.migration_command = defaults.migration_command;
    if (!out.seed_command      && defaults.seed_command)      out.seed_command      = defaults.seed_command;
  }
  return out;
}

/* ---------------------------------------------------------- assembly -- */

async function deriveProjectMetadata(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  const gitRun = opts.gitRun || ((args) => defaultGitRun(args, projectPath));

  const fwk = detectFramework(projectPath, { fs });
  const env = extractEnvVars(projectPath, { fs });
  const envSource = envSourceFile(projectPath, { fs });
  const compose = extractDockerCompose(projectPath, { fs });
  const makefile = extractMakefileTargets(projectPath, { fs });
  const pkg = parseJsonSafe(readText(fs, path.join(projectPath, 'package.json')));
  const scripts = (pkg && pkg.scripts) || {};
  const cmds = inferMigrationCommands(fwk.framework, { makefileTargets: makefile, packageJsonScripts: scripts });

  /** @type {Record<string, string>} */
  const derived = {};
  /** @type {Record<string, string>} */
  const sources = {};

  if (fwk.framework) sources.framework = fwk.source;

  // DB credentials from env file. Each canonical key (db_user, db_name, ...)
  // is taken from the first matching env-var across many naming conventions:
  // Laravel uses DB_DATABASE, Symfony/Doctrine uses DATABASE_URL, Postgres
  // image envs are POSTGRES_*, MySQL image envs are MYSQL_*. Anyone of those
  // wins; the user keeps full control by setting the meta.metadata block.
  const pickEnv = (...names) => {
    for (const n of names) if (env[n]) return env[n];
    return null;
  };
  const dbUser = pickEnv('DB_USER', 'DB_USERNAME', 'POSTGRES_USER', 'MYSQL_USER');
  if (dbUser) { derived.db_user = dbUser; sources.db_user = envSource; }
  const dbName = pickEnv('DB_DATABASE', 'DB_NAME', 'POSTGRES_DB', 'MYSQL_DATABASE');
  if (dbName) { derived.db_name = dbName; sources.db_name = envSource; }
  const dbHost = pickEnv('DB_HOST', 'POSTGRES_HOST', 'MYSQL_HOST');
  if (dbHost) { derived.db_host = dbHost; sources.db_host = envSource; }
  const dbPort = pickEnv('DB_PORT', 'POSTGRES_PORT', 'MYSQL_PORT');
  if (dbPort) { derived.db_port = dbPort; sources.db_port = envSource; }

  // Service name from docker-compose
  if (compose.primary_service) {
    derived.service_name = compose.primary_service;
    sources.service_name = compose.file;
  }

  // Migration / seed commands
  if (cmds.migration_command) {
    derived.migration_command = cmds.migration_command;
    sources.migration_command = makefile.includes('migrate')
      ? 'Makefile'
      : (scripts.migrate ? 'package.json scripts' : `framework:${fwk.framework}`);
  }
  if (cmds.seed_command) {
    derived.seed_command = cmds.seed_command;
    sources.seed_command = makefile.includes('seed')
      ? 'Makefile'
      : (scripts.seed ? 'package.json scripts' : `framework:${fwk.framework}`);
  }

  // Repo URL from git remote
  try {
    const r = await gitRun(['-C', projectPath, 'remote', 'get-url', 'origin'], projectPath);
    if (r && r.code === 0 && r.stdout) {
      derived.repo_url = r.stdout;
      sources.repo_url = 'git remote';
    }
  } catch { /* ignore */ }

  return {
    framework: fwk.framework,
    framework_source: fwk.source,
    manifest_kind: pkg ? 'npm' : null,
    services: compose.services,
    env,
    derived,
    sources,
  };
}

module.exports = {
  detectFramework,
  extractEnvVars,
  parseEnvFile,
  extractDockerCompose,
  parseComposeServices,
  extractMakefileTargets,
  inferMigrationCommands,
  deriveProjectMetadata,
  FRAMEWORK_DEFAULT_COMMANDS,
};
