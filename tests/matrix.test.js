const { buildMatrix, axisOrNull, buildTupleId } = require('../skills/gen-docs/scripts/lib/matrix');

const baseMeta = {
  auth: {
    method: 'none',
    storage: 'auto',
    dismiss_selectors: [],
    roles: [{ role: 'guest', credentials: null }],
  },
  capture: {
    viewports: [{ name: 'desktop', width: 1280, height: 800 }],
    themes: [],
    locales: [],
    wait_after_navigation: 2000,
    timeout: 30000,
  },
  states: [],
};

describe('axisOrNull', () => {
  test('returns [null] for empty', () => {
    expect(axisOrNull([])).toEqual([null]);
    expect(axisOrNull(undefined)).toEqual([null]);
  });

  test('returns axis when non-empty', () => {
    expect(axisOrNull(['a'])).toEqual(['a']);
  });
});

describe('buildMatrix — single role', () => {
  test('one page x one viewport = one tuple', () => {
    const { plan, skipped } = buildMatrix({
      pages: [{ id: 'home', path: '/' }],
      meta: baseMeta,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].role).toBe('guest');
    expect(plan[0].file).toBe('guest/desktop/home.png');
    expect(skipped).toEqual([]);
  });

  test('multiplies by viewports and themes', () => {
    const meta = { ...baseMeta, capture: { ...baseMeta.capture,
      viewports: [
        { name: 'desktop', width: 1280, height: 800 },
        { name: 'mobile', width: 390, height: 844 },
      ],
      themes: ['light', 'dark'],
    }};
    const { plan } = buildMatrix({
      pages: [{ id: 'home', path: '/' }],
      meta,
    });
    // 2 viewports x 2 themes
    expect(plan).toHaveLength(4);
  });
});

describe('buildMatrix — auth_required skip', () => {
  test('guest role skips auth-required pages', () => {
    const { plan, skipped } = buildMatrix({
      pages: [
        { id: 'home', path: '/' },
        { id: 'admin', path: '/admin' },
      ],
      meta: baseMeta,
      accessMap: { home: 'public', admin: 'auth_required' },
    });
    const ids = plan.map((p) => p.pageId);
    expect(ids).toContain('home');
    expect(ids).not.toContain('admin');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/auth_required/);
  });

  test('non-guest role keeps auth-required pages', () => {
    const meta = {
      ...baseMeta,
      auth: {
        ...baseMeta.auth,
        method: 'api',
        roles: [
          { role: 'guest', credentials: null },
          { role: 'admin', api_endpoint: '/api/login', username: 'a', password: 'b' },
        ],
      },
    };
    const { plan } = buildMatrix({
      pages: [{ id: 'admin', path: '/admin' }],
      meta,
      accessMap: { admin: 'auth_required' },
    });
    const roles = plan.map((p) => p.role);
    expect(roles).toContain('admin');
    expect(roles).not.toContain('guest');
  });
});

describe('buildMatrix — states', () => {
  test('applies states only when page opts in', () => {
    const meta = { ...baseMeta, states: ['empty', 'error'] };
    const { plan } = buildMatrix({
      pages: [
        { id: 'static', path: '/' },
        { id: 'list', path: '/items', apply_states: true },
      ],
      meta,
    });
    const statesForList = plan.filter((p) => p.pageId === 'list').map((p) => p.state);
    expect(statesForList).toEqual(expect.arrayContaining(['empty', 'error']));
    const statesForStatic = plan.filter((p) => p.pageId === 'static').map((p) => p.state);
    expect(statesForStatic).toEqual([null]);
  });
});

describe('buildMatrix — component shots + dedupe', () => {
  test('componentShots merge and dedupe by filename', () => {
    const { plan } = buildMatrix({
      pages: [{ id: 'builder__empty', path: '/builder', component_kind: 'builder' }],
      componentShots: [
        { id: 'builder__empty', path: '/builder', component_kind: 'builder', state: 'empty', title: 'Builder empty' },
      ],
      meta: baseMeta,
    });
    // same filename deduped -> exactly one tuple
    const files = plan.map((p) => p.file);
    const deduped = new Set(files);
    expect(files.length).toBe(deduped.size);
  });
});

