const fs = require('fs');
const os = require('os');
const path = require('path');

const journeys = require('../skills/gen-docs/scripts/lib/journeys');

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-j-'));
  const file = path.join(dir, 'journeys.yaml');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

describe('validate + normaliseJourney', () => {
  test('assigns indices and ids', () => {
    const out = journeys.validate({
      journeys: [{
        name: 'create-order',
        role: 'user',
        steps: [
          { goto: '/orders/new', screenshot: true, caption: 'new order' },
          { fill: { '#qty': '3' }, screenshot: true },
          { click: 'button[type=submit]', screenshot: true, caption: 'submit' },
        ],
      }],
    });
    expect(out.journeys[0].steps.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(out.journeys[0].steps[0].id).toBe('create-order__01');
  });

  test('rejects journey without steps', () => {
    expect(() => journeys.validate({ journeys: [{ name: 'x', role: 'user', steps: [] }] })).toThrow();
  });

  test('rejects step with no action', () => {
    expect(() => journeys.validate({
      journeys: [{ name: 'x', role: 'user', steps: [{ caption: 'noop' }] }],
    })).toThrow();
  });

  test('empty file yields empty journeys array', () => {
    const out = journeys.validate({});
    expect(out.journeys).toEqual([]);
  });
});

describe('load', () => {
  test('returns empty when file does not exist', () => {
    const result = journeys.load('/nonexistent/path/journeys.yaml');
    expect(result.journeys).toEqual([]);
  });

  test('loads yaml file', () => {
    const file = tmpFile([
      'version: "1.0"',
      'journeys:',
      '  - name: create-order',
      '    role: user',
      '    steps:',
      '      - goto: /orders/new',
      '        screenshot: true',
      '      - click: button[type=submit]',
      '        screenshot: true',
    ].join('\n'));
    const result = journeys.load(file);
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0].steps).toHaveLength(2);
  });
});

describe('resolvePath', () => {
  test('uses default journeys.yaml when not configured', () => {
    const p = journeys.resolvePath({ project_path: '/tmp/p' });
    expect(p).toBe('/tmp/p/journeys.yaml');
  });

  test('honours configured journeys_file', () => {
    const p = journeys.resolvePath({ project_path: '/tmp/p', journeys_file: 'flows/main.yaml' });
    expect(p).toBe('/tmp/p/flows/main.yaml');
  });

  test('passes through absolute journeys_file', () => {
    const p = journeys.resolvePath({ project_path: '/tmp/p', journeys_file: '/abs/j.yaml' });
    expect(p).toBe('/abs/j.yaml');
  });
});
