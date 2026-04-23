# Changelog

All notable changes to gen-docs are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/) — PATCH for fixes, MINOR for features, MAJOR for breaking meta.yaml changes.

## [Unreleased]

## [0.3.0] — Unreleased

Rework from a linear 4-phase flow to a 7-phase pipeline with structured Doc-Model
intermediates, stack-agnostic adapters, and blocking precheck. See `ROADMAP.md`
for the full phased plan and acceptance criteria.

### Phase 7A — REPORT.md builder + duplicate detection (this release)

#### Added
- `scripts/lib/file-hash.js` — SHA-256 file hashing with
  `sha256Buffer / sha256File / detectDuplicates`. Cheap but exact:
  identical-byte screenshots (e.g. every auth-required route silently
  re-shooting the login page) are grouped by hash. Residual "similar
  but not identical" cases are caught by the Phase 5 `is_login_form`
  flag.
- `scripts/lib/report.js` — pure `buildReport` that assembles a
  Markdown summary from manifest, coverage, inspections, duplicates,
  md-lint results, and output documents. Sections: overview,
  documents, coverage per role, blockers, gaps/warnings, suspicious
  shots (authed roles landing on login), duplicate groups,
  AI-generated markdown in sources, markdown-lint errors. Russian and
  English locales.
- 22 new jest tests covering file-hash dedupe + missing-file handling,
  every REPORT section (ru/en), blockers / warnings / suspicious /
  duplicates / md-lint integration. 434 tests total, all green.

### Phase 6B — Mermaid adapter, security section, journey renderer (earlier in this release)

#### Added
- `scripts/adapters/mermaid.js` — renders Mermaid diagrams via
  `mermaid-cli` (`mmdc`) subprocess when available; when missing or on
  failure, returns a Doc-Model code element with `lang: "mermaid"` so
  the plaintext diagram still appears in the document and a warning is
  recorded. Availability check is cached per process.
- `scripts/lib/security-recommendations.js` — builds a Doc-Model
  section with role-specific security recommendations. Four document
  types: user-guide (passwords / phishing / public Wi-Fi), admin-guide
  (MFA / least privilege / audit log / key rotation), operator-guide
  (env isolation / backups / incident response), technical-description
  (TLS / encryption at rest / RBAC / input validation / audit log).
  Russian and English content.
- `scripts/lib/journey-render.js` — converts a validated journey into
  a Doc-Model section with numbered "Шаг N — description" paragraphs
  interleaved with figure elements for steps marked
  `screenshot: true`. `renderJourneysSection` wraps all journeys in a
  parent "Примеры использования / Usage scenarios" section.
- 28 new jest tests covering mermaid rendering happy path + fallback
  + cache, all four security doc types in ru/en, journey rendering
  with capture matching and step-description fallbacks. 417 tests
  total, all green.

### Phase 6A — Doc-Model + Markdown renderer + pre-pandoc linter (earlier in this release)

#### Added
- `scripts/lib/doc-model.js` — structured intermediate document
  representation. Sections with discriminated-union elements
  (paragraph, figure, table, admonition, checklist-result, code, raw).
  Zod-validated. Helpers `newDocument`, `newSection`, `addSection`,
  `addElement`, `walkSections`, `countElements`, `slugify` (Cyrillic
  transliteration included).
- `scripts/lib/doc-model-md.js` — GOST-compliant Markdown renderer:
  YAML frontmatter, headings without manual numbers (pandoc fills in),
  figures numbered "Рисунок N.M — Caption" per top-level section
  (English: "Figure N.M"), tables with pandoc caption syntax, checklist
  rendering, admonition blockquotes, no horizontal rules / emoji /
  triple-newline runs. Language selected from `document.lang`.
- `scripts/lib/md-lint.js` — pre-pandoc linter. Flags stray `AGENT:`,
  `TODO`, `FIXME`, `XXX`, and `<!--` placeholders (errors); broken image
  refs (errors); manifest captures not referenced in the document
  (warnings); H2 sections below minimum word count (warnings).
  `minWordsPerH2` and `excluded[]` are configurable.
- 32 new jest tests covering doc-model element validation, walking,
  slugify, markdown rendering with figure/table numbering per section,
  admonitions, checklists, English locale, heading levels, and every
  linter category. 389 tests total, all green.

### Phase 5B — Vision provider + inspector CLI (earlier in this release)

#### Added
- `scripts/adapters/vision/openai.js` — gpt-4o vision adapter. POSTs a
  multimodal message (text prompt + base64 image_url) to
  `https://api.openai.com/v1/chat/completions`. Reads `OPENAI_API_KEY`
  from env, supports explicit override via `opts.apiKey` for tests.
  `response_format: { type: 'json_object' }` by default. Never echoes
  the key.
