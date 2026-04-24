const path = require('path');
const fs = require('fs');
const mermaid = require('../skills/gostdocs/scripts/adapters/mermaid');

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

describe('resolveMmdcBin', () => {
  test('prefers local node_modules/.bin/mmdc when it exists', () => {
    const statSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      return String(p).endsWith(path.join('node_modules', '.bin', 'mmdc'));
    });
    try {
      const bin = mermaid.resolveMmdcBin();
      expect(bin.endsWith(path.join('node_modules', '.bin', 'mmdc'))).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });

  test('falls back to PATH lookup when local binary is missing', () => {
    const statSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      expect(mermaid.resolveMmdcBin()).toBe('mmdc');
    } finally {
      statSpy.mockRestore();
    }
  });
});

describe('puppeteer config plumbing', () => {
  beforeEach(() => mermaid.resetAvailabilityCache());

  test('passes --puppeteerConfigFile when config path exists', async () => {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-cfg-'));
    const cfg = path.join(tmp, 'puppeteer.json');
    fs.writeFileSync(cfg, '{}');
    try {
      const argsSeen = [];
      const runSub = jest.fn(async (bin, args) => {
        argsSeen.push(args);
        return { stdout: '', stderr: '', code: 0 };
      });
      const writeFile = jest.fn();
      await mermaid.renderMermaid('graph TD; A-->B;', '/tmp/x.svg', {
        runSub, writeFile, puppeteerConfigPath: cfg,
      });
      const renderArgs = argsSeen[1];
      expect(renderArgs).toContain('--puppeteerConfigFile');
      expect(renderArgs).toContain(cfg);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('drops --puppeteerConfigFile when explicit path is missing from disk', async () => {
    const argsSeen = [];
    const runSub = jest.fn(async (bin, args) => {
      argsSeen.push(args);
      return { stdout: '', stderr: '', code: 0 };
    });
    await mermaid.renderMermaid('graph TD; A-->B;', '/tmp/x.svg', {
      runSub, writeFile: () => {}, puppeteerConfigPath: '/nonexistent/cfg.json',
    });
    const renderArgs = argsSeen[1];
    expect(renderArgs).not.toContain('--puppeteerConfigFile');
  });

  test('skips --puppeteerConfigFile when config explicitly disabled', async () => {
    // Pass `puppeteerConfigPath: null` so the resolver does not auto-discover
    // the on-disk `.puppeteer-config.json` (created by the bootstrap step in
    // the skill sandbox) and break the assertion in environments where it
    // exists.
    const argsSeen = [];
    const runSub = jest.fn(async (bin, args) => {
      argsSeen.push(args);
      return { stdout: '', stderr: '', code: 0 };
    });
    await mermaid.renderMermaid('graph TD; A-->B;', '/tmp/x.svg', {
      runSub, writeFile: () => {}, puppeteerConfigPath: null,
    });
    const renderArgs = argsSeen[1];
    expect(renderArgs).not.toContain('--puppeteerConfigFile');
  });
});

describe('verifyInstallation', () => {
  beforeEach(() => mermaid.resetAvailabilityCache());

  test('returns ok=true with version when mmdc runs', async () => {
    const runSub = jest.fn(async () => ({ stdout: '10.9.1\n', stderr: '', code: 0 }));
    const result = await mermaid.verifyInstallation('mmdc', { runSub });
    expect(result.ok).toBe(true);
    expect(result.version).toBe('10.9.1');
  });

  test('returns ok=false when mmdc missing', async () => {
    const runSub = jest.fn(async () => ({ stdout: '', stderr: '', code: -1, error: new Error('ENOENT') }));
    const result = await mermaid.verifyInstallation('mmdc', { runSub });
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
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
