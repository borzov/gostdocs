'use strict';

/**
 * meta.yaml v0.3 schema, migration, and I/O.
 *
 * - schema:   Zod schema describing the full v0.3 shape
 * - validate: throw on shape errors, return typed clone on success
 * - migrate:  accept any prior version (currently v0.2), return { data, log }
 * - load:     read file -> migrate -> validate (atomic, idempotent)
 * - save:     write YAML with stable ordering, add to .gitignore if unsafe
 */

const fs = require('fs');
const path = require('path');

function resolveModule(name) {
  return require(path.resolve(__dirname, '..', '..', 'node_modules', name));
}

const { z } = resolveModule('zod');
const YAML = resolveModule('yaml');

const CURRENT_VERSION = '0.3.0';

const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const roleSchema = z.object({
  role: z.string().min(1),
  credentials: z.null().optional(),

  // URL of the human login form (form-login or for URL healthcheck paths).
  login_url: z.string().optional(),

  // API login endpoint + request shaping for auth.method=api.
  api_endpoint: z.string().optional(),
  login_method: z.string().optional(),
  login_headers: z.record(z.string()).optional(),
  login_body: z.record(z.any()).optional(),
  username_key: z.string().optional(),

  // Credentials.
  username: z.string().optional(),
  password: z.string().optional(),

  // Token extraction + storage hints.
  token_key: z.string().optional(),

  // Form-login overrides (null = auto-detect).
  username_field: z.string().nullable().optional(),
  password_field: z.string().nullable().optional(),
  submit_button: z.string().nullable().optional(),
});

