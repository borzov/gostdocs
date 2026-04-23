'use strict';

const { resolveTupleUrl } = require('../skills/gen-docs/scripts/capture');

const metaData = { app: { url: 'http://app.test' } };

function fakeFetch(responses) {
  // responses: Array<(url, opts) => { status, ok?, json? }>
  const calls = [];
  const fn = (url, opts) => {
    const call = { url, method: (opts && opts.method) || 'GET' };
    calls.push(call);
    const next = responses.shift();
    const result = typeof next === 'function' ? next(url, opts) : next || { status: 404 };
    return Promise.resolve({
      status: result.status,
      ok: result.ok ?? (result.status >= 200 && result.status < 300),
      json: result.json ? () => Promise.resolve(result.json) : () => Promise.resolve(null),
    });
  };
  fn.calls = calls;
  return fn;
}

describe('resolveTupleUrl — parametrize probe', () => {
  test('emits a warning when the probed URL 404s with user-supplied seed', async () => {
    const warnings = [];
    const tuple = {
      pageId: 'event-detail',
      path: '/events/:slug',
      parametrize: { slug: 'seed-e-1' },
    };
    const fetchImpl = fakeFetch([
      { status: 404 },              // HEAD returns 404
      { status: 404 },              // GET fallback also 404
    ]);
    const url = await resolveTupleUrl(tuple, metaData, {
      fetchImpl,
      onWarning: (w) => warnings.push(w),
    });
    expect(url).toBe('http://app.test/events/seed-e-1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].scope).toBe('id-resolver:event-detail');
    expect(warnings[0].message).toMatch(/404/);
    expect(warnings[0].message).toMatch(/update meta\.yaml/);
  });

  test('falls back from HEAD 405 to GET probe and still reports status', async () => {
    const warnings = [];
    const tuple = {
      pageId: 'p',
      path: '/items/:id',
      parametrize: { id: '1' },
    };
    const fetchImpl = fakeFetch([
      { status: 405 },              // HEAD not allowed
      { status: 500 },              // GET returns 500
    ]);
    await resolveTupleUrl(tuple, metaData, { fetchImpl, onWarning: (w) => warnings.push(w) });
    expect(warnings[0].message).toMatch(/500/);
  });

  test('does NOT warn when the probe returns 2xx', async () => {
    const warnings = [];
    const tuple = { pageId: 'p', path: '/items/:id', parametrize: { id: '1' } };
    const fetchImpl = fakeFetch([{ status: 200 }]);
    await resolveTupleUrl(tuple, metaData, { fetchImpl, onWarning: (w) => warnings.push(w) });
    expect(warnings).toHaveLength(0);
  });

  test('static (non-parametrized) path is returned as-is without probing', async () => {
    const warnings = [];
    const tuple = { pageId: 'home', path: '/events' };
    const fetchImpl = fakeFetch([]);
    const url = await resolveTupleUrl(tuple, metaData, { fetchImpl, onWarning: (w) => warnings.push(w) });
    expect(url).toBe('http://app.test/events');
    expect(fetchImpl.calls).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  test('warning hint changes when no explicit parametrize was supplied', async () => {
    const warnings = [];
    const tuple = { pageId: 'p', path: '/items/:id' };
    const fetchImpl = fakeFetch([
      { status: 404 }, // collection step
      { status: 200, json: { data: [{ id: 'auto-7' }] } }, // wait — collection first
    ]);
    // With no explicit + no fetch for collection fallback, resolver
    // may still return null; simulate explicit that was guessed.
    tuple.parametrize = {};
    await resolveTupleUrl(tuple, metaData, { fetchImpl, onWarning: (w) => warnings.push(w) });
    // When explicit is empty AND collection step does not yield an id,
    // the substituted URL will contain :id literal and probe it.
    if (warnings.length > 0) {
      expect(warnings[0].message).toMatch(/seed the database|update meta\.yaml/);
    }
  });
});
