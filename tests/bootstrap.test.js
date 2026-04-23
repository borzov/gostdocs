'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const bootstrap = require('../skills/gen-docs/scripts/bootstrap');

describe('bootstrap exports', () => {
  test('exposes configuration helpers', () => {
    expect(typeof bootstrap.readPinnedVersions).toBe('function');
    expect(typeof bootstrap.checkRuntime).toBe('function');
    expect(typeof bootstrap.chromiumExecutable).toBe('function');
    expect(typeof bootstrap.writePuppeteerConfig).toBe('function');
    expect(typeof bootstrap.mmdcBinary).toBe('function');
    expect(typeof bootstrap.puppeteerConfigPath).toBe('function');
  });
});

describe('readPinnedVersions', () => {
  test('returns both playwright and mmdc pins', () => {
    const v = bootstrap.readPinnedVersions();
    expect(v.playwright).toMatch(/^\d/);
    expect(v.mmdc).toMatch(/^\d/);
  });
});

describe('writePuppeteerConfig', () => {
  test('writes config JSON with supplied executablePath to the given directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-bs-'));
    try {
      const cfg = bootstrap.writePuppeteerConfig('/path/to/chromium', { outDir: tmp });
      expect(cfg).toBe(path.join(tmp, '.puppeteer-config.json'));
      const parsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      expect(parsed.executablePath).toBe('/path/to/chromium');
      expect(Array.isArray(parsed.args)).toBe(true);
      expect(parsed.args).toContain('--no-sandbox');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns null when executablePath is falsy', () => {
    expect(bootstrap.writePuppeteerConfig(null)).toBeNull();
    expect(bootstrap.writePuppeteerConfig('')).toBeNull();
  });
});

describe('mmdcBinary', () => {
  test('returns the local bin path when the file exists', () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation(
      (p) => String(p).endsWith(path.join('node_modules', '.bin', 'mmdc')),
    );
    try {
      const bin = bootstrap.mmdcBinary();
      expect(bin).not.toBeNull();
      expect(bin.endsWith(path.join('node_modules', '.bin', 'mmdc'))).toBe(true);
    } finally {
      existsSpy.mockRestore();
    }
  });

  test('returns null when binary is missing', () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      expect(bootstrap.mmdcBinary()).toBeNull();
    } finally {
      existsSpy.mockRestore();
    }
  });
});

describe('puppeteerConfigPath', () => {
  test('returns the expected absolute path under SKILL_DIR', () => {
    const p = bootstrap.puppeteerConfigPath();
    expect(p.endsWith('.puppeteer-config.json')).toBe(true);
    expect(path.isAbsolute(p)).toBe(true);
  });
});
