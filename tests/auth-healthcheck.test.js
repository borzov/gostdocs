const healthcheck = require('../skills/gen-docs/scripts/adapters/auth/healthcheck');

const META = {
  app: { url: 'http://localhost:3000' },
  auth: { healthcheck_path: '/api/me', authorization_scheme: 'Bearer' },
};

function makePage({ landingUrl, storageValue, meStatus, meOk = null }) {
  const ok = meOk !== null ? meOk : meStatus >= 200 && meStatus < 300;
  return {
    goto: jest.fn(async () => {}),
    url: jest.fn(() => landingUrl),
    evaluate: jest.fn(async () => storageValue),
    request: {
      get: jest.fn(async () => ({
        ok: () => ok,
        status: () => meStatus,
      })),
    },
  };
}

describe('loginPaths / isLoginPath', () => {
  test('includes defaults and role login_url', () => {
    const paths = healthcheck.loginPaths(
      { loginUrl: '/custom-login' },
      { app: { url: 'http://x' }, auth: { default_login_url: '/enter' } },
    );
    expect(paths).toContain('/login');
    expect(paths).toContain('/signin');
    expect(paths).toContain('/custom-login');
    expect(paths).toContain('/enter');
  });

  test('isLoginPath matches exact and subpaths', () => {
    expect(healthcheck.isLoginPath('/login', ['/login'])).toBe(true);
    expect(healthcheck.isLoginPath('/login/2fa', ['/login'])).toBe(true);
    expect(healthcheck.isLoginPath('/dashboard', ['/login'])).toBe(false);
  });
});

describe('verifyAuth', () => {
  const authCtx = {
    role: 'admin',
    method: 'api',
    storage: 'localStorage',
    tokenKey: 'access_token',
    tokenValue: 'tok',
    loginUrl: '/login',
  };

  test('all checks pass', async () => {
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: 'tok',
      meStatus: 200,
    });
    const result = await healthcheck.verifyAuth(page, authCtx, META);
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(3);
    const me = result.checks.find((c) => c.name === 'me');
    expect(me.detail).toMatch(/200/);
    const urlCheck = result.checks.find((c) => c.name === 'url');
    expect(urlCheck.passed).toBe(true);
    const storageCheck = result.checks.find((c) => c.name === 'storage');
    expect(storageCheck.passed).toBe(true);
  });

  test('fails when user lands on login URL after goto', async () => {
    const page = makePage({
      landingUrl: 'http://localhost:3000/login',
      storageValue: 'tok',
      meStatus: 200,
    });
    const result = await healthcheck.verifyAuth(page, authCtx, META);
    expect(result.passed).toBe(false);
    const urlCheck = result.checks.find((c) => c.name === 'url');
    expect(urlCheck.passed).toBe(false);
    expect(urlCheck.detail).toMatch(/did not stick/);
  });

  test('fails when token missing from storage', async () => {
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: null,
      meStatus: 200,
    });
    const result = await healthcheck.verifyAuth(page, authCtx, META);
    const storageCheck = result.checks.find((c) => c.name === 'storage');
    expect(storageCheck.passed).toBe(false);
  });

  test('sends Authorization header for token-based auth', async () => {
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: 'tok',
      meStatus: 200,
    });
    await healthcheck.verifyAuth(page, authCtx, META);
    const call = page.request.get.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api/me');
    expect(call[1].headers.Authorization).toBe('Bearer tok');
  });

  test('skips Authorization header for cookie-based auth', async () => {
    const cookieCtx = { ...authCtx, storage: 'cookie', tokenKey: null, tokenValue: null };
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: null,
      meStatus: 200,
    });
    await healthcheck.verifyAuth(page, cookieCtx, META);
    const call = page.request.get.mock.calls[0];
    expect(call[1].headers.Authorization).toBeUndefined();
  });

  test('me check skipped when healthcheck_path absent', async () => {
    const metaNoMe = { ...META, auth: {} };
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: 'tok',
      meStatus: 200,
    });
    const result = await healthcheck.verifyAuth(page, authCtx, metaNoMe);
    const me = result.checks.find((c) => c.name === 'me');
    expect(me.skipped).toBe(true);
    expect(me.passed).toBe(true);
  });

  test('me check fails on 401', async () => {
    const page = makePage({
      landingUrl: 'http://localhost:3000/dashboard',
      storageValue: 'tok',
      meStatus: 401,
      meOk: false,
    });
    const result = await healthcheck.verifyAuth(page, authCtx, META);
    const me = result.checks.find((c) => c.name === 'me');
    expect(me.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});
