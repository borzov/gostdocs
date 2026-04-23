const mermaid = require('../skills/gen-docs/scripts/adapters/mermaid');

describe('isAvailable', () => {
  beforeEach(() => mermaid.resetAvailabilityCache());

  test('true when mmdc --version exits 0', async () => {
    const runSub = jest.fn(async () => ({ stdout: '10.0.0', stderr: '', code: 0 }));
    expect(await mermaid.isAvailable('mmdc', { runSub })).toBe(true);
    expect(runSub).toHaveBeenCalledWith('mmdc', ['--version'], expect.any(Object));
  });

  test('false when runSub returns error', async () => {
    const runSub = jest.fn(async () => ({ stdout: '', stderr: '', code: -1, error: new Error('ENOENT') }));
    expect(await mermaid.isAvailable('mmdc', { runSub })).toBe(false);
  });

  test('caches across calls', async () => {
    const runSub = jest.fn(async () => ({ stdout: 'x', stderr: '', code: 0 }));
    await mermaid.isAvailable('mmdc', { runSub });
    await mermaid.isAvailable('mmdc', { runSub });
    expect(runSub).toHaveBeenCalledTimes(1);
  });
});

describe('renderMermaid', () => {
  beforeEach(() => mermaid.resetAvailabilityCache());

  test('empty source returns error', async () => {
    const result = await mermaid.renderMermaid('', '/tmp/x.svg');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/);
  });

  test('falls back to warning when mmdc missing', async () => {
    const runSub = jest.fn(async () => ({ stdout: '', stderr: '', code: -1, error: new Error('missing') }));
    const writeFile = jest.fn();
    const result = await mermaid.renderMermaid('graph TD; A-->B;', '/tmp/x.svg', { runSub, writeFile });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/not installed/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('happy path writes source and calls mmdc', async () => {
    // First call (isAvailable) returns OK; second call (render) also OK.
    let calls = 0;
    const runSub = jest.fn(async () => {
      calls += 1;
      return { stdout: '', stderr: '', code: 0 };
    });
    const writeFile = jest.fn();
    const result = await mermaid.renderMermaid('graph TD; A-->B;', '/tmp/x.svg', { runSub, writeFile });
    expect(result.ok).toBe(true);
    expect(result.path).toBe('/tmp/x.svg');
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0]).toBe('/tmp/x.svg.mmd');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('mmdc exit != 0 surfaces error', async () => {
    let first = true;
    const runSub = jest.fn(async () => {
      if (first) { first = false; return { stdout: '', stderr: '', code: 0 }; }
      return { stdout: '', stderr: 'bad diagram', code: 1 };
    });
    const writeFile = jest.fn();
    const result = await mermaid.renderMermaid('bad', '/tmp/x.svg', { runSub, writeFile });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bad diagram/);
  });
});

describe('renderToDocModelElement', () => {
  beforeEach(() => mermaid.resetAvailabilityCache());

  test('success yields figure element', async () => {
    let calls = 0;
    const runSub = jest.fn(async () => { calls += 1; return { stdout: '', stderr: '', code: 0 }; });
    const writeFile = jest.fn();
    const out = await mermaid.renderToDocModelElement(
      { source: 'graph TD; A-->B;', caption: 'Flow', outPath: '/tmp/flow.svg' },
      { runSub, writeFile },
    );
    expect(out.element.type).toBe('figure');
    expect(out.element.caption).toBe('Flow');
    expect(out.warnings).toEqual([]);
  });

  test('fallback yields code element with mermaid lang', async () => {
    const runSub = jest.fn(async () => ({ stdout: '', stderr: '', code: -1, error: new Error('missing') }));
    const out = await mermaid.renderToDocModelElement(
      { source: 'graph TD; A-->B;', caption: 'Flow', outPath: '/tmp/flow.svg' },
      { runSub, writeFile: () => {} },
    );
    expect(out.element.type).toBe('code');
    expect(out.element.lang).toBe('mermaid');
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});
