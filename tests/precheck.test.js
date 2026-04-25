const { runPrecheck, formatResult } = require('../skills/gostdocs/scripts/precheck');

function mockFetch(responses) {
  // Match either exact url or url with/without trailing slash.
  return jest.fn(async (url) => {
    const candidates = [url, url.endsWith('/') ? url.slice(0, -1) : `${url}/`];
    for (const candidate of candidates) {
      if (responses[candidate]) {
        const match = responses[candidate];
        if (match instanceof Error) throw match;
        return { status: match.status };
      }
    }
    throw new Error(`no mock for ${url}`);
  });
}

const BASE_META = {
  skill_version: '1.0.0',
  project_path: '/p',
  doc_types: ['user-guide'],
  gost_mode: 'lite',
  app: { url: 'http://localhost:3000', launch: 'url' },
  auth: { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [] },
  capture: {
    viewports: [{ name: 'desktop', width: 1280, height: 800 }],
    themes: [],
    locales: [],
    wait_after_navigation: 2000,
    timeout: 30000,
  },
  output: { languages: ['ru'], formats: ['docx'] },
  vision: { provider: 'claude' },
  precheck: { min_entities: {} },
  states: [],
  metadata: {},
};

describe('runPrecheck — baseUrl', () => {
  test('passes when baseUrl returns 200', async () => {
    const fetchImpl = mockFetch({ 'http://localhost:3000/': { status: 200 } });
    const result = await runPrecheck(BASE_META, { fetchImpl });
    const baseCheck = result.checks.find((c) => c.name === 'baseUrl');
    expect(baseCheck.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  test('fails when baseUrl returns 500', async () => {
    const fetchImpl = mockFetch({ 'http://localhost:3000/': { status: 500 } });
    const result = await runPrecheck(BASE_META, { fetchImpl });
    const baseCheck = result.checks.find((c) => c.name === 'baseUrl');
    expect(baseCheck.passed).toBe(false);
    expect(baseCheck.remediation).toMatch(/start the app/i);
    expect(result.passed).toBe(false);
  });

  test('fails when baseUrl throws', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await runPrecheck(BASE_META, { fetchImpl });
    const baseCheck = result.checks.find((c) => c.name === 'baseUrl');
    expect(baseCheck.passed).toBe(false);
    expect(baseCheck.detail).toMatch(/ECONNREFUSED/);
  });
});

describe('runPrecheck — health endpoint', () => {
  test('skipped when not configured', async () => {
    const fetchImpl = mockFetch({ 'http://localhost:3000/': { status: 200 } });
    const result = await runPrecheck(BASE_META, { fetchImpl });
    const healthCheck = result.checks.find((c) => c.name === 'health');
    expect(healthCheck.skipped).toBe(true);
    expect(healthCheck.passed).toBe(true);
  });

  test('passes when /health returns 200', async () => {
    const withHealth = { ...BASE_META, precheck: { health_endpoint: '/health', min_entities: {} } };
    const fetchImpl = mockFetch({
      'http://localhost:3000/': { status: 200 },
      'http://localhost:3000/health': { status: 200 },
    });
    const result = await runPrecheck(withHealth, { fetchImpl });
    const healthCheck = result.checks.find((c) => c.name === 'health');
    expect(healthCheck.passed).toBe(true);
  });

  test('fails when /health returns 503', async () => {
    const withHealth = { ...BASE_META, precheck: { health_endpoint: '/health', min_entities: {} } };
    const fetchImpl = mockFetch({
      'http://localhost:3000/': { status: 200 },
      'http://localhost:3000/health': { status: 503 },
    });
    const result = await runPrecheck(withHealth, { fetchImpl });
    const healthCheck = result.checks.find((c) => c.name === 'health');
    expect(healthCheck.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe('runPrecheck — API login', () => {
  test('skipped when auth.method != api', async () => {
    const fetchImpl = mockFetch({ 'http://localhost:3000/': { status: 200 } });
    const result = await runPrecheck(BASE_META, { fetchImpl });
    const authCheck = result.checks.find((c) => c.name === 'authLogin');
    expect(authCheck.skipped).toBe(true);
  });

  test('checks each role with api_endpoint', async () => {
    const withApi = {
      ...BASE_META,
      auth: {
        method: 'api',
        storage: 'localStorage',
        dismiss_selectors: [],
        roles: [
          {
            role: 'admin',
            api_endpoint: '/api/login',
            username: 'admin@example.com',
            password: 'secret',
          },
        ],
      },
    };
    const fetchImpl = mockFetch({
      'http://localhost:3000/': { status: 200 },
      'http://localhost:3000/api/login': { status: 200 },
    });
    const result = await runPrecheck(withApi, { fetchImpl });
    const admin = result.checks.find((c) => c.name === 'authLogin:admin');
    expect(admin.passed).toBe(true);
  });

  test('fails role with 401 response', async () => {
    const withApi = {
      ...BASE_META,
      auth: {
        method: 'api',
        storage: 'localStorage',
        dismiss_selectors: [],
        roles: [
          {
            role: 'admin',
            api_endpoint: '/api/login',
            username: 'admin',
            password: 'wrong',
          },
        ],
      },
    };
    const fetchImpl = mockFetch({
      'http://localhost:3000/': { status: 200 },
      'http://localhost:3000/api/login': { status: 401 },
    });
    const result = await runPrecheck(withApi, { fetchImpl });
    const admin = result.checks.find((c) => c.name === 'authLogin:admin');
    expect(admin.passed).toBe(false);
    expect(admin.remediation).toMatch(/credentials/);
    expect(result.passed).toBe(false);
  });

  test('form auth method is deferred with warning', async () => {
    const withForm = { ...BASE_META, auth: { ...BASE_META.auth, method: 'form', roles: [{ role: 'admin' }] } };
    const fetchImpl = mockFetch({ 'http://localhost:3000/': { status: 200 } });
    const result = await runPrecheck(withForm, { fetchImpl });
    const auth = result.checks.find((c) => c.name === 'authLogin');
    expect(auth.skipped).toBe(true);
    expect(auth.detail).toMatch(/deferred/);
  });
});

describe('formatResult', () => {
  test('prints OK / FAIL markers', () => {
    const result = {
      passed: false,
      checks: [
        { name: 'baseUrl', passed: true, detail: 'ok' },
        { name: 'health', passed: false, detail: 'down', remediation: 'start it' },
      ],
    };
    const out = formatResult(result);
    expect(out).toMatch(/\[OK\] baseUrl/);
    expect(out).toMatch(/\[FAIL\] health/);
    expect(out).toMatch(/hint: start it/);
    expect(out).toMatch(/FAILED/);
  });
});