describe('buildMatrix — journeys', () => {
  test('emits tuples only for screenshot-marked steps', () => {
    const { plan } = buildMatrix({
      pages: [],
      meta: {
        ...baseMeta,
        auth: { ...baseMeta.auth, method: 'api', roles: [
          { role: 'user', api_endpoint: '/api/login', username: 'u', password: 'p' },
        ]},
      },
      journeys: {
        journeys: [{
          name: 'create-order',
          role: 'user',
          steps: [
            { id: 'start', index: 1, goto: '/orders/new', screenshot: true },
            { id: 'fill',  index: 2, fill: { '#qty': '3' }, screenshot: false },
            { id: 'done',  index: 3, click: 'button[type=submit]', screenshot: true },
          ],
        }],
      },
    });
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.kind === 'journey')).toBe(true);
    expect(plan[0].journey.name).toBe('create-order');
  });
});

describe('buildMatrix — access_role filter', () => {
  const threeRoles = {
    ...baseMeta,
    auth: {
      ...baseMeta.auth,
      method: 'api',
      roles: [
        { role: 'guest', credentials: null },
        { role: 'user',  api_endpoint: '/api/login', username: 'u', password: 'p' },
        { role: 'admin', api_endpoint: '/api/login', username: 'a', password: 'b' },
      ],
    },
  };

  test('access_role: guest → only the guest role gets a tuple', () => {
    const { plan } = buildMatrix({
      pages: [{ id: 'home', path: '/', access_role: 'guest' }],
      meta: threeRoles,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].role).toBe('guest');
  });

  test('access_role: admin → only the admin role gets a tuple', () => {
    const { plan } = buildMatrix({
      pages: [{ id: 'admin-dash', path: '/admin', access_role: 'admin' }],
      meta: threeRoles,
    });
    expect(plan.map((t) => t.role)).toEqual(['admin']);
  });

  test('access_role: guest-only is treated as guest-only access (login/register/etc.)', () => {
    const { plan } = buildMatrix({
      pages: [{ id: 'login', path: '/login', access_role: 'guest-only' }],
      meta: threeRoles,
    });
    expect(plan.map((t) => t.role)).toEqual(['guest']);
  });

  test('omitting access_role keeps the legacy cross-product behaviour', () => {
    const { plan } = buildMatrix({
      pages: [{ id: 'mixed', path: '/whatever' }],
      meta: threeRoles,
    });
    expect(plan.map((t) => t.role).sort()).toEqual(['admin', 'guest', 'user']);
  });

  test('access_role mismatches are recorded in `skipped`', () => {
    const { skipped } = buildMatrix({
      pages: [{ id: 'profile', path: '/profile', access_role: 'user' }],
      meta: threeRoles,
    });
    const reasons = skipped.map((s) => s.reason);
    expect(reasons.some((r) => /access_role/.test(r))).toBe(true);
  });
});

describe('buildMatrix — query_params and interactions pass through', () => {
  test('page.query_params attaches to each tuple verbatim', () => {
    const { plan } = buildMatrix({
      pages: [{
        id: 'events-online',
        path: '/events',
        access_role: 'guest',
        query_params: { format: 'online', sort: '-starts_at' },
      }],
      meta: baseMeta,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].query_params).toEqual({ format: 'online', sort: '-starts_at' });
  });

  test('page.interactions attaches to each tuple verbatim', () => {
    const { plan } = buildMatrix({
      pages: [{
        id: 'faq-open',
        path: '/faq',
        access_role: 'guest',
        interactions: [
          { action: 'click', selector: '[data-faq-toggle="0"]' },
          { action: 'fill',  selector: 'input[name=q]', value: 'регистрация' },
        ],
      }],
      meta: baseMeta,
    });
    expect(plan[0].interactions).toEqual([
      { action: 'click', selector: '[data-faq-toggle="0"]' },
      { action: 'fill',  selector: 'input[name=q]', value: 'регистрация' },
    ]);
  });
});

describe('buildTupleId', () => {
  test('encodes all axes stably', () => {
    const a = buildTupleId({ role: 'admin', pageId: 'home', viewport: 'desktop',
      theme: 'light', locale: 'ru', state: null, action: null, journey: null });
    const b = buildTupleId({ role: 'admin', pageId: 'home', viewport: 'desktop',
      theme: 'light', locale: 'ru', state: null, action: null, journey: null });
    expect(a).toBe(b);
    expect(a).toContain('admin');
    expect(a).toContain('home');
    expect(a).toContain('t-light');
  });
});
