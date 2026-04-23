const { renderJourneyToDocModel, renderJourneysSection, findCaptureForStep, stepDescription } =
  require('../skills/gen-docs/scripts/lib/journey-render');
const docModel = require('../skills/gen-docs/scripts/lib/doc-model');

const sampleJourney = {
  name: 'create-order',
  description: 'Create a new order from scratch.',
  role: 'user',
  steps: [
    { index: 1, goto: '/orders/new', screenshot: true, caption: 'Open form' },
    { index: 2, fill: { '#qty': '3' }, screenshot: false },
    { index: 3, click: 'button[type=submit]', screenshot: true, caption: 'Submit' },
  ],
};

const sampleManifest = {
  captures: [
    {
      id: 'create-order__01', path: '/orders/new', role: 'user', viewport: 'desktop',
      file: 'user/desktop/create-order__01.png',
      journey: { name: 'create-order', step: 1 }, success: true, access: 'public',
    },
    {
      id: 'create-order__03', path: '/orders', role: 'user', viewport: 'desktop',
      file: 'user/desktop/create-order__03.png',
      journey: { name: 'create-order', step: 3 }, success: true, access: 'public',
    },
  ],
};

describe('findCaptureForStep', () => {
  test('matches by journey name and step', () => {
    const c = findCaptureForStep(sampleManifest, 'create-order', 3);
    expect(c.file).toMatch(/create-order__03/);
  });

  test('returns null when no match', () => {
    expect(findCaptureForStep(sampleManifest, 'x', 99)).toBeNull();
    expect(findCaptureForStep(null, 'x', 1)).toBeNull();
  });
});

describe('stepDescription fallbacks', () => {
  test('uses caption first', () => {
    expect(stepDescription({ caption: 'c', goto: '/x' }, 'en')).toBe('c');
  });

  test('falls back to goto then click then fill', () => {
    expect(stepDescription({ goto: '/x' }, 'en')).toMatch(/Navigate/);
    expect(stepDescription({ click: '.btn' }, 'en')).toMatch(/Click/);
    expect(stepDescription({ fill: { a: '1', b: '2' } }, 'en')).toMatch(/Fill fields: a, b/);
  });
});

describe('renderJourneyToDocModel', () => {
  test('emits step paragraphs + figures for screenshot steps', () => {
    const section = renderJourneyToDocModel(sampleJourney, sampleManifest);
    const types = section.elements.map((e) => e.type);
    // description paragraph + "Sequence of actions:" intro + 3 step paragraphs + 2 figures
    expect(section.elements.filter((e) => e.type === 'figure')).toHaveLength(2);
    expect(types[0]).toBe('paragraph'); // description
  });

  test('produces valid Doc-Model section', () => {
    const section = renderJourneyToDocModel(sampleJourney, sampleManifest);
    const doc = docModel.newDocument({ title: 'T' });
    doc.sections.push(section);
    expect(() => docModel.validate(doc)).not.toThrow();
  });

  test('en language uses English strings', () => {
    const section = renderJourneyToDocModel(sampleJourney, sampleManifest, { lang: 'en' });
    const intro = section.elements.find((e) => e.type === 'paragraph' && /Sequence of actions/.test(e.text));
    expect(intro).toBeDefined();
  });

  test('throws on missing steps[]', () => {
    expect(() => renderJourneyToDocModel({ name: 'x' }, sampleManifest)).toThrow();
  });
});

describe('renderJourneysSection', () => {
  test('wraps multiple journeys in a parent section', () => {
    const file = { journeys: [sampleJourney] };
    const parent = renderJourneysSection(file, sampleManifest, { lang: 'ru' });
    expect(parent.heading).toMatch(/Примеры использования/);
    expect(parent.children).toHaveLength(1);
  });

  test('empty journeys emits a placeholder paragraph', () => {
    const parent = renderJourneysSection({ journeys: [] }, sampleManifest);
    expect(parent.children).toHaveLength(0);
    expect(parent.elements).toHaveLength(1);
  });
});
