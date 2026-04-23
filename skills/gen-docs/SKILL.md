---
name: gen-docs
description: Use when the user needs to generate formal documentation for an information system — user guides, admin guides, operator guides, or technical descriptions. Triggers on requests for GOST-compliant documentation, system manuals, or operational documentation with automatic screenshots.
---

# gen-docs: GOST-Compliant Documentation Generator

Generate formal documentation for information systems with automatic screenshots, following Russian GOST standards (RD 50-34.698-90, GOST 34.201-89, GOST R 59795-2021). **v0.3.0-dev**

> **Rework in progress.** v0.3 replaces the 4-phase linear flow with a 7-phase graph,
> structured Doc-Model intermediates, and stack-agnostic adapters. See
> [ROADMAP.md](../../ROADMAP.md) at the repository root for the phased plan and
> acceptance criteria. Sections below document the current state — legacy v0.2
> behaviour is kept as a fallback during migration.

## Pipeline (v0.3)

```
0. bootstrap       npm ci in skill sandbox + playwright install chromium
1. precheck        env / app / API / roles / min-entities                blocking
2. research        code + specs + DB schema + openapi                    files + coverage
3. plan-capture    routes x roles x viewports x themes x locales x states x journeys
4. capture         Playwright + API-login + dismiss + actions
5. ui-inspection   vision agent - JSON per screenshot
6. generation      Doc-Model JSON - Markdown - DOCX
7. validation      md-lint + docx-lint + pHash - REPORT.md
```

Each phase reads and writes to disk; any phase can be re-run in isolation via
`--only <phase>`. Research results are cached by input-content hash and reused
across runs unless inputs change.

## Sandbox and dependencies

The skill is self-contained. Runtime dependencies (Playwright + browser) live
under `skills/gen-docs/node_modules/` and `skills/gen-docs/.playwright-cache/`,
installed once by `bootstrap.js`. The skill never relies on globally installed
Playwright or Chromium.

- `scripts/bootstrap.js [--force|--check]` — install/verify sandbox
- `scripts/precheck.js --config <meta.yaml>` — run precheck phase

## UI inspection (Phase 5A)

Every PNG in the capture manifest gets a matching JSON describing the
visible interface. The Phase 6 generator consumes those JSONs to fill the
per-screen checklist (breadcrumb, top buttons, filters, columns, row
actions, modals) rather than guessing from the screenshot alone.

### Disk layout

Mirror of `docs/screenshots/`:

```
docs/screenshots/admin/desktop/ru/home.png
docs/generated/_inspection/admin/desktop/ru/home.json
```

### Subagent contract (vision pass)

After capture, for each manifest entry the orchestrator either:

1. **Claude path (default)** — invokes the `general-purpose` Agent with the
   prompt built by `scripts/lib/inspection-prompt.js`. The agent reads the
   PNG via the Read tool and returns a JSON object matching
   `scripts/lib/inspection-schema.js`.
2. **OpenAI path** — when `vision.provider=openai` and `OPENAI_API_KEY` is
   set, the same prompt is POSTed to the gpt-4o chat API with the image
   as a base64 `image_url` part. The response body is parsed by
   `inspection-schema.extractJson` (tolerates fenced / wrapped output).

Results are persisted via `scripts/lib/inspection-store.js`:
`write(projectPath, captureFile, data)`, `listAll(projectPath)` for
Phase 7 reports.

### Red-flag detection

`is_login_form=true` in an authenticated role's JSON marks the shot as a
failed capture. Phase 7 `REPORT.md` surfaces such entries so the user
sees them before opening the DOCX.

## Research and specs (Phase 4)

### Subagent contract

Every research subagent (doc-researcher, spec-reader, schema-adapter,
openapi-adapter, role-discovery, ...) MUST:

1. Write prose output to `docs/generated/_research/<agent>.md` (or several
   topic files — one per logical section).
2. Write a machine-readable `docs/generated/_research/<agent>.summary.json`
   matching the `research-result` schema:
   ```json
   {
     "version": "1.0",
     "agent": "doc-researcher",
     "generated_at": "2026-04-23T12:00:00Z",
     "coverage": [
       { "section": "ROUTES", "found": true, "source": "src/router.ts", "size": 500, "missing": [] },
       { "section": "NFR", "found": false, "source": null, "size": 0, "missing": ["hardware", "load"] }
     ],
     "files": [{ "path": "docs/generated/_research/routes.md", "section": "ROUTES", "bytes": 500 }],
     "warnings": []
   }
   ```
