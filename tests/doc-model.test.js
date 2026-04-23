const dm = require('../skills/gen-docs/scripts/lib/doc-model');

describe('newDocument / newSection / add*', () => {
  test('builds valid tree', () => {
    const doc = dm.newDocument({ title: 'User Guide', lang: 'ru-RU' });
    const intro = dm.addSection(doc, dm.newSection({ heading: 'Введение', level: 1 }));
    dm.addElement(intro, { type: 'paragraph', text: 'Описание.' });
    dm.addElement(intro, { type: 'figure', caption: 'Главная', file: 'guest/desktop/home.png' });
    const v = dm.validate(doc);
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0].elements).toHaveLength(2);
  });

  test('rejects document without title', () => {
    expect(() => dm.newDocument({})).toThrow();
  });

  test('rejects section without heading', () => {
    expect(() => dm.newSection({})).toThrow();
  });
});

describe('element validation', () => {
  const baseDoc = () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    return { doc, s };
  };

  test('paragraph requires non-empty text', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, { type: 'paragraph', text: '' });
    expect(() => dm.validate(doc)).toThrow();
  });

  test('figure requires caption + file', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, { type: 'figure', caption: 'c', file: 'x.png' });
    expect(dm.validate(doc).sections[0].elements[0].file).toBe('x.png');
  });

  test('table requires headers', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, { type: 'table', headers: [], rows: [] });
    expect(() => dm.validate(doc)).toThrow();
  });

  test('checklist-result', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, {
      type: 'checklist-result', title: 'Checklist',
      items: [{ label: 'a', filled: true, source: null }],
    });
    expect(dm.validate(doc).sections[0].elements[0].items).toHaveLength(1);
  });

  test('page-description requires page_id, title, file', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, { type: 'page-description', page_id: 'home', title: 'Главная', file: 'guest/home.png', checklist: [] });
    const v = dm.validate(doc);
    expect(v.sections[0].elements[0].page_id).toBe('home');
    expect(v.sections[0].elements[0].file).toBe('guest/home.png');
    expect(v.sections[0].elements[0].checklist).toEqual([]);
  });

  test('page-description checklist items carry count/value/source', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, {
      type: 'page-description',
      page_id: 'events',
      title: 'Каталог',
      file: 'guest/events.png',
      checklist: [
        { label: 'breadcrumb', filled: true, value: 'Главная / Мероприятия', source: 'inspection' },
        { label: 'columns', filled: true, count: 5, source: 'inspection' },
        { label: 'pagination', filled: false, source: 'manual' },
      ],
      description: 'Страница каталога.',
    });
    const v = dm.validate(doc);
    const el = v.sections[0].elements[0];
    expect(el.checklist).toHaveLength(3);
    expect(el.checklist[1].count).toBe(5);
    expect(el.description).toBe('Страница каталога.');
  });

  test('page-description rejects missing required fields', () => {
    const { doc, s } = baseDoc();
    dm.addElement(s, { type: 'page-description', title: 'Главная', file: 'x.png', checklist: [] });
    expect(() => dm.validate(doc)).toThrow();
  });
});

describe('walkSections + countElements', () => {
  test('walks depth-first', () => {
    const doc = dm.newDocument({ title: 'T' });
    const a = dm.addSection(doc, dm.newSection({ heading: 'A', level: 1 }));
    a.children.push(dm.newSection({ heading: 'A1', level: 2 }));
    dm.addSection(doc, dm.newSection({ heading: 'B', level: 1 }));
    const seen = [];
    dm.walkSections(doc, (s) => seen.push(s.heading));
    expect(seen).toEqual(['A', 'A1', 'B']);
  });

  test('counts elements by predicate', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    dm.addElement(s, { type: 'paragraph', text: 'a' });
    dm.addElement(s, { type: 'figure', caption: 'c', file: 'f.png' });
    dm.addElement(s, { type: 'figure', caption: 'c2', file: 'g.png' });
    expect(dm.countElements(doc, (e) => e.type === 'figure')).toBe(2);
  });
});

describe('slugify', () => {
  test('transliterates Russian', () => {
    expect(dm.slugify('Описание операций')).toMatch(/^opisan/);
  });

  test('strips punctuation', () => {
    expect(dm.slugify('Hello, World!!!')).toBe('hello-world');
  });

  test('falls back to "section" for empty', () => {
    expect(dm.slugify('')).toBe('section');
  });
});
