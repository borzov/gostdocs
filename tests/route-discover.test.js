'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const rd = require('../skills/gen-docs/scripts/lib/route-discover');

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
