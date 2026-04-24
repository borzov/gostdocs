const routes = require('../skills/gostdocs/scripts/lib/routes');

describe('parseRoute', () => {
  test('extracts :param (colon syntax)', () => {
    const r = routes.parseRoute('/users/:id/edit');
    expect(r.params).toEqual([{ name: 'id', type: null, required: true, syntax: 'colon' }]);
  });

  test('marks :param? as optional', () => {
    const r = routes.parseRoute('/users/:id?');
    expect(r.params[0].required).toBe(false);
  });

  test('extracts [param] (Next.js)', () => {
    const r = routes.parseRoute('/users/[id]');
    expect(r.params).toEqual([{ name: 'id', type: null, required: true, syntax: 'bracket' }]);
  });

  test('extracts [...param] (Next.js catch-all)', () => {
    const r = routes.parseRoute('/docs/[...slug]');
    expect(r.params[0].name).toBe('slug');
  });

  test('extracts <type:name> (Django)', () => {
    const r = routes.parseRoute('/users/<int:id>/');
    expect(r.params).toEqual([{ name: 'id', type: 'int', required: true, syntax: 'angle' }]);
  });

  test('extracts <name> (Django short)', () => {
    const r = routes.parseRoute('/users/<id>/');
    expect(r.params[0]).toMatchObject({ name: 'id', type: null });
  });

  test('multiple params deduplicate by name', () => {
    const r = routes.parseRoute('/projects/:id/tasks/:id');
    expect(r.params).toHaveLength(1);
  });

  test('zero params returns empty array', () => {
    expect(routes.parseRoute('/home').params).toEqual([]);
  });

  test('throws on empty template', () => {
    expect(() => routes.parseRoute('')).toThrow();
  });
});

describe('isParametrized', () => {
  test('true for routes with params', () => {
    expect(routes.isParametrized('/users/:id')).toBe(true);
    expect(routes.isParametrized('/users/[id]')).toBe(true);
    expect(routes.isParametrized('/users/<id>/')).toBe(true);
  });

  test('false for static routes', () => {
    expect(routes.isParametrized('/about')).toBe(false);
  });
});

describe('substitute', () => {
  test('replaces :param', () => {
    expect(routes.substitute('/users/:id/edit', { id: 42 })).toBe('/users/42/edit');
  });

  test('replaces [param]', () => {
    expect(routes.substitute('/users/[id]', { id: 'abc' })).toBe('/users/abc');
  });

  test('replaces <int:id>', () => {
    expect(routes.substitute('/users/<int:id>/', { id: 7 })).toBe('/users/7/');
  });

  test('encodes special characters', () => {
    expect(routes.substitute('/files/:name', { name: 'a b/c' })).toContain('a%20b');
  });

  test('optional :param? absent yields empty', () => {
    expect(routes.substitute('/items/:id?', {})).toBe('/items/');
  });

  test('throws on missing required param', () => {
    expect(() => routes.substitute('/users/:id', {})).toThrow(/missing values/);
  });

  test('allowMissing leaves placeholder in place', () => {
    expect(routes.substitute('/users/:id', {}, { allowMissing: true })).toBe('/users/:id');
  });

  test('catch-all accepts array', () => {
    expect(routes.substitute('/docs/[...slug]', { slug: ['a', 'b'] })).toBe('/docs/a/b');
  });
});

describe('inferCollectionPath', () => {
  test('returns collection prefix before first param segment', () => {
    expect(routes.inferCollectionPath('/users/:id/edit')).toBe('/users');
    expect(routes.inferCollectionPath('/api/v1/users/[id]')).toBe('/api/v1/users');
    expect(routes.inferCollectionPath('/projects/<int:id>/')).toBe('/projects');
  });

  test('returns null for static routes', () => {
    expect(routes.inferCollectionPath('/home')).toBeNull();
  });
});
