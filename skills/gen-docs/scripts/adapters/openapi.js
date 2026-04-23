'use strict';

/**
 * OpenAPI / Swagger adapter.
 *
 * Loads a local OpenAPI 3.x or Swagger 2.0 document, normalises it into a
 * flat endpoint list, and emits a Markdown section for the technical
 * description. URL fetching is NOT implemented here — the orchestrator can
 * download a spec separately and pass the local path.
 *
 * Normalization keeps only the fields documentation actually needs:
 * method, path, summary, description, parameters, request body content
 * types, response status codes, and tags. Everything else (examples,
 * callbacks, security schemes, extensions) is dropped.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const YAML = resolveModule('yaml');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function normaliseSpec(raw) {
  if (!raw || typeof raw !== 'object') {
    return { info: null, servers: [], endpoints: [], warnings: ['spec is not an object'] };
  }
  const warnings = [];
  const isV3 = typeof raw.openapi === 'string' && raw.openapi.startsWith('3');
  const isV2 = typeof raw.swagger === 'string' && raw.swagger.startsWith('2');
  if (!isV3 && !isV2) {
    warnings.push('spec version is not OpenAPI 3.x or Swagger 2.0; parsing with best-effort');
  }

  const info = raw.info ? {
    title: raw.info.title || null,
    version: raw.info.version || null,
    description: raw.info.description || null,
  } : null;

  const servers = Array.isArray(raw.servers)
    ? raw.servers.map((s) => ({ url: s.url, description: s.description || null }))
    : (raw.host ? [{ url: `${raw.schemes?.[0] || 'https'}://${raw.host}${raw.basePath || ''}`, description: null }] : []);

  /** @type {Array<object>} */
  const endpoints = [];
  const paths = raw.paths || {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !op) continue;
      const opParams = Array.isArray(op.parameters) ? op.parameters : [];
      const allParams = [...pathLevelParams, ...opParams].map((p) => ({
        name: p.name,
        in: p.in || 'query',
        required: Boolean(p.required),
        type: (p.schema && (p.schema.type || p.schema.format)) || p.type || 'string',
        description: p.description || null,
      }));

      let requestBody = null;
      if (op.requestBody && op.requestBody.content && typeof op.requestBody.content === 'object') {
        const contentTypes = Object.keys(op.requestBody.content);
        requestBody = {
          content_types: contentTypes,
          description: op.requestBody.description || null,
        };
      } else if (op.consumes) {
        requestBody = { content_types: op.consumes, description: null };
      }

      const responses = [];
      const resp = op.responses || {};
      for (const [status, resBody] of Object.entries(resp)) {
        if (!resBody || typeof resBody !== 'object') continue;
        const contentTypes = resBody.content ? Object.keys(resBody.content) : (op.produces || []);
        responses.push({
          status,
          description: resBody.description || null,
          content_types: contentTypes,
        });
      }

      endpoints.push({
        method: method.toUpperCase(),
        path: pathKey,
        summary: op.summary || null,
        description: op.description || null,
        operation_id: op.operationId || null,
        tags: Array.isArray(op.tags) ? op.tags : [],
        parameters: allParams,
        request_body: requestBody,
        responses,
      });
    }
  }

  return { info, servers, endpoints, warnings };
}

function loadSpec(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') return JSON.parse(content);
  return YAML.parse(content);
}

/**
 * @param {string} filePath
 * @returns {{ info: object|null, servers: object[], endpoints: object[], warnings: string[] }}
 */
function loadAndNormalise(filePath) {
  if (!fs.existsSync(filePath)) {
    return { info: null, servers: [], endpoints: [], warnings: [`spec file does not exist: ${filePath}`] };
  }
  const raw = loadSpec(filePath);
  return normaliseSpec(raw);
}

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderParametersTable(params, lang) {
  if (!params || params.length === 0) return '';
  const t = lang === 'en'
    ? { n: 'Name', loc: 'In', req: 'Required', type: 'Type', desc: 'Description' }
    : { n: 'Параметр', loc: 'Место', req: 'Обязательный', type: 'Тип', desc: 'Описание' };
  const out = [`| ${t.n} | ${t.loc} | ${t.req} | ${t.type} | ${t.desc} |`, '|---|---|---|---|---|'];
  for (const p of params) {
    out.push(`| ${escapeCell(p.name)} | ${escapeCell(p.in)} | ${p.required ? '✓' : ''} | ${escapeCell(p.type)} | ${escapeCell(p.description)} |`);
  }
  return out.join('\n');
}

function renderResponsesTable(responses, lang) {
  if (!responses || responses.length === 0) return '';
  const t = lang === 'en'
    ? { s: 'Status', desc: 'Description', ct: 'Content-Type' }
    : { s: 'Код', desc: 'Описание', ct: 'Content-Type' };
  const out = [`| ${t.s} | ${t.desc} | ${t.ct} |`, '|---|---|---|'];
  for (const r of responses) {
    const ct = r.content_types && r.content_types.length > 0 ? r.content_types.join(', ') : '';
    out.push(`| ${escapeCell(r.status)} | ${escapeCell(r.description)} | ${escapeCell(ct)} |`);
  }
  return out.join('\n');
}

/**
 * Build a Markdown section out of a normalised spec.
 *
 * @param {ReturnType<typeof normaliseSpec>} spec
 * @param {{ headingLevel?: number, lang?: 'ru'|'en' }} [opts]
 * @returns {string}
 */
function buildMarkdown(spec, opts = {}) {
  const level = opts.headingLevel || 3;
  const hash = '#'.repeat(level);
  const sub = '#'.repeat(level + 1);
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  if (!spec || !Array.isArray(spec.endpoints) || spec.endpoints.length === 0) return '';
  const t = lang === 'en'
    ? { params: 'Parameters', body: 'Request body', resp: 'Responses' }
    : { params: 'Параметры', body: 'Тело запроса', resp: 'Ответы' };

  const out = [];
  // Optionally group by tag.
  const byTag = new Map();
  for (const ep of spec.endpoints) {
    const tag = ep.tags && ep.tags[0] ? ep.tags[0] : '_';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(ep);
  }
  const tags = [...byTag.keys()].sort();

  for (const tag of tags) {
    if (tag !== '_') out.push(`${hash} ${tag}`);
    for (const ep of byTag.get(tag)) {
      out.push(`${sub} ${ep.method} ${ep.path}`);
      if (ep.summary) out.push('', ep.summary);
      if (ep.description) out.push('', ep.description);
      if (ep.parameters && ep.parameters.length > 0) {
        out.push('', `**${t.params}:**`, '', renderParametersTable(ep.parameters, lang));
      }
      if (ep.request_body) {
        const desc = ep.request_body.description ? ` — ${ep.request_body.description}` : '';
        const ct = ep.request_body.content_types.join(', ');
        out.push('', `**${t.body}:** ${ct}${desc}`);
      }
      if (ep.responses && ep.responses.length > 0) {
        out.push('', `**${t.resp}:**`, '', renderResponsesTable(ep.responses, lang));
      }
      out.push('');
    }
  }
  return out.join('\n').trim() + '\n';
}

module.exports = {
  loadAndNormalise,
  normaliseSpec,
  buildMarkdown,
  HTTP_METHODS,
};
