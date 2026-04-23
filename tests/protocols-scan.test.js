'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanProtocols } = require('../skills/gen-docs/scripts/lib/protocols-scan');

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'proto-scan-')); }
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

describe('scanProtocols', () => {
  test('always reports the base HTTPS REST channel', () => {
    const dir = mkTmp();
    try {
      const rows = scanProtocols(dir, { lang: 'ru' });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]).toEqual({
        source: 'Клиент', target: 'Сервер приложения', protocol: 'HTTPS (REST)', format: 'JSON',
      });
    } finally { cleanup(dir); }
  });

  test('detects websocket + redis cache + postgres from deps', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        dependencies: { ws: '^8.0.0', ioredis: '^5.0.0', pg: '^8.0.0' },
      }));
      const rows = scanProtocols(dir, { lang: 'ru' });
      expect(rows.some((r) => /WSS/.test(r.protocol))).toBe(true);
      expect(rows.some((r) => /Redis/.test(r.protocol))).toBe(true);
      expect(rows.some((r) => /PostgreSQL/i.test(r.protocol))).toBe(true);
    } finally { cleanup(dir); }
  });

  test('detects SMTP when mailer packages present', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        dependencies: { nodemailer: '^6.9.0' },
      }));
      const rows = scanProtocols(dir, { lang: 'ru' });
      expect(rows.some((r) => /SMTP/.test(r.protocol))).toBe(true);
    } finally { cleanup(dir); }
  });

  test('detects GraphQL when graphql-tooling present', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        dependencies: { graphql: '^16.0.0', 'apollo-server': '^3.0.0' },
      }));
      const rows = scanProtocols(dir, { lang: 'ru' });
      expect(rows.some((r) => /GraphQL/.test(r.protocol))).toBe(true);
    } finally { cleanup(dir); }
  });

  test('English mode labels switch to English', () => {
    const dir = mkTmp();
    try {
      const rows = scanProtocols(dir, { lang: 'en' });
      expect(rows[0].source).toBe('Client');
      expect(rows[0].target).toBe('Application server');
    } finally { cleanup(dir); }
  });
});