3. Return only a short summary to stdout (title + coverage one-liner). The
   orchestrator reads the full content from disk, not from the agent
   message — this keeps the parent context window small.

### Orchestrator

`scripts/research.js` aggregates every `*.summary.json`, applies the NFR
policy (strict blocks, lite warns), runs the schema adapter and OpenAPI
adapter when their agents did not contribute, and scans `_research/*.md`
for AI-artifact markers. Result: `docs/generated/_research/coverage.json`.

### Schema adapter

`scripts/adapters/schema/index.js` detects Prisma / Alembic / Django /
Knex / TypeORM / Sequelize markers and dispatches to a framework parser.
Only Prisma has a native parser in v0.3; other frameworks return a warning
suggesting `--live-db`, which runs `pg_dump --schema-only` via
`scripts/adapters/schema/pg-dump.js`. All parsers produce the same
normalised shape and are rendered by `scripts/lib/schema-model.js`
`buildMarkdown`.

### OpenAPI / Swagger adapter

`scripts/adapters/openapi.js` loads a local OpenAPI 3.x or Swagger 2.0
spec (`--openapi <path>`), normalises endpoints, and emits a Markdown
section grouped by tag. URL fetching is deferred; the orchestrator is
expected to download a remote spec separately and pass the local path.

### AI-artifact filter

`scripts/lib/ai-artifact-filter.js` flags markdown files whose filename
matches known auto-generated patterns (TECHNICAL_SPECIFICATION.md,
ARCHITECTURE_GUIDELINES.md, GENERATED_*.md) or whose content contains
LLM footers / typical phrasing. Flagged files are not cited by the
Phase 6 generator.

### NFR policy

`scripts/lib/nfr-policy.js` applies the strict-vs-lite decision to
aggregated coverage. In strict mode missing NFR sections emit a
placeholder directive PLUS a validation blocker that stops publication
until the section is filled in. In lite mode the placeholder is still
emitted but publication proceeds with a warning.

## Capture execution (Phase 3B)

`scripts/capture.js` is the v0.3 orchestrator, replacing the legacy monolithic
`screenshot.js`. It consumes `plan.json` and emits a manifest v2 into
`docs/screenshots/manifest.json`.

Per group of tuples that share `(role, viewport, theme, locale)`:
- Auth is prepared via `adapters/auth` (API-login primary, form fallback)
- Post-login `verifyAuth` runs; failure skips the entire group with a
  recorded error in the manifest
- For every tuple:
  1. Parametrized paths are resolved with `id-resolver` — explicit values,
     then `GET <list>?limit=1`, then DOM scrape via `list-scrape.js`
  2. `page.goto` navigates to the substituted URL
  3. `dismiss.applyDismiss` clicks cookie banners / tours (global +
     per-page)
  4. `action-executor` runs `actions[]` if present; each `screenshot: true`
     step produces a separate PNG
  5. Final screenshot is written and a manifest v2 row is upserted

Legacy `screenshot.js` is kept beside `capture.js` until the new path has
been exercised end-to-end on a representative project; migration is
one-directional (new projects use `capture.js` only).

## Capture planning (Phase 3A)

The plan-capture phase turns declarative config into a deterministic list of
capture tuples. Nothing navigates a page until the plan is emitted.

Inputs:
- `pages[]` from `meta.yaml` + routes from research + auto-shots from
  component detector (Builder/Editor/Wizard/Constructor)
- Roles, viewports, themes, locales from `meta.capture.*`
- States (`empty`, `error`, `permission-denied`) only applied to pages that set
  `apply_states: true`
- Journeys from `journeys.yaml` (separate file per architecture decision) —
  each step with `screenshot: true` becomes its own tuple

Output: a flat array under `docs/generated/_captures/plan.json` with one entry
per PNG to be captured. Each entry has a stable `tupleId`, a resolved `file`
path, and every axis value.

Parametrized routes (`/users/:id/edit`, `[id]`, `<int:id>`) are supported by
`scripts/lib/routes.js`. `scripts/adapters/id-resolver.js` emits a fallback
chain per page: explicit `parametrize` values, then `GET <list>?limit=1`,
then DOM scrape of a list page at capture time.

Manifest v2 schema is defined in `scripts/lib/manifest.js`. Filenames follow
`{role}/{viewport}/{theme}/{locale}/{id}{__state}.png` — missing axes
collapse, unsafe characters are sanitised.

