'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const rd = require('../skills/gostdocs/scripts/lib/route-discover');

function makeTmp(layout = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  for (const [rel, contents] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

const rm = (root) => fs.rmSync(root, { recursive: true, force: true });

describe('Vue Router (objects array)', () => {
  test('extracts paths and meta.requiresAuth + meta.role', () => {
    const root = makeTmp({
      'src/router/index.ts': `
        export const routes = [
          { path: '/', name: 'home', component: HomeView, meta: { title: 'Главная' } },
          { path: '/events', name: 'events', component: EventsView, meta: { title: 'Мероприятия', requiresAuth: false } },
          { path: '/admin/dashboard', name: 'admin-dashboard', component: AdminDashboard, meta: { title: 'Админка', requiresAuth: true, role: 'admin' } },
          { path: '/profile', name: 'profile', component: Profile, meta: { requiresAuth: true } },
        ];
      `,
    });
    try {
      const out = rd.discoverRoutes(root);
      const ids = out.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(['home', 'events', 'admin-dashboard', 'profile']));
      const home = out.find((r) => r.id === 'home');
      expect(home.path).toBe('/');
      expect(home.title).toBe('Главная');
      expect(home.access_role).toBe('guest');
      const adm = out.find((r) => r.id === 'admin-dashboard');
      expect(adm.access_role).toBe('admin');
      const prof = out.find((r) => r.id === 'profile');
      expect(prof.access_role).toBe('user');
    } finally { rm(root); }
  });
});

describe('Next.js App Router (app/ directory)', () => {
  test('reads page.tsx files and infers paths', () => {
    const root = makeTmp({
      'next.config.js': 'module.exports = {}',
      'app/page.tsx': '',
      'app/about/page.tsx': '',
      'app/blog/[slug]/page.tsx': '',
      'app/admin/dashboard/page.tsx': '',
    });
    try {
      const out = rd.discoverRoutes(root);
      const paths = out.map((r) => r.path).sort();
      expect(paths).toEqual([
        '/',
        '/about',
        '/admin/dashboard',
        '/blog/:slug',
      ]);
    } finally { rm(root); }
  });
});

describe('Laravel routes/web.php', () => {
  test('extracts Route::get / Route::post and group prefixes', () => {
    const root = makeTmp({
      'artisan': '#!/usr/bin/env php',
      'routes/web.php': `<?php
        Route::get('/', [HomeController::class, 'index'])->name('home');
        Route::get('/events', [EventsController::class, 'index'])->name('events');
        Route::middleware('auth')->group(function () {
          Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
        });
        Route::middleware(['auth', 'role:admin'])->prefix('admin')->group(function () {
          Route::get('/dashboard', [AdminController::class, 'index'])->name('admin.dashboard');
        });
      `,
    });
    try {
      const out = rd.discoverRoutes(root);
      const paths = out.map((r) => r.path);
      expect(paths).toEqual(expect.arrayContaining(['/', '/events', '/profile', '/admin/dashboard']));
      const profile = out.find((r) => r.path === '/profile');
      expect(profile.access_role).toBe('user');
      const adm = out.find((r) => r.path === '/admin/dashboard');
      expect(adm.access_role).toBe('admin');
    } finally { rm(root); }
  });
});

describe('Django urls.py', () => {
  test('extracts path() / re_path() entries', () => {
    const root = makeTmp({
      'manage.py': '',
      'app/urls.py': `
        from django.urls import path
        urlpatterns = [
          path('', HomeView.as_view(), name='home'),
          path('events/', EventsView.as_view(), name='events'),
          path('events/<int:pk>/', EventDetailView.as_view(), name='event-detail'),
        ]
      `,
    });
    try {
      const out = rd.discoverRoutes(root);
      const paths = out.map((r) => r.path).sort();
      expect(paths).toEqual([
        '/',
        '/events/',
        '/events/:pk/',
      ]);
    } finally { rm(root); }
  });
});

describe('React Router (createBrowserRouter or JSX <Route>)', () => {
  test('extracts paths from createBrowserRouter([{path, element}, ...])', () => {
    const root = makeTmp({
      'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-router-dom': '^6' } }),
      'src/router.tsx': `
        import { createBrowserRouter } from 'react-router-dom';
        export const router = createBrowserRouter([
          { path: '/', element: <Home /> },
          { path: '/about', element: <About /> },
          { path: '/users/:id', element: <UserDetail /> },
        ]);
      `,
    });
    try {
      const out = rd.discoverRoutes(root);
      const paths = out.map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/about', '/users/:id']);
    } finally { rm(root); }
  });

  test('extracts paths from JSX <Route path="..."> declarations', () => {
    const root = makeTmp({
      'package.json': JSON.stringify({ dependencies: { 'react-router-dom': '^6' } }),
      'src/App.tsx': `
        import { Routes, Route } from 'react-router-dom';
        export default function App() {
          return (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin/*" element={<AdminLayout />} />
            </Routes>
          );
        }
      `,
    });
    try {
      const out = rd.discoverRoutes(root);
      const paths = out.map((r) => r.path);
      expect(paths).toEqual(expect.arrayContaining(['/', '/profile', '/admin/*']));
    } finally { rm(root); }
  });
});

