'use strict';

const diagrams = require('../skills/gostdocs/scripts/lib/diagrams');

describe('buildAuthSequenceMermaid', () => {
  test('returns null for empty scan', () => {
    expect(diagrams.buildAuthSequenceMermaid(null)).toBeNull();
    expect(diagrams.buildAuthSequenceMermaid({ authentication: {} })).toBeNull();
  });

  test('emits a sequenceDiagram when JWT or session is detected', () => {
    const out = diagrams.buildAuthSequenceMermaid({ authentication: { jwt: ['jsonwebtoken'] } });
    expect(out).toMatch(/^sequenceDiagram/);
    expect(out).toMatch(/Пользователь/);
    expect(out).toMatch(/POST \/auth\/login/);
  });

  test('English labels when lang=en', () => {
    const out = diagrams.buildAuthSequenceMermaid(
      { authentication: { session: ['express-session'] } },
      { lang: 'en' },
    );
    expect(out).toMatch(/actor U as User/);
  });
});

describe('buildComponentDiagramMermaid', () => {
  test('returns null when no meaningful components are present', () => {
    expect(diagrams.buildComponentDiagramMermaid({})).toBeNull();
  });

  test('includes DB + cache when the scans report them', () => {
    const out = diagrams.buildComponentDiagramMermaid({
      scalingScan: { caching: { redis: ['redis'] }, load_balancer: {} },
      protocolsScan: [{ source: 'App', target: 'PostgreSQL', protocol: 'wire', format: 'binary' }],
      securityScan: { authentication: { jwt: ['jsonwebtoken'] } },
    });
    expect(out).toMatch(/^graph TB/);
    expect(out).toMatch(/Cache/);
    expect(out).toMatch(/DB/);
    expect(out).toMatch(/Auth/);
  });
});

describe('buildDataFlowMermaid', () => {
  test('returns null when schema and protocols are empty', () => {
    expect(diagrams.buildDataFlowMermaid({})).toBeNull();
  });

  test('lists first few tables in the storage node', () => {
    const out = diagrams.buildDataFlowMermaid({
      schema: { tables: [{ name: 'users' }, { name: 'events' }] },
      protocolsScan: [],
    });
    expect(out).toMatch(/^graph LR/);
    expect(out).toMatch(/users/);
    expect(out).toMatch(/events/);
  });
});
