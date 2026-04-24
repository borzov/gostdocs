'use strict';

/**
 * Heuristic security scanner.
 *
 * Phase 8C contract: every GOST technical description must carry a
 * substantive "Безопасность" section. We can't wait for a human to fill
 * it in — so this module walks the project's dependency manifests and
 * configuration files and returns a structured summary of what the
 * stack ACTUALLY uses: authentication libs, password hashers, RBAC
 * frameworks, CSRF / rate-limit middleware, CORS, secure cookies, and
 * audit-log tables.
 *
 * The scanner is universal: it reads manifests for JS/TS (package.json),
 * PHP (composer.json), Python (requirements.txt / pyproject.toml),
 * Go (go.mod), .NET (*.csproj), JVM (pom.xml / build.gradle*) and
 * Ruby (Gemfile). Projects that keep all manifests simply get all
 * signals merged.
 *
 * Pure, synchronous, no network. File reads are wrapped in try/catch so
 * the scanner degrades gracefully on empty / malformed manifests.
 */

const fs = require('fs');
const path = require('path');

const MATCHERS = {
  authentication: {
    jwt:           [/jsonwebtoken/i, /@nestjs\/jwt/i, /firebase-auth/i, /pyjwt/i, /gin-jwt/i, /jose/i, /lcobucci\/jwt/i, /firebase\/php-jwt/i],
    session:       [/express-session/i, /cookie-session/i, /fastify-session/i, /iron-session/i],
    oauth2:        [/passport-oauth/i, /openid-client/i, /simplesamlphp/i, /authlib/i, /doorkeeper/i, /spring-security-oauth2/i],
    ldap:          [/ldapjs/i, /passport-ldapauth/i, /python-ldap/i],
    sso:           [/saml/i, /keycloak/i],
    laravel:       [/laravel\/sanctum/i, /laravel\/passport/i, /tymondesigns\/jwt-auth/i],
    framework:     [/spring-security/i, /asp\.net\.core\.authentication/i, /\bdevise\b/i, /django\.contrib\.auth/i, /^django$/i, /flask-login/i, /fastapi-users/i, /\bflask$/i],
  },
  password_hashing: {
    bcrypt:  [/bcrypt/i, /bcryptjs/i, /password_hash/i, /\bbcrypt\b/i],
    argon2:  [/argon2/i, /argon2id/i],
    scrypt:  [/\bscrypt\b/i],
    pbkdf2:  [/pbkdf2/i],
  },
  authorization: {
    rbac:    [/accesscontrol/i, /casbin/i, /spatie\/laravel-permission/i, /django-guardian/i, /pundit/i, /cancancan/i],
    policies:[/@casl\//i, /oso-cloud/i],
  },
  network_security: {
    helmet:       [/\bhelmet\b/i, /@nestjs\/helmet/i],
    cors:         [/\bcors\b/i, /django-cors-headers/i, /flask-cors/i],
    csrf:         [/csurf/i, /django\.middleware\.csrf/i, /csrf/i, /\bantiforgery\b/i],
    rate_limit:   [/express-rate-limit/i, /rate-limiter-flexible/i, /bottleneck/i, /django-ratelimit/i, /flask-limiter/i, /fastapi-limiter/i],
    csp:          [/content-security-policy/i, /\bcsp\b/i],
    secure_cookies:[/httponly/i, /samesite/i, /\bsecure\b/i],
  },
  data_protection: {
    tls:     [/https/i, /ssl/i, /tls/i, /letsencrypt/i, /certbot/i],
    secrets: [/dotenv/i, /vault/i, /aws-secrets-manager/i, /doppler/i, /sops/i],
    crypto:  [/libsodium/i, /\bsodium\b/i, /nacl/i, /openssl/i, /node:crypto/i],
  },
  auditing: {
    table_name:       [/\baudit[_-]?log/i, /\baction[_-]?log/i, /\bactivity[_-]?log/i],
    model:            [/auditjs/i, /spatie\/laravel-activitylog/i, /django-simple-history/i],
  },
};

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readPackageJsonDeps(projectPath) {
  const pkg = safeRead(path.join(projectPath, 'package.json'));
  if (!pkg) return [];
  try {
    const obj = JSON.parse(pkg);
    return [
      ...Object.keys(obj.dependencies || {}),
      ...Object.keys(obj.devDependencies || {}),
      ...Object.keys(obj.peerDependencies || {}),
    ];
  } catch { return []; }
}

function readComposerJsonDeps(projectPath) {
  const file = safeRead(path.join(projectPath, 'composer.json'));
  if (!file) return [];
  try {
    const obj = JSON.parse(file);
    return [
      ...Object.keys(obj.require || {}),
      ...Object.keys(obj['require-dev'] || {}),
    ];
  } catch { return []; }
}

function readRequirementsTxt(projectPath) {
  const file = safeRead(path.join(projectPath, 'requirements.txt'));
  if (!file) return [];
  return file.split('\n').map((l) => l.split(/[<>=!;]/)[0].trim()).filter(Boolean);
}

function readPyproject(projectPath) {
  const file = safeRead(path.join(projectPath, 'pyproject.toml'));
  if (!file) return [];
  const matches = file.match(/^\s*"[A-Za-z0-9_.-]+"/gm) || [];
  return matches.map((m) => m.replace(/[\s"]/g, ''));
}

function readGoMod(projectPath) {
  const file = safeRead(path.join(projectPath, 'go.mod'));
  if (!file) return [];
  return (file.match(/^\s*[a-z0-9.\/_-]+ v\d+\./gm) || [])
    .map((l) => l.trim().split(/\s+/)[0]);
}

function readCsproj(projectPath) {
  try {
    const entries = fs.readdirSync(projectPath);
    const results = [];
    for (const entry of entries) {
      if (!entry.endsWith('.csproj')) continue;
      const content = safeRead(path.join(projectPath, entry));
      if (!content) continue;
      for (const m of content.matchAll(/PackageReference\s+Include="([^"]+)"/g)) {
        results.push(m[1]);
      }
    }
    return results;
  } catch { return []; }
}

function readPomOrGradle(projectPath) {
  const pom = safeRead(path.join(projectPath, 'pom.xml')) || '';
  const gradle = safeRead(path.join(projectPath, 'build.gradle')) || safeRead(path.join(projectPath, 'build.gradle.kts')) || '';
  const deps = [];
  for (const m of pom.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) deps.push(m[1]);
  for (const m of gradle.matchAll(/['"](?:io|org|com|net)\.[a-z0-9.\-]+:([a-z0-9.\-_]+):/g)) deps.push(m[1]);
  return deps;
}

function readGemfile(projectPath) {
  const file = safeRead(path.join(projectPath, 'Gemfile'));
  if (!file) return [];
  return (file.match(/gem\s+['"]([A-Za-z0-9_-]+)['"]/g) || []).map((g) => g.replace(/gem\s+['"]|['"]/g, ''));
}

function collectDependencies(projectPath) {
  return [
    ...readPackageJsonDeps(projectPath),
    ...readComposerJsonDeps(projectPath),
    ...readRequirementsTxt(projectPath),
    ...readPyproject(projectPath),
    ...readGoMod(projectPath),
    ...readCsproj(projectPath),
    ...readPomOrGradle(projectPath),
    ...readGemfile(projectPath),
  ];
}

function matchCategory(deps, matchers) {
  const hits = {};
  for (const [label, patterns] of Object.entries(matchers)) {
    const found = deps.filter((d) => patterns.some((p) => p.test(d)));
    if (found.length > 0) hits[label] = [...new Set(found)];
  }
  return hits;
}

function scanComposeForTls(projectPath) {
  const compose = safeRead(path.join(projectPath, 'docker-compose.yml'))
    || safeRead(path.join(projectPath, 'docker-compose.yaml'))
    || '';
  const nginx = safeRead(path.join(projectPath, 'nginx.conf')) || safeRead(path.join(projectPath, 'nginx/default.conf')) || '';
  const hints = [];
  if (/ssl_certificate|listen\s+443/.test(nginx)) hints.push('nginx TLS');
  if (/traefik|caddy/.test(compose)) hints.push('reverse-proxy TLS');
  if (/letsencrypt|certbot/.test(compose + nginx)) hints.push("Let's Encrypt");
  return hints;
}

function scanForAuditTables(projectPath) {
  const hits = new Set();
  try {
    const patterns = [/audit[_-]?log/i, /action[_-]?log/i, /activity[_-]?log/i];
    for (const dir of ['migrations', 'database/migrations', 'backend/migrations', 'src/migrations']) {
      const abs = path.join(projectPath, dir);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
      for (const entry of fs.readdirSync(abs)) {
        if (patterns.some((p) => p.test(entry))) hits.add(entry);
      }
    }
  } catch { /* best effort */ }
  return [...hits];
}

/**
 * Run the scanner.
 *
 * @param {string} projectPath
 * @returns {{
 *   deps_found: number,
 *   authentication: Record<string,string[]>,
 *   password_hashing: Record<string,string[]>,
 *   authorization: Record<string,string[]>,
 *   network_security: Record<string,string[]>,
 *   data_protection: Record<string,string[]>,
 *   auditing: Record<string,string[]>,
 *   tls_hints: string[],
 *   audit_tables: string[],
 * }}
 */
function scanSecurity(projectPath) {
  const deps = collectDependencies(projectPath);
  return {
    deps_found: deps.length,
    authentication:   matchCategory(deps, MATCHERS.authentication),
    password_hashing: matchCategory(deps, MATCHERS.password_hashing),
    authorization:    matchCategory(deps, MATCHERS.authorization),
    network_security: matchCategory(deps, MATCHERS.network_security),
    data_protection:  matchCategory(deps, MATCHERS.data_protection),
    auditing:         matchCategory(deps, MATCHERS.auditing),
    tls_hints:        scanComposeForTls(projectPath),
    audit_tables:     scanForAuditTables(projectPath),
  };
}

module.exports = {
  scanSecurity,
  collectDependencies,
  matchCategory,
  MATCHERS,
};
