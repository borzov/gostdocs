# gen-docs v0.3 — Roadmap

Working plan for the rework from v0.2 (linear 4-phase) to v0.3 (7-phase graph with structured intermediates).
All phases must stay stack-agnostic: project-specific logic lives in adapters with autodetect and manual override.

Decisions locked on 2026-04-22:

- Vision provider: Claude default; OpenAI gpt-4o via `OPENAI_API_KEY` is user-prompted opt-in
- Multi-language: translate Doc-Model JSON once; do not rerun generation per language
- Mermaid: graceful fallback if `mermaid-cli` is missing, warning in REPORT
- Journeys: separate `journeys.yaml`, not embedded in meta.yaml
- DB schema: migration parsing primary, `pg_dump --schema-only` fallback via `--live-db`
- GOST validator: blocking in strict, warning-only in lite
- meta.yaml v0.2 → v0.3: automatic with migration log

## Pipeline (new)

```
1. precheck       env / app / API / roles / seed              blocking
2. research       code + specs + DB schema + openapi          files + coverage
3. plan-capture   routes x roles x viewports x themes x locales x states x journeys
4. capture        Playwright + API-login + dismiss + actions
5. ui-inspection  vision agent - JSON per screenshot
6. generation     Doc-Model JSON - Markdown - DOCX
7. validation     md-lint + docx-lint + pHash - REPORT.md
```

## Doc-Model

Between research/inspection and Markdown: structured JSON (sections, paragraphs, figures, tables, admonitions, checklist results). Markdown renderer is dumb. Enables multi-language by translation, structural validation, incremental rebuild.

## Adapters

| Adapter | Concerns | Autodetect signals |
|---|---|---|
| auth-adapter | api-login / session / oauth-dev / form-fallback | route names containing `auth|login|session|token`, package deps |
| role-discovery-adapter | seeders, enums, RBAC tables | files named `*seeder*`, `*roles*`, migration columns |
| schema-adapter | export tables with fields, types, FK | prisma / knex / alembic / django / typeorm / sqlalchemy / pg_dump |
| openapi-adapter | OpenAPI -> Markdown | `openapi.{json,yaml}`, `/api/docs`, `swagger.json` |
| i18n-adapter | UI locales | `i18next`, `vue-i18n`, Laravel translations |
| theme-adapter | theme switch | `next-themes`, `prefers-color-scheme`, DOM heuristic |

## Phase 1 - Foundation (done)

Maps to user categories: 5.1, 5.2, 5.3, 6.3, 7.1.

- [x] skill-level `skills/gen-docs/package.json` with pinned runtime deps (playwright, zod, yaml)
- [x] `scripts/bootstrap.js` - npm ci + playwright install inside skill sandbox, idempotent
- [x] `scripts/precheck.js` - env / app / API / roles / min-entities, blocking with concrete remediation
- [x] `scripts/lib/meta.js` - Zod schema for v0.3 meta.yaml + v0.2 migration
- [x] `scripts/lib/cli.js` - single CLI parser
- [x] `scripts/lib/cache.js` - research cache by content hash
- [x] SKILL.md updated to reference phase graph + new modules
- [x] CHANGELOG.md 0.3.0 unreleased entry
- [x] Tests for meta migration, CLI parser, precheck

CLI flags: `--yes`, `--only <phase|doc>`, `--skip-screenshots`, `--rerun-screenshots <role>`, `--dry-run`, `--live-db`, `--vision-provider claude|openai`, `--lang ru,en`.

Acceptance: empty or broken project stops in precheck with concrete remediation, never proceeds to screenshots.

## Phase 2 - Auth v2 (done)

Maps to user categories: 1.1, 1.2, 1.3, 1.4.

