'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSecurity } = require('../skills/gen-docs/scripts/lib/security-scan');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'security-scan-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('scanSecurity', () => {
  test('detects JWT + helmet + rate-limit in a Node.js package.json', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        dependencies: {
          jsonwebtoken: '^9.0.0',
          bcrypt: '^5.1.1',
          helmet: '^7.0.0',
          cors: '^2.8.5',
          'express-rate-limit': '^7.1.0',
        },
      }));
      const scan = scanSecurity(dir);
      expect(scan.authentication.jwt).toEqual(expect.arrayContaining(['jsonwebtoken']));
      expect(scan.password_hashing.bcrypt).toEqual(expect.arrayContaining(['bcrypt']));
      expect(scan.network_security.helmet).toEqual(expect.arrayContaining(['helmet']));
      expect(scan.network_security.cors).toEqual(expect.arrayContaining(['cors']));
      expect(scan.network_security.rate_limit).toEqual(expect.arrayContaining(['express-rate-limit']));
    } finally { cleanup(dir); }
  });

  test('detects Laravel auth stack from composer.json', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({
        require: {
          'laravel/sanctum': '^3.0',
          'spatie/laravel-permission': '^6.0',
          'spatie/laravel-activitylog': '^4.0',
        },
      }));
      const scan = scanSecurity(dir);
      expect(scan.authentication.laravel).toEqual(expect.arrayContaining(['laravel/sanctum']));
      expect(scan.authorization.rbac).toEqual(expect.arrayContaining(['spatie/laravel-permission']));
      expect(scan.auditing.model).toEqual(expect.arrayContaining(['spatie/laravel-activitylog']));
    } finally { cleanup(dir); }
  });

  test('detects Django + argon2 + django-ratelimit', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), [
        'Django==4.2',
        'argon2-cffi==23.1.0',
        'django-cors-headers==4.3.0',
        'django-ratelimit==4.1.0',
      ].join('\n'));
      const scan = scanSecurity(dir);
      expect(Object.keys(scan.authentication)).toEqual(expect.arrayContaining(['framework']));
      expect(scan.password_hashing.argon2).toBeDefined();
      expect(scan.network_security.cors).toBeDefined();
      expect(scan.network_security.rate_limit).toBeDefined();
    } finally { cleanup(dir); }
  });

  test('detects audit_log table from a migrations folder', () => {
    const dir = mkTmp();
    try {
      fs.mkdirSync(path.join(dir, 'database', 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'database/migrations/2024_01_01_create_audit_log.sql'), '');
      fs.writeFileSync(path.join(dir, 'database/migrations/2024_01_02_create_action_logs.sql'), '');
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      const scan = scanSecurity(dir);
      expect(scan.audit_tables).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/audit_log/),
          expect.stringMatching(/action_logs/),
        ]),
      );
    } finally { cleanup(dir); }
  });

  test('empty project returns empty maps but no crash', () => {
    const dir = mkTmp();
    try {
      const scan = scanSecurity(dir);
      expect(scan.deps_found).toBe(0);
      expect(scan.authentication).toEqual({});
      expect(scan.audit_tables).toEqual([]);
    } finally { cleanup(dir); }
  });
});