- `scripts/ui-inspector.js` — Phase 5B entry CLI. Reads manifest,
  iterates captures, dispatches per `vision.provider`:
  - OpenAI: direct HTTP calls, writes JSONs via inspection-store
  - Claude: writes `_inspection/_pending.jsonl` for the SKILL
    orchestrator to iterate via Agent tool
  Collects warnings for `is_login_form=true` in authenticated roles.
- 21 new jest tests covering gpt-4o payload shape, fenced JSON handling,
  HTTP/error paths, and the inspector orchestration with mocked fetch
  + tmp manifest. 357 tests total, all green.

### Phase 5A — UI inspection modules (earlier in this release)

#### Added
- `scripts/lib/inspection-schema.js` — Zod schema for per-screenshot JSON
  (title, breadcrumb, layout, top_buttons, filters, table with columns /
  row_actions / bulk_actions / pagination, modals_visible, is_login_form /
  is_error_page / is_empty_state, component_kind_notes). `extractJson`
  helper tolerates fenced / wrapped model output.
- `scripts/lib/inspection-store.js` — disk mirror of capture paths:
  `docs/screenshots/<role>/<viewport>/<locale>/X.png` →
  `docs/generated/_inspection/<role>/<viewport>/<locale>/X.json`. Provides
  `read / write / exists / listAll` plus safe path resolution.
- `scripts/lib/inspection-prompt.js` — pure builder for the vision
  prompt. Same template for Claude and OpenAI; adds component-kind hints
  for Builder / Editor / Wizard / Constructor / Designer / Composer
  surfaces; role-aware guidance for is_login_form flagging; ru/en.
- 23 new jest tests covering schema validation, extractJson tolerance,
  disk roundtrip, prompt language + component variants, role hints. 339
  tests total, all green.

### Phase 4B — Research integration (earlier in this release)

#### Added
- `scripts/lib/schema-model.js` — Zod-validated normalised schema shape
  (tables, columns, foreign keys, indexes) plus `buildMarkdown` emitter
  with ru/en locales and GOST-style column+FK+index sections.
- `scripts/adapters/schema/detect.js` — framework autodetect walking
  markers for Prisma, Alembic, Django, Knex, TypeORM, Sequelize; reports
  whether a v0.3 parser is available.
- `scripts/adapters/schema/prisma.js` — full Prisma schema parser
  handling models, scalar fields, @id / @unique / @default / @map,
  @relation-based foreign keys, and @@index / @@unique / @@map block
  attributes. Manual char-by-char attribute scanner supports nested
  parens like `@default(autoincrement())`.
- `scripts/adapters/schema/pg-dump.js` — live-DB extractor that runs
  `pg_dump --schema-only` via `child_process.spawn` (no shell) and parses
  CREATE TABLE / ALTER TABLE / CREATE INDEX output into the normalised
  shape.
- `scripts/adapters/schema/index.js` — dispatcher: detect -> parser; if
  parser absent, emits a --live-db hint; `--live-db` overrides detection
  entirely.
- `scripts/adapters/openapi.js` — OpenAPI 3.x + Swagger 2.0 loader
  (local file only) that normalises endpoints into a flat list and
  emits a Markdown section grouped by tag with parameter and response
  tables.
- `scripts/research.js` — Phase 4 orchestrator CLI that reads every
  `*.summary.json`, aggregates coverage, applies the NFR policy, invokes
  schema and OpenAPI adapters where no agent contributed, scans
  `_research/*.md` for AI-artifact markers, and writes `coverage.json`.
  In strict mode it exits non-zero when NFR blockers are present.
- 49 new jest tests covering the normalised schema model, framework
  autodetect, Prisma parser corner cases, pg_dump output parsing,
  OpenAPI normalisation + Markdown rendering, and the research
  orchestrator end-to-end with tmp directories. 316 tests total, all
  green.

### Phase 4A — Research policy modules (earlier in this release)

#### Added
- `scripts/lib/ai-artifact-filter.js` — detects markdown files produced by
  LLM tooling so they are not cited in formal documentation. Classifies by
  filename pattern (`TECHNICAL_SPECIFICATION.md`, `ARCHITECTURE_GUIDELINES.md`,
  `GENERATED_*.md`, ...), footer markers (`Generated with [Claude Code]`,
  `Co-Authored-By: Claude`), and characteristic AI phrasing. Returns a
  `{ is_ai_artifact, confidence, reasons }` verdict per file and a
  `partition(sources)` helper.
- `scripts/lib/research-result.js` — Zod schema for per-agent summary.json
  files (coverage, files, warnings) plus an `aggregate(summaries)` reducer
  that collapses multi-agent results into a single coverage overview with
  missing-section list.
