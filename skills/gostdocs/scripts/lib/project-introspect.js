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
  { framework: 'laravel',     files: ['artisan'] },
  { framework: 'yii',         files: ['yii'] },
  { framework: 'symfony',     files: ['bin/console'] },
  { framework: 'django',      files: ['manage.py'] },
  { framework: 'rails',       files: ['bin/rails'] },
  { framework: 'nuxt',        files: ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs'] },
  { framework: 'next',        files: ['next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { framework: 'sveltekit',   files: ['svelte.config.js', 'svelte.config.ts'] },
  { framework: 'astro',       files: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'] },
  { framework: 'angular',     files: ['angular.json'] },
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
  // package.json fallback for Node frameworks that lack a config file.
  for (const sub of SUBDIRS) {
    const pkg = parseJsonSafe(readText(fs, path.join(projectPath, sub + 'package.json')));
    if (!pkg) continue;
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (all['@sveltejs/kit']) return { framework: 'sveltekit', source: `${sub}package.json (@sveltejs/kit)` };
    if (all['@remix-run/react'] || all['@remix-run/node']) return { framework: 'remix', source: `${sub}package.json (@remix-run)` };
    if (all.next)             return { framework: 'next',      source: `${sub}package.json (next)` };
    if (all.nuxt || all.nuxt3) return { framework: 'nuxt',     source: `${sub}package.json (nuxt)` };
    if (all.astro)            return { framework: 'astro',     source: `${sub}package.json (astro)` };
    if (all['@angular/core']) return { framework: 'angular',   source: `${sub}package.json (@angular/core)` };
    if (all['@nestjs/core'])  return { framework: 'nestjs',    source: `${sub}package.json (@nestjs/core)` };
    if (all.express)          return { framework: 'express',   source: `${sub}package.json (express)` };
    if (all.fastify)          return { framework: 'fastify',   source: `${sub}package.json (fastify)` };
    if (all.vue)              return { framework: 'vue',       source: `${sub}package.json (vue)` };
    if (all.react)            return { framework: 'react',     source: `${sub}package.json (react)` };
  }

  // Python: requirements.txt or pyproject.toml dependency check.
  for (const sub of SUBDIRS) {
    const reqs = readText(fs, path.join(projectPath, sub + 'requirements.txt'));
    if (reqs) {
      if (/(^|\n)\s*fastapi\b/i.test(reqs)) return { framework: 'fastapi', source: `${sub}requirements.txt (fastapi)` };
      if (/(^|\n)\s*flask\b/i.test(reqs))   return { framework: 'flask',   source: `${sub}requirements.txt (flask)` };
    }
    const pyproject = readText(fs, path.join(projectPath, sub + 'pyproject.toml'));
    if (pyproject) {
      if (/fastapi/i.test(pyproject)) return { framework: 'fastapi', source: `${sub}pyproject.toml (fastapi)` };
      if (/(^|[^a-z])flask([^a-z]|$)/i.test(pyproject)) return { framework: 'flask', source: `${sub}pyproject.toml (flask)` };
    }
  }

  // JVM: Spring Boot via Maven pom.xml or Gradle build.gradle.
  for (const sub of SUBDIRS) {
    const pom = readText(fs, path.join(projectPath, sub + 'pom.xml'));
    if (pom && /(spring-boot|org\.springframework\.boot)/.test(pom)) return { framework: 'spring-boot', source: `${sub}pom.xml (spring-boot)` };
    for (const gradleName of ['build.gradle', 'build.gradle.kts']) {
      const grd = readText(fs, path.join(projectPath, sub + gradleName));
      if (grd && /org\.springframework\.boot/.test(grd)) return { framework: 'spring-boot', source: `${sub}${gradleName} (spring-boot)` };
    }
  }

  // Elixir / Phoenix.
  for (const sub of SUBDIRS) {
    const mix = readText(fs, path.join(projectPath, sub + 'mix.exs'));
    if (mix && /:phoenix\b/.test(mix)) return { framework: 'phoenix', source: `${sub}mix.exs (:phoenix)` };
  }

  // Go web frameworks (require directives in go.mod).
  for (const sub of SUBDIRS) {
    const gomod = readText(fs, path.join(projectPath, sub + 'go.mod'));
    if (!gomod) continue;
    if (/github\.com\/gin-gonic\/gin/.test(gomod))   return { framework: 'gin',   source: `${sub}go.mod (gin)` };
    if (/github\.com\/labstack\/echo/.test(gomod))   return { framework: 'echo',  source: `${sub}go.mod (echo)` };
    if (/github\.com\/gofiber\/fiber/.test(gomod))   return { framework: 'fiber', source: `${sub}go.mod (fiber)` };
  }

  // .NET ASP.NET Core (any *.csproj with Sdk="Microsoft.NET.Sdk.Web").
  for (const sub of SUBDIRS) {
    let entries;
    try { entries = fs.readdirSync(path.join(projectPath, sub || '.')); } catch { entries = []; }
    for (const name of entries) {
      if (!name.endsWith('.csproj')) continue;
      const text = readText(fs, path.join(projectPath, sub, name));
      if (text && /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(text)) {
        return { framework: 'aspnet-core', source: `${sub}${name}` };
      }
    }
  }

  return { framework: null, source: null };
}

/* ------------------------------------------------------------- stack manifest -- */

const BACKEND_SUBDIRS = ['backend/', 'server/', 'api/', 'app/backend/', 'apps/backend/', 'apps/api/', ''];
const FRONTEND_SUBDIRS = ['frontend/', 'client/', 'web/', 'app/frontend/', 'apps/web/', 'apps/frontend/', ''];

function matchVersion(text, patterns) {
  for (const pat of patterns) {
    const m = pat.exec(text);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Scan the repository for a backend manifest and return a normalised stack
 * record. The search order favours dedicated subdirectories (`backend/`,
 * `server/`, `api/`) so monorepo layouts resolve to the server-side stack
 * even when the root also contains a `package.json`.
 */
function detectBackendStack(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  for (const sub of BACKEND_SUBDIRS) {
    const composer = readText(fs, path.join(projectPath, sub + 'composer.json'));
    if (composer) {
      const pkg = parseJsonSafe(composer) || {};
      const deps = { ...(pkg.require || {}), ...(pkg['require-dev'] || {}) };
      let framework = null;
      let version = null;
      if (deps['yiisoft/yii2'])             { framework = 'Yii2';    version = deps['yiisoft/yii2']; }
      else if (deps['laravel/framework'])   { framework = 'Laravel'; version = deps['laravel/framework']; }
      else if (deps['symfony/framework-bundle']) { framework = 'Symfony'; version = deps['symfony/framework-bundle']; }
      else if (deps['cakephp/cakephp'])     { framework = 'CakePHP'; version = deps['cakephp/cakephp']; }
      return {
        language: 'PHP',
        framework,
        version: version ? String(version).replace(/^[\^~]/, '') : null,
        manifest: sub + 'composer.json',
      };
    }
    const pyproject = readText(fs, path.join(projectPath, sub + 'pyproject.toml'));
    const requirements = readText(fs, path.join(projectPath, sub + 'requirements.txt'));
    if (pyproject || requirements) {
      const combined = `${pyproject || ''}\n${requirements || ''}`;
      let framework = null;
      let version = null;
      if (/(^|[^a-zA-Z])django([>=<~!\s,'"]|$)/i.test(combined)) {
        framework = 'Django';
        version = matchVersion(combined, [/django[>=<~!]+([\d.]+)/i]);
      } else if (/fastapi/i.test(combined)) {
        framework = 'FastAPI';
        version = matchVersion(combined, [/fastapi[>=<~!]+([\d.]+)/i]);
      } else if (/(^|[^a-zA-Z])flask([>=<~!\s,'"]|$)/i.test(combined)) {
        framework = 'Flask';
        version = matchVersion(combined, [/flask[>=<~!]+([\d.]+)/i]);
      }
      return {
        language: 'Python',
        framework,
        version,
        manifest: pyproject ? sub + 'pyproject.toml' : sub + 'requirements.txt',
      };
    }
    const gomod = readText(fs, path.join(projectPath, sub + 'go.mod'));
    if (gomod) {
      const goVersion = matchVersion(gomod, [/^go\s+([\d.]+)/m]);
      let framework = null;
      if (/gin-gonic\/gin/.test(gomod)) framework = 'Gin';
      else if (/labstack\/echo/.test(gomod)) framework = 'Echo';
      else if (/gofiber\/fiber/.test(gomod)) framework = 'Fiber';
      return { language: 'Go', framework, version: goVersion, manifest: sub + 'go.mod' };
    }
    const cargo = readText(fs, path.join(projectPath, sub + 'Cargo.toml'));
    if (cargo) {
      let framework = null;
      if (/actix-web/.test(cargo)) framework = 'Actix-web';
      else if (/axum/.test(cargo)) framework = 'Axum';
      else if (/rocket/.test(cargo)) framework = 'Rocket';
      return { language: 'Rust', framework, version: null, manifest: sub + 'Cargo.toml' };
    }
    const gemfile = readText(fs, path.join(projectPath, sub + 'Gemfile'));
    if (gemfile) {
      let framework = null;
      if (/\brails\b/.test(gemfile)) framework = 'Ruby on Rails';
      else if (/\bsinatra\b/.test(gemfile)) framework = 'Sinatra';
      return { language: 'Ruby', framework, version: null, manifest: sub + 'Gemfile' };
    }
    const pom = readText(fs, path.join(projectPath, sub + 'pom.xml'));
    if (pom) {
      const framework = /spring-boot|org\.springframework\.boot/.test(pom) ? 'Spring Boot' : null;
      const version = matchVersion(pom, [/<version>([\d.]+)<\/version>/]);
      return { language: 'Java', framework, version, manifest: sub + 'pom.xml' };
    }
    for (const gradleName of ['build.gradle', 'build.gradle.kts']) {
      const grd = readText(fs, path.join(projectPath, sub + gradleName));
      if (grd) {
        const framework = /org\.springframework\.boot/.test(grd) ? 'Spring Boot' : null;
        return { language: 'Java/Kotlin', framework, version: null, manifest: sub + gradleName };
      }
    }
  }
  return null;
}

/**
 * Scan the repository for a frontend package.json and return a normalised
 * stack record. We deliberately skip the root package.json when it merely
 * declares workspace config — the search walks dedicated subdirectories
 * first to correctly classify monorepo frontends.
 */
function detectFrontendStack(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  for (const sub of FRONTEND_SUBDIRS) {
    const pkg = parseJsonSafe(readText(fs, path.join(projectPath, sub + 'package.json')));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    // Workspace-only root package — skip and let the next subdir match.
    if (sub === '' && pkg.workspaces && Object.keys(deps).length === 0) continue;
    let language = deps.typescript || deps['@types/node'] || pkg.type === 'module' ? 'TypeScript' : 'JavaScript';
    let framework = null;
    let version = null;
    if (deps.vue) { framework = 'Vue';     version = String(deps.vue).replace(/^[\^~]/, ''); }
    else if (deps['@angular/core']) { framework = 'Angular'; version = String(deps['@angular/core']).replace(/^[\^~]/, ''); }
    else if (deps.next)  { framework = 'Next.js'; version = String(deps.next).replace(/^[\^~]/, ''); }
    else if (deps.nuxt || deps.nuxt3) { framework = 'Nuxt'; version = String(deps.nuxt || deps.nuxt3).replace(/^[\^~]/, ''); }
    else if (deps.astro) { framework = 'Astro'; version = String(deps.astro).replace(/^[\^~]/, ''); }
    else if (deps['@sveltejs/kit']) { framework = 'SvelteKit'; version = String(deps['@sveltejs/kit']).replace(/^[\^~]/, ''); }
    else if (deps.svelte) { framework = 'Svelte'; version = String(deps.svelte).replace(/^[\^~]/, ''); }
    else if (deps.react) { framework = 'React'; version = String(deps.react).replace(/^[\^~]/, ''); }
    // No recognised frontend framework — skip: this package.json likely
    // belongs to a tool (e.g. a monorepo root), not the UI.
    if (!framework) continue;
    return { language, framework, version, manifest: sub + 'package.json' };
  }
  return null;
}

function buildStackManifest(projectPath, opts = {}) {
  const fs = opts.fs || fsDefault;
  const backend = detectBackendStack(projectPath, opts);
  const frontend = detectFrontendStack(projectPath, opts);
  const containers = [];
  for (const name of COMPOSE_CANDIDATES) {
    const filePath = path.join(projectPath, name);
    if (exists(fs, filePath)) {
      const text = readText(fs, filePath);
      if (text) containers.push(...parseComposeContainers(text));
      break;
    }
  }
  // When nothing meaningful turned up, return null so the caller can fall
  // back to a single-framework detection without having to test individual
  // fields for absence.
  if (!backend && !frontend && containers.length === 0) return null;
  return { backend_stack: backend, frontend_stack: frontend, containers };
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

/**
 * Parse a 12-factor DATABASE_URL / MONGODB_URI / etc. of the shape
 *   driver://user:pass@host:port/dbname
 * Returns {user,name,host,port}; missing pieces stay null. Never throws.
 */
function parseDatabaseUrl(url) {
  /** @type {{user: string|null, name: string|null, host: string|null, port: string|null}} */
  const out = { user: null, name: null, host: null, port: null };
  if (!url || typeof url !== 'string') return out;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:([^:@\/]+)(?::([^@\/]*))?@)?([^:\/?#]+)(?::(\d+))?(?:\/([^?#]+))?/i.exec(url);
  if (!m) return out;
  out.user = m[1] ? decodeURIComponent(m[1]) : null;
  out.host = m[3] || null;
  out.port = m[4] || null;
  if (m[5]) out.name = decodeURIComponent(m[5]);
  return out;
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

/**
 * Parse a docker-compose.yml body and return a flat list of
 * { name, image, version } records, one per service that declares an
 * `image:` line. Services built from a local Dockerfile are ignored
 * because their version is not fixed in the compose file.
 *
 * Input is the raw YAML string; parsing is deliberately done by hand
 * (instead of loading yaml) so the helper works even when the parent
 * module was bootstrapped without a compose validator installed.
 *
 * @param {string} text
 * @returns {Array<{ name: string, image: string, version: string|null }>}
 */
function parseComposeContainers(text) {
  if (!text) return [];
  const lines = text.split('\n');
  let inServices = false;
  let baseIndent = -1;
  let currentService = null;
  const byService = new Map();
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*$/.test(line)) inServices = true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const serviceMatch = /^( +)([A-Za-z0-9_.-]+)\s*:\s*$/.exec(line);
    if (serviceMatch) {
      if (baseIndent === -1) baseIndent = serviceMatch[1].length;
      if (serviceMatch[1].length === baseIndent) {
        currentService = serviceMatch[2];
        if (!byService.has(currentService)) byService.set(currentService, null);
      }
      continue;
    }
    if (!currentService) continue;
    const imageMatch = /^\s+image:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (imageMatch) byService.set(currentService, imageMatch[1]);
  }
  const out = [];
  for (const [name, image] of byService.entries()) {
    if (!image) continue;
    const tagMatch = /:([^@]+?)(?:@.*)?$/.exec(image);
    out.push({ name, image, version: tagMatch ? tagMatch[1] : null });
  }
  return out;
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
  laravel:     { migration_command: 'php artisan migrate', seed_command: 'php artisan db:seed' },
  yii:         { migration_command: 'php yii migrate',     seed_command: null },
  symfony:     { migration_command: 'php bin/console doctrine:migrations:migrate', seed_command: null },
  django:      { migration_command: 'python manage.py migrate', seed_command: null },
  rails:       { migration_command: 'bin/rails db:migrate', seed_command: 'bin/rails db:seed' },
  phoenix:     { migration_command: 'mix ecto.migrate', seed_command: 'mix run priv/repo/seeds.exs' },
  fastapi:     { migration_command: 'alembic upgrade head', seed_command: null },
  flask:       { migration_command: 'flask db upgrade', seed_command: null },
  'spring-boot': { migration_command: './mvnw flyway:migrate', seed_command: null },
  // Frontend frameworks usually delegate to a Node-side ORM; their default
  // is null and inferMigrationCommands falls back to package.json scripts
  // / detected ORMs (Prisma, Drizzle, TypeORM, Knex).
  next:        { migration_command: null, seed_command: null },
  nuxt:        { migration_command: null, seed_command: null },
  sveltekit:   { migration_command: null, seed_command: null },
  astro:       { migration_command: null, seed_command: null },
  remix:       { migration_command: null, seed_command: null },
  angular:     { migration_command: null, seed_command: null },
  nestjs:      { migration_command: null, seed_command: null },
  express:     { migration_command: null, seed_command: null },
  fastify:     { migration_command: null, seed_command: null },
  gin:         { migration_command: null, seed_command: null },
  echo:        { migration_command: null, seed_command: null },
  fiber:       { migration_command: null, seed_command: null },
  'aspnet-core': { migration_command: 'dotnet ef database update', seed_command: null },
};

/**
 * When framework defaults aren't enough (e.g. Next.js + Prisma), look at
 * package.json deps for a known ORM/migrator and propose its CLI.
 */
function inferOrmCommandFromDeps(deps) {
  if (!deps) return { migration_command: null, seed_command: null };
  if (deps.prisma || deps['@prisma/client']) {
    return { migration_command: 'npx prisma migrate deploy', seed_command: 'npx prisma db seed' };
  }
  if (deps['drizzle-kit'] || deps['drizzle-orm']) {
    return { migration_command: 'npx drizzle-kit migrate', seed_command: null };
  }
  if (deps.typeorm) {
    return { migration_command: 'npx typeorm migration:run', seed_command: null };
  }
  if (deps.knex) {
    return { migration_command: 'npx knex migrate:latest', seed_command: 'npx knex seed:run' };
  }
  if (deps.sequelize) {
    return { migration_command: 'npx sequelize db:migrate', seed_command: 'npx sequelize db:seed:all' };
  }
  return { migration_command: null, seed_command: null };
}

function inferMigrationCommands(framework, ctx = {}) {
  const targets = ctx.makefileTargets || [];
  const scripts = ctx.packageJsonScripts || {};
  const deps = ctx.packageJsonDeps || null;
  const out = { migration_command: null, seed_command: null };

  // 1. Highest priority: Makefile targets.
  if (targets.includes('migrate')) out.migration_command = 'make migrate';
  if (targets.includes('seed'))    out.seed_command      = 'make seed';

  // 2. package.json scripts named "migrate" / "seed".
  if (!out.migration_command && scripts.migrate) out.migration_command = 'npm run migrate';
  if (!out.seed_command      && scripts.seed)    out.seed_command      = 'npm run seed';

  // 3. Detected ORM/migrator (Prisma, Drizzle, TypeORM, Knex, Sequelize).
  const orm = inferOrmCommandFromDeps(deps);
  if (!out.migration_command && orm.migration_command) out.migration_command = orm.migration_command;
  if (!out.seed_command      && orm.seed_command)      out.seed_command      = orm.seed_command;

  // 4. Last resort: framework defaults.
  const defaults = (framework && FRAMEWORK_DEFAULT_COMMANDS[framework]) || null;
  if (defaults) {
    if (!out.migration_command && defaults.migration_command) out.migration_command = defaults.migration_command;
    if (!out.seed_command      && defaults.seed_command)      out.seed_command      = defaults.seed_command;
  }
  return out;
}

/**
 * Make the `sources.migration_command` / `sources.seed_command` label match
 * the layer that actually produced the command. Falls back to the framework
 * name only when nothing more specific applies.
 */
function describeCommandSource(command, ctx) {
  const { makefile, scripts, deps, framework } = ctx;
  if (makefile && (command === 'make migrate' || command === 'make seed')) return 'Makefile';
  if (scripts && (command === 'npm run migrate' || command === 'npm run seed')) return 'package.json scripts';
  if (deps) {
    if (/prisma/i.test(command) && (deps.prisma || deps['@prisma/client'])) return 'package.json (prisma)';
    if (/drizzle-kit/.test(command) && deps['drizzle-kit']) return 'package.json (drizzle-kit)';
    if (/typeorm/.test(command) && deps.typeorm) return 'package.json (typeorm)';
    if (/knex/.test(command) && deps.knex) return 'package.json (knex)';
    if (/sequelize/.test(command) && deps.sequelize) return 'package.json (sequelize)';
  }
  return framework ? `framework:${framework}` : 'inferred';
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
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : null;
  const cmds = inferMigrationCommands(fwk.framework, { makefileTargets: makefile, packageJsonScripts: scripts, packageJsonDeps: deps });

  /** @type {Record<string, string>} */
  const derived = {};
  /** @type {Record<string, string>} */
  const sources = {};

  if (fwk.framework) sources.framework = fwk.source;

  // DB credentials from env file. Each canonical key (db_user, db_name, ...)
  // is taken from the first matching env-var across many naming conventions:
  // Laravel uses DB_DATABASE, Symfony/Doctrine uses DATABASE_URL, Postgres
  // image envs are POSTGRES_*, MySQL image envs are MYSQL_*, Mongo uses
  // MONGODB_URI / MONGO_URL. Anyone of those wins; the user keeps full
  // control by setting the meta.metadata block.
  const pickEnv = (...names) => {
    for (const n of names) if (env[n]) return env[n];
    return null;
  };

  // 12-factor URL form takes priority — it's the unambiguous source.
  const urlVar = pickEnv('DATABASE_URL', 'MONGODB_URI', 'MONGO_URL', 'POSTGRES_URL', 'MYSQL_URL', 'REDIS_URL');
  const fromUrl = parseDatabaseUrl(urlVar);
  if (fromUrl.user) { derived.db_user = fromUrl.user; sources.db_user = envSource; }
  if (fromUrl.name) { derived.db_name = fromUrl.name; sources.db_name = envSource; }
  if (fromUrl.host) { derived.db_host = fromUrl.host; sources.db_host = envSource; }
  if (fromUrl.port) { derived.db_port = fromUrl.port; sources.db_port = envSource; }

  const dbUser = pickEnv('DB_USER', 'DB_USERNAME', 'POSTGRES_USER', 'MYSQL_USER', 'MYSQL_USERNAME', 'MONGO_USER', 'MONGO_INITDB_ROOT_USERNAME');
  if (!derived.db_user && dbUser) { derived.db_user = dbUser; sources.db_user = envSource; }
  const dbName = pickEnv('DB_DATABASE', 'DB_NAME', 'POSTGRES_DB', 'MYSQL_DATABASE', 'MONGO_DATABASE', 'MONGO_INITDB_DATABASE');
  if (!derived.db_name && dbName) { derived.db_name = dbName; sources.db_name = envSource; }
  const dbHost = pickEnv('DB_HOST', 'POSTGRES_HOST', 'MYSQL_HOST', 'MONGO_HOST');
  if (!derived.db_host && dbHost) { derived.db_host = dbHost; sources.db_host = envSource; }
  const dbPort = pickEnv('DB_PORT', 'POSTGRES_PORT', 'MYSQL_PORT', 'MONGO_PORT');
  if (!derived.db_port && dbPort) { derived.db_port = dbPort; sources.db_port = envSource; }

  // Service name from docker-compose
  if (compose.primary_service) {
    derived.service_name = compose.primary_service;
    sources.service_name = compose.file;
  }

  // Migration / seed commands
  if (cmds.migration_command) {
    derived.migration_command = cmds.migration_command;
    sources.migration_command = describeCommandSource(cmds.migration_command, {
      makefile, scripts, deps, framework: fwk.framework,
    });
  }
  if (cmds.seed_command) {
    derived.seed_command = cmds.seed_command;
    sources.seed_command = describeCommandSource(cmds.seed_command, {
      makefile, scripts, deps, framework: fwk.framework,
    });
  }

  // Repo URL from git remote
  try {
    const r = await gitRun(['-C', projectPath, 'remote', 'get-url', 'origin'], projectPath);
    if (r && r.code === 0 && r.stdout) {
      derived.repo_url = r.stdout;
      sources.repo_url = 'git remote';
    }
  } catch { /* ignore */ }

  const stackManifest = buildStackManifest(projectPath, opts);

  return {
    framework: fwk.framework,
    framework_source: fwk.source,
    manifest_kind: pkg ? 'npm' : null,
    services: compose.services,
    env: {
      // `vars` retains the flat key→value map that existing callers expect;
      // `keys` and `source` surface the inputs downstream builders (e.g.
      // auto-sections.buildDistributionComposition) need to describe the
      // distribution without having to re-read the template.
      vars: env,
      keys: Object.keys(env),
      source: envSource,
    },
    derived,
    sources,
    stack_manifest: stackManifest,
  };
}

module.exports = {
  detectFramework,
  detectBackendStack,
  detectFrontendStack,
  buildStackManifest,
  extractEnvVars,
  parseEnvFile,
  parseDatabaseUrl,
  extractDockerCompose,
  parseComposeServices,
  parseComposeContainers,
  extractMakefileTargets,
  inferMigrationCommands,
  inferOrmCommandFromDeps,
  deriveProjectMetadata,
  FRAMEWORK_DEFAULT_COMMANDS,
};
