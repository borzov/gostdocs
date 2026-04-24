#!/usr/bin/env node

/**
 * Phase 6C orchestrator.
 *
 * Reads the master template for each requested doc_type, expands every
 * `<!-- GEN:* -->` directive through a deterministic expander map
 * (mermaid, schema, journey, security, page-description, metadata,
 * pagebreak, centered-block), validates the Doc-Model, renders Markdown,
 * runs the pre-pandoc lint, and writes `docs/generated/<docType>.md`.
 *
 * Agent-authored prose from the template (plain paragraphs, pipe tables,
 * fenced code) passes through as-is via the template-loader.
 *
 * Usage:
 *   node scripts/generate.js --config docs/meta.yaml
 *   node scripts/generate.js --config docs/meta.yaml --only user-guide
 *   node scripts/generate.js --config docs/meta.yaml --dry-run
 */

'use strict';

const fs = require('fs');
const path = require('path');

const metaLib = require('./lib/meta');
const manifestLib = require('./lib/manifest');
const inspectionStore = require('./lib/inspection-store');
const journeysLib = require('./lib/journeys');
const journeyRender = require('./lib/journey-render');
const security = require('./lib/security-recommendations');
const schemaModel = require('./lib/schema-model');
const nfrPolicy = require('./lib/nfr-policy');
const metadataAutofill = require('./lib/metadata-autofill');
const researchResult = require('./lib/research-result');
const mdLint = require('./lib/md-lint');
const cliLib = require('./lib/cli');
const dm = require('./lib/doc-model');
const dmMd = require('./lib/doc-model-md');
const templateLoader = require('./lib/template-loader');
const mustacheResolve = require('./lib/mustache-resolve');
const emptySectionGuard = require('./lib/empty-section-guard');
const rolesSection = require('./lib/roles-section');
const securityScan = require('./lib/security-scan');
const techSecurityExpander = require('./lib/tech-security-expander');
const scalingScan = require('./lib/scaling-scan');
const techScalingExpander = require('./lib/tech-scaling-expander');
const protocolsScan = require('./lib/protocols-scan');
const stackDetector = require('./lib/stack-detector');
const pageNarrative = require('./lib/page-narrative');
const projectIntrospect = require('./lib/project-introspect');
const mermaidAdapter = require('./adapters/mermaid');
const openapiAdapter = require('./adapters/openapi');
const diagramsLib = require('./lib/diagrams');
const roleModelRender = require('./lib/role-model-render');
const bootstrapExports = require('./bootstrap');

const DEFAULT_TEMPLATE_ROOT = path.join(bootstrapExports.SKILL_DIR, 'templates');
const VALID_DOC_TYPES = [
  'user-guide',
  'admin-guide',
  'operator-guide',
  'technical-description',
];

const DOC_TITLES = {
  ru: {
    'user-guide':            'Руководство пользователя',
    'admin-guide':           'Руководство администратора',
    'operator-guide':        'Руководство оператора',
    'technical-description': 'Техническое описание',
  },
  en: {
    'user-guide':            'User Guide',
    'admin-guide':           'Administrator Guide',
    'operator-guide':        'Operator Guide',
    'technical-description': 'Technical Description',
  },
};

