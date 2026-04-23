'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectStack, detectLanguage, detectDbEngine } = require('../skills/gen-docs/scripts/lib/stack-detector');

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'stack-det-')); }
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

describe('detectLanguage', () => {
  test('Node.js + TypeScript via tsconfig', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
      expect(detectLanguage(dir)).toEqual({ language: 'TypeScript (Node.js)', language_version: '>=18' });
    } finally { cleanup(dir); }
  });

  test('PHP via composer.json', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({ require: { php: '^8.2' } }));
      expect(detectLanguage(dir)).toEqual({ language: 'PHP', language_version: '^8.2' });
    } finally { cleanup(dir); }
  });

  test('Python via requirements.txt', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==4.2\n');
      expect(detectLanguage(dir).language).toBe('Python');
    } finally { cleanup(dir); }
  });

  test('Go via go.mod with version', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
      expect(detectLanguage(dir)).toEqual({ language: 'Go', language_version: '1.21' });
    } finally { cleanup(dir); }
  });

  test('empty project returns nulls', () => {
    const dir = mkTmp();
    try {
      expect(detectLanguage(dir)).toEqual({ language: null, language_version: null });
    } finally { cleanup(dir); }
  });
});

describe('detectDbEngine', () => {
  test('Postgres 15 from docker-compose image', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'), [
        'services:', '  db:', '    image: postgres:15-alpine',
      ].join('\n'));
      expect(detectDbEngine(dir)).toEqual({ db_engine: 'PostgreSQL', db_version: '15-alpine' });
    } finally { cleanup(dir); }
  });

  test('MySQL from compose without explicit version', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  db:\n    image: mysql\n');
      expect(detectDbEngine(dir).db_engine).toBe('MySQL');
    } finally { cleanup(dir); }
  });

  test('Postgres via pg dep fallback', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { pg: '^8.11.0' } }));
      expect(detectDbEngine(dir).db_engine).toBe('PostgreSQL');
    } finally { cleanup(dir); }
  });
});

describe('detectStack', () => {
  test('composes language + framework + db + port end-to-end', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        engines: { node: '>=20' },
        dependencies: { next: '14.0.0', pg: '^8.0.0' },
      }));
      fs.writeFileSync(path.join(dir, '.env'), 'PORT=3001\n');
      const stack = detectStack(dir, { framework: 'next' });
      expect(stack.language).toBe('JavaScript (Node.js)');
      expect(stack.framework).toBe('next');
      expect(stack.framework_version).toBe('14.0.0');
      expect(stack.db_engine).toBe('PostgreSQL');
      expect(stack.runtime_port).toBe('3001');
    } finally { cleanup(dir); }
  });

  test('defaults port by framework when env has nothing', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({ require: { php: '^8.2' } }));
      const stack = detectStack(dir, { framework: 'laravel' });
      expect(stack.language).toBe('PHP');
      expect(stack.runtime_port).toBe('8000');
    } finally { cleanup(dir); }
  });
});