describe('SvelteKit (src/routes/ directory)', () => {
  test('reads +page.svelte files and infers paths', () => {
    const root = makeTmp({
      'svelte.config.js': '',
      'src/routes/+page.svelte': '',
      'src/routes/about/+page.svelte': '',
      'src/routes/blog/[slug]/+page.svelte': '',
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/about', '/blog/:slug']);
    } finally { rm(root); }
  });
});

describe('Nuxt 3 (pages/ directory)', () => {
  test('reads .vue files and infers paths', () => {
    const root = makeTmp({
      'nuxt.config.ts': '',
      'pages/index.vue': '',
      'pages/about.vue': '',
      'pages/users/[id].vue': '',
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/about', '/users/:id']);
    } finally { rm(root); }
  });
});

describe('Astro (src/pages/ directory)', () => {
  test('reads .astro files and infers paths', () => {
    const root = makeTmp({
      'astro.config.mjs': '',
      'src/pages/index.astro': '',
      'src/pages/blog/[slug].astro': '',
      'src/pages/contact.md': '',
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/blog/:slug', '/contact']);
    } finally { rm(root); }
  });
});

describe('FastAPI (decorator scan)', () => {
  test('extracts @app.get/@router.post paths', () => {
    const root = makeTmp({
      'requirements.txt': 'fastapi\n',
      'main.py': `
        from fastapi import FastAPI, APIRouter
        app = FastAPI()
        router = APIRouter()

        @app.get("/")
        def home():
            return {}

        @router.get("/items/{item_id}")
        def get_item(item_id: int):
            return {}

        @app.post("/login")
        def login():
            return {}
      `,
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/items/:item_id', '/login']);
    } finally { rm(root); }
  });
});

describe('Flask (decorator scan)', () => {
  test('extracts @app.route paths', () => {
    const root = makeTmp({
      'requirements.txt': 'Flask\n',
      'app.py': `
        from flask import Flask
        app = Flask(__name__)

        @app.route('/')
        def home(): pass

        @app.route('/users/<int:user_id>', methods=['GET'])
        def user_detail(user_id): pass
      `,
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/users/:user_id']);
    } finally { rm(root); }
  });
});

describe('Spring Boot (@GetMapping / @PostMapping)', () => {
  test('extracts paths from @RequestMapping class-level + @GetMapping method-level', () => {
    const root = makeTmp({
      'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId></dependency></dependencies></project>',
      'src/main/java/com/acme/UserController.java': `
        package com.acme;
        @RestController
        @RequestMapping("/api/users")
        public class UserController {
          @GetMapping
          public List<User> list() { return null; }
          @GetMapping("/{id}")
          public User one(@PathVariable Long id) { return null; }
          @PostMapping("/create")
          public User create(@RequestBody User u) { return null; }
        }
      `,
    });
    try {
      const paths = rd.discoverRoutes(root).map((r) => r.path).sort();
      expect(paths).toEqual(['/api/users/', '/api/users/:id', '/api/users/create']);
    } finally { rm(root); }
  });
});

describe('graceful fallback when no router files', () => {
  test('returns empty array', () => {
    const root = makeTmp({ 'README.md': 'x' });
    try { expect(rd.discoverRoutes(root)).toEqual([]); } finally { rm(root); }
  });
});

describe('inferIdFromPath', () => {
  test('strips slashes and stripes parameters', () => {
    expect(rd.inferIdFromPath('/')).toBe('home');
    expect(rd.inferIdFromPath('/events')).toBe('events');
    expect(rd.inferIdFromPath('/events/calendar')).toBe('events-calendar');
    expect(rd.inferIdFromPath('/blog/:slug')).toBe('blog-detail');
    expect(rd.inferIdFromPath('/admin/users/:id/edit')).toBe('admin-users-edit');
  });
});
