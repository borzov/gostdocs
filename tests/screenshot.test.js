// Mock playwright before requiring the module
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

const {
  autoDetectFormFields,
  probeRoutes,
  authenticate,
  captureRoleScreenshots,
} = require('../skills/gostdocs/scripts/screenshot');

// ---------------------------------------------------------------------------
// autoDetectFormFields
// ---------------------------------------------------------------------------

function makePage(domShape) {
  return {
    $: jest.fn(async (selector) => domShape[selector] || null),
    evaluate: jest.fn(async (fn) => fn()),
  };
}

describe('autoDetectFormFields', () => {
  test('returns null when no password field exists', async () => {
    const page = makePage({});
    // page.$ returns null (no password field) so autoDetectFormFields returns early
    // without ever calling page.evaluate

    const result = await autoDetectFormFields(page);
    expect(result).toBeNull();
  });

  test('detects password field by id', async () => {
    const page = {
      $: jest.fn(async (selector) =>
        selector === 'input[type=password]' ? {} : null
      ),
      evaluate: jest.fn()
        .mockResolvedValueOnce('#password')   // passwordSelector
        .mockResolvedValueOnce('#email')      // usernameSelector
        .mockResolvedValueOnce('button[type=submit]'), // submitSelector
    };

    const result = await autoDetectFormFields(page);
    expect(result).toEqual({
      passwordSelector: '#password',
      usernameSelector: '#email',
      submitSelector: 'button[type=submit]',
    });
  });
});

// ---------------------------------------------------------------------------
// probeRoutes
// ---------------------------------------------------------------------------

