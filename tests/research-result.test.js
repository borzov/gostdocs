const fs = require('fs');
const os = require('os');
const path = require('path');

const rr = require('../skills/gostdocs/scripts/lib/research-result');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-rr-'));
  return path.join(dir, 'summary.json');
}

describe('emptySummary + validate', () => {
  test('empty summary validates', () => {
    const s = rr.emptySummary('doc-researcher');
    expect(rr.validate(s).agent).toBe('doc-researcher');
  });

  test('rejects missing agent', () => {
    expect(() => rr.validate({ version: '1.0', generated_at: 't', coverage: [] })).toThrow();
  });

  test('rejects unknown top-level keys', () => {
    expect(() => rr.validate({
      version: '1.0', agent: 'x', generated_at: 't', coverage: [], extra: 1,
    })).toThrow();
  });
});

describe('writeSummary / readSummary', () => {
  test('roundtrip', () => {
    const file = tmpFile();
    const s = rr.emptySummary('spec-reader');
    s.coverage.push({ section: 'FEATURES', found: true, source: 'README.md', size: 1024, missing: [] });
    rr.writeSummary(file, s);
    const readBack = rr.readSummary(file);
    expect(readBack.agent).toBe('spec-reader');
    expect(readBack.coverage).toHaveLength(1);
  });
});

describe('aggregate', () => {
  test('merges sections across agents', () => {
    const a = rr.emptySummary('doc-researcher');
    a.coverage.push({ section: 'ROUTES', found: true, source: 'src/router.ts', size: 500, missing: [] });
    a.coverage.push({ section: 'NFR',    found: false, source: null, size: 0, missing: [] });
    const b = rr.emptySummary('spec-reader');
    b.coverage.push({ section: 'ROUTES', found: true, source: 'docs/spec.pdf', size: 100, missing: [] });
    b.coverage.push({ section: 'GLOSSARY', found: true, source: 'docs/spec.pdf', size: 50, missing: [] });

    const agg = rr.aggregate([a, b]);
    const routes = agg.sections.find((s) => s.section === 'ROUTES');
    expect(routes.found).toBe(true);
    expect(routes.agents).toEqual(['doc-researcher', 'spec-reader']);
    expect(routes.sources).toEqual(['docs/spec.pdf', 'src/router.ts']);
    expect(agg.missingSections).toEqual(['NFR']);
    expect(agg.agents).toEqual(['doc-researcher', 'spec-reader']);
  });

  test('carries through warnings with agent tag', () => {
    const a = rr.emptySummary('doc-researcher');
    a.warnings.push({ scope: 'auth', message: 'no roles found' });
    const agg = rr.aggregate([a]);
    expect(agg.warnings).toHaveLength(1);
    expect(agg.warnings[0].agent).toBe('doc-researcher');
    expect(agg.warnings[0].scope).toBe('auth');
  });

  test('empty summaries list', () => {
    const agg = rr.aggregate([]);
    expect(agg.agents).toEqual([]);
    expect(agg.sections).toEqual([]);
    expect(agg.missingSections).toEqual([]);
  });
});
