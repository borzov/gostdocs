const form = require('../skills/gostdocs/scripts/adapters/auth/form');

function makeDetectPage(shape) {
  return {
    $: jest.fn(async (selector) => (shape.$?.[selector] ?? null)),
    evaluate: jest.fn(async (fn) => {
      // Walk a tiny "DOM" description to emulate query results.
      const document = shape.document || {};
      const window = { document };
      return fn({ document, window });
    }),
  };
}

describe('autoDetectFormFields', () => {
  test('returns null when no password input exists', async () => {
    const page = makeDetectPage({});
    expect(await form.autoDetectFormFields(page)).toBeNull();
  });

  test('returns selectors when password input exists', async () => {
    // Mock evaluate to return three successive answers used internally.
    const page = {
      $: jest.fn(async () => ({})),
      evaluate: jest.fn()
        .mockResolvedValueOnce('#password')
        .mockResolvedValueOnce('#email')
        .mockResolvedValueOnce('button[type=submit]'),
    };
    expect(await form.autoDetectFormFields(page)).toEqual({
      passwordSelector: '#password',
      usernameSelector: '#email',
      submitSelector: 'button[type=submit]',
    });
  });
});

describe('authenticateViaForm', () => {
  const META = { app: { url: 'http://localhost:3000' }, capture: { timeout: 1000 } };

  function makeContext() {
    const page = {
      goto: jest.fn(async () => {}),
      $: jest.fn(async () => ({})),
      evaluate: jest.fn()
        .mockResolvedValueOnce('#password')
        .mockResolvedValueOnce('#email')
        .mockResolvedValueOnce('button[type=submit]'),
      fill: jest.fn(async () => {}),
      click: jest.fn(async () => {}),
      waitForLoadState: jest.fn(async () => {}),
      url: jest.fn(() => 'http://localhost:3000/dashboard'),
      close: jest.fn(async () => {}),
    };
    return { newPage: jest.fn(async () => page), _page: page };
  }

  test('happy path returns ok and final url', async () => {
    const ctx = makeContext();
    const role = { role: 'admin', login_url: '/login', username: 'u', password: 'p' };
    const result = await form.authenticateViaForm(ctx, role, META);
    expect(result.ok).toBe(true);
    expect(result.finalUrl).toBe('http://localhost:3000/dashboard');
    expect(result.warning).toMatch(/form-login is less reliable/i);
  });

  test('returns !ok when no form detected', async () => {
    const ctx = {
      newPage: jest.fn(async () => ({
        goto: jest.fn(async () => {}),
        $: jest.fn(async () => null),
        url: jest.fn(() => 'http://localhost:3000/login'),
        close: jest.fn(async () => {}),
      })),
    };
    const role = { role: 'admin', login_url: '/login', username: 'u', password: 'p' };
    const result = await form.authenticateViaForm(ctx, role, META);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No login form/);
  });

  test('returns !ok when goto throws', async () => {
    const ctx = {
      newPage: jest.fn(async () => ({
        goto: jest.fn(async () => { throw new Error('net fail'); }),
        close: jest.fn(async () => {}),
      })),
    };
    const result = await form.authenticateViaForm(ctx, { role: 'x' }, META);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/net fail/);
  });
});
