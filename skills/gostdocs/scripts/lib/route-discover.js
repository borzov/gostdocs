'use strict';

/**
 * Universal route discoverer.
 *
 * Reads framework-specific router files and extracts a flat list of routes
 * suitable for the meta.yaml `pages:` block.
 *
 * Supported frameworks:
 *   - Vue Router (objects-array form: routes:[{path,name,meta}])
 *   - Next.js App Router (file-system: app/page.tsx, app/[slug]/page.tsx)
 *   - Laravel routes/web.php (Route::get, prefix groups, middleware:auth, role:X)
 *   - Django urls.py (path(), re_path(), <int:pk> -> :pk)
 *
 * Coverage of every framework on earth is intentionally NOT attempted -
 * the orchestrator (Claude) supplements with manual reads when the
 * heuristic returns nothing useful. Returning an empty array is OK and
 * the gap-collector reports a "pages" gap so the user knows.
 *
 * Pure module.
 */

const fs = require('fs');
const path = require('path');

function existsP(p) { try { return fs.existsSync(p); } catch { return false; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function inferIdFromPath(p) {
  if (!p || p === '/' || p === '') return 'home';
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  const segs = trimmed.split('/');
  // Param-shaped segments (`:slug`, `<int:id>`, `[slug]`):
  //   - If LAST segment → rename to "detail" so the id becomes `blog-detail`.
  //   - If interior → drop, so `/admin/users/:id/edit` → `admin-users-edit`.
  const isParam = (s) => /^[:<]/.test(s) || /^\[.+\]$/.test(s);
  const out = segs.map((s, i) => (isParam(s) ? (i === segs.length - 1 ? 'detail' : null) : s));
  return out.filter(Boolean).join('-') || 'home';
}

function inferAccessRole(meta) {
  if (!meta) return 'guest';
  if (meta.role) return String(meta.role);
  if (meta.requiresAdmin) return 'admin';
  if (meta.requiresAuth || meta.auth || meta.authenticated) return 'user';
  if (meta.requiresGuest || meta.guestOnly) return 'guest-only';
  return 'guest';
}

function parseVueRouterRoute(text, idx) {
  const start = text.indexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = text.slice(start + 1, end);
  const out = { _end: end };
  const get = (key) => {
    const re = new RegExp(`${key}\\s*:\\s*(?:["'\`]([^"'\`]+)["'\`]|(true|false))`);
    const m = body.match(re);
    return m ? (m[1] !== undefined ? m[1] : (m[2] === 'true')) : undefined;
  };
  out.path = get('path');
  out.name = get('name');
  const metaMatch = body.match(/meta\s*:\s*\{([\s\S]*?)\}/);
  if (metaMatch) {
    const mb = metaMatch[1];
    out.meta = {};
    const titleM = mb.match(/title\s*:\s*["'`]([^"'`]+)["'`]/);
    if (titleM) out.meta.title = titleM[1];
    const roleM = mb.match(/role\s*:\s*["'`]([^"'`]+)["'`]/);
    if (roleM) out.meta.role = roleM[1];
    if (/requiresAuth\s*:\s*true/.test(mb)) out.meta.requiresAuth = true;
    if (/requiresAdmin\s*:\s*true/.test(mb)) out.meta.requiresAdmin = true;
    if (/requiresGuest\s*:\s*true/.test(mb)) out.meta.requiresGuest = true;
  }
  return out;
}

function discoverVueRouter(projectPath) {
  // Look in the project root AND in common monorepo frontend subdirs.
  const SUBDIRS = ['', 'frontend/', 'client/', 'web/', 'apps/web/', 'apps/frontend/', 'packages/web/'];
  const FILES = ['src/router/index.ts', 'src/router/index.js', 'src/router.ts', 'src/router.js', 'router/index.ts'];
  const candidates = [];
  for (const sub of SUBDIRS) for (const file of FILES) candidates.push(sub + file);
  for (const c of candidates) {
    const p = path.join(projectPath, c);
    if (!existsP(p)) continue;
    const text = readText(p);
    if (!text || !/routes\s*[:=]/.test(text)) continue;
    const out = [];
    let idx = text.indexOf('routes');
    while (idx >= 0) {
      const r = parseVueRouterRoute(text, idx);
      if (!r || !r.path) break;
      out.push({
        id: r.name || inferIdFromPath(r.path),
        path: r.path,
        title: r.meta && r.meta.title ? r.meta.title : null,
        access_role: inferAccessRole(r.meta),
      });
      idx = text.indexOf('{', r._end + 1);
      if (idx < 0 || text.slice(r._end, idx).includes(']')) break;
    }
    if (out.length > 0) return out;
  }
  return [];
}

function discoverNextAppRouter(projectPath) {
  // Try the project root AND common monorepo Next.js subdirs.
  const SUBDIRS = ['app', 'frontend/app', 'apps/web/app', 'web/app'];
  const appDir = SUBDIRS.map((s) => path.join(projectPath, s)).find(existsP);
  if (!appDir) return [];
  const out = [];
  const walk = (dir, urlPath) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const seg = entry.name.startsWith('[') && entry.name.endsWith(']')
          ? `:${entry.name.slice(1, -1).replace(/^\.\.\./, '')}`
          : entry.name;
        const next = urlPath === '/' ? `/${seg}` : `${urlPath}/${seg}`;
        walk(path.join(dir, entry.name), next);
      } else if (/^page\.(tsx?|jsx?|mdx?)$/.test(entry.name)) {
        out.push({
          id: inferIdFromPath(urlPath),
          path: urlPath,
          title: null,
          access_role: 'guest',
        });
      }
    }
  };
  walk(appDir, '/');
  return out;
}

function inferLaravelRoleFromMiddleware(mw) {
  if (!mw) return 'guest';
  if (/role\s*:\s*['"]?admin['"]?/.test(mw)) return 'admin';
  if (/can\s*:\s*['"]?admin['"]?/.test(mw)) return 'admin';
  if (/auth/.test(mw)) return 'user';
  if (/guest/.test(mw)) return 'guest-only';
  return 'guest';
}

function discoverLaravelRoutes(projectPath) {
  // Allow monorepo: app/ at root OR backend/ subdirectory.
  const SUBDIRS = ['', 'backend/', 'apps/backend/', 'apps/api/', 'server/'];
  const root = SUBDIRS.find((s) => existsP(path.join(projectPath, s + 'artisan')));
  if (root === undefined) return [];
  const candidates = [root + 'routes/web.php', root + 'routes/api.php'];
  const out = [];
  for (const c of candidates) {
    const p = path.join(projectPath, c);
    const text = readText(p);
    if (!text) continue;
    const groupStack = [{ middleware: '', prefix: '' }];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const groupOpen = /Route::([\s\S]*?)->group\s*\(/.exec(trimmed);
      if (groupOpen) {
        const head = groupOpen[1];
        const mwMatch = head.match(/middleware\s*\(\s*\[?([^\]\)]+)\]?\s*\)/);
        const pfxMatch = head.match(/prefix\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        const top = groupStack[groupStack.length - 1];
        groupStack.push({
          middleware: [top.middleware, mwMatch ? mwMatch[1] : ''].filter(Boolean).join(','),
          prefix: pfxMatch ? `${top.prefix}/${pfxMatch[1].replace(/^\//, '')}` : top.prefix,
        });
        continue;
      }
      if (/^\}\s*\)\s*;/.test(trimmed) && groupStack.length > 1) groupStack.pop();
      const route = /Route::(get|post|put|patch|delete|any)\s*\(\s*['"]([^'"]*)['"]/.exec(trimmed);
      if (!route) continue;
      const method = route[1];
      const rawPath = route[2];
      if (method !== 'get' && method !== 'any') continue;
      const top = groupStack[groupStack.length - 1];
      const fullPath = ((top.prefix ? `${top.prefix}/` : '') + rawPath).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      const nameMatch = trimmed.match(/->name\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      out.push({
        id: nameMatch ? nameMatch[1].replace(/\./g, '-') : inferIdFromPath(fullPath),
        path: fullPath.startsWith('/') ? fullPath : `/${fullPath}`,
        title: null,
        access_role: inferLaravelRoleFromMiddleware(top.middleware),
      });
    }
  }
  return out;
}

function discoverDjangoUrls(projectPath) {
  // Allow monorepo: manage.py at root OR backend/.
  const SUBDIRS = ['', 'backend/', 'apps/backend/', 'apps/api/', 'server/'];
  const root = SUBDIRS.find((s) => existsP(path.join(projectPath, s + 'manage.py')));
  if (root === undefined) return [];
  const out = [];
  const walkRoot = path.join(projectPath, root);
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name !== 'urls.py') continue;
      const text = readText(path.join(dir, entry.name));
      if (!text) continue;
      const re = /path\s*\(\s*['"]([^'"]*)['"]\s*,[^,]+(?:name\s*=\s*['"]([^'"]+)['"])?/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const raw = m[1];
        const name = m[2];
        const norm = '/' + raw.replace(/<\w+:(\w+)>/g, ':$1');
        out.push({
          id: name || inferIdFromPath(norm),
          path: norm.replace(/\/{2,}/g, '/'),
          title: null,
          access_role: 'guest',
        });
      }
    }
  };
  walk(walkRoot);
  return out;
}

/* ----------------------------------------------------- React Router -- */

function discoverReactRouter(projectPath) {
  // Try package.json deps for the marker; if absent, skip entirely.
  const SUBDIRS = ['', 'frontend/', 'client/', 'web/', 'apps/web/', 'apps/frontend/'];
  let hasDep = false;
  for (const sub of SUBDIRS) {
    const pkg = readText(path.join(projectPath, sub + 'package.json'));
    if (pkg && /"react-router(-dom)?"/.test(pkg)) { hasDep = true; break; }
  }
  if (!hasDep) return [];

  const out = [];
  const FILES = ['src/router.tsx', 'src/router.ts', 'src/router.jsx', 'src/router.js',
                 'src/routes.tsx', 'src/routes.ts', 'src/App.tsx', 'src/App.jsx', 'src/main.tsx'];
  for (const sub of SUBDIRS) {
    for (const f of FILES) {
      const text = readText(path.join(projectPath, sub + f));
      if (!text) continue;
      // 1. Object form: { path: '/x', element: ... }
      const objRe = /\bpath\s*:\s*['"`]([^'"`]+)['"`]/g;
      let m;
      while ((m = objRe.exec(text)) !== null) {
        out.push({ id: inferIdFromPath(m[1]), path: m[1], title: null, access_role: 'guest' });
      }
      // 2. JSX form: <Route path="/x" ... />
      const jsxRe = /<Route\s+[^>]*\bpath\s*=\s*['"`]([^'"`]+)['"`]/g;
      while ((m = jsxRe.exec(text)) !== null) {
        out.push({ id: inferIdFromPath(m[1]), path: m[1], title: null, access_role: 'guest' });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------ SvelteKit -- */

function discoverFileSystemRoutes(projectPath, sourceRoot, fileMatchers, opts = {}) {
  const dir = path.join(projectPath, sourceRoot);
  if (!existsP(dir)) return [];
  const out = [];
  const stripIndex = opts.stripIndex || null; // e.g. 'index' for Nuxt
  const walk = (current, urlPath) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const seg = entry.name.startsWith('[') && entry.name.endsWith(']')
          ? `:${entry.name.slice(1, -1).replace(/^\.\.\./, '')}`
          : entry.name;
        const next = urlPath === '/' ? `/${seg}` : `${urlPath}/${seg}`;
        walk(path.join(current, entry.name), next);
      } else if (fileMatchers.some((re) => re.test(entry.name))) {
        let p = urlPath;
        if (stripIndex && entry.name.startsWith(stripIndex + '.')) {
          // Nuxt: pages/index.vue -> '/'
          // already handled by passing urlPath=/ at root
        } else {
          // Single-file route like pages/about.vue -> /about; or [id].vue -> /:id
          const stem = entry.name.replace(/\.[^.]+$/, '');
          if (stem !== stripIndex && stem !== 'index') {
            const seg = stem.startsWith('[') && stem.endsWith(']')
              ? `:${stem.slice(1, -1)}`
              : stem;
            p = urlPath === '/' ? `/${seg}` : `${urlPath}/${seg}`;
          }
        }
        out.push({ id: inferIdFromPath(p), path: p, title: null, access_role: 'guest' });
      }
    }
  };
  walk(dir, '/');
  return out;
}

function discoverSvelteKit(projectPath) {
  if (!existsP(path.join(projectPath, 'svelte.config.js')) && !existsP(path.join(projectPath, 'svelte.config.ts'))) return [];
  // SvelteKit specifically uses +page.svelte / +page.ts as the route file.
  const dir = path.join(projectPath, 'src/routes');
  if (!existsP(dir)) return [];
  const out = [];
  const walk = (current, urlPath) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const seg = entry.name.startsWith('[') && entry.name.endsWith(']')
          ? `:${entry.name.slice(1, -1)}`
          : entry.name;
        const next = urlPath === '/' ? `/${seg}` : `${urlPath}/${seg}`;
        walk(path.join(current, entry.name), next);
      } else if (/^\+page\.(svelte|ts|js)$/.test(entry.name)) {
        out.push({ id: inferIdFromPath(urlPath), path: urlPath, title: null, access_role: 'guest' });
      }
    }
  };
  walk(dir, '/');
  return out;
}

/* --------------------------------------------------------- Nuxt 3 -- */

function discoverNuxt(projectPath) {
  const hasMarker = ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs']
    .some((f) => existsP(path.join(projectPath, f)));
  if (!hasMarker) return [];
  return discoverFileSystemRoutes(projectPath, 'pages', [/\.vue$/], { stripIndex: 'index' });
}

/* ----------------------------------------------------------- Astro -- */

function discoverAstro(projectPath) {
  const hasMarker = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']
    .some((f) => existsP(path.join(projectPath, f)));
  if (!hasMarker) return [];
  return discoverFileSystemRoutes(projectPath, 'src/pages', [/\.astro$/, /\.mdx?$/], { stripIndex: 'index' });
}

/* --------------------------------------------------------- FastAPI -- */

function discoverFastAPI(projectPath) {
  // Only proceed if FastAPI is a declared dependency.
  const reqs = readText(path.join(projectPath, 'requirements.txt'));
  const pyproj = readText(path.join(projectPath, 'pyproject.toml'));
  if (!(reqs && /(^|\n)\s*fastapi\b/i.test(reqs)) && !(pyproj && /fastapi/i.test(pyproj))) return [];
  return scanPythonDecorators(projectPath, /@(?:app|router|api|api_router|v\d+_router)\.(?:get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]+)['"]/g);
}

function discoverFlask(projectPath) {
  const reqs = readText(path.join(projectPath, 'requirements.txt'));
  const pyproj = readText(path.join(projectPath, 'pyproject.toml'));
  if (!(reqs && /(^|\n)\s*Flask\b/i.test(reqs)) && !(pyproj && /(^|[^a-z])flask([^a-z]|$)/i.test(pyproj))) return [];
  return scanPythonDecorators(projectPath, /@(?:app|bp|blueprint|api)\.route\s*\(\s*['"]([^'"]+)['"]/g);
}

function scanPythonDecorators(projectPath, decoratorRe) {
  /** @type {Array<Record<string, any>>} */
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'venv' || entry.name === '__pycache__') continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.py')) continue;
      const text = readText(path.join(dir, entry.name));
      if (!text) continue;
      let m;
      // Reset regex stateful index per file.
      decoratorRe.lastIndex = 0;
      while ((m = decoratorRe.exec(text)) !== null) {
        const raw = m[1];
        // Convert FastAPI {item_id} or Flask <int:user_id> to :param.
        const norm = raw
          .replace(/\{([^}]+)\}/g, ':$1')
          .replace(/<[^:>]+:([^>]+)>/g, ':$1')
          .replace(/<([^>]+)>/g, ':$1');
        const finalPath = norm.startsWith('/') ? norm : '/' + norm;
        out.push({ id: inferIdFromPath(finalPath), path: finalPath, title: null, access_role: 'guest' });
      }
    }
  };
  walk(projectPath);
  return out;
}

