const schema = require('../skills/gostdocs/scripts/lib/inspection-schema');

describe('empty + validate', () => {
  test('empty record validates', () => {
    const e = schema.empty('admin/desktop/home.png', 'admin', 'desktop');
    expect(schema.validate(e).role).toBe('admin');
  });

  test('rejects missing role', () => {
    expect(() => schema.validate({ version: '1.0', file: 'x', viewport: 'desktop' })).toThrow();
  });

  test('rejects unknown top-level keys', () => {
    const e = schema.empty('x.png', 'r', 'desktop');
    expect(() => schema.validate({ ...e, foo: 'bar' })).toThrow();
  });

  test('accepts populated record', () => {
    const e = schema.empty('x.png', 'r', 'desktop');
    e.title = 'Dashboard';
    e.breadcrumb = ['Home', 'Dashboard'];
    e.top_buttons = [{ label: 'Create', location: 'top-bar', icon_only: false }];
    e.filters = [{ label: 'Status', control: 'select', options: ['All', 'Active'] }];
    e.table = {
      columns: [{ header: 'Name', example: 'Alice' }],
      row_actions: ['Edit'], bulk_actions: [], has_pagination: true,
    };
    e.is_login_form = false;
    const v = schema.validate(e);
    expect(v.title).toBe('Dashboard');
    expect(v.table.has_pagination).toBe(true);
  });
});

describe('extractJson', () => {
  test('parses fenced json block', () => {
    const raw = 'Here is the data:\n```json\n{"title":"x"}\n```';
    expect(schema.extractJson(raw)).toEqual({ title: 'x' });
  });

  test('parses fenced plain block', () => {
    expect(schema.extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('parses bare JSON with surrounding prose', () => {
    expect(schema.extractJson('some prose { "a": 2 } trailing')).toEqual({ a: 2 });
  });

  test('returns null for non-JSON', () => {
    expect(schema.extractJson('just text')).toBeNull();
    expect(schema.extractJson('')).toBeNull();
    expect(schema.extractJson(null)).toBeNull();
  });
});
