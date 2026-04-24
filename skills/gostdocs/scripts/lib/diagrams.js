'use strict';

/**
 * Auto-synthesised Mermaid diagrams.
 *
 * The mermaid expander first looks for hand-written diagram sources in the
 * research corpus. When nothing is found, it falls back to these synthesisers
 * so every documentation still gets a reasonable set of visuals without
 * manual diagram authoring. All functions are pure: they take already-parsed
 * scan results and return a mermaid source string (or null if the input is
 * too sparse to produce a meaningful picture).
 */

function quote(label) {
  if (!label) return '""';
  return `"${String(label).replace(/"/g, "'")}"`;
}

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function buildAuthSequenceMermaid(securityScan, opts = {}) {
  if (!securityScan) return null;
  const auth = securityScan.authentication || {};
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const t = lang === 'en'
    ? {
      user: 'User', client: 'Client', server: 'Server', store: 'Session/Token store',
      submit: 'Submits credentials', check: 'Validates credentials',
      tokenOut: 'Issues JWT / session token', tokenStore: 'Caches token state',
      request: 'Calls protected endpoint with token', verify: 'Verifies token',
      response: 'Returns protected resource',
    }
    : {
      user: 'Пользователь', client: 'Клиент', server: 'Сервер приложения', store: 'Хранилище сессий/токенов',
      submit: 'Отправляет логин и пароль', check: 'Проверяет учётные данные',
      tokenOut: 'Выдаёт JWT / токен сессии', tokenStore: 'Сохраняет состояние токена',
      request: 'Вызывает защищённый эндпоинт с токеном', verify: 'Проверяет токен',
      response: 'Возвращает защищённый ресурс',
    };

  const usesJwt = Boolean(auth.jwt);
  const usesSession = Boolean(auth.session);
  if (!usesJwt && !usesSession && Object.keys(auth).length === 0) return null;

  const lines = [
    'sequenceDiagram',
    `    actor U as ${t.user}`,
    `    participant C as ${t.client}`,
    `    participant S as ${t.server}`,
    `    participant D as ${t.store}`,
    `    U->>C: ${t.submit}`,
    `    C->>S: POST /auth/login`,
    `    S->>S: ${t.check}`,
    `    S->>D: ${t.tokenStore}`,
    `    S-->>C: ${t.tokenOut}`,
    `    C->>S: ${t.request}`,
    `    S->>D: ${t.verify}`,
    `    S-->>C: ${t.response}`,
  ];
  return lines.join('\n');
}

function buildComponentDiagramMermaid(inputs, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const { stack = null, scalingScan = null, protocolsScan = [], securityScan = null } = inputs || {};
  const t = lang === 'en'
    ? {
      client: 'Client (Browser)', server: 'Application Server', db: 'Database',
      cache: 'Cache', lb: 'Reverse Proxy / LB', auth: 'Authentication',
    }
    : {
      client: 'Клиент (браузер)', server: 'Сервер приложения', db: 'База данных',
      cache: 'Кеш', lb: 'Reverse-proxy / LB', auth: 'Аутентификация',
    };

  const hasLoadBalancer = scalingScan && scalingScan.load_balancer && Object.keys(scalingScan.load_balancer).length > 0;
  const hasCache = scalingScan && scalingScan.caching && Object.keys(scalingScan.caching).length > 0;
  const hasDb = Array.isArray(protocolsScan) && protocolsScan.some((r) => /postgres|mysql|sqlite|mongo|mariadb|database/i.test(r.target || ''));
  const hasAuth = securityScan && Object.keys(securityScan.authentication || {}).length > 0;
  const stackName = stack && stack.frontend_framework ? stack.frontend_framework : null;
  const backendName = stack && stack.backend_framework ? stack.backend_framework : null;

  if (!hasDb && !hasCache && !hasLoadBalancer && !backendName) return null;

  const lines = ['graph TB'];
  lines.push(`    Client[${quote(stackName ? `${t.client}\\n${stackName}` : t.client)}]`);
  if (hasLoadBalancer) lines.push(`    LB[${quote(t.lb)}]`);
  lines.push(`    Server[${quote(backendName ? `${t.server}\\n${backendName}` : t.server)}]`);
  if (hasAuth) lines.push(`    Auth[${quote(t.auth)}]`);
  if (hasCache) lines.push(`    Cache[${quote(t.cache)}]`);
  if (hasDb) lines.push(`    DB[(${quote(t.db)})]`);

  if (hasLoadBalancer) {
    lines.push('    Client -->|HTTPS| LB');
    lines.push('    LB --> Server');
  } else {
    lines.push('    Client -->|HTTPS| Server');
  }
  if (hasAuth) lines.push('    Server --> Auth');
  if (hasCache) lines.push('    Server --> Cache');
  if (hasDb) lines.push('    Server --> DB');
  if (hasCache && hasDb) lines.push('    Cache -.-> DB');
  return lines.join('\n');
}

function buildDataFlowMermaid(inputs, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const { schema = null, protocolsScan = [] } = inputs || {};
  const tables = schema && Array.isArray(schema.tables) ? schema.tables.slice(0, 5).map((t) => t.name) : [];
  const targets = uniq((protocolsScan || []).map((r) => r.target));
  if (tables.length === 0 && targets.length === 0) return null;

  const t = lang === 'en'
    ? { user: 'User action', form: 'Form / API call', server: 'Server handler', orm: 'ORM / Query', storage: 'Storage' }
    : { user: 'Действие пользователя', form: 'Форма / API', server: 'Обработчик на сервере', orm: 'ORM / запрос', storage: 'Хранилище' };

  const lines = ['graph LR'];
  lines.push(`    U[${quote(t.user)}] --> F[${quote(t.form)}]`);
  lines.push(`    F --> S[${quote(t.server)}]`);
  lines.push(`    S --> O[${quote(t.orm)}]`);

  const storageLabel = tables.length > 0
    ? `${t.storage}\\n${tables.join(', ')}${schema.tables.length > tables.length ? ', …' : ''}`
    : (targets.slice(0, 3).join(', ') || t.storage);
  lines.push(`    O --> D[(${quote(storageLabel)})]`);
  return lines.join('\n');
}

module.exports = {
  buildAuthSequenceMermaid,
  buildComponentDiagramMermaid,
  buildDataFlowMermaid,
};
