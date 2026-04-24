'use strict';

/**
 * Heuristic protocols scanner.
 *
 * Fills the "Протоколы и форматы данных" table in the technical
 * description. Previously that table shipped as a header-only shell
 * and md-lint flagged it every run. We now build rows from the
 * project's actual dependency footprint and, when present, the
 * OpenAPI document.
 *
 * Output shape:
 *   [
 *     { source: 'Клиент', target: 'Сервер приложения', protocol: 'HTTPS (REST)', format: 'JSON' },
 *     …
 *   ]
 *
 * Callers convert this to a Doc-Model table. Pure, synchronous, no network.
 */

const fs = require('fs');
const path = require('path');

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readDeps(projectPath) {
  const deps = [];
  try {
    const pkg = safeRead(path.join(projectPath, 'package.json'));
    if (pkg) {
      const obj = JSON.parse(pkg);
      deps.push(...Object.keys(obj.dependencies || {}), ...Object.keys(obj.devDependencies || {}));
    }
  } catch { /* ignore */ }
  try {
    const composer = safeRead(path.join(projectPath, 'composer.json'));
    if (composer) {
      const obj = JSON.parse(composer);
      deps.push(...Object.keys(obj.require || {}), ...Object.keys(obj['require-dev'] || {}));
    }
  } catch { /* ignore */ }
  const req = safeRead(path.join(projectPath, 'requirements.txt'));
  if (req) deps.push(...req.split('\n').map((l) => l.split(/[<>=!;]/)[0].trim()).filter(Boolean));
  const gomod = safeRead(path.join(projectPath, 'go.mod'));
  if (gomod) {
    for (const line of gomod.split('\n')) {
      const m = line.match(/^\s*([a-z0-9.\/_-]+)\s+v\d/i);
      if (m) deps.push(m[1]);
    }
  }
  return deps;
}

function readCompose(projectPath) {
  return safeRead(path.join(projectPath, 'docker-compose.yml'))
    || safeRead(path.join(projectPath, 'docker-compose.yaml'))
    || '';
}

function readOpenApi(projectPath) {
  for (const p of [
    'openapi.json', 'openapi.yaml', 'openapi.yml',
    'docs/openapi.json', 'docs/openapi.yaml',
    'api/openapi.json', 'api/openapi.yaml',
  ]) {
    const content = safeRead(path.join(projectPath, p));
    if (content) return content;
  }
  return '';
}

/**
 * @param {string} projectPath
 * @param {{ lang?: 'ru'|'en' }} [opts]
 * @returns {Array<{ source: string, target: string, protocol: string, format: string }>}
 */
function scanProtocols(projectPath, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const L = lang === 'ru' ? {
    client: 'Клиент',
    server: 'Сервер приложения',
    worker: 'Фоновый воркер',
    cache:  'Кеш',
    db:     'База данных',
    email:  'SMTP-сервер',
    browser: 'Браузер',
  } : {
    client: 'Client',
    server: 'Application server',
    worker: 'Background worker',
    cache:  'Cache',
    db:     'Database',
    email:  'SMTP server',
    browser: 'Browser',
  };

  const deps = readDeps(projectPath);
  const compose = readCompose(projectPath);
  const openapi = readOpenApi(projectPath);
  const rows = [];

  // Base HTTP channel — always present for a web app.
  rows.push({ source: L.client, target: L.server, protocol: 'HTTPS (REST)', format: 'JSON' });

  // WebSocket — detect in deps.
  if (deps.some((d) => /\bws\b|socket\.io|@nestjs\/websockets|ratchetphp|django-channels|fastapi.*websocket|faye\/faye-websocket/i.test(d))
      || /\bwebsockets?\b/i.test(compose)) {
    rows.push({ source: L.browser, target: L.server, protocol: 'WSS (WebSocket)', format: 'JSON' });
  }

  // SSE — detect text/event-stream or EventSource in deps or openapi.
  if (/text\/event-stream|EventSource/.test(openapi)
      || deps.some((d) => /sse|event-stream|eventsource/i.test(d))) {
    rows.push({ source: L.server, target: L.browser, protocol: 'SSE (Server-Sent Events)', format: 'text/event-stream' });
  }

  // GraphQL — detect graphql packages.
  if (deps.some((d) => /graphql|apollo-server|hasura/i.test(d))) {
    rows.push({ source: L.client, target: L.server, protocol: 'HTTPS (GraphQL)', format: 'JSON' });
  }

  // gRPC — detect grpc packages.
  if (deps.some((d) => /^grpc|@grpc\/|grpc-js|grpcio/i.test(d))) {
    rows.push({ source: L.client, target: L.server, protocol: 'gRPC (HTTP/2)', format: 'Protocol Buffers' });
  }

  // Queue traffic — AMQP / Redis-backed queues.
  if (deps.some((d) => /amqplib|rabbit|aio-pika|kombu|php-amqplib/i.test(d))) {
    rows.push({ source: L.server, target: L.worker, protocol: 'AMQP (RabbitMQ)', format: 'JSON' });
  }
  if (deps.some((d) => /bullmq|bull\b|sidekiq|laravel\/horizon|rq\b|dramatiq/i.test(d))) {
    rows.push({ source: L.server, target: L.worker, protocol: 'Redis (queue)', format: 'JSON' });
  }

  // Cache traffic.
  if (deps.some((d) => /^redis$|ioredis|redis-py|predis|phpredis/i.test(d)) || /\bredis\b/i.test(compose)) {
    rows.push({ source: L.server, target: L.cache, protocol: 'Redis (RESP)', format: lang === 'ru' ? 'двоичный' : 'binary' });
  }
  if (deps.some((d) => /memcache/i.test(d)) || /\bmemcached\b/i.test(compose)) {
    rows.push({ source: L.server, target: L.cache, protocol: 'memcached', format: lang === 'ru' ? 'двоичный' : 'binary' });
  }

  // Database — infer engine from compose + deps.
  if (/postgres/i.test(compose) || deps.some((d) => /\bpg\b|postgres|psycopg|pdo_pgsql|gorm\.io\/driver\/postgres/i.test(d))) {
    rows.push({ source: L.server, target: L.db, protocol: 'PostgreSQL wire', format: lang === 'ru' ? 'двоичный' : 'binary' });
  } else if (/mysql|mariadb/i.test(compose) || deps.some((d) => /mysql|mariadb|pdo_mysql/i.test(d))) {
    rows.push({ source: L.server, target: L.db, protocol: 'MySQL wire', format: lang === 'ru' ? 'двоичный' : 'binary' });
  } else if (/mongo/i.test(compose) || deps.some((d) => /mongoose|pymongo|mongodb/i.test(d))) {
    rows.push({ source: L.server, target: L.db, protocol: 'MongoDB wire', format: 'BSON' });
  }

  // Email.
  if (deps.some((d) => /nodemailer|smtp|phpmailer|symfony\/mailer|django-ses|aiosmtpd/i.test(d))) {
    rows.push({ source: L.server, target: L.email, protocol: 'SMTP / STARTTLS', format: 'RFC 5322' });
  }

  return rows;
}

module.exports = {
  scanProtocols,
  readDeps,
};