- `scripts/lib/nfr-policy.js` — applies the strict vs lite NFR policy to an
  aggregated coverage report. Strict mode: missing NFR sections emit a
  placeholder directive and a validation blocker (no fabricated numbers).
  Lite mode: placeholder + warning, publication proceeds. Placeholders are
  localised (Russian default, English via `opts.lang: 'en'`).
- 34 new jest tests covering filename / footer / phrasing detection,
  coverage aggregation across agents, strict vs lite policy branches, and
  language selection. 267 tests total, all green.

### Phase 3B — Capture execution (earlier in this release)

#### Added
- `scripts/lib/action-executor.js` — runs `actions[]` sequences against a
  Playwright page (click / fill / wait_for / wait_ms / screenshot). Errors
  are collected per-step rather than thrown. Screenshot hook is injected by
  the orchestrator so the executor itself stays pure.
- `scripts/lib/list-scrape.js` — DOM fallback for id resolution: uses
  configurable `rowSelector` + `idAttribute`, falls back to inline `id`,
  then to last segment of row `href`. All failures are soft (null return).
- `scripts/plan-capture.js` — entry script that emits
  `docs/generated/_captures/plan.json` from meta.yaml + journeys.yaml +
  component-detector shots. `--dry-run` prints a summary without writing.
- `scripts/capture.js` — Phase 3B orchestrator replacing the legacy
  `screenshot.js`. Groups tuples by `(role, viewport, theme, locale)`,
  prepares a Playwright context per group via the Phase 2 auth adapter,
  runs the blocking post-login healthcheck, resolves parametrized URLs,
  applies dismiss selectors, runs action sequences, and writes manifest v2.
- 26 new jest tests covering action executor happy path + error isolation,
  list-scrape fallback chain, plan-capture augmentation and summary output.

#### Changed
- Legacy `screenshot.js` is preserved untouched for v0.2 compatibility but
  new projects default to `capture.js`.

### Phase 3A — Capture planning (earlier in this release)

#### Added
- `scripts/lib/routes.js` — parse + substitute parametrized routes across
  four dialects (Express `:id`, Next.js `[id]`, Next.js catch-all `[...slug]`,
  Django `<int:id>`). Handles URL encoding, optional `:id?`, and inference of
  the collection path for list endpoints
- `scripts/adapters/id-resolver.js` — fallback chain for real id resolution:
  explicit `parametrize` override, `GET <list>?limit=1` with dotted idPath,
  list_scrape with configurable row selector. Pure planner — execution lives
  in Phase 3B
- `scripts/lib/manifest.js` — Zod schema for manifest v2 with per-capture
  axes (role, viewport, theme, locale, state, action_sequence, component_kind,
  journey). Filename builder sanitises unsafe characters and collapses missing
  axes
- `scripts/lib/matrix.js` — `buildMatrix` generates the deterministic capture
  plan: roles × viewports × themes × locales × states × pages, plus journey
  steps. Guest roles skip `auth_required` pages; filename-based dedupe folds
  duplicate component+page entries
- `scripts/lib/journeys.js` — loader and Zod schema for `journeys.yaml`
  (separate file, resolved via `meta.journeys_file`). Steps are normalised
  with stable ids `<journey>__<02d>`
- `scripts/adapters/component-detector/scanner.js` — walks the project for
  `*Builder|*Editor|*Wizard|*Constructor|*Designer|*Composer` files, joins
  them with route literals nearby in router/URLconf files, and suggests three
  capture shots per component (empty / in-progress / done)
- `meta.yaml` schema extended: `pages[]` with `actions[]`, `apply_states`,
  `component_kind`, `parametrize`, `list_endpoint`, `list_selector`,
  `id_attribute`, `dismiss`
- 78 new jest tests covering route parsing, id resolution, manifest, journey
  loading/validation, component detection, matrix generation

### Phase 2 — Auth v2 (earlier in this release)

#### Added
- `scripts/adapters/auth/` — stack-agnostic auth adapter:
  - `api.js` — API-login primary path: POST to `role.api_endpoint`, token
    extraction with `token_key` + autodetect (`access_token`, `accessToken`,
    `jwt`, `token`, `id_token`), nested body support
  - `storage.js` — storage autodetect (cookie / localStorage / sessionStorage
    / mixed) and `context.addInitScript` builder that seeds tokens before the
    first navigation
  - `form.js` — form-login fallback extracted from legacy `screenshot.js`;
    always emits a "less reliable than API-login" warning
  - `healthcheck.js` — blocking post-login verifier (URL ≠ login, token in
    storage, `GET <healthcheck_path>` returns 2xx; adds Authorization Bearer
    header for non-cookie storage)
  - `index.js` — registry exposing `selectAdapter`, `apiLoginRequest`,
    `preparePlaywrightContext`, `verifyAuth`
