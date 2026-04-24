const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPlanCapture, augmentPagesWithComponents } = require('../skills/gostdocs/scripts/plan-capture');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-plan-'));
}

function baseMeta(projectPath) {
  return {
    skill_version: '0.3.0',
    project_path: projectPath,
    doc_types: ['user-guide'],
    gost_mode: 'lite',
    app: { url: 'http://localhost:3000', launch: 'url' },
    auth: { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [], authorization_scheme: 'Bearer', fallback_to_form: false },
    capture: {
      viewports: [{ name: 'desktop', width: 1280, height: 800 }],
      themes: [], locales: [],
      wait_after_navigation: 2000, timeout: 30000,
    },
    states: [],
    pages: [{ id: 'home', path: '/' }],
    output: { languages: ['ru'], formats: ['docx'] },
    vision: { provider: 'claude' },
    precheck: { min_entities: {} },
  };
}

describe('augmentPagesWithComponents', () => {
  test('includes component shots when project has Builder files', () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'ProjectBuilder.tsx'), 'x');
    fs.writeFileSync(path.join(root, 'src', 'router.ts'), "{path: '/projects/new', component: ProjectBuilder}");

    const meta = baseMeta(root);
    const { componentShots, components } = augmentPagesWithComponents(meta);
    expect(components.length).toBeGreaterThan(0);
    expect(componentShots.length).toBeGreaterThanOrEqual(1);
    expect(componentShots[0].path).toBe('/projects/new');
  });

  test('skips duplicates already declared in meta.pages', () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'ProjectBuilder.tsx'), 'x');
    fs.writeFileSync(path.join(root, 'src', 'router.ts'), "{path: '/projects/new', component: ProjectBuilder}");

    const meta = baseMeta(root);
    meta.pages = [
      { id: 'home', path: '/' },
      { id: 'projectbuilder__empty', path: '/projects/new' },
    ];
    const { componentShots } = augmentPagesWithComponents(meta);
    const ids = componentShots.map((s) => s.id);
    expect(ids).not.toContain('projectbuilder__empty');
  });
});

describe('runPlanCapture', () => {
  test('emits plan with meta.pages even without component files', async () => {
    const root = tmpProject();
    const meta = baseMeta(root);
    const { plan, summary } = await runPlanCapture(meta);
    expect(plan.length).toBeGreaterThanOrEqual(1);
    expect(summary.counts.pages_declared).toBe(1);
  });

  test('honours empty pages gracefully', async () => {
    const root = tmpProject();
    const meta = baseMeta(root);
    meta.pages = [];
    const { plan } = await runPlanCapture(meta);
    expect(Array.isArray(plan)).toBe(true);
  });

  test('summary records counts for roles/viewports/themes', async () => {
    const root = tmpProject();
    const meta = baseMeta(root);
    meta.capture.themes = ['light', 'dark'];
    meta.auth.roles = [
      { role: 'guest', credentials: null },
      { role: 'admin', api_endpoint: '/api/login', username: 'a', password: 'b' },
    ];
    meta.auth.method = 'api';
    const { summary } = await runPlanCapture(meta);
    expect(summary.roles).toEqual(['guest', 'admin']);
    expect(summary.themes).toEqual(['light', 'dark']);
  });
});
