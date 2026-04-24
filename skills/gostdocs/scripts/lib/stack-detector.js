'use strict';

/**
 * Tech-stack detector.
 *
 * Complements project-introspect by filling in the fields the technical
 * description needs for its "Перечень используемых технологий" table and
 * the "Описание компонентов" subsections:
 *
 *   - language         : JavaScript / TypeScript / PHP / Python / Go / Java / …
 *   - language_version : engines.node / composer.require.php / python-version
 *   - framework        : reuses project-introspect.framework when available
 *   - framework_version: dependency version of the detected framework
 *   - runtime_port     : PORT env, docker-compose expose, or framework default
 *   - db_engine        : postgres / mysql / mongo / …, version when resolvable
 *
 * Best-effort heuristics, no network. Consumers get an object with
 * nullable string fields; never throws.
 */

const fs = require('fs');
const path = require('path');

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function safeJson(file) {
  const content = safeRead(file);
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

function detectLanguage(projectPath) {
  const pkg = safeJson(path.join(projectPath, 'package.json'));
  const ts = safeRead(path.join(projectPath, 'tsconfig.json'));
  if (pkg) {
    const version = (pkg.engines && (pkg.engines.node || pkg.engines.nodejs)) || null;
    return {
      language: ts ? 'TypeScript (Node.js)' : 'JavaScript (Node.js)',
      language_version: version,
    };
  }
  const composer = safeJson(path.join(projectPath, 'composer.json'));
  if (composer) {
    const version = composer.require && composer.require.php;
    return { language: 'PHP', language_version: version || null };
  }
  if (safeRead(path.join(projectPath, 'pyproject.toml')) || safeRead(path.join(projectPath, 'requirements.txt'))) {
    const pyproject = safeRead(path.join(projectPath, 'pyproject.toml')) || '';
    const m = pyproject.match(/python\s*=\s*["']([^"']+)["']/i) || pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/i);
    return { language: 'Python', language_version: m ? m[1] : null };
  }
  const gomod = safeRead(path.join(projectPath, 'go.mod'));
  if (gomod) {
    const m = gomod.match(/^go\s+(\S+)/m);
    return { language: 'Go', language_version: m ? m[1] : null };
  }
  const pom = safeRead(path.join(projectPath, 'pom.xml'));
  const gradle = safeRead(path.join(projectPath, 'build.gradle')) || safeRead(path.join(projectPath, 'build.gradle.kts'));
  if (pom || gradle) {
    const all = (pom || '') + (gradle || '');
    const m = all.match(/<java\.version>([^<]+)<\/java\.version>/) || all.match(/sourceCompatibility\s*=\s*['"]?([\d.]+)/i);
    return { language: 'Java (JVM)', language_version: m ? m[1] : null };
  }
  const csproj = (() => {
    try { return fs.readdirSync(projectPath).find((f) => f.endsWith('.csproj')) || null; } catch { return null; }
  })();
  if (csproj) {
    const content = safeRead(path.join(projectPath, csproj)) || '';
    const m = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    return { language: 'C# (.NET)', language_version: m ? m[1] : null };
  }
  return { language: null, language_version: null };
}

function detectFrameworkVersion(projectPath, framework) {
  if (!framework) return null;
  const pkg = safeJson(path.join(projectPath, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const key = {
      next: 'next',
      nuxt: 'nuxt',
      angular: '@angular/core',
      nestjs: '@nestjs/core',
      express: 'express',
      fastify: 'fastify',
      remix: '@remix-run/react',
      sveltekit: '@sveltejs/kit',
      astro: 'astro',
      vue: 'vue',
      react: 'react',
    }[framework];
    if (key && deps[key]) return deps[key];
  }
  const composer = safeJson(path.join(projectPath, 'composer.json'));
  if (composer && composer.require) {
    const key = { laravel: 'laravel/framework', symfony: 'symfony/framework-bundle', yii: 'yiisoft/yii2' }[framework];
    if (key && composer.require[key]) return composer.require[key];
  }
  const req = safeRead(path.join(projectPath, 'requirements.txt')) || '';
  const reKey = { django: /^Django\s*([=><~!]+\s*\S+)?/im, fastapi: /^fastapi\s*([=><~!]+\s*\S+)?/im, flask: /^Flask\s*([=><~!]+\s*\S+)?/im }[framework];
  if (reKey) {
    const m = req.match(reKey);
    if (m) return (m[1] || '').trim() || null;
  }
  return null;
}

function detectDbEngine(projectPath) {
  const compose = safeRead(path.join(projectPath, 'docker-compose.yml'))
    || safeRead(path.join(projectPath, 'docker-compose.yaml'))
    || '';
  const imageMatchers = [
    { engine: 'PostgreSQL', re: /image:\s*(?:postgres|postgis)(?::\s*([A-Za-z0-9._-]+))?/i },
    { engine: 'MySQL',      re: /image:\s*mysql(?::\s*([A-Za-z0-9._-]+))?/i },
    { engine: 'MariaDB',    re: /image:\s*mariadb(?::\s*([A-Za-z0-9._-]+))?/i },
    { engine: 'MongoDB',    re: /image:\s*mongo(?::\s*([A-Za-z0-9._-]+))?/i },
    { engine: 'SQLite',     re: /\bsqlite\b/i },
    { engine: 'Microsoft SQL Server', re: /image:\s*mcr\.microsoft\.com\/mssql\/server(?::\s*([A-Za-z0-9._-]+))?/i },
    { engine: 'ClickHouse', re: /image:\s*clickhouse\/clickhouse-server(?::\s*([A-Za-z0-9._-]+))?/i },
  ];
  for (const m of imageMatchers) {
    const hit = compose.match(m.re);
    if (hit) return { db_engine: m.engine, db_version: hit[1] || null };
  }
  const pkg = safeJson(path.join(projectPath, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.pg)       return { db_engine: 'PostgreSQL', db_version: null };
  if (deps.mysql2 || deps.mysql) return { db_engine: 'MySQL', db_version: null };
  if (deps.mongoose || deps.mongodb) return { db_engine: 'MongoDB', db_version: null };
  if (deps.sqlite3 || deps['better-sqlite3']) return { db_engine: 'SQLite', db_version: null };
  return { db_engine: null, db_version: null };
}

function detectRuntimePort(projectPath, framework) {
  const env = safeRead(path.join(projectPath, '.env'))
    || safeRead(path.join(projectPath, '.env.example'))
    || '';
  const m = env.match(/^\s*(?:PORT|APP_PORT|HTTP_PORT)\s*=\s*(\d+)/m);
  if (m) return m[1];
  const compose = safeRead(path.join(projectPath, 'docker-compose.yml'))
    || safeRead(path.join(projectPath, 'docker-compose.yaml'))
    || '';
  const portM = compose.match(/-\s*["']?(\d+):\d+["']?/);
  if (portM) return portM[1];
  const defaults = {
    laravel: '8000', symfony: '8000', yii: '8080',
    django: '8000', fastapi: '8000', flask: '5000',
    express: '3000', fastify: '3000', next: '3000', nuxt: '3000',
    nestjs: '3000', angular: '4200', sveltekit: '5173', astro: '4321',
    spring: '8080',
  };
  return defaults[framework] || null;
}

/**
 * Run all detectors and return a merged descriptor.
 *
 * @param {string} projectPath
 * @param {{ framework?: string }} [opts]  pass the framework project-introspect found
 * @returns {{
 *   language: string|null, language_version: string|null,
 *   framework: string|null, framework_version: string|null,
 *   db_engine: string|null, db_version: string|null,
 *   runtime_port: string|null,
 * }}
 */
function detectStack(projectPath, opts = {}) {
  const lang = detectLanguage(projectPath);
  const framework = opts.framework || null;
  const db = detectDbEngine(projectPath);
  return {
    language: lang.language,
    language_version: lang.language_version,
    framework,
    framework_version: detectFrameworkVersion(projectPath, framework),
    db_engine: db.db_engine,
    db_version: db.db_version,
    runtime_port: detectRuntimePort(projectPath, framework),
  };
}

module.exports = {
  detectStack,
  detectLanguage,
  detectFrameworkVersion,
  detectDbEngine,
  detectRuntimePort,
};
