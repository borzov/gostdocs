const { scrapeId, looksLikeId, idFromHref } = require('../skills/gostdocs/scripts/lib/list-scrape');

describe('looksLikeId', () => {
  test('accepts numeric ids', () => {
    expect(looksLikeId('123')).toBe(true);
  });

  test('accepts uuid-like', () => {
    expect(looksLikeId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('accepts slug-like', () => {
    expect(looksLikeId('my-item-42')).toBe(true);
  });

  test('rejects empty or too short', () => {
    expect(looksLikeId('')).toBe(false);
    expect(looksLikeId('a')).toBe(false);
  });
});

describe('idFromHref', () => {
  test('plucks last segment of absolute url', () => {
    expect(idFromHref('http://host/users/42')).toBe('42');
  });

  test('plucks last segment of relative path', () => {
    expect(idFromHref('/projects/hello-world')).toBe('hello-world');
  });

  test('returns null for trailing slash on root', () => {
    expect(idFromHref('/')).toBeNull();
  });
});

describe('scrapeId', () => {
  function mockPage(candidates) {
    return {
      evaluate: jest.fn(async () => candidates),
    };
  }

  test('returns first attrId match', async () => {
    const page = mockPage([
      { attrId: '42', elementId: null, href: null },
      { attrId: '7', elementId: null, href: null },
    ]);
    expect(await scrapeId(page)).toBe('42');
  });

  test('falls back to elementId', async () => {
    const page = mockPage([
      { attrId: null, elementId: 'abc-123', href: null },
    ]);
    expect(await scrapeId(page)).toBe('abc-123');
  });

  test('falls back to href segment', async () => {
    const page = mockPage([
      { attrId: null, elementId: null, href: '/items/99' },
    ]);
    expect(await scrapeId(page)).toBe('99');
  });

  test('returns null when no candidates', async () => {
    const page = mockPage([]);
    expect(await scrapeId(page)).toBeNull();
  });

  test('passes selector/attribute via evaluate args', async () => {
    const page = mockPage([]);
    await scrapeId(page, { rowSelector: 'tr.row', idAttribute: 'data-pk' });
    const args = page.evaluate.mock.calls[0][1];
    expect(args.rowSelector).toBe('tr.row');
    expect(args.idAttribute).toBe('data-pk');
  });
});