describe('probeRoutes', () => {
  function makeProbeContext() {
    const page = {
      goto: jest.fn(),
      url: jest.fn(),
      $: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
    const context = {
      newPage: jest.fn(async () => page),
      close: jest.fn(),
    };
    const browser = {
      newContext: jest.fn(async () => context),
    };
    return { browser, context, page };
  }

  test('marks route as public when no redirect and no password field', async () => {
    const { browser, page } = makeProbeContext({});
    page.goto.mockResolvedValue(undefined);
    page.url.mockReturnValue('http://localhost:3000/dashboard');
    page.$.mockResolvedValue(null); // no password field

    const pages = [{ id: 'dashboard', path: '/dashboard' }];
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const result = await probeRoutes(pages, config, browser);
    expect(result).toEqual({ dashboard: 'public' });
  });

  test('marks route as auth_required when redirected to different path', async () => {
    const { browser, page } = makeProbeContext({});
    page.goto.mockResolvedValue(undefined);
    page.url.mockReturnValue('http://localhost:3000/login'); // redirected!
    page.$.mockResolvedValue(null);

    const pages = [{ id: 'dashboard', path: '/dashboard' }];
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const result = await probeRoutes(pages, config, browser);
    expect(result).toEqual({ dashboard: 'auth_required' });
  });

  test('marks route as auth_required when password field present', async () => {
    const { browser, page } = makeProbeContext({});
    page.goto.mockResolvedValue(undefined);
    page.url.mockReturnValue('http://localhost:3000/admin'); // no redirect
    page.$.mockResolvedValue({}); // password field found!

    const pages = [{ id: 'admin', path: '/admin' }];
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const result = await probeRoutes(pages, config, browser);
    expect(result).toEqual({ admin: 'auth_required' });
  });

  test('falls back to public on navigation error', async () => {
    const { browser, page } = makeProbeContext({});
    page.goto.mockRejectedValue(new Error('timeout'));

    const pages = [{ id: 'broken', path: '/broken' }];
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const result = await probeRoutes(pages, config, browser);
    expect(result).toEqual({ broken: 'public' });
  });

  test('closes context after probing', async () => {
    const { browser, context, page } = makeProbeContext({});
    page.goto.mockResolvedValue(undefined);
    page.url.mockReturnValue('http://localhost:3000/home');
    page.$.mockResolvedValue(null);

    const pages = [{ id: 'home', path: '/home' }];
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    await probeRoutes(pages, config, browser);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// authenticate (refactored: takes BrowserContext, not page)
// ---------------------------------------------------------------------------

describe('authenticate', () => {
  function makeAuthContext(finalUrlAfterLogin) {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      $: jest.fn().mockResolvedValue({}), // password field present
      evaluate: jest.fn()
        .mockResolvedValueOnce('#password')
        .mockResolvedValueOnce('#email')
        .mockResolvedValueOnce('button[type=submit]'),
    };
    return {
      context: { newPage: jest.fn(async () => page) },
      page,
    };
  }

  test('fills form with provided selectors and submits', async () => {
    const { context, page } = makeAuthContext();
    const roleConfig = {
      role: 'admin',
      login_url: '/admin/login',
      username: 'admin@test.com',
      password: 'secret',
      username_field: '#email',
      password_field: '#password',
      submit_button: 'button[type=submit]',
    };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    await authenticate(context, roleConfig, config);

    expect(page.goto).toHaveBeenCalledWith(
      'http://localhost:3000/admin/login',
      expect.any(Object)
    );
    expect(page.fill).toHaveBeenCalledWith('#email', 'admin@test.com');
    expect(page.fill).toHaveBeenCalledWith('#password', 'secret');
    expect(page.click).toHaveBeenCalledWith('button[type=submit]');
    expect(page.close).toHaveBeenCalled();
  });

  test('auto-detects form fields when selectors are null', async () => {
    const { context, page } = makeAuthContext();
    const roleConfig = {
      role: 'user',
      login_url: '/login',
      username: 'user@test.com',
      password: 'pass',
      username_field: null,
      password_field: null,
      submit_button: null,
    };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    await authenticate(context, roleConfig, config);

    // auto-detected selectors from mock evaluate calls: #password, #email, button[type=submit]
    expect(page.fill).toHaveBeenCalledWith('#email', 'user@test.com');
    expect(page.fill).toHaveBeenCalledWith('#password', 'pass');
  });

  test('throws when no login form found', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      $: jest.fn().mockResolvedValue(null), // no password field
      evaluate: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const context = { newPage: jest.fn(async () => page) };
    const roleConfig = {
      role: 'admin',
      login_url: '/login',
      username: 'a',
      password: 'b',
      username_field: null,
      password_field: null,
      submit_button: null,
    };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    await expect(authenticate(context, roleConfig, config)).rejects.toThrow('No login form found');
  });
});

// ---------------------------------------------------------------------------
// captureRoleScreenshots
// ---------------------------------------------------------------------------

describe('captureRoleScreenshots', () => {
  function makeBrowser() {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      $: jest.fn().mockResolvedValue(null),
      evaluate: jest.fn(),
      fill: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      setDefaultTimeout: jest.fn(),
    };
    const context = {
      newPage: jest.fn(async () => page),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newContext: jest.fn(async () => context),
    };
    return { browser, context, page };
  }

  test('guest role skips auth_required routes', async () => {
    const { browser, page } = makeBrowser();
    const roleConfig = { role: 'guest', credentials: null };
    const pages = [
      { id: 'home', path: '/', name: 'home' },
      { id: 'dashboard', path: '/dashboard', name: 'dashboard' },
    ];
    const accessMap = { home: 'public', dashboard: 'auth_required' };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const { results } = await captureRoleScreenshots(
      roleConfig, pages, accessMap, config, browser, '/tmp/screenshots'
    );

    // Only 'home' captured; 'dashboard' skipped for guest
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('home');
  });

  test('authenticated role captures both public and auth_required routes', async () => {
    const { browser, page } = makeBrowser();
    page.$.mockResolvedValue({}); // password field exists for auth
    page.evaluate
      .mockResolvedValueOnce('#password')
      .mockResolvedValueOnce('#email')
      .mockResolvedValueOnce('button[type=submit]');

    const roleConfig = {
      role: 'admin',
      login_url: '/login',
      username: 'admin',
      password: 'pass',
      username_field: '#email',
      password_field: '#password',
      submit_button: 'button[type=submit]',
    };
    const pages = [
      { id: 'home', path: '/', name: 'home' },
      { id: 'dashboard', path: '/dashboard', name: 'dashboard' },
    ];
    const accessMap = { home: 'public', dashboard: 'auth_required' };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    const { results } = await captureRoleScreenshots(
      roleConfig, pages, accessMap, config, browser, '/tmp/screenshots'
    );

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['home', 'dashboard']);
  });

  test('closes context after session even if errors occur', async () => {
    const { browser, context, page } = makeBrowser();
    page.goto.mockRejectedValue(new Error('network error'));

    const roleConfig = { role: 'guest', credentials: null };
    const pages = [{ id: 'home', path: '/', name: 'home' }];
    const accessMap = { home: 'public' };
    const config = { baseUrl: 'http://localhost:3000', timeout: 5000 };

    await captureRoleScreenshots(
      roleConfig, pages, accessMap, config, browser, '/tmp/screenshots'
    );

    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
