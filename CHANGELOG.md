# Changelog

All notable changes to gen-docs are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/) — PATCH for fixes, MINOR for features, MAJOR for breaking meta.yaml changes.

## [Unreleased]

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
