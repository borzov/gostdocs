// Mock playwright before requiring the module
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

const {
  autoDetectFormFields,
  probeRoutes,
} = require('../skills/gen-docs/scripts/screenshot');

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
    // Override evaluate to simulate no password field
    page.evaluate.mockImplementation(async (fn) => {
      const fakeDoc = { querySelector: () => null, querySelectorAll: () => [] };
      return fn.toString().includes('password') ? null : null;
    });

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
  function makeProbeContext(pageResponses) {
    // pageResponses: { [url]: { finalUrl, hasPasswordField } }
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
