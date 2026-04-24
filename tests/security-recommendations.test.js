const { buildSection, VALID_DOC_TYPES } = require('../skills/gostdocs/scripts/lib/security-recommendations');
const docModel = require('../skills/gostdocs/scripts/lib/doc-model');

describe('buildSection', () => {
  test.each(VALID_DOC_TYPES)('%s returns valid doc-model section', (docType) => {
    const section = buildSection(docType);
    // Wrap it into a minimal document so the full Doc-Model validator runs.
    const doc = docModel.newDocument({ title: 'T' });
    doc.sections.push(section);
    const validated = docModel.validate(doc);
    expect(validated.sections[0].heading).toBe(section.heading);
    expect(validated.sections[0].elements.length).toBeGreaterThan(0);
  });

  test('english heading differs from russian', () => {
    const ru = buildSection('user-guide');
    const en = buildSection('user-guide', { lang: 'en' });
    expect(ru.heading).not.toBe(en.heading);
    expect(en.heading).toMatch(/security/i);
  });

  test('admin-guide mentions MFA and audit log', () => {
    const section = buildSection('admin-guide');
    const concatenated = section.elements
      .filter((e) => e.type === 'checklist-result')
      .flatMap((e) => e.items.map((i) => i.label))
      .join('\n');
    expect(concatenated).toMatch(/MFA|многофакторную/i);
    expect(concatenated).toMatch(/аудит/i);
  });

  test('technical-description mentions TLS and at-rest', () => {
    const section = buildSection('technical-description');
    const items = section.elements
      .filter((e) => e.type === 'checklist-result')
      .flatMap((e) => e.items.map((i) => i.label))
      .join('\n');
    expect(items).toMatch(/TLS/);
    expect(items).toMatch(/поко/); // "состоянии покоя" / "в покое"
  });

  test('rejects unknown docType', () => {
    expect(() => buildSection('bogus')).toThrow();
  });

  test('honours level option', () => {
    const s = buildSection('user-guide', { level: 3 });
    expect(s.level).toBe(3);
  });
});
