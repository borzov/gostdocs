'use strict';

const { buildTechScaling } = require('../skills/gen-docs/scripts/lib/tech-scaling-expander');

const EMPTY_SCAN = {
  horizontal_scaling: {},
  vertical_scaling: {},
  caching: {},
  fault_tolerance: {},
  load_balancer: {},
  replication: {},
};

describe('buildTechScaling', () => {
  test('emits 3 sections with defaults on empty scan', () => {
    const sections = buildTechScaling(EMPTY_SCAN, { lang: 'ru' });
    expect(sections.map((s) => s.heading)).toEqual([
      'Горизонтальное масштабирование',
      'Вертикальное масштабирование',
      'Отказоустойчивость',
    ]);
    for (const s of sections) {
      expect(s.elements.length).toBeGreaterThan(0);
    }
  });

  test('compose replicas replace horizontal default narrative', () => {
    const sections = buildTechScaling({
      ...EMPTY_SCAN,
      horizontal_scaling: { compose_replicas: ['docker-compose deploy.replicas'] },
    }, { lang: 'ru' });
    const horiz = sections.find((s) => s.heading === 'Горизонтальное масштабирование');
    const text = horiz.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/docker-compose/);
    expect(text).toMatch(/replicas/i);
    expect(text).not.toMatch(/подготовке к промышленной эксплуатации/);
  });

  test('caching and LB hints are appended to horizontal subsection', () => {
    const sections = buildTechScaling({
      ...EMPTY_SCAN,
      horizontal_scaling: { compose_replicas: ['x'] },
      caching: { cache: ['ioredis'] },
      load_balancer: { nginx_upstream: ['nginx upstream'] },
    }, { lang: 'ru' });
    const horiz = sections.find((s) => s.heading === 'Горизонтальное масштабирование');
    const text = horiz.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/кеширования/);
    expect(text).toMatch(/ioredis/);
    expect(text).toMatch(/nginx upstream/);
  });

  test('fault subsection surfaces probes + read-replica hint', () => {
    const sections = buildTechScaling({
      ...EMPTY_SCAN,
      fault_tolerance: { probes: ['k8s liveness/readiness probes'] },
      replication: { db_read_replica: ['db read replicas hint'] },
    }, { lang: 'ru' });
    const fault = sections.find((s) => s.heading === 'Отказоустойчивость');
    const text = fault.elements.map((e) => e.text).join(' ');
    expect(text).toMatch(/liveness|readiness/i);
    expect(text).toMatch(/реплик/i);
  });

  test('English mode produces English headings', () => {
    const sections = buildTechScaling(EMPTY_SCAN, { lang: 'en' });
    expect(sections.map((s) => s.heading)).toEqual([
      'Horizontal scaling',
      'Vertical scaling',
      'Fault tolerance',
    ]);
  });
});