const schema = z
  .object({
    skill_version: z.string().default(CURRENT_VERSION),
    project_path: z.string().min(1),
    spec_path: z.string().nullable().optional(),
    doc_types: z.array(z.string()).min(1),
    gost_mode: z.enum(['strict', 'lite']),

    app: z.object({
      url: z.string().url().or(z.string().regex(/^https?:\/\//)),
      launch: z.enum(['docker', 'url', 'none']).default('url'),
    }),

    auth: z
      .object({
        method: z.enum(['api', 'form', 'none']).default('none'),
        storage: z
          .enum(['auto', 'cookie', 'localStorage', 'sessionStorage', 'mixed'])
          .default('auto'),
        dismiss_selectors: z.array(z.string()).default([]),
        fallback_to_form: z.boolean().default(false),
        default_login_url: z.string().optional(),
        healthcheck_path: z.string().nullable().optional(),
        authorization_scheme: z.string().default('Bearer'),
        roles: z.array(roleSchema).default([]),
      })
      .default({
        method: 'none',
        storage: 'auto',
        dismiss_selectors: [],
        fallback_to_form: false,
        authorization_scheme: 'Bearer',
        roles: [],
      }),

    capture: z
      .object({
        viewports: z
          .array(viewportSchema)
          .default([{ name: 'desktop', width: 1280, height: 800 }]),
        themes: z.array(z.string()).default([]),
        locales: z.array(z.string()).default([]),
        wait_after_navigation: z.number().int().nonnegative().default(2000),
        timeout: z.number().int().positive().default(30000),
      })
      .default({
        viewports: [{ name: 'desktop', width: 1280, height: 800 }],
        themes: [],
        locales: [],
        wait_after_navigation: 2000,
        timeout: 30000,
      }),

    states: z.array(z.enum(['empty', 'error', 'permission-denied'])).default([]),
    journeys_file: z.string().nullable().optional(),

    precheck: z
      .object({
        health_endpoint: z.string().nullable().optional(),
        min_entities: z.record(z.number().int().nonnegative()).default({}),
      })
      .default({ min_entities: {} }),

    output: z
      .object({
        languages: z.array(z.string()).min(1).default(['ru']),
        formats: z.array(z.enum(['docx'])).default(['docx']),
      })
      .default({ languages: ['ru'], formats: ['docx'] }),

    metadata: z
      .object({
        organization: z.string().optional(),
        system_name: z.string().optional(),
        doc_code: z.string().optional(),
        version: z.string().optional(),
        city: z.string().optional(),
        year: z.string().optional(),
        responsible: z.string().optional(),
      })
      .default({}),

    vision: z
      .object({
        provider: z.enum(['claude', 'openai']).default('claude'),
      })
      .default({ provider: 'claude' }),
  })
  .strict();

/**
 * Compare two semver-ish strings. Returns -1, 0, 1.
 * Follows semver: a version without a prerelease tag is greater than the same
 * version with one (e.g. 0.3.0 > 0.3.0-dev).
 */
function semverCompare(a, b) {
  const [mainA, preA = null] = String(a).split('-', 2);
  const [mainB, preB = null] = String(b).split('-', 2);
  const pa = mainA.split('.').map((s) => Number(s) || 0);
  const pb = mainB.split('.').map((s) => Number(s) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  if (preA === preB) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  return preA < preB ? -1 : preA > preB ? 1 : 0;
}

/**
 * Migrate a meta object of any prior version to v0.3 shape.
 * @param {Record<string, unknown>} raw
 * @returns {{ data: Record<string, unknown>, log: string[] }}
 */
function migrate(raw) {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('meta.yaml root must be a mapping');
  }
  const input = { ...raw };
  const log = [];
  const current = input.skill_version;

  if (!current || semverCompare(current, '0.3.0') < 0) {
    // Top-level app_url / app_launch -> app.*
    if (input.app_url || input.app_launch) {
      input.app = {
        url: input.app_url || (input.app && input.app.url),
        launch: input.app_launch || (input.app && input.app.launch) || 'url',
      };
      delete input.app_url;
      delete input.app_launch;
      log.push('moved app_url/app_launch into app.*');
    }

    // Top-level auth_roles -> auth.roles with method=form (v0.2 only supported form-login)
    if (Array.isArray(input.auth_roles)) {
      input.auth = {
        method: 'form',
        storage: 'cookie',
        dismiss_selectors: [],
        roles: input.auth_roles,
      };
      delete input.auth_roles;
      log.push('wrapped auth_roles into auth.* with method=form, storage=cookie');
    }

    // Default blocks expected by v0.3 but absent in v0.2
    if (!input.capture) {
      input.capture = {
        viewports: [{ name: 'desktop', width: 1280, height: 800 }],
        themes: [],
        locales: [],
        wait_after_navigation: 2000,
        timeout: 30000,
      };
      log.push('initialised capture block with desktop-only defaults');
    }
    if (!input.output) {
      input.output = { languages: ['ru'], formats: ['docx'] };
      log.push('initialised output block with ru-only docx');
    }
    if (!input.vision) {
      input.vision = { provider: 'claude' };
      log.push('initialised vision.provider=claude');
    }
    if (!input.precheck) {
      input.precheck = { min_entities: {} };
      log.push('initialised precheck block with empty min_entities');
    }
    if (!input.states) input.states = [];
    if (!input.auth) {
      input.auth = { method: 'none', storage: 'auto', dismiss_selectors: [], roles: [] };
    }

    input.skill_version = CURRENT_VERSION;
    log.push(`skill_version set to ${CURRENT_VERSION}`);
  }

  return { data: input, log };
}

/** @param {unknown} obj */
function validate(obj) {
  return schema.parse(obj);
}

/** Read meta.yaml, migrate if needed, validate. Returns { data, log }. */
function load(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw);
  const migrated = migrate(parsed || {});
  const data = validate(migrated.data);
  return { data, log: migrated.log };
}

/** Write meta object as YAML with stable key order. */
function save(filePath, obj) {
  const validated = validate(obj);
  const out = YAML.stringify(validated, { lineWidth: 0 });
  fs.writeFileSync(filePath, out, 'utf8');
}

module.exports = {
  CURRENT_VERSION,
  schema,
  migrate,
  validate,
  load,
  save,
  semverCompare,
};
