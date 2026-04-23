const fs = require('fs');
const os = require('os');
const path = require('path');

const scanner = require('../skills/gen-docs/scripts/adapters/component-detector/scanner');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-comp-'));
}

function write(root, relative, content) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('classifyByName', () => {
  test.each([
    ['ProjectBuilder.tsx', 'builder'],
    ['TemplateEditor.jsx', 'editor'],
    ['OnboardingWizard.vue', 'wizard'],
    ['QueryConstructor.ts', 'constructor'],
    ['PageDesigner.tsx', 'designer'],
    ['LayoutComposer.jsx', 'composer'],
  ])('classifies %s as %s', (file, expected) => {
    expect(scanner.classifyByName(file)).toBe(expected);
  });

  test('returns null for non-matching names', () => {
    expect(scanner.classifyByName('Utils.ts')).toBeNull();
    expect(scanner.classifyByName('README.md')).toBeNull();
  });
});

describe('extractComponentName', () => {
  test('strips extension', () => {
    expect(scanner.extractComponentName('ProjectBuilder.tsx')).toBe('ProjectBuilder');
  });

  test('returns null when no match', () => {
    expect(scanner.extractComponentName('plain.js')).toBeNull();
  });
});

describe('scanProject', () => {
  test('finds components and their routes', () => {
    const root = tmpProject();
    write(root, 'src/components/ProjectBuilder.tsx', 'export function ProjectBuilder() {}');
    write(root, 'src/router.ts', `
      import { ProjectBuilder } from './components/ProjectBuilder';
      export const routes = [
        { path: '/projects/new', component: ProjectBuilder },
      ];
    `);
    write(root, 'src/pages/Home.tsx', 'export const Home = () => null;');

    const result = scanner.scanProject(root);
    const builder = result.components.find((c) => c.name === 'ProjectBuilder');
    expect(builder).toBeDefined();
    expect(builder.kind).toBe('builder');
    expect(builder.routes).toContain('/projects/new');
  });

  test('skips excluded directories', () => {
    const root = tmpProject();
    write(root, 'node_modules/pkg/IgnoredBuilder.tsx', '');
    write(root, 'src/RealBuilder.tsx', '');
    const result = scanner.scanProject(root);
    const names = result.components.map((c) => c.name);
    expect(names).toContain('RealBuilder');
    expect(names).not.toContain('IgnoredBuilder');
  });

  test('warns on missing root', () => {
    const result = scanner.scanProject('/nonexistent/abc');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.components).toEqual([]);
  });
});

describe('suggestedShots', () => {
  test('returns 3 shots for component with route', () => {
    const shots = scanner.suggestedShots({
      name: 'ProjectBuilder',
      kind: 'builder',
      routes: ['/projects/new'],
    });
    expect(shots).toHaveLength(3);
    expect(shots[0].state).toBe('empty');
    expect(shots[0].path).toBe('/projects/new');
    expect(shots[0].component_kind).toBe('builder');
  });

  test('returns empty for component without routes', () => {
    expect(scanner.suggestedShots({ name: 'X', kind: 'builder', routes: [] })).toEqual([]);
  });
});