/* ----------------------------------------------------- Spring Boot -- */

function discoverSpringBoot(projectPath) {
  // Only scan if Spring is a declared dep (pom.xml or build.gradle).
  const SUBDIRS = ['', 'backend/', 'apps/backend/', 'apps/api/', 'server/'];
  const hasSpring = SUBDIRS.some((sub) => {
    const pom = readText(path.join(projectPath, sub + 'pom.xml'));
    if (pom && /(spring-boot|org\.springframework\.boot)/.test(pom)) return true;
    for (const g of ['build.gradle', 'build.gradle.kts']) {
      const grd = readText(path.join(projectPath, sub + g));
      if (grd && /org\.springframework\.boot/.test(grd)) return true;
    }
    return false;
  });
  if (!hasSpring) return [];

  /** @type {Array<Record<string, any>>} */
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build') continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.java$|\.kt$/.test(entry.name)) continue;
      const text = readText(path.join(dir, entry.name));
      if (!text) continue;

      // Class-level @RequestMapping prefix (optional).
      const classMapping = text.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      const prefix = classMapping ? classMapping[1].replace(/\/$/, '') : '';

      // Method-level @GetMapping / @PostMapping / etc. (NOT @RequestMapping —
      // that one is reserved for the class-level prefix above; mixing them
      // would double-count the prefix).
      // Two forms:
      //   1. @GetMapping("/path")            -> use the literal segment
      //   2. @GetMapping (no parens)         -> the method takes the class
      //                                         prefix verbatim ("/api/users/")
      const re = /@(?:Get|Post|Put|Patch|Delete)Mapping(?:\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const literal = m[1];
        let full;
        if (literal === undefined) {
          full = (prefix || '/') + '/'; // class-prefix only, with trailing slash to mark "index"
        } else {
          const segment = literal.startsWith('/') ? literal : '/' + literal;
          full = (prefix || '') + segment;
        }
        if (!full.startsWith('/')) full = '/' + full;
        full = full.replace(/\/{2,}/g, '/');
        const norm = full.replace(/\{([^}]+)\}/g, ':$1');
        out.push({ id: inferIdFromPath(norm), path: norm, title: null, access_role: 'guest' });
      }
    }
  };
  walk(projectPath);
  return out;
}

function discoverRoutes(projectPath) {
  const all = [
    ...discoverVueRouter(projectPath),
    ...discoverNextAppRouter(projectPath),
    ...discoverLaravelRoutes(projectPath),
    ...discoverDjangoUrls(projectPath),
    ...discoverReactRouter(projectPath),
    ...discoverSvelteKit(projectPath),
    ...discoverNuxt(projectPath),
    ...discoverAstro(projectPath),
    ...discoverFastAPI(projectPath),
    ...discoverFlask(projectPath),
    ...discoverSpringBoot(projectPath),
  ];
  const seen = new Set();
  const out = [];
  for (const r of all) {
    if (!r.path || seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out;
}

module.exports = {
  discoverRoutes,
  discoverVueRouter,
  discoverNextAppRouter,
  discoverLaravelRoutes,
  discoverDjangoUrls,
  discoverReactRouter,
  discoverSvelteKit,
  discoverNuxt,
  discoverAstro,
  discoverFastAPI,
  discoverFlask,
  discoverSpringBoot,
  inferIdFromPath,
  inferAccessRole,
};
