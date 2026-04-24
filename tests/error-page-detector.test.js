'use strict';

const { detectErrorPage } = require('../skills/gostdocs/scripts/lib/error-page-detector');

const resp = (status) => ({ status: () => status });

describe('detectErrorPage', () => {
  test('returns null for a healthy page', () => {
    expect(detectErrorPage({
      response: resp(200),
      url: 'http://app/events/hackathon',
      title: 'Hackathon · мероприятие',
      role: 'guest',
    })).toBeNull();
  });

  test('flags HTTP 404 response', () => {
    const r = detectErrorPage({
      response: resp(404),
      url: 'http://app/events/missing',
      title: '404 · Not found',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toMatch(/^http-status:404/);
  });

  test('flags HTTP 500 even if title looks innocuous', () => {
    const r = detectErrorPage({
      response: resp(500),
      url: 'http://app/events/list',
      title: 'Loading…',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.status).toBe(500);
  });

  test('flags Russian 404 via title when HTTP status is 200', () => {
    // Some stacks serve the 404 body with HTTP 200 (SPAs do this a lot).
    const r = detectErrorPage({
      response: resp(200),
      url: 'http://app/categories/unknown',
      title: 'Страница не найдена',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toMatch(/title-pattern/);
  });

  test('flags "not found" title in English', () => {
    const r = detectErrorPage({
      response: resp(200),
      url: 'http://app/events/missing',
      title: 'Page not found',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toMatch(/title-pattern/);
  });

  test('flags URL pointing to /404 even with 200 status', () => {
    const r = detectErrorPage({
      response: resp(200),
      url: 'http://app/404',
      title: 'Home',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toMatch(/url-pattern/);
  });

  test('flags login-redirect trap for authenticated roles', () => {
    const r = detectErrorPage({
      response: resp(200),
      url: 'http://app/login?redirect=%2Fadmin%2Fdashboard',
      title: 'Sign in',
      role: 'admin',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toBe('auth-redirect-trap');
  });

  test('does NOT flag guest landing on /login — that is expected', () => {
    const r = detectErrorPage({
      response: resp(200),
      url: 'http://app/login',
      title: 'Вход',
      role: 'guest',
    });
    expect(r).toBeNull();
  });

  test('null response (same-page nav) falls through to URL / title checks', () => {
    const r = detectErrorPage({
      response: null,
      url: 'http://app/categories/spam',
      title: 'Forbidden',
      role: 'guest',
    });
    expect(r).not.toBeNull();
    expect(r.reason).toMatch(/title-pattern/);
  });
});