- `scripts/adapters/role-discovery/scanner.js` — scan seeders, enums, RBAC
  configs, and route files for roles and login endpoints; returns candidates
  with confidence levels (`high`, `medium`, `low`)
- `scripts/lib/dismiss.js` — `applyDismiss(page, selectors)` clicks cookie
  banners / intro tours / toast stacks with a short visibility window and
  never aborts capture on failure; `mergeSelectors` combines global + per-page
- New `meta.yaml` fields under `auth`: `fallback_to_form`, `default_login_url`,
  `healthcheck_path`, `authorization_scheme`; per-role `login_method`,
  `login_headers`, `login_body`, `username_key`
- 68 new jest tests covering storage detection, API login with mocked fetch,
  form login with mocked Playwright, healthcheck verification, dismiss
  behaviour, role discovery scanner

#### Changed
- `precheck.checkAuthLogin` now delegates to the auth adapter's
  `apiLoginRequest` instead of duplicating fetch logic. Form-method roles are
  reported as `deferred — form-login verified during capture phase`.

### Phase 1 — Foundation (earlier in this release)

#### Added
- Isolated skill sandbox: `skills/gen-docs/package.json` with pinned `playwright@1.59.1`,
  `zod@3.23.8`, `yaml@2.6.1`; `node_modules/` and browser cache live inside the skill
- `scripts/bootstrap.js` — idempotent `npm ci` + `playwright install chromium`
  into `.playwright-cache/`; `--check` exits 0 only when runtime is ready
- `scripts/precheck.js` — blocking env verification (baseUrl, `/health`,
  api-login per role, min-entity thresholds) with concrete remediation hints
- `scripts/lib/meta.js` — Zod schema for v0.3 `meta.yaml` and automatic
  migration from v0.2 shape (logs every change, never asks user to rewrite)
- `scripts/lib/cli.js` — single CLI parser covering `--yes`, `--only`,
  `--skip-screenshots`, `--rerun-screenshots`, `--dry-run`, `--live-db`,
  `--vision-provider`, `--lang`, `--config`
- `scripts/lib/cache.js` — content-hash research cache under
  `docs/generated/_research/.cache/`, invalidated automatically on input change
- `ROADMAP.md` at repo root — full 8-phase plan with acceptance criteria and
  mapping back to the 9-category review
- 54 new jest tests covering meta migration, CLI parsing, cache hashing, and
  precheck mocking

#### Changed
- Skill version banner moved to v0.3.0-dev in `SKILL.md`
- `meta.yaml` shape expanded: top-level `app_url`/`app_launch` now under
  `app.*`; top-level `auth_roles` now under `auth.roles` with explicit `method`
  and `storage`; new blocks for `capture`, `states`, `precheck`, `output`,
  `vision`. Old files are auto-migrated on load.
- Repo-root `package.json` now only carries dev deps; runtime deps moved to
  the skill sandbox. `npm test` runs `bootstrap --check` as a pretest.

## [0.2.0] - 2026-04-14

### Added
- Multi-role authentication support with parallel Playwright `BrowserContext` per role
- Automatic route probing: guest browser pass detects `public` vs `auth_required` routes
- Per-role screenshot folders: `screenshots/{role}/` (guest, admin, user, etc.)
- `auth_roles` section in `meta.yaml` — credentials per role with auto-detection of form fields
- `skill_version` field in `meta.yaml` — tracks which skill version generated the file
- Auto-add `meta.yaml` to project `.gitignore` to prevent credential leaks
- Version compatibility check: warns when loading `meta.yaml` from older skill version
- Extended `manifest.json`: now includes `role` and `access` fields per screenshot
- Q5-auth interactive questions block in Phase 1 parameter collection

### Changed
- `screenshotter` agent prompt updated for multi-role config format
- `screenshot.js` refactored: `authenticate()` now takes `BrowserContext`, parallel sessions via `Promise.all`
- `captureScreenshot()` now accepts `role` parameter, saves into role subdirectory
- Output structure: `screenshots/` now contains `{role}/` subdirectories

## [0.1.0] - 2026-04-14

### Added
- Initial release: GOST-compliant documentation generator
- Four document types: User Guide, Admin Guide, Operator Guide, Technical Description
- Two GOST modes: strict (Times New Roman, full formatting) and lite (Arial, simplified)
- Parallel subagents: doc-researcher + spec-reader
- Playwright screenshot automation via `screenshot.js`
- Pandoc DOCX conversion with reference templates (`reference-strict.docx`, `reference-lite.docx`)
- Post-processing script for table borders, cell indents, figure alignment
- Single-user authentication support in screenshotter
- `meta.yaml` for saving and reusing generation parameters
