'use strict';

const { buildDeployCommands, pickAppService, wrapExec } = require('../skills/gostdocs/scripts/lib/deploy-commands');

function joinElements(elements) {
  return elements
    .map((e) => e.text || e.code || e.content || '')
    .filter(Boolean)
    .join('\n');
}

describe('pickAppService', () => {
  test('prefers app/backend/api over arbitrary services', () => {
    expect(pickAppService(['db', 'redis', 'backend'])).toBe('backend');
    expect(pickAppService(['web', 'app'])).toBe('app');
    expect(pickAppService(['worker', 'db'])).toBe('worker');
  });

  test('returns null when input is not an array', () => {
    expect(pickAppService(null)).toBeNull();
    expect(pickAppService(undefined)).toBeNull();
  });
});

describe('wrapExec', () => {
  test('wraps a bare command in docker compose exec <service>', () => {
    expect(wrapExec('php yii migrate', 'backend')).toBe('docker compose exec backend php yii migrate');
  });

  test('leaves existing docker compose exec / run unchanged', () => {
    expect(wrapExec('docker compose exec worker rake db:seed', 'backend'))
      .toBe('docker compose exec worker rake db:seed');
  });

  test('returns input untouched when service is missing', () => {
    expect(wrapExec('npm run migrate', null)).toBe('npm run migrate');
  });
});

describe('buildDeployCommands', () => {
  test('emits prerequisites, start, stop, and verify blocks for an empty introspect', () => {
    const out = buildDeployCommands({ introspect: {}, meta: { app: { url: 'http://localhost:8080' } } });
    const text = joinElements(out);
    expect(text).toMatch(/Предварительные требования/);
    expect(text).toMatch(/docker compose up -d/);
    expect(text).toMatch(/curl -fsSL "http:\/\/localhost:8080"/);
    expect(text).toMatch(/docker compose down/);
  });

  test('includes migration and seed commands inside docker compose exec when known', () => {
    const out = buildDeployCommands({
      introspect: {
        services: ['db', 'backend', 'redis'],
        derived: { migration_command: 'php yii migrate', seed_command: 'php yii seed' },
      },
      meta: { app: { url: 'http://localhost:8080' } },
    }, { lang: 'ru' });
    const text = joinElements(out);
    expect(text).toMatch(/docker compose exec backend php yii migrate/);
    expect(text).toMatch(/docker compose exec backend php yii seed/);
  });

  test('warns when no docker-compose was detected', () => {
    const out = buildDeployCommands({ introspect: { services: [] } }, { lang: 'ru' });
    const todos = out.filter((e) => e.type === 'admonition' && e.kind === 'todo');
    expect(todos).toHaveLength(1);
    expect(todos[0].text).toMatch(/docker-compose\.yml/);
  });

  test('English strings selected when lang=en', () => {
    const out = buildDeployCommands({}, { lang: 'en' });
    const text = joinElements(out);
    expect(text).toMatch(/Prerequisites/);
    expect(text).toMatch(/Start the containers/);
  });
});
