const { buildPrompt, componentExtras, roleHint } = require('../skills/gostdocs/scripts/lib/inspection-prompt');

describe('buildPrompt', () => {
  test('ru by default', () => {
    const p = buildPrompt({ path: '/admin', role: 'admin', viewport: 'desktop' });
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/авторизован как "admin"/);
    expect(p).toMatch(/"is_login_form":/);
  });

  test('en when opts.lang=en', () => {
    const p = buildPrompt({ path: '/admin', role: 'admin', viewport: 'desktop' }, { lang: 'en' });
    expect(p).toMatch(/authenticated as "admin"/);
    expect(p).toMatch(/Return a JSON object/);
  });

  test('guest role gets login-form-expected hint', () => {
    const p = buildPrompt({ path: '/admin', role: 'guest', viewport: 'desktop' });
    expect(p).toMatch(/гость/);
    expect(p).not.toMatch(/авторизован как/);
  });

  test('ru prompt carries an anti-English language-discipline clause', () => {
    const p = buildPrompt({ path: '/', role: 'guest' }, { lang: 'ru' });
    expect(p).toMatch(/ЯЗЫКОВАЯ ДИСЦИПЛИНА/);
    expect(p).toMatch(/ТОЛЬКО на русском/);
    expect(p).toMatch(/НЕПРАВИЛЬНО:/);
    expect(p).toMatch(/ПРАВИЛЬНО:/);
    expect(p).toMatch(/Public landing page/);
  });

  test('en prompt carries an English-only discipline clause', () => {
    const p = buildPrompt({ path: '/', role: 'guest' }, { lang: 'en' });
    expect(p).toMatch(/LANGUAGE DISCIPLINE/);
    expect(p).toMatch(/MUST be in English/);
    expect(p).toMatch(/WRONG:/);
    expect(p).toMatch(/RIGHT:/);
  });
});

describe('componentExtras', () => {
  test('returns empty when no component_kind', () => {
    expect(componentExtras({ role: 'admin' }, 'ru')).toBe('');
  });

  test.each([
    ['builder', /drag-and-drop|палитр/i],
    ['editor',  /тулбар|toolbar/i],
    ['wizard',  /шаг|step/i],
  ])('adds hint for %s', (kind, re) => {
    const out = componentExtras({ role: 'admin', component_kind: kind }, 'ru');
    expect(out).toMatch(re);
  });

  test('en variant', () => {
    const out = componentExtras({ role: 'admin', component_kind: 'wizard' }, 'en');
    expect(out).toMatch(/step/i);
  });
});

describe('roleHint', () => {
  test('authenticated roles mention is_login_form must be failure', () => {
    const hint = roleHint({ role: 'admin' }, 'en');
    expect(hint).toMatch(/authentication failed/);
  });

  test('guest role is tolerant of login form', () => {
    const hint = roleHint({ role: 'guest' }, 'ru');
    expect(hint).toMatch(/ожидаема/);
  });
});
