# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **Claude Code skill** (not an application) that generates GOST-compliant documentation — user/admin/operator guides and technical descriptions — for information systems. It is shipped as a plugin and installed under `~/.claude/skills/gen-docs/`. Active rework: **v0.3** replaces the linear 4-phase flow with a 7-phase graph; legacy v0.2 `screenshot.js` is kept as fallback until the new `capture.js` path is validated end-to-end.

The "app" is the skill runtime under `skills/gen-docs/`; the repo root mostly hosts tests, docs, and the outer `package.json` that delegates to it.

## Commands

All commands run from the repo root unless noted. `pretest` auto-runs bootstrap if the sandbox is missing.

```bash
# One-time runtime sandbox install (pinned Playwright + Chromium + mmdc + zod + yaml
# into skills/gen-docs/node_modules and skills/gen-docs/.playwright-cache)
npm run bootstrap                      # install if missing
node skills/gen-docs/scripts/bootstrap.js --force   # force reinstall
node skills/gen-docs/scripts/bootstrap.js --check   # exit 0 if ready

# Tests
npm test                               # Jest — all JS tests under tests/**/*.test.js
npx jest tests/doc-model.test.js       # single file
npx jest -t "figure numbering"         # by test name pattern
npm run test:py                        # pytest — Python postprocess tests
pytest tests/postprocess_test.py       # single Python test file

# Pipeline entry scripts (each phase is independently runnable)
node skills/gen-docs/scripts/precheck.js      --config docs/meta.yaml
node skills/gen-docs/scripts/research.js      --config docs/meta.yaml
node skills/gen-docs/scripts/plan-capture.js  --config docs/meta.yaml
node skills/gen-docs/scripts/capture.js       --config docs/meta.yaml
node skills/gen-docs/scripts/ui-inspector.js  --config docs/meta.yaml
node skills/gen-docs/scripts/generate.js      --config docs/meta.yaml --only user-guide
```

Shared CLI flags across entry scripts: `--yes`, `--only <phase|doc>`, `--skip-screenshots`, `--rerun-screenshots <role>`, `--dry-run`, `--live-db`, `--vision-provider claude|openai`, `--lang ru,en`. Parsed uniformly by `scripts/lib/cli.js`.

The skill is normally driven by the `SKILL.md` orchestrator (invoked as `/gen-docs` inside Claude Code), not by calling these scripts directly.

## Architecture

### Two-package layout

- **`/package.json`** — dev-only (`jest`, `playwright` for test doubles). Do not add runtime deps here.
- **`/skills/gen-docs/package.json`** — the skill's self-contained runtime sandbox (`@mermaid-js/mermaid-cli`, `playwright`, `yaml`, `zod`). Installed once by `bootstrap.js` into `skills/gen-docs/node_modules/`. Puppeteer is overridden to reuse Playwright's Chromium so we don't double-download a browser. Library code imports deps via a local helper (`require(path.resolve(__dirname, '..', '..', 'node_modules', name))`) — keep this pattern when adding new lib files, don't reach up to the repo-root `node_modules`.

### v0.3 pipeline

```
0. bootstrap       npm ci + playwright install inside skill sandbox
1. precheck        env / app / API / roles / min-entities                        blocking
2. research        code + specs + DB schema + openapi                            files + coverage
3. plan-capture    routes × roles × viewports × themes × locales × states × journeys
4. capture         Playwright + API-login + dismiss + actions (manifest v2)
5. ui-inspection   vision agent — JSON per screenshot
6. generation      Doc-Model JSON → Markdown → DOCX (pandoc) → postprocess-docx.py
7. validation      md-lint + docx-lint + pHash → REPORT.md
```

Each phase reads/writes disk and can be re-run in isolation via `--only <phase>`. Research results are cached by input-content hash (`scripts/lib/cache.js`, `file-hash.js`).

### Core modules (where to make changes)