## Authentication (Phase 2)

v0.3 prefers API-login over form submission:

- `auth.method: api` performs an HTTP POST to `role.api_endpoint`, extracts a
  token from the response body (configurable `token_key`, otherwise autodetects
  `access_token`, `accessToken`, `jwt`, ...), and seeds the Playwright context
  via `context.addInitScript()` before the first navigation. Cookies set by the
  login response are applied via `context.addCookies()`.
- `auth.storage: auto` detects storage at login time:
  - `set-cookie` present AND body token → `mixed`
  - only `set-cookie` → `cookie`
  - only body token → `localStorage`
- `auth.method: form` remains as fallback and raises a warning in REPORT.md.
- `auth.fallback_to_form: true` retries via form-login when api-login fails.
- `auth.healthcheck_path` is a **blocking** post-login check. After login, a
  page is navigated to the app root; three checks must pass before any
  capture runs for the role:
  1. final URL ≠ login path
  2. token key is present in the configured storage (skipped for cookies)
  3. `GET <healthcheck_path>` returns 2xx (adds `Authorization: Bearer <token>`
     for non-cookie storage)

Role and login-endpoint discovery: `scripts/adapters/role-discovery/scanner.js`
walks the project for seeders, enums, RBAC configs, and router files; returns
deduplicated role candidates + login endpoint candidates with confidence
levels. Output is advisory — users can override via meta.yaml.

Dismiss selectors: `scripts/lib/dismiss.js` clicks configured selectors with a
short visibility window, swallowing failures. Applied after every navigation
and before the screenshot. Merges `auth.dismiss_selectors` (global) with
per-page overrides (Phase 3).

## CLI flags (shared by all entry scripts)

| Flag | Effect |
|---|---|
| `--yes`, `-y` | non-interactive mode, use saved meta.yaml and defaults |
| `--config <path>` | explicit meta.yaml (default: `<project>/docs/meta.yaml`) |
| `--only <name>` | run one phase or one document type |
| `--skip-screenshots` | reuse previously captured screenshots |
| `--rerun-screenshots <role>` | recapture only the listed role (repeatable) |
| `--dry-run` | show operations without writing outputs |
| `--live-db` | allow `pg_dump` / live DB introspection (Phase 4) |
| `--vision-provider <name>` | `claude` (default) or `openai` |
| `--lang <list>` | comma-separated output languages, e.g. `ru,en` |

## Process Flow (v0.2 legacy, still active where v0.3 is not wired)

```dot
digraph gen_docs {
    rankdir=TB;
    "Collect parameters" [shape=box];
    "Load meta.yaml?" [shape=diamond];
    "Ask interactive questions" [shape=box];
    "Launch doc-researcher\n+ spec-reader (parallel)" [shape=box];
    "Launch screenshotter\n(needs route list)" [shape=box];
    "Generate Markdown\nfrom templates" [shape=box];
    "Convert to DOCX\nvia pandoc" [shape=box];
    "Save meta.yaml" [shape=box];
    "Done" [shape=doublecircle];

    "Collect parameters" -> "Load meta.yaml?";
    "Load meta.yaml?" -> "Ask interactive questions" [label="no / override"];
    "Load meta.yaml?" -> "Launch doc-researcher\n+ spec-reader (parallel)" [label="yes, reuse"];
    "Ask interactive questions" -> "Launch doc-researcher\n+ spec-reader (parallel)";
    "Launch doc-researcher\n+ spec-reader (parallel)" -> "Launch screenshotter\n(needs route list)";
    "Launch screenshotter\n(needs route list)" -> "Generate Markdown\nfrom templates";
    "Generate Markdown\nfrom templates" -> "Convert to DOCX\nvia pandoc";
    "Convert to DOCX\nvia pandoc" -> "Save meta.yaml";
    "Save meta.yaml" -> "Done";
}
```

## Phase 1: Parameter Collection

Check if `docs/meta.yaml` exists in the project. If yes, offer to reuse previous settings. Otherwise, collect parameters interactively.

### Questions to ask (via AskUserQuestion):

**Q1** (multiSelect): Which documents to generate?
- User Guide (Руководство пользователя)
- Admin Guide (Руководство администратора)
- Operator Guide (Руководство оператора)
- Technical Description (Техническое описание)

**Q2**: GOST compliance mode?
- Strict — full GOST formatting with title page, margins, fonts per GOST 2.105
- Lite — GOST section structure, simplified formatting