- [x] `scripts/adapters/auth/*.js` - api-login primary + form fallback (session/oauth-dev stubs deferred)
- [x] API login via `context.addInitScript()` before first goto - storage agnostic (cookie, localStorage, sessionStorage, mixed)
- [x] Autodetect `auth_storage` from probe login
- [x] Post-login healthcheck - URL != login, token key present, `GET /me` 2xx - blocking
- [x] `role-discovery-adapter` - extract roles + login endpoint candidates from seeders / enums / RBAC / router files with confidence levels
- [x] `dismiss_selectors[]` ready — applied by capture phase once it wires `applyDismiss`
- [x] Warning in REPORT when form-login fallback is used

Acceptance: expired credentials cause healthcheck failure and skip of role; no auth-only screenshots are produced for failed role. Capture wiring moves to Phase 3.

## Phase 3 - Coverage v2

Maps to user categories: 2.1, 2.2, 2.3, 2.4, 2.5.

### Phase 3A — planning modules (done)

- [x] `scripts/lib/routes.js` — parse + substitute parametrized routes across Express / Next.js / Django dialects
- [x] `scripts/adapters/id-resolver.js` — fallback chain for real-id resolution (explicit, collection API, list scrape)
- [x] `scripts/lib/matrix.js` — `buildMatrix` generates the deterministic capture plan across all axes
- [x] `scripts/lib/manifest.js` — Zod schema for manifest v2 + filename builder
- [x] `scripts/lib/journeys.js` — loader + schema for separate `journeys.yaml`
- [x] `scripts/adapters/component-detector/scanner.js` — Builder/Editor/Wizard detection + route binding
- [x] `meta.yaml` schema extended with `pages[]` (actions, states, component_kind, parametrize)

### Phase 3B — capture integration (done)

- [x] `scripts/capture.js` — new orchestrator that consumes `plan.json` and emits manifest v2
- [x] Action executor — clicks / fills / wait_for / mark-screenshot across Playwright page
- [x] List-scrape id resolver — DOM fallback when `GET <list>?limit=1` unsupported
- [x] Wire dismiss selectors into every post-goto hook
- [x] plan-capture.js entry script that feeds capture.js
- [ ] State preparator — prepare `empty` / `error` / `permission-denied` via configured hooks (moved to Phase 3C once project-specific hooks shape is clearer)
- [ ] Retire legacy `screenshot.js` once parity validated end-to-end on a pilot project

Acceptance: `:id` routes captured with real values; modals and empty states visible in generated docs.

## Phase 4 - Research and specs

Maps to user categories: 4.1, 4.2, 8.1, 8.2, 8.3, 9.2.

### Phase 4A — policy modules (done)

- [x] Coverage-report schema: `found | missing | source | size` in
      `scripts/lib/research-result.js`, aggregator across agents
- [x] NFR-strict policy: placeholder + blocker in strict, warning in lite
      (`scripts/lib/nfr-policy.js`)
- [x] AI-artifact filter: ignore `TECHNICAL_SPECIFICATION.md`,
      `ARCHITECTURE_GUIDELINES.md`, content with AI markers
      (`scripts/lib/ai-artifact-filter.js`)

### Phase 4B — integration (done)

- [x] Subagent contract documented in SKILL.md: agents write to
      `docs/generated/_research/<agent>.md` + `<agent>.summary.json`;
      stdout returns only a short summary
- [x] `schema-adapter` autodetect + Prisma parser + `pg_dump --schema-only`
      fallback via `--live-db`. Alembic / Django / Knex / TypeORM / Sequelize
      are detected but parsers are deferred (warn to use --live-db)
- [x] `openapi-adapter` loads local OpenAPI 3.x / Swagger 2.0 and emits
      Markdown tables. URL fetching deferred
- [x] `scripts/research.js` orchestrator reads summaries, aggregates,
      applies NFR policy, runs schema + openapi adapters when absent,
      scans for AI-artifact markers, writes `coverage.json`

Acceptance: strict mode rejects generation if NFR section missing and no placeholder allowed; coverage report reveals gaps before they reach DOCX.

## Phase 5 - UI-inspector (vision)

Maps to user categories: 3.2, 3.3, 6.1.

