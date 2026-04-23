const fs = require('fs');
const os = require('os');
const path = require('path');

const openapi = require('../skills/gen-docs/scripts/adapters/openapi');

function tmpFile(contents, ext = '.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-oas-'));
  const file = path.join(dir, `spec${ext}`);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

const MINIMAL_OPENAPI_3 = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000/api' }],
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': {} } },
        },
        tags: ['Users'],
      },
      post: {
        summary: 'Create user',
        requestBody: { content: { 'application/json': {} }, description: 'User payload' },
        responses: { '201': { description: 'Created' } },
        tags: ['Users'],
      },
    },
    '/health': {
      get: { summary: 'Health', responses: { '200': { description: 'OK' } } },
    },
  },
};

describe('normaliseSpec', () => {
  test('extracts endpoints from OpenAPI 3', () => {
    const n = openapi.normaliseSpec(MINIMAL_OPENAPI_3);
    expect(n.info.title).toBe('Test API');
    expect(n.servers).toHaveLength(1);
    expect(n.endpoints).toHaveLength(3);
    const getUsers = n.endpoints.find((e) => e.method === 'GET' && e.path === '/users');
    expect(getUsers.parameters[0]).toMatchObject({ name: 'limit', type: 'integer' });
    expect(getUsers.responses[0].status).toBe('200');
    const postUsers = n.endpoints.find((e) => e.method === 'POST');
    expect(postUsers.request_body.content_types).toEqual(['application/json']);
  });

  test('handles Swagger 2.0 with host/basePath', () => {
    const swagger2 = {
      swagger: '2.0',
      host: 'api.example.com',
      basePath: '/v1',
      info: { title: 'X', version: '1' },
      paths: {
        '/things': {
          get: {
            parameters: [{ name: 'q', in: 'query', type: 'string' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    const n = openapi.normaliseSpec(swagger2);
    expect(n.servers).toHaveLength(1);
    expect(n.servers[0].url).toMatch(/api.example.com/);
    expect(n.endpoints).toHaveLength(1);
  });

  test('warns on unknown version', () => {
    const n = openapi.normaliseSpec({ paths: {} });
    expect(n.warnings.length).toBeGreaterThan(0);
  });
});

describe('loadAndNormalise', () => {
  test('loads JSON', () => {
    const file = tmpFile(JSON.stringify(MINIMAL_OPENAPI_3), '.json');
    const n = openapi.loadAndNormalise(file);
    expect(n.endpoints.length).toBeGreaterThan(0);
  });

  test('loads YAML', () => {
    const yaml = [
      'openapi: "3.0.0"',
      'info:',
      '  title: T',
      '  version: "1.0"',
      'paths:',
      '  /x:',
      '    get:',
      '      responses:',
      '        "200":',
      '          description: OK',
    ].join('\n');
    const file = tmpFile(yaml, '.yaml');
    const n = openapi.loadAndNormalise(file);
    expect(n.endpoints).toHaveLength(1);
    expect(n.endpoints[0].method).toBe('GET');
  });

  test('missing file returns warning', () => {
    const n = openapi.loadAndNormalise('/nonexistent/spec.yaml');
    expect(n.endpoints).toEqual([]);
    expect(n.warnings[0]).toMatch(/does not exist/);
  });
});

describe('buildMarkdown', () => {
  test('emits grouped sections by tag', () => {
    const n = openapi.normaliseSpec(MINIMAL_OPENAPI_3);
    const md = openapi.buildMarkdown(n);
    expect(md).toMatch(/### Users/);
    expect(md).toMatch(/#### GET \/users/);
    expect(md).toMatch(/#### POST \/users/);
    expect(md).toMatch(/Параметры/);
    expect(md).toMatch(/Ответы/);
  });

  test('english lang', () => {
    const n = openapi.normaliseSpec(MINIMAL_OPENAPI_3);
    const md = openapi.buildMarkdown(n, { lang: 'en' });
    expect(md).toMatch(/Parameters/);
    expect(md).toMatch(/Responses/);
  });

  test('empty endpoints produces empty string', () => {
    expect(openapi.buildMarkdown({ info: null, servers: [], endpoints: [], warnings: [] })).toBe('');
  });
});
