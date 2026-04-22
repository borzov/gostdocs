const api = require('../skills/gen-docs/scripts/adapters/auth/api');

function mkResponse({ status = 200, body = null, cookies = [] } = {}) {
  const headers = new Map();
  headers.set('content-type', body ? 'application/json' : 'text/plain');
  const setCookies = Array.isArray(cookies) ? cookies : [cookies];
  return {
    status,
    headers: {
      get: (name) => headers.get(name.toLowerCase()) || null,
      getSetCookie: () => setCookies,
    },
    async json() {
      if (!body) throw new Error('no body');
      return body;
    },
  };
}

const META = {
  app: { url: 'http://localhost:3000', launch: 'url' },
  auth: { method: 'api', storage: 'auto' },
};

describe('buildLoginBody', () => {
  test('uses explicit login_body when provided', () => {
    expect(api.buildLoginBody({
      role: 'admin',
      login_body: { email: 'x', passwd: 'y' },
    })).toEqual({ email: 'x', passwd: 'y' });
  });

  test('uses email key when username looks like email', () => {
    expect(api.buildLoginBody({ role: 'admin', username: 'a@b.c', password: 'p' }))
      .toEqual({ email: 'a@b.c', password: 'p' });
  });

  test('uses username key otherwise', () => {
    expect(api.buildLoginBody({ role: 'admin', username: 'jane', password: 'p' }))
      .toEqual({ username: 'jane', password: 'p' });
  });

  test('honours username_key override', () => {
    expect(api.buildLoginBody({ role: 'admin', username_key: 'login', username: 'j', password: 'p' }))
      .toEqual({ login: 'j', password: 'p' });
  });
});

describe('apiLoginRequest', () => {
  test('returns ok + token + storage=localStorage when JSON has token and no cookies', async () => {
    const fetchImpl = jest.fn(async () => mkResponse({ status: 200, body: { access_token: 'abc' } }));
    const role = { role: 'admin', api_endpoint: '/api/login', username: 'u', password: 'p' };
    const result = await api.apiLoginRequest(role, META, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.tokenKey).toBe('access_token');
    expect(result.tokenValue).toBe('abc');
    expect(result.storage).toBe('localStorage');
    expect(result.cookies).toEqual([]);
  });

  test('returns storage=mixed when both cookie and body token present', async () => {
    const fetchImpl = jest.fn(async () => mkResponse({
      status: 200,
      body: { access_token: 'tok' },
      cookies: ['session=abc; Path=/; HttpOnly'],
    }));
    const role = { role: 'admin', api_endpoint: '/api/login', username: 'u', password: 'p' };
    const result = await api.apiLoginRequest(role, META, { fetchImpl });
    expect(result.storage).toBe('mixed');
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0].name).toBe('session');
  });

  test('returns storage=cookie when only cookie set', async () => {
    const fetchImpl = jest.fn(async () => mkResponse({
      status: 200,
      cookies: ['session=abc'],
    }));
    const role = { role: 'admin', api_endpoint: '/api/login', username: 'u', password: 'p' };
    const result = await api.apiLoginRequest(role, META, { fetchImpl });
    expect(result.storage).toBe('cookie');
    expect(result.tokenKey).toBeNull();
  });

  test('returns !ok with remediation on 401', async () => {
    const fetchImpl = jest.fn(async () => mkResponse({ status: 401 }));
    const role = { role: 'admin', api_endpoint: '/api/login', username: 'u', password: 'wrong' };
    const result = await api.apiLoginRequest(role, META, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/401/);
  });

  test('catches fetch errors', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const role = { role: 'admin', api_endpoint: '/api/login', username: 'u', password: 'p' };
    const result = await api.apiLoginRequest(role, META, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  test('throws for missing api_endpoint', async () => {
    await expect(
      api.apiLoginRequest({ role: 'admin', username: 'u', password: 'p' }, META, { fetchImpl: async () => mkResponse({}) }),
    ).rejects.toThrow(/api_endpoint/);
  });

  test('honours custom login_method and login_headers', async () => {
    const fetchImpl = jest.fn(async () => mkResponse({ status: 200, body: { token: 'x' } }));
    const role = {
      role: 'admin',
      api_endpoint: '/api/login',
      login_method: 'PUT',
      login_headers: { 'x-client': 'gen-docs' },
      username: 'u',
      password: 'p',
    };
    await api.apiLoginRequest(role, META, { fetchImpl });
    const call = fetchImpl.mock.calls[0];
    expect(call[1].method).toBe('PUT');
    expect(call[1].headers['x-client']).toBe('gen-docs');
  });
});

describe('toPrelude', () => {
  test('localStorage storage yields addInitScript', () => {
    const prelude = api.toPrelude({
      ok: true, status: 200,
      tokenKey: 'tok', tokenValue: 'abc',
      storage: 'localStorage', cookies: [],
    });
    expect(prelude.addInitScript).toContain('window.localStorage.setItem');
    expect(prelude.cookies).toEqual([]);
  });

  test('cookie storage yields no addInitScript', () => {
    const prelude = api.toPrelude({
      ok: true, status: 200,
      tokenKey: null, tokenValue: null,
      storage: 'cookie',
      cookies: [{ name: 's', value: 'v', url: 'http://localhost:3000' }],
    });
    expect(prelude.addInitScript).toBeNull();
    expect(prelude.cookies).toHaveLength(1);
  });
});