- [ ] `scripts/ui-inspector.js` - orchestrates vision pass over captured PNGs
- [ ] Vision providers: Claude (default, via skill Agent tool) and OpenAI gpt-4o (opt-in via `OPENAI_API_KEY`)
- [ ] Key setup prompt with `--vision-provider openai` - explains env var, stores in meta with redacted marker
- [ ] Per-shot JSON: `{ title, breadcrumb, layout, top_buttons, filters, table: { columns, row_actions }, modals_visible, is_login_form }`
- [ ] `is_login_form=true` on supposedly authenticated role -> warning + visual_flag in REPORT
- [ ] Extra prompt for Builder / Editor / Wizard shots - list tools and elements

Acceptance: every PNG has a matching `_inspection/<role>/<file>.json`; false-login-screen shots are flagged automatically.

## Phase 6 - Generation with Doc-Model

Maps to user categories: 3.1, 3.4, 3.5, 9.1, 9.3, 9.5.

- [ ] Doc-Model schema (sections, elements)
- [ ] Template rework - machine-readable checklist (breadcrumb, heading, menu, top buttons, filters, columns, row actions, bulk actions, pagination, empty state, modals)
- [ ] Checklist rendered as completion counter in validator
- [ ] `journeys[]` renderer - numbered "step -> figure"
- [ ] Figure numbering `Figure 4.1 - Caption` (section counter, pandoc filter or Doc-Model emitter)
- [ ] Mermaid -> PNG/SVG via `mermaid-cli`, fallback to plaintext + warning
- [ ] Security recommendations per doc role (user vs admin vs operator vs tech-description)
- [ ] Pre-pandoc lint - no leftover `AGENT:`, `TODO`, `FIXME`, `XXX`, all image refs resolve, every manifest file referenced or `excluded`, minimum word count per H2

Acceptance: linter blocks release if placeholders remain; security recommendations scoped to document type.

## Phase 7 - Validation and reporting

Maps to user categories: 6.1, 6.2, 8.4, 9.4.

- [ ] `scripts/validators/docx.py` - python-docx + OpenXML: margins, fonts, spacing, title page, stamp (strict)
- [ ] pHash visual dedupe + login-form similarity -> warning list
- [ ] `REPORT.md` - documents sizes + pages, routes coverage X/Y, roles coverage, warnings, blocker list with remediation

Acceptance: strict mode blocks publish if DOCX deviates from GOST; REPORT.md lists every gap the user needs to act on.

## Phase 8 - UX and postprocess

Maps to user categories: 7.2, 7.3, 7.4.

- [ ] Metadata autofill - current date, version from git tag / package.json / composer.json / pyproject.toml, organization from git config; manual input only for city / responsible
- [ ] `doc_languages: [ru, en, ...]` - translate Doc-Model with shared `_glossary.yaml`
- [ ] postprocess-docx: fixes split into `must-have` vs `opt-in` with flags, `--dry-run` prints applied transforms, operations logged to `_postprocess.log`

Acceptance: `--yes` with autofilled metadata produces identical docs to interactive mode; `doc_languages: [ru, en]` yields two DOCX per document with consistent terminology.

## Mapping back to user's 9-category review

| Category | Phase |
|---|---|
| 1 Auth | Phase 2 |
| 2 Coverage | Phase 3 |
| 3 Depth and quality | Phase 5 + Phase 6 |
| 4 Research agents | Phase 4 |
| 5 Runtime | Phase 1 |
| 6 Verification | Phase 7 |
| 7 Skill UX | Phase 1 (flags) + Phase 8 |
| 8 GOST specifics | Phase 4 (schema, OpenAPI, NFR) + Phase 7 (docx validator) |
| 9 Other | Phase 6 (mermaid, AI-MD filter, figure numbers, security-per-role) + Phase 7 (problem list) |

## Non-goals for v0.3

- PDF output (DOCX only)
- Non-Russian GOST analogs
- Historical diff of screenshots between versions
- Hosted web UI for the skill