- **Config & schema:** `scripts/lib/meta.js` — Zod schema for `meta.yaml` v0.3 + auto-migration from v0.2. Never ask users to hand-edit; extend the migration path instead.
- **Doc-Model:** `scripts/lib/doc-model.js` — structured intermediate (sections / paragraphs / figures / tables / admonitions / checklist-results / code / raw). `scripts/lib/doc-model-md.js` renders it to Markdown with per-section figure/table numbering. Add new element types here, not in templates.
- **Templates & GEN:* directives:** `templates/gost-{strict,lite}/*.md` declare structure and `<!-- GEN:* -->` hooks. `scripts/lib/template-loader.js` parses them into a skeleton; `scripts/generate.js` `buildExpanders()` maps each directive name to an adapter. Add a new directive by: (1) adding an expander in `buildExpanders()`, (2) adding fixture tests in `tests/template-loader.test.js` + `tests/generate.test.js`, (3) documenting in SKILL.md under the GEN:* catalog.
- **Adapters (stack-agnostic):** `scripts/adapters/` — autodetect + manual override. `auth/` (api-login primary, form fallback), `role-discovery/`, `schema/` (Prisma native; Alembic/Django/Knex/TypeORM/Sequelize only detect and suggest `--live-db` → `pg_dump --schema-only`), `openapi.js`, `mermaid.js` (local `mmdc` with graceful code-block fallback when unavailable), `vision/` (Claude default, OpenAI gpt-4o opt-in), `component-detector/`, `id-resolver.js`.
- **Capture:** `scripts/capture.js` consumes `plan.json` and emits manifest v2 (`scripts/lib/manifest.js`). Groups tuples by `(role, viewport, theme, locale)` for shared auth. Parametrized routes resolved via `routes.js` + `id-resolver.js` (explicit → `GET <list>?limit=1` → DOM scrape).
- **Research subagent contract:** every research agent writes `docs/generated/_research/<agent>.md` + `<agent>.summary.json` (schema in `scripts/lib/research-result.js`). The orchestrator reads from disk — agents return only a short stdout summary to keep the parent context small.
- **Policy:** `scripts/lib/nfr-policy.js` (strict blocks missing NFR sections, lite warns), `scripts/lib/ai-artifact-filter.js` (skip LLM-authored markdown in sources), `scripts/lib/md-lint.js` (pre-pandoc validation).
- **DOCX postprocess:** `scripts/postprocess-docx.py` (python-docx) — table borders, cell indents, figure numbering "Рисунок N —", GOST fonts, TOC indents, emoji replacement. Runs after `pandoc --reference-doc=templates/reference-{mode}.docx`.

### Paths & I/O conventions

User project outputs land under `<project>/docs/`:

```
docs/
  meta.yaml              # gitignored — contains passwords
  screenshots/{role}/{viewport}/{theme}/{locale}/{id}{__state}.png
  screenshots/manifest.json
  generated/_research/<agent>.md + .summary.json
  generated/_research/coverage.json
  generated/_inspection/<role>/<file>.json    # vision JSON mirrors screenshots/
  generated/_captures/plan.json
  generated/<doc-type>.md
  output/<doc_name>.docx
```

Doc-Model emits image refs **relative to `docs/`** (e.g. `screenshots/guest/desktop/home.png`); pandoc is invoked with `--resource-path=docs/` — keep this invariant when adding new figure sources.

### Strict vs lite

- **strict:** md-lint errors, missing NFR, unresolved GEN:* blockers → `exitCode = 1`. Files are still written so the user can see what is missing.
- **lite:** every blocker becomes a warning. `exitCode = 0` always.

### Multi-language

Translate the Doc-Model JSON once and render per language with a shared `_glossary.yaml`. Do NOT rerun generation end-to-end per language.

## Code conventions specific to this repo

- Runtime code is CommonJS (`'use strict'; const x = require(...)`). Match the existing style — don't introduce ESM or TypeScript without coordination.
- Runtime deps in library files are resolved via the sandbox helper (see "Two-package layout"). Tests in `tests/` can import normally.
- Unknown GEN:* directives must log into `ctx.warnings[]` and be dropped — never throw from a template expander.
- Never echo secrets (`OPENAI_API_KEY`, role passwords) to logs or stdout, even on HTTP errors (OpenAI can echo keys back in 4xx responses).
- `meta.yaml` must be auto-added to the project's `.gitignore` on first write.

## Reference

- `ROADMAP.md` — phase-by-phase acceptance criteria, locked decisions (vision provider, mermaid fallback, journeys-in-separate-file, pg_dump fallback, strict-vs-lite validator policy).
- `TASKS-v0.3-remaining.md` — current spec for Phase 6C / 7B / 8B work.
- `CHANGELOG.md` — per-phase changes for v0.3.0-dev.
- `skills/gen-docs/SKILL.md` — the skill orchestrator itself; authoritative description of GEN:* directive catalog, research subagent contract, and pandoc invocation.