**Q3**: Path to codebase?
- Current directory (default)
- Specify manually

**Q4**: Specs/requirements available?
- Yes, path: ___
- No, generate from code only

**Q5**: Application for screenshots?
- Already running at URL: ___
- Launch from Docker (docker compose up)
- Skip screenshots

**Q5-auth** (shown only when screenshots are NOT skipped):

Ask: *"Does the application have sections that require authentication (login)?"*
- Yes, detect automatically
- No, everything is public → skip to Q6

If "Yes": run probe detection after Phase 2a (doc-researcher) completes and roles are identified.
Then for each detected role, ask:

> "Screenshotter detected the following roles from code analysis: {roles_list}.
> Please provide credentials for each role you want screenshots of (leave blank to skip)."

Collect per role:
- `username` (email or login)
- `password`
- `login_url` (default: `/login`)
- `username_field` CSS selector (leave blank for auto-detect)
- `password_field` CSS selector (leave blank for auto-detect)
- `submit_button` CSS selector (leave blank for auto-detect)

**Security note:** `meta.yaml` is automatically added to the project's `.gitignore`
on first write to prevent credentials from entering version control.

**Q6** (strict mode only): Title page metadata
- Organization name, system name, document code, version, city

### meta.yaml format (v0.3)

```yaml
skill_version: "0.3.0"
project_path: /path/to/project
spec_path: /path/to/specs
doc_types: [user-guide, admin-guide]
gost_mode: strict   # or lite

app:
  url: http://localhost:3000
  launch: docker    # or url or none

auth:
  method: api       # api | form | none
  storage: auto     # auto | cookie | localStorage | sessionStorage | mixed
  dismiss_selectors: [".cookie-banner", ".intro-tour-dismiss"]
  roles:
    - role: guest
      credentials: null
    - role: admin
      login_url: /login
      api_endpoint: /api/auth/login
      token_key: access_token
      username: admin@example.com
      password: "secret"
      username_field: null        # form-login fallback: null = auto-detect
      password_field: null
      submit_button: null

capture:
  viewports:
    - { name: desktop, width: 1280, height: 800 }
    - { name: mobile,  width: 390,  height: 844 }
  themes: [light, dark]           # optional; empty = skip theme matrix
  locales: [ru, en]                # optional; empty = skip locale matrix
  wait_after_navigation: 2000
  timeout: 30000

states: [empty, error, permission-denied]   # optional states matrix
journeys_file: journeys.yaml                 # optional, relative to project root

precheck:
  health_endpoint: /health
  min_entities: { users: 1, orders: 1 }

output:
  languages: [ru]                 # [ru, en] for multi-language docs
  formats: [docx]

vision:
  provider: claude                # or openai (needs OPENAI_API_KEY)

metadata:
  organization: "Company Name"
  system_name: "System Name"
  doc_code: "CODE.12345-01"
  version: "1.0"
  city: "Moscow"
  year: "2026"
```

**Migration from v0.2:** `scripts/lib/meta.js` auto-migrates older files on load —
`app_url` / `app_launch` become `app.*`; `auth_roles` is wrapped into `auth.roles`
with `method: form` and `storage: cookie` (matching v0.2 behaviour); missing
blocks are initialised with defaults. The migration log is printed to stderr.
Users are never asked to rewrite the file by hand.

## Phase 2: Research with Subagents

### Phase 2a: Parallel Research

Launch TWO agents in parallel using the Agent tool:

**Agent 1: doc-researcher**

Prompt template:
```
You are a documentation researcher. Analyze the codebase at {project_path} and extract ALL information needed for writing formal documentation.

Analyze these sources:
- docker-compose.yml, Dockerfile → services, ports, volumes, architecture
- .env.example, config files → configuration parameters with descriptions
- Routes/controllers → complete list of pages, endpoints, user-facing features
- Models/migrations → database entities and relationships
- Middleware, auth guards → authorization model, user roles
- README, CHANGELOG → system description, version history
- package.json / requirements.txt / go.mod → technology stack

Return a structured Markdown report with these sections:
1. SYSTEM OVERVIEW: name, purpose, tech stack
2. ARCHITECTURE: services, their roles, ports, interactions
3. CONFIGURATION: all parameters from .env/.config with descriptions
4. FEATURES: complete list of user-facing features grouped by module
5. ROUTES/PAGES: all routes with their purpose (for screenshot planning)
6. DATABASE: entities, key fields, relationships
7. AUTH: authentication method, roles, permissions
8. DEPLOYMENT: how to install, run, update

Be thorough. Every detail matters for documentation quality.
```

