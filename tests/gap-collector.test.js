'use strict';

const { collectGaps } = require('../skills/gostdocs/scripts/lib/gap-collector');

describe('collectGaps', () => {
  test('reports app.url gap when missing', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: '', launch: 'url' },
      auth: { roles: [] }, pages: [],
    }, {});
    const fields = gaps.map((g) => g.field);
    expect(fields).toContain('app.url');
    const appUrlGap = gaps.find((g) => g.field === 'app.url');
    expect(appUrlGap.importance).toBe('critical');
    expect(appUrlGap.question).toMatch(/URL|адрес/i);
  });

  test('proposes default for app.url from introspect.derived.port', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: '', launch: 'url' },
      auth: { roles: [] }, pages: [],
    }, { introspect: { derived: { port: '5173' } } });
    const appUrlGap = gaps.find((g) => g.field === 'app.url');
    expect(appUrlGap.default).toBe('http://localhost:5173');
    expect(appUrlGap.default_source).toMatch(/.env|introspect/i);
  });

  test('reports per-role credential gaps for non-guest roles', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: 'http://localhost:5173', launch: 'url' },
      auth: { method: 'api', roles: [
        { role: 'guest', credentials: null },
        { role: 'admin' },
        { role: 'user', username: 'u@example.com' }, // password still missing
      ] },
      pages: [{ id: 'home', path: '/' }],
    }, {});
    const fields = gaps.map((g) => g.field);
    expect(fields).toContain('auth.roles[admin].username');
    expect(fields).toContain('auth.roles[admin].password');
    expect(fields).toContain('auth.roles[user].password');
    expect(fields).not.toContain('auth.roles[user].username'); // already set
    expect(fields).not.toContain('auth.roles[guest].password'); // guest is exempt
    // password gaps are flagged as secret
    const userPwd = gaps.find((g) => g.field === 'auth.roles[user].password');
    expect(userPwd.secret).toBe(true);
  });

  test('reports gap when no pages discovered', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: 'http://localhost:5173', launch: 'url' },
      auth: { roles: [] }, pages: [],
    }, {});
    const pagesGap = gaps.find((g) => g.field === 'pages');
    expect(pagesGap).toBeDefined();
    expect(pagesGap.importance).toBe('critical');
  });

  test('reports metadata.system_name gap with package.json default', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: 'http://localhost:5173', launch: 'url' },
      auth: { roles: [] }, pages: [{ id: 'home', path: '/' }],
      metadata: {},
    }, { packageName: 'my-cool-app' });
    const sn = gaps.find((g) => g.field === 'metadata.system_name');
    expect(sn).toBeDefined();
    expect(sn.default).toBe('my-cool-app');
  });

  test('does NOT flag fields the user already filled', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: 'http://localhost:5173', launch: 'url' },
      auth: { roles: [{ role: 'admin', username: 'a', password: 'b' }] },
      pages: [{ id: 'home', path: '/' }],
      metadata: { system_name: 'X', organization: 'Y', doc_code: 'Z', version: '1.0', repo_url: '—' },
    }, {});
    expect(gaps).toEqual([]);
  });

  test('reports introspect-uncertain repo_url as optional gap', () => {
    const gaps = collectGaps({
      project_path: '/p', doc_types: ['user-guide'], gost_mode: 'strict',
      app: { url: 'http://localhost:5173', launch: 'url' },
      auth: { roles: [] }, pages: [{ id: 'home', path: '/' }],
      metadata: { system_name: 'X' },
    }, { introspect: { derived: {} } /* no repo_url derived */ });
    const repo = gaps.find((g) => g.field === 'metadata.repo_url');
    expect(repo).toBeDefined();
    expect(repo.importance).toBe('optional');
  });

  test('groups gaps into AskUserQuestion-friendly batches of <= 4', () => {
    const { batchGaps } = require('../skills/gostdocs/scripts/lib/gap-collector');
    const gaps = [
      { field: 'a', question: 'q1', importance: 'critical' },
      { field: 'b', question: 'q2', importance: 'critical' },
      { field: 'c', question: 'q3', importance: 'critical' },
      { field: 'd', question: 'q4', importance: 'critical' },
      { field: 'e', question: 'q5', importance: 'high' },
      { field: 'f', question: 'q6', importance: 'optional' },
    ];
    const batches = batchGaps(gaps);
    // Critical first (one batch of 4), then high+optional (one batch of 2)
    expect(batches[0].length).toBe(4);
    expect(batches[0].map((g) => g.field).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(batches[1].length).toBe(2);
  });
});