function buildTitlePageElement(docType, ctx) {
  const lang = ctx.lang === 'en' ? 'en' : 'ru';
  const m = ctx.metadata || {};
  const documentTitle = DOC_TITLES[lang][docType] || docType;
  return {
    type: 'title-page',
    organization: m.organization || null,
    approved_by: m.approved_by || null,
    document_title: documentTitle,
    system_name: m.system_name || null,
    doc_code: m.doc_code || null,
    version: m.version || null,
    city: m.city || null,
    year: m.year || String(new Date().getFullYear()),
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readResearchMarkdown(researchDir) {
  if (!fs.existsSync(researchDir)) return {};
  const out = {};
  for (const name of fs.readdirSync(researchDir)) {
    if (!name.endsWith('.md')) continue;
    const stem = name.replace(/\.md$/, '');
    try {
      out[stem] = fs.readFileSync(path.join(researchDir, name), 'utf8');
    } catch {
      /* skip unreadable files */
    }
  }
  return out;
}

function resolveProjectPath(meta, configPath) {
  if (meta && meta.project_path) return meta.project_path;
  if (configPath) return path.dirname(path.dirname(path.resolve(configPath)));
  return process.cwd();
}

function resolveLang(meta, opts) {
  const explicit = opts && Array.isArray(opts.langs) ? opts.langs[0] : null;
  const first = (meta && meta.output && meta.output.languages) || ['ru'];
  const pick = (explicit || first[0] || 'ru').toLowerCase();
  return pick.startsWith('en') ? 'en' : 'ru';
}

function extractMermaidSourceFromResearch(sourceName, researchMd) {
  const direct = researchMd[`${sourceName}.mmd`];
  if (direct) return direct.trim();
  const md = researchMd[sourceName];
  if (!md) return null;
  const match = md.match(/```mermaid\s*\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function resolveImageRef(captureFile) {
  if (!captureFile) return '';
  if (captureFile.startsWith('screenshots/') || path.isAbsolute(captureFile)) return captureFile;
  return `screenshots/${captureFile}`;
}

function buildPageDescriptionElement(capture, inspection, opts = {}) {
  // Prefer the human-curated `capture.title` from meta.yaml — it is in the
  // target document language and reflects the author's intent ("Главная
  // страница платформы"), whereas `inspection.title` echoes the literal H1
  // shown in the screenshot (often a dev placeholder like "Event
  // Management System") and would leak English into a Russian guide.
  const element = {
    type: 'page-description',
    page_id: capture.id,
    title: capture.title || (inspection && inspection.title) || capture.id,
    file: resolveImageRef(capture.file),
    description: null,
    checklist: [],
  };
  if (opts.level && Number(opts.level) > 0) {
    element.level = Number(opts.level);
  }
  if (opts.narrative) {
    element.narrative = opts.narrative;
  }
  return element;
}

function findInspectionForCapture(inspectionsByFile, captureFile) {
  return inspectionsByFile.get(captureFile) || null;
}

function pushWarning(ctx, scope, message) {
  ctx.warnings.push({ scope, message });
}

async function buildContext(cfg, opts = {}) {
  const configPath = cfg.configPath || path.join(process.cwd(), 'docs', 'meta.yaml');
  const metaLoaded = cfg.meta ? { data: cfg.meta, log: [] } : metaLib.load(configPath);
  const meta = metaLoaded.data;

  const projectPath = resolveProjectPath(meta, configPath);
  const docsDir = path.join(projectPath, 'docs');
  const manifestPath = path.join(docsDir, 'screenshots', 'manifest.json');
  const researchDir = path.join(docsDir, 'generated', '_research');

  const warnings = [];
  const blockers = [];

  let manifest = { version: '2.0', base_url: meta.app?.url || '', captures: [], roles: [], errors: [], warnings: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = manifestLib.read(manifestPath);
    } catch (err) {
      warnings.push({ scope: 'manifest', message: `invalid manifest.json: ${err.message}` });
    }
  } else {
    warnings.push({ scope: 'manifest', message: 'manifest.json not found; skipping page-description expansion' });
  }

  const inspectionEntries = inspectionStore.listAll(projectPath);
  const inspectionsByFile = new Map();
  for (const entry of inspectionEntries) {
    if (entry && entry.data && entry.data.file) {
      inspectionsByFile.set(entry.data.file, entry.data);
    }
  }

  let journeysFile = { journeys: [] };
  if (meta.journeys_file) {
    const jp = path.resolve(projectPath, meta.journeys_file);
    if (fs.existsSync(jp)) {
      try {
        journeysFile = journeysLib.load(jp);
      } catch (err) {
        warnings.push({ scope: 'journeys', message: `failed to load journeys: ${err.message}` });
      }
    }
  }

  const coverage = readJsonIfExists(path.join(researchDir, 'coverage.json'));
  const researchMd = readResearchMarkdown(researchDir);

  const rawSchema = readJsonIfExists(path.join(researchDir, 'schema.json'));
  let schema = null;
  if (rawSchema) {
    try {
      schema = schemaModel.validate(rawSchema);
    } catch (err) {
      warnings.push({ scope: 'db-schema', message: `invalid schema.json: ${err.message}` });
    }
  }

  // Load the normalised OpenAPI document produced by the research step.
  // Absent specs are not an error — the endpoints-detail expander simply
  // becomes a no-op with a warning in that case.
  const openapiDoc = readJsonIfExists(path.join(researchDir, 'openapi.json'));

  // Two-stage derivation:
  //   1. deriveContextDefaults — sync, parses meta.app.url for port / system_url
  //      and meta.project_path for project_dir. Always runs, even in unit tests.
  //   2. project-introspect — async, scans the actual project tree for
  //      framework / db_* / service_name / migration_command / seed_command /
  //      repo_url. Skipped when opts.skipIntrospect is true (unit-test escape).
  const derivedMetadata = {
    year: String(new Date().getFullYear()),
    ...metadataAutofill.deriveContextDefaults({ app: meta.app, project_path: projectPath }),
  };
  let introspect = { framework: null, derived: {}, sources: {} };
  if (!opts.skipIntrospect) {
    try {
      introspect = await projectIntrospect.deriveProjectMetadata(projectPath, opts.introspectOpts || {});
      Object.assign(derivedMetadata, introspect.derived);
    } catch (err) {
      warnings.push({ scope: 'introspect', message: `project introspect failed: ${err.message}` });
    }
  }
  const { merged: metadata } = metadataAutofill.mergeMetadata(meta.metadata || {}, derivedMetadata);

  const lang = resolveLang(meta, opts);
  const templateRoot = opts.templateRoot
    || path.join(DEFAULT_TEMPLATE_ROOT, `gost-${meta.gost_mode || 'strict'}`);

  const mermaidModule = opts.mermaidModule || mermaidAdapter;
  const mermaidBin = opts.mermaidBin || mermaidAdapter.resolveMmdcBin();
  const puppeteerConfigPath = opts.puppeteerConfigPath
    || (typeof bootstrapExports.puppeteerConfigPath === 'function'
      ? bootstrapExports.puppeteerConfigPath()
      : null);

  return {
    configPath,
    meta,
    metaLog: metaLoaded.log || [],
    projectPath,
    docsDir,
    researchDir,
    manifest,
    inspections: inspectionsByFile,
    journeysFile,
    coverage,
    researchMd,
    schema,
    openapi: openapiDoc,
    metadata,
    lang,
    templateRoot,
    resourcePath: docsDir,
    warnings,
    blockers,
    mermaidModule,
    mermaidBin,
    puppeteerConfigPath,
    docType: null,
    introspect,
  };
}

function buildExpanders(ctx) {
  return {
    metadata: (attrs) => {
      const value = ctx.metadata[attrs.key];
      if (value === undefined || value === null || value === '') {
        pushWarning(ctx, 'metadata', `missing metadata key: ${attrs.key}`);
        return null;
      }
      return { type: 'paragraph', text: String(value) };
    },

    pagebreak: () => ({ type: 'raw', format: 'markdown', content: '\\pagebreak' }),
    'centered-block': () => ({ type: 'raw', format: 'markdown', content: '::: {.center}' }),
    'end-centered': () => ({ type: 'raw', format: 'markdown', content: ':::' }),

    'db-schema': (attrs) => {
      if (!ctx.schema) {
        pushWarning(ctx, 'db-schema', 'no _research/schema.json available; DB section will be empty');
        return null;
      }
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 3;
      const md = schemaModel.buildMarkdown(ctx.schema, { headingLevel, lang: ctx.lang });
      if (!md) return null;
      return { type: 'raw', format: 'markdown', content: md };
    },

    'endpoints-detail': (attrs) => {
      if (!ctx.openapi || !Array.isArray(ctx.openapi.endpoints) || ctx.openapi.endpoints.length === 0) {
        pushWarning(ctx, 'endpoints-detail', 'no _research/openapi.json available; endpoint detail section will be empty');
        return null;
      }
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 3;
      const md = openapiAdapter.buildMarkdown(ctx.openapi, { headingLevel, lang: ctx.lang });
      if (!md) return null;
      return { type: 'raw', format: 'markdown', content: md };
    },

    'role-activities': (attrs) => {
      const roleModel = (ctx.coverage && ctx.coverage.aggregate && ctx.coverage.aggregate.role_model)
        || (ctx.coverage && ctx.coverage.role_model)
        || null;
      if (!attrs.role) {
        pushWarning(ctx, 'role-activities', 'GEN:role-activities missing required "role" attribute');
        return null;
      }
      return roleModelRender.buildRoleActivities(roleModel, { role: attrs.role, lang: ctx.lang });
    },

    'rbac-matrix': () => {
      const matrix = (ctx.coverage && ctx.coverage.aggregate && ctx.coverage.aggregate.rbac_matrix)
        || (ctx.coverage && ctx.coverage.rbac_matrix)
        || null;
      const roleModel = (ctx.coverage && ctx.coverage.aggregate && ctx.coverage.aggregate.role_model)
        || (ctx.coverage && ctx.coverage.role_model)
        || null;
      const roleLabels = {};
      if (Array.isArray(roleModel)) {
        for (const entry of roleModel) {
          if (entry && entry.role && entry.label) roleLabels[entry.role] = entry.label;
        }
      }
      return roleModelRender.buildRbacMatrix(matrix, { lang: ctx.lang, roleLabels });
    },

    'security-section': () => {
      const docType = ctx.docType;
      if (!docType || !security.VALID_DOC_TYPES.includes(docType)) {
        pushWarning(ctx, 'security', `security-section cannot build for docType=${docType}`);
        return null;
      }
      const section = security.buildSection(docType, { lang: ctx.lang, level: 1 });
      return { kind: 'section', section };
    },

    journey: (attrs) => {
      const filtered = {
        journeys: (ctx.journeysFile.journeys || []).filter((j) => {
          if (attrs.role && j.role !== attrs.role) return false;
          if (attrs.name && j.name !== attrs.name) return false;
          return true;
        }),
      };
      // No journeys defined — leave the template as-is instead of emitting
      // an extra "Примеры использования" section that would duplicate the
      // author's own heading and dilute the manual scenario prose.
      if (filtered.journeys.length === 0) {
        pushWarning(ctx, 'journey', `no journeys matched attrs ${JSON.stringify(attrs)}; skipping section`);
        return null;
      }
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 1;
      const section = journeyRender.renderJourneysSection(filtered, ctx.manifest, {
        lang: ctx.lang,
        headingLevel,
      });
      return { kind: 'section', section };
    },

    'page-description': (attrs) => {
      const captures = ctx.manifest.captures || [];
      if (captures.length === 0) {
        pushWarning(ctx, 'page-description', 'no captures in manifest; skipping page-description');
        return null;
      }

      const filter = (c) => {
        if (attrs.page_id && c.id !== attrs.page_id) return false;
        if (attrs.role && c.role !== attrs.role) return false;
        return true;
      };
      const matching = captures.filter(filter);
      if (matching.length === 0) {
        pushWarning(ctx, 'page-description', `no captures matched page-description attrs: ${JSON.stringify(attrs)}`);
        return null;
      }

      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 2;

      return matching.map((capture) => {
        const inspection = findInspectionForCapture(ctx.inspections, capture.file);
        if (!inspection) {
          pushWarning(ctx, 'page-description', `missing inspection JSON for capture: ${capture.file}`);
        }
        const narrative = pageNarrative.buildPageNarrative(inspection || {}, ctx.lang, {
          warnings: ctx.warnings,
          file: capture.file,
        });
        return buildPageDescriptionElement(capture, inspection || {}, {
          level: headingLevel,
          narrative,
        });
      });
    },

    mermaid: async (attrs) => {
      let source = extractMermaidSourceFromResearch(attrs.source, ctx.researchMd);
      // Automatic fallback: synthesize a diagram when the template asked
      // for one of the well-known sources but no hand-written diagram
      // shipped with the research corpus. Each synthesiser returns null
      // when the input research is too sparse to build a meaningful image,
      // and in that case we fall back to the generic "source missing"
      // warning so the reader gets an explicit placeholder instead of a
      // misleading half-empty diagram.
      const sourceKey = String(attrs.source || '').toLowerCase();
      if (!source && /^(erd|er[-_]?diagram|entity[-_]?relationship)$/.test(sourceKey)) {
        const synthesised = ctx.schema ? schemaModel.buildErdMermaid(ctx.schema) : null;
        if (synthesised) {
          source = synthesised;
          pushWarning(ctx, 'mermaid', `ERD synthesised from schema for source="${attrs.source}"`);
        }
      }
      if (!source && /^(auth|auth[-_]?sequence|login[-_]?sequence)$/.test(sourceKey)) {
        const scan = ctx.securityScan || securityScan.scanSecurity(ctx.projectPath);
        ctx.securityScan = scan;
        const synthesised = diagramsLib.buildAuthSequenceMermaid(scan, { lang: ctx.lang });
        if (synthesised) {
          source = synthesised;
          pushWarning(ctx, 'mermaid', `auth sequence synthesised from security scan for source="${attrs.source}"`);
        }
      }
      if (!source && /^(component|component[-_]?diagram|components|topology)$/.test(sourceKey)) {
        const scalingScanResult = ctx.scalingScan || scalingScan.scanScaling(ctx.projectPath);
        ctx.scalingScan = scalingScanResult;
        const securityScanResult = ctx.securityScan || securityScan.scanSecurity(ctx.projectPath);
        ctx.securityScan = securityScanResult;
        const protocolRows = ctx.protocolsScanRows
          || (ctx.protocolsScanRows = protocolsScan.scanProtocols(ctx.projectPath, { lang: ctx.lang }));
        const synthesised = diagramsLib.buildComponentDiagramMermaid({
          stack: ctx.stack || null,
          scalingScan: scalingScanResult,
          securityScan: securityScanResult,
          protocolsScan: protocolRows,
        }, { lang: ctx.lang });
        if (synthesised) {
          source = synthesised;
          pushWarning(ctx, 'mermaid', `component diagram synthesised for source="${attrs.source}"`);
        }
      }
      if (!source && /^(dataflow|data[-_]?flow)$/.test(sourceKey)) {
        const protocolRows = ctx.protocolsScanRows
          || (ctx.protocolsScanRows = protocolsScan.scanProtocols(ctx.projectPath, { lang: ctx.lang }));
        const synthesised = diagramsLib.buildDataFlowMermaid({
          schema: ctx.schema,
          protocolsScan: protocolRows,
        }, { lang: ctx.lang });
        if (synthesised) {
          source = synthesised;
          pushWarning(ctx, 'mermaid', `data-flow diagram synthesised for source="${attrs.source}"`);
        }
      }
      if (!source) {
        pushWarning(ctx, 'mermaid', `no diagram source found for source="${attrs.source}"`);
        return null;
      }
      const caption = attrs.title || attrs.source;
      const outPath = path.join(ctx.docsDir, 'generated', '_diagrams', `${attrs.source}.png`);
      const { element, warnings } = await ctx.mermaidModule.renderToDocModelElement(
        { source, caption, outPath },
        { binPath: ctx.mermaidBin, puppeteerConfigPath: ctx.puppeteerConfigPath },
      );
      for (const w of warnings) pushWarning(ctx, 'mermaid', w);
      if (element && element.type === 'figure' && element.file) {
        const relative = path.relative(ctx.resourcePath, element.file);
        element.file = relative.startsWith('..') ? element.file : relative;
      }
      return element;
    },

    'tech-security': (attrs) => {
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 2;
      const scan = ctx.securityScan || securityScan.scanSecurity(ctx.projectPath);
      ctx.securityScan = scan;
      // When research subagents emitted concrete `security_facts`, pass
      // them through so the expander renders specific prose (JWT scheme,
      // bcrypt cost, TLS version) instead of the generic framework blurb.
      const facts = (ctx.coverage && ctx.coverage.aggregate && ctx.coverage.aggregate.security_facts)
        || (ctx.coverage && ctx.coverage.security_facts)
        || null;
      const sections = techSecurityExpander.buildTechSecurity(scan, {
        lang: ctx.lang,
        headingLevel,
        facts,
      });
      return sections.map((s) => ({ kind: 'section', section: s }));
    },

    'tech-stack-table': () => {
      const framework = ctx.introspect && ctx.introspect.framework;
      const stack = stackDetector.detectStack(ctx.projectPath, { framework });
      ctx.stack = stack;
      const lang = ctx.lang === 'en' ? 'en' : 'ru';
      const L = lang === 'en'
        ? { cat: 'Category', tech: 'Technology', ver: 'Version', purpose: 'Purpose',
            lang: 'Programming language', fw: 'Framework', db: 'Database',
            container: 'Containerisation', orchestr: 'Orchestration',
            purpose_lang: 'Server-side logic', purpose_fw: 'Web framework',
            purpose_db: 'Data storage', purpose_docker: 'Containerisation',
            purpose_compose: 'Container orchestration',
            unknown: 'to be confirmed' }
        : { cat: 'Категория', tech: 'Технология', ver: 'Версия', purpose: 'Назначение',
            lang: 'Язык программирования', fw: 'Фреймворк', db: 'База данных',
            container: 'Контейнеризация', orchestr: 'Оркестрация',
            purpose_lang: 'Серверная логика', purpose_fw: 'Веб-фреймворк',
            purpose_db: 'Хранение данных', purpose_docker: 'Развёртывание',
            purpose_compose: 'Управление контейнерами',
            unknown: 'подлежит уточнению' };
      const cell = (v) => (v === null || v === undefined || v === '') ? L.unknown : String(v);
      const rows = [
        [L.lang, cell(stack.language), cell(stack.language_version), L.purpose_lang],
        [L.fw,   cell(stack.framework), cell(stack.framework_version), L.purpose_fw],
        [L.db,   cell(stack.db_engine), cell(stack.db_version), L.purpose_db],
        [L.container, 'Docker', L.unknown, L.purpose_docker],
        [L.orchestr,  'Docker Compose', L.unknown, L.purpose_compose],
      ];
      return {
        type: 'table',
        caption: lang === 'en' ? 'Technology stack' : 'Стек используемых технологий',
        headers: [L.cat, L.tech, L.ver, L.purpose],
        rows,
      };
    },

    'tech-components': () => {
      const framework = ctx.introspect && ctx.introspect.framework;
      const stack = ctx.stack || stackDetector.detectStack(ctx.projectPath, { framework });
      ctx.stack = stack;
      const lang = ctx.lang === 'en' ? 'en' : 'ru';
      const L = lang === 'en'
        ? {
          app_title: 'Application server',
          db_title: 'Database',
          tech: '**Technology:**',
          port: '**Port:**',
          purpose: '**Purpose:**',
          depends: '**Depends on:**',
          unknown: 'to be confirmed',
          app_purpose: 'Business logic, REST API, serving client requests.',
          db_purpose: 'Persistent storage of application state, referential integrity.',
          db_dep: 'application server (connection pool).',
          app_dep: 'database.',
        }
        : {
          app_title: 'Сервер приложения',
          db_title: 'База данных',
          tech: '**Технология:**',
          port: '**Порты:**',
          purpose: '**Назначение:**',
          depends: '**Зависимости:**',
          unknown: 'подлежит уточнению',
          app_purpose: 'обработка бизнес-логики, предоставление REST API, обслуживание клиентских запросов.',
          db_purpose: 'хранение данных системы, обеспечение целостности и консистентности данных.',
          db_dep: 'сервер приложения (пул соединений).',
          app_dep: 'база данных.',
        };
      const show = (v) => (v === null || v === undefined || v === '') ? L.unknown : String(v);

      const appTech = [stack.language, stack.language_version].filter(Boolean).join(' ')
        + (stack.framework ? ` + ${stack.framework}${stack.framework_version ? ' ' + stack.framework_version : ''}` : '');
      const dbTech = [stack.db_engine, stack.db_version].filter(Boolean).join(' ');

      const appSection = {
        heading: L.app_title,
        level: 3,
        slug: 'server-app',
        elements: [
          { type: 'paragraph', text: `${L.tech} ${appTech.trim() || L.unknown}` },
          { type: 'paragraph', text: `${L.port} ${show(stack.runtime_port)}` },
          { type: 'paragraph', text: `${L.purpose} ${L.app_purpose}` },
          { type: 'paragraph', text: `${L.depends} ${L.app_dep}` },
        ],
        children: [],
      };
      const dbSection = {
        heading: L.db_title,
        level: 3,
        slug: 'server-db',
        elements: [
          { type: 'paragraph', text: `${L.tech} ${dbTech || L.unknown}` },
          { type: 'paragraph', text: `${L.purpose} ${L.db_purpose}` },
          { type: 'paragraph', text: `${L.depends} ${L.db_dep}` },
        ],
        children: [],
      };
      return [
        { kind: 'section', section: appSection },
        { kind: 'section', section: dbSection },
      ];
    },

    'protocols-table': () => {
      const rows = protocolsScan.scanProtocols(ctx.projectPath, { lang: ctx.lang });
      if (!rows || rows.length === 0) {
        pushWarning(ctx, 'protocols-table', 'no protocols detected in project');
        return null;
      }
      const headers = ctx.lang === 'en'
        ? ['Source', 'Target', 'Protocol', 'Format']
        : ['Компонент-источник', 'Компонент-приёмник', 'Протокол', 'Формат данных'];
      return {
        type: 'table',
        caption: ctx.lang === 'en' ? 'Application protocols and data formats' : 'Протоколы и форматы данных приложения',
        headers,
        rows: rows.map((r) => [r.source, r.target, r.protocol, r.format]),
      };
    },

    'tech-scaling': (attrs) => {
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 2;
      const scan = ctx.scalingScan || scalingScan.scanScaling(ctx.projectPath);
      ctx.scalingScan = scan;
      const sections = techScalingExpander.buildTechScaling(scan, {
        lang: ctx.lang,
        headingLevel,
      });
      return sections.map((s) => ({ kind: 'section', section: s }));
    },

    'roles-section': (attrs) => {
      const headingLevel = Number(attrs.headingLevel) > 0 ? Number(attrs.headingLevel) : 3;
      const researchMd = (ctx.researchMd && ctx.researchMd['role-discovery']) || '';
      // Prefer the structured role_model (activities/functions/limits arrays)
      // produced by the role-discovery subagent; fall back to parsing the
      // free-form research markdown when the agent did not emit it.
      const roleModel = (ctx.coverage && ctx.coverage.aggregate && ctx.coverage.aggregate.role_model)
        || (ctx.coverage && ctx.coverage.role_model)
        || null;
      const sections = rolesSection.buildRolesSections(ctx.meta, researchMd, {
        lang: ctx.lang,
        headingLevel,
        roleModel,
      });
      if (sections.length === 0) {
        pushWarning(ctx, 'roles-section', 'no roles defined in meta.auth.roles; skipping per-role subsections');
        return null;
      }
      return sections.map((s) => ({ kind: 'section', section: s }));
    },

    include: async (attrs) => {
      if (attrs.template !== 'title-page') {
        pushWarning(ctx, 'template', `include: unknown sub-template ${attrs.template}`);
        return null;
      }
      const tplPath = path.join(ctx.templateRoot, 'title-page.md');
      if (!fs.existsSync(tplPath)) return null;
      const subSkeleton = templateLoader.loadTemplate(tplPath);
      const expanders = buildExpanders(ctx);
      const subDoc = await templateLoader.expandSkeleton(subSkeleton, expanders, ctx);
      return subDoc.sections.map((s) => ({ kind: 'section', section: s }));
    },
  };
}

function filterDocTypes(requested, only) {
  const list = Array.isArray(requested) ? requested : [];
  const validated = list.filter((d) => VALID_DOC_TYPES.includes(d));
  if (!only || only === 'all') return validated;
  return validated.filter((d) => d === only);
}

function resolveTemplate(ctx, docType) {
  return path.join(ctx.templateRoot, `${docType}.md`);
}

async function generateOne(docType, ctx, opts) {
  const templatePath = resolveTemplate(ctx, docType);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`template not found for docType="${docType}": ${templatePath}`);
  }
  // Resolve `{key}` placeholders against ctx.metadata BEFORE the loader
  // tokenises the template — otherwise tokens would survive into the
  // emitted Markdown and require ad-hoc post-processing.
  const rawTemplate = fs.readFileSync(templatePath, 'utf8');
  const resolvedTemplate = mustacheResolve.resolveMustache(rawTemplate, ctx.metadata, {
    expandInsideCode: true,
    onUnknown: (key, line) =>
      pushWarning(ctx, 'mustache', `unresolved {${key}} at ${path.basename(templatePath)}:${line}`),
  });
  const skeleton = templateLoader.parseTemplate(resolvedTemplate);

  ctx.docType = docType;
  const expanders = buildExpanders(ctx);
  const doc = await templateLoader.expandSkeleton(skeleton, expanders, ctx);

  // GOST title page — always the first preamble element, followed by the
  // explicit TOC marker. We emit the TOC ourselves (raw OpenXML field) rather
  // than relying on pandoc `--toc`, because pandoc's built-in TOC is forced
  // to the very top of the DOCX and would land ABOVE the title page.
  // Metadata fields on the title page are nullable; the renderer only emits
  // lines for values that are present.
  const tocTitle = ctx.lang === 'en' ? 'Table of Contents' : 'Содержание';
  doc.preamble.unshift(
    buildTitlePageElement(docType, ctx),
    { type: 'toc', title: tocTitle, depth: 3 },
  );

  // NFR policy — strict mode emits blockers for missing NFR sections.
  if (ctx.coverage) {
    const nfr = nfrPolicy.applyNfrPolicy(ctx.coverage, ctx.meta.gost_mode, { lang: ctx.lang });
    if (Array.isArray(nfr.warnings)) ctx.warnings.push(...nfr.warnings);
    if (Array.isArray(nfr.blockers)) ctx.blockers.push(...nfr.blockers);
    if (Array.isArray(nfr.directives) && nfr.directives.length > 0) {
      const nfrSection = dm.newSection({
        heading: ctx.lang === 'en' ? 'Non-functional requirements' : 'Нефункциональные требования',
        level: 1,
      });
      for (const d of nfr.directives) {
        nfrSection.elements.push({ type: 'paragraph', text: d.placeholder || String(d.text || '') });
      }
      doc.sections.push(nfrSection);
    }
  }

  // Security fallback — ensure every doc has a security section.
  // Deep walk: template authors may nest `<!-- GEN:security-section -->`
  // inside a sub-section; a shallow check would miss it and the fallback
  // would push a second copy on top-level, producing visible duplicates.
  const securitySlug = `security-${docType}`;
  const hasSecurity = (function hasSectionBySlug(sections, slug) {
    for (const s of sections || []) {
      if (s.slug === slug) return true;
      if (s.children && hasSectionBySlug(s.children, slug)) return true;
    }
    return false;
  })(doc.sections, securitySlug);
  if (!hasSecurity) {
    doc.sections.push(security.buildSection(docType, { lang: ctx.lang, level: 1 }));
  }

  // Empty-section guard — insert placeholders and record strict blockers
  // BEFORE validation and markdown rendering so the downstream lint sees
  // content-bearing paragraphs instead of bare headings.
  emptySectionGuard.applyEmptySectionGuard(doc, ctx);

  let validationOk = false;
  try {
    dm.validate(doc);
    validationOk = true;
  } catch (err) {
    ctx.blockers.push({ scope: `doc-model:${docType}`, message: err.message });
  }

  const md = dmMd.render(doc);

  const manifestFiles = (ctx.manifest.captures || []).map((c) => c.file);
  const fileExists = (ref) => {
    const absolute = path.isAbsolute(ref) ? ref : path.resolve(ctx.resourcePath, ref);
    return fs.existsSync(absolute);
  };
  const lint = mdLint.lintMarkdown(md, {
    manifestFiles,
    fileExists,
    excluded: ctx.meta.generate?.exclude_manifest_files || [],
    lang: ctx.lang,
  });

  if (ctx.meta.gost_mode === 'strict' && lint.errors > 0) {
    ctx.blockers.push({
      scope: `md-lint:${docType}`,
      message: `${lint.errors} lint error(s); first: ${lint.issues.find((i) => i.severity === 'error')?.message}`,
    });
  }

  let outPath = null;
  if (!opts.dryRun) {
    outPath = path.join(ctx.projectPath, 'docs', 'generated', `${docType}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
  }

  return {
    docType,
    outPath,
    bytes: md.length,
    errors: lint.errors,
    warnings: lint.warnings,
    issues: lint.issues,
    validationOk,
    doc,
  };
}

async function runGenerate(cfg, opts = {}) {
  const ctx = await buildContext(cfg, opts);
  if (ctx.introspect && ctx.introspect.framework) {
    process.stderr.write(`[introspect] framework=${ctx.introspect.framework}; derived ${Object.keys(ctx.introspect.derived).length} keys\n`);
  }
  for (const line of ctx.metaLog) process.stderr.write(`[meta] ${line}\n`);

  const docTypes = filterDocTypes(ctx.meta.doc_types, opts.only);
  const documents = [];
  for (const docType of docTypes) {
    documents.push(await generateOne(docType, ctx, opts));
  }

  const strictBlocked = ctx.meta.gost_mode === 'strict' && ctx.blockers.length > 0;
  return {
    documents,
    warnings: ctx.warnings,
    blockers: ctx.blockers,
    exitCode: strictBlocked ? 1 : 0,
  };
}

function formatSummary(result) {
  const bytes = result.documents.reduce((acc, d) => acc + (d.bytes || 0), 0);
  const kib = (bytes / 1024).toFixed(1);
  const lines = [
    `[generate] wrote ${result.documents.length} docs (${kib} KiB) | ${result.warnings.length} warnings | ${result.blockers.length} blockers`,
  ];
  // Group blockers by scope so repeated findings (e.g. a dozen empty
  // sections) show up as a single line with a count.
  const byScope = new Map();
  for (const b of result.blockers || []) {
    byScope.set(b.scope, (byScope.get(b.scope) || 0) + 1);
  }
  if (byScope.size > 0) {
    const breakdown = [...byScope.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([scope, count]) => `${scope}=${count}`)
      .join(', ');
    lines.push(`[generate] blockers by scope: ${breakdown}`);
  }
  return lines.join('\n');
}

async function main() {
  const cli = cliLib.parseArgs(process.argv.slice(2));
  cliLib.assertConsistent(cli);
  if (cli.help) {
    process.stdout.write(cliLib.help ? cliLib.help() : 'node scripts/generate.js --config docs/meta.yaml\n');
    return 0;
  }

  const configPath = cli.config || path.join(process.cwd(), 'docs', 'meta.yaml');
  const opts = {
    only: cli.only,
    dryRun: cli.dryRun,
    langs: cli.langs,
    skipGenerateMermaid: cli.extras.includes('--skip-generate-mermaid'),
  };

  const result = await runGenerate({ configPath }, opts);

  for (const w of result.warnings) {
    process.stderr.write(`[warn] ${w.scope}: ${w.message}\n`);
  }
  for (const b of result.blockers) {
    process.stderr.write(`[block] ${b.scope}: ${b.message}\n`);
  }
  process.stdout.write(`${formatSummary(result)}\n`);
  return result.exitCode;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code || 0),
    (err) => {
      process.stderr.write(`[generate] fatal: ${err.stack || err.message}\n`);
      process.exit(1);
    },
  );
}

module.exports = {
  runGenerate,
  buildContext,
  buildExpanders,
  generateOne,
  filterDocTypes,
  VALID_DOC_TYPES,
  formatSummary,
  main,
};
