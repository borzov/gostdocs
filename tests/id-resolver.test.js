const id = require('../skills/gen-docs/scripts/adapters/id-resolver');

describe('planResolution', () => {
  test('static route produces no steps and no missing params', () => {
    const plan = id.planResolution({ id: 'home', path: '/' });
    expect(plan.missingParams).toEqual([]);
    expect(plan.steps).toEqual([]);
  });

  test('explicit parametrize wins with a single step', () => {
    const plan = id.planResolution({
      id: 'edit', path: '/users/:id/edit', parametrize: { id: 42 },
    });
    expect(plan.missingParams).toEqual([]);
    expect(plan.steps).toEqual([{ kind: 'explicit', values: { id: 42 } }]);
  });

  test('missing param emits collection + list_scrape fallback chain', () => {
    const plan = id.planResolution({ id: 'edit', path: '/users/:id/edit' });
    expect(plan.missingParams).toEqual(['id']);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toContain('collection');
    expect(kinds).toContain('list_scrape');
    const collection = plan.steps.find((s) => s.kind === 'collection');
    expect(collection.endpoint).toBe('/users?limit=1');
  });

  test('explicit list_endpoint overrides inferred collection', () => {
    const plan = id.planResolution({
      id: 'edit', path: '/users/:id/edit', list_endpoint: '/api/admins',
    });
    const collection = plan.steps.find((s) => s.kind === 'collection');
    expect(collection.endpoint).toBe('/api/admins?limit=1');
  });

  test('throws for missing path', () => {
    expect(() => id.planResolution({})).toThrow();
  });
});

describe('readPath', () => {
  test('reads nested string', () => {
    expect(id.readPath({ a: { b: 'x' } }, 'a.b')).toBe('x');
  });

  test('reads numeric array index', () => {
    expect(id.readPath({ data: [{ id: 1 }] }, 'data.0.id')).toBe(1);
  });

  test('returns undefined for missing segment', () => {
    expect(id.readPath({}, 'a.b')).toBeUndefined();
  });

  test('safe on null', () => {
    expect(id.readPath(null, 'x')).toBeUndefined();
  });
});

describe('extractIdFromBody', () => {
  test('explicit idPath wins', () => {
    expect(id.extractIdFromBody({ foo: { bar: 7 } }, 'foo.bar')).toBe(7);
  });

  test('reads first row of data[]', () => {
    expect(id.extractIdFromBody({ data: [{ id: 42 }] })).toBe(42);
  });

  test('reads first row of results[]', () => {
    expect(id.extractIdFromBody({ results: [{ uuid: 'abc' }] })).toBe('abc');
  });

  test('reads first row of top-level array', () => {
    expect(id.extractIdFromBody([{ slug: 'hello' }])).toBe('hello');
  });

  test('prefers id over uuid', () => {
    expect(id.extractIdFromBody({ data: [{ id: 1, uuid: 'u' }] })).toBe(1);
  });

  test('returns null on empty body', () => {
    expect(id.extractIdFromBody({})).toBeNull();
    expect(id.extractIdFromBody({ data: [] })).toBeNull();
  });
});
