# Changelog

All notable changes to gen-docs are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/) — PATCH for fixes, MINOR for features, MAJOR for breaking meta.yaml changes.

## [Unreleased]

## [0.3.0] — Unreleased

Rework from a linear 4-phase flow to a 7-phase pipeline with structured Doc-Model
intermediates, stack-agnostic adapters, and blocking precheck. See `ROADMAP.md`
for the full phased plan and acceptance criteria.

### Phase 2 — Auth v2 (this release)

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