**Agent 2: spec-reader**

Prompt template:
```
You are a specification analyst. Read all documents in {spec_path} and extract structured information for documentation.

For .md files: read directly.
For .docx files: convert via `pandoc -t plain {file}` and read.
For .pdf files: convert via `pdftotext {file} -` and read.

Extract and return:
1. SYSTEM PURPOSE: official name, designation, purpose statement
2. FUNCTIONAL REQUIREMENTS: numbered list of all functions
3. USER ROLES: list of roles with their permissions
4. BUSINESS PROCESSES: key workflows the system supports
5. CONSTRAINTS: operating conditions, limitations, requirements
6. TERMS: glossary of domain-specific terms

If no spec_path provided, return empty sections with notes that info should come from code analysis.
```

### Phase 2b: Screenshots (after doc-researcher completes)

Use the route/page list from doc-researcher results to build the screenshot config.

**Agent 3: screenshotter**

Prompt template:
```
You are a screenshot automation agent. Your task is to capture screenshots of a running web application for documentation, supporting multiple user roles.

Application URL: {app_url}
Application launch: {app_launch}  (if "docker", run `docker compose up -d` in {project_path} first and wait for readiness)

Steps:
1. If app_launch is "docker":
   - Run: cd {project_path} && docker compose up -d
   - Wait up to 60 seconds, polling {app_url} every 3 seconds until it responds

2. Build screenshot config from this route list:
{routes_from_doc_researcher}

3. Configure auth_roles from meta.yaml credentials:
{auth_roles_from_meta_yaml}
   - Include role "guest" (no credentials) for public pages
   - Include each role that has credentials provided

4. Run the screenshot script:
   node {skill_path}/scripts/screenshot.js --config <config.json> --output {project_path}/docs/screenshots

   Config JSON format:
   {
     "baseUrl": "{app_url}",
     "viewport": {"width": 1280, "height": 800},
     "waitAfterNavigation": 2000,
     "timeout": 30000,
     "pages": [ {routes_as_page_objects} ],
     "auth_roles": [ {auth_roles_array} ]
   }

5. The script automatically:
   - Probes all routes in guest mode to detect which require authentication
   - Runs parallel browser sessions per role
   - Saves screenshots to {project_path}/docs/screenshots/{role}/

6. Verify all screenshots were captured. Report any auth failures.

7. Return the manifest.json content.
```

## Phase 3: Markdown Generation

For each selected document type:

1. Read the appropriate template from `templates/{gost_mode}/{doc_type}.md`
2. Read results from all three subagents
3. Read the screenshot manifest
4. Generate the full Markdown document:
   - Fill every section with real content from research results
   - Insert screenshot references: `![Рисунок — Описание](../screenshots/{filename})`
   - For strict mode: generate title page from `title-page.md` template with metadata
   - Write comprehensive, detailed content — NOT placeholder text
   - All user-facing text in Russian
   - Technical terms and code examples in English

**CRITICAL — Markdown formatting rules:**
- **DO NOT put numbers in headings.** Use `# Введение`, NOT `# 1 Введение`. Pandoc adds section numbers automatically via `--number-sections`.
- **DO NOT use `# Title` then `## Subtitle` as first two headings.** Start directly with `# Введение` as the first section. The document title comes from YAML frontmatter `title:` field.
- **Figure captions:** Use pandoc implicit_figures format: `![Рисунок — Описание](path.png)` — pandoc auto-numbers figures.
- **Table captions:** Place caption BEFORE the table using `: Описание таблицы` syntax (pandoc table caption).
- **All headings in Russian.** No English headings whatsoever.
- **NO horizontal rules.** Do NOT use `---` or `***` as section separators. They create ugly HR lines in DOCX.
- **NO emoji or special Unicode characters.** Do NOT use checkboxes (☑☐), icons, or emoji. Use plain text: `[V] Включено`, `[ ] Выключено`.
- **Bold text sparingly.** Only bold key terms on FIRST mention, button/menu names in instructions, and table header row. Do NOT bold repeated words or phrases already established in context.
- **Table headers:** The first row of every table MUST use bold. This is handled by postprocessing.
- **Table captions:** Place caption BEFORE the table using pandoc syntax: `: Таблица — Описание` on a line by itself before the table.
- **YAML frontmatter** at the top of every generated file:
  ```yaml
  ---
  title: "Название системы. Руководство пользователя"
  lang: ru-RU
  ---
  ```

