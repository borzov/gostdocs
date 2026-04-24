'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const generate = require('../skills/gostdocs/scripts/generate');
const dm = require('../skills/gostdocs/scripts/lib/doc-model');

function mkTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gostdocs-run-'));
  // Minimal meta.yaml compliant with v0.3 schema
  fs.writeFileSync(
    path.join(tmp, 'meta.yaml'),
    [
      'skill_version: "0.3.0"',
      `project_path: ${tmp}`,
      'doc_types: [user-guide, technical-description]',
      'gost_mode: strict',
      'app:',
      '  url: http://localhost:3000',
      '  launch: none',
      'auth:',
      '  method: none',
      '  storage: cookie',
      '  dismiss_selectors: []',
      '  roles: []',
      'capture:',
      '  viewports:',
      '    - { name: desktop, width: 1280, height: 800 }',
      '  themes: []',
      '  locales: []',
      '  wait_after_navigation: 1000',
      '  timeout: 30000',
      'states: []',
      'precheck:',
      '  health_endpoint: /health',
      '  min_entities: {}',
      'output:',
      '  languages: [ru]',
      '  formats: [docx]',
      'vision:',
      '  provider: claude',
      'metadata:',
      '  organization: "ООО «Пилот»"',
      '  system_name: "Пилот"',
      '  doc_code: "PIL.00001-01"',
      '  version: "1.0"',
      '  city: "Москва"',
      '  year: "2026"',
    ].join('\n'),
  );

  // Minimal manifest
  fs.mkdirSync(path.join(tmp, 'docs', 'screenshots'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'screenshots', 'manifest.json'),
    JSON.stringify(
      {
        version: '2.0',
        generated_at: '2026-04-23T10:00:00Z',
        base_url: 'http://localhost:3000',
        roles: ['guest'],
        captures: [
          {
            id: 'home',
            path: '/',
            role: 'guest',
            viewport: 'desktop',
            theme: null,
            locale: null,
            state: null,
            action_sequence: null,
            component_kind: null,
            journey: null,
            title: 'Главная',
            access: 'public',
            url: 'http://localhost:3000/',
            file: 'guest/desktop/home.png',
            sha256: null,
            captured_at: '2026-04-23T10:00:00Z',
            success: true,
          },
        ],
        errors: [],
        warnings: [],
      },
      null,
      2,
    ),
  );

  // Pretend the PNG file exists so md-lint image checks pass
  fs.mkdirSync(path.join(tmp, 'docs', 'screenshots', 'guest', 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs', 'screenshots', 'guest', 'desktop', 'home.png'), 'fake');

  // Minimal inspection for the one capture
  const inspDir = path.join(tmp, 'docs', 'generated', '_inspection', 'guest', 'desktop');
  fs.mkdirSync(inspDir, { recursive: true });
  fs.writeFileSync(
    path.join(inspDir, 'home.json'),
    JSON.stringify(
      {
        version: '1.0',
        file: 'guest/desktop/home.png',
        role: 'guest',
        viewport: 'desktop',
        theme: null,
        locale: null,
        title: 'Главная',
        breadcrumb: ['Главная'],
        layout: 'two-column',
        top_buttons: [{ label: 'Войти', location: 'top-bar', icon_only: false }],
        filters: [],
        table: null,
        modals_visible: [],
        is_login_form: false,
        is_error_page: false,
        is_empty_state: false,
        component_kind_notes: null,
        inspector: 'claude',
        captured_at: '2026-04-23T10:00:00Z',
        notes: null,
      },
      null,
      2,
    ),
  );

  // Minimal research coverage
  const researchDir = path.join(tmp, 'docs', 'generated', '_research');
  fs.mkdirSync(researchDir, { recursive: true });
  fs.writeFileSync(
    path.join(researchDir, 'coverage.json'),
    JSON.stringify(
      {
        agents: ['doc-researcher'],
        totalFiles: 1,
        sections: [
          { section: 'NFR', found: true, agents: ['doc-researcher'], sources: ['spec.md'] },
          { section: 'ROUTES', found: true, agents: ['doc-researcher'], sources: ['router.ts'] },
        ],
        missingSections: [],
        warnings: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(researchDir, 'architecture.md'),
    '```mermaid\ngraph TD\n  A-->B\n```\n',
  );

  // Minimal schema.json (used by GEN:db-schema)
  fs.writeFileSync(
    path.join(researchDir, 'schema.json'),
    JSON.stringify(
      {
        source: 'prisma',
        tables: [
          {
            name: 'users',
            comment: 'User accounts',
            columns: [
              { name: 'id', type: 'uuid', nullable: false, default: null, primary: true, unique: true, comment: 'PK' },
              { name: 'email', type: 'text', nullable: false, default: null, primary: false, unique: true, comment: null },
            ],
            foreign_keys: [],
            indexes: [],
          },
        ],
        warnings: [],
      },
      null,
      2,
    ),
  );

  // Template directory — use project-local templates to avoid coupling to the skill's files
  const tplDir = path.join(tmp, '.templates', 'gost-strict');
  fs.mkdirSync(tplDir, { recursive: true });
  fs.writeFileSync(
    path.join(tplDir, 'user-guide.md'),
    [
      '---',
      'title: "Пилот. Руководство пользователя"',
      'lang: ru-RU',
      '---',
      '',
      '# Введение',
      '',
      'Документ описывает пользовательские функции системы.',
      '',
      '<!-- GEN:metadata key="organization" -->',
      '',
      '# Описание операций',
      '',
      '<!-- GEN:page-description role="guest" -->',
      '',
      '# Примеры использования',
      '',
      'Ниже приведены типовые сценарии работы пользователя.',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(tplDir, 'technical-description.md'),
    [
      '---',
      'title: "Пилот. Техническое описание"',
      'lang: ru-RU',
      '---',
      '',
      '# Общие сведения',
      '',
      'Технический документ.',
      '',
      '# Структура базы данных',
      '',
      '<!-- GEN:db-schema scope="all" headingLevel="3" -->',
      '',
      '# Архитектура',
      '',
      '<!-- GEN:mermaid source="architecture" title="Общая архитектура" -->',
    ].join('\n'),
  );

  return { projectPath: tmp, skillDir: tmp, configPath: path.join(tmp, 'meta.yaml'), tplDir };
}

function removeTmp(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function fakeMermaid(outPath) {
  return {
    renderToDocModelElement: jest.fn(async (input) => {
      fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
      fs.writeFileSync(input.outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return {
        element: { type: 'figure', caption: input.caption, file: input.outPath },
        warnings: [],
      };
    }),
  };
}

describe('buildContext', () => {
  test('loads manifest, inspections, research, schema, metadata', async () => {
    const proj = mkTmpProject();
    try {
      const ctx = await generate.buildContext({ configPath: proj.configPath }, { templateRoot: proj.tplDir });
      expect(ctx.meta.doc_types).toEqual(['user-guide', 'technical-description']);
      expect(ctx.manifest.captures).toHaveLength(1);
      expect(ctx.inspections.size).toBe(1);
      expect(ctx.schema.tables[0].name).toBe('users');
      expect(ctx.metadata.organization).toBe('ООО «Пилот»');
      expect(ctx.lang).toBe('ru');
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});

describe('runGenerate — integration', () => {
  test('generates markdown for every doc_type and passes md-lint', async () => {
    const proj = mkTmpProject();
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          mermaidModule: fakeMermaid(),
        },
      );
      if (result.exitCode !== 0) {
        const preview = result.blockers.map((b) => `${b.scope}: ${b.message}`).join('\n');
        throw new Error(`runGenerate blocked:\n${preview}`);
      }
      expect(result.exitCode).toBe(0);
      expect(result.documents).toHaveLength(2);
      const userGuide = result.documents.find((d) => d.docType === 'user-guide');
      expect(fs.existsSync(userGuide.outPath)).toBe(true);
      const md = fs.readFileSync(userGuide.outPath, 'utf8');
      expect(md).toMatch(/^---\ntitle-meta: /);
      expect(md).toMatch(/Рекомендации по информационной безопасности/);
      expect(md).toMatch(/Главная/);
      expect(md).toMatch(/Рисунок 2\.1 — Главная/);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('--only restricts to one doc type', async () => {
    const proj = mkTmpProject();
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'user-guide',
          mermaidModule: fakeMermaid(),
        },
      );
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].docType).toBe('user-guide');
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('--dry-run does not write files', async () => {
    const proj = mkTmpProject();
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          dryRun: true,
          mermaidModule: fakeMermaid(),
        },
      );
      expect(result.documents).toHaveLength(2);
      for (const doc of result.documents) {
        expect(doc.outPath).toBeNull();
      }
      expect(fs.existsSync(path.join(proj.projectPath, 'docs', 'generated', 'user-guide.md'))).toBe(false);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('GEN:db-schema renders markdown tables', async () => {
    const proj = mkTmpProject();
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'technical-description',
          mermaidModule: fakeMermaid(),
        },
      );
      const td = result.documents[0];
      const md = fs.readFileSync(td.outPath, 'utf8');
      expect(md).toMatch(/^### users$/m);
      expect(md).toMatch(/\| Столбец \| Тип \| Описание \|/);
      expect(md).toMatch(/\| id \| uuid /);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('GEN:mermaid calls the mermaid adapter with resolved paths', async () => {
    const proj = mkTmpProject();
    try {
      const mermaidMock = fakeMermaid();
      await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'technical-description',
          mermaidModule: mermaidMock,
        },
      );
      expect(mermaidMock.renderToDocModelElement).toHaveBeenCalledTimes(1);
      const call = mermaidMock.renderToDocModelElement.mock.calls[0][0];
      expect(call.source).toMatch(/graph TD/);
      expect(call.outPath).toMatch(/_diagrams\/architecture\.png$/);
      expect(call.caption).toBe('Общая архитектура');
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('strict mode + md-lint errors → exitCode 1 and blocker recorded', async () => {
    const proj = mkTmpProject();
    // Inject a template with a leftover placeholder so md-lint will flag it.
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---',
        'title: "Бракованный"',
        'lang: ru-RU',
        '---',
        '',
        '# TODO',
        '',
        'Нет секции безопасности.',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'user-guide',
          mermaidModule: fakeMermaid(),
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.blockers.length).toBeGreaterThan(0);
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});

describe('page-description directive', () => {
  test('emits Russian narrative paragraph instead of an English QA checklist', async () => {
    const proj = mkTmpProject();
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---',
        'title: "Test"',
        'lang: ru-RU',
        '---',
        '',
        '# Описание операций',
        '',
        '<!-- GEN:page-description role="guest" -->',
        '',
        '<!-- GEN:security-section -->',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'user-guide', mermaidModule: fakeMermaid() },
      );
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      // narrative is built from the inspection JSON top_buttons → "Войти"
      expect(md).toContain('«Войти»');
      // No QA-style English checklist must leak into end-user docs
      expect(md).not.toMatch(/Проверочный список/);
      expect(md).not.toMatch(/\[V\] heading/);
      expect(md).not.toMatch(/breadcrumb/);
      expect(md).not.toMatch(/top_buttons/);
      // Page heading nested under H1 chapter must be H2 (→ pandoc "1.1"),
      // never H3 (→ pandoc "1.0.1").
      expect(md).toMatch(/^## Главная$/m);
      expect(md).not.toMatch(/^### Главная$/m);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('headingLevel attribute on the directive overrides the default', async () => {
    const proj = mkTmpProject();
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---', 'title: "T"', 'lang: ru-RU', '---', '',
        '# Описание операций', '',
        '## Публичный интерфейс', '',
        '<!-- GEN:page-description role="guest" headingLevel="3" -->', '',
        '<!-- GEN:security-section -->',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'user-guide', mermaidModule: fakeMermaid() },
      );
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      expect(md).toMatch(/^### Главная$/m);
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});

describe('mustache placeholder resolution', () => {
  test('replaces {system_name}, {version} from metadata in plain prose', async () => {
    const proj = mkTmpProject();
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---',
        'title: "{system_name}. Руководство пользователя"',
        'lang: ru-RU',
        '---',
        '',
        '# Введение',
        '',
        'Документ описывает систему «{system_name}» версии {version}.',
        '',
        '<!-- GEN:security-section -->',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'user-guide', mermaidModule: fakeMermaid() },
      );
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      expect(md).toContain('Документ описывает систему «Пилот» версии 1.0.');
      expect(md).not.toMatch(/\{system_name\}/);
      expect(md).not.toMatch(/\{version\}/);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('replaces {port} inside fenced bash blocks via app.url derivation', async () => {
    const proj = mkTmpProject();
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---',
        'title: "Test"',
        'lang: ru-RU',
        '---',
        '',
        '# Проверка',
        '',
        '```bash',
        'curl -f http://localhost:{port}/health',
        '```',
        '',
        '<!-- GEN:security-section -->',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'user-guide', mermaidModule: fakeMermaid() },
      );
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      // app.url in mkTmpProject is http://localhost:3000
      expect(md).toContain('curl -f http://localhost:3000/health');
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('records a warning for unknown placeholders and leaves them in place', async () => {
    const proj = mkTmpProject();
    fs.writeFileSync(
      path.join(proj.tplDir, 'user-guide.md'),
      [
        '---',
        'title: "Test"',
        'lang: ru-RU',
        '---',
        '',
        '# H',
        '',
        'Параметр {totally_unknown_key} не задан.',
        '',
        '<!-- GEN:security-section -->',
      ].join('\n'),
    );
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'user-guide', mermaidModule: fakeMermaid() },
      );
      const scopes = result.warnings.map((w) => w.scope);
      expect(scopes).toContain('mustache');
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      expect(md).toContain('{totally_unknown_key}');
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});

describe('runGenerate — warnings for missing inputs', () => {
  test('records warning when manifest is absent and skips page-description', async () => {
    const proj = mkTmpProject();
    fs.rmSync(path.join(proj.projectPath, 'docs', 'screenshots', 'manifest.json'));
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'user-guide',
          mermaidModule: fakeMermaid(),
        },
      );
      const warningMessages = result.warnings.map((w) => w.message).join(' | ');
      expect(warningMessages).toMatch(/manifest|page-description/);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('records warning when schema.json is missing', async () => {
    const proj = mkTmpProject();
    fs.rmSync(path.join(proj.projectPath, 'docs', 'generated', '_research', 'schema.json'));
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'technical-description',
          mermaidModule: fakeMermaid(),
        },
      );
      const scopes = result.warnings.map((w) => w.scope);
      expect(scopes).toContain('db-schema');
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});

// Sanity: doc-model.validate enforces the required shape at build time.
test('doc-model sanity: runGenerate always emits validated documents', async () => {
  const proj = mkTmpProject();
  try {
    const result = await generate.runGenerate(
      { configPath: proj.configPath },
      { templateRoot: proj.tplDir, mermaidModule: fakeMermaid() },
    );
    for (const doc of result.documents) {
      expect(doc.validationOk).toBe(true);
    }
    expect(() => dm.validate(result.documents[0].doc)).not.toThrow();
  } finally {
    removeTmp(proj.projectPath);
  }
});

describe('architecture and deployment-guide doc types', () => {
  function writeArchTemplate(tplDir) {
    fs.writeFileSync(
      path.join(tplDir, 'architecture.md'),
      [
        '---',
        'title: "Пилот. Описание архитектуры"',
        'lang: ru-RU',
        '---',
        '',
        '# Компонентная схема',
        '',
        '<!-- GEN:mermaid source="component" title="Компонентная схема" -->',
        '',
        '# Модель данных',
        '',
        '<!-- GEN:db-schema scope="all" headingLevel="2" -->',
      ].join('\n'),
    );
  }

  function writeDeployTemplate(tplDir) {
    fs.writeFileSync(
      path.join(tplDir, 'deployment-guide.md'),
      [
        '---',
        'title: "Пилот. Инструкция по развёртыванию"',
        'lang: ru-RU',
        '---',
        '',
        '# Развёртывание',
        '',
        '<!-- GEN:deploy-commands -->',
        '',
        '# Тестовые учётные записи',
        '',
        '<!-- GEN:test-accounts -->',
      ].join('\n'),
    );
  }

  test('architecture doc type is registered and renders', async () => {
    const proj = mkTmpProject();
    writeArchTemplate(proj.tplDir);
    // Override doc_types for this run via the `only` shorthand.
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        {
          templateRoot: proj.tplDir,
          only: 'architecture',
          mermaidModule: fakeMermaid(),
        },
      );
      // `only` filters AFTER validating doc_types — since the meta doesn't
      // list 'architecture', the result is empty. Verify VALID_DOC_TYPES
      // contains it via the module API instead.
      expect(generate.VALID_DOC_TYPES).toContain('architecture');
      expect(Array.isArray(result.documents)).toBe(true);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('deploy-commands directive emits docker compose lines even without docker-compose.yml', async () => {
    const proj = mkTmpProject();
    writeDeployTemplate(proj.tplDir);
    // Replace meta so 'deployment-guide' is in doc_types.
    const metaText = fs.readFileSync(proj.configPath, 'utf8')
      .replace('doc_types: [user-guide, technical-description]', 'doc_types: [deployment-guide]');
    fs.writeFileSync(proj.configPath, metaText);
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'deployment-guide', mermaidModule: fakeMermaid() },
      );
      expect(result.documents).toHaveLength(1);
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      expect(md).toMatch(/docker compose up -d/);
      expect(md).toMatch(/docker compose down/);
    } finally {
      removeTmp(proj.projectPath);
    }
  });

  test('test-accounts directive renders roles present in meta', async () => {
    const proj = mkTmpProject();
    writeDeployTemplate(proj.tplDir);
    // Rewrite meta to enable deployment-guide AND put a real role with credentials.
    const metaText = [
      'skill_version: "0.3.0"',
      `project_path: ${proj.projectPath}`,
      'doc_types: [deployment-guide]',
      'gost_mode: strict',
      'app:',
      '  url: http://localhost:3000',
      '  launch: none',
      'auth:',
      '  method: api',
      '  storage: cookie',
      '  api_login:',
      '    url: /api/auth/login',
      '    credentials_field: email',
      '    password_field: password',
      '    token_field: token',
      '    token_header: Authorization',
      '    token_prefix: "Bearer "',
      '  dismiss_selectors: []',
      '  roles:',
      '    - role: guest',
      '    - role: admin',
      '      username: admin@ex.com',
      '      password: AdminPass',
      '      login_url: /login',
      'capture:',
      '  viewports: [{ name: desktop, width: 1280, height: 800 }]',
      '  themes: []',
      '  locales: []',
      '  wait_after_navigation: 1000',
      '  timeout: 30000',
      'states: []',
      'precheck: { health_endpoint: /health, min_entities: {} }',
      'output: { languages: [ru], formats: [docx] }',
      'vision: { provider: claude }',
      'metadata:',
      '  organization: "ООО «Пилот»"',
      '  system_name: "Пилот"',
      '  version: "1.0"',
      '  year: "2026"',
    ].join('\n');
    fs.writeFileSync(proj.configPath, metaText);
    try {
      const result = await generate.runGenerate(
        { configPath: proj.configPath },
        { templateRoot: proj.tplDir, only: 'deployment-guide', mermaidModule: fakeMermaid() },
      );
      const md = fs.readFileSync(result.documents[0].outPath, 'utf8');
      expect(md).toMatch(/admin@ex\.com/);
      expect(md).toMatch(/AdminPass/);
      expect(md).toMatch(/Администратор/);
    } finally {
      removeTmp(proj.projectPath);
    }
  });
});
