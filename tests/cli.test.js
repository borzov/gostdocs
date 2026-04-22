const { parseArgs, assertConsistent } = require('../skills/gen-docs/scripts/lib/cli');

describe('parseArgs — boolean flags', () => {
  test('defaults are all falsy/null', () => {
    const r = parseArgs([]);
    expect(r.yes).toBe(false);
    expect(r.config).toBeNull();
    expect(r.only).toBeNull();
    expect(r.skipScreenshots).toBe(false);
    expect(r.rerunRoles).toEqual([]);
    expect(r.dryRun).toBe(false);
    expect(r.liveDb).toBe(false);
    expect(r.visionProvider).toBeNull();
    expect(r.langs).toBeNull();
    expect(r.help).toBe(false);
    expect(r.extras).toEqual([]);
  });

  test('--yes and -y', () => {
    expect(parseArgs(['--yes']).yes).toBe(true);
    expect(parseArgs(['-y']).yes).toBe(true);
  });

  test('--help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

describe('parseArgs — value flags', () => {
  test('--config <path>', () => {
    expect(parseArgs(['--config', '/tmp/meta.yaml']).config).toBe('/tmp/meta.yaml');
  });

  test('--only phase', () => {
    expect(parseArgs(['--only', 'precheck']).only).toBe('precheck');
    expect(parseArgs(['--only', 'user-guide']).only).toBe('user-guide');
  });

  test('--rerun-screenshots accepts multiple values', () => {
    const r = parseArgs(['--rerun-screenshots', 'admin', '--rerun-screenshots', 'user']);
    expect(r.rerunRoles).toEqual(['admin', 'user']);
  });

  test('--vision-provider validates enum', () => {
    expect(parseArgs(['--vision-provider', 'claude']).visionProvider).toBe('claude');
    expect(parseArgs(['--vision-provider', 'openai']).visionProvider).toBe('openai');
    expect(() => parseArgs(['--vision-provider', 'bard'])).toThrow();
  });

  test('--lang comma-list', () => {
    expect(parseArgs(['--lang', 'ru,en,kz']).langs).toEqual(['ru', 'en', 'kz']);
    expect(parseArgs(['--lang', 'ru']).langs).toEqual(['ru']);
  });

  test('missing value for flag throws', () => {
    expect(() => parseArgs(['--config'])).toThrow(/Missing value/);
    expect(() => parseArgs(['--only', '--yes'])).toThrow(/Missing value/);
  });
});

describe('parseArgs — extras', () => {
  test('unknown flags go to extras', () => {
    const r = parseArgs(['--custom-flag', 'value', '--yes']);
    expect(r.yes).toBe(true);
    expect(r.extras).toEqual(['--custom-flag', 'value']);
  });
});

describe('assertConsistent', () => {
  test('passes on defaults', () => {
    expect(() => assertConsistent(parseArgs([]))).not.toThrow();
  });

  test('rejects --skip-screenshots with --rerun-screenshots', () => {
    const cli = parseArgs(['--skip-screenshots', '--rerun-screenshots', 'admin']);
    expect(() => assertConsistent(cli)).toThrow(/cannot be combined/);
  });

  test('rejects --skip-screenshots with --only capture', () => {
    const cli = parseArgs(['--skip-screenshots', '--only', 'capture']);
    expect(() => assertConsistent(cli)).toThrow(/redundant/);
  });
});
