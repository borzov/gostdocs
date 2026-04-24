'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const initMeta = require('../skills/gostdocs/scripts/init-meta');

function makeProject(layout = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'initmeta-'));
  for (const [rel, contents] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

const rm = (root) => fs.rmSync(root, { recursive: true, force: true });

describe('reportGaps — end-to-end', () => {
  test('detects framework, derived metadata, and emits gaps', async () => {
    const project = makeProject({
      'artisan': '#!/usr/bin/env php',
      '.env.example': 'DB_HOST=db\nDB_PORT=5432\nDB_DATABASE=acme\nDB_USERNAME=acme_usr\nAPP_PORT=8080\n',
      'docker-compose.yml': 'services:\n  app:\n    image: x\n  db:\n    image: postgres\n',
      'package.json': JSON.stringify({ name: 'acme-app' }),
    });
    try {
      const r = await initMeta.reportGaps({ projectPath: project });
      expect(r.framework).toBe('laravel');
      expect(r.proposed_meta.metadata.db_user).toBe('acme_usr');
      expect(r.proposed_meta.metadata.db_name).toBe('acme');
      expect(r.proposed_meta.metadata.service_name).toBe('app');
      // app.url is empty by default → critical gap
      const fields = r.gaps.map((g) => g.field);
      expect(fields).toContain('app.url');
      // system_name proposal uses package.json name as default
      const sn = r.gaps.find((g) => g.field === 'metadata.system_name');
      expect(sn.default).toBe('acme-app');
    } finally { rm(project); }
  });

  test('preserves existing meta.yaml when reporting gaps', async () => {
    const project = makeProject({
      'docs/meta.yaml': [
        'project_path: ' + 'PLACEHOLDER',
        'doc_types: [user-guide]',
        'gost_mode: lite',
        'app:',
        '  url: http://prod.example.com',
        '  launch: url',
        'metadata:',
        '  system_name: My Custom System',
      ].join('\n'),
    });
    try {
      // Patch project_path to actual tmp
      const realCfg = path.join(project, 'docs/meta.yaml');
      fs.writeFileSync(realCfg, fs.readFileSync(realCfg, 'utf8').replace('PLACEHOLDER', project));
      const r = await initMeta.reportGaps({ projectPath: project });
      expect(r.proposed_meta.metadata.system_name).toBe('My Custom System');
      expect(r.proposed_meta.app.url).toBe('http://prod.example.com');
      expect(r.proposed_meta.gost_mode).toBe('lite');
      // No app.url gap because user already filled it
      const fields = r.gaps.map((g) => g.field);
      expect(fields).not.toContain('app.url');
      expect(fields).not.toContain('metadata.system_name');
    } finally { rm(project); }
  });
});

describe('applyAnswers — write meta.yaml', () => {
  test('merges answers and writes a valid meta.yaml + gitignore', async () => {
    const project = makeProject({
      '.env.example': 'APP_PORT=3000\n',
      'package.json': JSON.stringify({ name: 'app' }),
    });
    const answers = {
      'app.url': 'http://localhost:3000',
      'metadata.system_name': 'My System',
      'metadata.organization': 'ACME LLC',
      'metadata.doc_code': 'AB.123-01',
      'metadata.version': '1.2',
      'metadata.repo_url': '—',
    };
    const answersPath = path.join(project, 'answers.json');
    fs.writeFileSync(answersPath, JSON.stringify(answers));

    try {
      const out = await initMeta.applyAnswers({ projectPath: project, apply: answersPath });
      expect(out.written).toBe(path.join(project, 'docs', 'meta.yaml'));
      const written = fs.readFileSync(out.written, 'utf8');
      expect(written).toMatch(/system_name: My System/);
      expect(written).toMatch(/url: http:\/\/localhost:3000/);
      // .gitignore must include docs/meta.yaml
      const gi = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
      expect(gi).toMatch(/docs\/meta\.yaml/);
    } finally { rm(project); }
  });

  test('--dry-run does not write the file', async () => {
    const project = makeProject({});
    const answersPath = path.join(project, 'answers.json');
    fs.writeFileSync(answersPath, JSON.stringify({
      'app.url': 'http://x',
      'metadata.system_name': 'X',
    }));
    try {
      const out = await initMeta.applyAnswers({ projectPath: project, apply: answersPath, dryRun: true });
      expect(out.written).toBeNull();
      expect(out.meta.metadata.system_name).toBe('X');
      expect(fs.existsSync(path.join(project, 'docs', 'meta.yaml'))).toBe(false);
    } finally { rm(project); }
  });
});

describe('parseFlags', () => {
  test('parses --report / --apply / --dry-run / --project-path / --config', () => {
    const f = initMeta.parseFlags(['--report', '--project-path', '/x', '--config', '/y/meta.yaml']);
    expect(f.report).toBe(true);
    expect(f.projectPath).toBe('/x');
    expect(f.config).toBe('/y/meta.yaml');
    const g = initMeta.parseFlags(['--apply', 'a.json', '--dry-run']);
    expect(g.apply).toBe('a.json');
    expect(g.dryRun).toBe(true);
  });
});
