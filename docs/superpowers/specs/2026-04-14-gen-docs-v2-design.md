# gen-docs v2 Design Spec

**Date:** 2026-04-14  
**Version:** 0.2.0  
**Status:** Approved

---

## Summary

Extend the gen-docs skill with multi-role authentication support for the screenshotter agent.
The skill learns to automatically detect protected routes, collect credentials for each role,
run parallel browser sessions, and save screenshots per role. Also introduces a release policy
with SemVer versioning and `CHANGELOG.md`.

---

## 1. Phase 1: Parameter Collection Changes

### New questions block Q5-auth

Inserted after Q5 (app URL) when screenshots are not skipped.

**Q5-auth.1** — Are there closed sections requiring authentication?
- Yes, detect automatically
- No, everything is public

If "Yes" — **Q5-auth.2** (repeated per detected role):

> "Screenshotter detected roles: `admin`, `manager`, `user`. Enter credentials for each role (leave blank to skip)."

Per-role input form:
```
Role: admin
  login: ___
  password: ___
  login URL: ___ (default: /login)
  username field: ___ (default: auto-detect)
  password field: ___ (default: auto-detect)
  submit button: ___ (default: auto-detect)
```

Field auto-detection works via DOM analysis:
- Password field: `input[type=password]`
- Username field: nearest `input[type=text]` or `input[type=email]`
- Submit button: `button[type=submit]` or `input[type=submit]`

User provides CSS selectors only if auto-detection fails.

### meta.yaml additions

```yaml
skill_version: "0.2.0"
auth_roles:
  - role: guest
    credentials: null
  - role: admin
    login_url: /admin/login
    username: admin@example.com
    password: "secret"
    username_field: "#email"      # null = auto-detect
    password_field: "#password"   # null = auto-detect
    submit_button: null           # null = auto-detect
  - role: user
    login_url: /login
    username: user@example.com
    password: "secret"
    username_field: null
    password_field: null
    submit_button: null
```

**Security:** `meta.yaml` is automatically added to the project's `.gitignore` on first save
to prevent credentials from entering version control.

**Version compatibility:** When loading a `meta.yaml` from an older skill version,
the skill warns about the version mismatch and offers migration (add missing fields with defaults).

---

## 2. Phase 2b: Screenshotter Changes

### Three-stage process

**Stage 1 — Probe run (guest traversal)**

Opens each route from the doc-researcher list in a clean browser context (no cookies/auth).
For each route records:
- Final URL after navigation (if different from requested → redirect detected)
- Presence of `input[type=password]` in the DOM

Result: mapping `route → access: "public" | "auth_required"`.

**Stage 2 — Parallel role sessions**

One `BrowserContext` per role, all started simultaneously via `Promise.all`.

Each context:
1. Opens `login_url`, fills the form (auto-detect or specified selectors), clicks submit
2. Waits for `networkidle`
3. Captures screenshots for `auth_required` routes + all `public` routes
4. Saves to `screenshots/{role}/`

Guest context captures only `public` routes → `screenshots/guest/`.

**Stage 3 — Manifest**

Extended manifest format:
```json
{
  "generated_at": "...",
  "base_url": "http://localhost:3000",
  "roles": ["guest", "admin", "user"],
  "screenshots": [
    {
      "id": "dashboard",
      "role": "admin",
      "file": "admin/dashboard_main.png",
      "title": "Main page — Administrator",
      "access": "auth_required",
      "success": true
    },
    {
      "id": "dashboard",
      "role": "user",
      "file": "user/dashboard_main.png",
      "title": "Main page — User",
      "access": "auth_required",
      "success": true
    }
  ],
  "errors": []
}
```

### screenshot.js refactoring

New/changed functions:
- `probeRoutes(pages, config)` — guest traversal, returns access map
- `autoDetectFormFields(page)` → `{ usernameField, passwordField, submitButton }`
- `authenticate(context, roleConfig)` — takes `BrowserContext` instead of `page`
- `captureRoleScreenshots(roleConfig, pages, accessMap, config, outputDir)` — screenshots for one role
- `run()` — orchestrates via `Promise.all(roles.map(r => captureRoleScreenshots(...)))`

### Output structure

```
docs/screenshots/
    guest/
    admin/
    user/
    manager/
    manifest.json
```

---

## 3. Phase 3: Markdown Generation Changes

### Screenshot reference format

Templates now specify role explicitly:

```markdown
![Рисунок — Главная страница (администратор)](../screenshots/admin/dashboard_main.png)
![Рисунок — Главная страница (пользователь)](../screenshots/user/dashboard_main.png)
```

### Role selection per document type

| Document type      | Primary role  | Fallback                    |
|--------------------|---------------|-----------------------------|
| User Guide         | `user`        | `guest`                     |
| Admin Guide        | `admin`       | any role with higher privs  |
| Operator Guide     | `operator`    | `user`                      |
| Technical Desc.    | all roles     | (shows interface differences)|

If a role is not found in the manifest → fall back to next priority → if none available,
skip screenshot with a warning in the generation log.

### Caption format for multi-role screenshots

When the same screen exists for multiple roles, captions include the role in parentheses:

```markdown
![Рисунок — Раздел «Пользователи» (роль: admin)](../screenshots/admin/users_list.png)
```

---

## 4. Release Policy and CHANGELOG

### Versioning

SemVer `MAJOR.MINOR.PATCH`:
- `PATCH` — bug fixes in scripts, templates, SKILL.md wording
- `MINOR` — new features without breaking `meta.yaml` compatibility
- `MAJOR` — breaking changes to `meta.yaml` schema or SKILL.md phase structure

### CHANGELOG.md location

`CHANGELOG.md` in the repository root (`/Users/borzov/Develop/Claude/Skills/gen-docs/`).
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with sections:
`Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.

### Version in skill

The `skill_version` field in `meta.yaml` tracks which version generated the file.
The version number is also maintained in `SKILL.md` frontmatter comments and `CHANGELOG.md`.

---

## 5. Files Changed

| File | Change type |
|------|-------------|
| `skills/gen-docs/SKILL.md` | Add Q5-auth block, update screenshotter prompt, update meta.yaml schema, bump to v0.2.0 |
| `skills/gen-docs/scripts/screenshot.js` | Refactor for multi-context + probe run |
| `CHANGELOG.md` | Create with v0.1.0 and v0.2.0 entries |

---

## 6. Out of Scope for v0.2.0

- Cookie/token-based auth (OAuth, SSO, magic links) — v0.3.0
- Video recordings of user flows — future
- Diff screenshots between roles — future