**Quality requirements for generated content:**
- Each section minimum 200-500 words (except short structural sections)
- Step-by-step instructions must include numbered steps with expected results
- Every screenshot must have a descriptive caption in Russian
- Error handling sections must list specific errors with solutions
- Configuration sections must describe every parameter

Save generated files to `{project_path}/docs/generated/`.

## Phase 4: DOCX Conversion

For each generated Markdown file, run pandoc:

```bash
pandoc \
  --from markdown \
  --to docx \
  --reference-doc={skill_path}/templates/reference-{gost_mode}.docx \
  --toc --toc-depth=3 \
  --number-sections \
  -M lang=ru-RU \
  -M toc-title="Содержание" \
  --resource-path={project_path}/docs/screenshots \
  -o {project_path}/docs/output/{doc_name}.docx \
  {project_path}/docs/generated/{doc_name}.md
```

**Important pandoc flags explained:**
- `-M toc-title="Содержание"` — Russian title instead of "Table of Contents"
- `--number-sections` — automatic section numbering (1, 1.1, 1.2, etc.)
- `-M lang=ru-RU` — Russian language metadata for localization
- `--reference-doc` — applies GOST-compliant styles (fonts, margins, spacing)

**CRITICAL:** The Markdown source MUST NOT contain manual section numbers in headings. Use `# Введение`, NOT `# 1 Введение`. Pandoc `--number-sections` handles all numbering.

After pandoc conversion, run post-processing to fix table borders, cell indents, and figure alignment:

```bash
python3 {skill_path}/scripts/postprocess-docx.py {project_path}/docs/output/{doc_name}.docx
```

For lite mode (Arial font):
```bash
python3 {skill_path}/scripts/postprocess-docx.py {project_path}/docs/output/{doc_name}.docx --font "Arial"
```

Create output directory if it doesn't exist: `mkdir -p {project_path}/docs/output`

After conversion, save `meta.yaml` to `{project_path}/docs/meta.yaml` with all parameters used.

## Template Variables

Templates use these placeholders that the generator replaces:

| Placeholder | Source |
|-------------|--------|
| `{system_name}` | meta.yaml or spec-reader |
| `{system_purpose}` | spec-reader or doc-researcher |
| `{features_list}` | doc-researcher |
| `{routes}` | doc-researcher |
| `{config_params}` | doc-researcher |
| `{db_entities}` | doc-researcher |
| `{auth_model}` | doc-researcher |
| `{user_roles}` | spec-reader |
| `{tech_stack}` | doc-researcher |
| `{screenshots}` | screenshotter manifest |

## GOST Standards Reference

| Standard | What it defines |
|----------|----------------|
| RD 50-34.698-90 | Section structure for AS documentation |
| GOST 34.201-89 | Document types and nomenclature for AS |
| GOST R 59795-2021 | Modern document content requirements |
| GOST 2.105-95 / GOST R 2.105-2019 | Formatting: fonts, margins, numbering |

### Strict mode formatting (per GOST 2.105):
- Font: Times New Roman 14pt (12pt for tables)
- Margins: left 20mm, right 10mm, top 20mm, bottom 20mm
- Line spacing: 1.5
- Page numbers: bottom right
- Headings: bold, separated by blank lines
- Figures: numbered per section (Figure 4.1, Figure 4.2)
- Tables: numbered per section, caption above

## Error Handling

- **App not reachable:** Skip screenshots, generate docs without them, warn user
- **pandoc not found:** Error with install instructions (`brew install pandoc`)
- **Playwright not found:** Error with install instructions (`npm i -g @playwright/test`)
- **pdftotext not found:** Warn, skip PDF specs, suggest `brew install poppler`
- **Docker not running:** Skip docker launch, ask for manual URL
- **Spec path not found:** Warn, continue with code-only analysis

## Output

```
{project_path}/docs/
    generated/          # Markdown sources
        user-guide.md
        admin-guide.md
        operator-guide.md
        technical-description.md
    screenshots/        # Playwright captures — one subfolder per role
        guest/
            *.png
        admin/
            *.png
        user/
            *.png
        manifest.json   # All captures with role + access fields
    output/             # Final DOCX files
        user_guide.docx
        admin_guide.docx
        operator_guide.docx
        technical_description.docx
    meta.yaml           # Saved parameters for re-runs (in .gitignore — contains passwords)
```
