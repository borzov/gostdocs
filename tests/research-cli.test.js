const fs = require('fs');
const os = require('os');
const path = require('path');

const { runResearch, researchDir } = require('../skills/gostdocs/scripts/research');
const researchResult = require('../skills/gostdocs/scripts/lib/research-result');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-research-'));
}

function writeSummary(root, agent, coverage, files = [], warnings = []) {
  const dir = path.join(root, 'docs', 'generated', '_research');
  fs.mkdirSync(dir, { recursive: true });
  const summary = researchResult.emptySummary(agent);
  summary.coverage = coverage;
  summary.files = files;
  summary.warnings = warnings;
  researchResult.writeSummary(path.join(dir, `${agent}.summary.json`), summary);
  return path.join(dir, `${agent}.summary.json`);
}

function baseMeta(project) {
  return {
    skill_version: '1.0.0',
    project_path: project,
    doc_types: ['user-guide'],
    gost_mode: 'lite',
    app: { url: 'http://localhost:3000', launch: 'url' },
    auth: { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [], authorization_scheme: 'Bearer', fallback_to_form: false },
    capture: { viewports: [{ name: 'desktop', width: 1280, height: 800 }], themes: [], locales: [], wait_after_navigation: 2000, timeout: 30000 },
    states: [],
    pages: [],
    output: { languages: ['ru'], formats: ['docx'] },
    vision: { provider: 'claude' },
    precheck: { min_entities: {} },
  };
}

describe('runResearch', () => {
  test('aggregates summaries and applies NFR policy (lite)', async () => {
    const project = tmpProject();
    writeSummary(project, 'doc-researcher', [
      { section: 'ROUTES', found: true, source: 'src/router.ts', size: 500, missing: [] },
      { section: 'NFR',    found: false, source: null, size: 0, missing: [] },
    ]);
    writeSummary(project, 'spec-reader', [
      { section: 'GLOSSARY', found: true, source: 'docs/spec.pdf', size: 100, missing: [] },
    ]);

    const report = await runResearch(baseMeta(project), { writeOutput: false });
    expect(report.aggregate.agents).toEqual(['doc-researcher', 'spec-reader']);
    expect(report.aggregate.missingSections).toContain('NFR');
    expect(report.nfr.warnings.length).toBeGreaterThan(0); // lite mode
    expect(report.nfr.blockers).toEqual([]);
  });

  test('strict mode produces blockers for missing NFR', async () => {
    const project = tmpProject();
    writeSummary(project, 'doc-researcher', [
      { section: 'NFR', found: false, source: null, size: 0, missing: [] },
    ]);
    const meta = { ...baseMeta(project), gost_mode: 'strict' };
    const report = await runResearch(meta, { writeOutput: false });
    expect(report.nfr.blockers.length).toBeGreaterThan(0);
  });

  test('schema adapter invoked when no schema agent wrote results', async () => {
    const project = tmpProject();
    // No summaries -> schema adapter should run (and return empty, no project markers).
    const report = await runResearch(baseMeta(project), { writeOutput: false });
    expect(report.schema).not.toBeNull();
    expect(report.schema.tables_count).toBe(0);
  });

  test('schema adapter skipped when schema agent has written', async () => {
    const project = tmpProject();
    writeSummary(project, 'schema-adapter', [
      { section: 'DATABASE', found: true, source: 'schema.prisma', size: 1024, missing: [] },
    ]);
    const report = await runResearch(baseMeta(project), { writeOutput: false });
    expect(report.schema).toBeNull();
  });

  test('AI-artifact markdown in _research flagged', async () => {
    const project = tmpProject();
    writeSummary(project, 'doc-researcher', []);
    const dir = path.join(project, 'docs', 'generated', '_research');
    fs.writeFileSync(
      path.join(dir, 'TECHNICAL_SPECIFICATION.md'),
      '# Comprehensive Documentation\n\nThis document provides...',
      'utf8',
    );
    const report = await runResearch(baseMeta(project), { writeOutput: false });
    expect(report.ai_artifacts.length).toBeGreaterThan(0);
    expect(report.ai_artifacts[0].path).toMatch(/TECHNICAL_SPECIFICATION/);
  });

  test('writeOutput writes coverage.json', async () => {
    const project = tmpProject();
    writeSummary(project, 'doc-researcher', []);
    await runResearch(baseMeta(project), { writeOutput: true });
    const file = path.join(researchDir(baseMeta(project)), 'coverage.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.aggregate).toBeDefined();
  });
});
