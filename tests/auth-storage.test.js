const storage = require('../skills/gen-docs/scripts/adapters/auth/storage');

describe('extractToken', () => {
  test('returns null for non-object', () => {
    expect(storage.extractToken(null)).toBeNull();
    expect(storage.extractToken('str')).toBeNull();
  });

  test('picks configured key first', () => {
    expect(storage.extractToken({ custom_token: 'abc', access_token: 'xyz' }, 'custom_token'))
      .toEqual({ key: 'custom_token', value: 'abc' });
  });

  test('falls back to common keys', () => {
    expect(storage.extractToken({ access_token: 'aaa' })).toEqual({ key: 'access_token', value: 'aaa' });
    expect(storage.extractToken({ jwt: 'bbb' })).toEqual({ key: 'jwt', value: 'bbb' });
    expect(storage.extractToken({ accessToken: 'ccc' })).toEqual({ key: 'accessToken', value: 'ccc' });
  });

  test('traverses one level of nesting', () => {
    expect(storage.extractToken({ data: { token: 'nested' } }))
      .toEqual({ key: 'token', value: 'nested' });
    expect(storage.extractToken({ result: { access_token: 'r' } }))
      .toEqual({ key: 'access_token', value: 'r' });
  });

  test('returns null for missing keys', () => {
    expect(storage.extractToken({ other: 'x' })).toBeNull();
  });

  test('ignores empty string values', () => {
    expect(storage.extractToken({ token: '' })).toBeNull();
  });
});

describe('detectStorage', () => {
  test('honours explicit declaration', () => {
    expect(storage.detectStorage('cookie', { cookies: ['a'], tokenFound: true })).toBe('cookie');
    expect(storage.detectStorage('sessionStorage', { cookies: [], tokenFound: false })).toBe('sessionStorage');
  });

  test('auto: cookies + token -> mixed', () => {
    expect(storage.detectStorage('auto', { cookies: ['session=abc'], tokenFound: true })).toBe('mixed');
  });

  test('auto: cookies only -> cookie', () => {
    expect(storage.detectStorage('auto', { cookies: ['session=abc'], tokenFound: false })).toBe('cookie');
  });

  test('auto: token only -> localStorage', () => {
    expect(storage.detectStorage('auto', { cookies: [], tokenFound: true })).toBe('localStorage');
  });

  test('auto: nothing -> localStorage (SPA default)', () => {
    expect(storage.detectStorage('auto', { cookies: [], tokenFound: false })).toBe('localStorage');
  });
});

describe('buildInitScript', () => {
  test('returns null for cookie storage', () => {
    expect(storage.buildInitScript({ storage: 'cookie', tokenKey: 'k', tokenValue: 'v' })).toBeNull();
  });

  test('returns null without token value', () => {
    expect(storage.buildInitScript({ storage: 'localStorage', tokenKey: 'k', tokenValue: null })).toBeNull();
  });

  test('builds localStorage.setItem for localStorage', () => {
    const script = storage.buildInitScript({ storage: 'localStorage', tokenKey: 'access_token', tokenValue: 'abc' });
    expect(script).toContain('window.localStorage.setItem("access_token", "abc")');
  });

  test('builds sessionStorage.setItem for sessionStorage', () => {
    const script = storage.buildInitScript({ storage: 'sessionStorage', tokenKey: 'tok', tokenValue: '42' });
    expect(script).toContain('window.sessionStorage.setItem("tok", "42")');
  });

  test('mixed storage seeds localStorage (cookies handled via addCookies)', () => {
    const script = storage.buildInitScript({ storage: 'mixed', tokenKey: 'k', tokenValue: 'v' });
    expect(script).toContain('window.localStorage.setItem');
  });

  test('escapes quotes in key/value', () => {
    const script = storage.buildInitScript({
      storage: 'localStorage',
      tokenKey: 'key"with"quotes',
      tokenValue: 'val"with"quotes',
    });
    expect(script).toContain('\\"');
  });
});

describe('parseSetCookie', () => {
  test('handles single set-cookie string', () => {
    const cookies = storage.parseSetCookie('session=abc; Path=/; HttpOnly', 'http://localhost:3000');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ name: 'session', value: 'abc', path: '/', httpOnly: true });
  });

  test('handles array of set-cookie values', () => {
    const cookies = storage.parseSetCookie(
      ['a=1', 'b=2; Secure'],
      'http://localhost:3000',
    );
    expect(cookies).toHaveLength(2);
    expect(cookies[1].secure).toBe(true);
  });

  test('ignores malformed entries', () => {
    expect(storage.parseSetCookie(['', 'bad', '=nope'], 'http://x')).toHaveLength(0);
  });

  test('handles undefined input', () => {
    expect(storage.parseSetCookie(undefined, 'http://x')).toEqual([]);
  });
});
