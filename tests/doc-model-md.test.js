const dm = require('../skills/gostdocs/scripts/lib/doc-model');
const render = require('../skills/gostdocs/scripts/lib/doc-model-md');

function docWithSections() {
  const doc = dm.newDocument({ title: 'Руководство', lang: 'ru-RU' });
  const intro = dm.addSection(doc, dm.newSection({ heading: 'Введение', level: 1 }));
  dm.addElement(intro, { type: 'paragraph', text: 'Область применения.' });
  dm.addElement(intro, { type: 'figure', caption: 'Главная страница', file: 'guest/desktop/home.png' });
  const ops = dm.addSection(doc, dm.newSection({ heading: 'Описание операций', level: 1 }));
  dm.addElement(ops, { type: 'figure', caption: 'Список', file: 'admin/desktop/list.png' });
  dm.addElement(ops, { type: 'figure', caption: 'Карточка', file: 'admin/desktop/card.png' });
  dm.addElement(ops, {
    type: 'table', caption: 'Параметры',
    headers: ['Параметр', 'Значение'], rows: [['a', '1'], ['b', '2']],
  });
  return doc;
}

describe('render', () => {
  test('emits YAML frontmatter', () => {
    const md = render.render(dm.validate(docWithSections()));
    expect(md).toMatch(/^---\ntitle-meta: Руководство\nlang: ru-RU\n---/);
  });

  test('numbers figures per top-level section', () => {
    const md = render.render(dm.validate(docWithSections()));
    expect(md).toMatch(/Рисунок 1\.1 — Главная страница/);
    expect(md).toMatch(/Рисунок 2\.1 — Список/);
    expect(md).toMatch(/Рисунок 2\.2 — Карточка/);
  });

  test('numbers tables per top-level section', () => {
    const md = render.render(dm.validate(docWithSections()));
    expect(md).toMatch(/Table: Таблица 2\.1 — Параметры/);
    expect(md).toMatch(/\| Параметр \| Значение \|/);
    expect(md).toMatch(/Table: Таблица 2\.1 — Параметры\n\n\|/);
  });

  test('renders title-page preamble before sections with \\newpage', () => {
    const doc = dm.newDocument({ title: 'Руководство', lang: 'ru-RU' });
    doc.preamble.push({
      type: 'title-page',
      organization: 'ООО «Пилот»',
      document_title: 'Руководство пользователя',
      system_name: 'Пилот',
      doc_code: 'ПЛТ.00001-01',
      city: 'Москва',
      year: '2026',
      version: '1.0',
      approved_by: null,
    });
    const intro = dm.addSection(doc, dm.newSection({ heading: 'Введение', level: 1 }));
    dm.addElement(intro, { type: 'paragraph', text: 'Текст.' });
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/::: \{\.titlepage\}/);
    expect(md).toMatch(/\*\*ООО «Пилот»\*\*/);
    expect(md).toMatch(/\*\*Руководство пользователя\*\*/);
    expect(md).toMatch(/АС «Пилот»/);
    expect(md).toMatch(/ПЛТ\.00001-01/);
    expect(md).toMatch(/Москва, 2026/);
    expect(md).toMatch(/\\newpage/);
    // Title page lands before the first section heading.
    const titleIdx = md.indexOf('::: {.titlepage}');
    const sectionIdx = md.indexOf('# Введение');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeGreaterThan(titleIdx);
  });

  test('title-page skips empty metadata lines gracefully', () => {
    const doc = dm.newDocument({ title: 'T' });
    doc.preamble.push({
      type: 'title-page',
      organization: null,
      document_title: 'Minimal Cover',
      system_name: null,
      doc_code: null,
      city: null,
      year: '2026',
      version: null,
      approved_by: null,
    });
    dm.addSection(doc, dm.newSection({ heading: 'H', level: 1, elements: [{ type: 'paragraph', text: 'x' }] }));
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/\*\*Minimal Cover\*\*/);
    expect(md).toMatch(/2026/);
    expect(md).not.toMatch(/undefined/);
    expect(md).not.toMatch(/null/);
  });

  test('renders admonitions with localised header', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    dm.addElement(s, { type: 'admonition', kind: 'warning', text: 'Важно.' });
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/> \*\*Внимание\.\*\* Важно\./);
  });

  test('renders checklist-result', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    dm.addElement(s, {
      type: 'checklist-result',
      title: 'Проверка',
      items: [
        { label: 'есть', filled: true, source: null },
        { label: 'нет',  filled: false, source: null },
      ],
    });
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/- \[V\] есть/);
    expect(md).toMatch(/- \[ \] нет/);
  });

  test('english lang emits english labels', () => {
    const doc = dm.newDocument({ title: 'Guide', lang: 'en-US' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'Intro', level: 1 }));
    dm.addElement(s, { type: 'figure', caption: 'Home', file: 'x.png' });
    dm.addElement(s, { type: 'admonition', kind: 'note', text: 'Hello.' });
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/Figure 1\.1 — Home/);
    expect(md).toMatch(/\*\*Note\.\*\*/);
  });

  test('heading levels respected', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    s.children.push(dm.newSection({ heading: 'Sub', level: 2 }));
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/^# H$/m);
    expect(md).toMatch(/^## Sub$/m);
  });

  test('no horizontal rules outside frontmatter, no triple-newline runs', () => {
    const md = render.render(dm.validate(docWithSections()));
    // Drop the leading frontmatter block (between the first two --- lines).
    const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
    expect(body).not.toMatch(/^---$/m);
    expect(body).not.toMatch(/\n{3,}/);
  });

  test('page-description heading honours element.level (default H2)', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'Описание операций', level: 1 }));
    dm.addElement(s, {
      type: 'page-description',
      page_id: 'home',
      title: 'Главная страница',
      file: 'guest/home.png',
      narrative: 'Главная доступна без входа.',
    });
    const md = render.render(dm.validate(doc));
    // No more "### " hard-code: page-description nested under H1 chapter renders as H2 → 1.1
    expect(md).toMatch(/^## Главная страница$/m);
    expect(md).not.toMatch(/^### Главная страница$/m);
    expect(md).toMatch(/Рисунок 1\.1 — Главная страница/);
    expect(md).toMatch(/Главная доступна без входа\./);
  });

  test('page-description honours explicit level=3 (e.g. inside an H2 subsection)', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'Гл', level: 1 }));
    const sub = dm.newSection({ heading: 'Публичный интерфейс', level: 2 });
    s.children.push(sub);
    dm.addElement(sub, {
      type: 'page-description',
      page_id: 'home',
      title: 'Главная',
      file: 'guest/home.png',
      level: 3,
    });
    const md = render.render(dm.validate(doc));
    expect(md).toMatch(/^### Главная$/m);
  });

  test('page-description renders narrative as a normal paragraph (no English checklist)', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'Описание', level: 1 }));
    dm.addElement(s, {
      type: 'page-description',
      page_id: 'profile',
      title: 'Профиль',
      file: 'user/profile.png',
      narrative: 'На странице расположен заголовок «Профиль» и кнопки «Изменить» и «Редактировать».',
    });
    const md = render.render(dm.validate(doc));
    expect(md).toContain('На странице расположен заголовок «Профиль»');
    // No raw QA checklist must leak into end-user docs
    expect(md).not.toMatch(/breadcrumb/);
    expect(md).not.toMatch(/top_buttons/);
    expect(md).not.toMatch(/Проверочный список/);
    expect(md).not.toMatch(/\[V\] heading/);
  });

  test('renderTable surrounds the table with blank lines so pandoc preserves it', () => {
    const doc = dm.newDocument({ title: 'T' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'H', level: 1 }));
    dm.addElement(s, { type: 'paragraph', text: 'Перед таблицей.' });
    dm.addElement(s, {
      type: 'table',
      caption: 'Параметры',
      headers: ['А', 'Б'],
      rows: [['1', '2']],
    });
    dm.addElement(s, { type: 'paragraph', text: 'После таблицы.' });
    const md = render.render(dm.validate(doc));
    // Both rows of the table must be flanked by blank lines
    expect(md).toMatch(/Перед таблицей\.\n\nTable: Таблица 1\.1 — Параметры\n\n\| А \| Б \|/);
    expect(md).toMatch(/\| 1 \| 2 \|\n\nПосле таблицы\./);
  });
});
