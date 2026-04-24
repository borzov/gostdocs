const fs = require('fs');
const os = require('os');
const path = require('path');

const { runInspector, warnsForAuthedLogin, writePendingClaudeJobs } = require('../skills/gostdocs/scripts/ui-inspector');
const manifestLib = require('../skills/gostdocs/scripts/lib/manifest');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-ui-'));
}

function baseMeta(project, provider = 'claude') {
  return {
    skill_version: '0.3.0',
    project_path: project,
    doc_types: ['user-guide'],
    gost_mode: 'lite',
    app: { url: 'http://localhost:3000', launch: 'url' },
    auth: { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [], authorization_scheme: 'Bearer', fallback_to_form: false },
    capture: { viewports: [{ name: 'desktop', width: 1280, height: 800 }], themes: [], locales: [], wait_after_navigation: 2000, timeout: 30000 },
    states: [],
    pages: [],
    output: { languages: ['ru'], formats: ['docx'] },
    vision: { provider },
    precheck: { min_entities: {} },
  };
}

function seedManifest(project, captures) {
  const manifest = manifestLib.emptyManifest('http://localhost:3000');
  for (const c of captures) {
    manifestLib.upsertCapture(manifest, { success: true, access: 'public', ...c });
    const pngDir = path.join(project, 'docs', 'screenshots', path.dirname(c.file));
    fs.mkdirSync(pngDir, { recursive: true });
    fs.writeFileSync(path.join(project, 'docs', 'screenshots', c.file), Buffer.from([0x01]));
  }
  const manifestPath = path.join(project, 'docs', 'screenshots', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  manifestLib.write(manifestPath, manifest);
  return manifestPath;
}

describe('warnsForAuthedLogin', () => {
  test('flags authed role landing on login form', () => {
    const warnings = warnsForAuthedLogin({ file: 'x', role: 'admin' }, { is_login_form: true });
    expect(warnings).toHaveLength(1);
  });

  test('guest role login form is fine', () => {
    const warnings = warnsForAuthedLogin({ file: 'x', role: 'guest' }, { is_login_form: true });
    expect(warnings).toEqual([]);
  });

  test('no warnings when not login form', () => {
    const warnings = warnsForAuthedLogin({ file: 'x', role: 'admin' }, { is_login_form: false });
    expect(warnings).toEqual([]);
  });
});

describe('writePendingClaudeJobs', () => {
  test('writes one JSONL row per capture', () => {
    const project = tmpProject();
    seedManifest(project, [
      { id: 'home', path: '/', role: 'admin', viewport: 'desktop', file: 'admin/desktop/home.png' },
      { id: 'settings', path: '/settings', role: 'admin', viewport: 'desktop', file: 'admin/desktop/settings.png' },
    ]);
    const manifest = manifestLib.read(path.join(project, 'docs', 'screenshots', 'manifest.json'));
    const result = writePendingClaudeJobs({ manifest, metaData: baseMeta(project) });
    expect(result.count).toBe(2);
    const content = fs.readFileSync(result.pending_file, 'utf8');
    const rows = content.trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(rows[0].png_path).toMatch(/admin\/desktop\/home\.png$/);
    expect(rows[0].prompt).toMatch(/JSON/);
  });
});

describe('runInspector — openai provider (mocked)', () => {
  test('writes inspection json per capture', async () => {
    const project = tmpProject();
    seedManifest(project, [
      { id: 'home', path: '/', role: 'admin', viewport: 'desktop', file: 'admin/desktop/home.png' },
    ]);
    const parsedJson = {
      title: 'Home', breadcrumb: [], top_buttons: [], filters: [], modals_visible: [],
      is_login_form: false, is_error_page: false, is_empty_state: false,
      layout: null, component_kind_notes: null, table: null,
    };
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify(parsedJson) } }] }); },
    }));
    const meta = baseMeta(project, 'openai');
    const result = await runInspector(meta, { apiKey: 'sk-test', fetchImpl });
    expect(result.provider).toBe('openai');
    expect(result.written).toEqual(['admin/desktop/home.png']);
    const jsonFile = path.join(project, 'docs', 'generated', '_inspection', 'admin', 'desktop', 'home.json');
    expect(fs.existsSync(jsonFile)).toBe(true);
  });

  test('flags authed role login-form shot', async () => {
    const project = tmpProject();
    seedManifest(project, [
      { id: 'home', path: '/', role: 'admin', viewport: 'desktop', file: 'admin/desktop/home.png' },
    ]);
    const parsedJson = {
      title: null, breadcrumb: [], top_buttons: [], filters: [], modals_visible: [],
      is_login_form: true, is_error_page: false, is_empty_state: false,
      layout: null, component_kind_notes: null, table: null,
    };
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify(parsedJson) } }] }); },
    }));
    const result = await runInspector(baseMeta(project, 'openai'), { apiKey: 'sk-test', fetchImpl });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].scope).toBe('is_login_form');
  });

  test('collects errors for missing PNG', async () => {
    const project = tmpProject();
    const manifestPath = path.join(project, 'docs', 'screenshots', 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const manifest = manifestLib.emptyManifest('http://localhost:3000');
    manifestLib.upsertCapture(manifest, {
      id: 'home', path: '/', role: 'admin', viewport: 'desktop',
      file: 'admin/desktop/missing.png', success: true, access: 'public',
    });
    manifestLib.write(manifestPath, manifest);
    const fetchImpl = jest.fn();
    const result = await runInspector(baseMeta(project, 'openai'), { apiKey: 'sk-test', fetchImpl });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe('readFile');
  });
});
